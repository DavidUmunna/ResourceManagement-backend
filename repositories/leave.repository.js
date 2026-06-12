const LeaveRequest = require('../models/LeaveRequest');
const LeaveBalance = require('../models/LeaveBalance');
const LeavePolicy = require('../models/LeavePolicy');
const { DEFAULT_ENTITLEMENTS } = require('../constants/leave.constants');

const REQUEST_POPULATE = [
  { path: 'user', select: 'name email Department WorkStatus' },
  { path: 'approvedBy', select: 'name email' },
];

exports.createRequest = async (payload) => {
  const doc = new LeaveRequest(payload);
  const saved = await doc.save();
  return saved.populate(REQUEST_POPULATE);
};

exports.getRequestById = async (id) => {
  return LeaveRequest.findById(id).populate(REQUEST_POPULATE);
};

exports.getAllRequests = async (filter = {}, { skip, limit } = {}) => {
  const q = LeaveRequest.find(filter).sort({ createdAt: -1 }).populate(REQUEST_POPULATE);
  if (skip)  q.skip(skip);
  if (limit) q.limit(limit);
  return q;
};

exports.countRequests = async (filter = {}) => LeaveRequest.countDocuments(filter);

exports.updateRequest = async (id, update) => {
  return LeaveRequest.findByIdAndUpdate(id, update, { new: true, runValidators: true }).populate(
    REQUEST_POPULATE
  );
};

exports.deleteRequest = async (id) => {
  return LeaveRequest.findByIdAndDelete(id);
};

exports.getOrCreateBalance = async (userId, year) => {
  let balance = await LeaveBalance.findOne({ user: userId, year });
  if (!balance) {
    // Seed entitlements from the live policy; fall back to hardcoded defaults if no policy exists yet
    const policy = await LeavePolicy.findOne().lean();
    const p = policy || DEFAULT_ENTITLEMENTS;
    balance = await LeaveBalance.create({
      user: userId,
      year,
      Annual:    { entitlement: p.Annual,    taken: 0 },
      Sick:      { entitlement: p.Sick,      taken: 0 },
      Maternity: { entitlement: p.Maternity, taken: 0 },
      Paternity: { entitlement: p.Paternity, taken: 0 },
      Emergency: { entitlement: p.Emergency, taken: 0 },
      Unpaid:    { entitlement: p.Unpaid ?? 0, taken: 0 },
    });
  }
  return balance;
};

// Returns the single policy document, creating it with defaults if it doesn't exist yet
exports.getPolicy = async () => {
  let policy = await LeavePolicy.findOne();
  if (!policy) policy = await LeavePolicy.create({});
  return policy;
};

exports.updatePolicy = async (updates) => {
  let policy = await LeavePolicy.findOne();
  if (!policy) policy = new LeavePolicy({});
  Object.assign(policy, updates);
  await policy.save();
  return policy;
};

exports.getBalanceByUser = async (userId, year) => {
  return LeaveBalance.findOne({ user: userId, year }).populate('user', 'name email Department WorkStatus');
};

// Increment or decrement `taken` for a leave type (use positive delta to add, negative to refund)
exports.incrementTaken = async (userId, year, leaveType, delta) => {
  return LeaveBalance.findOneAndUpdate(
    { user: userId, year },
    { $inc: { [`${leaveType}.taken`]: delta } },
    { new: true }
  );
};

exports.setEntitlement = async (userId, year, leaveType, entitlement) => {
  return LeaveBalance.findOneAndUpdate(
    { user: userId, year },
    { $set: { [`${leaveType}.entitlement`]: entitlement } },
    { new: true, upsert: true }
  );
};
