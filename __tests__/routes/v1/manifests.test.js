const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(),
  get:     jest.fn(),
  expire:  jest.fn().mockResolvedValue(),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedisClient) }));

// Point-of-action OTP is exercised in its own middleware test; pass it through here.
jest.mock('../../../middlewares/check-approver-otp', () => (req, res, next) => next());

jest.mock('../../../repositories/manifest.repository', () => ({
  create: jest.fn(), findById: jest.fn(), findByIdPopulated: jest.fn(), findAll: jest.fn(), update: jest.fn(),
}));
jest.mock('../../../repositories/skip.repository', () => ({
  findById: jest.fn(), findByIdRaw: jest.fn(), findActiveByTag: jest.fn(),
  findTagConflict: jest.fn(), update: jest.fn().mockResolvedValue({}),
}));
jest.mock('../../../services/ComplianceLog.service', () => ({ logComplianceAction: jest.fn().mockResolvedValue({}) }));
jest.mock('../../../services/NotificationService', () => ({
  notifyIssue: jest.fn().mockResolvedValue({ notified: 0 }), EmailNotificationService: class {},
}));

const manifestRepo = require('../../../repositories/manifest.repository');
const skipRepo     = require('../../../repositories/skip.repository');
const { notifyIssue } = require('../../../services/NotificationService');
const manifestRouter = require('../../../routes/v1/manifest.routes');

const STAFF = JSON.stringify({ userId: 'u1', role: 'global_admin', name: 'Admin' });

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/manifests', manifestRouter);
  return a;
}
const cookie = ['sessionId=s1'];
const approverToken = (id = 'ap1', name = 'Site Guy') =>
  jwt.sign({ approverId: id, type: 'siteapprover', name, phone: '+234800' }, process.env.JWT_SECRET);

const demobbed = (skip_id) => ({ _id: skip_id, skip_id, DemobilizationOfFilledSkips: new Date() });
const notDemobbed = (skip_id) => ({ _id: skip_id, skip_id });

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisClient.get.mockResolvedValue(STAFF);
  skipRepo.update.mockResolvedValue({});
});

// ── create (demobilized-only) ─────────────────────────────────────────────────
describe('create', () => {
  it('creates a manifest from demobilized skips', async () => {
    skipRepo.findByIdRaw.mockImplementation((id) => Promise.resolve(demobbed(id)));
    manifestRepo.create.mockResolvedValue({ _id: 'm1', manifestNo: 'MF-1', status: 'issued', attachedSkipIds: ['s1'] });

    const res = await request(app()).post('/api/manifests').set('Cookie', cookie)
      .send({ manifestNo: 'MF-1', skipIds: ['s1'] });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('issued');
  });

  it('rejects a skip that is not demobilized (400)', async () => {
    skipRepo.findByIdRaw.mockImplementation((id) => Promise.resolve(notDemobbed(id)));
    const res = await request(app()).post('/api/manifests').set('Cookie', cookie)
      .send({ manifestNo: 'MF-1', skipIds: ['s1'] });
    expect(res.status).toBe(400);
    expect(manifestRepo.create).not.toHaveBeenCalled();
  });

  it('400 when manifestNo missing', async () => {
    const res = await request(app()).post('/api/manifests').set('Cookie', cookie).send({ skipIds: [] });
    expect(res.status).toBe(400);
  });
});

