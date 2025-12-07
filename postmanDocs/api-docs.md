# Procurement API – Postman-Style Documentation

Base URL: `http://<host>:5000`  
Auth: Bearer JWT (unless noted); some endpoints rely on cookies (`authToken`, `sessionId`).  
Headers: `Authorization: Bearer <token>`; `Content-Type: application/json` where applicable.

## Auth & Access
- **Check Access** — `GET /api/access` (auth)  
  Returns `{ authenticated, user }`.
- **Signin (cookie JWT)** — `POST /api/signin` body `{ username, password }`; sets `authToken` cookie and returns `{ token, user }`.  
  `GET /api/signin` (cookie) returns current user.  
  `POST /api/signin/logout` body `{ userId, deviceId }` clears Redis session.  
  `DELETE /api/signin` deletes signin records.
- **Admin Auth (Redis session)** — `POST /api/admin_user/login` body `{ username, password }` (rate limited) sets `sessionId` cookie.  
  `POST /api/admin_user/logout` body `{ userId }` clears session.

## Users
- **List Users** — `GET /api/users`
- **Get User by Email** — `GET /api/users/:email`
- **Roles/Departments** — `GET /api/users/roles&departments`
- **Create User** — `POST /api/users` (auth) body `{ name, email, password, Department, role }`
- **Request Password Reset** — `PUT /api/users/reset` body `{ email }`
- **Reset Password** — `PUT /api/users/reset-password` body `{ token, newPassword }`
- **Update User** — `PUT /api/users/:id/updateuser` (auth) body `{ Department, canApprove, name, email, password, role, WorkStatus }`
- **Delete User** — `DELETE /api/users/:id` (CSRF)

## Purchase Orders (v1) — `/api/orders`
Auth required unless noted.
- `GET /reviewed`
- `DELETE /:id/staffresponse`
- `GET /staffresponses`
- Analytics:  
  `GET /analytics/purchase-orders`  
  `GET /analytics/purchase-orders/status-distribution`  
  `GET /analytics/purchase-orders/urgency-stats`
- `GET /DailyRequests`  
- `GET /StaffRequests`
- `GET /unresolvedorders`
- `GET /accounts` — query `startDate,endDate` (pagination applied)
- `GET /all` — full list (monitorLogger)
- `GET /` — paginated; scoped by user/status/pending approvals
- `GET /department` — query `Department`, paginated, role-aware filtering
- `GET /department/all` — query `Department`
- `GET /:id` — orders for staff id (paginated)
- **Create Order** — `POST /` body `{ supplier, orderedBy, products[], email, filenames, urgency, remarks, Title, staff, role, targetDepartment, fileRefs }`
- **Export Orders** — `POST /export` body `{ startDate, endDate, status, filename }` → XLSX download
- **Generate Memo** — `POST /memo` body `{ requestId }` → DOCX download
- **Update Existing** — `PUT /existingorder/:id`
- **Approve** — `PUT /:id/approve` body `{ adminName, comment, SignatureData }`
- **Awaiting Funding** — `PUT /:id/funding` body `{ adminName, comment }`
- **Reject** — `PUT /:id/reject` (twoFactorVerify) body `{ adminName, comment }`
- **More Info** — `PUT /:id/MoreInfo`
- **Staff Response** — `PUT /:id/staffResponse`
- **Complete** — `PUT /:id/completed`
- **Update Status** — `PUT /:id` body `{ status }` (valid: Pending|Completed|Rejected|Approved|More Information|Awaiting Funding)
- **Delete Order** — `DELETE /:id`
- **Delete All** — `DELETE /`

Example Create Order request:
```json
{
  "supplier": "ABC Ltd",
  "orderedBy": "John Doe",
  "email": "john@example.com",
  "products": [{ "name": "Item A", "quantity": 2, "price": 1000 }],
  "urgency": "High",
  "remarks": "Please expedite",
  "Title": "Laptop Purchase",
  "staff": "64f...",
  "role": "procurement_officer",
  "targetDepartment": "IT"
}
```

## Purchase Orders (v2) — `/api/v2/orders` (auth middleware)
- `GET /` (ordersRateLimiter)  
- `GET /department` (query `Department`)  
- `GET /staff/:id`  
- `POST /memo`  
- `GET /display/department`  
- `GET /display/departmental`  
- `GET /display/staff`  
- `POST /` — create  
- `PUT /:id/completed` (auth)  
- `PUT /:id/approve` (auth)  
- `PUT /:id` (auth) — update status  
- `DELETE /:id` (auth)  
- `DELETE /` (auth)  
- `POST /export`

## File Tracking (v2) — `/api/v2/filetrack` (auth)
- `POST /createtrack`
- `GET /`
- `PUT /:id`
- `GET /paginatedtracks`
- `DELETE /:id`

