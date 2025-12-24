const mongoose = require("mongoose");

const TenderDraftSchema = new mongoose.Schema(
  {
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: "Tender", required: true },
    section: {
      type: String,
      enum: ["TechnicalMethodology", "ExecutionPlan", "HSEApproach"],
      required: true,
    },
    content: { type: String, required: true },
    references: [String],
    generatedBy: { type: String, default: "AI" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TenderDraft", TenderDraftSchema);
