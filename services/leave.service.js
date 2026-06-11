const leaveRepository = require('../repositories/leave.repository');
const User = require('../models/users_');
const { LeaveStatus, ADMIN_ROLES } = require('../constants/leave.constants');

// Count weekdays (Mon–Fri) between two dates inclusive
function computeWorkingDays(start, end) {
  let count = 0;
  const cursor = new Date(start);
  while (cursor <= end) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) count++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return count;
}

exports.createRequest = async (userId, payload) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('USER_NOT_FOUND');

  const start = new Date(payload.startDate);
  const end = new Date(payload.endDate);
  const daysRequested = computeWorkingDays(start, end);
  if (daysRequested < 1) throw new Error('INVALID_DATE_RANGE');

  const year = start.getFullYear();

  if (payload.leaveType !== 'Unpaid') {
    const [balance, policy] = await Promise.all([
      leaveRepository.getOrCreateBalance(userId, year),
      leaveRepository.getPolicy(),
    ]);

    const policyMax = policy[payload.leaveType] ?? 0;
    const { taken } = balance[payload.leaveType];

    // Policy is the hard ceiling — a manually raised balance entitlement cannot exceed it
    if (daysRequested > policyMax) {
      const err = new Error('EXCEEDS_POLICY');
      err.detail = {
        reason: `A single ${payload.leaveType} leave request cannot exceed ${policyMax} working days as set by the organisation policy.`,
        policy: { [payload.leaveType]: policyMax },
        requested: daysRequested,
      };
      throw err;
    }
    if (taken + daysRequested > policyMax) {
      const err = new Error('INSUFFICIENT_BALANCE');
      err.detail = {
        reason: `You have ${taken} day(s) already taken. Requesting ${daysRequested} more would exceed your ${policyMax}-day ${payload.leaveType} entitlement.`,
        policy: { [payload.leaveType]: policyMax },
        taken,
        requested: daysRequested,
        remaining: policyMax - taken,
      };
      throw err;
    }
  }

  const request = await leaveRepository.createRequest({
    user: userId,
    leaveType: payload.leaveType,
    startDate: start,
    endDate: end,
    daysRequested,
    reason: payload.reason,
  });

  return { data: request };
};

exports.getRequests = async (currentUser, query = {}) => {
  const filter = ADMIN_ROLES.includes(currentUser.role) ? {} : { user: currentUser.userId };

  const { status, leaveType, userId, startDate, endDate } = query;

  // Admins can scope to a specific user by ?userId=
  if (userId && ADMIN_ROLES.includes(currentUser.role)) filter.user = userId;
  if (status) filter.status = status;
  if (leaveType) filter.leaveType = leaveType;
  if (startDate || endDate) {
    filter.startDate = {};
    if (startDate) filter.startDate.$gte = new Date(startDate);
    if (endDate)   filter.startDate.$lte = new Date(endDate);
  }

  const requests = await leaveRepository.getAllRequests(filter);
  return { data: requests };
};

exports.getRequestById = async (currentUser, requestId) => {
  const request = await leaveRepository.getRequestById(requestId);
  if (!request) throw new Error('NOT_FOUND');

  const isAdmin = ADMIN_ROLES.includes(currentUser.role);
  const isOwner = request.user._id.toString() === currentUser.userId;
  if (!isAdmin && !isOwner) throw new Error('FORBIDDEN');

  return { data: request };
};

exports.approveRequest = async (currentUser, requestId, adminComment) => {
  if (!ADMIN_ROLES.includes(currentUser.role)) throw new Error('FORBIDDEN');

  const request = await leaveRepository.getRequestById(requestId);
  if (!request) throw new Error('NOT_FOUND');
  if (request.status !== LeaveStatus.PENDING) throw new Error('NOT_PENDING');

  const updated = await leaveRepository.updateRequest(requestId, {
    status: LeaveStatus.APPROVED,
    approvedBy: currentUser.userId,
    approvedAt: new Date(),
    adminComment: adminComment || '',
  });

  const year = new Date(request.startDate).getFullYear();
  await leaveRepository.getOrCreateBalance(request.user._id, year);
  await leaveRepository.incrementTaken(
    request.user._id,
    year,
    request.leaveType,
    request.daysRequested
  );

  // Reflect on-leave status on the user record immediately
  await User.findByIdAndUpdate(request.user._id, { WorkStatus: 'On-Leave' });

  return { data: updated };
};

exports.rejectRequest = async (currentUser, requestId, adminComment) => {
  if (!ADMIN_ROLES.includes(currentUser.role)) throw new Error('FORBIDDEN');

  const request = await leaveRepository.getRequestById(requestId);
  if (!request) throw new Error('NOT_FOUND');
  if (request.status !== LeaveStatus.PENDING) throw new Error('NOT_PENDING');

  const updated = await leaveRepository.updateRequest(requestId, {
    status: LeaveStatus.REJECTED,
    approvedBy: currentUser.userId,
    approvedAt: new Date(),
    adminComment: adminComment || '',
  });

  return { data: updated };
};

exports.cancelRequest = async (currentUser, requestId) => {
  const request = await leaveRepository.getRequestById(requestId);
  if (!request) throw new Error('NOT_FOUND');

  const isAdmin = ADMIN_ROLES.includes(currentUser.role);
  const isOwner = request.user._id.toString() === currentUser.userId;
  if (!isAdmin && !isOwner) throw new Error('FORBIDDEN');
  if (request.status !== LeaveStatus.PENDING) throw new Error('CANNOT_CANCEL');

  const updated = await leaveRepository.updateRequest(requestId, {
    status: LeaveStatus.CANCELLED,
  });

  return { data: updated };
};

exports.getBalance = async (currentUser, targetUserId) => {
  const userId = targetUserId || currentUser.userId;

  const isAdmin = ADMIN_ROLES.includes(currentUser.role);
  if (targetUserId && targetUserId !== currentUser.userId && !isAdmin) {
    throw new Error('FORBIDDEN');
  }

  const year = new Date().getFullYear();
  const balance = await leaveRepository.getOrCreateBalance(userId, year);
  return { data: balance };
};

exports.getPolicy = async () => {
  const policy = await leaveRepository.getPolicy();
  return { data: policy };
};

exports.updatePolicy = async (currentUser, updates) => {
  if (!ADMIN_ROLES.includes(currentUser.role)) throw new Error('FORBIDDEN');
  const policy = await leaveRepository.updatePolicy(updates);
  return { data: policy };
};

exports.updateEntitlement = async (currentUser, targetUserId, leaveType, entitlement) => {
  if (!ADMIN_ROLES.includes(currentUser.role)) throw new Error('FORBIDDEN');

  const user = await User.findById(targetUserId);
  if (!user) throw new Error('USER_NOT_FOUND');

  const year = new Date().getFullYear();
  await leaveRepository.getOrCreateBalance(targetUserId, year);
  const updated = await leaveRepository.setEntitlement(targetUserId, year, leaveType, entitlement);

  return { data: updated };
};
