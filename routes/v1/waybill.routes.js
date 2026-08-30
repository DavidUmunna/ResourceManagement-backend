const express = require("express");
const auth = require("../../middlewares/check-auth");
const twoFactorVerify = require("../../middlewares/TwoFactorVerify");
const c = require("../../controllers/v1.controllers/waybill.controllers");

const router = express.Router();

router.post("/", auth, c.create);
router.get("/", auth, c.list);
router.get("/:id", auth, c.getOne);

// Internal approval/rejection require a second factor (OTP) — FR-17d.
router.put("/:id/approve", auth, twoFactorVerify, c.approve);
router.put("/:id/reject", auth, twoFactorVerify, c.reject);

module.exports = router;
