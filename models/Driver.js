const mongoose = require("mongoose");
const { Schema } = mongoose;

// A driver — a real, queryable entity (replaces free-text driver names on skips).
const DriverSchema = new Schema(
  {
    name: { type: String, required: true },
    rfidTag: { type: String, unique: true, sparse: true },
    licenseNo: { type: String },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("driver", DriverSchema);
