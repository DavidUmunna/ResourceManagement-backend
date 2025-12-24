const mongoose = require("mongoose");

const CompanyDocumentSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    type: {
      type: String,
      enum: ["PastTender", "CV", "Certification", "Manual", "Other"],
      default: "Other",
    },
    version: String,
    tags: [String],
    validFrom: Date,
    validTo: Date,
    storagePath: String,
    mimeType: String,
    textExtract: String,
    embeddingsRef: String,
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
  },
  { timestamps: true }
);

module.exports = mongoose.model("CompanyDocument", CompanyDocumentSchema);
