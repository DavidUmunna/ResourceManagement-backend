/**
 * Focused E2E: deep-link focus page-jump on GET /orders?focus=<id>.
 * Proves that asking for a specific order returns the PAGE that contains it,
 * so a "Open request →" link always resolves regardless of pagination depth.
 * Real Mongo + Redis, throwaway DB.
 */
require("dotenv").config();
process.env.MONGO_URI = "mongodb://localhost:27017/Halden_e2e_focus";
process.env.PORT = "4615";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret";

const mongoose = require("mongoose");
const redis = require("redis");
const request = require("supertest");
const app = require("../server");
const PurchaseOrder = require("../models/PurchaseOrder");

const oid = () => new mongoose.Types.ObjectId();
const USER = oid();
const SID = "sess-focus";
let PASS = 0, FAIL = 0; const out = [];
const ck = (n, c, d = "") => { if (c) { PASS++; out.push(`  ✓ ${n}`); } else { FAIL++; out.push(`  ✗ ${n}  ${d}`); } };

const N = 25, LIMIT = 10;

async function main() {
  await new Promise((res) => (mongoose.connection.readyState === 1 ? res() : mongoose.connection.once("connected", res)));
  await mongoose.connection.db.dropDatabase();
  const rc = redis.createClient(); await rc.connect();
  await rc.set(`session:${SID}`, JSON.stringify({ userId: String(USER), role: "staff", name: "Focus User" }));

  // 25 Approved orders (visible to anyone via the status branch), newest first by
  // createdAt. ids[i] has createdAt = now - i min, so sorted desc it sits at index i.
  const now = Date.now();
  const ids = Array.from({ length: N }, () => oid());
  await PurchaseOrder.collection.insertMany(ids.map((id, i) => ({
    _id: id, Title: `PO ${i}`, remarks: "x", staff: USER, status: "Approved",
    escalated: false, createdAt: new Date(now - i * 60000), updatedAt: new Date(now - i * 60000),
    PendingApprovals: [], Approvals: [],
  })));

  const get = (p) => request(app).get("/api/orders").query(p).set("Cookie", `sessionId=${SID}`);
  const has = (body, id) => (body?.data || []).some((o) => String(o._id) === String(id));

  // index 12 → page 2; index 22 → page 3; index 3 → page 1
  for (const [idx, expectedPage] of [[12, 2], [22, 3], [3, 1]]) {
    const r = await get({ limit: LIMIT, focus: String(ids[idx]) });
    ck(`focus idx ${idx} → returns page ${expectedPage}`, r.status === 200 && r.body?.Pagination?.page === expectedPage, `page ${r.body?.Pagination?.page}`);
    ck(`focus idx ${idx} → the order is on the returned page`, has(r.body, ids[idx]), JSON.stringify((r.body?.data || []).map((o) => o.Title)));
  }

  // Control: without focus, page 1 does NOT contain the index-12 order (the bug the fix solves)
  let r = await get({ limit: LIMIT });
  ck("no focus → defaults to page 1", r.body?.Pagination?.page === 1, `page ${r.body?.Pagination?.page}`);
  ck("no focus → a deep order is NOT on page 1 (why focus is needed)", !has(r.body, ids[12]), "");

  // Invalid focus id is ignored gracefully (falls back to page 1)
  r = await get({ limit: LIMIT, focus: "not-an-id" });
  ck("invalid focus id → falls back to page 1 (no crash)", r.status === 200 && r.body?.Pagination?.page === 1, `status ${r.status}`);

  await mongoose.connection.dropDatabase(); await rc.del(`session:${SID}`); await rc.quit(); await mongoose.disconnect();
  console.log("\n=== FOCUS (deep-link) E2E ===\n" + out.join("\n") + `\n\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
