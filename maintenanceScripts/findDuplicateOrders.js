// findDuplicateOrders.js — READ-ONLY duplicate purchase-order report.
//
// Never modifies data (there is deliberately no --commit flag). Finance/admins
// resolve the reported duplicates by hand.
//
//   node maintenanceScripts/findDuplicateOrders.js [--window-minutes 60] [--csv report.csv]
//
// Reports:
//   1. Possible duplicate orders: same staff + trimmed/lowercased Title +
//      supplier + order total (Σ price × quantity) whose createdAt values are
//      within --window-minutes of each other (chained).
//   2. Duplicate orderNumber values. This MUST be empty before the unique
//      orderNumber index can be built (see maintenanceScripts/syncOrderIndexes.js).
require("dotenv").config({ path: "./.env" });
const fs = require("fs");
const mongoose = require("mongoose");

const norm = (s) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

function parseArgs(argv) {
  const args = { windowMinutes: 60, csv: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--window-minutes") args.windowMinutes = Number(argv[++i]);
    else if (argv[i] === "--csv") args.csv = argv[++i];
  }
  if (!Number.isFinite(args.windowMinutes) || args.windowMinutes <= 0) {
    throw new Error("--window-minutes must be a positive number");
  }
  return args;
}

const orderTotal = (products) =>
  (Array.isArray(products) ? products : []).reduce(
    (sum, p) => sum + (Number(p?.price) || 0) * (Number(p?.quantity) || 0),
    0
  );

const approversOf = (o) =>
  (o.Approvals || [])
    .filter((a) => a && a.admin)
    .map((a) => `${a.admin}${a.status ? ` (${a.status})` : ""}`)
    .join("; ");

/**
 * Group orders by staff + Title + supplier + total, then split each group into
 * clusters whose consecutive createdAt gaps are within the window. Returns only
 * clusters with more than one order. Pure function (exported for tests).
 */
function findPossibleDuplicates(orders, windowMinutes) {
  const windowMs = windowMinutes * 60 * 1000;
  const groups = new Map();
  for (const o of orders) {
    const key = [String(o.staff ?? ""), norm(o.Title), norm(o.supplier), orderTotal(o.products)].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(o);
  }

  const clusters = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    let current = [list[0]];
    for (let i = 1; i < list.length; i++) {
      const gap = new Date(list[i].createdAt) - new Date(list[i - 1].createdAt);
      if (gap <= windowMs) current.push(list[i]);
      else {
        if (current.length > 1) clusters.push(current);
        current = [list[i]];
      }
    }
    if (current.length > 1) clusters.push(current);
  }
  return clusters;
}

const csvCell = (v) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function toRow(report, groupId, o) {
  return {
    report,
    groupId,
    orderNumber: o.orderNumber,
    _id: o._id ? String(o._id) : "",
    staff: o.staff ? String(o.staff) : "",
    Title: o.Title,
    supplier: o.supplier,
    total: orderTotal(o.products),
    status: o.status,
    paymentStatus: o.payment?.status,
    createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : "",
    approvers: approversOf(o),
  };
}

async function run() {
  const args = parseArgs(process.argv.slice(2));
  const MONGO_URI = process.env.MONGO_URI;
  if (!MONGO_URI) throw new Error("MONGO_URI is not set");

  const PurchaseOrder = require("../models/PurchaseOrder");
  // autoIndex/autoCreate off: loading the model must not build indexes or
  // create collections — this report never modifies the database.
  await mongoose.connect(MONGO_URI, { autoIndex: false, autoCreate: false });
  console.log("✅ Connected (read-only report — nothing will be modified)");

  const fields = "orderNumber staff Title supplier products status payment.status createdAt Approvals";
  const orders = await PurchaseOrder.find({}, fields).lean();
  console.log(`🔍 Scanned ${orders.length} purchase orders (window ${args.windowMinutes} min)\n`);

  const rows = [];

  // 1. Possible duplicates
  const clusters = findPossibleDuplicates(orders, args.windowMinutes);
  console.log(`── 1. Possible duplicate orders: ${clusters.length} group(s) ──`);
  clusters.forEach((cluster, i) => {
    const first = cluster[0];
    console.log(
      `\n  Group ${i + 1}: staff=${first.staff} Title="${first.Title}" supplier="${first.supplier}" total=${orderTotal(first.products)}`
    );
    for (const o of cluster) {
      const r = toRow("possible_duplicate", i + 1, o);
      rows.push(r);
      console.log(
        `    ${r.orderNumber}  ${r._id}  status=${r.status}  payment=${r.paymentStatus || "-"}  createdAt=${r.createdAt}  approvers=${r.approvers || "-"}`
      );
    }
  });

  // 2. Duplicate orderNumber values
  const dupNumbers = await PurchaseOrder.aggregate([
    { $match: { orderNumber: { $exists: true } } },
    { $group: { _id: "$orderNumber", ids: { $push: "$_id" }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } },
  ]);
  console.log(`\n── 2. Duplicate orderNumber values: ${dupNumbers.length} ──`);
  if (dupNumbers.length === 0) {
    console.log("  None — the unique orderNumber index can be built.");
  } else {
    console.log("  ⚠️  Resolve these by hand BEFORE building the unique orderNumber index:");
    const byId = new Map(orders.map((o) => [String(o._id), o]));
    dupNumbers.forEach((d, i) => {
      console.log(`  ${d._id}: ${d.ids.map(String).join(", ")}`);
      d.ids.forEach((id) => {
        const o = byId.get(String(id));
        if (o) rows.push(toRow("duplicate_order_number", i + 1, o));
      });
    });
  }

  if (args.csv) {
    const header = Object.keys(toRow("", 0, {}));
    const lines = [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(","))];
    fs.writeFileSync(args.csv, lines.join("\n") + "\n");
    console.log(`\n📄 CSV written to ${args.csv} (${rows.length} row(s))`);
  }

  return { clusters: clusters.length, duplicateOrderNumbers: dupNumbers.length };
}

if (require.main === module) {
  run()
    .catch((err) => {
      console.error("❌ Error:", err.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.connection.close();
      console.log("🔌 Database connection closed");
    });
}

module.exports = { findPossibleDuplicates, orderTotal, parseArgs };
