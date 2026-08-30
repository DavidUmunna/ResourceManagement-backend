/**
 * Focused E2E: site-approver provisioning + self-service password recovery.
 * Real Mongo + Redis + CSRF, throwaway DB.
 */
require("dotenv").config();
process.env.MONGO_URI = "mongodb://localhost:27017/Halden_e2e_approver";
process.env.PORT = "4609";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret";

const mongoose = require("mongoose");
const redis = require("redis");
const bcrypt = require("bcrypt");
const request = require("supertest");
const app = require("../server");
const SiteApprover = require("../models/SiteApprover");

const SID = "e2e-approver-session";
const STAFF = { userId: "000000000000000000000051", role: "global_admin", name: "E2E Admin" };
let PASS = 0, FAIL = 0; const out = [];
const ck = (n, c, d = "") => { if (c) { PASS++; out.push(`  ✓ ${n}`); } else { FAIL++; out.push(`  ✗ ${n}  ${d}`); } };

let csrfToken = "", csrfCookie = "";
const cookie = () => [`sessionId=${SID}`, csrfCookie].filter(Boolean).join("; ");
const staff = (m, p) => { const r = request(app)[m](p).set("Cookie", cookie()); if (["post", "put"].includes(m)) r.set("x-xsrf-token", csrfToken); return r; };
const pub = (m, p) => request(app)[m](p); // public endpoints (CSRF-excluded)
const seedOtp = (id, code) => SiteApprover.findByIdAndUpdate(id, { otpHash: bcrypt.hashSync(code, 10), otpExpiresAt: new Date(Date.now() + 60000) });

async function main() {
  await new Promise((res) => (mongoose.connection.readyState === 1 ? res() : mongoose.connection.once("connected", res)));
  await mongoose.connection.db.dropDatabase();
  const rc = redis.createClient(); await rc.connect(); await rc.set(`session:${SID}`, JSON.stringify(STAFF));
  const cr = await request(app).get("/api/csrf-token").set("Cookie", `sessionId=${SID}`);
  const sc = cr.headers["set-cookie"] || [];
  const x = sc.find((c) => c.startsWith("XSRF-TOKEN=")); const _c = sc.find((c) => c.startsWith("_csrf="));
  csrfToken = x ? decodeURIComponent(x.split(";")[0].split("=")[1]) : ""; csrfCookie = _c ? _c.split(";")[0] : "";

  const phone = "+2348000000055";

  // 1. admin creates the approver
  let r = await staff("post", "/api/site-approvers").send({ name: "Field Boss", phone, tempPassword: "Temp1234", site: "Rig 7" });
  ck("admin creates approver (201)", r.status === 201, JSON.stringify(r.body));
  const id = r.body?.data?._id;

  let doc = await SiteApprover.findById(id);
  ck("stored temp password + mustChangePassword", doc?.mustChangePassword === true && bcrypt.compareSync("Temp1234", doc.passwordHash), "");

  // duplicate phone rejected
  r = await staff("post", "/api/site-approvers").send({ name: "Dup", phone, tempPassword: "Temp1234" });
  ck("duplicate phone rejected (409)", r.status === 409, `status ${r.status}`);

  // 2. self-service recovery — forgot then reset (no admin involved)
  r = await pub("post", "/api/site-approvers/forgot-password").send({ phone });
  ck("forgot-password 200 (generic)", r.status === 200, JSON.stringify(r.body));

  await seedOtp(id, "222222"); // simulate the SMS'd code
  r = await pub("post", "/api/site-approvers/reset-password").send({ phone, otp: "222222", newPassword: "BrandNew123" });
  ck("reset-password 200", r.status === 200, JSON.stringify(r.body));

  doc = await SiteApprover.findById(id);
  ck("new password set, mustChangePassword cleared, otp consumed",
    bcrypt.compareSync("BrandNew123", doc.passwordHash) && doc.mustChangePassword === false && !doc.otpHash, "");

  // wrong code rejected
  await seedOtp(id, "222222");
  r = await pub("post", "/api/site-approvers/reset-password").send({ phone, otp: "999999", newPassword: "X-should-not-apply-1" });
  ck("reset-password wrong code (401)", r.status === 401, `status ${r.status}`);

  // 3. login now works with the NEW password (generic 200; verify-otp proves it)
  r = await pub("post", "/api/site-approvers/login").send({ phone, password: "BrandNew123" });
  ck("login with new password (generic 200)", r.status === 200);
  await seedOtp(id, "333333");
  r = await pub("post", "/api/site-approvers/verify-otp").send({ phone, otp: "333333" });
  ck("verify-otp issues a token after recovery", r.status === 200 && !!r.body?.token, JSON.stringify(r.body));

  // 4. admin deactivate → recovery no longer possible
  r = await staff("put", `/api/site-approvers/${id}`).send({ active: false });
  ck("admin deactivate (200)", r.status === 200 && r.body?.data?.active === false, JSON.stringify(r.body?.data?.active));
  await seedOtp(id, "444444");
  r = await pub("post", "/api/site-approvers/reset-password").send({ phone, otp: "444444", newPassword: "AfterDeactivate1" });
  ck("reset blocked for deactivated approver (401)", r.status === 401, `status ${r.status}`);

  // 5. forgot-password for unknown phone is generic (no leak / no error)
  r = await pub("post", "/api/site-approvers/forgot-password").send({ phone: "+000" });
  ck("forgot-password unknown phone → generic 200", r.status === 200, `status ${r.status}`);

  await mongoose.connection.dropDatabase(); await rc.del(`session:${SID}`); await rc.quit(); await mongoose.disconnect();
  console.log("\n=== APPROVER RECOVERY E2E ===\n" + out.join("\n") + `\n\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
