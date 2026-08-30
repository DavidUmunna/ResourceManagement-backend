const mongoose = require("mongoose");
const { Schema } = mongoose;

// A follow-up (nudge) on an existing, unresolved request — lets a requester chase
// a pending request WITHOUT creating a duplicate. Immutable once written.
const RequestFollowUpSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: "PurchaseOrder", required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "user", required: true },
    requestedByName: { type: String }, // snapshot for display
    note: { type: String, default: null },
    // The approver(s) notified at the time of this follow-up (audit).
    notifiedUserIds: [{ type: Schema.Types.ObjectId, ref: "user" }],
  },
  { timestamps: true } // createdAt = when the follow-up was sent
);

RequestFollowUpSchema.index({ order: 1, createdAt: -1 });
RequestFollowUpSchema.index({ notifiedUserIds: 1, createdAt: -1 });

module.exports = mongoose.model("RequestFollowUp", RequestFollowUpSchema);
