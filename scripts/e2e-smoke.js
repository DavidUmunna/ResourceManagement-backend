/**
 * Real end-to-end smoke test — NO mocks. Exercises the full skip lifecycle
 * against real Mongo + Redis + CSRF + OTP + pdfkit, on a throwaway database.
 *
 *   node scripts/e2e-smoke.js
 */
require("dotenv").config();

// Throwaway DB + free port BEFORE requiring the app.
process.env.MONGO_URI = "mongodb://localhost:27017/Halden_e2e_smoke";
process.env.PORT = "4599";
process.env.NODE_ENV = "test"; // skip the rental cron scheduler
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret";

const mongoose = require("mongoose");
const redis = require("redis");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const request = require("supertest");
const app = require("../server");
const OTP = require("../models/OTP");
const SiteApprover = require("../models/SiteApprover");

const SID = "e2e-session";
const STAFF = { userId: "000000000000000000000001", role: "global_admin", name: "E2E Admin", email: "e2e@test.com", Department: "Waste Management" };

let PASS = 0, FAIL = 0;
const results = [];
function check(name, cond, detail = "") {
  if (cond) { PASS++; results.push(`  ✓ ${name}`); }
  else { FAIL++; results.push(`  ✗ ${name}  ${detail}`); }
}

// ── cookie / csrf handling (manual, since csurf is live) ─────────────────────
let csrfToken = "";
let csrfCookie = "";
function cookieHeader() {
  return [`sessionId=${SID}`, csrfCookie].filter(Boolean).join("; ");
}
function staff(method, path) {
  const r = request(app)[method](path).set("Cookie", cookieHeader());
  if (["post", "put", "patch", "delete"].includes(method)) r.set("x-xsrf-token", csrfToken);
  return r;
}
function approver(method, path, token) {
  return request(app)[method](path).set("Authorization", `Bearer ${token}`);
}

