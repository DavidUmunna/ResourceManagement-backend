/**
 * Focused E2E: Skip Insights (KPIs + throughput + turnaround + by-stream + by-project).
 * Real Mongo + Redis, throwaway DB. Inserts skips in known states and asserts.
 */
require("dotenv").config();
process.env.MONGO_URI = "mongodb://localhost:27017/Halden_e2e_insights";
process.env.PORT = "4607";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret";

const mongoose = require("mongoose");
const redis = require("redis");
const request = require("supertest");
const app = require("../server");
const Skip = require("../models/skips_tracking");
const Project = require("../models/Project");

const SID = "e2e-insights-session";
const STAFF = { userId: "000000000000000000000041", role: "global_admin", name: "E2E Admin" };
const DAY = 24 * 60 * 60 * 1000;
let PASS = 0, FAIL = 0; const out = [];
const ck = (n, c, d = "") => { if (c) { PASS++; out.push(`  ✓ ${n}`); } else { FAIL++; out.push(`  ✗ ${n}  ${d}`); } };
const staff = (m, p) => request(app)[m](p).set("Cookie", `sessionId=${SID}`);

async function main() {
  await new Promise((res) => (mongoose.connection.readyState === 1 ? res() : mongoose.connection.once("connected", res)));
  await mongoose.connection.db.dropDatabase();
  const rc = redis.createClient(); await rc.connect(); await rc.set(`session:${SID}`, JSON.stringify(STAFF));

  const project = await Project.create({ name: "Acme Rig 7", code: "ACME-RIG7", client: "Acme IOC", dailyRateUsd: 100 });
  const now = Date.now();
  const q = { value: 5, unit: "tonnes" };
  // on-site (3d), overdue (20d, still out), done (mobilized 10d ago, demob 2d ago → 8d turnaround)
  await Skip.create({ skip_id: "INS-ONSITE", WasteStream: "Sludge", WasteSource: "rig", Quantity: q, projectId: project._id, DateMobilized: new Date(now - 3 * DAY) });
  await Skip.create({ skip_id: "INS-OVERDUE", WasteStream: "Sludge", WasteSource: "rig", Quantity: q, projectId: project._id, DateMobilized: new Date(now - 20 * DAY) });
  await Skip.create({ skip_id: "INS-DONE", WasteStream: "Sludge", WasteSource: "rig", Quantity: q, projectId: project._id, DateMobilized: new Date(now - 10 * DAY), DemobilizationOfFilledSkips: new Date(now - 2 * DAY) });

  const r = await staff("get", "/api/skiptrack/insights");
  ck("200 OK", r.status === 200, `status ${r.status}`);
  const d = r.body?.data;
  const k = d?.kpis;

  ck("onSite = 2 (onsite + overdue, done excluded)", k?.onSite === 2, JSON.stringify(k?.onSite));
  ck("overdue = 1 (>14 days on site)", k?.overdue === 1, JSON.stringify(k?.overdue));
  ck("totalActive = 3", k?.totalActive === 3, JSON.stringify(k?.totalActive));
  ck("utilization = 67%", k?.utilizationPct === 67, JSON.stringify(k?.utilizationPct));
  ck("avg turnaround = 8 days (only INS-DONE)", k?.avgTurnaroundDays === 8, JSON.stringify(k?.avgTurnaroundDays));
  ck("period revenue > 0", k?.periodRevenueUsd > 0, JSON.stringify(k?.periodRevenueUsd));

  const mobTotal = (d?.throughput || []).reduce((a, w) => a + w.mobilized, 0);
  const demTotal = (d?.throughput || []).reduce((a, w) => a + w.demobilized, 0);
  ck("throughput mobilized total = 3", mobTotal === 3, JSON.stringify(mobTotal));
  ck("throughput demobilized total = 1", demTotal === 1, JSON.stringify(demTotal));

  const sludge = (d?.byStream || []).find((s) => s.stream === "Sludge");
  ck("by-stream Sludge tonnes = 15 (3×5)", sludge?.tonnes === 15, JSON.stringify(sludge));

  const proj = (d?.byProject || []).find((p) => p.code === "ACME-RIG7");
  ck("by-project has ACME-RIG7 with revenue", !!proj && proj.revenue > 0, JSON.stringify(proj));

  await mongoose.connection.dropDatabase(); await rc.del(`session:${SID}`); await rc.quit(); await mongoose.disconnect();
  console.log("\n=== INSIGHTS E2E ===\n" + out.join("\n") + `\n\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
