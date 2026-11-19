// CORS options for the API (used by server.js and the CORS tests).
//
// `allowedHeaders` is intentionally NOT set: the cors package then reflects the
// browser's Access-Control-Request-Headers, so custom headers such as
// `Idempotency-Key` (purchase-order create), `x-xsrf-token` and
// `ngrok-skip-browser-warning` pass the preflight. If you ever restrict
// `allowedHeaders`, you MUST include `Idempotency-Key`, or every PO create
// from the browser will be blocked by the preflight.
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "http://localhost:5175",
    "http://127.0.0.1:5000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://localhost:3002",
    "http://localhost:5000",
    "http://192.168.137.108:3000",
    "http://192.168.137.108:5000",
    "https://erp.haldengroup.ng",
    // Site Approver Portal (separate app). Add the production portal origin here.
    "http://localhost:5173",
    "http://localhost:4173",
    "https://approver.haldengroup.ng",
  ],
  credentials: true,
};

module.exports = corsOptions;
