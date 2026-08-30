const skipRepo = require("../repositories/skip.repository");
const truckRepo = require("../repositories/truck.repository");
const { logComplianceAction } = require("./ComplianceLog.service");
const { notifyIssue } = require("./NotificationService");
const {
  SCAN_TYPES,
  MANUAL_SCAN_ROLES,
  ISSUE_EVENTS,
} = require("../constants/skips.constants");

const httpError = (message, status) => Object.assign(new Error(message), { status });
const actorFrom = (user) => ({ id: user?.userId, name: user?.name, role: user?.role, model: "user" });

// entityModel "skip" per spec §5.7 enum. NB: the existing skip model is registered
// as "Skipstracking", so a polymorphic .populate("entityId") on a skip log won't
// resolve — we always store entityName, and no FR requires populating the entity.
const logSkip = (skip, opts) =>
  logComplianceAction({
    entityType: "Skip",
    entityModel: "skip",
    entityId: skip._id,
    entityName: skip.skip_id,
    ...opts,
  });

/**
 * List skips for the ERP module. Supports search, waste-stream/ownership/active
 * filters, a coarse lifecycle `stage` filter, and pagination.
 *   stage: "unmobilized" (no DateMobilized) — used by waybill creation
 *          "demobilized" (DemobilizationOfFilledSkips set) — used by manifest creation
 */
exports.listSkips = async (query = {}) => {
  const filter = {};
  if (query.wasteStream) filter.WasteStream = query.wasteStream;
  if (query.ownership) filter.ownership = query.ownership;
  if (query.active !== undefined && query.active !== "") filter.active = query.active === "true" || query.active === true;
  if (query.search) filter.skip_id = { $regex: String(query.search).trim(), $options: "i" };
  if (query.stage === "unmobilized") filter.DateMobilized = { $in: [null, undefined] };
  if (query.stage === "demobilized") filter.DemobilizationOfFilledSkips = { $ne: null };
  if (query.project) filter.projectId = query.project;

  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    skipRepo.findMany(filter, { skip, limit }),
    skipRepo.count(filter),
  ]);
  return { items, pagination: { page, limit, total, pages: Math.ceil(total / limit) } };
};

exports.getSkipDetail = async (id) => {
  const skip = await skipRepo.findById(id); // populated trucks(+drivers), waybill
  if (!skip) throw httpError("Skip not found", 404);
  return skip;
};

/**
 * FR-7 / FR-8 — bind an RFID tag to a physical skip. A tag may only be bound to
 * one ACTIVE skip at a time; a conflict is rejected (409) and raises an issue.
 */
exports.registerTag = async (user, skipId, rfidTag) => {
  if (!rfidTag || !String(rfidTag).trim()) throw httpError("rfidTag is required", 400);
  const tag = String(rfidTag).trim();

  const skip = await skipRepo.findByIdRaw(skipId);
  if (!skip) throw httpError("Skip not found", 404);

  const conflict = await skipRepo.findTagConflict(tag, skipId);
  if (conflict) {
    await notifyIssue({
      event: ISSUE_EVENTS.TAG_CONFLICT,
      title: ISSUE_EVENTS.TAG_CONFLICT,
      message: `Tag ${tag} is already bound to active skip ${conflict.skip_id}.`,
      context: { tag, attemptedSkip: skip.skip_id, boundSkip: conflict.skip_id },
    });
    throw httpError(`RFID tag already bound to active skip ${conflict.skip_id}`, 409);
  }

  const updated = await skipRepo.update(skipId, { rfidTag: tag });
  await logSkip(updated, {
    action: "UPDATE",
    actor: actorFrom(user),
    description: `RFID tag ${tag} registered to skip ${updated.skip_id}`,
    changedFields: ["rfidTag"],
  });
  return updated;
};

// Shared assignment logic for both legs (FR-2 / FR-5).
async function assignTruck(user, skipId, truckId, leg) {
  const cfg = leg === "delivery"
    ? { truckType: "delivery", blockField: "DateMobilized", blockMsg: "already mobilized",
        idField: "assignedDeliveryTruckId", atField: "assignedDeliveryAssignedAt" }
    : { truckType: "waste", blockField: "DemobilizationOfFilledSkips", blockMsg: "already demobilized",
        idField: "assignedCollectionTruckId", atField: "assignedCollectionAssignedAt" };

  if (!truckId) throw httpError("truckId is required", 400);

  const skip = await skipRepo.findByIdRaw(skipId);
  if (!skip) throw httpError("Skip not found", 404);

  // FR-5: no reassignment once that leg's scan has happened.
  if (skip[cfg.blockField]) {
    throw httpError(`Skip is ${cfg.blockMsg}; cannot reassign its ${leg} truck`, 400);
  }

  const truck = await truckRepo.findById(truckId); // populates currentDriverId
  if (!truck) throw httpError("Truck not found", 404);
  if (truck.type !== cfg.truckType) {
    throw httpError(`A ${cfg.truckType} truck is required for the ${leg} leg`, 400);
  }
  // FR-2: a truck cannot take a skip leg unless it currently has a driver.
  if (!truck.currentDriverId) {
    throw httpError(`Truck ${truck.regNo} has no driver assigned; assign a driver first (FR-2)`, 400);
  }

  const updated = await skipRepo.update(skipId, {
    [cfg.idField]: truckId,
    [cfg.atField]: new Date(),
  });
  await logSkip(updated, {
    action: "UPDATE",
    actor: actorFrom(user),
    description: `${cfg.truckType} truck ${truck.regNo} assigned to skip ${updated.skip_id} (${leg} leg)`,
    changedFields: [cfg.idField],
  });
  return updated;
}