async function main() {
  // wait for the app's mongoose connection
  await new Promise((res) => {
    if (mongoose.connection.readyState === 1) return res();
    mongoose.connection.once("connected", res);
    mongoose.connection.once("open", res);
  });
  await mongoose.connection.db.dropDatabase(); // clean slate

  // seed a staff session directly in redis
  const rc = redis.createClient();
  await rc.connect();
  await rc.set(`session:${SID}`, JSON.stringify(STAFF));

  // fetch a CSRF token (also proves redis-auth works)
  const csrfRes = await request(app).get("/api/csrf-token").set("Cookie", `sessionId=${SID}`);
  check("GET /api/csrf-token (redis auth)", csrfRes.status === 200, `status ${csrfRes.status}`);
  const setCookies = csrfRes.headers["set-cookie"] || [];
  const xsrf = setCookies.find((c) => c.startsWith("XSRF-TOKEN="));
  const _csrf = setCookies.find((c) => c.startsWith("_csrf="));
  csrfToken = xsrf ? decodeURIComponent(xsrf.split(";")[0].split("=")[1]) : "";
  csrfCookie = _csrf ? _csrf.split(";")[0] : "";

  // 1. driver + trucks
  let r = await staff("post", "/api/drivers").send({ name: "E2E Driver", licenseNo: "LIC-9" });
  check("POST /api/drivers", r.status === 201, JSON.stringify(r.body));
  const driverId = r.body?.data?._id;

  r = await staff("post", "/api/trucks").send({ regNo: "E2E-DEL", type: "delivery" });
  check("POST /api/trucks (delivery)", r.status === 201, JSON.stringify(r.body));
  const delTruck = r.body?.data?._id;

  r = await staff("post", "/api/trucks").send({ regNo: "E2E-WST", type: "waste" });
  check("POST /api/trucks (waste)", r.status === 201);
  const wasteTruck = r.body?.data?._id;

  r = await staff("put", `/api/trucks/${delTruck}/assign-driver`).send({ driverId });
  check("PUT assign-driver (delivery)", r.status === 200, JSON.stringify(r.body));
  r = await staff("put", `/api/trucks/${wasteTruck}/assign-driver`).send({ driverId });
  check("PUT assign-driver (waste)", r.status === 200);

  // 2. skip create (legacy flat endpoint, now returns _id)
  r = await staff("post", "/api/skiptrack/create").send({
    skip_id: "E2E-SKIP-1", WasteStream: "Sludge", WasteSource: "rig-7", Quantity: { value: 1, unit: "unit" },
  });
  check("POST /api/skiptrack/create returns _id", r.status === 200 && !!r.body?.data?._id, JSON.stringify(r.body));
  const skipId = r.body?.data?._id;

  r = await staff("get", "/api/skips?search=E2E-SKIP-1");
  check("GET /api/skips (list)", r.status === 200 && r.body.items?.length >= 1, JSON.stringify(r.body?.pagination));

  // 3. register tag
  r = await staff("post", `/api/skips/${skipId}/register-tag`).send({ rfidTag: "E2E-TAG-1" });
  check("POST register-tag", r.status === 200 && r.body?.data?.rfidTag === "E2E-TAG-1", JSON.stringify(r.body));

  // 4. site approver (staff-provisioned)
  r = await staff("post", "/api/site-approvers").send({ name: "E2E Approver", phone: "+2348000000001", tempPassword: "Temp1234" });
  check("POST /api/site-approvers", r.status === 201, JSON.stringify(r.body));
  const approverId = r.body?.data?._id;

  // 5. waybill create + link skip
  r = await staff("post", "/api/waybills").send({ waybillNo: "E2E-WB-1", skipIds: [skipId], destination: "Site A" });
  check("POST /api/waybills", r.status === 201, JSON.stringify(r.body));
  const waybillId = r.body?.data?._id;

  // 6. assign delivery truck (FR-5: before mobilize)
  r = await staff("put", `/api/skips/${skipId}/assign-delivery-truck`).send({ truckId: delTruck });
  check("PUT assign-delivery-truck", r.status === 200, JSON.stringify(r.body));

  // 7. mobilize scan BEFORE waybill approved → must be blocked (FR-17e)
  r = await staff("post", "/api/skips/scan").send({ skipTag: "E2E-TAG-1", scanType: "mobilize" });
  check("scan mobilize blocked before waybill approved (FR-17e)", r.status === 400, `status ${r.status}`);

  // 8. approve waybill (internal 2FA via real OTP model)
  await OTP.create({ userId: STAFF.userId, code: "111111", purpose: "Approval", expiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  r = await staff("put", `/api/waybills/${waybillId}/approve`).send({ otp: "111111" });
  check("PUT waybill approve (2FA OTP)", r.status === 200 && r.body?.data?.status === "approved", JSON.stringify(r.body));

  // 9. mobilize scan now succeeds + credits driver (FR-6)
  r = await staff("post", "/api/skips/scan").send({ skipTag: "E2E-TAG-1", scanType: "mobilize" });
  check("scan mobilize (rfid) credits driver", r.status === 200 && r.body?.data?.SkipsTruckDriver === "E2E Driver" && r.body?.data?.mobilizeScanMethod === "rfid", JSON.stringify(r.body?.data));

  // 10. collection truck + demobilize
  r = await staff("put", `/api/skips/${skipId}/assign-collection-truck`).send({ truckId: wasteTruck });
  check("PUT assign-collection-truck", r.status === 200, JSON.stringify(r.body));
  r = await staff("post", "/api/skips/scan").send({ skipTag: "E2E-TAG-1", scanType: "demobilize" });
  check("scan demobilize (rfid)", r.status === 200 && r.body?.data?.WasteTruckDriverName === "E2E Driver", JSON.stringify(r.body?.data));

  // 11. manifest (demobilized-only) assigned to approver
  r = await staff("post", "/api/manifests").send({ manifestNo: "E2E-MF-1", skipIds: [skipId], siteApproverId: approverId });
  check("POST /api/manifests (demobilized-only)", r.status === 201, JSON.stringify(r.body));
  const manifestId = r.body?.data?._id;

  // 12. approver flow — token + scoped list + sign with fresh OTP (FR-19)
  const approverToken = jwt.sign({ approverId, type: "siteapprover", name: "E2E Approver", phone: "+2348000000001" }, process.env.JWT_SECRET);
  r = await approver("get", "/api/manifests/mine?status=issued", approverToken);
  check("GET /api/manifests/mine (approver-scoped)", r.status === 200 && r.body.data?.some((m) => m._id === manifestId), JSON.stringify(r.body?.data?.length));

  // seed a fresh action OTP directly (bypass SMS) then sign
  await SiteApprover.findByIdAndUpdate(approverId, { otpHash: await bcrypt.hash("222222", 10), otpExpiresAt: new Date(Date.now() + 5 * 60 * 1000) });
  r = await approver("put", `/api/manifests/${manifestId}/sign`, approverToken).send({ otp: "222222" });
  check("PUT manifest sign (approver OTP, FR-19)", r.status === 200 && r.body?.data?.status === "signed", JSON.stringify(r.body));

  // sign again without OTP → blocked
  r = await approver("put", `/api/manifests/${manifestId}/sign`, approverToken).send({});
  check("manifest sign without OTP blocked", r.status === 400 || r.status === 401, `status ${r.status}`);

  // 13. manifest PDF (real pdfkit stream)
  r = await staff("get", `/api/manifests/${manifestId}/pdf`).buffer(true).parse((res, cb) => {
    const chunks = []; res.on("data", (c) => chunks.push(c)); res.on("end", () => cb(null, Buffer.concat(chunks)));
  });
  const isPdf = r.status === 200 && (r.headers["content-type"] || "").includes("application/pdf") && r.body?.length > 500 && r.body.slice(0, 5).toString() === "%PDF-";
  check("GET manifest PDF (pdfkit)", isPdf, `status ${r.status} type ${r.headers["content-type"]} len ${r.body?.length}`);

  // 14. compliance timeline for the skip (real logging + query + refPath)
  r = await staff("get", `/api/v2/compliance/logs?entityId=${skipId}`);
  const logs = r.body?.data || [];
  check("GET compliance logs for skip (real logging)", r.status === 200 && logs.length >= 3, `status ${r.status} count ${logs.length}`);
  check("compliance log has SCAN action", logs.some((l) => l.action === "SCAN"), `actions: ${logs.map((l) => l.action).join(",")}`);

  // 15. skip detail — nested populate (trucks+drivers, waybill, manifest)
  r = await staff("get", `/api/skips/${skipId}`);
  const s = r.body?.data;
  check("GET skip detail populated (truck+driver+waybill+manifest)",
    r.status === 200 && s?.assignedDeliveryTruckId?.regNo === "E2E-DEL" && s?.assignedDeliveryTruckId?.currentDriverId?.name === "E2E Driver" && !!s?.manifestId,
    JSON.stringify({ del: s?.assignedDeliveryTruckId?.regNo, drv: s?.assignedDeliveryTruckId?.currentDriverId?.name, mf: !!s?.manifestId }));

  // cleanup
  await mongoose.connection.dropDatabase();
  await rc.del(`session:${SID}`);
  await rc.quit();
  await mongoose.disconnect();

  console.log("\n=== E2E SMOKE RESULTS ===");
  console.log(results.join("\n"));
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}

main().catch((e) => { console.error("E2E crashed:", e); process.exit(2); });
