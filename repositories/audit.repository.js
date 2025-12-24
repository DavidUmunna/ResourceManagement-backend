const AuditLog = require("../models/AuditLog");

module.exports = {
  log: (actor, action, entity, entityId, metadata = {}) =>
    AuditLog.create({ actor, action, entity, entityId, metadata }),
};