exports.assignDeliveryTruck = (user, skipId, truckId) => assignTruck(user, skipId, truckId, "delivery");
exports.assignCollectionTruck = (user, skipId, truckId) => assignTruck(user, skipId, truckId, "collection");

// Build the field update for a scan leg, enforcing preconditions. `method` is
// "rfid" (gate) or "manual" (supervisor override); preconditions are identical —
// only capture method differs. Credits the on-duty driver at scan time (FR-6).
function buildScanUpdate(skip, scanType, method, manualReason) {
  if (!SCAN_TYPES.includes(scanType)) {
    throw httpError(`scanType must be one of: ${SCAN_TYPES.join(", ")}`, 400);
  }
  const now = new Date();

  if (scanType === "mobilize") {
    // FR-17e: a skip may only be mobilized under an APPROVED waybill.
    const waybill = skip.waybillId;
    if (!waybill) throw httpError("Skip is not attached to a waybill; cannot mobilize (FR-17e)", 400);
    if (waybill.status !== "approved") {
      throw httpError(`Skip's waybill is "${waybill.status}", not approved; cannot mobilize (FR-17e)`, 400);
    }
    const truck = skip.assignedDeliveryTruckId;
    if (!truck) throw httpError("Skip has no delivery truck assigned; cannot mobilize (FR-11)", 400);
    const driver = truck.currentDriverId;
    if (!driver) throw httpError("Assigned delivery truck has no driver; cannot mobilize (FR-2)", 400);
    return {
      DateMobilized: now,
      SkipsTruckRegNo: truck.regNo,
      SkipsTruckDriver: driver.name || String(driver),
      mobilizeScanMethod: method,
      ...(method === "manual" ? { mobilizeManualReason: manualReason } : {}),
    };
  }

  // demobilize
  const truck = skip.assignedCollectionTruckId;
  if (!truck) throw httpError("Skip has no collection truck assigned; cannot demobilize (FR-11)", 400);
  const driver = truck.currentDriverId;
  if (!driver) throw httpError("Assigned collection truck has no driver; cannot demobilize (FR-2)", 400);
  return {
    DemobilizationOfFilledSkips: now,
    WasteTruckRegNo: truck.regNo,
    WasteTruckDriverName: driver.name || String(driver),
    demobilizeScanMethod: method,
    ...(method === "manual" ? { demobilizeManualReason: manualReason } : {}),
  };
}

/**
 * FR-9 / FR-11 / FR-12 / FR-6 — RFID gate scan. Resolves the ACTIVE skip bound to
 * the tag, applies the mobilize/demobilize update, credits the on-duty driver.
 */
exports.scan = async (user, { skipTag, scanType }) => {
  if (!skipTag) throw httpError("skipTag is required", 400);

  const skip = await skipRepo.findActiveByTag(String(skipTag).trim());
  if (!skip) throw httpError("No active skip is bound to that RFID tag", 404);

  const update = buildScanUpdate(skip, scanType, "rfid");
  const updated = await skipRepo.update(skip._id, update);
  await logSkip(updated, {
    action: "SCAN",
    actor: actorFrom(user),
    description: `RFID ${scanType} scan on skip ${updated.skip_id}`,
    metadata: { scanType, method: "rfid" },
  });
  return updated;
};

/**
 * FR-10 — manual fallback scan when the RFID gate fails. Restricted to
 * MANUAL_SCAN_ROLES, requires a reason, and raises a consolidated issue.
 */
