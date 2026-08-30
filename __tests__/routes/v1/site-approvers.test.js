const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

// ── Mock Redis (staff auth) ──────────────────────────────────────────────────
const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(),
  get:     jest.fn(),
  expire:  jest.fn().mockResolvedValue(),
};
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedisClient) }));

jest.mock('../../../repositories/siteApprover.repository', () => ({
  create: jest.fn(), findById: jest.fn(), findByPhone: jest.fn(), findAll: jest.fn(), update: jest.fn(),
}));
jest.mock('../../../services/smsService', () => ({ sendSms: jest.fn().mockResolvedValue({ provider: 'mock' }) }));
jest.mock('../../../services/ComplianceLog.service', () => ({ logComplianceAction: jest.fn().mockResolvedValue({}) }));

const approverRepo = require('../../../repositories/siteApprover.repository');
const { sendSms } = require('../../../services/smsService');
const approverRouter = require('../../../routes/v1/siteApprover.routes');

const STAFF_ADMIN = JSON.stringify({ userId: 'admin1', role: 'global_admin', name: 'Admin' });

function app() {
  const a = express();
  a.use(express.json());
  a.use(cookieParser());
  a.use('/api/site-approvers', approverRouter);
  return a;
}
const cookie = ['sessionId=s1'];

beforeEach(() => {
  jest.clearAllMocks();
  mockRedisClient.get.mockResolvedValue(STAFF_ADMIN);
});

// ── Admin provisioning ────────────────────────────────────────────────────────
describe('admin create', () => {
  it('provisions an approver with a temp password (no secrets returned)', async () => {
    approverRepo.findByPhone.mockResolvedValue(null);
    approverRepo.create.mockResolvedValue({
      _id: 'a1', name: 'Site Guy', phone: '+2348000000000', mustChangePassword: true,
      toObject() { return { _id: 'a1', name: 'Site Guy', phone: '+2348000000000', passwordHash: 'x', otpHash: 'y', mustChangePassword: true }; },
    });

    const res = await request(app()).post('/api/site-approvers').set('Cookie', cookie)
      .send({ name: 'Site Guy', phone: '+2348000000000', tempPassword: 'Temp1234' });

    expect(res.status).toBe(201);
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data.otpHash).toBeUndefined();
  });

  it('409 on duplicate phone', async () => {
    approverRepo.findByPhone.mockResolvedValue({ _id: 'a1' });
    const res = await request(app()).post('/api/site-approvers').set('Cookie', cookie)
      .send({ name: 'X', phone: '+2348000000000', tempPassword: 'Temp1234' });
    expect(res.status).toBe(409);
  });

  it('400 when required fields missing', async () => {
    const res = await request(app()).post('/api/site-approvers').set('Cookie', cookie).send({ name: 'X' });
    expect(res.status).toBe(400);
  });

  it('401 when not authenticated as staff', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    const res = await request(app()).post('/api/site-approvers').send({ name: 'X' });
    expect(res.status).toBe(401);
  });
});