// ── sign (site approver) ──────────────────────────────────────────────────────
describe('sign', () => {
  it('lets the assigned approver sign and links skips', async () => {
    manifestRepo.findById.mockResolvedValue({ _id: 'm1', manifestNo: 'MF-1', status: 'issued', siteApproverId: 'ap1', attachedSkipIds: ['s1', 's2'] });
    manifestRepo.update.mockResolvedValue({ _id: 'm1', manifestNo: 'MF-1', status: 'signed' });

    const res = await request(app()).put('/api/manifests/m1/sign').set('Authorization', `Bearer ${approverToken('ap1')}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('signed');
    expect(skipRepo.update).toHaveBeenCalledWith('s1', { manifestId: 'm1' });
    expect(skipRepo.update).toHaveBeenCalledWith('s2', { manifestId: 'm1' });
  });

  it('403 when a different approver tries to sign', async () => {
    manifestRepo.findById.mockResolvedValue({ _id: 'm1', status: 'issued', siteApproverId: 'ap1', attachedSkipIds: [] });
    const res = await request(app()).put('/api/manifests/m1/sign').set('Authorization', `Bearer ${approverToken('ap2')}`).send({});
    expect(res.status).toBe(403);
  });

  it('401 without an approver token (staff cannot sign)', async () => {
    const res = await request(app()).put('/api/manifests/m1/sign').set('Cookie', cookie).send({});
    expect(res.status).toBe(401);
  });

  it('400 when already signed', async () => {
    manifestRepo.findById.mockResolvedValue({ _id: 'm1', status: 'signed', siteApproverId: 'ap1' });
    const res = await request(app()).put('/api/manifests/m1/sign').set('Authorization', `Bearer ${approverToken('ap1')}`).send({});
    expect(res.status).toBe(400);
  });
});

// ── reject (site approver) ────────────────────────────────────────────────────
describe('reject', () => {
  it('rejects, snapshots, unlinks skips and raises an issue', async () => {
    manifestRepo.findById.mockResolvedValue({ _id: 'm1', manifestNo: 'MF-1', status: 'issued', siteApproverId: 'ap1', attachedSkipIds: ['s1', 's2'] });
    manifestRepo.update.mockResolvedValue({ _id: 'm1', manifestNo: 'MF-1', status: 'rejected' });

    const res = await request(app()).put('/api/manifests/m1/reject').set('Authorization', `Bearer ${approverToken('ap1')}`)
      .send({ reason: 'contamination mismatch' });
    expect(res.status).toBe(200);
    expect(skipRepo.update).toHaveBeenCalledWith('s1', { manifestId: null });
    expect(manifestRepo.update).toHaveBeenCalledWith('m1', expect.objectContaining({ previouslyAttachedSkipIds: ['s1', 's2'], attachedSkipIds: [] }));
    expect(notifyIssue).toHaveBeenCalled();
  });

  it('400 when no reason given', async () => {
    const res = await request(app()).put('/api/manifests/m1/reject').set('Authorization', `Bearer ${approverToken('ap1')}`).send({});
    expect(res.status).toBe(400);
  });
});

// ── approver-scoped reads (portal) ────────────────────────────────────────────
describe('approver /mine', () => {
  it('lists only manifests assigned to the approver', async () => {
    manifestRepo.findAll.mockResolvedValue([{ _id: 'm1', manifestNo: 'MF-1', siteApproverId: 'ap1' }]);
    const res = await request(app()).get('/api/manifests/mine?status=issued').set('Authorization', `Bearer ${approverToken('ap1')}`);
    expect(res.status).toBe(200);
    expect(manifestRepo.findAll).toHaveBeenCalledWith(expect.objectContaining({ siteApproverId: 'ap1', status: 'issued' }));
  });

  it('404 on a manifest not assigned to the approver', async () => {
    manifestRepo.findByIdPopulated.mockResolvedValue({ _id: 'm1', siteApproverId: { _id: 'apOTHER' } });
    const res = await request(app()).get('/api/manifests/mine/m1').set('Authorization', `Bearer ${approverToken('ap1')}`);
    expect(res.status).toBe(404);
  });

  it('returns an assigned manifest detail', async () => {
    manifestRepo.findByIdPopulated.mockResolvedValue({ _id: 'm1', manifestNo: 'MF-1', siteApproverId: { _id: 'ap1' } });
    const res = await request(app()).get('/api/manifests/mine/m1').set('Authorization', `Bearer ${approverToken('ap1')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.manifestNo).toBe('MF-1');
  });

  it('401 without an approver token', async () => {
    const res = await request(app()).get('/api/manifests/mine').set('Cookie', cookie);
    expect(res.status).toBe(401);
  });
});

// ── attach-skips (staff) ──────────────────────────────────────────────────────
describe('attach-skips', () => {
  it('merges more demobilized skips into an open manifest', async () => {
    manifestRepo.findById.mockResolvedValue({ _id: 'm1', manifestNo: 'MF-1', status: 'issued', attachedSkipIds: ['s1'] });
    skipRepo.findByIdRaw.mockImplementation((id) => Promise.resolve(demobbed(id)));
    manifestRepo.update.mockResolvedValue({ _id: 'm1', attachedSkipIds: ['s1', 's2'] });

    const res = await request(app()).put('/api/manifests/m1/attach-skips').set('Cookie', cookie).send({ skipIds: ['s2'] });
    expect(res.status).toBe(200);
    expect(manifestRepo.update).toHaveBeenCalledWith('m1', { attachedSkipIds: ['s1', 's2'] });
  });

  it('400 attaching to a signed manifest', async () => {
    manifestRepo.findById.mockResolvedValue({ _id: 'm1', status: 'signed', attachedSkipIds: [] });
    const res = await request(app()).put('/api/manifests/m1/attach-skips').set('Cookie', cookie).send({ skipIds: ['s2'] });
    expect(res.status).toBe(400);
  });
});
