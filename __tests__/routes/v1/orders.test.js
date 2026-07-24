const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

// ── Mock Redis before auth middleware loads ──────────────────────────────────
const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(),
  get:     jest.fn(),
  expire:  jest.fn().mockResolvedValue(),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedisClient) }));

// ── Mock heavy/external modules that aren't under test ───────────────────────
jest.mock('../../../emailnotification/emailNotification', () => jest.fn().mockResolvedValue());
jest.mock('../../../Uploadexceltodrive', () => jest.fn().mockResolvedValue());
jest.mock('../../../exporttoexcel', () => jest.fn().mockResolvedValue());
jest.mock('../../../middlewares/monitorLogger',    () => (_req, _res, next) => next());
jest.mock('../../../middlewares/usemonitor',       () => (_req, _res, next) => next());
jest.mock('../../../middlewares/TwoFactorVerify',  () => (_req, _res, next) => next());
jest.mock('../../../Global_Functions/firebasePushNotification', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(),
}));

// ── Mock controllers that do DB work not under test ──────────────────────────
jest.mock('../../../controllers/v1.controllers/RequestController', () => ({
  ValidatePendingApprovals:   jest.fn().mockResolvedValue(),
  GetOverallMonthlyRequests:  jest.fn((_req, res) => res.json([])),
  MonthlyStaffRequest:        jest.fn((_req, res) => res.json([])),
  ReviewedRequests:           jest.fn((_req, res) => res.json([])),
  DeleteStaffResponse:        jest.fn((_req, res) => res.json({})),
  GetStaffResponses:          jest.fn((_req, res) => res.json([])),
  UnresolvedOrders:           jest.fn((_req, res) => res.json([])),
  UpdateExistingRequest:      jest.fn((_req, res) => res.json({})),
  MoreInformation:            jest.fn((_req, res) => res.json({})),
  StaffResponse:              jest.fn((_req, res) => res.json({})),
}));
jest.mock('../../../controllers/v1.controllers/RequestsAnalytics', () => ({
  getPOAnalytics:           jest.fn((_req, res) => res.json({})),
  getPOStatusDistribution:  jest.fn((_req, res) => res.json({})),
  getPOUrgencyStats:        jest.fn((_req, res) => res.json({})),
  getSpendByDepartment:     jest.fn((_req, res) => res.json({})),
  getSpendByStatus:         jest.fn((_req, res) => res.json({})),
  getSpendSummary:          jest.fn((_req, res) => res.json({})),
}));
jest.mock('../../../controllers/v1.controllers/notification', () => ({
  RequestActivity:  jest.fn(),
  IncomingRequest:  jest.fn(),
  ApprovedRequests: jest.fn(),
}));
jest.mock('../../../controllers/v1.controllers/Signature_Controllers', () => ({
  CreateSignature: jest.fn((_req, res) => res.json({})),
}));

// ── Mock storage services (cascade delete) ───────────────────────────────────
jest.mock('../../../googlecloudstorage.service', () => ({
  uploadFileToCloud:    jest.fn(),
  uploadBufferToCloud:  jest.fn(),
  downloadFileFromCloud: jest.fn(),
  deleteFileFromCloud:  jest.fn().mockResolvedValue(),
}));
jest.mock('../../../googledriveservice', () => ({
  uploadFileToDrive:    jest.fn(),
  downloadFileFromDrive: jest.fn(),
  deleteFileFromDrive:  jest.fn().mockResolvedValue(),
}));

// ── Mock File model (attachment cleanup) ─────────────────────────────────────
jest.mock('../../../models/file', () => ({
  findById:         jest.fn(),
  findByIdAndDelete: jest.fn(),
}));

// ── Mock AssetExpenditure model (maintenance expenditure) ────────────────────
jest.mock('../../../models/AssetExpenditure', () => ({
  findOneAndUpdate: jest.fn().mockResolvedValue({}),
}));

// ── Mock User model ──────────────────────────────────────────────────────────
const mockUser = {
  _id:               'user-001',
  name:              'John Staff',
  email:             'john@test.com',
  Department:        'waste_management_dep',
  role:              'staff',
  NotificationToken: [],
};

jest.mock('../../../models/users_', () => ({
  findOne: jest.fn(),
  find:    jest.fn().mockReturnValue({ select: jest.fn().mockResolvedValue([]) }),
}));

