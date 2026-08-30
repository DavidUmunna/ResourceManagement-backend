const mongoose = require("mongoose");

// Project — an operational job/site that skips are deployed to. Lets staff tell
// which skip belongs to which project without going to the books.
const ProjectSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, unique: true, sparse: true, trim: true }, // short handle, e.g. ACME-RIG7
    client: { type: String, trim: true }, // the IOC being charged
    site: { type: String, trim: true }, // location
    // Daily charge per skip on this project (USD). Revenue = billable days × this.
    dailyRateUsd: { type: Number, default: 0, min: 0 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("project", ProjectSchema);
