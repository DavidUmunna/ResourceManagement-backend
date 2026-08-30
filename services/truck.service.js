const truckRepo = require("../repositories/truck.repository");
const driverRepo = require("../repositories/driver.repository");
const { logComplianceAction } = require("./ComplianceLog.service");
const { TRUCK_TYPES } = require("../constants/skips.constants");

const httpError = (message, status) => Object.assign(new Error(message), { status });
const actorFrom = (user) => ({ id: user?.userId, name: user?.name, role: user?.role, model: "user" });

exports.createTruck = async (user, payload) => {
  if (!payload.regNo) throw httpError("Truck regNo is required", 400);
  if (!TRUCK_TYPES.includes(payload.type)) {
    throw httpError(`Truck type must be one of: ${TRUCK_TYPES.join(", ")}`, 400);
  }

  const truck = await truckRepo.create({
    regNo: payload.regNo,
    rfidTag: payload.rfidTag,
    type: payload.type,
  });

  await logComplianceAction({
    action: "CREATE",
    entityType: "Truck",
    entityModel: "truck",
    entityId: truck._id,
    entityName: truck.regNo,
    actor: actorFrom(user),
    description: `Truck ${truck.regNo} created`,
  });

  return truck;
};

exports.listTrucks = (filter = {}) => truckRepo.findAll(filter);

exports.getTruck = async (id) => {
  const truck = await truckRepo.findById(id);
  if (!truck) throw httpError("Truck not found", 404);
  return truck;
};

exports.updateTruck = async (user, id, payload) => {
  const existing = await truckRepo.findById(id);
  if (!existing) throw httpError("Truck not found", 404);

  const updated = await truckRepo.update(id, payload);

  await logComplianceAction({
    action: "UPDATE",
    entityType: "Truck",
    entityModel: "truck",
    entityId: id,
    entityName: updated.regNo,
    actor: actorFrom(user),
    description: `Truck ${updated.regNo} updated`,
    changedFields: Object.keys(payload || {}),
  });

  return updated;
};

// FR-1: a driver can be (re)assigned to a truck at any time — no lock.
exports.assignDriver = async (user, truckId, driverId) => {
  const truck = await truckRepo.findById(truckId);
  if (!truck) throw httpError("Truck not found", 404);

  const driver = await driverRepo.findById(driverId);
  if (!driver) throw httpError("Driver not found", 404);
  if (driver.active === false) throw httpError("Cannot assign an inactive driver", 400);

  const updated = await truckRepo.update(truckId, { currentDriverId: driverId });

  await logComplianceAction({
    action: "UPDATE",
    entityType: "Truck",
    entityModel: "truck",
    entityId: truckId,
    entityName: truck.regNo,
    actor: actorFrom(user),
    description: `Driver ${driver.name} assigned to truck ${truck.regNo}`,
    changedFields: ["currentDriverId"],
  });

  return updated;
};

// Helper used by the skip-assignment flow (FR-2): a truck can't take a skip leg
// unless it currently has a driver.
exports.hasDriver = (truck) => !!truck?.currentDriverId;
