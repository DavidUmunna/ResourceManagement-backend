/**
 * Purchase-order creation with duplicate protection. Every PO create path must
 * go through createPurchaseOrder() (currently POST /api/orders).
 *
 * Because the attachment is uploaded by a separate request
 * (POST /api/fileupload/create) BEFORE the order is created, clients should
 * call precheckPurchaseOrder() (POST /api/orders/precheck) first: it takes the
 * content lock before anything is uploaded, so a rejected duplicate never
 * leaves an orphaned GCS object. Old clients that skip the precheck still get
 * the lock taken here, and any attachment they uploaded for a rejected or
 * failed create is discarded.
 *
 * Functions return { status, body } so the route stays thin and the logic is
 * testable without HTTP.
 */
const crypto = require("crypto");
const PurchaseOrder = require("../models/PurchaseOrder");
const User = require("../models/users_");
const dedupe = require("./orderDedupe.service");
const { discardUnusedAttachment } = require("./attachmentCleanup.service");
const auditRepository = require("../repositories/audit.repository");

const MAX_ORDER_NUMBER_RETRIES = 3;

const result = (status, body, extra = {}) => ({ status, body, ...extra });

const generateOrderNumber = () => `PO-${Date.now() + crypto.randomInt(1, 1000)}`;

/** Common request validation for precheck + create. */
function readRequest(req, { requireKey = false } = {}) {
  const body = req.body || {};
  const staffId = req.user?.userId;
  if (!staffId) return { error: result(401, { authenticated: false, message: "Not authenticated" }) };

  const { key, valid } = dedupe.parseIdempotencyKey(req.get ? req.get("Idempotency-Key") : undefined);
  if (!valid) {
    return {
      error: result(400, {
        code: "INVALID_IDEMPOTENCY_KEY",
        error: "Idempotency-Key must be 1-100 characters of A-Z, a-z, 0-9, '-' or '_'",
      }),
    };
  }
  if (requireKey && !key) {
    return { error: result(400, { code: "IDEMPOTENCY_KEY_REQUIRED", error: "Idempotency-Key header is required" }) };
  }

  if (!Array.isArray(body.products)) {
    return { error: result(400, { error: "Products must be an array" }) };
  }
  // A maintenance request must name the asset sub-category it applies to
  if (body.isMaintenance && (!body.assetSubCategory || !body.assetCategory)) {
    return {
      error: result(400, {
        error: "assetCategory and assetSubCategory are required for a maintenance request",
      }),
    };
  }

  const fingerprint = dedupe.makeFingerprint({
    staff: staffId,
    supplier: body.supplier,
    Title: body.Title,
    products: body.products,
  });

  return { body, staffId, key, fingerprint, confirm: body.confirmDuplicate === true };
}

const replayResult = (order) => result(200, { success: true, replayed: true, newOrder: order });

const keyReusedResult = () =>
  result(422, {
    code: "IDEMPOTENCY_KEY_REUSED",
    message: "This Idempotency-Key was already used for a different purchase order.",
  });

function conflictResult(existingOrder) {
  if (existingOrder) {
    return result(409, {
      success: false,
      code: "POSSIBLE_DUPLICATE",
      message: "You submitted an identical purchase order a few minutes ago.",
      existingOrder: {
        id: existingOrder._id,
        orderNumber: existingOrder.orderNumber,
        createdAt: existingOrder.createdAt,
      },
      inProgress: false,
    });
  }
  return result(409, {
    success: false,
    code: "POSSIBLE_DUPLICATE",
    message: "An identical purchase order is being submitted right now.",
    existingOrder: null,
    inProgress: true,
  });
}

/** Step 4 (idempotent replay lookup) shared by precheck + create. */
async function findByKey(key, staffId) {
  if (!key) return null;
  return PurchaseOrder.findOne({ idempotencyKey: key, staff: staffId });
}

/**
 * Take the content lock, or explain why not.
 * @returns {Promise<{token: string} | {conflict: {status, body}}>}
 */
