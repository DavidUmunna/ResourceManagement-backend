/**
 * Seed (or update) a Site Approver in the REAL dev DB so you can log into the portal.
 * Idempotent — upserts by phone.
 *
 *   node maintenanceScripts/seedSiteApprover.js
 *   node maintenanceScripts/seedSiteApprover.js "+2348012345678" "MyPass123" "Jane Doe"
 */
require("dotenv").config({ path: "./.env" });
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const SiteApprover = require("../models/SiteApprover");

const MONGO_URI = process.env.MONGO_URI || "mongodb://localhost:27017/Halden_data";

// Credentials come from CLI args first, then the (gitignored) .env — never hardcoded.
const phone = (process.argv[2] || process.env.SEED_APPROVER_PHONE || "").trim();
const password = process.argv[3] || process.env.SEED_APPROVER_PASSWORD || "";
const name = process.argv[4] || process.env.SEED_APPROVER_NAME || "Test Approver";

async function main() {
  if (!phone || !password) {
    console.error(
      "Missing seed credentials. Set SEED_APPROVER_PHONE and SEED_APPROVER_PASSWORD in .env,\n" +
      "or pass them as args:  node maintenanceScripts/seedSiteApprover.js \"+234...\" \"YourPass\" \"Name\""
    );
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to ${MONGO_URI.replace(/\/\/[^@]*@/, "//***@")}`);

  const passwordHash = await bcrypt.hash(password, 10);
  const doc = await SiteApprover.findOneAndUpdate(
    { phone },
    {
      $set: {
        name,
        phone,
        site: "Demo Site",
        passwordHash,
        mustChangePassword: false, // set true to also exercise the first-login change flow
        active: true,
        otpHash: null,
        otpExpiresAt: null,
      },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  console.log("\n✅ Site approver ready:");
  console.log(`   name:     ${doc.name}`);
  console.log(`   phone:    ${doc.phone}   (login identity + where OTP is sent)`);
  console.log(`   password: ${password}`);
  console.log(`   _id:      ${doc._id}`);
  console.log("\nℹ️  No Termii key set → the login OTP is written to the BACKEND CONSOLE");
  console.log("   (look for: '[smsService:console] ... Your Halden approval code is XXXXXX').");

  await mongoose.disconnect();
  process.exit(0);
}

main().catch((e) => { console.error("Seed failed:", e); process.exit(1); });
