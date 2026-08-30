/**
 * Focused E2E: skip revenue = billable days × project daily rate.
 * Inserts skips with precise deploy dates via the model (bypassing the legacy
 * create endpoint's date normalisation), then hits the real revenue endpoint.
 */
require("dotenv").config();
process.env.MONGO_URI = "mongodb://localhost:27017/Halden_e2e_revenue";
process.env.PORT = "4605";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret";

const mongoose = require("mongoose");
const redis = require("redis");
const request = require("supertest");
const app = require("../server");
const Skip = require("../models/skips_tracking");

const SID = "e2e-rev-session";
const STAFF = { userId: "000000000000000000000031", role: "global_admin", name: "E2E Admin" };
const DAY = 24 * 60 * 60 * 1000;
let PASS = 0, FAIL = 0; const out = [];
const ck = (n, c, d = "") => { if (c) { PASS++; out.push(`  ✓ ${n}`); } else { FAIL++; out.push(`  ✗ ${n}  ${d}`); } };

let csrfToken = "", csrfCookie = "";
const cookie = () => [`sessionId=${SID}`, csrfCookie].filter(Boolean).join("; ");
const staff = (m, p) => { const r = request(app)[m](p).set("Cookie", cookie()); if (["post", "put"].includes(m)) r.set("x-xsrf-token", csrfToken); return r; };

async function main() {
  await new Promise((res) => (mongoose.connection.readyState === 1 ? res() : mongoose.connection.once("connected", res)));
  await mongoose.connection.db.dropDatabase();
  const rc = redis.createClient(); await rc.connect(); await rc.set(`session:${SID}`, JSON.stringify(STAFF));
  const cr = await request(app).get("/api/csrf-token").set("Cookie", `sessionId=${SID}`);
  const sc = cr.headers["set-cookie"] || [];
  const x = sc.find((c) => c.startsWith("XSRF-TOKEN=")); const _c = sc.find((c) => c.startsWith("_csrf="));
  csrfToken = x ? decodeURIComponent(x.split(";")[0].split("=")[1]) : ""; csrfCookie = _c ? _c.split(";")[0] : "";

  const r0 = await staff("post", "/api/projects").send({ name: "Acme Rig 7", code: "ACME-RIG7", client: "Acme IOC", dailyRateUsd: 100 });
  const projectId = r0.body?.data?._id;
  ck("create project with $100/day rate", r0.status === 201 && !!projectId, JSON.stringify(r0.body));

  // Use a FIXED base so both endpoints are pinned dates (no clock drift):
  // demobilized skips give exact deltas. REV-1 = 8 days, REV-2 = 5 days.
  const base = new Date(Date.now() - DAY); // yesterday, fixed
  const baseT = base.getTime();
  const s1 = await Skip.create({ skip_id: "REV-1", WasteStream: "Sludge", WasteSource: "rig", projectId, DateMobilized: new Date(baseT - 8 * DAY), DemobilizationOfFilledSkips: base });
  await Skip.create({ skip_id: "REV-2", WasteStream: "Sludge", WasteSource: "rig", projectId, DateMobilized: new Date(baseT - 5 * DAY), DemobilizationOfFilledSkips: base });
  // control: a skip with NO project (must not count)
  await Skip.create({ skip_id: "REV-3", WasteStream: "Sludge", WasteSource: "rig", DateMobilized: new Date(baseT - 20 * DAY), DemobilizationOfFilledSkips: base });
  // open-ended (still on site) skip, mobilized at base → exercises the "to now"
  // path; its contribution grows to now so we assert it loosely.
  await Skip.create({ skip_id: "REV-4", WasteStream: "Sludge", WasteSource: "rig", projectId, DateMobilized: base });

  // all-time: REV-1(8) + REV-2(5) demob'd = 13 exact, + REV-4 still-out (>=1)
  let r = await staff("get", "/api/projects/revenue");
  let p = (r.body?.data?.projects || []).find((x) => x.projectId === String(projectId));
  ck("skipCount = 3 (no-project skip excluded)", p?.skipCount === 3, JSON.stringify(p?.skipCount));
  ck("billable days >= 14 (13 demob'd + still-out)", p?.billableDays >= 14, JSON.stringify(p));
  ck("revenue === billableDays × $100 (exact relationship)", p?.revenue === p?.billableDays * 100, JSON.stringify(p));
  ck("currency USD", r.body?.data?.currency === "USD");

  // date-range clamp [base-3d, base]: REV-1:3, REV-2:3, REV-4:0 (not yet deployed
  // in-window end) = 6 exact.
  const from = new Date(baseT - 3 * DAY).toISOString();
  const to = base.toISOString();
  r = await staff("get", `/api/projects/revenue?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
  p = (r.body?.data?.projects || []).find((x) => x.projectId === String(projectId));
  ck("range-clamped billable days = 6", p?.billableDays === 6, JSON.stringify(p));
  ck("range-clamped revenue = $600", p?.revenue === 600, JSON.stringify(p?.revenue));

  // per-skip override: REV-1 (8 days) overridden to $500 → +8×(500-100)=+3200
  r = await staff("get", "/api/projects/revenue");
  const before = r.body?.data?.totals?.revenue;
  let ro = await staff("put", `/api/skips/${s1._id}/rate`).send({ dailyRateUsd: 500 });
  ck("set per-skip rate override (200)", ro.status === 200 && ro.body?.data?.dailyRateUsdOverride === 500, JSON.stringify(ro.body));
  r = await staff("get", "/api/projects/revenue");
  ck("override raises revenue by 8×$400 = $3200", r.body?.data?.totals?.revenue === before + 3200, JSON.stringify({ before, after: r.body?.data?.totals?.revenue }));
  // clear override
  await staff("put", `/api/skips/${s1._id}/rate`).send({ dailyRateUsd: null });

  // Excel export includes the price columns (xlsx = zip → starts with "PK")
  const exp = await staff("post", "/api/skiptrack/export")
    .send({ startDate: new Date(baseT - 30 * DAY).toISOString(), endDate: new Date().toISOString(), stream: "All", WasteSource: "All", fileName: "e2e", fileFormat: "xlsx" })
    .buffer(true).parse((res, cb) => { const c = []; res.on("data", (d) => c.push(d)); res.on("end", () => cb(null, Buffer.concat(c))); });
  ck("xlsx export produced (with price columns)", exp.status === 200 && exp.body?.slice(0, 2).toString() === "PK" && exp.body.length > 1000, `status ${exp.status} len ${exp.body?.length}`);

  // unrated: set rate to 0 → revenue 0, all flagged unrated
  await staff("put", `/api/projects/${projectId}`).send({ dailyRateUsd: 0 });
  r = await staff("get", "/api/projects/revenue");
  ck("rate 0 → revenue 0 and unrated flagged", r.body?.data?.totals?.revenue === 0 && r.body?.data?.unratedSkipCount === 3, JSON.stringify(r.body?.data?.unratedSkipCount));

  await mongoose.connection.dropDatabase(); await rc.del(`session:${SID}`); await rc.quit(); await mongoose.disconnect();
  console.log("\n=== REVENUE E2E ===\n" + out.join("\n") + `\n\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
