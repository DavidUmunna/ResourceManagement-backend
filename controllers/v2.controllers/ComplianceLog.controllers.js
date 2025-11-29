const ComplianceLogService = require("../../services/ComplianceLog.service");
const { getPagination, getPagingData } = require("../../Global_Functions/pagination");

exports.createComplianceLog = async (req, res) => {
  try {
    const user = req.user;
    const {
      action,
      entityId,
      entityName,
      entityType,
      description,
      changedFields,
      statusBefore,
      statusAfter,
      metadata,
    } = req.body;

    if (!action || !entityId) {
      return res.status(400).json({ success: false, message: "action and entityId are required" });
    }

    const payload = {
      action,
      entityId,
      entityName,
      entityType,
      description,
      changedFields,
      statusBefore,
      statusAfter,
      metadata,
    };

    const serviceResponse = await ComplianceLogService.logAction(user, payload);
    return res.status(201).json({ success: true, data: serviceResponse.data });
  } catch (error) {
    console.error("Error creating compliance log:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getComplianceLogs = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req, 20);
    const filters = {
      action: req.query.action,
      entityId: req.query.entityId,
      entityType: req.query.entityType,
      performedBy: req.query.performedBy,
    };

    const serviceResponse = await ComplianceLogService.getLogs(filters, { limit, skip });

    return res
      .status(200)
      .json({
        success: true,
        data: serviceResponse.data,
        pagination: getPagingData(serviceResponse.total, page, limit),
      });
  } catch (error) {
    console.error("Error fetching compliance logs:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};

exports.getComplianceLogById = async (req, res) => {
  try {
    const { id } = req.params;
    const serviceResponse = await ComplianceLogService.getLogById(id);

    if (!serviceResponse.data) {
      return res.status(404).json({ success: false, message: "Compliance log not found" });
    }

    return res.status(200).json({ success: true, data: serviceResponse.data });
  } catch (error) {
    console.error("Error fetching compliance log by id:", error);
    return res.status(500).json({ success: false, message: "Server Error" });
  }
};
