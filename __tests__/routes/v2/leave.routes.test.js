const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

// ── Mock Redis before the auth middleware loads it ───────────────────────────
const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(),
  get: jest.fn(),
  expire: jest.fn().mockResolvedValue(),
};

jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedisClient) }));

// ── Mock service layer so tests never hit the database ───────────────────────
jest.mock('../../../services/leave.service');

const leaveService = require('../../../services/leave.service');
const leaveRouter = require('../../../routes/v2/leave.routes');

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ADMIN_SESSION = JSON.stringify({
  userId: 'admin-001',
  role: 'admin',
  name: 'Admin User',
  email: 'admin@test.com',
});

const GLOBAL_ADMIN_SESSION = JSON.stringify({
  userId: 'gadmin-001',
  role: 'global_admin',
  name: 'Global Admin',
  email: 'gadmin@test.com',
});

const STAFF_SESSION = JSON.stringify({
  userId: 'staff-001',
  role: 'staff',
  name: 'Staff User',
  email: 'staff@test.com',
});

const TOMORROW = new Date(Date.now() + 86400000).toISOString();
const IN_3_DAYS = new Date(Date.now() + 3 * 86400000).toISOString();
const YESTERDAY = new Date(Date.now() - 86400000).toISOString();

const VALID_REQUEST_BODY = {
  leaveType: 'Annual',
  startDate: TOMORROW,
  endDate: IN_3_DAYS,
  reason: 'Annual family vacation time off',
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/v2/leave', leaveRouter);
  return app;
}

function withSession(session) {
  mockRedisClient.get.mockResolvedValue(session);
}

