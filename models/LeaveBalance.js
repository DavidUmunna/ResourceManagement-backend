const { Schema, model } = require('mongoose');
const { DEFAULT_ENTITLEMENTS } = require('../constants/leave.constants');

const leaveTypeBlock = (defaultEntitlement) => ({
  entitlement: { type: Number, default: defaultEntitlement, min: 0 },
  taken: { type: Number, default: 0, min: 0 },
});

const LeaveBalanceSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'user', required: true },
    year: { type: Number, required: true },
    Annual: leaveTypeBlock(DEFAULT_ENTITLEMENTS.Annual),
    Sick: leaveTypeBlock(DEFAULT_ENTITLEMENTS.Sick),
    Maternity: leaveTypeBlock(DEFAULT_ENTITLEMENTS.Maternity),
    Paternity: leaveTypeBlock(DEFAULT_ENTITLEMENTS.Paternity),
    Emergency: leaveTypeBlock(DEFAULT_ENTITLEMENTS.Emergency),
    Unpaid: leaveTypeBlock(0),
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

LeaveBalanceSchema.index({ user: 1, year: 1 }, { unique: true });

// Computes balance (entitlement - taken) for each type without storing it
LeaveBalanceSchema.virtual('summary').get(function () {
  return ['Annual', 'Sick', 'Maternity', 'Paternity', 'Emergency', 'Unpaid'].reduce(
    (acc, type) => {
      acc[type] = {
        entitlement: this[type].entitlement,
        taken: this[type].taken,
        balance: this[type].entitlement - this[type].taken,
      };
      return acc;
    },
    {}
  );
});

module.exports = model('LeaveBalance', LeaveBalanceSchema);
