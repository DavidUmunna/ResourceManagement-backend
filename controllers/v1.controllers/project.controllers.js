const service = require("../../services/project.service");
const revenueService = require("../../services/revenue.service");

function handleError(res, error, context) {
  const status = error.status || 500;
  if (status === 500) console.error(`project.controller ${context}:`, error);
  return res.status(status).json({ success: false, message: error.message || "Server error" });
}

exports.create = async (req, res) => {
  try {
    const data = await service.createProject(req.user, req.body);
    return res.status(201).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "create");
  }
};

exports.list = async (req, res) => {
  try {
    const filter = req.query.active !== undefined ? { active: req.query.active === "true" } : {};
    const data = await service.listProjects(filter);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "list");
  }
};

// Skip revenue rolled up per project (+ totals). Query: ?from=&to= (ISO).
exports.revenue = async (req, res) => {
  try {
    const data = await revenueService.computeRevenue(req.query);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "revenue");
  }
};

exports.getOne = async (req, res) => {
  try {
    const data = await service.getProject(req.params.id);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "getOne");
  }
};

exports.update = async (req, res) => {
  try {
    const data = await service.updateProject(req.user, req.params.id, req.body);
    return res.status(200).json({ success: true, data });
  } catch (e) {
    return handleError(res, e, "update");
  }
};
