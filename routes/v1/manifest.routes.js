const express = require("express");
const staffAuth = require("../../middlewares/check-auth");
const approverAuth = require("../../middlewares/check-auth-site-approver");
const approverOtp = require("../../middlewares/check-approver-otp");
const c = require("../../controllers/v1.controllers/manifest.controllers");

const router = express.Router();

// Approver-scoped reads (portal). Static "/mine" routes must precede "/:id".
router.get("/mine", approverAuth, c.listMine);
router.get("/mine/:id", approverAuth, c.getMine);
router.get("/mine/:id/pdf", approverAuth, c.exportMinePdf);

// Staff author + manage.
router.post("/", staffAuth, c.create);
router.get("/", staffAuth, c.list);
router.get("/:id", staffAuth, c.getOne);
router.get("/:id/pdf", staffAuth, c.exportPdf);
router.put("/:id/attach-skips", staffAuth, c.attachSkips);

// External site approver signs / rejects — session auth + a FRESH point-of-action OTP (FR-19).
router.put("/:id/sign", approverAuth, approverOtp, c.sign);
router.put("/:id/reject", approverAuth, approverOtp, c.reject);

module.exports = router;
