const mongoose = require("mongoose");

const CompanyDataSchema = new mongoose.Schema({
  CompanyName: {
    type: String,
    required: true,   // was "Required" (capital R) — Mongoose ignores unrecognized keys silently, so this validator was NOT actually enforcing anything
    unique: true,      // you'll want this — prevents two tenants registering the same company name/slug
    trim: true,
  },
  OrganizationStructure: {
    type: String,
    enum: [
      "Hierarchical Structure", "Flat Structure", "Matrix Structure",
      "Divisional Structure", "Team-based Structure", "Network Structure",
      "Process-based",
    ],
  },
  ResourcesToStreamline: [{
    ResourceName: { type: String },
  }],
  WorkFlow: {
    type: String,
    required: true,   // same capitalization bug
  },
  status: {
    type: String,
    enum: ["active", "suspended"],
    default: "active",
  },
}, { timestamps: true }); // was "Timestamp" (wrong key name entirely) — this silently did nothing; you had no createdAt/updatedAt

module.exports = mongoose.model("CompanyData", CompanyDataSchema);