// ── Mock PurchaseOrder model ─────────────────────────────────────────────────
const mockSavedOrder = {
  _id:        'order-001',
  Title:      'Test Purchase Order',
  status:     'Pending',
  Department: 'waste_management_dep',
  urgency:    'Urgent',
  remarks:    'Needed for lab operations',
  products:   [{ name: 'Gloves', quantity: 10, price: 500 }],
};

const mockSave = jest.fn().mockResolvedValue(mockSavedOrder);

jest.mock('../../../models/PurchaseOrder', () =>
  jest.fn().mockImplementation(() => ({ save: mockSave }))
);

// ── Load router after mocks are set up ───────────────────────────────────────
const userModel        = require('../../../models/users_');
const PurchaseOrder    = require('../../../models/PurchaseOrder');
const AssetExpenditure = require('../../../models/AssetExpenditure');
const fileModel        = require('../../../models/file');
const { deleteFileFromCloud } = require('../../../googlecloudstorage.service');
const { deleteFileFromDrive } = require('../../../googledriveservice');
const ordersRouter  = require('../../../routes/v1/orders');

// ── Sessions ─────────────────────────────────────────────────────────────────
const STAFF_SESSION = JSON.stringify({
  userId: 'user-001',
  role:   'staff',
  name:   'John Staff',
  email:  'john@test.com',
});

