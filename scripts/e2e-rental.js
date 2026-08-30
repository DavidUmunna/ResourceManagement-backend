/**
 * Focused E2E: prove a RENTED skip captures who/when and surfaces expiry.
 * Real Mongo + Redis + CSRF, throwaway DB.
 */
require("dotenv").config();
process.env.MONGO_URI = "mongodb://localhost:27017/Halden_e2e_rental";
process.env.PORT = "4601";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret";

const mongoose = require("mongoose");
const redis = require("redis");
const request = require("supertest");
const app = require("../server");
const skipRepo = require("../repositories/skip.repository");

const SID = "e2e-rental-session";
const STAFF = { userId: "000000000000000000000009", role: "global_admin", name: "E2E Admin" };

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

  // rental window: started 5 days ago, expires in 2 days
  const start = new Date(Date.now() - 5 * 864e5).toISOString();
  const end = new Date(Date.now() + 2 * 864e5).toISOString();

  // 1. create a RENTED skip (the "New Skip → rented" path)
  let r = await staff("post", "/api/skiptrack/create").send({
    skip_id: "RENT-SKIP-1", WasteStream: "Sludge", WasteSource: "rig-3", Quantity: { value: 1, unit: "unit" },
    ownership: "rented", rentedFromCompany: "Acme Rentals Ltd", projectRef: "PRJ-42",
    rentalStart: start, rentalExpectedEnd: end,
  });
  ck("create rented skip", r.status === 200 && !!r.body?.data?._id, JSON.stringify(r.body));
  const id = r.body?.data?._id;

  // 2. read it back — who + window persisted
  r = await staff("get", `/api/skips/${id}`);
  const s = r.body?.data;
  ck("persists rentedFromCompany", s?.rentedFromCompany === "Acme Rentals Ltd", JSON.stringify(s?.rentedFromCompany));
  ck("persists ownership=rented", s?.ownership === "rented", JSON.stringify(s?.ownership));
  ck("persists projectRef", s?.projectRef === "PRJ-42");
  ck("persists rental window (start+end)", !!s?.rentalStart && !!s?.rentalExpectedEnd, JSON.stringify({ st: s?.rentalStart, en: s?.rentalExpectedEnd }));
  ck("expiry date is the expected end", new Date(s?.rentalExpectedEnd).toDateString() === new Date(end).toDateString(), s?.rentalExpectedEnd);

  // 3. list surfaces ownership so the UI can flag it
  r = await staff("get", "/api/skips?ownership=rented");
  ck("list filter ownership=rented returns it", r.status === 200 && r.body.items?.some((i) => i._id === id), JSON.stringify(r.body?.items?.length));

  // 4. the nag query (drives the cron + the 'expiring' badge) picks it up within lead window
  const threshold = new Date(Date.now() + 3 * 864e5); // 3-day lead
  const expiring = await skipRepo.findExpiringRentals(threshold);
  const hit = expiring.find((e) => String(e._id) === String(id));
  ck("expiry-nag query flags it (who + when available)", !!hit && hit.rentedFromCompany === "Acme Rentals Ltd" && !!hit.rentalExpectedEnd,
    JSON.stringify({ found: !!hit, from: hit?.rentedFromCompany }));

  // 5. NOT flagged if expiry is far out (control)
  const r2 = await staff("post", "/api/skiptrack/create").send({
    skip_id: "RENT-SKIP-2", WasteStream: "Sludge", WasteSource: "rig-4", Quantity: { value: 1, unit: "u" },
    ownership: "rented", rentedFromCompany: "Acme", rentalExpectedEnd: new Date(Date.now() + 60 * 864e5).toISOString(),
  });
  const far = await skipRepo.findExpiringRentals(new Date(Date.now() + 3 * 864e5));
  ck("far-future rental NOT flagged (control)", !far.some((e) => String(e._id) === String(r2.body?.data?._id)));

  await mongoose.connection.dropDatabase(); await rc.del(`session:${SID}`); await rc.quit(); await mongoose.disconnect();
  console.log("\n=== RENTED-SKIP E2E ===\n" + out.join("\n") + `\n\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
