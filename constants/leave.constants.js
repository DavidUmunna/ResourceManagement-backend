const LeaveType = {
  ANNUAL: 'Annual',
  SICK: 'Sick',
  MATERNITY: 'Maternity',
  PATERNITY: 'Paternity',
  EMERGENCY: 'Emergency',
  UNPAID: 'Unpaid',
};

const LeaveStatus = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

// Roles that can approve/reject and manage leave entitlements
const ADMIN_ROLES = ['admin', 'global_admin'];

// Default annual entitlement (working days) per leave type
const DEFAULT_ENTITLEMENTS = {
  Annual: 21,
  Sick: 10,
  Maternity: 90,
  Paternity: 5,
  Emergency: 3,
  Unpaid: 0,
};

module.exports = { LeaveType, LeaveStatus, ADMIN_ROLES, DEFAULT_ENTITLEMENTS };
