// syncOrderIndexes.js — build the indexes the duplicate-PO protection relies on.
//
// Dry-run by default (lists missing indexes); --commit to create them.
//
//   node maintenanceScripts/syncOrderIndexes.js            # report only
//   node maintenanceScripts/syncOrderIndexes.js --commit   # create missing indexes
//
// Indexes:
//   PurchaseOrder:       orderNumber (unique), idempotencyKey (unique, sparse),
//                        submissionFingerprint
//   OrderSubmissionLock: expiresAt TTL (expireAfterSeconds: 0)
//
// Without the TTL index locks never expire and every repeat order is blocked
// forever. Uses createIndexes() (NOT syncIndexes(), which would also DROP any
// index that isn't declared in the schema). Aborts if duplicate orderNumber
// values exist — run maintenanceScripts/findDuplicateOrders.js and resolve them first.
require("dotenv").config({ path: "./.env" });
const mongoose = require("mongoose");
const PurchaseOrder = require("../models/PurchaseOrder");
const OrderSubmissionLock = require("../models/OrderSubmissionLock");

const COMMIT = process.argv.includes("--commit");

async function run() {
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) throw new Error("MONGO_URI is not set");
  // autoIndex/autoCreate off so a dry run really changes nothing; indexes are
  // only built by the explicit createIndexes() call below (with --commit).
  await mongoose.connect(MONGO_URI, { autoIndex: false, autoCreate: false });
  console.log(`✅ Connected (${COMMIT ? "COMMIT" : "dry run"})`);

  const dup = await PurchaseOrder.aggregate([
    { $match: { orderNumber: { $exists: true } } },
    { $group: { _id: "$orderNumber", count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
    { $limit: 5 },
  ]);
  if (dup.length) {
    console.error(
      `❌ Duplicate orderNumber values exist (e.g. ${dup.map((d) => d._id).join(", ")}). ` +
        "Resolve them first (node maintenanceScripts/findDuplicateOrders.js)."
    );
    process.exitCode = 1;
    return;
  }

  for (const Model of [PurchaseOrder, OrderSubmissionLock]) {
    const { toCreate } = await Model.diffIndexes();
    console.log(`\n${Model.modelName}: ${toCreate.length} missing index(es)`);
    toCreate.forEach((i) => console.log(`  - ${JSON.stringify(i)}`));
    if (COMMIT && toCreate.length) {
      await Model.createIndexes();
      console.log("  ✅ created");
    }
  }

  const ttl = (await OrderSubmissionLock.collection.indexes().catch(() => [])).find(
    (i) => i.key && i.key.expiresAt === 1 && i.expireAfterSeconds === 0
  );
  console.log(`\nTTL index on OrderSubmissionLock.expiresAt: ${ttl ? "✅ present" : "❌ MISSING"}`);
  if (!ttl && !COMMIT) console.log("Re-run with --commit to create it.");
}

run()
  .catch((err) => {
    console.error("❌ Error:", err.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.connection.close();
    console.log("🔌 Database connection closed");
  });
