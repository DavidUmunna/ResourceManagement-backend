const mongoose = require("mongoose");

const AuditLogSchema = new mongoose.Schema(
  {
    actor: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    action: { type: String, required: true },
    entity: { type: String, required: true },
    entityId: { type: String, required: true },
    metadata: mongoose.Schema.Types.Mixed,
  },
  { timestamps: true }
);

module.exports = mongoose.model("AuditLog", AuditLogSchema);
