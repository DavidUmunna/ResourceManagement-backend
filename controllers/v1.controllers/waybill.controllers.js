const service = require("../../services/waybill.service");

function handleError(res, error, context) {
  const status = error.status || 500;
  if (status === 500) console.error(`waybill.controller ${context}:`, error);
  return res.status(status).json({ success: false, message: error.message || "Server error" });
}

exports.create = async (req, res) => {
  try {
    const data = await service.createWaybill(req.user, req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "create");
  }
};

exports.list = async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const data = await service.listWaybills(filter);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "list");
  }
};

exports.getOne = async (req, res) => {
  try {
    const data = await service.getWaybill(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "getOne");
  }
};

exports.approve = async (req, res) => {
  try {
    const data = await service.approveWaybill(req.user, req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "approve");
  }
};

exports.reject = async (req, res) => {
  try {
    const data = await service.rejectWaybill(req.user, req.params.id, req.body.reason);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "reject");
  }
};
