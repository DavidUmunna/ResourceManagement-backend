const mongoose = require("mongoose");

// SiteApprover — an EXTERNAL, non-employee approver (e.g. a client-site manager)
// who signs off manifests. They authenticate on their own rails: phone + password
// then an SMS OTP second factor. Kept entirely separate from staff `users`.
const SiteApproverSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    phone: { type: String, required: true, unique: true, trim: true },
    site: { type: String }, // location / project this approver covers

    passwordHash: { type: String, required: true },
    // Admin-provisioned accounts start with a temp password and must rotate it.
    mustChangePassword: { type: Boolean, default: true },

    // Login OTP (second factor). Stored hashed; single-use with an expiry.
    otpHash: { type: String },
    otpExpiresAt: { type: Date },

    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date },

    createdBy: {
      id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
      name: { type: String },
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("siteapprover", SiteApproverSchema);
