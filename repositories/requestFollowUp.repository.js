const RequestFollowUp = require("../models/RequestFollowUp");

exports.create = (data) => RequestFollowUp.create(data);

exports.findByOrder = (orderId) =>
  RequestFollowUp.find({ order: orderId }).sort({ createdAt: -1 }).lean();

// Most recent follow-up by a given user on a given order (cooldown check).
exports.findLatestByUserForOrder = (userId, orderId) =>
  RequestFollowUp.findOne({ order: orderId, requestedBy: userId }).sort({ createdAt: -1 }).lean();

exports.countByOrder = (orderId) => RequestFollowUp.countDocuments({ order: orderId });

// Follow-ups this user SENT (requester dashboard).
exports.findSentByUser = (userId, limit = 50) =>
  RequestFollowUp.find({ requestedBy: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("order", "orderNumber Title status urgency staff")
    .lean();

// Follow-ups this user RECEIVED as a notified approver (approver dashboard).
exports.findReceivedByUser = (userId, limit = 50) =>
  RequestFollowUp.find({ notifiedUserIds: userId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .populate("order", "orderNumber Title status urgency staff")
    .lean();