// ── Login → OTP → JWT (public) ────────────────────────────────────────────────
describe('login + verify-otp', () => {
  it('sends an OTP on valid credentials (generic response)', async () => {
    const passwordHash = await bcrypt.hash('secret12', 10);
    approverRepo.findByPhone.mockResolvedValue({ _id: 'a1', phone: '+234800', passwordHash, active: true });
    approverRepo.update.mockResolvedValue({});

    const res = await request(app()).post('/api/site-approvers/login').send({ phone: '+234800', password: 'secret12' });
    expect(res.status).toBe(200);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it('returns generic response (no OTP) on bad password', async () => {
    const passwordHash = await bcrypt.hash('secret12', 10);
    approverRepo.findByPhone.mockResolvedValue({ _id: 'a1', phone: '+234800', passwordHash, active: true });

    const res = await request(app()).post('/api/site-approvers/login').send({ phone: '+234800', password: 'wrong' });
    expect(res.status).toBe(200);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('verify-otp issues a site-approver JWT', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    approverRepo.findByPhone.mockResolvedValue({
      _id: 'a1', name: 'Site Guy', phone: '+234800', active: true,
      otpHash, otpExpiresAt: new Date(Date.now() + 60000), mustChangePassword: true,
    });
    approverRepo.update.mockResolvedValue({});

    const res = await request(app()).post('/api/site-approvers/verify-otp').send({ phone: '+234800', otp: '123456' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
    const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
    expect(decoded.type).toBe('siteapprover');
    expect(decoded.approverId).toBe('a1');
  });

  it('verify-otp rejects a wrong code (401)', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    approverRepo.findByPhone.mockResolvedValue({ _id: 'a1', phone: '+234800', active: true, otpHash, otpExpiresAt: new Date(Date.now() + 60000) });
    const res = await request(app()).post('/api/site-approvers/verify-otp').send({ phone: '+234800', otp: '000000' });
    expect(res.status).toBe(401);
  });

  it('verify-otp rejects an expired code (401)', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    approverRepo.findByPhone.mockResolvedValue({ _id: 'a1', phone: '+234800', active: true, otpHash, otpExpiresAt: new Date(Date.now() - 1000) });
    const res = await request(app()).post('/api/site-approvers/verify-otp').send({ phone: '+234800', otp: '123456' });
    expect(res.status).toBe(401);
  });
});

// ── request-otp (point-of-action, FR-19) ──────────────────────────────────────
describe('request-otp', () => {
  it('sends a fresh code to the authenticated approver', async () => {
    const token = jwt.sign({ approverId: 'a1', type: 'siteapprover', name: 'Site Guy' }, process.env.JWT_SECRET);
    approverRepo.findById.mockResolvedValue({ _id: 'a1', phone: '+234800', active: true });
    approverRepo.update.mockResolvedValue({});
    const res = await request(app()).post('/api/site-approvers/request-otp').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(200);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it('401 without an approver token', async () => {
    const res = await request(app()).post('/api/site-approvers/request-otp').send({});
    expect(res.status).toBe(401);
  });
});

// ── forgot / reset password (self-service recovery) ──────────────────────────
describe('forgot-password + reset-password', () => {
  it('forgot-password sends a reset code for a known active phone (generic 200)', async () => {
    approverRepo.findByPhone.mockResolvedValue({ _id: 'a1', phone: '+234800', active: true });
    approverRepo.update.mockResolvedValue({});
    const res = await request(app()).post('/api/site-approvers/forgot-password').send({ phone: '+234800' });
    expect(res.status).toBe(200);
    expect(sendSms).toHaveBeenCalledTimes(1);
  });

  it('forgot-password is generic for an unknown phone (no SMS, no leak)', async () => {
    approverRepo.findByPhone.mockResolvedValue(null);
    const res = await request(app()).post('/api/site-approvers/forgot-password').send({ phone: '+000' });
    expect(res.status).toBe(200);
    expect(sendSms).not.toHaveBeenCalled();
  });

  it('reset-password sets a new password with a valid code', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    approverRepo.findByPhone.mockResolvedValue({ _id: 'a1', phone: '+234800', active: true, otpHash, otpExpiresAt: new Date(Date.now() + 60000) });
    approverRepo.update.mockResolvedValue({});
    const res = await request(app()).post('/api/site-approvers/reset-password').send({ phone: '+234800', otp: '123456', newPassword: 'BrandNew123' });
    expect(res.status).toBe(200);
    expect(approverRepo.update).toHaveBeenCalledWith('a1', expect.objectContaining({ mustChangePassword: false, otpHash: null }));
  });

  it('reset-password rejects a wrong code (401)', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    approverRepo.findByPhone.mockResolvedValue({ _id: 'a1', active: true, otpHash, otpExpiresAt: new Date(Date.now() + 60000) });
    const res = await request(app()).post('/api/site-approvers/reset-password').send({ phone: '+234800', otp: '000000', newPassword: 'BrandNew123' });
    expect(res.status).toBe(401);
  });

  it('reset-password rejects a too-short password (400)', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    approverRepo.findByPhone.mockResolvedValue({ _id: 'a1', active: true, otpHash, otpExpiresAt: new Date(Date.now() + 60000) });
    const res = await request(app()).post('/api/site-approvers/reset-password').send({ phone: '+234800', otp: '123456', newPassword: 'short' });
    expect(res.status).toBe(400);
  });
});

// ── admin update (deactivate / reactivate) ────────────────────────────────────
describe('admin update', () => {
  it('deactivates an approver', async () => {
    approverRepo.findById.mockResolvedValue({ _id: 'a1', name: 'X' });
    approverRepo.update.mockResolvedValue({ _id: 'a1', name: 'X', active: false, toObject() { return { _id: 'a1', name: 'X', active: false, passwordHash: 'h', otpHash: 'o' }; } });
    const res = await request(app()).put('/api/site-approvers/a1').set('Cookie', cookie).send({ active: false });
    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(false);
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it('401 for a non-staff caller', async () => {
    mockRedisClient.get.mockResolvedValue(null);
    const res = await request(app()).put('/api/site-approvers/a1').send({ active: false });
    expect(res.status).toBe(401);
  });
});

// ── change-password (approver JWT) ────────────────────────────────────────────
describe('change-password', () => {
  it('rotates the password when authenticated as the approver', async () => {
    const token = jwt.sign({ approverId: 'a1', type: 'siteapprover', name: 'Site Guy' }, process.env.JWT_SECRET);
    approverRepo.findById.mockResolvedValue({ _id: 'a1' });
    approverRepo.update.mockResolvedValue({});

    const res = await request(app()).post('/api/site-approvers/change-password')
      .set('Authorization', `Bearer ${token}`).send({ newPassword: 'BrandNew123' });
    expect(res.status).toBe(200);
    expect(approverRepo.update).toHaveBeenCalledWith('a1', expect.objectContaining({ mustChangePassword: false }));
  });

  it('401 without an approver token', async () => {
    const res = await request(app()).post('/api/site-approvers/change-password').send({ newPassword: 'BrandNew123' });
    expect(res.status).toBe(401);
  });

  it('rejects a staff session token (wrong type)', async () => {
    const staffToken = jwt.sign({ userId: 'u1', type: 'staff' }, process.env.JWT_SECRET);
    const res = await request(app()).post('/api/site-approvers/change-password')
      .set('Authorization', `Bearer ${staffToken}`).send({ newPassword: 'BrandNew123' });
    expect(res.status).toBe(401);
  });
});