async function claimLock(fingerprint, staffId, key) {
  const lock = await dedupe.acquireLock(fingerprint, staffId, key);
  if (lock.acquired) return { token: lock.token };

  const { existing } = lock;

  const sameAttempt = Boolean(key && existing.idempotencyKey === key);

  // Same submission attempt still in flight (this attempt's precheck, or a
  // concurrent retry): consume the reservation. A concurrent same-key race is
  // then settled by the unique idempotencyKey index on save.
  if (sameAttempt && !existing.orderId) return { token: existing.token };

  if (existing.orderId) {
    const existingOrder = await PurchaseOrder.findById(existing.orderId).select("orderNumber createdAt");
    // A concurrent retry of this same attempt created the order after our
    // replay lookup ran: this is a replay, not a duplicate.
    if (existingOrder && sameAttempt) return { sameAttemptCreated: true };
    if (existingOrder) return { conflict: conflictResult(existingOrder) };
    // The order the lock points at was deleted: the lock no longer protects
    // anything, take it over atomically.
    const took = await dedupe.takeOverLock(fingerprint, { orderId: existing.orderId }, staffId, key);
    if (took.acquired) return { token: took.token };
  }

  return { conflict: conflictResult(null) };
}

function logConflict(kind, staffId, fingerprint, body) {
  console.warn(
    `[po-dedupe] ${kind}`,
    JSON.stringify({ staff: String(staffId), fingerprint: fingerprint.slice(0, 12), ...body })
  );
}

/**
 * POST /api/orders/precheck — reserve the content lock before uploading.
 * Requires an Idempotency-Key. 200 { ok } | 200 replay | 409 | 422.
 */
async function precheckPurchaseOrder(req) {
  const ctx = readRequest(req, { requireKey: true });
  if (ctx.error) return ctx.error;
  const { staffId, key, fingerprint, confirm } = ctx;

  const existing = await findByKey(key, staffId);
  if (existing) {
    return existing.submissionFingerprint === fingerprint ? replayResult(existing) : keyReusedResult();
  }

  // The user already confirmed a duplicate: nothing to reserve.
  if (confirm) return result(200, { ok: true });

  const claim = await claimLock(fingerprint, staffId, key);
  if (claim.sameAttemptCreated) {
    const created = await findByKey(key, staffId);
    if (!created) return conflictResult(null);
    return created.submissionFingerprint === fingerprint ? replayResult(created) : keyReusedResult();
  }
  if (claim.conflict) {
    logConflict("precheck conflict", staffId, fingerprint, claim.conflict.body);
    return claim.conflict;
  }
  return result(200, { ok: true });
}

/**
 * POST /api/orders/precheck/release — the client abandoned an attempt after
 * precheck (e.g. upload failed). Frees its reservation; no-op once an order exists.
 */
async function releasePrecheck(req) {
  const staffId = req.user?.userId;
  if (!staffId) return result(401, { authenticated: false, message: "Not authenticated" });
  const { key, valid } = dedupe.parseIdempotencyKey(req.get ? req.get("Idempotency-Key") : undefined);
  if (!valid || !key) {
    return result(400, { code: "IDEMPOTENCY_KEY_REQUIRED", error: "A valid Idempotency-Key header is required" });
  }
  const released = await dedupe.releaseReservation(staffId, key);
  return result(200, { ok: true, released });
}

/** Save, regenerating orderNumber on a (rare) unique collision. */
async function saveWithUniqueOrderNumber(order) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await order.save();
    } catch (err) {
      if (dedupe.isDuplicateKeyError(err, "orderNumber") && attempt < MAX_ORDER_NUMBER_RETRIES) {
        order.orderNumber = generateOrderNumber();
        continue;
      }
      throw err;
    }
  }
}

async function auditOverride(staffId, order, similarTo) {
  try {
    await auditRepository.log(staffId, "PO_DUPLICATE_OVERRIDE", "PurchaseOrder", String(order._id), {
      similarTo: similarTo ? String(similarTo) : null,
      orderNumber: order.orderNumber,
    });
  } catch (err) {
    console.error("Audit log failed (duplicate override):", err.message);
  }
}

/**
 * POST /api/orders — create a purchase order.
 * 201 created | 200 idempotent replay | 409 POSSIBLE_DUPLICATE | 422 IDEMPOTENCY_KEY_REUSED.
 * On 201 the result also carries `user` (the requester) for notifications.
 */
