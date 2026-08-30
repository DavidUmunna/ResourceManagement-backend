const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

// ── Mock Redis (auth) ────────────────────────────────────────────────────────
const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(),
  get:     jest.fn(),
  expire:  jest.fn().mockResolvedValue(),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedisClient) }));

// ── Mock data + notification layers ──────────────────────────────────────────
jest.mock('../../../repositories/skip.repository', () => ({
  findById: jest.fn(), findByIdRaw: jest.fn(), findActiveByTag: jest.fn(),
  findTagConflict: jest.fn(), update: jest.fn(), findMany: jest.fn(), count: jest.fn(),
}));
jest.mock('../../../repositories/truck.repository', () => ({
  create: jest.fn(), findById: jest.fn(), findAll: jest.fn(), update: jest.fn(),
}));
jest.mock('../../../services/ComplianceLog.service', () => ({
  logComplianceAction: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/NotificationService', () => ({
  notifyIssue: jest.fn().mockResolvedValue({ notified: 0 }),
  EmailNotificationService: class {},
}));

const skipRepo  = require('../../../repositories/skip.repository');
const truckRepo = require('../../../repositories/truck.repository');
const { notifyIssue } = require('../../../services/NotificationService');
const { logComplianceAction } = require('../../../services/ComplianceLog.service');
const skipRouter = require('../../../routes/v1/skips.routes');

const ADMIN = JSON.stringify({ userId: 'u1', role: 'global_admin', name: 'Admin' });
const STAFF = JSON.stringify({ userId: 'u2', role: 'staff', name: 'Staffer' });

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/skips', skipRouter);
  return a;
}
const cookie = ['sessionId=s1'];

const deliveryTruck  = { _id: 't1', regNo: 'DEL-1', type: 'delivery', currentDriverId: { _id: 'd1', name: 'John' } };
const wasteTruck     = { _id: 't2', regNo: 'WST-1', type: 'waste',    currentDriverId: { _id: 'd2', name: 'Jane' } };
const driverlessTruck= { _id: 't3', regNo: 'DEL-2', type: 'delivery', currentDriverId: null };

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisClient.get.mockResolvedValue(ADMIN);
});

// ── list + detail (ERP module reads) ─────────────────────────────────────────
describe('list + detail', () => {
  it('lists skips with pagination metadata', async () => {
    skipRepo.findMany.mockResolvedValue([{ _id: 's1', skip_id: 'SKIP-1' }]);
    skipRepo.count.mockResolvedValue(1);

    const res = await request(app()).get('/api/skips?page=1&limit=20').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.pagination.total).toBe(1);
  });

  it('translates stage=demobilized into a filter', async () => {
    skipRepo.findMany.mockResolvedValue([]);
    skipRepo.count.mockResolvedValue(0);

    await request(app()).get('/api/skips?stage=demobilized').set('Cookie', cookie);
    const filterArg = skipRepo.findMany.mock.calls[0][0];
    expect(filterArg.DemobilizationOfFilledSkips).toEqual({ $ne: null });
  });

  it('returns 404 for a missing skip detail', async () => {
    skipRepo.findById.mockResolvedValue(null);
    const res = await request(app()).get('/api/skips/nope').set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});

// ── register-tag (FR-7/8) ─────────────────────────────────────────────────────
describe('register-tag', () => {
  it('binds a tag to a skip', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    skipRepo.findTagConflict.mockResolvedValue(null);
    skipRepo.update.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', rfidTag: 'TAG-1' });

    const res = await request(app()).post('/api/skips/s1/register-tag').set('Cookie', cookie).send({ rfidTag: 'TAG-1' });
    expect(res.status).toBe(200);
    expect(res.body.data.rfidTag).toBe('TAG-1');
  });

  it('rejects a tag already bound to another active skip (409) and raises an issue', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    skipRepo.findTagConflict.mockResolvedValue({ _id: 's9', skip_id: 'SKIP-9' });

    const res = await request(app()).post('/api/skips/s1/register-tag').set('Cookie', cookie).send({ rfidTag: 'TAG-1' });
    expect(res.status).toBe(409);
    expect(notifyIssue).toHaveBeenCalled();
    expect(skipRepo.update).not.toHaveBeenCalled();
  });

  it('400 when rfidTag missing', async () => {
    const res = await request(app()).post('/api/skips/s1/register-tag').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });
});

