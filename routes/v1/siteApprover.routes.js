const express = require("express");
const staffAuth = require("../../middlewares/check-auth");
const approverAuth = require("../../middlewares/check-auth-site-approver");
const c = require("../../controllers/v1.controllers/siteApprover.controllers");

const router = express.Router();

// Public login + recovery flow (external approvers, no staff session).
router.post("/login", c.login);              // phone + password → SMS OTP
router.post("/verify-otp", c.verifyOtp);     // phone + otp → approver JWT
router.post("/forgot-password", c.forgotPassword); // phone → SMS reset code
router.post("/reset-password", c.resetPassword);   // phone + otp + newPassword

// Self-service (authenticated as the approver).
router.post("/request-otp", approverAuth, c.requestOtp); // FR-19: fresh code for approve/reject
router.post("/change-password", approverAuth, c.changePassword);

// Admin (staff) provisioning + management.
router.post("/", staffAuth, c.create);
router.get("/", staffAuth, c.list);
router.put("/:id", staffAuth, c.update); // deactivate/reactivate, admin password reset

module.exports = router;
