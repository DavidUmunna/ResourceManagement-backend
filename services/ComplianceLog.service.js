const ComplianceLogRepository = require("../repositories/ComplianceLog.repository");
const Users = require("../models/users_");

exports.logAction = async (user, payload) => {
  const actor = await Users.findById(user.userId).lean();

  const logPayload = {
    ...payload,
    performedBy: actor?._id,
    performedByName: actor?.name,
    performedByRole: actor?.role,
  };

  const repositoryResponse = await ComplianceLogRepository.createLog(logPayload);
  return { data: repositoryResponse.data };
};

exports.getLogs = async (filters, pagination) => {
  const { limit, skip } = pagination;

  const query = {};
  if (filters.action) query.action = filters.action;
  if (filters.entityId) query.entityId = filters.entityId;
  if (filters.entityType) query.entityType = filters.entityType;
  if (filters.performedBy) query.performedBy = filters.performedBy;

  const repositoryResponse = await ComplianceLogRepository.getLogs(query, limit, skip);
  return { data: repositoryResponse.logs, total: repositoryResponse.total };
};

exports.getLogById = async (id) => {
  const repositoryResponse = await ComplianceLogRepository.getLogById(id);
  return { data: repositoryResponse.data };
};
