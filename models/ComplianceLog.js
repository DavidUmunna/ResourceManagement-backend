const mongoose = require("mongoose");

const ComplianceLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      enum: ["CREATE", "UPDATE", "DELETE"],
      required: true,
    },
    entityType: {
      type: String,
      default: "FileTrack",
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "filetracking",
      required: true,
    },
    entityName: {
      type: String,
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    performedByName: {
      type: String,
    },
    performedByRole: {
      type: String,
    },
    description: {
      type: String,
    },
    changedFields: [
      {
        type: String,
      },
    ],
    statusBefore: {
      type: String,
    },
    statusAfter: {
      type: String,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    timestamps: true,
  }
);

ComplianceLogSchema.index({ entityId: 1, createdAt: -1 });
ComplianceLogSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model("complianceLog", ComplianceLogSchema);
