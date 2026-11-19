/**
 * Focused E2E: duplicate purchase-order prevention against the REAL stack
 * (server.js + Mongo + Redis), throwaway DB. Covers spec cases 1, 3, 4, 5 and
 * confirms the TTL index exists.
 *
 * Attachments are simulated with File documents that have no storage objects,
 * so nothing is uploaded to (or deleted from) the real GCS bucket.
 *
 *   node scripts/e2e-po-dedupe.js
 */
require("dotenv").config();
process.env.MONGO_URI = "mongodb://localhost:27017/Halden_e2e_po_dedupe";
process.env.PORT = "4612";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret";

const mongoose = require("mongoose");
const redis = require("redis");
const request = require("supertest");
const app = require("../server");
const PurchaseOrder = require("../models/PurchaseOrder");
const OrderSubmissionLock = require("../models/OrderSubmissionLock");
const FileModel = require("../models/file");
const AuditLog = require("../models/AuditLog");
const User = require("../models/users_");

const oid = () => new mongoose.Types.ObjectId();
const STAFF = oid();
const SID = "sess-po-dedupe";
let PASS = 0, FAIL = 0; const out = [];
const ck = (n, c, d = "") => { if (c) { PASS++; out.push(`  ✓ ${n}`); } else { FAIL++; out.push(`  ✗ ${n}  ${d}`); } };

let csrfToken = "", csrfCookie = "";
const cookie = () => [`sessionId=${SID}`, csrfCookie].filter(Boolean).join("; ");
const post = (path, body, key) => {
  const r = request(app).post(path).set("Cookie", cookie()).set("x-xsrf-token", csrfToken);
  if (key) r.set("Idempotency-Key", key);
  return r.send(body);
};

const BODY = {
  Title: "E2E printer toner",
  supplier: "Acme Supplies Ltd",
  products: [{ name: "Toner black", quantity: 4, price: 25000 }],
  urgency: "Urgent",
  remarks: "E2E duplicate check",
};

const reset = () => Promise.all([PurchaseOrder.deleteMany({}), OrderSubmissionLock.deleteMany({}), FileModel.deleteMany({})]);
const fakeUpload = () => FileModel.create({ staff: STAFF, files: [{ filename: "quote.png" }] });

