/**
 * Focused E2E: Project entity + skip↔project association (assign, populate, filter).
 * Real Mongo + Redis + CSRF, throwaway DB.
 */
require("dotenv").config();
process.env.MONGO_URI = "mongodb://localhost:27017/Halden_e2e_project";
process.env.PORT = "4603";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.JWT_SECRET || "e2e-secret";

const mongoose = require("mongoose");
const redis = require("redis");
const request = require("supertest");
const app = require("../server");

const SID = "e2e-project-session";
const STAFF = { userId: "000000000000000000000021", role: "global_admin", name: "E2E Admin" };
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

  // 1. create a project
  let r = await staff("post", "/api/projects").send({ name: "Acme Rig 7", code: "ACME-RIG7", client: "Acme IOC", site: "Rig 7" });
  ck("create project", r.status === 201 && !!r.body?.data?._id, JSON.stringify(r.body));
  const projectId = r.body?.data?._id;

  // duplicate code rejected
  r = await staff("post", "/api/projects").send({ name: "Dup", code: "ACME-RIG7" });
  ck("duplicate project code rejected (409)", r.status === 409, `status ${r.status}`);

  // 2. create a skip WITH a project at creation
  r = await staff("post", "/api/skiptrack/create").send({
    skip_id: "PRJ-SKIP-1", WasteStream: "Sludge", WasteSource: "rig-7", Quantity: { value: 1, unit: "u" }, projectId,
  });
  ck("create skip with projectId", r.status === 200 && !!r.body?.data?._id, JSON.stringify(r.body));
  const skipId = r.body?.data?._id;

  // 3. detail: projectId is populated (name/code visible without going to the books)
  r = await staff("get", `/api/skips/${skipId}`);
  ck("skip detail populates project name/code", r.body?.data?.projectId?.code === "ACME-RIG7", JSON.stringify(r.body?.data?.projectId));

  // 4. list filter by project returns it (and list populates code)
  r = await staff("get", `/api/skips?project=${projectId}`);
  const inList = (r.body.items || []).find((i) => i._id === skipId);
  ck("list filter ?project=<id> returns it", r.status === 200 && !!inList, JSON.stringify(r.body?.items?.length));
  ck("list row carries project code", inList?.projectId?.code === "ACME-RIG7", JSON.stringify(inList?.projectId));

  // 5. create a second skip on a DIFFERENT (no) project — filter must exclude it
  r = await staff("post", "/api/skiptrack/create").send({ skip_id: "PRJ-SKIP-2", WasteStream: "Sludge", WasteSource: "x", Quantity: { value: 1, unit: "u" } });
  const otherId = r.body?.data?._id;
  r = await staff("get", `/api/skips?project=${projectId}`);
  ck("filter excludes skips not on the project", !(r.body.items || []).some((i) => i._id === otherId));

  // 6. reassign the unassigned skip to the project via the assign endpoint
  r = await staff("put", `/api/skips/${otherId}/project`).send({ projectId });
  ck("assign project via PUT /:id/project", r.status === 200 && String(r.body?.data?.projectId) === String(projectId), JSON.stringify(r.body?.data?.projectId));
  r = await staff("get", `/api/skips?project=${projectId}`);
  ck("now both skips are under the project", (r.body.items || []).length === 2, JSON.stringify(r.body?.items?.length));

  // 7. clear a skip's project
  r = await staff("put", `/api/skips/${otherId}/project`).send({ projectId: null });
  ck("clear project (null)", r.status === 200 && !r.body?.data?.projectId, JSON.stringify(r.body?.data?.projectId));

  await mongoose.connection.dropDatabase(); await rc.del(`session:${SID}`); await rc.quit(); await mongoose.disconnect();
  console.log("\n=== PROJECT E2E ===\n" + out.join("\n") + `\n\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch((e) => { console.error("crashed:", e); process.exit(2); });
