/**
 * Duplicate purchase-order prevention — integration tests against a REAL
 * MongoDB (mongodb-memory-server), because the guarantees under test are
 * enforced by unique indexes and can't be faked with mocks.
 *
 * Real: PurchaseOrder, OrderSubmissionLock, File, User, AuditLog models,
 *       routes/v1/orders.js (create/precheck) and routes/v1/fileupload.js.
 * Mocked: Redis sessions, GCS/Drive storage, push notifications, approval
 *         routing and other controllers not under test.
 */
const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// ── Sessions (Redis) ─────────────────────────────────────────────────────────
const mockSessions = {};
const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(),
  get:     jest.fn(async (k) => mockSessions[k.replace('session:', '')] || null),
  expire:  jest.fn().mockResolvedValue(),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedisClient) }));

// ── External / out-of-scope modules ──────────────────────────────────────────
jest.mock('../../emailnotification/emailNotification', () => jest.fn().mockResolvedValue());
jest.mock('../../Uploadexceltodrive', () => jest.fn().mockResolvedValue());
jest.mock('../../exporttoexcel', () => jest.fn().mockResolvedValue());
jest.mock('../../middlewares/monitorLogger',   () => (_req, _res, next) => next());
jest.mock('../../middlewares/usemonitor',      () => (_req, _res, next) => next());
jest.mock('../../middlewares/TwoFactorVerify', () => (_req, _res, next) => next());
jest.mock('../../Global_Functions/firebasePushNotification', () => ({
  sendPushNotification: jest.fn().mockResolvedValue(),
}));
jest.mock('../../controllers/v1.controllers/RequestController', () => ({
  ValidatePendingApprovals:  jest.fn().mockResolvedValue(),
  GetOverallMonthlyRequests: jest.fn((_q, r) => r.json([])),
  MonthlyStaffRequest:       jest.fn((_q, r) => r.json([])),
  ReviewedRequests:          jest.fn((_q, r) => r.json([])),
  DeleteStaffResponse:       jest.fn((_q, r) => r.json({})),
  GetStaffResponses:         jest.fn((_q, r) => r.json([])),
  UnresolvedOrders:          jest.fn((_q, r) => r.json([])),
  UpdateExistingRequest:     jest.fn((_q, r) => r.json({})),
  MoreInformation:           jest.fn((_q, r) => r.json({})),
  StaffResponse:             jest.fn((_q, r) => r.json({})),
}));
jest.mock('../../controllers/v1.controllers/RequestsAnalytics', () => ({
  getPOAnalytics: jest.fn(), getPOStatusDistribution: jest.fn(), getPOUrgencyStats: jest.fn(),
  getSpendByDepartment: jest.fn(), getSpendByStatus: jest.fn(), getSpendSummary: jest.fn(),
}));
jest.mock('../../controllers/v1.controllers/notification', () => ({
  RequestActivity: jest.fn(), IncomingRequest: jest.fn(), ApprovedRequests: jest.fn(),
}));
jest.mock('../../controllers/v1.controllers/Signature_Controllers', () => ({ CreateSignature: jest.fn() }));

let mockObjectSeq = 0;
jest.mock('../../googlecloudstorage.service', () => ({
  uploadFileToCloud: jest.fn(async (_path, name) => ({ objectName: `obj-${++mockObjectSeq}-${name}`, bucket: 'test-bucket' })),
  uploadBufferToCloud:   jest.fn(),
  downloadFileFromCloud: jest.fn(),
  deleteFileFromCloud:   jest.fn().mockResolvedValue(),
}));
jest.mock('../../googledriveservice', () => ({
  uploadFileToDrive: jest.fn(), downloadFileFromDrive: jest.fn(), deleteFileFromDrive: jest.fn().mockResolvedValue(),
}));

const PurchaseOrder       = require('../../models/PurchaseOrder');
const OrderSubmissionLock = require('../../models/OrderSubmissionLock');
const FileModel           = require('../../models/file');
const User                = require('../../models/users_');
const AuditLog            = require('../../models/AuditLog');
const { uploadFileToCloud, deleteFileFromCloud } = require('../../googlecloudstorage.service');
const ordersRouter = require('../../routes/v1/orders');
const uploadRouter = require('../../routes/v1/fileupload');

