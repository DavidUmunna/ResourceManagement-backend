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

// ── Mock models ──────────────────────────────────────────────────────────────
jest.mock('../../../models/Assets', () => ({
  countDocuments: jest.fn().mockResolvedValue(0),
  aggregate:      jest.fn().mockResolvedValue([]),
  distinct:       jest.fn().mockResolvedValue([]),
}));

jest.mock('../../../models/AssetExpenditure', () => ({
  find:      jest.fn(),
  aggregate: jest.fn(),
}));

const AssetItem        = require('../../../models/Assets');
const AssetExpenditure = require('../../../models/AssetExpenditure');
const assetsRouter     = require('../../../routes/v1/assets_route');

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
  app.use('/api/assets', assetsRouter);
  return app;
}

// Chainable find().sort().lean()
function chainableFind(result) {
  return { sort: () => ({ lean: () => Promise.resolve(result) }) };
}

const EXP_RECORDS = [
  { category: 'waste_management', subCategory: 'Compactors', totalExpenditure: 5000, orderCount: 2, updatedAt: new Date('2026-02-10') },
  { category: 'waste_management', subCategory: 'Trucks',     totalExpenditure: 3000, orderCount: 1, updatedAt: new Date('2026-02-15') },
];

describe('Asset expenditure endpoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRedisClient.connect.mockResolvedValue();
    mockRedisClient.expire.mockResolvedValue();
    mockRedisClient.get.mockResolvedValue(SESSION);
    AssetItem.countDocuments.mockResolvedValue(0);
    AssetItem.aggregate.mockResolvedValue([]);
    AssetItem.distinct.mockResolvedValue([]);
  });

  // ── GET /api/assets/expenditure ─────────────────────────────────────────────
  describe('GET /api/assets/expenditure', () => {
    it('returns all-time expenditure with a total when no dates are given', async () => {
      AssetExpenditure.find.mockReturnValue(chainableFind(EXP_RECORDS));

      const res = await request(buildApp())
        .get('/api/assets/expenditure')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(res.body.data.totalExpenditure).toBe(8000);
      expect(res.body.data.expenditureBySubCategory).toHaveLength(2);
      expect(res.body.data.expenditureBySubCategory[0]).toMatchObject({
        subCategory: 'Compactors',
        totalExpenditure: 5000,
        orderCount: 2,
      });
      // date comes from the record's updatedAt
      expect(res.body.data.expenditureBySubCategory[0].lastExpenseAt).toBeTruthy();
      expect(AssetExpenditure.aggregate).not.toHaveBeenCalled();
    });

    it('aggregates entries within a date range when dates are given', async () => {
      AssetExpenditure.aggregate.mockResolvedValue([
        { _id: { category: 'waste_management', subCategory: 'Compactors' }, totalExpenditure: 2000, orderCount: 1, lastExpenseAt: new Date('2026-02-12') },
      ]);

      const res = await request(buildApp())
        .get('/api/assets/expenditure?startDate=2026-02-01&endDate=2026-02-28')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(AssetExpenditure.aggregate).toHaveBeenCalledTimes(1);
      expect(AssetExpenditure.find).not.toHaveBeenCalled();
      expect(res.body.data.totalExpenditure).toBe(2000);
      expect(res.body.data.expenditureBySubCategory[0]).toMatchObject({
        category: 'waste_management',
        subCategory: 'Compactors',
        totalExpenditure: 2000,
      });
    });

    it('applies a $match on entries.at built from the date range', async () => {
      AssetExpenditure.aggregate.mockResolvedValue([]);

      await request(buildApp())
        .get('/api/assets/expenditure?startDate=2026-02-01&endDate=2026-02-28')
        .set('Cookie', ['sessionId=s1']);

      const pipeline = AssetExpenditure.aggregate.mock.calls[0][0];
      const matchStage = pipeline.find(s => s.$match && s.$match['entries.at']);
      expect(matchStage).toBeTruthy();
      expect(matchStage.$match['entries.at'].$gte).toBeInstanceOf(Date);
      expect(matchStage.$match['entries.at'].$lte).toBeInstanceOf(Date);
    });

    it('returns 401 when unauthenticated', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const res = await request(buildApp()).get('/api/assets/expenditure');

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/assets/stats ───────────────────────────────────────────────────
  describe('GET /api/assets/stats', () => {
    it('includes expenditureBySubCategory and totalExpenditure', async () => {
      AssetExpenditure.find.mockReturnValue(chainableFind(EXP_RECORDS));

      const res = await request(buildApp())
        .get('/api/assets/stats')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(res.body.data.totalExpenditure).toBe(8000);
      expect(res.body.data.expenditureBySubCategory).toHaveLength(2);
      expect(res.body.data).toHaveProperty('totalItems');
    });
  });
});
