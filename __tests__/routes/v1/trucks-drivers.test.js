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

// ── Mock the repository + compliance layers (services under test) ────────────
jest.mock('../../../repositories/truck.repository', () => ({
  create: jest.fn(), findById: jest.fn(), findAll: jest.fn(), update: jest.fn(),
}));
jest.mock('../../../repositories/driver.repository', () => ({
  create: jest.fn(), findById: jest.fn(), findAll: jest.fn(), update: jest.fn(),
}));
jest.mock('../../../services/ComplianceLog.service', () => ({
  logComplianceAction: jest.fn().mockResolvedValue({}),
}));

const truckRepo  = require('../../../repositories/truck.repository');
const driverRepo = require('../../../repositories/driver.repository');
const { logComplianceAction } = require('../../../services/ComplianceLog.service');
const truckRouter  = require('../../../routes/v1/truck.routes');
const driverRouter = require('../../../routes/v1/driver.routes');

const SESSION = JSON.stringify({ userId: 'user-001', role: 'global_admin', name: 'Admin', email: 'a@test.com' });

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use('/api/trucks', truckRouter);
  app.use('/api/drivers', driverRouter);
  return app;
}

describe('Trucks & Drivers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
    mockRedisClient.get.mockResolvedValue(SESSION);
  });

  // ── Drivers ─────────────────────────────────────────────────────────────────
  describe('Drivers', () => {
    it('creates a driver and logs it', async () => {
      driverRepo.create.mockResolvedValue({ _id: 'd1', name: 'John Driver' });

      const res = await request(buildApp())
        .post('/api/drivers').set('Cookie', ['sessionId=s1'])
        .send({ name: 'John Driver', licenseNo: 'LIC-1' });

      expect(res.status).toBe(201);
      expect(res.body.data.name).toBe('John Driver');
      expect(logComplianceAction).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'CREATE', entityType: 'Driver' })
      );
    });

    it('rejects a driver with no name (400)', async () => {
      const res = await request(buildApp())
        .post('/api/drivers').set('Cookie', ['sessionId=s1']).send({ licenseNo: 'LIC-1' });

      expect(res.status).toBe(400);
      expect(driverRepo.create).not.toHaveBeenCalled();
    });

    it('returns 404 for a missing driver', async () => {
      driverRepo.findById.mockResolvedValue(null);
      const res = await request(buildApp()).get('/api/drivers/nope').set('Cookie', ['sessionId=s1']);
      expect(res.status).toBe(404);
    });

    it('returns 401 when unauthenticated', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const res = await request(buildApp()).post('/api/drivers').send({ name: 'X' });
      expect(res.status).toBe(401);
    });
  });

  // ── Trucks ──────────────────────────────────────────────────────────────────
  describe('Trucks', () => {
    it('creates a truck', async () => {
      truckRepo.create.mockResolvedValue({ _id: 't1', regNo: 'TRK-1', type: 'delivery' });

      const res = await request(buildApp())
        .post('/api/trucks').set('Cookie', ['sessionId=s1'])
        .send({ regNo: 'TRK-1', type: 'delivery' });

      expect(res.status).toBe(201);
      expect(res.body.data.regNo).toBe('TRK-1');
    });

    it('rejects an invalid truck type (400)', async () => {
      const res = await request(buildApp())
        .post('/api/trucks').set('Cookie', ['sessionId=s1'])
        .send({ regNo: 'TRK-1', type: 'spaceship' });

      expect(res.status).toBe(400);
      expect(truckRepo.create).not.toHaveBeenCalled();
    });

    it('rejects a truck with no regNo (400)', async () => {
      const res = await request(buildApp())
        .post('/api/trucks').set('Cookie', ['sessionId=s1']).send({ type: 'delivery' });
      expect(res.status).toBe(400);
    });

    // ── FR-1: assign / reassign driver ────────────────────────────────────────
    describe('assign-driver (FR-1)', () => {
      it('assigns a driver to a truck (200)', async () => {
        truckRepo.findById.mockResolvedValue({ _id: 't1', regNo: 'TRK-1', currentDriverId: null });
        driverRepo.findById.mockResolvedValue({ _id: 'd1', name: 'John', active: true });
        truckRepo.update.mockResolvedValue({ _id: 't1', regNo: 'TRK-1', currentDriverId: 'd1' });

        const res = await request(buildApp())
          .put('/api/trucks/t1/assign-driver').set('Cookie', ['sessionId=s1'])
          .send({ driverId: 'd1' });

        expect(res.status).toBe(200);
        expect(truckRepo.update).toHaveBeenCalledWith('t1', { currentDriverId: 'd1' });
      });

      it('reassignment is allowed even if the truck already has a driver', async () => {
        truckRepo.findById.mockResolvedValue({ _id: 't1', regNo: 'TRK-1', currentDriverId: 'd0' });
        driverRepo.findById.mockResolvedValue({ _id: 'd1', name: 'New', active: true });
        truckRepo.update.mockResolvedValue({ _id: 't1', currentDriverId: 'd1' });

        const res = await request(buildApp())
          .put('/api/trucks/t1/assign-driver').set('Cookie', ['sessionId=s1'])
          .send({ driverId: 'd1' });

        expect(res.status).toBe(200);
      });

      it('400 when driverId is missing', async () => {
        const res = await request(buildApp())
          .put('/api/trucks/t1/assign-driver').set('Cookie', ['sessionId=s1']).send({});
        expect(res.status).toBe(400);
      });

      it('404 when the truck does not exist', async () => {
        truckRepo.findById.mockResolvedValue(null);
        const res = await request(buildApp())
          .put('/api/trucks/nope/assign-driver').set('Cookie', ['sessionId=s1']).send({ driverId: 'd1' });
        expect(res.status).toBe(404);
      });

      it('404 when the driver does not exist', async () => {
        truckRepo.findById.mockResolvedValue({ _id: 't1', regNo: 'TRK-1' });
        driverRepo.findById.mockResolvedValue(null);
        const res = await request(buildApp())
          .put('/api/trucks/t1/assign-driver').set('Cookie', ['sessionId=s1']).send({ driverId: 'nope' });
        expect(res.status).toBe(404);
      });

      it('400 when assigning an inactive driver', async () => {
        truckRepo.findById.mockResolvedValue({ _id: 't1', regNo: 'TRK-1' });
        driverRepo.findById.mockResolvedValue({ _id: 'd1', name: 'John', active: false });
        const res = await request(buildApp())
          .put('/api/trucks/t1/assign-driver').set('Cookie', ['sessionId=s1']).send({ driverId: 'd1' });
        expect(res.status).toBe(400);
      });
    });
  });
});
