const service = require("../../services/skip.service");

function handleError(res, error, context) {
  const status = error.status || 500;
  if (status === 500) console.error(`skip.controller ${context}:`, error);
  return res.status(status).json({ success: false, message: error.message || "Server error" });
}

exports.list = async (req, res) => {
  try {
    const data = await service.listSkips(req.query);
    return res.status(200).json({ success: true, ...data });
  } catch (e) {
    return handleError(res, e, "list");
  }
};

exports.getOne = async (req, res) => {
  try {
    const data = await service.getSkipDetail(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "getOne");
  }
};

exports.registerTag = async (req, res) => {
  try {
    const data = await service.registerTag(req.user, req.params.id, req.body.rfidTag);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "registerTag");
  }
};

exports.assignDeliveryTruck = async (req, res) => {
  try {
    const data = await service.assignDeliveryTruck(req.user, req.params.id, req.body.truckId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "assignDeliveryTruck");
  }
};

exports.assignCollectionTruck = async (req, res) => {
  try {
    const data = await service.assignCollectionTruck(req.user, req.params.id, req.body.truckId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "assignCollectionTruck");
  }
};

// RFID gate scan — body: { skipTag, scanType }
exports.scan = async (req, res) => {
  try {
    const data = await service.scan(req.user, req.body);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "scan");
  }
};

// Manual fallback scan — body: { skip_id, scanType, reason }
exports.manualScan = async (req, res) => {
  try {
    const data = await service.manualScan(req.user, req.body);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "manualScan");
  }
};

// Set/clear the per-skip daily rate override — body: { dailyRateUsd }
exports.setRate = async (req, res) => {
  try {
    const data = await service.setRate(req.user, req.params.id, req.body.dailyRateUsd);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "setRate");
  }
};

// Assign/clear the skip's project — body: { projectId }
exports.setProject = async (req, res) => {
  try {
    const data = await service.setProject(req.user, req.params.id, req.body.projectId);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "setProject");
  }
};

// Set/clear rental info — body: { ownership, rentedFromCompany, projectRef, rentalStart, rentalExpectedEnd }
exports.setRental = async (req, res) => {
  try {
    const data = await service.setRental(req.user, req.params.id, req.body);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "setRental");
  }
};

exports.returnSkip = async (req, res) => {
  try {
    const data = await service.returnSkip(req.user, req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "returnSkip");
  }
};
