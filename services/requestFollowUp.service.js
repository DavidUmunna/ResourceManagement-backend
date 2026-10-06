const followUpRepo = require("../repositories/requestFollowUp.repository");
const PurchaseOrder = require("../models/PurchaseOrder");
const User = require("../models/users_");
const { sendPushNotification } = require("../Global_Functions/firebasePushNotification");

const httpError = (message, status) => Object.assign(new Error(message), { status });

// Follow-up is allowed while the request is still in play ("Pending", which
// includes partially-approved requests still moving through the chain) AND once
// it's been "Approved" (to chase fulfilment / next steps). Explicitly NOT
// "More Information" (ball is in the requester's court) or other terminal states.
const FOLLOWUP_ELIGIBLE = new Set(["Pending", "Approved"]);
const COOLDOWN_HOURS = Number(process.env.FOLLOWUP_COOLDOWN_HOURS || 24);
const COOLDOWN_MS = COOLDOWN_HOURS * 60 * 60 * 1000;

function humanizeSince(date) {
  const mins = Math.floor((Date.now() - new Date(date).getTime()) / 60000);
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
}

/**
 * Create a follow-up on an existing request. Never creates a new request.
 */
exports.createFollowUp = async (user, orderId, note) => {
  const order = await PurchaseOrder.findById(orderId).select("staff status PendingApprovals Approvals orderNumber Title").lean();
  if (!order) throw httpError("Request not found", 404);

  // Only the original requester may follow up (FR: requester is the sender).
  if (String(order.staff) !== String(user.userId)) {
    throw httpError("Only the original requester can follow up on this request", 403);
  }

  // Eligibility — Pending / partially-approved only.
  if (!FOLLOWUP_ELIGIBLE.has(order.status)) {
    const why = order.status === "More Information"
      ? "This request is awaiting more information from you — please respond to it instead of following up."
      : `This request is "${order.status}" and can no longer be followed up.`;
    throw httpError(why, 400);
  }

  // Cooldown — prevent follow-up spam replacing request spam.
  const last = await followUpRepo.findLatestByUserForOrder(user.userId, orderId);
  if (last && Date.now() - new Date(last.createdAt).getTime() < COOLDOWN_MS) {
    throw httpError(`You already followed up ${humanizeSince(last.createdAt)}. You can follow up again after ${COOLDOWN_HOURS}h.`, 429);
  }

  // Who to notify depends on where the request is:
  //  • Pending  → the reviewers who still need to act (PendingApprovals).
  //  • Approved → the approvers who already approved it (resolved from the
  //    Approvals decision log — which stores names — back to user ids).
  const notifiedUserIds = order.status === "Approved"
    ? await resolveApproverIds(order)
    : [...new Set((order.PendingApprovals || []).map((p) => p.Reviewer).filter(Boolean).map(String))];

  const followUp = await followUpRepo.create({
    order: orderId,
    requestedBy: user.userId,
    requestedByName: user.name,
    note: note && String(note).trim() ? String(note).trim() : null,
    notifiedUserIds,
  });

  // Notify the approvers (best-effort — never fail the follow-up on a push error).
  notifyApprovers(order, followUp, user).catch((e) => console.error("follow-up push failed:", e.message));

  return followUp.toObject ? followUp.toObject() : followUp;
};

// For an Approved request there are no PendingApprovals left, so we notify the
// people who approved it. The Approvals log only stores approver *names*, so we
// resolve those back to user ids (best-effort). Prefer entries that are actual
// approvals; fall back to everyone who acted if none are tagged "Approved".
async function resolveApproverIds(order) {
  const log = Array.isArray(order.Approvals) ? order.Approvals : [];
  let names = [...new Set(log.filter((a) => a.status === "Approved").map((a) => a.admin).filter(Boolean))];
  if (!names.length) names = [...new Set(log.map((a) => a.admin).filter(Boolean))];
  if (!names.length) return [];
  const users = await User.find({ name: { $in: names } }).select("_id").lean();
  return users.map((u) => String(u._id));
}

