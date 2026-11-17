/**
 * Duplicate purchase-order protection.
 *
 * Two independent, atomic guards (both enforced by Mongo unique indexes, never
 * by "find, then insert"):
 *
 *  1. Idempotency key — one key per client submission attempt. A retry of the
 *     same attempt (double click, network retry) gets the order that attempt
 *     already created. Guarded by the unique sparse index on
 *     PurchaseOrder.idempotencyKey.
 *
 *  2. Content lock — a short-lived OrderSubmissionLock whose `_id` is a
 *     fingerprint of the order content. A second identical order from the same
 *     staff member inside the window (other tab / device) is rejected with 409
 *     unless the user confirms. Guarded by the unique `_id`.
 */
const crypto = require("crypto");
const OrderSubmissionLock = require("../models/OrderSubmissionLock");

const DEFAULT_WINDOW_MIN = 10;

/** Read at call time so the window can change without a restart in tests. */
function windowMinutes() {
  const n = Number(process.env.PO_DUPLICATE_WINDOW_MINUTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_WINDOW_MIN;
}

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Content fingerprint. Includes staff, supplier, Title and each product's
 * name/quantity/price (order-independent). Deliberately excludes remarks,
 * urgency, attachments and timestamps: a resubmission with a fixed typo in the
 * remarks is still the same order.
 */
function makeFingerprint({ staff, supplier, Title, products = [] } = {}) {
  const list = Array.isArray(products) ? products : [];
  const items = list
    .map((p) => `${norm(p?.name)}|${Number(p?.quantity)}|${Number(p?.price)}`)
    .sort()
    .join(";");
  return crypto
    .createHash("sha256")
    .update([String(staff), norm(supplier), norm(Title), items].join("#"))
    .digest("hex");
}

const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Validate the optional Idempotency-Key header.
 * @returns {{ key: string|null, valid: boolean }}
 */
function parseIdempotencyKey(raw) {
  if (raw === undefined || raw === null || raw === "") return { key: null, valid: true };
  const key = String(raw).trim();
  return IDEMPOTENCY_KEY_RE.test(key) ? { key, valid: true } : { key: null, valid: false };
}

/** True for a Mongo duplicate-key error, optionally on a specific field. */
function isDuplicateKeyError(err, field) {
  if (!err || err.code !== 11000) return false;
  if (!field) return true;
  if (err.keyPattern && Object.prototype.hasOwnProperty.call(err.keyPattern, field)) return true;
  if (err.keyValue && Object.prototype.hasOwnProperty.call(err.keyValue, field)) return true;
  return String(err.message || "").includes(`${field}_1`);
}

const newToken = () => crypto.randomUUID();
const expiryFrom = (now) => new Date(now.getTime() + windowMinutes() * 60 * 1000);

/**
 * Atomically replace an existing lock that matches `condition` (e.g. expired,
 * or pointing at an order that no longer exists). Only one concurrent caller
 * can win, because the update changes the very fields the condition matches.
 */
async function takeOverLock(fingerprint, condition, staffId, idempotencyKey = null) {
  const now = new Date();
  const token = newToken();
  const updated = await OrderSubmissionLock.findOneAndUpdate(
    { _id: fingerprint, ...condition },
    {
      $set: {
        staff: staffId,
        orderId: null,
        idempotencyKey,
        token,
        expiresAt: expiryFrom(now),
        createdAt: now,
        updatedAt: now,
      },
    },
    { new: true, timestamps: false }
  );
  return updated ? { acquired: true, token } : { acquired: false };
}

/**
 * Try to take the content lock.
 * @returns {Promise<{acquired: true, token: string} |
 *                   {acquired: false, existing: {orderId, createdAt, idempotencyKey, token}}>}
 */
async function acquireLock(fingerprint, staffId, idempotencyKey = null, _attempt = 0) {
  const now = new Date();
  const token = newToken();
  try {
    await OrderSubmissionLock.create({
      _id: fingerprint,
      staff: staffId,
      orderId: null,
      idempotencyKey,
      token,
      expiresAt: expiryFrom(now),
    });
    return { acquired: true, token };
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err;
  }

  const existing = await OrderSubmissionLock.findById(fingerprint).lean();
  if (!existing) {
    // Swept/released between our insert and this read — try once more.
    if (_attempt < 1) return acquireLock(fingerprint, staffId, idempotencyKey, _attempt + 1);
    return { acquired: false, existing: { orderId: null, createdAt: now, idempotencyKey: null, token: null } };
  }

  // Expired but the TTL sweep hasn't run yet: it's stale, take it over.
  if (existing.expiresAt && new Date(existing.expiresAt) < now) {
    const took = await takeOverLock(fingerprint, { expiresAt: { $lt: now } }, staffId, idempotencyKey);
    if (took.acquired) return took;
  }

  return {
    acquired: false,
    existing: {
      orderId: existing.orderId || null,
      createdAt: existing.createdAt,
      idempotencyKey: existing.idempotencyKey || null,
      token: existing.token || null,
    },
  };
}

/** Record the created order on the lock this request holds. */
async function attachOrder(fingerprint, token, orderId) {
  await OrderSubmissionLock.updateOne({ _id: fingerprint, token }, { $set: { orderId } });
}

/** Release the lock this request holds (creation failed). Never touches a lock with an order. */
async function releaseLock(fingerprint, token) {
  await OrderSubmissionLock.deleteOne({ _id: fingerprint, token, orderId: null });
}

/**
 * Release an in-flight reservation by idempotency key (client abandoned the
 * attempt after precheck, e.g. the upload failed). No-op once an order exists.
 */
async function releaseReservation(staffId, idempotencyKey) {
  const res = await OrderSubmissionLock.deleteMany({ staff: staffId, idempotencyKey, orderId: null });
  return res?.deletedCount || 0;
}

module.exports = {
  windowMinutes,
  makeFingerprint,
  parseIdempotencyKey,
  isDuplicateKeyError,
  acquireLock,
  takeOverLock,
  attachOrder,
  releaseLock,
  releaseReservation,
};
