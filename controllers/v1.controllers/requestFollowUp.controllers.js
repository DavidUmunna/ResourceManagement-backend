const service = require("../../services/requestFollowUp.service");

function handleError(res, error, context) {
  const status = error.status || 500;
  if (status === 500) console.error(`requestFollowUp.controller ${context}:`, error);
  return res.status(status).json({ success: false, message: error.message || "Server error" });
}

exports.create = async (req, res) => {
  try {
    const data = await service.createFollowUp(req.user, req.params.id, req.body.note);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "create");
  }
};

exports.listForOrder = async (req, res) => {
  try {
    const data = await service.listForOrder(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "listForOrder");
  }
};

exports.sent = async (req, res) => {
  try {
    const data = await service.listSent(req.user.userId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "sent");
  }
};

exports.received = async (req, res) => {
  try {
    const data = await service.listReceived(req.user.userId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "received");
  }
};

exports.escalatedReceived = async (req, res) => {
  try {
    const data = await service.listEscalatedReceived(req.user.userId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "escalatedReceived");
  }
};
