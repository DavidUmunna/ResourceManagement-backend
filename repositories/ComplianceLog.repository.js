const ComplianceLog = require("../models/ComplianceLog");

exports.createLog = async (payload) => {
  const log = new ComplianceLog(payload);
  const saved = await log.save();
  return { data: saved };
};

exports.getLogs = async (query = {}, limit = 20, skip = 0) => {
  const [total, logs] = await Promise.all([
    ComplianceLog.countDocuments(query),
    ComplianceLog.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return { total, logs };
};

exports.getLogById = async (id) => {
  const log = await ComplianceLog.findById(id).lean();
  return { data: log };
};
