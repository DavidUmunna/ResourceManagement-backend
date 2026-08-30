const mongoose = require("mongoose");
const { WAYBILL_STATUSES } = require("../constants/skips.constants");

// Waybill — the dispatch document authorizing empty skips to leave for a site.
// A skip cannot be MOBILIZED (FR-17e) unless it is attached to an APPROVED waybill.
const actorSnapshot = {
  id: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
  name: { type: String },
  role: { type: String },
};

const WaybillSchema = new mongoose.Schema(
  {
    waybillNo: { type: String, required: true, unique: true, trim: true },
    status: { type: String, enum: WAYBILL_STATUSES, default: "issued" },

    destination: { type: String },
    notes: { type: String },

    // Skips currently on this waybill. Cleared on reject (snapshot below).
    attachedSkipIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Skipstracking" }],
    // Snapshot taken at reject time so the pre-unlink membership is auditable.
    previouslyAttachedSkipIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Skipstracking" }],

    createdBy: actorSnapshot,
    approvedBy: actorSnapshot,
    approvedAt: { type: Date },
    rejectedBy: actorSnapshot,
    rejectedAt: { type: Date },
    rejectionReason: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model("waybill", WaybillSchema);
