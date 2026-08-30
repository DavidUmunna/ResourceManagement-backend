const driverRepo = require("../repositories/driver.repository");
const { logComplianceAction } = require("./ComplianceLog.service");

const httpError = (message, status) => Object.assign(new Error(message), { status });
const actorFrom = (user) => ({ id: user?.userId, name: user?.name, role: user?.role, model: "user" });

exports.createDriver = async (user, payload) => {
  if (!payload.name) throw httpError("Driver name is required", 400);

  const driver = await driverRepo.create({
    name: payload.name,
    rfidTag: payload.rfidTag,
    licenseNo: payload.licenseNo,
  });

  await logComplianceAction({
    action: "CREATE",
    entityType: "Driver",
    entityModel: "driver",
    entityId: driver._id,
    entityName: driver.name,
    actor: actorFrom(user),
    description: `Driver ${driver.name} created`,
  });

  return driver;
};

exports.listDrivers = (filter = {}) => driverRepo.findAll(filter);

exports.getDriver = async (id) => {
  const driver = await driverRepo.findById(id);
  if (!driver) throw httpError("Driver not found", 404);
  return driver;
};

exports.updateDriver = async (user, id, payload) => {
  const existing = await driverRepo.findById(id);
  if (!existing) throw httpError("Driver not found", 404);

  const updated = await driverRepo.update(id, payload);

  await logComplianceAction({
    action: "UPDATE",
    entityType: "Driver",
    entityModel: "driver",
    entityId: id,
    entityName: updated.name,
    actor: actorFrom(user),
    description: `Driver ${updated.name} updated`,
    changedFields: Object.keys(payload || {}),
  });

  return updated;
};