async function createPurchaseOrder(req) {
  const ctx = readRequest(req);
  if (ctx.error) return ctx.error;
  const { body, staffId, key, fingerprint, confirm } = ctx;
  const fileRefs = body.fileRefs || undefined;

  // staff is always the authenticated user, never the request body.
  const requester = await User.findById(staffId);
  if (!requester) return result(404, { error: "User not found" });

  const replayOf = async (existingOrder) => {
    if (fileRefs && String(fileRefs) !== String(existingOrder.fileRefs)) {
      await discardUnusedAttachment(fileRefs, staffId);
    }
    return existingOrder.submissionFingerprint === fingerprint ? replayResult(existingOrder) : keyReusedResult();
  };

  // 4. Idempotent replay of the same submission attempt.
  const replay = await findByKey(key, staffId);
  if (replay) return replayOf(replay);

  // 5. Content lock, or a confirmed override.
  let lockToken = null;
  let duplicateOverride;
  if (!confirm) {
    const claim = await claimLock(fingerprint, staffId, key);
    if (claim.sameAttemptCreated) {
      const created = await findByKey(key, staffId);
      if (created) return replayOf(created);
      await discardUnusedAttachment(fileRefs, staffId);
      return conflictResult(null);
    }
    if (claim.conflict) {
      logConflict("create conflict", staffId, fingerprint, claim.conflict.body);
      await discardUnusedAttachment(fileRefs, staffId);
      return claim.conflict;
    }
    lockToken = claim.token;
  } else {
    const similar = await PurchaseOrder.findOne({ submissionFingerprint: fingerprint, staff: staffId })
      .sort({ createdAt: -1 })
      .select("_id");
    duplicateOverride = { confirmed: true, by: staffId, at: new Date(), similarTo: similar?._id };
  }

  // 6-7. Create the order. (The attachment was uploaded by a separate request.)
  const order = new PurchaseOrder({
    supplier: body.supplier,
    Title: body.Title,
    orderedBy: body.orderedBy,
    email: requester.email,
    products: body.products,
    urgency: body.urgency,
    filenames: body.filenames,
    remarks: body.remarks,
    Department: requester.Department,
    staff: staffId,
    role: body.role,
    fileRefs,
    targetDepartment: body.targetDepartment,
    isMaintenance: !!body.isMaintenance,
    ...(body.isMaintenance && { assetCategory: body.assetCategory, assetSubCategory: body.assetSubCategory }),
    submissionFingerprint: fingerprint,
    ...(key && { idempotencyKey: key }),
    ...(duplicateOverride && { duplicateOverride }),
  });

  let saved;
  try {
    saved = await saveWithUniqueOrderNumber(order);
  } catch (err) {
    // Two requests with the same key raced: the other one won, return its order.
    if (key && dedupe.isDuplicateKeyError(err, "idempotencyKey")) {
      const winner = await findByKey(key, staffId);
      if (fileRefs && (!winner || String(fileRefs) !== String(winner.fileRefs))) {
        await discardUnusedAttachment(fileRefs, staffId);
      }
      if (winner) {
        return winner.submissionFingerprint === fingerprint ? replayResult(winner) : keyReusedResult();
      }
      // Key belongs to another user's order.
      if (lockToken) await dedupe.releaseLock(fingerprint, lockToken).catch(() => {});
      return keyReusedResult();
    }
    if (lockToken) {
      await dedupe.releaseLock(fingerprint, lockToken).catch((e) =>
        console.error("Failed to release PO submission lock:", e.message)
      );
    }
    await discardUnusedAttachment(fileRefs, staffId);
    throw err;
  }

  // 8. Point the lock at the new order (best-effort: the order already exists).
  if (lockToken) {
    await dedupe.attachOrder(fingerprint, lockToken, saved._id).catch((e) =>
      console.error("Failed to attach order to PO submission lock:", e.message)
    );
  }

  if (duplicateOverride) {
    console.warn(
      "[po-dedupe] duplicate override",
      JSON.stringify({ staff: String(staffId), order: String(saved._id), similarTo: String(duplicateOverride.similarTo || "") })
    );
    await auditOverride(staffId, saved, duplicateOverride.similarTo);
  }

  // 9.
  return result(201, { success: true, newOrder: saved }, { created: true, user: requester });
}

module.exports = {
  createPurchaseOrder,
  precheckPurchaseOrder,
  releasePrecheck,
  generateOrderNumber,
};
