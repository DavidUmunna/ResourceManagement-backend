const service = require("../../services/truck.service");

function handleError(res, error, context) {
  const status = error.status || 500;
  if (status === 500) console.error(`truck.controller ${context}:`, error);
  return res.status(status).json({ success: false, message: error.message || "Server error" });
}

exports.create = async (req, res) => {
  try {
    const data = await service.createTruck(req.user, req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "create");
  }
};

exports.list = async (req, res) => {
  try {
    const filter = req.query.active !== undefined ? { active: req.query.active === "true" } : {};
    const data = await service.listTrucks(filter);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "list");
  }
};

exports.getOne = async (req, res) => {
  try {
    const data = await service.getTruck(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "getOne");
  }
};

exports.update = async (req, res) => {
  try {
    const data = await service.updateTruck(req.user, req.params.id, req.body);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "update");
  }
};

exports.assignDriver = async (req, res) => {
  try {
    if (!req.body.driverId) {
      return res.status(400).json({ success: false, message: "driverId is required" });
    }
    const data = await service.assignDriver(req.user, req.params.id, req.body.driverId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "assignDriver");
  }
};
