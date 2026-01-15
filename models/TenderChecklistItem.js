const mongoose = require("mongoose");

const TenderChecklistItemSchema = new mongoose.Schema(
  {
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: "Tender", required: true },
    sourceDocumentId: { type: mongoose.Schema.Types.ObjectId, ref: "TenderDocument" },
    title: { type: String, required: true },
    category: { type: String, default: "General" },
    status: {
      type: String,
      enum: ["Not Started", "In Progress", "Complete"],
      default: "Not Started",
    },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    extractedBy: { type: String, default: "AI" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("TenderChecklistItem", TenderChecklistItemSchema);
