const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

const mockRedisClient = {
  connect: jest.fn().mockResolvedValue(),
  set: jest.fn(),
  del: jest.fn(),
};

jest.mock('redis', () => ({
  createClient: jest.fn(() => mockRedisClient),
}));

jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

jest.mock('uuid', () => ({
  v4: jest.fn(),
}));

jest.mock('../../../models/users_', () => ({
  findOne: jest.fn(),
}));

const mockLeaveBalance = {
  year: 2026,
  Annual: { entitlement: 21, taken: 0 },
  Sick: { entitlement: 10, taken: 0 },
  toObject: jest.fn().mockReturnValue({
    year: 2026,
    Annual: { entitlement: 21, taken: 0 },
    Sick: { entitlement: 10, taken: 0 },
    summary: { Annual: { entitlement: 21, taken: 0, balance: 21 } },
  }),
};

jest.mock('../../../repositories/leave.repository', () => ({
  getOrCreateBalance: jest.fn().mockResolvedValue(mockLeaveBalance),
}));

const bcrypt = require('bcrypt');
const AdminUser = require('../../../models/users_');
const { v4: uuidv4 } = require('uuid');
const leaveRepository = require('../../../repositories/leave.repository');
const adminUserRouter = require('../../../routes/v1/admin_user');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/admin-user', adminUserRouter);
  return app;
}

describe('admin_user routes', () => {
  const sampleUser = {
    _id: '507f1f77bcf86cd799439011',
    password: 'hashed-password',
    role: 'admin',
    email: 'admin@example.com',
    name: 'Admin User',
    canApprove: true,
    Department: 'Finance',
    createdAt: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.set.mockResolvedValue('OK');
    mockRedisClient.del.mockResolvedValue(1);
    bcrypt.compare.mockResolvedValue(true);
    uuidv4.mockReturnValue('session-123');
    AdminUser.findOne.mockReturnValue({
      lean: jest.fn().mockResolvedValue(sampleUser),
    });
  });

  it('creates a redis session and cookie on successful login', async () => {
    const app = buildApp();

    const response = await request(app)
      .post('/api/admin-user/login')
      .send({
        username: 'admin@example.com',
        password: 'plain-password',
      });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mockRedisClient.set).toHaveBeenCalledWith(
      'session:session-123',
      JSON.stringify({
        userId: sampleUser._id,
        role: sampleUser.role,
        email: sampleUser.email,
        name: sampleUser.name,
        canApprove: sampleUser.canApprove,
        Department: sampleUser.Department,
        createdAt: sampleUser.createdAt,
      }),
      'EX',
      1200
    );
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('sessionId=session-123')])
    );
  });

  it('includes leave balance in the login response', async () => {
    const app = buildApp();

    const response = await request(app)
      .post('/api/admin-user/login')
      .send({ username: 'admin@example.com', password: 'plain-password' });

    expect(response.status).toBe(200);
    expect(response.body.user.leaveBalance).toBeDefined();
    expect(response.body.user.leaveBalance.year).toBe(2026);
    expect(response.body.user.leaveBalance.Annual.entitlement).toBe(21);
    expect(leaveRepository.getOrCreateBalance).toHaveBeenCalledWith(
      sampleUser._id,
      new Date().getFullYear()
    );
  });

  it('deletes the redis session using the sessionId cookie on logout', async () => {
    const app = buildApp();

    const response = await request(app)
      .post('/api/admin-user/logout')
      .set('Cookie', ['sessionId=session-123']);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'Logged out and session cleared',
    });
    expect(mockRedisClient.del).toHaveBeenCalledWith('session:session-123');
    expect(response.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('sessionId=;')])
    );
  });

  it('treats an already expired session as a successful logout', async () => {
    const app = buildApp();
    mockRedisClient.del.mockResolvedValueOnce(0);

    const response = await request(app)
      .post('/api/admin-user/logout')
      .set('Cookie', ['sessionId=session-123']);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      message: 'Session already expired and cookie cleared',
    });
    expect(mockRedisClient.del).toHaveBeenCalledWith('session:session-123');
  });

  it('rejects logout when there is no active session cookie', async () => {
    const app = buildApp();

    const response = await request(app)
      .post('/api/admin-user/logout');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      success: false,
      message: 'No active session found',
    });
    expect(mockRedisClient.del).not.toHaveBeenCalled();
  });
});