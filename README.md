# Procurement API

RESTful backend for procurement operations, file tracking, compliance logging, tender management, and AI-assisted queries. Swagger docs are auto-generated from JSDoc annotations and served via Swagger UI.

## Table of Contents
- [Features](#features)
- [🆕 RFID Skip Tracking](#-rfid-skip-tracking-new)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [API Docs](#api-docs)
- [Key Modules](#key-modules)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [Workflows](#workflows)
- [Error Handling](#error-handling)
- [Contributing](#contributing)

## Features
- Purchase orders, suppliers, products, inventory, and assets management.
- Tender management with documents, checklists, drafts, and requirements.
- JWT auth with role-based access via `middlewares/check-auth` and optional two-factor auth via `middlewares/TwoFactorVerify`.
- File tracking with expiry checks (daily cron), push notifications, and email alerts for expired tracks.
- Compliance logging automatically generated for FileTrack create/update/delete actions (read-only endpoints to query logs).
- Feedback collection and retrieval (`routes/v2/feedback.routes.js`).
- Email notifications (OTP, request updates, expired filetracks) using Nodemailer.
- Firebase push notifications (`Global_Functions/firebasePushNotification.js`, `pushNotifications/fileTrack.js`).
- AI assistant (Gemini) with RAG, embeddings, and document search (`ai/`, `services/ai/`).
- CSRF protection, CORS, Helmet, rate limiting, and CSP hooks.
- Docker support via `Dockerfile` and `docker-compose.yml`.
- Monitoring and analytics endpoints (`routes/v1/Monitoring_route.js`, `controllers/v1.controllers/Monitoring_control.js`).
- **Google Cloud Storage** for file uploads (private bucket, uniform access control) with legacy Google Drive fallback for existing records.
- **Payment recording** on purchase orders — accountant records reference, channel, and amount; generates a Word document receipt on demand.
- **Cascade delete** — deleting an order also removes its GCS (or Drive) attachment and file document.
- **CI via GitHub Actions** — tests run on Node 18.x and 20.x on every push/PR to `main`.
- 🆕 **RFID Skip Tracking** — end-to-end relational skip lifecycle (trucks, drivers, RFID scans, waybills, manifests), an external **Site Approver Portal** with SMS OTP, **Projects** with **per-day USD pricing & revenue**, and a **per-skip rate override**. See the highlighted section below.

---

## 🆕 RFID Skip Tracking (NEW)

> **New end-to-end feature.** Turns the flat skip records into a full relational lifecycle: physical skips carry **RFID tags**, move on **trucks** driven by **drivers**, are dispatched under **waybills** and disposed under **manifests** signed by external **site approvers**, are grouped by **project/IOC**, and **earn revenue** at a daily USD rate. Every action is **compliance-logged**.
>
> **All new work is additive and backward-compatible** — the legacy `/api/skiptrack` CRUD and existing FileTrack compliance logging are untouched.

### New entities & endpoints

| Entity | Endpoints (base) | Notes |
|---|---|---|
| **Truck** | `/api/trucks` | `POST /`, `GET /`, `GET /:id`, `PUT /:id`, `PUT /:id/assign-driver` (FR-1: reassignment always allowed) |
| **Driver** | `/api/drivers` | `POST /`, `GET /`, `GET /:id`, `PUT /:id` |
| **Skip (relational ops)** | `/api/skips` | `GET /` (filters: search, wasteStream, ownership, active, **stage**, **project**, pagination), `GET /:id` (populated), `POST /:id/register-tag` (FR-7/8), `PUT /:id/assign-delivery-truck` & `assign-collection-truck` (FR-2/5), `POST /scan` (RFID, FR-9/11/6), `POST /manual-scan` (supervisor+, FR-10), `PUT /:id/return` (FR-16), `PUT /:id/rental`, `PUT /:id/project`, `PUT /:id/rate` (**per-skip rate override**) |
| **Waybill** | `/api/waybills` | Dispatch document. `POST /`, `GET /`, `GET /:id`, `PUT /:id/approve` & `PUT /:id/reject` (internal **2FA/OTP**, FR-17d). A skip can't **mobilize** unless it's on an **approved** waybill (FR-17e). |
| **Manifest** | `/api/manifests` | Disposal document for **demobilized-only** skips. Staff: `POST /`, `GET /`, `GET /:id`, `GET /:id/pdf` (pdfkit), `PUT /:id/attach-skips`. Approver-scoped: `GET /mine`, `GET /mine/:id`, `GET /mine/:id/pdf`. Sign/reject: `PUT /:id/sign` & `PUT /:id/reject` (**Site-Approver session + fresh point-of-action OTP**, FR-19). |
| **SiteApprover** | `/api/site-approvers` | External, non-staff approvers on their **own auth** (JWT, not the Redis session). `POST /login` → SMS OTP → `POST /verify-otp` → JWT; `POST /request-otp`, `POST /change-password`. **Self-service recovery:** `POST /forgot-password` (phone → SMS code) + `POST /reset-password` (phone + code + new password) — no admin bottleneck. Admin (staff): `POST /` create, `GET /` list, `PUT /:id` (deactivate/reactivate, admin password reset). |
| **Project** | `/api/projects` | Operational job/IOC a skip is deployed to. `POST /`, `GET /`, `GET /:id`, `PUT /:id`, and **`GET /revenue?from=&to=`** (skip revenue rolled up per project). Carries `dailyRateUsd` (USD/skip/day). |

### Pricing & revenue
- Each **Project** has a **daily USD rate per skip** (`dailyRateUsd`). A skip may set a **per-skip override** (`PUT /api/skips/:id/rate`) that wins over the project rate.
- **Revenue = billable days × effective rate**, where **billable days = mobilized → demobilized** (or → now if still on site). Partial days round **up** (`Math.ceil`) — standard rental convention; change in `services/revenue.service.js` if you prefer round/floor.
- `GET /api/projects/revenue` rolls this up per project (+ totals, + count of un-rated deployed skips).
- The legacy **Skips Management** page shows **Rate / Revenue** columns and inline per-skip rate editing, and the **Excel/CSV/PDF export** (`POST /api/skiptrack/export`) includes **Project, Rate $/day, Billable Days, Revenue (USD)**.

### Auth, OTP & SMS
- **Internal 2FA** (waybill approve/reject) reuses the existing OTP model + `middlewares/TwoFactorVerify` (`POST /api/otp/:id/send-otp`).
- **Site Approver OTP** is delivered over **SMS via a provider-agnostic seam** (`services/smsService.js`). The concrete adapter is **Termii**; with no `TERMII_API_KEY` it falls back to a console adapter (logs the code) so flows work before the provider is wired. Manifest sign/reject additionally require a **fresh OTP at the point of action** (`middlewares/check-approver-otp.js`, FR-19).

### Compliance logging
- `models/ComplianceLog.js` is now **polymorphic** (`refPath`) over both the entity (`entityType`/`entityModel`: FileTrack, Skip, Truck, Driver, Waybill, Manifest, SiteApprover, **Project**) and the **actor** (`performedByModel`: `user` **or** `siteapprover`).
- `action` enum extended: `CREATE, UPDATE, DELETE, SCAN, MANUAL_SCAN, APPROVE, REJECT, SIGN, RETURN, LOGIN`. Logging is best-effort (never breaks the primary action) via `services/ComplianceLog.service.js`.

### Notifications & crons
- `notifyIssue()` (`services/NotificationService.js`) emails issue-notify roles on manual scans, tag conflicts, waybill/manifest rejections, and rental expiry.
- Daily rented-skip **expiry nag** cron (`Global_Functions/checkSkipRentalExpiry.js`).

### Dashboard insights (replaces the moving-average chart)

The Skips Management page previously showed a **moving-average** line of daily waste
tonnes. That was removed: a moving average smooths *noisy, high-frequency* signals,
but skip movements are **sparse, discrete events** — averaging them flattens exactly
the spikes (the busy days, the stuck skips) an operations manager needs to see, and
it was a single undifferentiated line disconnected from the decisions the team
actually makes (collection, utilization, revenue).

It is replaced by **`GET /api/skiptrack/insights?from=&to=`** ([`services/skipInsights.service.js`](services/skipInsights.service.js)),
which powers the **Skip Insights** panel. Instead of smoothing, it surfaces
decision-focused metrics:

| Metric | What it is | Question it answers |
|---|---|---|
| **On site now** | Skips mobilized, not yet demobilized, active | How many skips are currently deployed? |
| **Overdue** | On-site longer than `SKIP_OVERDUE_DAYS` (default 14) | Which collections are running late? |
| **Utilization %** | On-site ÷ active skips | How much of the fleet is working vs idle? |
| **Avg turnaround** | Mean days mobilize → demobilize (in range) | Are skips cycling faster or getting stuck? |
| **Rentals expiring** | Rented skips within the nag lead window | What needs return/renewal soon? |
| **Period revenue** | From the pricing engine (`computeRevenue`) | What did the skips earn this period? |
| **Throughput** (weekly) | Mobilized vs demobilized per week | Is a backlog building (out > back)? |
| **Turnaround trend** (weekly) | Avg turnaround per week | Is efficiency improving over time? |
| **By waste stream** | Tonnes per stream (kg normalized) | What's the waste mix? |
| **By project / IOC** | Skips + revenue per project | Which client drives volume and money? |

Frontend: [`src/pages/skips/SkipInsights.jsx`](../ResouceManagement-Frontend/src/pages/skips/SkipInsights.jsx) —
a KPI-card strip + throughput bar chart, turnaround line, waste-by-stream doughnut,
and a revenue-by-project table, with a date-range picker. It lives on its **own
page** (`/admin/skip-insights`, sidebar → Operations → **Skip Insights**), keeping
the **Skips Management** page focused on the register / edit / export. The legacy
`movingAverage.jsx` component was deleted.

> **Note:** the weekly aggregations run in JS over skips whose mobilize/demobilize
> dates fall in the range — fine at small/medium volumes; move to a Mongo aggregation
> pipeline if the skip collection grows very large.

**Driver model cleanup:** driver records now use **name · rfidTag · licenseNo**;
the speculative `badgeId` field was removed.

### Site approver lifecycle
- **Provisioning:** an admin/global_admin adds an approver from the **Site Approvers** tab in the ERP module (name, phone, site, temp password). The temp password is shown once to hand over; the approver must change it on first login.
- **Recovery (no bottleneck):** if an approver forgets their password they reset it themselves from the portal — **Forgot password → phone → SMS code → new password**. Admins can also deactivate/reactivate or issue a fresh temp password as a fallback.

### Frontends
- **ERP module** (staff): `/admin/skip-tracking` in the React app — tabs for **Skips, Trucks & Drivers, Waybills, Manifests, Projects, Revenue, Site Approvers, Compliance**. Role-gated via the existing `RoleGuard`; "dispatcher" maps to the Waste-Management roles. **Skip Insights** is its own page (sidebar → Operations); **Skips Management** stays the register/export view (skip creation now lives in the RFID module).
- **Site Approver Portal** (external): a **separate standalone Vite + React app** in its **own repo** (`/Users/admin/site-approver-portal`, sibling of the ERP frontend & backend) — mobile-first login → OTP → manifest list → detail → approve/reject with OTP re-verify. Its own README, `.env.example`, and independent build/deploy. Its production origin must be added to this backend's CORS allow-list.

### Migration
- `maintenanceScripts/migrateSkipsRelational.js` — idempotent, **dry-run by default** (`--commit` to write): backfills skip lifecycle fields, seeds Driver/Truck from legacy free-text names, and backfills ComplianceLog discriminators.

### End-to-end smoke tests (real Mongo + Redis, throwaway DBs)
Beyond the mocked Jest suites, these exercise the running stack (they caught real bugs the mocks missed — e.g. the compliance `action` enum and a rental date-off-by-one):
```bash
node scripts/e2e-smoke.js      # full lifecycle: truck→driver→skip→waybill→scan→manifest→sign→pdf→compliance
node scripts/e2e-rental.js     # rented-skip capture (vendor/window) + expiry-nag query
node scripts/e2e-project.js    # project assign / populate / filter
node scripts/e2e-revenue.js    # revenue math, per-skip override, Excel export
node scripts/e2e-insights.js   # dashboard KPIs, throughput, turnaround, by-stream/project
node scripts/e2e-approver.js   # approver provisioning + self-service password recovery
```

## Requirements
- Node.js 18.x or 20.x (CI-tested); 22.x in production
- npm
- MongoDB instance
- Google Cloud Storage service account key (`google-service-account-gcs.json`) — required for file upload/download

## Installation
```bash
git clone https://github.com/DavidUmunna/procurement_api.git
cd procurement_api
npm install
```

Place your GCS service account key file at the repo root as `google-service-account-gcs.json` (gitignored).

## Usage
Start the server:
```bash
npm start
```
Default base URL: `http://localhost:5000`

**With PM2** (recommended for production):
```bash
pm2 start ecosystem.config.js
```
`ecosystem.config.js` is gitignored — create it locally. A minimal example:
```js
module.exports = {
  apps: [{
    name: "Halden_backend",
    script: "server.js",
    ignore_watch: [".git", "node_modules", "logs", "__tests__", "*.log"],
  }]
};
```

To run with Docker:
```bash
docker-compose up
```

## API Docs
- Swagger UI: `GET /api/docs`
- OpenAPI JSON: `GET /api/docs.json`
- Postman collection: see `postmanDocs/api-collection.json` in this repo.
- Online Postman workspace: https://web.postman.co/workspace/e5bc1f52-e254-4f25-8d9d-18276e1a8d04

Docs are generated from JSDoc blocks in routes/controllers/models using `swagger-jsdoc` + `swagger-ui-express` (see `docs/swagger.js`). The Postman docs mirror the current routes, including v1, v2, and AI endpoints.

## Key Modules
- **File tracking**: `routes/v2/FileTracking.js`, `services/FileTracking.service.js`, `repositories/FileTracking.repository.js`, `Global_Functions/checkExpiry.js` (daily expiry cron).
- **Compliance logs**: `models/ComplianceLog.js`, `routes/v2/ComplianceLog.js`, `controllers/v2.controllers/ComplianceLog.controllers.js`, `services/ComplianceLog.service.js`, `repositories/ComplianceLog.repository.js`.
- **Orders v2**: `routes/v2/order.routes.js`, `controllers/v2.controllers/orders.controllers.js`, `services/order.service.js`, `repositories/order.repository.js`.
- **Tender management**: `routes/v1/tender.js`, `services/tender.service.js`, `services/tenderUpload.service.js`, `repositories/tender.repository.js`, `repositories/documents.repository.js`, `repositories/drafts.repository.js`, `repositories/requirements.repository.js`, `repositories/checklist.repository.js`.
- **Feedback**: `routes/v2/feedback.routes.js`, `services/FeedbackService.js`, `repositories/FeedbackRepository.js`, `models/Feedback.js`.
- **Notifications**: `controllers/v1.controllers/notification.js`, `services/NotificationService.js`, `emailnotification/emailNotification.js`, `pushNotifications/fileTrack.js`, `Global_Functions/firebasePushNotification.js`.
- **Auth**: `middlewares/check-auth.js`, `middlewares/TwoFactorVerify.js`, `routes/v1/signin.js`, `routes/v1/users.js`.
- **AI (Gemini + RAG)**: `ai/ai.routes.js`, `ai/ai.controller.js`, `ai/geminiClient.js`, `ai/ai.prompts.js`, `services/ai/aiGateway.service.js`, `services/ai/embedding.service.js`, `services/ai/rag.service.js`.
- **Monitoring & analytics**: `routes/v1/Monitoring_route.js`, `controllers/v1.controllers/Monitoring_control.js`, `controllers/v1.controllers/Analytics.js`, `controllers/v1.controllers/RequestsAnalytics.js`.
- **Audit**: `repositories/audit.repository.js`, `models/AuditLog.js`.
- **Leave management**: `routes/v2/leave.routes.js`, `controllers/v2.controllers/leave.controllers.js`, `services/leave.service.js`, `repositories/leave.repository.js`, `models/LeaveRequest.js`, `models/LeaveBalance.js`, `services/validation/LeaveValidator.js`, `constants/leave.constants.js`.
- **File storage (GCS)**: `googlecloudstorage.service.js` — upload (disk or buffer), download, and delete objects from the `halden-backend-storage` GCS bucket. `googledriveservice.js` is retained for legacy record fallback only.
- **File upload routes**: `routes/v1/fileupload.js` — upload writes to GCS; download checks `gcsObjectName` first, falls back to `driveFileId` for pre-migration records.
- **Skips tracking**: `routes/v1/skips_route.js`, `models/skips_tracking.js` — tracks waste skip mobilisation and demobilisation for the waste management site. Supports filtering by waste stream, date range, and source well; exports to Excel, CSV, or PDF. Analytics via `controllers/v1.controllers/Analytics.js`.

## Project Structure (abridged)
```
procurement_api/
├── server.js                     # Express setup, routes, middleware, swagger UI
├── db.js                         # MongoDB connection
├── docs/swagger.js               # swagger-jsdoc config
├── Dockerfile / docker-compose.yml
├── googlecloudstorage.service.js # GCS upload / download / delete
├── googledriveservice.js         # Legacy Drive helpers (download/delete fallback)
├── Uploadexceltodrive.js         # Excel export → GCS upload
├── ecosystem.config.js           # PM2 config (gitignored — create locally)
├── .github/workflows/ci.yaml     # GitHub Actions: test on Node 18.x + 20.x
├── Global_Functions/             # Cron jobs (checkExpiry), pagination, Firebase push
├── ai/                           # Gemini AI routes, controller, client, prompts
├── adapters/                     # External service adapters
├── constants/                    # Shared constants
├── controllers/
│   ├── v1.controllers/           # Notifications, OTP, monitoring, analytics, signatures
│   └── v2.controllers/           # FileTracking, ComplianceLog, Orders
├── routes/
│   ├── v1/                       # orders, users, suppliers, products, inventory, assets,
│   │                             # tender, OTP, payments, scheduling, monitoring, uploads, etc.
│   └── v2/                       # FileTracking, ComplianceLog, feedback, orders
├── services/                     # Business logic
│   ├── ai/                       # aiGateway, embedding, RAG
│   ├── validation/               # Input validators
│   └── *.service.js              # FileTracking, ComplianceLog, order, tender, feedback, etc.
├── repositories/                 # Data access layer (one per model/domain)
├── models/                       # Mongoose schemas
├── middlewares/                  # check-auth, TwoFactorVerify, CSP, rate limiter, etc.
├── emailnotification/            # Nodemailer setup + CSRF utils
├── pushNotifications/            # Firebase push (fileTrack)
├── maintenanceScripts/           # One-off migration/maintenance scripts
└── __tests__/                    # Test suite (routes/v1, routes/v2, controllers, integration)
```

## Workflows

### Order Management

**Lifecycle**: `Pending` → `Approved` (all approvers sign off) → optionally `Escalated` → `Paid`

1. **Create**: `POST /api/orders` — saved with status `"Pending"`.
2. **Approve**: `PUT /api/orders/:id/approve` — admin adds their name to the `Approvals` array.
3. **Escalate**: `PUT /api/orders/:id/escalate` — owner only; requires at least one pending approval remaining.
4. **De-escalate**: `PUT /api/orders/:id/deescalate` — owner or approver; removes escalation flag.
5. **Record payment**: `POST /api/orders/:id/pay/record` — accountant/finance records payment offline; marks order as paid.
6. **Download receipt**: `GET /api/orders/:id/pay/receipt` — returns a generated `.docx` payment receipt.
7. **Delete**: `DELETE /api/orders/:id` — cascades: removes the GCS or Drive attachment object and the file document.
8. **Fetch**: `GET /api/orders/:email` (own orders) or `GET /api/orders` (admin, all orders).

**Record payment request body**
```json
{
  "reference": "PSK-20240701-ABC123",
  "channel": "Bank Transfer",
  "amount": 150000,
  "paidAt": "2026-07-01T10:00:00.000Z"
}
```

### File Upload / Download

Files are stored in Google Cloud Storage (`halden-backend-storage`, private bucket, uniform access control).

- **Upload**: `POST /api/upload` — multipart file upload; stores object in GCS and saves `gcsObjectName` + `gcsBucket` on the file document.
- **Download**: `GET /api/upload/:fileId` — streams from GCS using `gcsObjectName`; falls back to Google Drive using `driveFileId` for records uploaded before the GCS migration.

Files are cascade-deleted from GCS (or Drive) when their parent order is deleted.

### Leave Management

Leave requests follow a **Pending → Approved / Rejected** lifecycle. Approving a request deducts days from the user's balance and sets their `WorkStatus` to `"On-Leave"`. New users default to `WorkStatus: "On-Site"`.

**Access control**
| Action | Required role |
|---|---|
| Create / cancel own request | Any authenticated user |
| View own requests & balance | Any authenticated user |
| Approve / reject any request | `admin`, `global_admin` |
| View any user's balance | `admin`, `global_admin` |
| Update entitlement | `admin`, `global_admin` |

**Leave types**: `Annual` (21 days), `Sick` (10), `Maternity` (90), `Paternity` (5), `Emergency` (3), `Unpaid` (0 — unlimited).
Defaults can be overridden per-user via the update-entitlement endpoint.

**Endpoints** (base: `/api/v2/leave`)

| Method | Path | Description |
|---|---|---|
| `POST` | `/requests` | Submit a leave request |
| `GET` | `/requests` | List requests (own or all for admin) |
| `GET` | `/requests/:id` | Get single request |
| `PUT` | `/requests/:id/approve` | Approve request (admin) |
| `PUT` | `/requests/:id/reject` | Reject request (admin) |
| `DELETE` | `/requests/:id` | Cancel a pending request |
| `GET` | `/balance` | Get own leave balance |
| `GET` | `/balance/:userId` | Get a specific user's balance (admin) |
| `PUT` | `/balance/:userId` | Update a user's entitlement (admin) |

**Request body — create request**
```json
{
  "leaveType": "Annual",
  "startDate": "2026-07-01",
  "endDate": "2026-07-05",
  "reason": "Annual family vacation"
}
```

**Request body — update entitlement**
```json
{
  "leaveType": "Annual",
  "entitlement": 25
}
```

### Skips Tracking

Tracks physical waste skips (containers) mobilised and demobilised at the Waste Management site — including truck details, waste stream classification, quantities, and manifest numbers.

**Waste streams**: `WBM_Affluent`, `OBM_Cutting`, `WBM_cutting`, `OBM_Affluent`, `Sludge`, `Others`

**Schema fields**

| Field | Type | Required | Description |
|---|---|---|---|
| `skip_id` | String | ✅ | Unique identifier for the skip unit |
| `WasteStream` | String (enum) | ✅ | Type of waste — `WBM_Affluent`, `OBM_Cutting`, `WBM_cutting`, `OBM_Affluent`, `Sludge`, `Others` |
| `WasteSource` | String | ✅ | Origin well or source location |
| `DeliveryWaybillNo` | Number | | Waybill number on delivery |
| `DateMobilized` | Date | | Date the skip was mobilised to site |
| `DateReceivedOnLocation` | Date | | Date the skip arrived on location |
| `SkipsTruckRegNo` | String | | Registration number of the truck carrying the skip |
| `SkipsTruckDriver` | String | | Name of the skip truck driver |
| `Quantity.value` | Number | | Quantity of waste |
| `Quantity.unit` | String | | Unit of quantity — `kg`, `tonne`, `ton`, `t` |
| `DispatchManifestNo` | String | | Dispatch manifest reference number |
| `WasteTruckRegNo` | String | | Registration number of the waste collection truck |
| `WasteTruckDriverName` | String | | Name of the waste truck driver |
| `DemobilizationOfFilledSkips` | Date | | Date the filled skip was demobilised |
| `DateFilled` | Date | | Date the skip was filled |
| `lastUpdated` | Date | | Timestamp of last update (auto-set) |
| `createdAt` / `updatedAt` | Date | | Mongoose auto timestamps |

**Endpoints** (base: `/api/skips`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/` | List skip records (filter by `WasteStream`, `startDate`, `endDate`, `searchTerm`; paginated) |
| `GET` | `/stats` | Aggregate totals — item count, total tonnes, categories |
| `GET` | `/categories` | List of valid waste stream values |
| `GET` | `/analytics` | Skip analytics breakdown |
| `POST` | `/create` | Create a new skip record |
| `PUT` | `/:id` | Update a skip record |
| `DELETE` | `/:id` | Delete a skip record |
| `POST` | `/export` | Export filtered records to `.xlsx`, `.csv`, or `.pdf` |

**Export request body**
```json
{
  "startDate": "2026-01-01",
  "endDate": "2026-07-31",
  "stream": "OBM_Cutting",
  "WasteSource": "WELL-12",
  "fileName": "skips-q1",
  "fileFormat": "xlsx"
}
```

### User Management
- Create user: `POST /api/users` (admin) — new users default to `WorkStatus: "On-Site"`
- Delete user: `DELETE /api/users/:id` (admin)
- Update password: `PUT /api/users/:id`
- Get all users: `GET /api/users` (admin)
- Get request history: `GET /api/users/:email`

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Server port (default: 5000) |
| `MONGO_URI` | Yes | MongoDB connection string |
| `MONGO_ATLAS_URI` | No | MongoDB Atlas connection string (alternative) |
| `MONGO_ATLAS_DB` | No | Atlas database name |
| `MONGO_LOCAL_DB` | No | Local database name |
| `JWT_SECRET` | Yes | Secret key for signing JWT tokens |
| `GEMINI_API_KEY` | Yes | Google Gemini API key (AI features) |
| `EMAIL_FROM` | Yes | Sender address for Nodemailer |
| `EMAIL_PASSWORD` | Yes | SMTP password / app password |
| `TERMII_API_KEY` | No | 🆕 Termii API key for Site-Approver SMS OTP. If unset, OTP falls back to a console adapter (dev). |
| `TERMII_SENDER_ID` | No | 🆕 Termii approved sender ID (default `Halden`). |
| `TERMII_BASE_URL` | No | 🆕 Termii base URL override (default `https://api.ng.termii.com`). |
| `SKIP_RENTAL_NAG_LEAD_DAYS` | No | 🆕 Days before a rented skip's expiry to start the daily nag (default `3`). |
| `APP_PASS` | No | App-specific email password (alternative) |
| `FRONTEND_URL` | Yes | Frontend origin for CORS |
| `FRONTEND_BASED_URL` | No | Alternate frontend base URL |
| `API_BASE_URL` | No | Public API base URL |
| `NTFY_TOPIC` | No | ntfy.sh topic for push notifications |
| `NODE_ENV` | No | `development` / `production` |

**GCS setup** (no env variable — uses a key file):  
Place `google-service-account-gcs.json` at the repo root. The service account needs the `Storage Object Admin` role scoped to the `halden-backend-storage` bucket. This file is gitignored and must be copied to the server manually on each deployment.

## CI

GitHub Actions runs the test suite on every push and pull request to `main`:

```
.github/workflows/ci.yaml
```

- Matrix: Node.js 18.x and 20.x
- Steps: `npm ci` → `npm test`
- No build step, no deploy step — CI validates tests only.

## Error Handling
| Status | Meaning |
|---|---|
| 400 | Missing or invalid request parameters |
| 401 | Invalid or missing authentication token |
| 403 | Insufficient permissions |
| 404 | Resource not found |
| 500 | Unexpected server error |

## Contributing
Contributions are welcome!

```bash
git checkout -b feature-branch
# make changes
git commit -m "describe your change"
# open a pull request
```