## Compliance Logs (v2) — `/api/v2/compliance`
- `GET /logs` (auth) — query `page,limit,action,entityId,entityType,performedBy`
- `GET /:id` (auth)

## Skip Tracking — `/api/skiptrack` (auth)
- `GET /` — paginated; query `WasteStream,startDate,endDate,searchTerm`
- `POST /export` — body `{ startDate,endDate,stream,fileName,fileFormat,WasteSource }` → xlsx/csv/pdf
- `GET /categories`
- `POST /create` — create skip record
- `PUT /:id` — update skip
- `DELETE /:id`
- `GET /stats` — query `startDate,endDate,search/searchTerm,WasteStream,WasteSource`
- `GET /analytics`

## Assets — `/api/assets` (auth)
- `GET /` — paginated; query `category,condition,search`
- `GET /categories`
- `POST /` — body `{ name, category, quantity, condition, description, value }`
- `PUT /:id`
- `DELETE /:id`
- `GET /stats`
- `POST /export` — body `{ startDate,endDate,category,filename }`

## Inventory Items — `/api/inventory` (auth)
- `GET /categories`
- `GET /:Department` — paginated; Department→category map
- `POST /` — body `{ name, category, quantity, AddedBy }`
- `PUT /:id` — body `{ quantity }` (adjusts up/down)
- `DELETE /:id`

## Inventory Logs — `/api/inventorylogs`
- `GET /categories` (auth)
- `POST /create` (CSRF)
- `GET /` — paginated
- `PUT /:id` (CSRF)
- `DELETE /:id` (CSRF)
- `GET /:Department` (auth) — paginated
- `POST /export` — body `{ startDate,endDate,status,filename,category }`

## Company Data — `/api/companydata`
- `GET /company`
- `POST /CreateCompanyData` — body `{ CompanyName, OrganizationStructure, ResourcesToStreamline, Workflow }`

## File Upload — `/api/fileupload`
- `POST /create` — multipart `file` (up to 5), body `{ userId }`; uploads to Drive
- `GET /download/:fileId/:filename`
- `GET /:id` — files by staff id

## Suppliers — `/api/suppliers`
- `GET /`
- `GET /:supplier/requests`
- `POST /` (CSRF) — body `{ form: { name, email, phone, address, description, status } }`

## Products — `/api/products`
- `GET /`
- `POST /` — body `{ name, description, category, price, stock, supplier }`

## Scheduling / Disbursement — `/api/scheduling`
- `GET /purchase-orders` — optional `status`
- `POST /disbursement-schedules` (auth)
- `PUT /disbursement-schedules/:id`
- `GET /disbursement-schedules` — paginated, optional `status`/`!Draft`
- `GET /disbursement-schedules-unpaged` — optional `status`
- `GET /disbursement-schedules/:id`
- `PATCH /disbursement-schedules/:id/review`
- `GET /accounts/export-schedule/:id` — XLSX export
- `PATCH /disbursement-schedules/:id/submit`
- `DELETE /disbursement-schedules/:id` (auth)

## Payment Details — `/api/paymentdetails`
- `GET /:id` — by scheduleId
- `PUT /:id` — body `{ Beneficiary, AccountNumber, Bank }`
- `POST /create` — body `{ scheduleId, Beneficiary, AccountNumber, Bank }`
- `DELETE /:id`

## Monitoring — `/api/monitoring`
- `POST /`
- `GET /`
- `GET /stats`
- `GET /:id`
- `DELETE /cleanup`

## OTP — `/api/otp`
- `POST /:id/send-otp` (auth)

## Roles & RBAC Reference — `/api/roles&departments`
- `POST /` (auth, monitorLogger) — returns RBAC role lists based on posted flags.

## Activity Logs — `/api/inventory/activities`
- `GET /:Department` — paginated (Department→category)
- `DELETE /:id` (auth; only global_admin allowed)

## Tasks — `/api/task`
- `POST /` (auth) — body task fields  
- `GET /` (auth)  
- `GET /:id` (auth) — tasks for assignedTo id  
- `PATCH /:id` (auth) — body `{ status }`  
- `DELETE /:id`

## Utility
- `GET /api/test-db` — DB connectivity check
- Logging middleware: `/api/logging`

## AI (Gemini) — `/api/ai`
- `POST /predict-maintenance`
- `POST /interpret-lab`
- `POST /optimize-logistics`
- `POST /generate-report`

---

### Status Codes
Common: 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 500 Server Error.  
Exports/Memo endpoints stream files with appropriate content-type/disposition.

### Notes
- Many routes require `Authorization: Bearer <token>`; some rely on cookies (`authToken`, `sessionId`).  
- CSRF is enforced on selected routes (noted above).  
- Pagination helper expects `page` and `limit` (defaults applied).  
- File uploads require multipart form data with field name `file`.  
- AI endpoints expect JSON bodies per use-case.  
