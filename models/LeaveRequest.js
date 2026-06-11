const { Schema, model } = require('mongoose');
const { LeaveType, LeaveStatus } = require('../constants/leave.constants');

const LeaveRequestSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'user', required: true },
    leaveType: { type: String, enum: Object.values(LeaveType), required: true },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    daysRequested: { type: Number, required: true, min: 1 },
    reason: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: Object.values(LeaveStatus),
      default: LeaveStatus.PENDING,
    },
    approvedBy: { type: Schema.Types.ObjectId, ref: 'user', default: null },
    approvedAt: { type: Date, default: null },
    adminComment: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = model('LeaveRequest', LeaveRequestSchema);