exports.manualScan = async (user, { skip_id, scanType, reason }) => {
  if (!MANUAL_SCAN_ROLES.includes(user?.role)) {
    throw httpError("You are not authorized to perform a manual scan", 403);
  }
  if (!reason || !String(reason).trim()) throw httpError("A reason is required for a manual scan", 400);
  if (!skip_id) throw httpError("skip_id is required", 400);

  const skip = await skipRepo.findById(skip_id);
  if (!skip) throw httpError("Skip not found", 404);
  if (skip.active === false) throw httpError("Skip is not active", 400);

  const update = buildScanUpdate(skip, scanType, "manual", String(reason).trim());
  const updated = await skipRepo.update(skip._id, update);

  await logSkip(updated, {
    action: "MANUAL_SCAN",
    actor: actorFrom(user),
    description: `Manual ${scanType} scan on skip ${updated.skip_id}: ${reason}`,
    metadata: { scanType, method: "manual", reason },
  });
  await notifyIssue({
    event: ISSUE_EVENTS.MANUAL_SCAN,
    title: ISSUE_EVENTS.MANUAL_SCAN,
    message: `${user?.name || "A user"} recorded a manual ${scanType} scan on skip ${updated.skip_id}.`,
    context: { skip: updated.skip_id, scanType, reason, by: user?.name, role: user?.role },
  });
  return updated;
};

/**
 * Set (or clear, with null) a per-skip daily rate override. When set, revenue for
 * this skip uses this rate instead of its project's rate.
 */
exports.setRate = async (user, skipId, rate) => {
  const skip = await skipRepo.findByIdRaw(skipId);
  if (!skip) throw httpError("Skip not found", 404);

  const value = rate === null || rate === "" || rate === undefined ? null : Number(rate);
  if (value !== null && (Number.isNaN(value) || value < 0)) throw httpError("Rate must be a non-negative number", 400);

  const updated = await skipRepo.update(skipId, { dailyRateUsdOverride: value });
  await logSkip(updated, {
    action: "UPDATE",
    actor: actorFrom(user),
    description: value === null ? `Skip ${updated.skip_id} rate override cleared` : `Skip ${updated.skip_id} daily rate override set to $${value}`,
    changedFields: ["dailyRateUsdOverride"],
  });
  return updated;
};

/**
 * Assign (or clear, with null) the operational project a skip is deployed to.
 */
exports.setProject = async (user, skipId, projectId) => {
  const skip = await skipRepo.findByIdRaw(skipId);
  if (!skip) throw httpError("Skip not found", 404);

  const updated = await skipRepo.update(skipId, { projectId: projectId || null });
  await logSkip(updated, {
    action: "UPDATE",
    actor: actorFrom(user),
    description: projectId ? `Skip ${updated.skip_id} assigned to a project` : `Skip ${updated.skip_id} project cleared`,
    changedFields: ["projectId"],
  });
  return updated;
};

/**
 * Phase 6 — mark a skip as rented and record its rental window. Passing
 * ownership:"owned" (or clearing the fields) reverts it to an owned skip.
 */
exports.setRental = async (user, skipId, payload = {}) => {
  const skip = await skipRepo.findByIdRaw(skipId);
  if (!skip) throw httpError("Skip not found", 404);

  const ownership = payload.ownership || "rented";
  if (!["owned", "rented"].includes(ownership)) {
    throw httpError('ownership must be "owned" or "rented"', 400);
  }

  const update = ownership === "rented"
    ? {
        ownership: "rented",
        rentedFromCompany: payload.rentedFromCompany,
        projectRef: payload.projectRef,
        rentalStart: payload.rentalStart ? new Date(payload.rentalStart) : skip.rentalStart,
        rentalExpectedEnd: payload.rentalExpectedEnd ? new Date(payload.rentalExpectedEnd) : skip.rentalExpectedEnd,
      }
    : { ownership: "owned", rentedFromCompany: null, rentalStart: null, rentalExpectedEnd: null };

  if (ownership === "rented" && !update.rentalExpectedEnd) {
    throw httpError("rentalExpectedEnd is required for a rented skip", 400);
  }

  const updated = await skipRepo.update(skipId, update);
  await logSkip(updated, {
    action: "UPDATE",
    actor: actorFrom(user),
    description: `Skip ${updated.skip_id} rental set to ${ownership}`,
    changedFields: Object.keys(update),
  });
  return updated;
};

/**
 * FR-16 — retire a skip. Rejected if the demobilization cycle is incomplete
 * (mobilized out but not yet demobilized back).
 */
exports.returnSkip = async (user, skipId) => {
  const skip = await skipRepo.findByIdRaw(skipId);
  if (!skip) throw httpError("Skip not found", 404);
  if (skip.active === false) throw httpError("Skip is already returned/inactive", 400);

  if (skip.DateMobilized && !skip.DemobilizationOfFilledSkips) {
    throw httpError("Skip is mobilized but not yet demobilized; complete the cycle before returning it", 400);
  }

  const updated = await skipRepo.update(skipId, { active: false, returnedAt: new Date() });
  await logSkip(updated, {
    action: "RETURN",
    actor: actorFrom(user),
    description: `Skip ${updated.skip_id} returned/retired`,
    changedFields: ["active", "returnedAt"],
  });
  return updated;
};