// ── assign trucks (FR-2/5) ────────────────────────────────────────────────────
describe('assign-delivery-truck', () => {
  it('assigns a delivery truck with a driver', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    truckRepo.findById.mockResolvedValue(deliveryTruck);
    skipRepo.update.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', assignedDeliveryTruckId: 't1' });

    const res = await request(app()).put('/api/skips/s1/assign-delivery-truck').set('Cookie', cookie).send({ truckId: 't1' });
    expect(res.status).toBe(200);
    expect(logComplianceAction).toHaveBeenCalled();
  });

  it('rejects a truck without a driver (FR-2, 400)', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    truckRepo.findById.mockResolvedValue(driverlessTruck);

    const res = await request(app()).put('/api/skips/s1/assign-delivery-truck').set('Cookie', cookie).send({ truckId: 't3' });
    expect(res.status).toBe(400);
  });

  it('rejects a waste truck on the delivery leg (400)', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    truckRepo.findById.mockResolvedValue(wasteTruck);

    const res = await request(app()).put('/api/skips/s1/assign-delivery-truck').set('Cookie', cookie).send({ truckId: 't2' });
    expect(res.status).toBe(400);
  });

  it('rejects reassignment once mobilized (FR-5, 400)', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', DateMobilized: new Date() });

    const res = await request(app()).put('/api/skips/s1/assign-delivery-truck').set('Cookie', cookie).send({ truckId: 't1' });
    expect(res.status).toBe(400);
    expect(truckRepo.findById).not.toHaveBeenCalled();
  });
});

describe('assign-collection-truck', () => {
  it('assigns a waste truck with a driver', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    truckRepo.findById.mockResolvedValue(wasteTruck);
    skipRepo.update.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', assignedCollectionTruckId: 't2' });

    const res = await request(app()).put('/api/skips/s1/assign-collection-truck').set('Cookie', cookie).send({ truckId: 't2' });
    expect(res.status).toBe(200);
  });

  it('rejects a delivery truck on the collection leg (400)', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    truckRepo.findById.mockResolvedValue(deliveryTruck);

    const res = await request(app()).put('/api/skips/s1/assign-collection-truck').set('Cookie', cookie).send({ truckId: 't1' });
    expect(res.status).toBe(400);
  });
});

// ── RFID scan (FR-9/11/6) ─────────────────────────────────────────────────────
describe('scan (RFID gate)', () => {
  it('mobilizes (under an approved waybill) and credits the on-duty driver', async () => {
    skipRepo.findActiveByTag.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', assignedDeliveryTruckId: deliveryTruck, waybillId: { status: 'approved' } });
    skipRepo.update.mockImplementation((id, data) => Promise.resolve({ _id: 's1', skip_id: 'SKIP-1', ...data }));

    const res = await request(app()).post('/api/skips/scan').set('Cookie', cookie).send({ skipTag: 'TAG-1', scanType: 'mobilize' });
    expect(res.status).toBe(200);
    expect(res.body.data.SkipsTruckDriver).toBe('John');
    expect(res.body.data.SkipsTruckRegNo).toBe('DEL-1');
    expect(res.body.data.mobilizeScanMethod).toBe('rfid');
  });

  it('400 mobilize when the waybill is not approved (FR-17e)', async () => {
    skipRepo.findActiveByTag.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', assignedDeliveryTruckId: deliveryTruck, waybillId: { status: 'issued' } });
    const res = await request(app()).post('/api/skips/scan').set('Cookie', cookie).send({ skipTag: 'TAG-1', scanType: 'mobilize' });
    expect(res.status).toBe(400);
  });

  it('400 mobilize when no waybill attached (FR-17e)', async () => {
    skipRepo.findActiveByTag.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', assignedDeliveryTruckId: deliveryTruck });
    const res = await request(app()).post('/api/skips/scan').set('Cookie', cookie).send({ skipTag: 'TAG-1', scanType: 'mobilize' });
    expect(res.status).toBe(400);
  });

  it('demobilizes using the collection truck', async () => {
    skipRepo.findActiveByTag.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', assignedCollectionTruckId: wasteTruck });
    skipRepo.update.mockImplementation((id, data) => Promise.resolve({ _id: 's1', ...data }));

    const res = await request(app()).post('/api/skips/scan').set('Cookie', cookie).send({ skipTag: 'TAG-1', scanType: 'demobilize' });
    expect(res.status).toBe(200);
    expect(res.body.data.WasteTruckDriverName).toBe('Jane');
    expect(res.body.data.demobilizeScanMethod).toBe('rfid');
  });

  it('404 when no active skip is bound to the tag', async () => {
    skipRepo.findActiveByTag.mockResolvedValue(null);
    const res = await request(app()).post('/api/skips/scan').set('Cookie', cookie).send({ skipTag: 'NOPE', scanType: 'mobilize' });
    expect(res.status).toBe(404);
  });

  it('400 mobilize when no delivery truck assigned (FR-11)', async () => {
    skipRepo.findActiveByTag.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    const res = await request(app()).post('/api/skips/scan').set('Cookie', cookie).send({ skipTag: 'TAG-1', scanType: 'mobilize' });
    expect(res.status).toBe(400);
  });

  it('400 for an invalid scanType', async () => {
    skipRepo.findActiveByTag.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', assignedDeliveryTruckId: deliveryTruck });
    const res = await request(app()).post('/api/skips/scan').set('Cookie', cookie).send({ skipTag: 'TAG-1', scanType: 'teleport' });
    expect(res.status).toBe(400);
  });
});

