const service = require("../../services/siteApprover.service");

function handleError(res, error, context) {
  const status = error.status || 500;
  if (status === 500) console.error(`siteApprover.controller ${context}:`, error);
  return res.status(status).json({ success: false, message: error.message || "Server error" });
}

// ── Admin (staff) ─────────────────────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const data = await service.createApprover(req.user, req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "create");
  }
};

exports.list = async (req, res) => {
  try {
    const data = await service.listApprovers(req.query.active !== undefined ? { active: req.query.active === "true" } : {});
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "list");
  }
};

exports.update = async (req, res) => {
  try {
    const data = await service.updateApprover(req.user, req.params.id, req.body);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "update");
  }
};

// ── Public login + recovery flow ──────────────────────────────────────────────
exports.forgotPassword = async (req, res) => {
  try {
    const data = await service.forgotPassword(req.body);
    return res.status(200).json({ success: true, ...data });
  } catch (e) {
    return handleError(res, e, "forgotPassword");
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const data = await service.resetPassword(req.body);
    return res.status(200).json({ success: true, ...data });
  } catch (e) {
    return handleError(res, e, "resetPassword");
  }
};

exports.login = async (req, res) => {
  try {
    const data = await service.login(req.body);
    return res.status(200).json({ success: true, ...data });
  } catch (e) {
    return handleError(res, e, "login");
  }
};

exports.verifyOtp = async (req, res) => {
  try {
    const data = await service.verifyOtp(req.body);
    return res.status(200).json({ success: true, ...data });
  } catch (e) {
    return handleError(res, e, "verifyOtp");
  }
};

// ── Authenticated as the approver ─────────────────────────────────────────────
exports.requestOtp = async (req, res) => {
  try {
    const data = await service.requestOtp(req.siteApprover.id);
    return res.status(200).json({ success: true, ...data });
  } catch (e) {
    return handleError(res, e, "requestOtp");
  }
};

exports.changePassword = async (req, res) => {
  try {
    const data = await service.changePassword(req.siteApprover.id, req.body);
    return res.status(200).json({ success: true, ...data });
  } catch (e) {
    return handleError(res, e, "changePassword");
  }
};
