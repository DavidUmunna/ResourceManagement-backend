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

// Chainable find().sort().lean()  (used by /stats)
function chainableFind(result) {
  return { sort: () => ({ lean: () => Promise.resolve(result) }) };
}
// Chainable find().sort().populate().lean()  (used by /expenditure)
function chainablePopulate(result) {
  return { sort: () => ({ populate: () => ({ lean: () => Promise.resolve(result) }) }) };
}

const EXP_RECORDS = [
  {
    category: 'waste_management', subCategory: 'Compactors', totalExpenditure: 5000, orderCount: 2, updatedAt: new Date('2026-02-10'),
    entries: [
      { amount: 2000, at: new Date('2026-02-05'), order: { orderNumber: 'PO-1', Title: 'Hydraulics', remarks: 'hydraulic seal replacement' } },
      { amount: 3000, at: new Date('2026-02-10'), order: { orderNumber: 'PO-2', Title: 'Motor', remarks: 'motor repair' } },
    ],
  },
  {
    category: 'waste_management', subCategory: 'Trucks', totalExpenditure: 3000, orderCount: 1, updatedAt: new Date('2026-02-15'),
    entries: [
      { amount: 3000, at: new Date('2026-02-15'), order: { orderNumber: 'PO-3', Title: 'Tyres', remarks: 'tyre change' } },
    ],
  },
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
      AssetExpenditure.find.mockReturnValue(chainablePopulate(EXP_RECORDS));

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
      expect(res.body.data.expenditureBySubCategory[0].lastExpenseAt).toBeTruthy();
    });

    it('includes each entry with the order title and remark (newest first)', async () => {
      AssetExpenditure.find.mockReturnValue(chainablePopulate(EXP_RECORDS));

      const res = await request(buildApp())
        .get('/api/assets/expenditure')
        .set('Cookie', ['sessionId=s1']);

      const compactors = res.body.data.expenditureBySubCategory[0];
      expect(compactors.entries).toHaveLength(2);
      // sorted newest first → PO-2 (2026-02-10) before PO-1 (2026-02-05)
      expect(compactors.entries[0]).toMatchObject({
        orderNumber: 'PO-2',
        title: 'Motor',            // shown as the reason
        remark: 'motor repair',    // requester's remarks kept
        amount: 3000,
      });
      expect(compactors.entries[1].remark).toBe('hydraulic seal replacement');
      expect(compactors.entries[1].title).toBe('Hydraulics');
    });

    it('filters entries to the given date range and recomputes totals', async () => {
      AssetExpenditure.find.mockReturnValue(chainablePopulate(EXP_RECORDS));

      // From 2026-02-08 → Compactors keeps only its 02-10 entry (3000), Trucks keeps its 02-15 (3000)
      const res = await request(buildApp())
        .get('/api/assets/expenditure?startDate=2026-02-08&endDate=2026-02-28')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(res.body.data.totalExpenditure).toBe(6000);
      const compactors = res.body.data.expenditureBySubCategory.find((r) => r.subCategory === 'Compactors');
      expect(compactors.totalExpenditure).toBe(3000);
      expect(compactors.orderCount).toBe(1);
      expect(compactors.entries).toHaveLength(1);
      expect(compactors.entries[0].orderNumber).toBe('PO-2');
    });

    it('drops sub-categories with no entries in the selected period', async () => {
      AssetExpenditure.find.mockReturnValue(chainablePopulate(EXP_RECORDS));

      // A window before any entry → everything filtered out
      const res = await request(buildApp())
        .get('/api/assets/expenditure?startDate=2020-01-01&endDate=2020-12-31')
        .set('Cookie', ['sessionId=s1']);

      expect(res.status).toBe(200);
      expect(res.body.data.expenditureBySubCategory).toHaveLength(0);
      expect(res.body.data.totalExpenditure).toBe(0);
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
