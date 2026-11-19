// departmentMismatchReport.js — compares users.Department with department membership.
//
// Department membership (the Department collection) is now the source of truth and
// users.Department mirrors it (see services/departmentMembership.js). Run this BEFORE
// deploying that change to see whose users.Department will move, because
// users.Department drives purchase-order routing.
//
//   node maintenanceScripts/departmentMismatchReport.js            # report only (default)
//   node maintenanceScripts/departmentMismatchReport.js --csv out.csv
//   node maintenanceScripts/departmentMismatchReport.js --apply    # fix the safe cases
//
// --apply only changes users who belong to exactly ONE department and whose
// users.Department differs from it. Everything else is reported for a person to decide.
require("dotenv").config({ path: "./.env" });
const fs = require("fs");
const mongoose = require("mongoose");
const User = require("../models/users_");
const Department = require("../models/Department");

function parseArgs(argv) {
  const args = { apply: false, csv: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--apply") args.apply = true;
    else if (argv[i] === "--csv") args.csv = argv[++i];
  }
  return args;
}

async function buildReport() {
  const [users, departments] = await Promise.all([
    User.find().select("name email Department").lean(),
    Department.find().select("name users headOfDepartment").lean(),
  ]);
  const validNames = User.schema.path("Department").enumValues || [];
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const membershipsByUser = new Map(); // userId -> [department names]
  const orphanMembers = [];
  for (const d of departments) {
    for (const m of d.users || []) {
      const id = String(m._id);
      if (!userById.has(id)) {
        orphanMembers.push({ department: d.name, memberId: id, memberName: m.name });
        continue;
      }
      if (!membershipsByUser.has(id)) membershipsByUser.set(id, []);
      membershipsByUser.get(id).push(d.name);
    }
  }

  const rows = [];
  for (const u of users) {
    const memberships = membershipsByUser.get(String(u._id)) || [];
    const current = u.Department || "";
    let issue = null;
    let fixTo = null;

    if (memberships.length > 1) {
      issue = "in several departments — choose a home department by hand";
    } else if (memberships.length === 1 && memberships[0] !== current) {
      if (validNames.includes(memberships[0])) {
        issue = "users.Department differs from membership";
        fixTo = memberships[0];
      } else {
        issue = `member of "${memberships[0]}", which is not a valid users.Department value`;
      }
    } else if (memberships.length === 0 && current && departments.some((d) => d.name === current)) {
      issue = `users.Department is "${current}" but not listed as a member there`;
    }

    if (issue) {
      rows.push({ name: u.name, email: u.email, current, memberships: memberships.join(" | "), issue, fixTo });
    }
  }

  const unknownDepartments = departments
    .filter((d) => !validNames.includes(d.name))
    .map((d) => d.name);

  return { rows, orphanMembers, unknownDepartments, userCount: users.length, departmentCount: departments.length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI is not set");
  await mongoose.connect(process.env.MONGO_URI);

  const report = await buildReport();
  console.log(`Checked ${report.userCount} users across ${report.departmentCount} departments.\n`);

  if (report.rows.length === 0) {
    console.log("No mismatches between users.Department and department membership.");
  } else {
    console.log(`${report.rows.length} user(s) need attention:\n`);
    console.table(report.rows.map(({ fixTo, ...r }) => ({ ...r, "will become (--apply)": fixTo || "—" })));
  }
  if (report.orphanMembers.length) {
    console.log("\nDepartment members whose user no longer exists:");
    console.table(report.orphanMembers);
  }
  if (report.unknownDepartments.length) {
    console.log("\nDepartments whose name is not a valid users.Department value (never synced):");
    report.unknownDepartments.forEach((n) => console.log(`  - ${n}`));
  }

  if (args.csv) {
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["name", "email", "current", "memberships", "issue", "fixTo"].join(",")]
      .concat(report.rows.map((r) => [r.name, r.email, r.current, r.memberships, r.issue, r.fixTo].map(esc).join(",")));
    fs.writeFileSync(args.csv, lines.join("\n"));
    console.log(`\nWrote ${args.csv}`);
  }

  if (args.apply) {
    const fixable = report.rows.filter((r) => r.fixTo);
    for (const r of fixable) {
      await User.updateOne({ email: r.email }, { $set: { Department: r.fixTo } });
    }
    console.log(`\n--apply: updated users.Department for ${fixable.length} user(s). Other rows were left alone.`);
  } else {
    console.log("\nReport only — nothing was changed. Re-run with --apply to fix the single-department rows.");
  }

  await mongoose.disconnect();
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error(err.message || err);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  });
}

module.exports = { buildReport };