let mongod;
let app;
let alice;
let bob;

const BODY = {
  Title:    'Office printer toner',
  supplier: 'Acme Supplies Ltd',
  products: [
    { name: 'Toner black', quantity: 4, price: 25000 },
    { name: 'Toner cyan',  quantity: 2, price: 27000 },
  ],
  urgency: 'Urgent',
  remarks: 'Printers on the 2nd floor are out',
};

const cookie = (sid) => [`sessionId=${sid}`];
const createOrder = (sid, body, key) => {
  const r = request(app).post('/api/orders').set('Cookie', cookie(sid));
  if (key) r.set('Idempotency-Key', key);
  return r.send(body);
};
const precheck = (sid, body, key) =>
  request(app).post('/api/orders/precheck').set('Cookie', cookie(sid)).set('Idempotency-Key', key).send(body);
const upload = (sid) =>
  request(app)
    .post('/api/fileupload/create')
    .set('Cookie', cookie(sid))
    .attach('file', Buffer.from('fake-png-bytes'), { filename: 'quote.png', contentType: 'image/png' });

/** The new frontend flow: precheck → upload → create. */
async function newClientSubmit(sid, body, key) {
  const pre = await precheck(sid, body, key);
  if (pre.status !== 200 || pre.body.replayed) return pre;
  const up = await upload(sid);
  return createOrder(sid, { ...body, fileRefs: up.body.files._id }, key);
}

/** An old client: upload → create, no key, no precheck. */
async function oldClientSubmit(sid, body) {
  const up = await upload(sid);
  return createOrder(sid, { ...body, fileRefs: up.body.files._id });
}

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  // Build every index (unique idempotencyKey/orderNumber, TTL) before testing.
  await Promise.all([PurchaseOrder.syncIndexes(), OrderSubmissionLock.syncIndexes(), User.syncIndexes()]);

  alice = await User.create({ name: 'Alice Staff', email: 'alice@test.com', password: 'x', Department: 'waste_management_dep' });
  bob   = await User.create({ name: 'Bob Staff',   email: 'bob@test.com',   password: 'x', Department: 'waste_management_dep' });
  mockSessions.alice = JSON.stringify({ userId: String(alice._id), role: 'staff', email: alice.email, Department: 'waste_management_dep' });
  mockSessions.bob   = JSON.stringify({ userId: String(bob._id),   role: 'staff', email: bob.email,   Department: 'waste_management_dep' });

  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/orders', ordersRouter);
  app.use('/api/fileupload', uploadRouter);
}, 120000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongod) await mongod.stop();
});

beforeEach(async () => {
  await Promise.all([
    PurchaseOrder.deleteMany({}),
    OrderSubmissionLock.deleteMany({}),
    FileModel.deleteMany({}),
    AuditLog.deleteMany({}),
  ]);
  jest.clearAllMocks();
  delete process.env.PO_DUPLICATE_WINDOW_MINUTES;
});

describe('indexes', () => {
  it('has the TTL index on OrderSubmissionLock.expiresAt and the unique PO indexes', async () => {
    const lockIdx = await OrderSubmissionLock.collection.indexes();
    const ttl = lockIdx.find((i) => i.key.expiresAt === 1);
    expect(ttl).toBeDefined();
    expect(ttl.expireAfterSeconds).toBe(0);

    const poIdx = await PurchaseOrder.collection.indexes();
    expect(poIdx.find((i) => i.key.idempotencyKey === 1)).toMatchObject({ unique: true, sparse: true });
    expect(poIdx.find((i) => i.key.orderNumber === 1)).toMatchObject({ unique: true });
    expect(poIdx.find((i) => i.key.submissionFingerprint === 1)).toBeDefined();
  });
});

