// middleware/twoFactorVerify.js
const OTPModel = require("../models/OTP"); // store OTP codes with expiry
const { otpBypassEnabled, warnBypass } = require("../Global_Functions/otpBypass");

async function twoFactorVerify(req, res, next) {
  if (otpBypassEnabled()) { warnBypass("staff 2FA (waybill approve/reject)"); return next(); }

  const { otp } = req.body;
  if(req.user.role==="human_resources"){
    return next()
  }
  if (!otp) {
    return res.status(400).json({ message: "Approval code is required" });
  }

  console.log("otp:",otp)
  const validOtp = await OTPModel.findOne({
    userId: req.user.userId,
    code: otp,
    expiresAt: { $gt: Date.now() }
  });
  console.log("current Date",Date.now().toLocaleString())

  if (!validOtp) {
    return res.status(401).json({ message: "Invalid or expired code" });
  }

  // (optional) Delete OTP so it can't be reused
  await OTPModel.deleteOne({ _id: validOtp._id });

  next();
}

module.exports = twoFactorVerify;
