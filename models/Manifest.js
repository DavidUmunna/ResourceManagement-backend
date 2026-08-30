const mongoose = require("mongoose");
const { MANIFEST_STATUSES } = require("../constants/skips.constants");

// Manifest — the waste-disposal document for FILLED skips coming back off site.
// It documents demobilized skips and must be SIGNED by an external site approver
// (OTP-authenticated) before it is complete.
const staffSnapshot = {
  id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
  name: { type: String },
  role: { type: String },
};
const approverSnapshot = {
  id: { type: mongoose.Schema.Types.ObjectId, ref: "siteapprover" },
  name: { type: String },
  phone: { type: String },
};

const ManifestSchema = new mongoose.Schema(
  {
    manifestNo: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: MANIFEST_STATUSES, default: "issued" },

    notes: { type: String },

    // Only DEMOBILIZED skips may be attached (enforced in the service).
    attachedSkipIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Skipstracking" }],
    previouslyAttachedSkipIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Skipstracking" }],

    // The external approver expected to sign. If set, only they may sign.
    siteApproverId: { type: mongoose.Schema.Types.ObjectId, ref: "siteapprover" },

    createdBy: staffSnapshot,
    signedBy: approverSnapshot,
    signedAt: { type: Date },
    rejectedBy: approverSnapshot,
    rejectedAt: { type: Date },
    rejectionReason: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("manifest", ManifestSchema);
