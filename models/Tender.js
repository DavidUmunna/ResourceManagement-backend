const mongoose = require("mongoose");

const TenderSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    client: { type: String, required: true },
    deadline: { type: Date, required: true },
    status: {
      type: String,
      enum: ["Draft", "In Progress", "Submitted", "Closed"],
      default: "Draft",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "user" },
    metadata: { type: mongoose.Schema.Types.Mixed },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Tender", TenderSchema);
