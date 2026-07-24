const { Schema, model } = require('mongoose');
const { DEFAULT_ENTITLEMENTS } = require('../constants/leave.constants');

// Single-document collection — one policy record for the whole organisation.
// Seed defaults from constants so the system works even before an admin configures it.
const LeavePolicySchema = new Schema(
  {
    Annual:    { type: Number, default: DEFAULT_ENTITLEMENTS.Annual,    min: 0 },
    Sick:      { type: Number, default: DEFAULT_ENTITLEMENTS.Sick,      min: 0 },
    Maternity: { type: Number, default: DEFAULT_ENTITLEMENTS.Maternity, min: 0 },
    Paternity: { type: Number, default: DEFAULT_ENTITLEMENTS.Paternity, min: 0 },
    Emergency: { type: Number, default: DEFAULT_ENTITLEMENTS.Emergency, min: 0 },
    Unpaid:    { type: Number, default: 0,                              min: 0 },
  },
  { timestamps: true }
);

module.exports = model('LeavePolicy', LeavePolicySchema);
