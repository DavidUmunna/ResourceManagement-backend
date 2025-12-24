const mongoose = require("mongoose");

const TenderRequirementSchema = new mongoose.Schema(
  {
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: "Tender", required: true },
    sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "TenderDocument" },
    text: { type: String, required: true },
    category: { type: String, enum: ["Technical", "HSE", "Compliance"], required: true },
    mandatory: { type: Boolean, default: true },
    extractedBy: { type: String, default: "AI" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TenderRequirement", TenderRequirementSchema);
