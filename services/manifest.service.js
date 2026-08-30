const manifestRepo = require("../repositories/manifest.repository");
const skipRepo = require("../repositories/skip.repository");
const { logComplianceAction } = require("./ComplianceLog.service");
const { notifyIssue } = require("./NotificationService");
const { ISSUE_EVENTS } = require("../constants/skips.constants");

const httpError = (message, status) => Object.assign(new Error(message), { status });

const logManifest = (manifest, opts) =>
  logComplianceAction({
    entityType: "Manifest",
    entityModel: "manifest",
    entityId: manifest._id,
    entityName: manifest.manifestNo,
    ...opts,
  });

// A skip may only be attached to a manifest once it has been DEMOBILIZED
// (filled skip collected off site). Throws 400 on the first offender.
async function assertAllDemobilized(skipIds) {
  const skips = await Promise.all(skipIds.map((id) => skipRepo.findByIdRaw(id)));
  skips.forEach((skip, i) => {
    if (!skip) throw httpError(`Skip ${skipIds[i]} not found`, 404);
    if (!skip.DemobilizationOfFilledSkips) {
      throw httpError(`Skip ${skip.skip_id} is not demobilized; only demobilized skips can go on a manifest`, 400);
    }
  });
  return skips;
}

/**
 * Create a manifest from demobilized skips. Staff-authored.
 */
exports.createManifest = async (staffUser, payload = {}) => {
  if (!payload.manifestNo || !String(payload.manifestNo).trim()) {
    throw httpError("manifestNo is required", 400);
  }
  const skipIds = Array.isArray(payload.skipIds) ? payload.skipIds : [];
  await assertAllDemobilized(skipIds);

  const manifest = await manifestRepo.create({
    manifestNo: String(payload.manifestNo).trim(),
    notes: payload.notes,
    status: "issued",
    attachedSkipIds: skipIds,
    siteApproverId: payload.siteApproverId,
    createdBy: { id: staffUser?.userId, name: staffUser?.name, role: staffUser?.role },
  });

  await logManifest(manifest, {
    action: "CREATE",
    actor: { id: staffUser?.userId, name: staffUser?.name, role: staffUser?.role, model: "user" },
    description: `Manifest ${manifest.manifestNo} created with ${skipIds.length} demobilized skip(s)`,
  });
  return manifest;
};

exports.listManifests = (filter = {}) => manifestRepo.findAll(filter);

// Approver-scoped: only manifests assigned to this approver (portal). Optional
// status filter (e.g. "issued" for the awaiting-approval view).
exports.listForApprover = (approverId, status) => {
  const filter = { siteApproverId: approverId };
  if (status) filter.status = status;
  return manifestRepo.findAll(filter);
};

// Approver-scoped detail — 404 if the manifest isn't assigned to this approver.
exports.getForApprover = async (approverId, id) => {
  const manifest = await manifestRepo.findByIdPopulated(id);
  const assigned = manifest && manifest.siteApproverId &&
    String(manifest.siteApproverId._id || manifest.siteApproverId) === String(approverId);
  if (!manifest || !assigned) throw httpError("Manifest not found", 404);
  return manifest;
};

exports.getManifest = async (id) => {
  const manifest = await manifestRepo.findByIdPopulated(id);
  if (!manifest) throw httpError("Manifest not found", 404);
  return manifest;
};

/**
 * Attach more demobilized skips to a still-open manifest.
 */
exports.attachSkips = async (staffUser, id, skipIds = []) => {
  if (!Array.isArray(skipIds) || !skipIds.length) throw httpError("skipIds are required", 400);

  const manifest = await manifestRepo.findById(id);
  if (!manifest) throw httpError("Manifest not found", 404);
  if (!["draft", "issued"].includes(manifest.status)) {
    throw httpError(`Cannot attach skips to a ${manifest.status} manifest`, 400);
  }
  await assertAllDemobilized(skipIds);

  const merged = Array.from(new Set([...(manifest.attachedSkipIds || []).map(String), ...skipIds.map(String)]));
  const updated = await manifestRepo.update(id, { attachedSkipIds: merged });

  await logManifest(updated, {
    action: "UPDATE",
    actor: { id: staffUser?.userId, name: staffUser?.name, role: staffUser?.role, model: "user" },
    description: `${skipIds.length} skip(s) attached to manifest ${updated.manifestNo}`,
  });
  return updated;
};

