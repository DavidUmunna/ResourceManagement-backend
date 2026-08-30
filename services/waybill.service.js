const waybillRepo = require("../repositories/waybill.repository");
const skipRepo = require("../repositories/skip.repository");
const { logComplianceAction } = require("./ComplianceLog.service");
const { notifyIssue } = require("./NotificationService");
const { WAYBILL_APPROVER_ROLES, ISSUE_EVENTS } = require("../constants/skips.constants");

const httpError = (message, status) => Object.assign(new Error(message), { status });
const actorFrom = (user) => ({ id: user?.userId, name: user?.name, role: user?.role });

const logWaybill = (waybill, opts) =>
  logComplianceAction({
    entityType: "Waybill",
    entityModel: "waybill",
    entityId: waybill._id,
    entityName: waybill.waybillNo,
    ...opts,
  });

/**
 * Create a waybill and attach the given skips (sets each skip.waybillId).
 * Starts in "issued" — it must be internally approved before its skips can
 * mobilize (FR-17e).
 */
exports.createWaybill = async (user, payload = {}) => {
  if (!payload.waybillNo || !String(payload.waybillNo).trim()) {
    throw httpError("waybillNo is required", 400);
  }
  const skipIds = Array.isArray(payload.skipIds) ? payload.skipIds : [];

  const waybill = await waybillRepo.create({
    waybillNo: String(payload.waybillNo).trim(),
    destination: payload.destination,
    notes: payload.notes,
    status: "issued",
    attachedSkipIds: skipIds,
    createdBy: actorFrom(user),
  });

  // Link each skip to this waybill.
  await Promise.all(skipIds.map((sid) => skipRepo.update(sid, { waybillId: waybill._id })));

  await logWaybill(waybill, {
    action: "CREATE",
    actor: { ...actorFrom(user), model: "user" },
    description: `Waybill ${waybill.waybillNo} created with ${skipIds.length} skip(s)`,
  });
  return waybill;
};

exports.listWaybills = (filter = {}) => waybillRepo.findAll(filter);

exports.getWaybill = async (id) => {
  const waybill = await waybillRepo.findByIdPopulated(id);
  if (!waybill) throw httpError("Waybill not found", 404);
  return waybill;
};

/**
 * FR-17d — internal approval. Restricted to WAYBILL_APPROVER_ROLES; the route
 * additionally enforces internal 2FA (OTP) before this runs. Only issued/draft
 * waybills can be approved.
 */
exports.approveWaybill = async (user, id) => {
  if (!WAYBILL_APPROVER_ROLES.includes(user?.role)) {
    throw httpError("You are not authorized to approve waybills", 403);
  }
  const waybill = await waybillRepo.findById(id);
  if (!waybill) throw httpError("Waybill not found", 404);
  if (!["draft", "issued"].includes(waybill.status)) {
    throw httpError(`Waybill cannot be approved from status "${waybill.status}"`, 400);
  }

  const updated = await waybillRepo.update(id, {
    status: "approved",
    approvedBy: actorFrom(user),
    approvedAt: new Date(),
  });
  await logWaybill(updated, {
    action: "APPROVE",
    actor: { ...actorFrom(user), model: "user" },
    description: `Waybill ${updated.waybillNo} approved`,
    statusBefore: waybill.status,
    statusAfter: "approved",
  });
  return updated;
};

/**
 * Reject a waybill: snapshot its skip membership, unlink every skip
 * (clear skip.waybillId), clear attachedSkipIds, and raise an issue (FR + §4).
 */
exports.rejectWaybill = async (user, id, reason) => {
  if (!WAYBILL_APPROVER_ROLES.includes(user?.role)) {
    throw httpError("You are not authorized to reject waybills", 403);
  }
  if (!reason || !String(reason).trim()) throw httpError("A rejection reason is required", 400);

  const waybill = await waybillRepo.findById(id);
  if (!waybill) throw httpError("Waybill not found", 404);
  if (["rejected", "completed"].includes(waybill.status)) {
    throw httpError(`Waybill is already ${waybill.status}`, 400);
  }

  const previous = (waybill.attachedSkipIds || []).slice();

  // Auto-unlink every attached skip.
  await Promise.all(previous.map((sid) => skipRepo.update(sid, { waybillId: null })));

  const updated = await waybillRepo.update(id, {
    status: "rejected",
    rejectionReason: String(reason).trim(),
    rejectedBy: actorFrom(user),
    rejectedAt: new Date(),
    previouslyAttachedSkipIds: previous,
    attachedSkipIds: [],
  });

  await logWaybill(updated, {
    action: "REJECT",
    actor: { ...actorFrom(user), model: "user" },
    description: `Waybill ${updated.waybillNo} rejected: ${reason}`,
    statusBefore: waybill.status,
    statusAfter: "rejected",
    metadata: { unlinkedSkips: previous.length },
  });
  await notifyIssue({
    event: ISSUE_EVENTS.WAYBILL_REJECTED,
    title: ISSUE_EVENTS.WAYBILL_REJECTED,
    message: `Waybill ${updated.waybillNo} was rejected by ${user?.name || "an approver"}: ${reason}`,
    context: { waybillNo: updated.waybillNo, unlinkedSkips: previous.length, reason },
  });
  return updated;
};
