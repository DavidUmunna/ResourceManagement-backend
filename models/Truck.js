const mongoose = require("mongoose");
const { Schema } = mongoose;

// A truck — a real, queryable entity. `currentDriverId` is the driver on it
// right now; a leg's scan credits whoever is current at scan time (FR-6).
const TruckSchema = new Schema(
  {
    regNo: { type: String, required: true, unique: true },
    rfidTag: { type: String, unique: true, sparse: true },
    type: { type: String, enum: ["delivery", "waste"], required: true },
    currentDriverId: { type: Schema.Types.ObjectId, ref: "driver" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("truck", TruckSchema);
