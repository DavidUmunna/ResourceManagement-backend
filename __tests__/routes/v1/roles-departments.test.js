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

// monitorLogger touches the DB — stub it out
jest.mock('../../../middlewares/monitorLogger', () => (_req, _res, next) => next());

const rbacRouter = require('../../../routes/v1/roles&departments');

const SESSION = JSON.stringify({
  userId: 'user-001',
  role:   'global_admin',
  name:   'Admin',
  email:  'admin@test.com',
});

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/roles&departments', rbacRouter);
  return app;
}

describe('POST /api/roles&departments — RBAC access lists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
    mockRedisClient.get.mockResolvedValue(SESSION);
  });

  it('returns the maintenance asset access map', async () => {
    const res = await request(buildApp())
      .post('/api/roles&departments')
      .set('Cookie', ['sessionId=s1'])
      .send({ MAINTENANCE_ASSET_ACCESS: true });

    expect(res.status).toBe(200);
    const access = res.body.data.MAINTENANCE_ASSET_ACCESS;
    expect(access.departments).toEqual(expect.arrayContaining(['waste_management_dep', 'IT']));
    expect(access.categoryByDepartment.waste_management_dep).toBe('waste_management');
    // Every allowed department must map to an asset category, else the flow breaks
    expect(access.categoryByDepartment.IT).toBe('IT_equipment');
    access.departments.forEach((dep) => {
      expect(access.categoryByDepartment[dep]).toBeTruthy();
    });
  });

  it('returns the leave summary and leave admin role lists', async () => {
    const res = await request(buildApp())
      .post('/api/roles&departments')
      .set('Cookie', ['sessionId=s1'])
      .send({ LEAVE_SUMMARY_ROLES: true, LEAVE_ADMIN_ROLES: true });

    expect(res.status).toBe(200);
    expect(res.body.data.LEAVE_SUMMARY_ROLES).toEqual(
      expect.arrayContaining(['Director', 'global_admin'])
    );
    expect(res.body.data.LEAVE_ADMIN_ROLES).toEqual(
      expect.arrayContaining(['admin', 'global_admin'])
    );
  });

  it('returns the feedback admin role list', async () => {
    const res = await request(buildApp())
      .post('/api/roles&departments')
      .set('Cookie', ['sessionId=s1'])
      .send({ FEEDBACK_ADMIN_ROLES: true });

    expect(res.status).toBe(200);
    expect(res.body.data.FEEDBACK_ADMIN_ROLES).toEqual(['global_admin']);
  });

  it('only returns the keys that were requested', async () => {
    const res = await request(buildApp())
      .post('/api/roles&departments')
      .set('Cookie', ['sessionId=s1'])
      .send({ FEEDBACK_ADMIN_ROLES: true });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('FEEDBACK_ADMIN_ROLES');
    expect(res.body.data).not.toHaveProperty('LEAVE_ADMIN_ROLES');
    expect(res.body.data).not.toHaveProperty('MAINTENANCE_ASSET_ACCESS');
  });

  it('returns 401 when unauthenticated', async () => {
    mockRedisClient.get.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/roles&departments')
      .send({ FEEDBACK_ADMIN_ROLES: true });

    expect(res.status).toBe(401);
  });
});
