const leaveService = require('../../services/leave.service');
const { LeaveValidator } = require('../../services/validation/LeaveValidator');

const validator = new LeaveValidator();

const ERROR_MAP = {
  USER_NOT_FOUND: [404, 'User not found'],
  NOT_FOUND: [404, 'Leave request not found'],
  FORBIDDEN: [403, 'Access denied'],
  INSUFFICIENT_BALANCE: [400, 'Insufficient leave balance for the requested period'],
  EXCEEDS_POLICY: [400, 'Requested days exceed the organisation policy limit for this leave type'],
  INVALID_DATE_RANGE: [400, 'Date range produces zero working days'],
  NOT_PENDING: [400, 'Request is not in Pending status'],
  CANNOT_CANCEL: [400, 'Only pending requests can be cancelled'],
};

function handleError(res, error, context) {
  const mapped = ERROR_MAP[error.message];
  if (mapped) {
    const body = { success: false, message: mapped[1] };
    if (error.detail) body.detail = error.detail;
    return res.status(mapped[0]).json(body);
  }
  console.error(`leave.controller ${context}:`, error);
  return res.status(500).json({ success: false, message: 'Server error' });
}

exports.createRequest = async (req, res) => {
  try {
    const validation = validator.validateRequest(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }
    const result = await leaveService.createRequest(req.user.userId, req.body);
    return res.status(201).json({ success: true, data: result.data });
  } catch (error) {
    return handleError(res, error, 'createRequest');
  }
};

exports.getRequests = async (req, res) => {
  try {
    const result = await leaveService.getRequests(req.user, req.query);
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return handleError(res, error, 'getRequests');
  }
};

exports.getRequestById = async (req, res) => {
  try {
    const result = await leaveService.getRequestById(req.user, req.params.id);
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return handleError(res, error, 'getRequestById');
  }
};

exports.approveRequest = async (req, res) => {
  try {
    const result = await leaveService.approveRequest(
      req.user,
      req.params.id,
      req.body.adminComment
    );
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return handleError(res, error, 'approveRequest');
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const result = await leaveService.rejectRequest(
      req.user,
      req.params.id,
      req.body.adminComment
    );
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return handleError(res, error, 'rejectRequest');
  }
};

exports.cancelRequest = async (req, res) => {
  try {
    const result = await leaveService.cancelRequest(req.user, req.params.id);
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return handleError(res, error, 'cancelRequest');
  }
};

exports.getBalance = async (req, res) => {
  try {
    const result = await leaveService.getBalance(req.user, req.params.userId);
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return handleError(res, error, 'getBalance');
  }
};

exports.getPolicy = async (req, res) => {
  try {
    const result = await leaveService.getPolicy();
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return handleError(res, error, 'getPolicy');
  }
};

exports.updatePolicy = async (req, res) => {
  try {
    const allowed = ['Annual', 'Sick', 'Maternity', 'Paternity', 'Emergency', 'Unpaid'];
    const updates = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const val = Number(req.body[key]);
        if (!Number.isFinite(val) || val < 0) {
          return res.status(400).json({ success: false, message: `${key} must be a non-negative number` });
        }
        updates[key] = val;
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid leave type values provided' });
    }
    const result = await leaveService.updatePolicy(req.user, updates);
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return handleError(res, error, 'updatePolicy');
  }
};

exports.updateEntitlement = async (req, res) => {
  try {
    const validation = validator.validateEntitlementUpdate(req.body);
    if (!validation.isValid) {
      return res.status(400).json({ success: false, errors: validation.errors });
    }
    const { leaveType, entitlement } = req.body;
    const result = await leaveService.updateEntitlement(
      req.user,
      req.params.userId,
      leaveType,
      entitlement
    );
    return res.status(200).json({ success: true, data: result.data });
  } catch (error) {
    return handleError(res, error, 'updateEntitlement');
  }
};
