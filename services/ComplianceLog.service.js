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

/**
 * Central compliance logger for the generalized (polymorphic) entities/actors.
 * Actor can be a staff User or a third-party SiteApprover.
 * Compliance logging must never break the primary action — failures are swallowed.
 *
 * @param {Object} p
 * @param {"CREATE"|"UPDATE"|"DELETE"} p.action
 * @param {string} p.entityType  e.g. "Truck"
 * @param {string} p.entityModel e.g. "truck"
 * @param {import("mongoose").Types.ObjectId|string} p.entityId
 * @param {string} [p.entityName]
 * @param {{id:any,name?:string,role?:string,model?:"user"|"siteapprover"}} p.actor
 * @param {string} [p.description]
 * @param {string[]} [p.changedFields]
 * @param {string} [p.statusBefore]
 * @param {string} [p.statusAfter]
 * @param {Object} [p.metadata]
 */
exports.logComplianceAction = async ({
  action,
  entityType,
  entityModel,
  entityId,
  entityName,
  actor = {},
  description,
  changedFields,
  statusBefore,
  statusAfter,
  metadata,
}) => {
  try {
    const res = await ComplianceLogRepository.createLog({
      action,
      entityType,
      entityModel,
      entityId,
      entityName,
      performedBy: actor.id,
      performedByModel: actor.model || "user",
      performedByName: actor.name,
      performedByRole: actor.role,
      description,
      changedFields,
      statusBefore,
      statusAfter,
      metadata,
    });
    return res.data;
  } catch (err) {
    console.error("logComplianceAction failed:", err.message);
    return null;
  }
};
