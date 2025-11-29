# Procurement API

RESTful backend for procurement operations, file tracking, and compliance logging. Swagger docs are auto-generated from JSDoc annotations and served via Swagger UI.

## Table of Contents
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Usage](#usage)
- [API Docs](#api-docs)
- [Key Modules](#key-modules)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)

## Features
- Purchase orders, suppliers, products, inventory, and assets management.
- JWT auth with role-based access via `middlewares/check-auth`.
+- File tracking with expiry checks (daily cron), push notifications, and email alerts for expired tracks.
- Compliance logging automatically generated for FileTrack create/update/delete actions (read-only endpoints to query logs).
- Email notifications (OTP, request updates, expired filetracks) using Nodemailer.
- CSRF protection, CORS, Helmet, and rate limiting hooks.

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

## API Docs
- Swagger UI: `GET /api/docs`
- OpenAPI JSON: `GET /api/docs.json`
Docs are generated from JSDoc blocks in routes/controllers/models using `swagger-jsdoc` + `swagger-ui-express` (see `docs/swagger.js`).

## Key Modules
- File tracking: `routes/v2/FileTracking.js`, `services/FileTracking.service.js`, `repositories/FileTracking.repository.js`, `Global_Functions/checkExpiry.js` (daily expiry cron).
- Compliance logs: `models/ComplianceLog.js`, `routes/v2/ComplianceLog.js`, `controllers/v2.controllers/ComplianceLog.controllers.js`, `services/ComplianceLog.service.js`, `repositories/ComplianceLog.repository.js`.
- Notifications: `controllers/v1.controllers/notification.js`, `emailnotification/emailNotification.js`, `pushNotifications/fileTrack.js`.
- Auth: `middlewares/check-auth.js`, `routes/v1/signin.js`, `routes/v1/users.js`.

## Environment Variables
Create a `.env` file with values like:
```env
PORT=5000
MONGO_URI=mongodb://127.0.0.1:27017/procurement
JWT_SECRET=your_secret_key
EMAIL_PASSWORD=...
APP_PASS=...
FRONTEND_BASED_URL=http://localhost:3000
API_BASE_URL=http://localhost:5000
```
Other provider keys (Google Drive, Firebase, Resend, etc.) as required by their modules.

## Project Structure (abridged)
```
procurement_api/
├── server.js                  # Express setup, routes, middleware, swagger UI
├── docs/swagger.js            # swagger-jsdoc config
├── Global_Functions/          # Cron jobs, pagination, helpers
├── controllers/
│   ├── v1.controllers/        # Legacy controllers (notifications, requests)
│   └── v2.controllers/        # v2 controllers (FileTracking, ComplianceLog)
├── routes/
│   ├── v1/                    # v1 REST routes (orders, users, uploads, etc.)
│   └── v2/                    # v2 routes (filetrack, compliance-logs)
├── services/                  # Business logic (FileTracking, ComplianceLog, etc.)
├── repositories/              # Data access layer
├── models/                    # Mongoose schemas (users, purchase orders, filetracking, complianceLog, etc.)
└── emailnotification/         # Nodemailer setup
```

### 8.2 Order Management Workflow
1. **Create Order**:
   - Users create orders via the `POST /api/orders` endpoint.
   - The order is saved in the database with a default status of "Pending."

2. **Approve Order**:
   - Admin users approve orders via the `PUT /api/orders/:id/approve` endpoint.
   - The admin's name is added to the `Approvals` array in the order document.

3. **Fetch Orders**:
   - Users fetch their orders via the `GET /api/orders/:email` endpoint.
   - Admin users can fetch all orders via the `GET /api/orders` endpoint.
  
---

## 8.3 User Management Workflow
1.  ***Create User*:
   - Admins can create users via `POST /api/users` endpoint
   - Admins can delete users via `DELETE /api/users/:id` endpoint
   - Users can upodate thier passwords via `PUT /api/users/:id` endpoint
   - Admins can get all user information via `GET /api/users`
   - Users can get thier  request history information via `GET /api/users/:email` endpoint 
   

---

### 9. Environment Variables
The following environment variables are required:

PORT: The port on which the server runs (default: 5000).
MONGO_URI: MongoDB connection string.
JWT_SECRET: Secret key for signing JWT tokens.

## 10. Error Handling
The API includes comprehensive error handling for all endpoints. Common error responses include:

400 Bad Request:
Missing or invalid request parameters.
401 Unauthorized:
Invalid or missing authentication token.
404 Not Found:
Resource not found (e.g., order or supplier).
500 Internal Server Error:
Unexpected server errors.

## 11. Contributing
Contributions are welcome! Please follow these steps:

Fork the repository.
Create a new branch:
git checkout -b feature-branch
## 12. Database Schema

### **PurchaseOrder Schema**
```javascript
/*const PurchaseOrderSchema = new Schema({
  orderNumber: { type: String, unique: true, default: () => `PO-${Date.now()}` },
  Approvals: { type: [String], default: [] },
  email: { type: String, required: true },
  products: [
    {
      name: { type: String, required: true },
      quantity: { type: Number, required: true },
      price: { type: Number, required: true },
    },
  ],
  supplier: { type: String, required: true },
  orderedBy: { type: String, required: true },
  status: { type: String, enum: ["Pending", "Approved", "Completed", "Rejected"], default: "Pending" },
  urgency: { type: String, enum: ["VeryUrgent", "Urgent", "NotUrgent"], default: "NotUrgent" },
  remarks: { type: String },
}, { timestamps: true });*/
