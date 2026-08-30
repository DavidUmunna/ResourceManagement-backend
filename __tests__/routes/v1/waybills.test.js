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

// Bypass the 2FA middleware (its own behaviour is exercised elsewhere).
jest.mock('../../../middlewares/TwoFactorVerify', () => (req, res, next) => next());

jest.mock('../../../repositories/waybill.repository', () => ({
  create: jest.fn(), findById: jest.fn(), findAll: jest.fn(), update: jest.fn(),
}));
jest.mock('../../../repositories/skip.repository', () => ({
  findById: jest.fn(), findByIdRaw: jest.fn(), findActiveByTag: jest.fn(),
  findTagConflict: jest.fn(), update: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/ComplianceLog.service', () => ({
  logComplianceAction: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/NotificationService', () => ({
  notifyIssue: jest.fn().mockResolvedValue({ notified: 0 }),
  EmailNotificationService: class {},
}));

const waybillRepo = require('../../../repositories/waybill.repository');
const skipRepo    = require('../../../repositories/skip.repository');
const { notifyIssue } = require('../../../services/NotificationService');
const waybillRouter = require('../../../routes/v1/waybill.routes');

const APPROVER = JSON.stringify({ userId: 'u1', role: 'global_admin', name: 'Admin' });
const STAFF    = JSON.stringify({ userId: 'u2', role: 'staff', name: 'Staffer' });

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/waybills', waybillRouter);
  return a;
}
const cookie = ['sessionId=s1'];

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisClient.get.mockResolvedValue(APPROVER);
  skipRepo.update.mockResolvedValue({});
});

describe('create', () => {
  it('creates a waybill in "issued" and links its skips', async () => {
    waybillRepo.create.mockResolvedValue({ _id: 'w1', waybillNo: 'WB-1', status: 'issued', attachedSkipIds: ['s1', 's2'] });

    const res = await request(app()).post('/api/waybills').set('Cookie', cookie)
      .send({ waybillNo: 'WB-1', skipIds: ['s1', 's2'] });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('issued');
    expect(skipRepo.update).toHaveBeenCalledTimes(2);
    expect(skipRepo.update).toHaveBeenCalledWith('s1', { waybillId: 'w1' });
  });

  it('400 when waybillNo is missing', async () => {
    const res = await request(app()).post('/api/waybills').set('Cookie', cookie).send({ skipIds: [] });
    expect(res.status).toBe(400);
  });
});

describe('approve', () => {
  it('approves an issued waybill', async () => {
    waybillRepo.findById.mockResolvedValue({ _id: 'w1', waybillNo: 'WB-1', status: 'issued' });
    waybillRepo.update.mockResolvedValue({ _id: 'w1', waybillNo: 'WB-1', status: 'approved' });

    const res = await request(app()).put('/api/waybills/w1/approve').set('Cookie', cookie).send({ otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('approved');
  });

  it('403 for a non-approver role', async () => {
    mockRedisClient.get.mockResolvedValue(STAFF);
    waybillRepo.findById.mockResolvedValue({ _id: 'w1', status: 'issued' });
    const res = await request(app()).put('/api/waybills/w1/approve').set('Cookie', cookie).send({ otp: '123456' });
    expect(res.status).toBe(403);
  });

  it('400 when approving an already-approved waybill', async () => {
    waybillRepo.findById.mockResolvedValue({ _id: 'w1', status: 'approved' });
    const res = await request(app()).put('/api/waybills/w1/approve').set('Cookie', cookie).send({ otp: '123456' });
    expect(res.status).toBe(400);
  });
});

describe('reject', () => {
  it('rejects, snapshots membership, unlinks skips and raises an issue', async () => {
    waybillRepo.findById.mockResolvedValue({ _id: 'w1', waybillNo: 'WB-1', status: 'issued', attachedSkipIds: ['s1', 's2'] });
    waybillRepo.update.mockResolvedValue({ _id: 'w1', waybillNo: 'WB-1', status: 'rejected', previouslyAttachedSkipIds: ['s1', 's2'], attachedSkipIds: [] });

    const res = await request(app()).put('/api/waybills/w1/reject').set('Cookie', cookie)
      .send({ otp: '123456', reason: 'wrong destination' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('rejected');
    // every previously-attached skip unlinked
    expect(skipRepo.update).toHaveBeenCalledWith('s1', { waybillId: null });
    expect(skipRepo.update).toHaveBeenCalledWith('s2', { waybillId: null });
    // snapshot preserved
    expect(waybillRepo.update).toHaveBeenCalledWith('w1', expect.objectContaining({ previouslyAttachedSkipIds: ['s1', 's2'], attachedSkipIds: [] }));
    expect(notifyIssue).toHaveBeenCalled();
  });

  it('400 when no reason is given', async () => {
    const res = await request(app()).put('/api/waybills/w1/reject').set('Cookie', cookie).send({ otp: '123456' });
    expect(res.status).toBe(400);
  });
});
