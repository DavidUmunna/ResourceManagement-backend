const mongoose = require("mongoose");

const ComplianceIssueSchema = new mongoose.Schema(
  {
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: "Tender", required: true },
    requirementId: { type: mongoose.Schema.Types.ObjectId, ref: "TenderRequirement" },
    status: { type: String, enum: ["Open", "Resolved"], default: "Open" },
    description: String,
    evidenceDocs: [{ type: mongoose.Schema.Types.ObjectId, ref: "CompanyDocument" }],
  },
  { timestamps: true }
);

module.exports = mongoose.model("ComplianceIssue", ComplianceIssueSchema);