// ── manual-scan (FR-10) ───────────────────────────────────────────────────────
describe('manual-scan', () => {
  it('allows a supervisor/admin and raises an issue', async () => {
    skipRepo.findById.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', assignedDeliveryTruckId: deliveryTruck, waybillId: { status: 'approved' } });
    skipRepo.update.mockImplementation((id, data) => Promise.resolve({ _id: 's1', skip_id: 'SKIP-1', ...data }));

    const res = await request(app()).post('/api/skips/manual-scan').set('Cookie', cookie)
      .send({ skip_id: 's1', scanType: 'mobilize', reason: 'gate offline' });
    expect(res.status).toBe(200);
    expect(res.body.data.mobilizeScanMethod).toBe('manual');
    expect(res.body.data.mobilizeManualReason).toBe('gate offline');
    expect(notifyIssue).toHaveBeenCalled();
  });

  it('403 for a non-authorized role', async () => {
    mockRedisClient.get.mockResolvedValue(STAFF);
    const res = await request(app()).post('/api/skips/manual-scan').set('Cookie', cookie)
      .send({ skip_id: 's1', scanType: 'mobilize', reason: 'x' });
    expect(res.status).toBe(403);
  });

  it('400 when reason is missing', async () => {
    const res = await request(app()).post('/api/skips/manual-scan').set('Cookie', cookie)
      .send({ skip_id: 's1', scanType: 'mobilize' });
    expect(res.status).toBe(400);
  });
});

// ── project assignment ────────────────────────────────────────────────────────
describe('project', () => {
  it('assigns a skip to a project', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    skipRepo.update.mockImplementation((id, data) => Promise.resolve({ _id: 's1', skip_id: 'SKIP-1', ...data }));
    const res = await request(app()).put('/api/skips/s1/project').set('Cookie', cookie).send({ projectId: 'p1' });
    expect(res.status).toBe(200);
    expect(res.body.data.projectId).toBe('p1');
  });

  it('clears a skip project with null', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    skipRepo.update.mockImplementation((id, data) => Promise.resolve({ _id: 's1', ...data }));
    const res = await request(app()).put('/api/skips/s1/project').set('Cookie', cookie).send({ projectId: null });
    expect(res.status).toBe(200);
    expect(res.body.data.projectId).toBeNull();
  });

  it('sets a per-skip rate override', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    skipRepo.update.mockImplementation((id, data) => Promise.resolve({ _id: 's1', skip_id: 'SKIP-1', ...data }));
    const res = await request(app()).put('/api/skips/s1/rate').set('Cookie', cookie).send({ dailyRateUsd: 175 });
    expect(res.status).toBe(200);
    expect(res.body.data.dailyRateUsdOverride).toBe(175);
  });

  it('rejects a negative rate override', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    const res = await request(app()).put('/api/skips/s1/rate').set('Cookie', cookie).send({ dailyRateUsd: -5 });
    expect(res.status).toBe(400);
  });

  it('list filter project=<id> is pushed to the query', async () => {
    skipRepo.findMany.mockResolvedValue([]);
    skipRepo.count.mockResolvedValue(0);
    await request(app()).get('/api/skips?project=p1').set('Cookie', cookie);
    expect(skipRepo.findMany.mock.calls[0][0]).toEqual(expect.objectContaining({ projectId: 'p1' }));
  });
});

// ── rental (Phase 6) ──────────────────────────────────────────────────────────
describe('rental', () => {
  it('marks a skip as rented', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    skipRepo.update.mockImplementation((id, data) => Promise.resolve({ _id: 's1', skip_id: 'SKIP-1', ...data }));

    const res = await request(app()).put('/api/skips/s1/rental').set('Cookie', cookie)
      .send({ ownership: 'rented', rentedFromCompany: 'Acme', rentalExpectedEnd: '2026-12-31' });
    expect(res.status).toBe(200);
    expect(res.body.data.ownership).toBe('rented');
    expect(res.body.data.rentedFromCompany).toBe('Acme');
  });

  it('400 when renting without rentalExpectedEnd', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1' });
    const res = await request(app()).put('/api/skips/s1/rental').set('Cookie', cookie)
      .send({ ownership: 'rented', rentedFromCompany: 'Acme' });
    expect(res.status).toBe(400);
  });
});

// ── return (FR-16) ────────────────────────────────────────────────────────────
describe('return', () => {
  it('retires a fully-cycled skip', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', DateMobilized: new Date(), DemobilizationOfFilledSkips: new Date() });
    skipRepo.update.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', active: false });

    const res = await request(app()).put('/api/skips/s1/return').set('Cookie', cookie).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(false);
  });

  it('rejects return when demobilization is incomplete (FR-16, 400)', async () => {
    skipRepo.findByIdRaw.mockResolvedValue({ _id: 's1', skip_id: 'SKIP-1', DateMobilized: new Date() });
    const res = await request(app()).put('/api/skips/s1/return').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
    expect(skipRepo.update).not.toHaveBeenCalled();
  });
});