const ADMIN_SESSION = JSON.stringify({
  userId: 'admin-001',
  role:   'admin',
  name:   'Admin User',
  email:  'admin@test.com',
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/orders', ordersRouter);
  return app;
}

function withSession(session) {
  mockRedisClient.get.mockResolvedValue(session);
}

const VALID_BODY = {
  Title:     'Test Purchase Order',
  supplier:  'Acme Supplies Ltd',
  orderedBy: 'John Staff',
  email:     'john@test.com',
  products:  [{ name: 'Gloves', quantity: 10, price: 500 }],
  urgency:   'Urgent',
  remarks:   'Needed for lab operations',
  staff:     'user-001',
  role:      'staff',
};

// ── Test Suite ────────────────────────────────────────────────────────────────
describe('POST /api/orders — create purchase order', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
    userModel.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
    mockSave.mockResolvedValue(mockSavedOrder);
  });

  it('creates an order successfully and returns the saved document', async () => {
    withSession(STAFF_SESSION);
    userModel.findOne.mockResolvedValue(mockUser);

    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send(VALID_BODY);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.newOrder._id).toBe('order-001');
    expect(res.body.newOrder.status).toBe('Pending');
    expect(PurchaseOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        Title:    'Test Purchase Order',
        supplier: 'Acme Supplies Ltd',
        email:    'john@test.com',
        urgency:  'Urgent',
        remarks:  'Needed for lab operations',
      })
    );
    expect(mockSave).toHaveBeenCalled();
  });

  it('resolves Department from the User record, not the request body', async () => {
    withSession(STAFF_SESSION);
    userModel.findOne.mockResolvedValue({ ...mockUser, Department: 'accounts_dep' });

    await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send(VALID_BODY);

    expect(PurchaseOrder).toHaveBeenCalledWith(
      expect.objectContaining({ Department: 'accounts_dep' })
    );
  });

  it('passes targetDepartment through to the order', async () => {
    withSession(STAFF_SESSION);
    userModel.findOne.mockResolvedValue(mockUser);

    await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send({ ...VALID_BODY, targetDepartment: 'Environmental_lab_dep' });

    expect(PurchaseOrder).toHaveBeenCalledWith(
      expect.objectContaining({ targetDepartment: 'Environmental_lab_dep' })
    );
  });

  it('returns 400 when products is not an array', async () => {
    withSession(STAFF_SESSION);
    userModel.findOne.mockResolvedValue(mockUser);

    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send({ ...VALID_BODY, products: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/products must be an array/i);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns 400 when products is an object instead of an array', async () => {
    withSession(STAFF_SESSION);
    userModel.findOne.mockResolvedValue(mockUser);

    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send({ ...VALID_BODY, products: { name: 'Gloves' } });

    expect(res.status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns 404 when the email does not match any user', async () => {
    withSession(STAFF_SESSION);
    userModel.findOne.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send({ ...VALID_BODY, email: 'unknown@test.com' });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns 401 when unauthenticated', async () => {
    mockRedisClient.get.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/orders')
      .send(VALID_BODY);

    expect(res.status).toBe(401);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('returns 500 when the database save throws an unexpected error', async () => {
    withSession(STAFF_SESSION);
    userModel.findOne.mockResolvedValue(mockUser);
    mockSave.mockRejectedValue(new Error('DB connection lost'));

    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send(VALID_BODY);

    expect(res.status).toBe(500);
    expect(res.body.success).toBe(false);
  });

  it('admin can also create an order', async () => {
    withSession(ADMIN_SESSION);
    userModel.findOne.mockResolvedValue({ ...mockUser, role: 'admin', email: 'admin@test.com' });

    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send({ ...VALID_BODY, email: 'admin@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── All roles can create ──────────────────────────────────────────────────────
describe('POST /api/orders — all roles are permitted to create', () => {
  const ALL_ROLES = [
    'admin',
    'procurement_officer',
    'human_resources',
    'staff',
    'internal_auditor',
    'Financial_manager',
    'global_admin',
    'Waste Management Manager',
    'Waste Management Supervisor',
    'Logistics Manager',
    'PVT_manager',
    'lab_supervisor',
    'Environmental_lab_manager',
    'Accountant',
    'Director',
    'QHSE Coordinator',
    'Documentation_officer',
    'Contracts_manager',
    'BD_manager',
    'Engineering_manager',
    'Visitor',
    'Facility Manager',
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
    userModel.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
    mockSave.mockResolvedValue(mockSavedOrder);
  });

  test.each(ALL_ROLES)('role "%s" receives 200', async (role) => {
    const session = JSON.stringify({ userId: `user-${role}`, role, name: 'Test User', email: 'test@test.com' });
    withSession(session);
    userModel.findOne.mockResolvedValue({ ...mockUser, role, email: 'test@test.com' });

    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send({ ...VALID_BODY, email: 'test@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ── Escalate / De-escalate helpers ───────────────────────────────────────────
const OWNER_SESSION = JSON.stringify({
  userId:     'user-001',
  role:       'staff',
  name:       'John Staff',
  email:      'john@test.com',
  canApprove: false,
});

const APPROVER_SESSION = JSON.stringify({
  userId:     'admin-001',
  role:       'global_admin',
  name:       'Admin User',
  email:      'admin@test.com',
  canApprove: true,
});

const OTHER_SESSION = JSON.stringify({
  userId:     'user-999',
  role:       'staff',
  name:       'Other Staff',
  email:      'other@test.com',
  canApprove: false,
});

function makeMockOrder(overrides = {}) {
  return {
    _id:              'order-001',
    Title:            'Test Order',
    orderNumber:      'PO-001',
    staff:            'user-001',
    escalated:        false,
    escalatedAt:      undefined,
    PendingApprovals: [{ Reviewer: 'admin-001', Level: 1 }],
    save:             jest.fn().mockResolvedValue({}),
    ...overrides,
  };
}

// ── PUT /api/orders/:id/escalate ─────────────────────────────────────────────
describe('PUT /api/orders/:id/escalate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
    userModel.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
  });

  it('owner escalates a pending order with pending approvals → 200', async () => {
    withSession(OWNER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(makeMockOrder());

    const res = await request(buildApp())
      .put('/api/orders/order-001/escalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.escalated).toBe(true);
  });

  it('non-owner gets 403', async () => {
    withSession(OTHER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(makeMockOrder());

    const res = await request(buildApp())
      .put('/api/orders/order-001/escalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/only the requester/i);
  });

  it('already-escalated order returns 400', async () => {
    withSession(OWNER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(makeMockOrder({ escalated: true }));

    const res = await request(buildApp())
      .put('/api/orders/order-001/escalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already escalated/i);
  });

  it('order with no pending approvals returns 400', async () => {
    withSession(OWNER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(makeMockOrder({ PendingApprovals: [] }));

    const res = await request(buildApp())
      .put('/api/orders/order-001/escalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no pending approvers/i);
  });

  it('order not found returns 404', async () => {
    withSession(OWNER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(null);

    const res = await request(buildApp())
      .put('/api/orders/order-001/escalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(404);
  });

  it('unauthenticated request returns 401', async () => {
    mockRedisClient.get.mockResolvedValue(null);

    const res = await request(buildApp())
      .put('/api/orders/order-001/escalate');

    expect(res.status).toBe(401);
  });

  it('approver who is not the owner cannot escalate → 403', async () => {
    withSession(APPROVER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(makeMockOrder());

    const res = await request(buildApp())
      .put('/api/orders/order-001/escalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(403);
  });
});

// ── PUT /api/orders/:id/deescalate ───────────────────────────────────────────
describe('PUT /api/orders/:id/deescalate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
  });

  it('owner can de-escalate their own order → 200', async () => {
    withSession(OWNER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(makeMockOrder({ escalated: true }));

    const res = await request(buildApp())
      .put('/api/orders/order-001/deescalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.escalated).toBe(false);
  });

  it('approver (canApprove: true) can de-escalate any order → 200', async () => {
    withSession(APPROVER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(
      makeMockOrder({ escalated: true, staff: 'user-001' })
    );

    const res = await request(buildApp())
      .put('/api/orders/order-001/deescalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(200);
    expect(res.body.escalated).toBe(false);
  });

  it('non-owner non-approver gets 403', async () => {
    withSession(OTHER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(makeMockOrder({ escalated: true }));

    const res = await request(buildApp())
      .put('/api/orders/order-001/deescalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/only the requester or an approver/i);
  });

  it('order not already escalated returns 400', async () => {
    withSession(OWNER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(makeMockOrder({ escalated: false }));

    const res = await request(buildApp())
      .put('/api/orders/order-001/deescalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not escalated/i);
  });

  it('order not found returns 404', async () => {
    withSession(OWNER_SESSION);
    PurchaseOrder.findById = jest.fn().mockResolvedValue(null);

    const res = await request(buildApp())
      .put('/api/orders/order-001/deescalate')
      .set('Cookie', ['sessionId=s1']);

    expect(res.status).toBe(404);
  });

  it('unauthenticated request returns 401', async () => {
    mockRedisClient.get.mockResolvedValue(null);

    const res = await request(buildApp())
      .put('/api/orders/order-001/deescalate');

    expect(res.status).toBe(401);
  });
});

// ── DELETE /api/orders/:id — cascade attachment cleanup ──────────────────────
describe('DELETE /api/orders/:id — cascade deletes attachments', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
  });

  it('deletes the order with no fileRefs — no cleanup attempted', async () => {
    PurchaseOrder.findByIdAndDelete = jest.fn().mockResolvedValue({
      _id: 'order-001',
      fileRefs: null,
    });

    const res = await request(buildApp()).delete('/api/orders/order-001');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted successfully/i);
    expect(fileModel.findById).not.toHaveBeenCalled();
    expect(deleteFileFromCloud).not.toHaveBeenCalled();
    expect(deleteFileFromDrive).not.toHaveBeenCalled();
  });

  it('deletes a GCS-backed attachment and the file document', async () => {
    PurchaseOrder.findByIdAndDelete = jest.fn().mockResolvedValue({
      _id: 'order-001',
      fileRefs: 'file-doc-001',
    });
    fileModel.findById.mockResolvedValue({
      _id: 'file-doc-001',
      files: [{ filename: 'invoice.pdf', gcsObjectName: 'uuid-invoice.pdf' }],
    });
    fileModel.findByIdAndDelete.mockResolvedValue({});

    const res = await request(buildApp()).delete('/api/orders/order-001');

    expect(res.status).toBe(200);
    expect(deleteFileFromCloud).toHaveBeenCalledWith('uuid-invoice.pdf');
    expect(deleteFileFromDrive).not.toHaveBeenCalled();
    expect(fileModel.findByIdAndDelete).toHaveBeenCalledWith('file-doc-001');
  });

  it('deletes a Drive-backed (legacy) attachment and the file document', async () => {
    PurchaseOrder.findByIdAndDelete = jest.fn().mockResolvedValue({
      _id: 'order-001',
      fileRefs: 'file-doc-002',
    });
    fileModel.findById.mockResolvedValue({
      _id: 'file-doc-002',
      files: [{ filename: 'old-receipt.pdf', driveFileId: 'drive-id-123' }],
    });
    fileModel.findByIdAndDelete.mockResolvedValue({});

    const res = await request(buildApp()).delete('/api/orders/order-001');

    expect(res.status).toBe(200);
    expect(deleteFileFromDrive).toHaveBeenCalledWith('drive-id-123');
    expect(deleteFileFromCloud).not.toHaveBeenCalled();
    expect(fileModel.findByIdAndDelete).toHaveBeenCalledWith('file-doc-002');
  });

  it('deletes multiple attachments across both storage backends', async () => {
    PurchaseOrder.findByIdAndDelete = jest.fn().mockResolvedValue({
      _id: 'order-001',
      fileRefs: 'file-doc-003',
    });
    fileModel.findById.mockResolvedValue({
      _id: 'file-doc-003',
      files: [
        { filename: 'a.pdf', gcsObjectName: 'uuid-a.pdf' },
        { filename: 'b.pdf', driveFileId: 'drive-id-456' },
      ],
    });
    fileModel.findByIdAndDelete.mockResolvedValue({});

    const res = await request(buildApp()).delete('/api/orders/order-001');

    expect(res.status).toBe(200);
    expect(deleteFileFromCloud).toHaveBeenCalledWith('uuid-a.pdf');
    expect(deleteFileFromDrive).toHaveBeenCalledWith('drive-id-456');
  });

  it('still deletes the order even if storage cleanup throws', async () => {
    PurchaseOrder.findByIdAndDelete = jest.fn().mockResolvedValue({
      _id: 'order-001',
      fileRefs: 'file-doc-004',
    });
    fileModel.findById.mockResolvedValue({
      _id: 'file-doc-004',
      files: [{ filename: 'broken.pdf', gcsObjectName: 'uuid-broken.pdf' }],
    });
    deleteFileFromCloud.mockRejectedValue(new Error('GCS unreachable'));
    fileModel.findByIdAndDelete.mockResolvedValue({});

    const res = await request(buildApp()).delete('/api/orders/order-001');

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/deleted successfully/i);
    expect(fileModel.findByIdAndDelete).toHaveBeenCalledWith('file-doc-004');
  });

  it('returns 404 when the order does not exist', async () => {
    PurchaseOrder.findByIdAndDelete = jest.fn().mockResolvedValue(null);

    const res = await request(buildApp()).delete('/api/orders/order-001');

    expect(res.status).toBe(404);
    expect(fileModel.findById).not.toHaveBeenCalled();
  });

  it('does not attempt file cleanup when the fileRefs document is missing', async () => {
    PurchaseOrder.findByIdAndDelete = jest.fn().mockResolvedValue({
      _id: 'order-001',
      fileRefs: 'file-doc-005',
    });
    fileModel.findById.mockResolvedValue(null);

    const res = await request(buildApp()).delete('/api/orders/order-001');

    expect(res.status).toBe(200);
    expect(deleteFileFromCloud).not.toHaveBeenCalled();
    expect(deleteFileFromDrive).not.toHaveBeenCalled();
    expect(fileModel.findByIdAndDelete).not.toHaveBeenCalled();
  });
});

// ── Maintenance purchase orders (create) ──────────────────────────────────────
describe('POST /api/orders — maintenance requests', () => {
  const MAINT_BODY = {
    Title:     'Compactor repair',
    supplier:  'Acme',
    orderedBy: 'John Staff',
    email:     'john@test.com',
    products:  [{ name: 'Hydraulic seal', quantity: 2, price: 1500 }],
    urgency:   'Urgent',
    remarks:   'Compactor hydraulics need servicing',
    staff:     'user-001',
    role:      'staff',
    isMaintenance: true,
    assetCategory: 'waste_management',
    assetSubCategory: 'Compactors',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
    userModel.find.mockReturnValue({ select: jest.fn().mockResolvedValue([]) });
    mockSave.mockResolvedValue(mockSavedOrder);
    mockRedisClient.get.mockResolvedValue(STAFF_SESSION);
    userModel.findOne.mockResolvedValue(mockUser);
  });

  it('persists the maintenance fields on the order', async () => {
    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send(MAINT_BODY);

    expect(res.status).toBe(200);
    expect(PurchaseOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        isMaintenance: true,
        assetCategory: 'waste_management',
        assetSubCategory: 'Compactors',
      })
    );
  });

  it('defaults assetCategory to waste_management when omitted', async () => {
    const { assetCategory, ...body } = MAINT_BODY;
    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send(body);

    expect(res.status).toBe(200);
    expect(PurchaseOrder).toHaveBeenCalledWith(
      expect.objectContaining({ assetCategory: 'waste_management', assetSubCategory: 'Compactors' })
    );
  });

  it('returns 400 when a maintenance request has no assetSubCategory', async () => {
    const { assetSubCategory, ...body } = MAINT_BODY;
    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/assetSubCategory is required/i);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it('a non-maintenance order stores isMaintenance:false and no asset fields', async () => {
    const res = await request(buildApp())
      .post('/api/orders')
      .set('Cookie', ['sessionId=s1'])
      .send({ ...MAINT_BODY, isMaintenance: false, assetCategory: undefined, assetSubCategory: undefined });

    expect(res.status).toBe(200);
    const arg = PurchaseOrder.mock.calls[0][0];
    expect(arg.isMaintenance).toBe(false);
    expect(arg).not.toHaveProperty('assetSubCategory');
  });
});

// ── Maintenance expenditure on full approval ─────────────────────────────────
describe('PUT /api/orders/:id/approve — maintenance expenditure', () => {
  function makeApproveOrder(overrides = {}) {
    const order = {
      _id:              'order-001',
      orderNumber:      'PO-001',
      Title:            'Compactor repair',
      staff:            'user-001',
      Approvals:        [],
      PendingApprovals: [{ Reviewer: 'admin-001', Level: 1 }],
      products:         [{ name: 'Seal', price: 1000, quantity: 2 }],
      isMaintenance:    true,
      assetCategory:    'waste_management',
      assetSubCategory: 'Compactors',
      maintenanceExpenditureApplied: false,
      ...overrides,
    };
    order.save = jest.fn().mockResolvedValue(order);
    return order;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
    mockRedisClient.get.mockResolvedValue(APPROVER_SESSION);
    userModel.findOne.mockResolvedValue({ _id: 'admin-001', name: 'Admin User' });
    AssetExpenditure.findOneAndUpdate.mockResolvedValue({});
  });

  it('adds the order total to the sub-category expenditure when fully approved', async () => {
    const order = makeApproveOrder();
    PurchaseOrder.findById = jest.fn().mockResolvedValue(order);

    const res = await request(buildApp())
      .put('/api/orders/order-001/approve')
      .set('Cookie', ['sessionId=s1'])
      .send({ adminName: 'Admin User' });

    expect(res.status).toBe(200);
    expect(AssetExpenditure.findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, update] = AssetExpenditure.findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({ category: 'waste_management', subCategory: 'Compactors' });
    // 1000 × 2 = 2000
    expect(update.$inc.totalExpenditure).toBe(2000);
    expect(update.$inc.orderCount).toBe(1);
    expect(order.maintenanceExpenditureApplied).toBe(true);
  });

  it('does NOT record expenditure when approvers are still pending', async () => {
    // Two required approvers; only one approves → not fully approved
    const order = makeApproveOrder({
      PendingApprovals: [{ Reviewer: 'admin-001', Level: 1 }, { Reviewer: 'admin-002', Level: 2 }],
    });
    PurchaseOrder.findById = jest.fn().mockResolvedValue(order);

    const res = await request(buildApp())
      .put('/api/orders/order-001/approve')
      .set('Cookie', ['sessionId=s1'])
      .send({ adminName: 'Admin User' });

    expect(res.status).toBe(200);
    expect(AssetExpenditure.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does NOT record expenditure for a non-maintenance order', async () => {
    const order = makeApproveOrder({ isMaintenance: false });
    PurchaseOrder.findById = jest.fn().mockResolvedValue(order);

    const res = await request(buildApp())
      .put('/api/orders/order-001/approve')
      .set('Cookie', ['sessionId=s1'])
      .send({ adminName: 'Admin User' });

    expect(res.status).toBe(200);
    expect(AssetExpenditure.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('regression: does not double-count when already applied', async () => {
    const order = makeApproveOrder({ maintenanceExpenditureApplied: true });
    PurchaseOrder.findById = jest.fn().mockResolvedValue(order);

    const res = await request(buildApp())
      .put('/api/orders/order-001/approve')
      .set('Cookie', ['sessionId=s1'])
      .send({ adminName: 'Admin User' });

    expect(res.status).toBe(200);
    expect(AssetExpenditure.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('does NOT record expenditure when a rejection is present', async () => {
    const order = makeApproveOrder({
      Approvals: [{ admin: 'Someone', status: 'Rejected' }],
    });
    PurchaseOrder.findById = jest.fn().mockResolvedValue(order);

    const res = await request(buildApp())
      .put('/api/orders/order-001/approve')
      .set('Cookie', ['sessionId=s1'])
      .send({ adminName: 'Admin User' });

    expect(res.status).toBe(200);
    expect(AssetExpenditure.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