describe('POST /api/orders — duplicate protection', () => {
  it('1. same Idempotency-Key twice → 201 then 200 with the same order; one order exists', async () => {
    const first = await createOrder('alice', BODY, 'key-1');
    const second = await createOrder('alice', BODY, 'key-1');

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.newOrder._id).toBe(first.body.newOrder._id);
    expect(await PurchaseOrder.countDocuments()).toBe(1);
  });

  it('2. same key with different content → 422 IDEMPOTENCY_KEY_REUSED', async () => {
    await createOrder('alice', BODY, 'key-2');
    const res = await createOrder('alice', { ...BODY, Title: 'Something else' }, 'key-2');

    expect(res.status).toBe(422);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await PurchaseOrder.countDocuments()).toBe(1);
  });

  it('3. same content, different key (other tab) → 201 then 409 POSSIBLE_DUPLICATE with the existing order', async () => {
    const first = await createOrder('alice', BODY, 'tab-a');
    const second = await createOrder('alice', BODY, 'tab-b');

    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ code: 'POSSIBLE_DUPLICATE', inProgress: false });
    expect(second.body.existingOrder.orderNumber).toBe(first.body.newOrder.orderNumber);
    expect(second.body.existingOrder.id).toBe(first.body.newOrder._id);
    expect(await PurchaseOrder.countDocuments()).toBe(1);
  });

  it('4. confirmDuplicate: true → 201, override recorded with similarTo and audited', async () => {
    const first = await createOrder('alice', BODY, 'tab-a');
    await createOrder('alice', BODY, 'tab-b'); // 409
    const confirmed = await createOrder('alice', { ...BODY, confirmDuplicate: true }, 'tab-b');

    expect(confirmed.status).toBe(201);
    const saved = await PurchaseOrder.findById(confirmed.body.newOrder._id).lean();
    expect(saved.duplicateOverride.confirmed).toBe(true);
    expect(String(saved.duplicateOverride.by)).toBe(String(alice._id));
    expect(String(saved.duplicateOverride.similarTo)).toBe(first.body.newOrder._id);
    expect(saved.duplicateOverride.at).toBeInstanceOf(Date);

    const audit = await AuditLog.findOne({ action: 'PO_DUPLICATE_OVERRIDE' }).lean();
    expect(audit).toMatchObject({ entity: 'PurchaseOrder', entityId: String(saved._id) });
    expect(String(audit.actor)).toBe(String(alice._id));
    expect(audit.metadata.similarTo).toBe(first.body.newOrder._id);
    expect(await PurchaseOrder.countDocuments()).toBe(2);
  });

  it('5a. concurrency (new client): 5 parallel precheck→upload→create with different keys → one order, one file', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((i) => newClientSubmit('alice', BODY, `par-${i}`)));
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(await PurchaseOrder.countDocuments()).toBe(1);
    expect(await FileModel.countDocuments()).toBe(1);
    expect(uploadFileToCloud).toHaveBeenCalledTimes(1); // rejected duplicates never uploaded
  });

  it('5b. concurrency (old client, no key/precheck): 5 parallel upload→create → one order, rejected uploads cleaned up', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => oldClientSubmit('alice', BODY)));
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([201, 409, 409, 409, 409]);
    expect(await PurchaseOrder.countDocuments()).toBe(1);
    expect(await FileModel.countDocuments()).toBe(1);
    expect(deleteFileFromCloud).toHaveBeenCalledTimes(4);
    const order = await PurchaseOrder.findOne().lean();
    expect(await FileModel.exists({ _id: order.fileRefs })).toBeTruthy();
  });

  it('5c. concurrency with the SAME key (double click) → one 201, the rest replay the same order', async () => {
    const results = await Promise.all([1, 2, 3].map(() => createOrder('alice', BODY, 'dbl-click')));
    const statuses = results.map((r) => r.status).sort();

    expect(statuses).toEqual([200, 200, 201]);
    const ids = new Set(results.map((r) => r.body.newOrder._id));
    expect(ids.size).toBe(1);
    expect(await PurchaseOrder.countDocuments()).toBe(1);
  });

  it('6. same content from a different staff member → both 201', async () => {
    const a = await createOrder('alice', BODY, 'alice-1');
    const b = await createOrder('bob', BODY, 'bob-1');

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(await PurchaseOrder.countDocuments()).toBe(2);
  });

  it('7. after the window expires (stale lock not yet swept) → 201', async () => {
    await createOrder('alice', BODY, 'old-1');
    await OrderSubmissionLock.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await createOrder('alice', BODY, 'new-1');
    expect(res.status).toBe(201);
    expect(await PurchaseOrder.countDocuments()).toBe(2);
  });

  it('7b. PO_DUPLICATE_WINDOW_MINUTES controls the lock lifetime', async () => {
    process.env.PO_DUPLICATE_WINDOW_MINUTES = '3';
    const before = Date.now();
    await createOrder('alice', BODY, 'win-1');
    const lock = await OrderSubmissionLock.findOne().lean();
    const minutes = (lock.expiresAt.getTime() - before) / 60000;
    expect(minutes).toBeGreaterThan(2.9);
    expect(minutes).toBeLessThan(3.1);
  });

  it('8. if order creation throws after the lock is taken → lock released, uploaded file deleted', async () => {
    const up = await upload('alice');
    const saveSpy = jest.spyOn(PurchaseOrder.prototype, 'save').mockRejectedValueOnce(new Error('DB write failed'));

    const res = await createOrder('alice', { ...BODY, fileRefs: up.body.files._id }, 'boom-1');
    saveSpy.mockRestore();

    expect(res.status).toBe(500);
    expect(await OrderSubmissionLock.countDocuments()).toBe(0);
    expect(await FileModel.countDocuments()).toBe(0);
    expect(deleteFileFromCloud).toHaveBeenCalledTimes(1);

    // …and the user can retry straight away.
    const retry = await createOrder('alice', BODY, 'boom-1');
    expect(retry.status).toBe(201);
  });

  it('9. no Idempotency-Key (old client) still creates an order', async () => {
    const res = await createOrder('alice', BODY);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    const saved = await PurchaseOrder.findById(res.body.newOrder._id).lean();
    expect(saved.idempotencyKey).toBeUndefined();
    expect(saved.submissionFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it('remarks/urgency changes are still the same order (409)', async () => {
    await createOrder('alice', BODY, 'r-1');
    const res = await createOrder('alice', { ...BODY, remarks: 'Fixed typo', urgency: 'VeryUrgent' }, 'r-2');
    expect(res.status).toBe(409);
  });

  it('a lock pointing at a deleted order no longer blocks', async () => {
    const first = await createOrder('alice', BODY, 'del-1');
    await PurchaseOrder.deleteOne({ _id: first.body.newOrder._id });

    const res = await createOrder('alice', BODY, 'del-2');
    expect(res.status).toBe(201);
  });

  it('staff comes from the session, not the body', async () => {
    const res = await createOrder('alice', { ...BODY, staff: String(bob._id), email: bob.email }, 'spoof-1');
    expect(res.status).toBe(201);
    const saved = await PurchaseOrder.findById(res.body.newOrder._id).lean();
    expect(String(saved.staff)).toBe(String(alice._id));
    // (PurchaseOrder has no `email` path; Department is resolved from the session user.)
  });

  it('orderNumber collisions are retried with a new number', async () => {
    const fixed = 1794818915942;
    await PurchaseOrder.create({ orderNumber: `PO-${fixed}`, remarks: 'existing', staff: bob._id });
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(fixed);
    let res;
    try {
      res = await createOrder('alice', BODY, 'num-1');
    } finally {
      nowSpy.mockRestore();
    }
    expect(res.status).toBe(201);
    expect(res.body.newOrder.orderNumber).toMatch(/^PO-\d+$/);
    expect(res.body.newOrder.orderNumber).not.toBe(`PO-${fixed}`);
    expect(await PurchaseOrder.countDocuments()).toBe(2);
  });

  it('a rejected duplicate does not delete a file owned by someone else', async () => {
    await createOrder('alice', BODY, 'own-1');
    const bobsUpload = await upload('bob');

    const res = await createOrder('alice', { ...BODY, fileRefs: bobsUpload.body.files._id }, 'own-2');
    expect(res.status).toBe(409);
    expect(await FileModel.exists({ _id: bobsUpload.body.files._id })).toBeTruthy();
    expect(deleteFileFromCloud).not.toHaveBeenCalled();
  });
});

describe('POST /api/orders/precheck', () => {
  it('requires an Idempotency-Key', async () => {
    const res = await request(app).post('/api/orders/precheck').set('Cookie', cookie('alice')).send(BODY);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('reserves the content; the create with the same key consumes the reservation', async () => {
    const pre = await precheck('alice', BODY, 'k1');
    expect(pre.status).toBe(200);
    expect(pre.body.ok).toBe(true);

    const created = await createOrder('alice', BODY, 'k1');
    expect(created.status).toBe(201);
    const lock = await OrderSubmissionLock.findOne().lean();
    expect(String(lock.orderId)).toBe(created.body.newOrder._id);
  });

  it('another tab while the first is still uploading → 409 inProgress, existingOrder null', async () => {
    await precheck('alice', BODY, 'tab-a');
    const res = await precheck('alice', BODY, 'tab-b');
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ code: 'POSSIBLE_DUPLICATE', inProgress: true, existingOrder: null });
    expect(res.body.message).toMatch(/being submitted right now/i);

    const create = await createOrder('alice', BODY, 'tab-b');
    expect(create.status).toBe(409);
    expect(create.body.inProgress).toBe(true);
  });

  it('re-precheck by the same attempt (retry after a failed upload) is allowed', async () => {
    await precheck('alice', BODY, 'retry-1');
    const again = await precheck('alice', BODY, 'retry-1');
    expect(again.status).toBe(200);
  });

  it('after the attempt created its order, precheck replays it (no second upload needed)', async () => {
    const created = await newClientSubmit('alice', BODY, 'k2');
    const pre = await precheck('alice', BODY, 'k2');
    expect(pre.status).toBe(200);
    expect(pre.body.replayed).toBe(true);
    expect(pre.body.newOrder._id).toBe(created.body.newOrder._id);
  });

  it('confirmDuplicate skips the reservation', async () => {
    await createOrder('alice', BODY, 'c-1');
    const pre = await precheck('alice', { ...BODY, confirmDuplicate: true }, 'c-2');
    expect(pre.status).toBe(200);
  });

  it('release frees an abandoned reservation so a new attempt can proceed', async () => {
    await precheck('alice', BODY, 'abandoned');
    const rel = await request(app)
      .post('/api/orders/precheck/release')
      .set('Cookie', cookie('alice'))
      .set('Idempotency-Key', 'abandoned')
      .send({});
    expect(rel.status).toBe(200);
    expect(rel.body.released).toBe(1);

    const fresh = await precheck('alice', BODY, 'fresh');
    expect(fresh.status).toBe(200);
  });

  it('release is a no-op once the attempt created an order', async () => {
    await createOrder('alice', BODY, 'done-1');
    const rel = await request(app)
      .post('/api/orders/precheck/release')
      .set('Cookie', cookie('alice'))
      .set('Idempotency-Key', 'done-1')
      .send({});
    expect(rel.body.released).toBe(0);
    expect(await OrderSubmissionLock.countDocuments()).toBe(1);
  });
});

describe('POST /api/fileupload/create', () => {
  it('requires a session', async () => {
    const res = await request(app)
      .post('/api/fileupload/create')
      .attach('file', Buffer.from('x'), { filename: 'a.png', contentType: 'image/png' });
    expect(res.status).toBe(401);
    expect(uploadFileToCloud).not.toHaveBeenCalled();
  });

  it('records the uploader as the File owner', async () => {
    const res = await upload('alice');
    expect(res.status).toBe(200);
    const doc = await FileModel.findById(res.body.files._id).lean();
    expect(String(doc.staff)).toBe(String(alice._id));
  });
});
