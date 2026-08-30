const bcrypt = require("bcrypt");
const approverRepo = require("../repositories/siteApprover.repository");
const { otpBypassEnabled, warnBypass } = require("../Global_Functions/otpBypass");

// FR-19 — verifies a fresh, single-use OTP for a site approver at the point of a
// compliance action (manifest sign/reject). Runs AFTER check-auth-site-approver,
// so req.siteApprover is set. Consumes the OTP on success.
module.exports = async function checkApproverOtp(req, res, next) {
  try {
    if (otpBypassEnabled()) { warnBypass("manifest sign/reject (approver OTP)"); return next(); }

    const { otp } = req.body;
    if (!otp) return res.status(400).json({ success: false, message: "Approval code is required" });

    const approver = await approverRepo.findById(req.siteApprover.id);
    if (!approver || !approver.otpHash || !approver.otpExpiresAt || approver.otpExpiresAt.getTime() < Date.now()) {
      return res.status(401).json({ success: false, message: "Code expired or not requested" });
    }
    const ok = await bcrypt.compare(String(otp), approver.otpHash);
    if (!ok) return res.status(401).json({ success: false, message: "Invalid code" });

    // single-use
    await approverRepo.update(approver._id, { otpHash: null, otpExpiresAt: null });
    next();
  } catch (err) {
    console.error("checkApproverOtp:", err);
    return res.status(500).json({ success: false, message: "Approval code verification failed" });
  }
};
