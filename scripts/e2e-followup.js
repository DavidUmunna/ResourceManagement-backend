/**
 * Focused E2E: request follow-ups (eligibility, cooldown, ownership, dashboards).
 * Real Mongo + Redis + CSRF, throwaway DB.
 */
require("dotenv").config();
process.env.MONGO_URI = "mongodb://localhost:27017/Halden_e2e_followup";
process.env.PORT = "4611";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret";

const mongoose = require("mongoose");
const redis = require("redis");
const request = require("supertest");
const app = require("../server");
const PurchaseOrder = require("../models/PurchaseOrder");

const oid = () => new mongoose.Types.ObjectId();
const REQ = oid(), REV = oid();
const sess = { req: `sess-req`, rev: `sess-rev` };
let PASS = 0, FAIL = 0; const out = [];
const ck = (n, c, d = "") => { if (c) { PASS++; out.push(`  ✓ ${n}`); } else { FAIL++; out.push(`  ✗ ${n}  ${d}`); } };

let csrfToken = "", csrfCookie = "";
const asUser = (sid) => [`sessionId=${sid}`, csrfCookie].filter(Boolean).join("; ");
const call = (m, p, sid) => { const r = request(app)[m](p).set("Cookie", asUser(sid)); if (["post", "put"].includes(m)) r.set("x-xsrf-token", csrfToken); return r; };

async function main() {
  await new Promise((res) => (mongoose.connection.readyState === 1 ? res() : mongoose.connection.once("connected", res)));
  await mongoose.connection.db.dropDatabase();
  const rc = redis.createClient(); await rc.connect();
  await rc.set(`session:${sess.req}`, JSON.stringify({ userId: String(REQ), role: "staff", name: "Requester" }));
  await rc.set(`session:${sess.rev}`, JSON.stringify({ userId: String(REV), role: "manager", name: "Reviewer" }));

  const cr = await request(app).get("/api/csrf-token").set("Cookie", `sessionId=${sess.req}`);
  const sc = cr.headers["set-cookie"] || [];
  const x = sc.find((c) => c.startsWith("XSRF-TOKEN=")); const _c = sc.find((c) => c.startsWith("_csrf="));
  csrfToken = x ? decodeURIComponent(x.split(";")[0].split("=")[1]) : ""; csrfCookie = _c ? _c.split(";")[0] : "";

  // a Pending request owned by REQ, with REV as pending reviewer
  const order = await PurchaseOrder.create({ Title: "Test PO", remarks: "please approve", staff: REQ, status: "Pending", PendingApprovals: [{ Reviewer: REV, Level: 1 }] });
  const moreInfo = await PurchaseOrder.create({ Title: "Needs info", remarks: "x", staff: REQ, status: "More Information" });

  // 1. requester follows up → 201, notifies REV
  let r = await call("post", `/api/orders/${order._id}/followup`, sess.req).send({ note: "still waiting, needed Friday" });
  ck("requester creates follow-up (201)", r.status === 201, JSON.stringify(r.body));
  ck("notified the pending reviewer", (r.body?.data?.notifiedUserIds || []).map(String).includes(String(REV)), JSON.stringify(r.body?.data?.notifiedUserIds));

  // 2. thread for the order
  r = await call("get", `/api/orders/${order._id}/followups`, sess.req);
  ck("follow-up thread has 1 entry", r.status === 200 && r.body.data?.length === 1, JSON.stringify(r.body?.data?.length));

  // 3. cooldown → immediate second attempt 429
  r = await call("post", `/api/orders/${order._id}/followup`, sess.req).send({ note: "again" });
  ck("cooldown blocks immediate re-follow-up (429)", r.status === 429, `status ${r.status}`);

  // 4. ownership → reviewer (not requester) can't follow up
  r = await call("post", `/api/orders/${order._id}/followup`, sess.rev).send({});
  ck("non-requester blocked (403)", r.status === 403, `status ${r.status}`);

  // 5. eligibility → More Information not allowed
  r = await call("post", `/api/orders/${moreInfo._id}/followup`, sess.req).send({});
  ck("More Information not eligible (400)", r.status === 400, JSON.stringify(r.body?.message));

  // 6. dashboards
  r = await call("get", `/api/orders/followups/sent`, sess.req);
  ck("requester 'sent' dashboard shows it", r.status === 200 && r.body.data?.some((f) => String(f.order?._id) === String(order._id) || f.order?.orderNumber), JSON.stringify(r.body?.data?.length));
  r = await call("get", `/api/orders/followups/received`, sess.rev);
  ck("reviewer 'received' dashboard shows it (Pending only)", r.status === 200 && r.body.data?.length === 1, JSON.stringify(r.body?.data?.length));

  // 6b. escalated dashboard — reviewer sees escalated Pending POs they can act on
  r = await call("get", `/api/orders/followups/escalated`, sess.rev);
  ck("no escalated POs before escalation", r.status === 200 && r.body.data?.length === 0, JSON.stringify(r.body?.data?.length));
  await PurchaseOrder.updateOne({ _id: order._id }, { $set: { escalated: true, escalatedAt: new Date() } });
  r = await call("get", `/api/orders/followups/escalated`, sess.rev);
  ck("reviewer 'escalated' dashboard shows escalated Pending PO", r.status === 200 && r.body.data?.length === 1 && String(r.body.data[0]?.order?._id) === String(order._id) && r.body.data[0]?.kind === "escalation", JSON.stringify(r.body?.data));

  // 7. once resolved, it drops off the reviewer's actionable dashboard
  await PurchaseOrder.updateOne({ _id: order._id }, { $set: { status: "Approved" } });
  r = await call("get", `/api/orders/followups/received`, sess.rev);
  ck("resolved request drops off 'received' dashboard", r.status === 200 && r.body.data?.length === 0, JSON.stringify(r.body?.data?.length));
  r = await call("get", `/api/orders/followups/escalated`, sess.rev);
  ck("resolved request drops off 'escalated' dashboard", r.status === 200 && r.body.data?.length === 0, JSON.stringify(r.body?.data?.length));

  await mongoose.connection.dropDatabase(); await rc.del(`session:${sess.req}`); await rc.del(`session:${sess.rev}`); await rc.quit(); await mongoose.disconnect();
  console.log("\n=== FOLLOW-UP E2E ===\n" + out.join("\n") + `\n\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
