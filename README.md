# Procurement API

RESTful backend for procurement operations, file tracking, compliance logging, tender management, and AI-assisted queries. Swagger docs are auto-generated from JSDoc annotations and served via Swagger UI.

## Table of Contents
- [Features](#features)
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

## Requirements
- Node.js 22.x (see `engines`)
- npm
- MongoDB instance

## Installation
```bash
git clone https://github.com/DavidUmunna/procurement_api.git
cd procurement_api
npm install
```

## Usage
Start the server:
```bash
npm start
```
Default base URL: `http://localhost:5000`

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

## Project Structure (abridged)
```
procurement_api/
├── server.js                     # Express setup, routes, middleware, swagger UI
├── db.js                         # MongoDB connection
├── docs/swagger.js               # swagger-jsdoc config
├── Dockerfile / docker-compose.yml
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
1. **Create**: `POST /api/orders` — saved with status `"Pending"`.
2. **Approve**: `PUT /api/orders/:id/approve` — admin adds their name to the `Approvals` array.
3. **Fetch**: `GET /api/orders/:email` (own orders) or `GET /api/orders` (admin, all orders).

### Leave Management

Leave requests follow a **Pending → Approved / Rejected** lifecycle. Approving a request deducts days from the user's balance and sets their `WorkStatus` to `"On-Leave"`.

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

### User Management
- Create user: `POST /api/users` (admin)
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
| `APP_PASS` | No | App-specific email password (alternative) |
| `FRONTEND_URL` | Yes | Frontend origin for CORS |
| `FRONTEND_BASED_URL` | No | Alternate frontend base URL |
| `API_BASE_URL` | No | Public API base URL |
| `NTFY_TOPIC` | No | ntfy.sh topic for push notifications |
| `NODE_ENV` | No | `development` / `production` |

## Error Handling
| Status | Meaning |
|---|---|
| 400 | Missing or invalid request parameters |
| 401 | Invalid or missing authentication token |
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
