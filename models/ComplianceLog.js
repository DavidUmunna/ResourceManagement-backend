const mongoose = require("mongoose");

const ComplianceLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      // CRUD verbs (legacy) + RFID skip-tracking lifecycle verbs.
      enum: ["CREATE", "UPDATE", "DELETE", "SCAN", "MANUAL_SCAN", "APPROVE", "REJECT", "SIGN", "RETURN", "LOGIN"],
      required: true,
    },

    // Polymorphic entity (FR-26). Defaults keep pre-existing FileTrack rows/writes valid.
    entityType: {
      type: String,
      enum: ["FileTrack", "Skip", "Truck", "Driver", "Manifest", "Waybill", "SiteApprover", "Project"],
      default: "FileTrack",
      required: true,
    },
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "entityModel",
      required: true,
    },
    entityModel: {
      type: String,
      enum: ["filetracking", "skip", "truck", "driver", "manifest", "waybill", "siteapprover", "project"],
      default: "filetracking",
      required: true,
    },
    entityName: {
      type: String,
    },

    // Polymorphic actor — can now be a staff User or a third-party SiteApprover (FR-26).
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      refPath: "performedByModel",
    },
    performedByModel: {
      type: String,
      enum: ["user", "siteapprover"],
      default: "user",
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