/**
 * Sign a manifest — performed by the OTP-authenticated external site approver.
 * If the manifest names a specific approver, only they may sign. On signing,
 * every attached skip is linked to the manifest.
 */
exports.signManifest = async (siteApprover, id) => {
  const manifest = await manifestRepo.findById(id);
  if (!manifest) throw httpError("Manifest not found", 404);
  if (!["draft", "issued"].includes(manifest.status)) {
    throw httpError(`Manifest cannot be signed from status "${manifest.status}"`, 400);
  }
  if (manifest.siteApproverId && String(manifest.siteApproverId) !== String(siteApprover.id)) {
    throw httpError("This manifest is assigned to a different approver", 403);
  }

  const updated = await manifestRepo.update(id, {
    status: "signed",
    signedBy: { id: siteApprover.id, name: siteApprover.name, phone: siteApprover.phone },
    signedAt: new Date(),
  });

  // Link each skip to the signed manifest.
  await Promise.all((manifest.attachedSkipIds || []).map((sid) => skipRepo.update(sid, { manifestId: id })));

  await logManifest(updated, {
    action: "SIGN",
    actor: { id: siteApprover.id, name: siteApprover.name, role: "siteapprover", model: "siteapprover" },
    description: `Manifest ${updated.manifestNo} signed by ${siteApprover.name}`,
    statusBefore: manifest.status,
    statusAfter: "signed",
  });
  return updated;
};

/**
 * Reject a manifest — by the site approver. Snapshots membership, unlinks skips,
 * and raises a consolidated issue.
 */
exports.rejectManifest = async (siteApprover, id, reason) => {
  if (!reason || !String(reason).trim()) throw httpError("A rejection reason is required", 400);

  const manifest = await manifestRepo.findById(id);
  if (!manifest) throw httpError("Manifest not found", 404);
  if (["signed", "completed", "rejected"].includes(manifest.status)) {
    throw httpError(`Manifest is already ${manifest.status}`, 400);
  }
  if (manifest.siteApproverId && String(manifest.siteApproverId) !== String(siteApprover.id)) {
    throw httpError("This manifest is assigned to a different approver", 403);
  }

  const previous = (manifest.attachedSkipIds || []).slice();
  await Promise.all(previous.map((sid) => skipRepo.update(sid, { manifestId: null })));

  const updated = await manifestRepo.update(id, {
    status: "rejected",
    rejectionReason: String(reason).trim(),
    rejectedBy: { id: siteApprover.id, name: siteApprover.name, phone: siteApprover.phone },
    rejectedAt: new Date(),
    previouslyAttachedSkipIds: previous,
    attachedSkipIds: [],
  });

  await logManifest(updated, {
    action: "REJECT",
    actor: { id: siteApprover.id, name: siteApprover.name, role: "siteapprover", model: "siteapprover" },
    description: `Manifest ${updated.manifestNo} rejected by ${siteApprover.name}: ${reason}`,
    statusBefore: manifest.status,
    statusAfter: "rejected",
    metadata: { unlinkedSkips: previous.length },
  });
  await notifyIssue({
    event: ISSUE_EVENTS.MANIFEST_REJECTED,
    title: ISSUE_EVENTS.MANIFEST_REJECTED,
    message: `Manifest ${updated.manifestNo} was rejected by ${siteApprover.name}: ${reason}`,
    context: { manifestNo: updated.manifestNo, unlinkedSkips: previous.length, reason },
  });
  return updated;
};
