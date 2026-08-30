const crypto = require("crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const approverRepo = require("../repositories/siteApprover.repository");
const { sendSms } = require("./smsService");
const { logComplianceAction } = require("./ComplianceLog.service");
const { otpBypassEnabled, warnBypass } = require("../Global_Functions/otpBypass");

const httpError = (message, status) => Object.assign(new Error(message), { status });

const OTP_TTL_MS = 5 * 60 * 1000; // 5 minutes
const TOKEN_TTL = "12h";

const hash = (value) => bcrypt.hash(String(value), 10);
const compare = (value, digest) => bcrypt.compare(String(value), String(digest || ""));

const logApprover = (approver, opts) =>
  logComplianceAction({
    entityType: "SiteApprover",
    entityModel: "siteapprover",
    entityId: approver._id,
    entityName: approver.name,
    ...opts,
  });

/**
 * Admin (staff) provisions an external approver with a temporary password.
 * The approver must change it on first login.
 */
exports.createApprover = async (staffUser, payload = {}) => {
  const { name, phone, site, tempPassword } = payload;
  if (!name || !phone || !tempPassword) {
    throw httpError("name, phone and tempPassword are required", 400);
  }

  const existing = await approverRepo.findByPhone(phone);
  if (existing) throw httpError("A site approver with that phone already exists", 409);

  const approver = await approverRepo.create({
    name,
    phone: String(phone).trim(),
    site,
    passwordHash: await hash(tempPassword),
    mustChangePassword: true,
    createdBy: { id: staffUser?.userId, name: staffUser?.name },
  });

  await logApprover(approver, {
    action: "CREATE",
    actor: { id: staffUser?.userId, name: staffUser?.name, role: staffUser?.role, model: "user" },
    description: `Site approver ${approver.name} (${approver.phone}) provisioned`,
  });

  // Don't return secrets.
  const { passwordHash, otpHash, ...safe } = approver.toObject();
  return safe;
};

exports.listApprovers = (filter = {}) => approverRepo.findAll(filter);

/**
 * Admin update — e.g. deactivate/reactivate, change site/name. Optionally reset
 * the approver's password to a new temp value (admin fallback recovery).
 */
exports.updateApprover = async (staffUser, id, payload = {}) => {
  const approver = await approverRepo.findById(id);
  if (!approver) throw httpError("Site approver not found", 404);

  const update = {};
  if (payload.name !== undefined) update.name = payload.name;
  if (payload.site !== undefined) update.site = payload.site;
  if (payload.active !== undefined) update.active = !!payload.active;
  if (payload.tempPassword) {
    update.passwordHash = await hash(payload.tempPassword);
    update.mustChangePassword = true;
  }

  const updated = await approverRepo.update(id, update);
  await logApprover(updated, {
    action: "UPDATE",
    actor: { id: staffUser?.userId, name: staffUser?.name, role: staffUser?.role, model: "user" },
    description: `Site approver ${updated.name} updated`,
    changedFields: Object.keys(update),
  });
  const { passwordHash, otpHash, ...safe } = updated.toObject();
  return safe;
};

/**
 * Self-service recovery, step 1: an approver who forgot their password requests a
 * reset code to their phone. Generic response (never reveals whether the phone
 * exists). No bottleneck on an admin.
 */
exports.forgotPassword = async ({ phone }) => {
  if (!phone) throw httpError("phone is required", 400);
  const generic = { message: "If that phone is registered, a reset code has been sent." };

  const approver = await approverRepo.findByPhone(String(phone).trim());
  if (!approver || approver.active === false) return generic;

  await issueOtp(approver);
  return generic;
};

/**
 * Self-service recovery, step 2: verify the SMS code and set a new password.
 * Proves control of the phone (the same factor used for login OTP).
 */
exports.resetPassword = async ({ phone, otp, newPassword }) => {
  if (!phone || !otp) throw httpError("phone and otp are required", 401);
  if (!newPassword || String(newPassword).length < 8) throw httpError("newPassword must be at least 8 characters", 400);

  const approver = await approverRepo.findByPhone(String(phone).trim());
  if (!approver || approver.active === false) throw httpError("Invalid or expired code", 401);

  if (otpBypassEnabled()) {
    warnBypass("siteApprover reset-password");
  } else {
    if (!approver.otpHash || !approver.otpExpiresAt || approver.otpExpiresAt.getTime() < Date.now()) {
      throw httpError("Code expired or not requested", 401);
    }
    const ok = await compare(otp, approver.otpHash);
    if (!ok) throw httpError("Invalid or expired code", 401);
  }

  await approverRepo.update(approver._id, {
    passwordHash: await hash(newPassword),
    mustChangePassword: false,
    otpHash: null,
    otpExpiresAt: null,
  });
  return { message: "Password reset. You can now log in." };
};

// Generate, store (hashed) and SMS a fresh single-use OTP to the approver.
async function issueOtp(approver) {
  const otp = String(crypto.randomInt(100000, 1000000)); // 6-digit
  await approverRepo.update(approver._id, {
    otpHash: await hash(otp),
    otpExpiresAt: new Date(Date.now() + OTP_TTL_MS),
  });
  await sendSms({ to: approver.phone, message: `Your Halden approval code is ${otp}. It expires in 5 minutes.` });
}

/**
 * Step 1 of login: verify phone+password, then generate + SMS a one-time code.
 * Response is intentionally generic (never reveals whether the phone exists).
 */
exports.login = async ({ phone, password }) => {
  if (!phone || !password) throw httpError("phone and password are required", 400);

  const approver = await approverRepo.findByPhone(String(phone).trim());
  const generic = { message: "If the credentials are valid, an OTP has been sent." };

  if (!approver || approver.active === false) return generic;
  const ok = await compare(password, approver.passwordHash);
  if (!ok) return generic;

  await issueOtp(approver);
  return generic;
};

/**
 * FR-19 — request a fresh OTP at the point of action (approve/reject). The caller
 * is already authenticated as the approver, so this is not generic.
 */
exports.requestOtp = async (approverId) => {
  const approver = await approverRepo.findById(approverId);
  if (!approver || approver.active === false) throw httpError("Approver not found", 404);
  await issueOtp(approver);
  return { message: "A code has been sent to your phone." };
};

/**
 * Step 2 of login: verify the OTP and issue a site-approver JWT.
 */
exports.verifyOtp = async ({ phone, otp }) => {
  if (!phone || !otp) throw httpError("phone and otp are required", 400);

  const approver = await approverRepo.findByPhone(String(phone).trim());
  if (!approver || approver.active === false) throw httpError("Invalid code", 401);

  if (otpBypassEnabled()) {
    warnBypass("siteApprover login (verify-otp)");
  } else {
    if (!approver.otpHash || !approver.otpExpiresAt || approver.otpExpiresAt.getTime() < Date.now()) {
      throw httpError("Code expired or not requested", 401);
    }
    const ok = await compare(otp, approver.otpHash);
    if (!ok) throw httpError("Invalid code", 401);
  }

  // Single-use: clear the OTP and stamp the login.
  await approverRepo.update(approver._id, { otpHash: null, otpExpiresAt: null, lastLoginAt: new Date() });

  const token = jwt.sign(
    { approverId: approver._id, type: "siteapprover", name: approver.name, phone: approver.phone },
    process.env.JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );

  await logApprover(approver, {
    action: "LOGIN",
    actor: { id: approver._id, name: approver.name, role: "siteapprover", model: "siteapprover" },
    description: `Site approver ${approver.name} logged in`,
  });

  return { token, mustChangePassword: approver.mustChangePassword };
};

/**
 * Rotate password (self-service, authenticated as the approver).
 */
exports.changePassword = async (approverId, { newPassword }) => {
  if (!newPassword || String(newPassword).length < 8) {
    throw httpError("newPassword must be at least 8 characters", 400);
  }
  const approver = await approverRepo.findById(approverId);
  if (!approver) throw httpError("Site approver not found", 404);

  await approverRepo.update(approverId, {
    passwordHash: await hash(newPassword),
    mustChangePassword: false,
  });
  return { message: "Password updated" };
};
