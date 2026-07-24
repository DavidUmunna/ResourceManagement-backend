const BaseValidator = require('./BaseValidator');
const { LeaveType } = require('../../constants/leave.constants');

const VALID_LEAVE_TYPES = Object.values(LeaveType);

class LeaveValidator extends BaseValidator {
  validateRequest(data) {
    const errors = [];

    if (!data.leaveType || !VALID_LEAVE_TYPES.includes(data.leaveType)) {
      errors.push(`Invalid leave type. Must be one of: ${VALID_LEAVE_TYPES.join(', ')}`);
    }

    const startErr = this.validateRequired(data.startDate, 'Start date');
    if (startErr) errors.push(startErr);

    const endErr = this.validateRequired(data.endDate, 'End date');
    if (endErr) errors.push(endErr);

    const reasonErr = this.validateRequired(data.reason, 'Reason');
    if (reasonErr) errors.push(reasonErr);
    else {
      const reasonMinErr = this.validateMinLength(data.reason, 10, 'Reason');
      if (reasonMinErr) errors.push(reasonMinErr);
      const reasonMaxErr = this.validateMaxLength(data.reason, 500, 'Reason');
      if (reasonMaxErr) errors.push(reasonMaxErr);
    }

    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      if (isNaN(start.getTime())) {
        errors.push('Start date is not a valid date');
      } else if (isNaN(end.getTime())) {
        errors.push('End date is not a valid date');
      } else if (end < start) {
        errors.push('End date must be on or after start date');
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (start < today) errors.push('Start date cannot be in the past');
      }
    }

    return { isValid: errors.length === 0, errors };
  }

  validateEntitlementUpdate(data) {
    const errors = [];

    if (!data.leaveType || !VALID_LEAVE_TYPES.includes(data.leaveType)) {
      errors.push(`Invalid leave type. Must be one of: ${VALID_LEAVE_TYPES.join(', ')}`);
    }

    if (data.entitlement === undefined || data.entitlement === null) {
      errors.push('Entitlement is required');
    } else if (typeof data.entitlement !== 'number' || !Number.isFinite(data.entitlement)) {
      errors.push('Entitlement must be a number');
    } else if (data.entitlement < 0) {
      errors.push('Entitlement must be 0 or greater');
    }

    return { isValid: errors.length === 0, errors };
  }
}

module.exports = { LeaveValidator };
