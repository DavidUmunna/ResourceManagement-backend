/**
 * migrateSkipsRelational.js — one-off migration for the RFID Skip Tracking feature.
 *
 * 1. Backfills new skip lifecycle fields on existing flat skip docs
 *    (ownership="owned", active=true) where missing.
 * 2. Seeds relational reference entities (Driver, Truck) from the distinct
 *    free-text driver names / truck reg numbers already on flat skips.
 * 3. Backfills polymorphic discriminators on legacy ComplianceLog docs
 *    (entityModel="filetracking", performedByModel="user") where missing, so
 *    the generalized schema reads cleanly.
 *
 * Safe to re-run (idempotent). Dry-run by default; pass --commit to write.
 *
 *   node maintenanceScripts/migrateSkipsRelational.js            # dry-run
 *   node maintenanceScripts/migrateSkipsRelational.js --commit   # apply
 */

require("dotenv").config({ path: "./.env" });
const mongoose = require("mongoose");

const Skip = require("../models/skips_tracking");
const Driver = require("../models/Driver");
const Truck = require("../models/Truck");
const ComplianceLog = require("../models/ComplianceLog");

const MONGO_URI =
  process.env.MONGO_URI ||
  "mongodb://AppUser:Haldenng123@127.0.0.1:27017/Haldenresources?authSource=admin";

const COMMIT = process.argv.includes("--commit");
const log = (...a) => console.log(COMMIT ? "[commit]" : "[dry-run]", ...a);

async function backfillSkipFields() {
  const filter = { $or: [{ ownership: { $exists: false } }, { active: { $exists: false } }] };
  const count = await Skip.countDocuments(filter);
  log(`skips needing lifecycle backfill: ${count}`);
  if (COMMIT && count) {
    // Only set fields that are missing; never clobber existing values.
    await Skip.updateMany({ ownership: { $exists: false } }, { $set: { ownership: "owned" } });
    await Skip.updateMany({ active: { $exists: false } }, { $set: { active: true } });
  }
  return count;
}

async function seedDriversAndTrucks() {
  const skips = await Skip.find(
    {},
    "SkipsTruckDriver WasteTruckDriverName SkipsTruckRegNo WasteTruckRegNo"
  ).lean();

  const driverNames = new Set();
  const truckRegs = new Set();
  for (const s of skips) {
    [s.SkipsTruckDriver, s.WasteTruckDriverName].forEach((n) => n && driverNames.add(String(n).trim()));
    [s.SkipsTruckRegNo, s.WasteTruckRegNo].forEach((r) => r && truckRegs.add(String(r).trim()));
  }

  let driversCreated = 0;
  for (const name of driverNames) {
    if (!name) continue;
    const exists = await Driver.findOne({ name });
    if (exists) continue;
    log(`+ driver: ${name}`);
    if (COMMIT) await Driver.create({ name });
    driversCreated++;
  }

  let trucksCreated = 0;
  for (const regNo of truckRegs) {
    if (!regNo) continue;
    const exists = await Truck.findOne({ regNo });
    if (exists) continue;
    // Historic reg numbers can't be reliably typed; default to "waste".
    log(`+ truck: ${regNo}`);
    if (COMMIT) await Truck.create({ regNo, type: "waste" });
    trucksCreated++;
  }

  log(`drivers created: ${driversCreated}, trucks created: ${trucksCreated}`);
  return { driversCreated, trucksCreated };
}

async function backfillComplianceLogs() {
  const filterEntity = { entityModel: { $exists: false } };
  const filterActor = { performedBy: { $exists: true, $ne: null }, performedByModel: { $exists: false } };

  const entityCount = await ComplianceLog.countDocuments(filterEntity);
  const actorCount = await ComplianceLog.countDocuments(filterActor);
  log(`compliance logs needing entityModel backfill: ${entityCount}`);
  log(`compliance logs needing performedByModel backfill: ${actorCount}`);

  if (COMMIT) {
    if (entityCount) await ComplianceLog.updateMany(filterEntity, { $set: { entityModel: "filetracking" } });
    if (actorCount) await ComplianceLog.updateMany(filterActor, { $set: { performedByModel: "user" } });
  }
  return { entityCount, actorCount };
}

async function main() {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected. Mode: ${COMMIT ? "COMMIT (writing)" : "DRY-RUN (no writes)"}\n`);

  try {
    await backfillSkipFields();
    await seedDriversAndTrucks();
    await backfillComplianceLogs();
    console.log(`\nDone.${COMMIT ? "" : " Re-run with --commit to apply."}`);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main();
