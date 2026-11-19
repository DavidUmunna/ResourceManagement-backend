const { Schema, model, Types } = require("mongoose");

/**
 * Short-lived lock that marks "this staff member just submitted this exact
 * purchase-order content". `_id` is the content fingerprint (sha256 hex, see
 * services/orderDedupe.service.js), so acquiring the lock is a single atomic
 * insert guarded by Mongo's unique `_id` — no find-then-insert race.
 *
 * - `orderId` is null while the submission is still in flight (precheck done,
 *   attachment uploading, order not yet saved) and set once the order exists.
 * - `idempotencyKey` is the key of the submission attempt that owns the lock,
 *   so the create call that follows a precheck can consume its own lock.
 * - The TTL index on `expiresAt` lets Mongo sweep expired locks (~every 60s).
 *   Readers must still treat `expiresAt < now` as expired, because the sweep
 *   is approximate.
 */
const orderSubmissionLockSchema = new Schema(
  {
    _id: { type: String }, // content fingerprint (sha256 hex)
    staff: { type: Types.ObjectId, ref: "user", required: true },
    orderId: { type: Types.ObjectId, default: null },
    idempotencyKey: { type: String, default: null },
    // Random per-acquisition owner token: release/attach only ever touch the
    // lock this request actually holds (not one taken over after expiry).
    token: { type: String, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true, versionKey: false }
);

orderSubmissionLockSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = model("OrderSubmissionLock", orderSubmissionLockSchema);