async function notifyApprovers(order, followUp, user) {
  if (!followUp.notifiedUserIds?.length) return;
  const users = await User.find({ _id: { $in: followUp.notifiedUserIds } }).select("NotificationToken name").lean();
  const tokens = users
    .flatMap((u) => (Array.isArray(u.NotificationToken) ? u.NotificationToken : u.NotificationToken ? [u.NotificationToken] : []))
    .filter(Boolean);

  const label = order.Title || order.orderNumber || "a request";
  const body = followUp.note
    ? `${user.name} followed up on ${label}: "${followUp.note}"`
    : `${user.name} followed up on ${label}`;

  await Promise.allSettled(
    tokens.map((token) =>
      sendPushNotification(token, "Request follow-up", body, {
        type: "followup",
        orderId: String(order._id),
        url: `/admin/requestlist#order-${order._id}`,
      })
    )
  );
}

exports.listForOrder = (orderId) => followUpRepo.findByOrder(orderId);

exports.listSent = (userId) => followUpRepo.findSentByUser(userId);

// Received = follow-ups where I'm a notified approver AND the request is still
// actionable (Pending), so the dashboard card shows what I can act on now.
exports.listReceived = async (userId) => {
  const rows = await followUpRepo.findReceivedByUser(userId);
  return rows.filter((f) => f.order && f.order.status === "Pending" && !f.resolved);
};

// An approver who was notified on a request's follow-up(s) marks them resolved,
// which notifies the follow-up sender(s) that their chase has been handled.
exports.markResolved = async (user, orderId, note) => {
  const pending = await followUpRepo.findUnresolvedForOrderByApprover(orderId, user.userId);
  if (!pending.length) throw httpError("No follow-up awaiting your resolution on this request", 404);

  const resolutionNote = note && String(note).trim() ? String(note).trim() : null;
  await followUpRepo.resolveForOrderByApprover(orderId, user.userId, {
    resolved: true, resolvedBy: user.userId, resolvedByName: user.name, resolvedAt: new Date(), resolutionNote,
  });

  notifyResolution(orderId, pending, user, resolutionNote).catch((e) => console.error("resolution push failed:", e.message));
  return { resolved: pending.length };
};

async function notifyResolution(orderId, followUps, approver, note) {
  const order = await PurchaseOrder.findById(orderId).select("Title orderNumber").lean();
  const requestLabel = order?.Title || order?.orderNumber || "your request";
  const senderIds = [...new Set(followUps.map((f) => String(f.requestedBy)).filter(Boolean))];
  if (!senderIds.length) return;
  const users = await User.find({ _id: { $in: senderIds } }).select("NotificationToken").lean();
  const tokens = users
    .flatMap((u) => (Array.isArray(u.NotificationToken) ? u.NotificationToken : u.NotificationToken ? [u.NotificationToken] : []))
    .filter(Boolean);
  const body = note
    ? `${approver.name} marked your follow-up on ${requestLabel} resolved: "${note}"`
    : `${approver.name} marked your follow-up on ${requestLabel} resolved`;
  await Promise.allSettled(
    tokens.map((t) => sendPushNotification(t, "Follow-up resolved", body, {
      type: "followup_resolved", orderId: String(orderId), url: `/admin/requestlist#order-${orderId}`,
    }))
  );
}

// Follow-ups I was notified on where the request is now Approved. These are
// informational (nothing to approve/reject) — the dashboard shows them as
// read-only FYI rows so an approved-request follow-up isn't push-only.
exports.listReceivedApproved = async (userId) => {
  const rows = await followUpRepo.findReceivedByUser(userId);
  return rows.filter((f) => f.order && f.order.status === "Approved" && !f.resolved);
};

// Escalated requests I can act on now: escalated + still Pending + I'm one of the
// pending reviewers. Same "awaiting your action" scope as listReceived, so the
// dashboard attention card can surface nudged AND escalated requests together.
exports.listEscalatedReceived = async (userId) => {
  const orders = await PurchaseOrder.find({
    escalated: true,
    status: "Pending",
    "PendingApprovals.Reviewer": userId,
  })
    .select("Title orderNumber status escalated escalatedAt")
    .sort({ escalatedAt: -1 })
    .lean();

  // Normalize to the same item shape the received card consumes.
  return orders.map((o) => ({
    _id: `esc-${o._id}`,
    kind: "escalation",
    order: { _id: o._id, Title: o.Title, orderNumber: o.orderNumber, status: o.status },
    escalatedAt: o.escalatedAt,
  }));
};