// ── Test Suite ────────────────────────────────────────────────────────────────
describe('Leave Routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('POST /api/v2/leave/requests — create leave request', () => {
    it('creates a request for an authenticated staff member', async () => {
      withSession(STAFF_SESSION);
      const mockData = { _id: 'req-1', ...VALID_REQUEST_BODY, status: 'Pending', daysRequested: 2 };
      leaveService.createRequest.mockResolvedValue({ data: mockData });

      const res = await request(buildApp())
        .post('/api/v2/leave/requests')
        .set('Cookie', ['sessionId=s1'])
        .send(VALID_REQUEST_BODY);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('Pending');
      expect(leaveService.createRequest).toHaveBeenCalledWith('staff-001', VALID_REQUEST_BODY);
    });

    it('returns 400 when leaveType is invalid', async () => {
      withSession(STAFF_SESSION);

      const res = await request(buildApp())
        .post('/api/v2/leave/requests')
        .set('Cookie', ['sessionId=s1'])
        .send({ ...VALID_REQUEST_BODY, leaveType: 'Holiday' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.errors).toEqual(expect.arrayContaining([expect.stringContaining('Invalid leave type')]));
      expect(leaveService.createRequest).not.toHaveBeenCalled();
    });

    it('returns 400 when reason is too short', async () => {
      withSession(STAFF_SESSION);

      const res = await request(buildApp())
        .post('/api/v2/leave/requests')
        .set('Cookie', ['sessionId=s1'])
        .send({ ...VALID_REQUEST_BODY, reason: 'short' });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('at least 10 characters')])
      );
    });

    it('returns 400 when end date is before start date', async () => {
      withSession(STAFF_SESSION);

      const res = await request(buildApp())
        .post('/api/v2/leave/requests')
        .set('Cookie', ['sessionId=s1'])
        .send({ ...VALID_REQUEST_BODY, startDate: IN_3_DAYS, endDate: TOMORROW });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('End date must be on or after')])
      );
    });

    it('returns 400 when start date is in the past', async () => {
      withSession(STAFF_SESSION);

      const res = await request(buildApp())
        .post('/api/v2/leave/requests')
        .set('Cookie', ['sessionId=s1'])
        .send({ ...VALID_REQUEST_BODY, startDate: YESTERDAY, endDate: TOMORROW });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('cannot be in the past')])
      );
    });

    it('returns 400 when leave balance is insufficient', async () => {
      withSession(STAFF_SESSION);
      leaveService.createRequest.mockRejectedValue(new Error('INSUFFICIENT_BALANCE'));

      const res = await request(buildApp())
        .post('/api/v2/leave/requests')
        .set('Cookie', ['sessionId=s1'])
        .send(VALID_REQUEST_BODY);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/insufficient/i);
    });

    it('returns 400 when requested days exceed the org policy limit', async () => {
      withSession(STAFF_SESSION);
      leaveService.createRequest.mockRejectedValue(new Error('EXCEEDS_POLICY'));

      const res = await request(buildApp())
        .post('/api/v2/leave/requests')
        .set('Cookie', ['sessionId=s1'])
        .send(VALID_REQUEST_BODY);

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/organisation policy/i);
    });

    it('returns 401 when unauthenticated', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const res = await request(buildApp())
        .post('/api/v2/leave/requests')
        .send(VALID_REQUEST_BODY);

      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('GET /api/v2/leave/requests — list requests', () => {
    it('admin receives all requests', async () => {
      withSession(ADMIN_SESSION);
      leaveService.getRequests.mockResolvedValue({ data: [{ _id: 'r1' }, { _id: 'r2' }] });

      const res = await request(buildApp())
        .get('/api/v2/leave/requests')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(2);
      expect(leaveService.getRequests).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
        expect.any(Object)
      );
    });

    it('global_admin receives all requests', async () => {
      withSession(GLOBAL_ADMIN_SESSION);
      leaveService.getRequests.mockResolvedValue({ data: [{ _id: 'r1' }] });

      const res = await request(buildApp())
        .get('/api/v2/leave/requests')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(leaveService.getRequests).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'global_admin' }),
        expect.any(Object)
      );
    });

    it('staff receives only their own requests', async () => {
      withSession(STAFF_SESSION);
      leaveService.getRequests.mockResolvedValue({ data: [{ _id: 'r1' }] });

      const res = await request(buildApp())
        .get('/api/v2/leave/requests')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(leaveService.getRequests).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'staff', userId: 'staff-001' }),
        expect.any(Object)
      );
    });

    it('forwards ?status query to the service', async () => {
      withSession(ADMIN_SESSION);
      leaveService.getRequests.mockResolvedValue({ data: [{ _id: 'r1', status: 'Pending' }] });

      const res = await request(buildApp())
        .get('/api/v2/leave/requests?status=Pending')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(leaveService.getRequests).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ status: 'Pending' })
      );
    });

    it('forwards ?leaveType query to the service', async () => {
      withSession(ADMIN_SESSION);
      leaveService.getRequests.mockResolvedValue({ data: [] });

      const res = await request(buildApp())
        .get('/api/v2/leave/requests?leaveType=Sick')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(leaveService.getRequests).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ leaveType: 'Sick' })
      );
    });

    it('forwards ?userId query to the service', async () => {
      withSession(ADMIN_SESSION);
      leaveService.getRequests.mockResolvedValue({ data: [] });

      const res = await request(buildApp())
        .get('/api/v2/leave/requests?userId=staff-001')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(leaveService.getRequests).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ userId: 'staff-001' })
      );
    });

    it('forwards ?startDate and ?endDate queries to the service', async () => {
      withSession(ADMIN_SESSION);
      leaveService.getRequests.mockResolvedValue({ data: [] });

      const res = await request(buildApp())
        .get('/api/v2/leave/requests?startDate=2026-07-01&endDate=2026-07-31')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(leaveService.getRequests).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ startDate: '2026-07-01', endDate: '2026-07-31' })
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('GET /api/v2/leave/requests/:id — get single request', () => {
    it('returns the request when found and user is owner or admin', async () => {
      withSession(STAFF_SESSION);
      leaveService.getRequestById.mockResolvedValue({ data: { _id: 'r1', status: 'Pending' } });

      const res = await request(buildApp())
        .get('/api/v2/leave/requests/r1')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(res.body.data._id).toBe('r1');
    });

    it('returns 403 when staff tries to access another user\'s request', async () => {
      withSession(STAFF_SESSION);
      leaveService.getRequestById.mockRejectedValue(new Error('FORBIDDEN'));

      const res = await request(buildApp())
        .get('/api/v2/leave/requests/other-req')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(403);
    });

    it('returns 404 when request does not exist', async () => {
      withSession(ADMIN_SESSION);
      leaveService.getRequestById.mockRejectedValue(new Error('NOT_FOUND'));

      const res = await request(buildApp())
        .get('/api/v2/leave/requests/nonexistent')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(404);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('PUT /api/v2/leave/requests/:id/approve', () => {
    it('admin approves a pending request', async () => {
      withSession(ADMIN_SESSION);
      leaveService.approveRequest.mockResolvedValue({ data: { _id: 'r1', status: 'Approved' } });

      const res = await request(buildApp())
        .put('/api/v2/leave/requests/r1/approve')
        .set('Cookie', ['sessionId=s1'])
        .send({ adminComment: 'Approved.' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Approved');
      expect(leaveService.approveRequest).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
        'r1',
        'Approved.'
      );
    });

    it('global_admin can also approve', async () => {
      withSession(GLOBAL_ADMIN_SESSION);
      leaveService.approveRequest.mockResolvedValue({ data: { _id: 'r1', status: 'Approved' } });

      const res = await request(buildApp())
        .put('/api/v2/leave/requests/r1/approve')
        .set('Cookie', ['sessionId=s1'])
        .send({});

      expect(res.status).toBe(200);
    });

    it('returns 403 when staff tries to approve', async () => {
      withSession(STAFF_SESSION);
      leaveService.approveRequest.mockRejectedValue(new Error('FORBIDDEN'));

      const res = await request(buildApp())
        .put('/api/v2/leave/requests/r1/approve')
        .set('Cookie', ['sessionId=s1'])
        .send({});

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Access denied');
    });

    it('returns 400 when request is not in Pending status', async () => {
      withSession(ADMIN_SESSION);
      leaveService.approveRequest.mockRejectedValue(new Error('NOT_PENDING'));

      const res = await request(buildApp())
        .put('/api/v2/leave/requests/r1/approve')
        .set('Cookie', ['sessionId=s1'])
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Request is not in Pending status');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('PUT /api/v2/leave/requests/:id/reject', () => {
    it('admin rejects a pending request', async () => {
      withSession(ADMIN_SESSION);
      leaveService.rejectRequest.mockResolvedValue({ data: { _id: 'r1', status: 'Rejected' } });

      const res = await request(buildApp())
        .put('/api/v2/leave/requests/r1/reject')
        .set('Cookie', ['sessionId=s1'])
        .send({ adminComment: 'Not approved at this time.' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Rejected');
    });

    it('returns 403 when staff tries to reject', async () => {
      withSession(STAFF_SESSION);
      leaveService.rejectRequest.mockRejectedValue(new Error('FORBIDDEN'));

      const res = await request(buildApp())
        .put('/api/v2/leave/requests/r1/reject')
        .set('Cookie', ['sessionId=s1'])
        .send({});

      expect(res.status).toBe(403);
    });

    it('returns 400 when request is already approved', async () => {
      withSession(ADMIN_SESSION);
      leaveService.rejectRequest.mockRejectedValue(new Error('NOT_PENDING'));

      const res = await request(buildApp())
        .put('/api/v2/leave/requests/r1/reject')
        .set('Cookie', ['sessionId=s1'])
        .send({});

      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('DELETE /api/v2/leave/requests/:id — cancel request', () => {
    it('staff cancels their own pending request', async () => {
      withSession(STAFF_SESSION);
      leaveService.cancelRequest.mockResolvedValue({ data: { _id: 'r1', status: 'Cancelled' } });

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/r1')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Cancelled');
    });

    it('admin can cancel any pending request', async () => {
      withSession(ADMIN_SESSION);
      leaveService.cancelRequest.mockResolvedValue({ data: { _id: 'r1', status: 'Cancelled' } });

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/r1')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
    });

    it('returns 400 when request is already approved and cannot be cancelled', async () => {
      withSession(STAFF_SESSION);
      leaveService.cancelRequest.mockRejectedValue(new Error('CANNOT_CANCEL'));

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/r1')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Only pending requests can be cancelled');
    });

    it('returns 403 when staff tries to cancel another user\'s request', async () => {
      withSession(STAFF_SESSION);
      leaveService.cancelRequest.mockRejectedValue(new Error('FORBIDDEN'));

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/other-req')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(403);
    });

    it('admin can cancel an already-Approved request', async () => {
      withSession(ADMIN_SESSION);
      leaveService.cancelRequest.mockResolvedValue({ data: { _id: 'r1', status: 'Cancelled' } });

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/r1')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('Cancelled');
    });

    it('staff still cannot cancel a non-Pending request', async () => {
      withSession(STAFF_SESSION);
      leaveService.cancelRequest.mockRejectedValue(new Error('CANNOT_CANCEL'));

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/r1')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe('Only pending requests can be cancelled');
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('DELETE /api/v2/leave/requests/:id/hard — hard delete (admin only)', () => {
    it('admin permanently deletes a request', async () => {
      withSession(ADMIN_SESSION);
      leaveService.deleteRequest.mockResolvedValue({ success: true });

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/r1/hard')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(leaveService.deleteRequest).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
        'r1'
      );
    });

    it('global_admin can also permanently delete a request', async () => {
      withSession(GLOBAL_ADMIN_SESSION);
      leaveService.deleteRequest.mockResolvedValue({ success: true });

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/r1/hard')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(leaveService.deleteRequest).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'global_admin' }),
        'r1'
      );
    });

    it('returns 403 when staff tries to hard delete', async () => {
      withSession(STAFF_SESSION);
      leaveService.deleteRequest.mockRejectedValue(new Error('FORBIDDEN'));

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/r1/hard')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(403);
      expect(res.body.message).toBe('Access denied');
    });

    it('returns 404 when the request does not exist', async () => {
      withSession(ADMIN_SESSION);
      leaveService.deleteRequest.mockRejectedValue(new Error('NOT_FOUND'));

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/nonexistent/hard')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(404);
      expect(res.body.message).toBe('Leave request not found');
    });

    it('returns 401 when unauthenticated', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const res = await request(buildApp())
        .delete('/api/v2/leave/requests/r1/hard');

      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('GET /api/v2/leave/balance — own balance', () => {
    it('returns current year balance for authenticated user', async () => {
      withSession(STAFF_SESSION);
      const mockBalance = {
        user: 'staff-001',
        year: 2026,
        Annual: { entitlement: 21, taken: 5 },
        summary: { Annual: { entitlement: 21, taken: 5, balance: 16 } },
      };
      leaveService.getBalance.mockResolvedValue({ data: mockBalance });

      const res = await request(buildApp())
        .get('/api/v2/leave/balance')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(res.body.data.Annual.entitlement).toBe(21);
      expect(leaveService.getBalance).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'staff-001' }),
        undefined
      );
    });
  });

  describe('GET /api/v2/leave/balance/:userId — specific user balance', () => {
    it('admin can view any user\'s balance', async () => {
      withSession(ADMIN_SESSION);
      leaveService.getBalance.mockResolvedValue({ data: { user: 'staff-001', year: 2026 } });

      const res = await request(buildApp())
        .get('/api/v2/leave/balance/staff-001')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(leaveService.getBalance).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
        'staff-001'
      );
    });

    it('returns 403 when staff tries to view another user\'s balance', async () => {
      withSession(STAFF_SESSION);
      leaveService.getBalance.mockRejectedValue(new Error('FORBIDDEN'));

      const res = await request(buildApp())
        .get('/api/v2/leave/balance/other-user')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  describe('PUT /api/v2/leave/balance/:userId — update entitlement', () => {
    it('admin updates entitlement for a user', async () => {
      withSession(ADMIN_SESSION);
      const updatedBalance = { user: 'staff-001', year: 2026, Annual: { entitlement: 25, taken: 5 } };
      leaveService.updateEntitlement.mockResolvedValue({ data: updatedBalance });

      const res = await request(buildApp())
        .put('/api/v2/leave/balance/staff-001')
        .set('Cookie', ['sessionId=s1'])
        .send({ leaveType: 'Annual', entitlement: 25 });

      expect(res.status).toBe(200);
      expect(res.body.data.Annual.entitlement).toBe(25);
      expect(leaveService.updateEntitlement).toHaveBeenCalledWith(
        expect.objectContaining({ role: 'admin' }),
        'staff-001',
        'Annual',
        25
      );
    });

    it('returns 400 when leaveType is invalid', async () => {
      withSession(ADMIN_SESSION);

      const res = await request(buildApp())
        .put('/api/v2/leave/balance/staff-001')
        .set('Cookie', ['sessionId=s1'])
        .send({ leaveType: 'Vacation', entitlement: 10 });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('Invalid leave type')])
      );
    });

    it('returns 400 when entitlement is negative', async () => {
      withSession(ADMIN_SESSION);

      const res = await request(buildApp())
        .put('/api/v2/leave/balance/staff-001')
        .set('Cookie', ['sessionId=s1'])
        .send({ leaveType: 'Annual', entitlement: -1 });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('0 or greater')])
      );
    });

    it('returns 400 when entitlement is missing', async () => {
      withSession(ADMIN_SESSION);

      const res = await request(buildApp())
        .put('/api/v2/leave/balance/staff-001')
        .set('Cookie', ['sessionId=s1'])
        .send({ leaveType: 'Annual' });

      expect(res.status).toBe(400);
      expect(res.body.errors).toEqual(
        expect.arrayContaining([expect.stringContaining('Entitlement is required')])
      );
    });

    it('returns 403 when staff tries to update entitlement', async () => {
      withSession(STAFF_SESSION);
      leaveService.updateEntitlement.mockRejectedValue(new Error('FORBIDDEN'));

      const res = await request(buildApp())
        .put('/api/v2/leave/balance/staff-001')
        .set('Cookie', ['sessionId=s1'])
        .send({ leaveType: 'Annual', entitlement: 30 });

      expect(res.status).toBe(403);
    });

    it('returns 404 when target user does not exist', async () => {
      withSession(ADMIN_SESSION);
      leaveService.updateEntitlement.mockRejectedValue(new Error('USER_NOT_FOUND'));

      const res = await request(buildApp())
        .put('/api/v2/leave/balance/nonexistent-user')
        .set('Cookie', ['sessionId=s1'])
        .send({ leaveType: 'Annual', entitlement: 21 });

      expect(res.status).toBe(404);
    });
  });
});
