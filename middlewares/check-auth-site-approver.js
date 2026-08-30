const jwt = require("jsonwebtoken");

// Auth for EXTERNAL site approvers — a JWT issued after phone+password+OTP.
// Deliberately separate from staff `check-auth` (which uses Redis sessions).
// Token is expected as `Authorization: Bearer <token>` or an `approverToken` cookie.
module.exports = function checkAuthSiteApprover(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const bearer = header.startsWith("Bearer ") ? header.slice(7) : null;
    const token = bearer || req.cookies?.approverToken;

    if (!token) {
      return res.status(401).json({ success: false, message: "No approver token provided" });
    }

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.type !== "siteapprover") {
      return res.status(401).json({ success: false, message: "Invalid token type" });
    }

    req.siteApprover = { id: payload.approverId, name: payload.name, phone: payload.phone };
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: "Invalid or expired approver token" });
  }
};