async function main() {
  await new Promise((res) => (mongoose.connection.readyState === 1 ? res() : mongoose.connection.once("connected", res)));
  await mongoose.connection.db.dropDatabase();
  await Promise.all([PurchaseOrder.createIndexes(), OrderSubmissionLock.createIndexes()]);

  const rc = redis.createClient(); await rc.connect();
  await rc.set(`session:${SID}`, JSON.stringify({ userId: String(STAFF), role: "staff", name: "E2E Staff", email: "e2e-staff@test.com" }));
  // raw insert — the user only needs _id/email/Department for PO create
  await User.collection.insertOne({ _id: STAFF, name: "E2E Staff", email: "e2e-staff@test.com", Department: "waste_management_dep" });

  const cr = await request(app).get("/api/csrf-token").set("Cookie", `sessionId=${SID}`);
  const sc = cr.headers["set-cookie"] || [];
  const x = sc.find((c) => c.startsWith("XSRF-TOKEN=")); const _c = sc.find((c) => c.startsWith("_csrf="));
  csrfToken = x ? decodeURIComponent(x.split(";")[0].split("=")[1]) : ""; csrfCookie = _c ? _c.split(";")[0] : "";

  // TTL index
  const lockIdx = await OrderSubmissionLock.collection.indexes();
  ck("TTL index on OrderSubmissionLock.expiresAt exists", lockIdx.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0), JSON.stringify(lockIdx));
  const poIdx = await PurchaseOrder.collection.indexes();
  ck("unique sparse idempotencyKey index exists", poIdx.some((i) => i.key.idempotencyKey === 1 && i.unique && i.sparse), JSON.stringify(poIdx.map((i) => i.key)));

  // CORS preflight on the real server
  let r = await request(app).options("/api/orders")
    .set("Origin", "https://erp.haldengroup.ng")
    .set("Access-Control-Request-Method", "POST")
    .set("Access-Control-Request-Headers", "content-type,idempotency-key");
  ck("CORS preflight allows Idempotency-Key", /idempotency-key/i.test(r.headers["access-control-allow-headers"] || ""), JSON.stringify(r.headers));

  // 1. same key twice → 201 then 200 replay, one order
  await reset();
  const first = await post("/api/orders", BODY, "e2e-key-1");
  const again = await post("/api/orders", BODY, "e2e-key-1");
  ck("1. first create → 201", first.status === 201, `${first.status} ${JSON.stringify(first.body)}`);
  ck("1. same key again → 200 replay of the same order", again.status === 200 && again.body.replayed === true && again.body.newOrder?._id === first.body.newOrder?._id, `${again.status} ${JSON.stringify(again.body)}`);
  ck("1. exactly one order", (await PurchaseOrder.countDocuments()) === 1);

  // 3. same content, other tab (different key) → 409 with the existing order
  const tab = await post("/api/orders", BODY, "e2e-key-2");
  ck("3. other tab → 409 POSSIBLE_DUPLICATE", tab.status === 409 && tab.body.code === "POSSIBLE_DUPLICATE", `${tab.status} ${JSON.stringify(tab.body)}`);
  ck("3. 409 names the existing order number", tab.body.existingOrder?.orderNumber === first.body.newOrder?.orderNumber, JSON.stringify(tab.body.existingOrder));

  // 4. confirm → 201, override recorded + audited
  const confirmed = await post("/api/orders", { ...BODY, confirmDuplicate: true }, "e2e-key-2");
  const saved = confirmed.body.newOrder ? await PurchaseOrder.findById(confirmed.body.newOrder._id).lean() : null;
  ck("4. confirmDuplicate → 201", confirmed.status === 201, `${confirmed.status} ${JSON.stringify(confirmed.body)}`);
  ck("4. duplicateOverride.confirmed with similarTo", saved?.duplicateOverride?.confirmed === true && String(saved?.duplicateOverride?.similarTo) === String(first.body.newOrder?._id), JSON.stringify(saved?.duplicateOverride));
  ck("4. override written to the audit log", !!(await AuditLog.findOne({ action: "PO_DUPLICATE_OVERRIDE", entityId: String(saved?._id) })));

  // 5. concurrency: 5 parallel creates, different keys, each with its own upload → 1 order, 1 file
  await reset();
  const uploads = await Promise.all([1, 2, 3, 4, 5].map(fakeUpload));
  const results = await Promise.all(uploads.map((f, i) => post("/api/orders", { ...BODY, fileRefs: String(f._id) }, `e2e-par-${i}`)));
  const statuses = results.map((x) => x.status).sort().join(",");
  ck("5. parallel → exactly one 201, rest 409", statuses === "201,409,409,409,409", statuses);
  ck("5. exactly one order", (await PurchaseOrder.countDocuments()) === 1);
  ck("5. exactly one uploaded file left (rejected uploads cleaned up)", (await FileModel.countDocuments()) === 1, String(await FileModel.countDocuments()));

  // 5b. new-client flow: precheck reserves before any upload
  await reset();
  const pre = await Promise.all([1, 2, 3, 4, 5].map((i) => post("/api/orders/precheck", BODY, `e2e-pre-${i}`)));
  const preStatuses = pre.map((x) => x.status).sort().join(",");
  ck("5b. parallel prechecks → one 200, rest 409 (nothing uploaded)", preStatuses === "200,409,409,409,409", preStatuses);

  await reset();
  await mongoose.connection.dropDatabase(); await rc.del(`session:${SID}`); await rc.quit(); await mongoose.disconnect();
  console.log("\n=== PO DEDUPE E2E ===\n" + out.join("\n") + `\n\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
