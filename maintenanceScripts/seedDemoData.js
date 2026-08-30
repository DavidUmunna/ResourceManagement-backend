/**
 * Seed a coherent DEMO dataset into the real dev DB so the Site Approver Portal
 * AND the ERP skip module have something to show. Idempotent — every record is
 * tagged "DEMO-…" and wiped + recreated on each run.
 *
 *   node maintenanceScripts/seedDemoData.js
 *
 * Produces: 1 project, 2 drivers, 2 trucks, 4 skips (mixed states), and 2 manifests
 * assigned to the seeded approver (one "issued" awaiting approval, one "signed").
 */
require("dotenv").config({ path: "./.env" });
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");

const Project = require("../models/Project");
const Driver = require("../models/Driver");
const Truck = require("../models/Truck");
const Skip = require("../models/skips_tracking");
const Manifest = require("../models/Manifest");
const SiteApprover = require("../models/SiteApprover");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/Halden_data";
const APPROVER_PHONE = process.env.SEED_APPROVER_PHONE || "+2348000000000";
const APPROVER_PASSWORD = process.env.SEED_APPROVER_PASSWORD;
const APPROVER_NAME = process.env.SEED_APPROVER_NAME || "Test Approver";
const DAY = 24 * 60 * 60 * 1000;
const ago = (d) => new Date(Date.now() - d * DAY);

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${MONGO_URI.replace(/\/\/[^@]*@/, "//***@")}`);

  // ── wipe previous demo data (idempotent) ────────────────────────────────────
  await Manifest.deleteMany({ manifestNo: /^DEMO-/ });
  await Skip.deleteMany({ skip_id: /^DEMO-/ });
  await Truck.deleteMany({ regNo: /^DEMO-/ });
  await Driver.deleteMany({ name: /^Demo / });
  await Project.deleteMany({ code: "DEMO-ACME" });

  // ── approver (find the seeded one, or create it) ────────────────────────────
  let approver = await SiteApprover.findOne({ phone: APPROVER_PHONE });
  if (!approver) {
    if (!APPROVER_PASSWORD) {
      console.error("Missing SEED_APPROVER_PASSWORD in .env — needed to create the demo approver. Aborting.");
      process.exit(1);
    }
    approver = await SiteApprover.create({
      name: APPROVER_NAME, phone: APPROVER_PHONE, site: "Demo Site",
      passwordHash: await bcrypt.hash(APPROVER_PASSWORD, 10), mustChangePassword: false, active: true,
    });
    console.log(`Created approver (${APPROVER_NAME}) — password from SEED_APPROVER_PASSWORD`);
  }

  const staff = { id: new mongoose.Types.ObjectId(), name: "Demo Dispatcher", role: "global_admin" };

  // ── project ─────────────────────────────────────────────────────────────────
  const project = await Project.create({ name: "Demo — Acme Rig 7", code: "DEMO-ACME", client: "Acme IOC", site: "Rig 7", dailyRateUsd: 120 });

  // ── drivers + trucks ────────────────────────────────────────────────────────
  const drvA = await Driver.create({ name: "Demo Driver A", licenseNo: "DEMO-LIC-A" });
  const drvB = await Driver.create({ name: "Demo Driver B", licenseNo: "DEMO-LIC-B" });
  await Truck.create({ regNo: "DEMO-DEL-1", type: "delivery", currentDriverId: drvA._id });
  await Truck.create({ regNo: "DEMO-WST-1", type: "waste", currentDriverId: drvB._id });

  // ── skips (mixed lifecycle states so insights/revenue light up) ─────────────
  const mk = (o) => ({ WasteSource: "Rig 7", projectId: project._id, ...o });
  const [s1, s2] = await Promise.all([
    // demobilized → eligible for the manifest
    Skip.create(mk({ skip_id: "DEMO-SKIP-1", WasteStream: "Sludge", Quantity: { value: 6, unit: "tonnes" }, DateMobilized: ago(12), DemobilizationOfFilledSkips: ago(3), DateFilled: ago(4), rfidTag: "DEMO-TAG-1", SkipsTruckRegNo: "DEMO-DEL-1", SkipsTruckDriver: "Demo Driver A" })),
    Skip.create(mk({ skip_id: "DEMO-SKIP-2", WasteStream: "OBM_Cutting", Quantity: { value: 4, unit: "tonnes" }, DateMobilized: ago(9), DemobilizationOfFilledSkips: ago(2), DateFilled: ago(2), rfidTag: "DEMO-TAG-2" })),
  ]);
  // on-site now
  await Skip.create(mk({ skip_id: "DEMO-SKIP-3", WasteStream: "WBM_cutting", Quantity: { value: 5, unit: "tonnes" }, DateMobilized: ago(5), rfidTag: "DEMO-TAG-3" }));
  // on-site + overdue + rented + expiring soon
  await Skip.create(mk({ skip_id: "DEMO-SKIP-4", WasteStream: "Sludge", Quantity: { value: 5, unit: "tonnes" }, DateMobilized: ago(20), ownership: "rented", rentedFromCompany: "Acme Rentals Ltd", rentalStart: ago(25), rentalExpectedEnd: new Date(Date.now() + 2 * DAY), rfidTag: "DEMO-TAG-4" }));

  // one demobilized skip for the signed (history) manifest
  const s5 = await Skip.create(mk({ skip_id: "DEMO-SKIP-5", WasteStream: "Others", Quantity: { value: 3, unit: "tonnes" }, DateMobilized: ago(18), DemobilizationOfFilledSkips: ago(10), DateFilled: ago(11) }));

  // ── manifests assigned to the approver ──────────────────────────────────────
  // (1) ISSUED → shows up in the portal "Awaiting approval"
  await Manifest.create({
    manifestNo: "DEMO-MF-1", status: "issued", siteApproverId: approver._id,
    attachedSkipIds: [s1._id, s2._id], notes: "Demo manifest awaiting your approval.",
    createdBy: staff,
  });
  // (2) SIGNED → shows up under portal "History"
  await Manifest.create({
    manifestNo: "DEMO-MF-2", status: "signed", siteApproverId: approver._id,
    attachedSkipIds: [s5._id], createdBy: staff,
    signedBy: { id: approver._id, name: approver.name, phone: approver.phone }, signedAt: ago(9),
  });
  await Skip.updateOne({ _id: s5._id }, { $set: { manifestId: (await Manifest.findOne({ manifestNo: "DEMO-MF-2" }))._id } });

  console.log("\n✅ Demo data seeded:");
  console.log("   project:  DEMO-ACME (Acme IOC, $120/skip/day)");
  console.log("   trucks:   DEMO-DEL-1 (delivery), DEMO-WST-1 (waste)  + 2 drivers");
  console.log("   skips:    DEMO-SKIP-1..5 (2 demobilized, 1 on-site, 1 overdue/rented, 1 manifested)");
  console.log(`   manifests: DEMO-MF-1 (ISSUED → awaiting ${approver.name}), DEMO-MF-2 (SIGNED → history)`);
  console.log("\nLog into the portal as the approver to see DEMO-MF-1 awaiting approval.");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error("Demo seed failed:", e); process.exit(1); });
