const mongoose = require("mongoose");

const TenderDocumentSchema = new mongoose.Schema(
  {
    tenderId: { type: mongoose.Schema.Types.ObjectId, ref: "Tender", required: true },
    filename: { type: String, required: true },
    storagePath: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: Number,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    textExtract: String,
    embeddingsRef: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("TenderDocument", TenderDocumentSchema);
