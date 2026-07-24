const {
  getSpendByDepartment,
  getSpendByStatus,
  getSpendSummary,
} = require('../../controllers/v1.controllers/RequestsAnalytics');

jest.mock('../../models/PurchaseOrder');
const PurchaseOrder = require('../../models/PurchaseOrder');

function mockReq(query = {}) {
  return { query };
}

function mockRes() {
  const res = {};
  res.json = jest.fn().mockReturnValue(res);
  res.status = jest.fn().mockReturnValue(res);
  return res;
}

// ── Fixtures ──────────────────────────────────────────────────────────────────
const DEPT_DATA = [
  { department: 'Procurement_department', totalOrders: 10, totalSpend: 5000, avgOrderValue: 500, statusBreakdown: { Approved: 7, Pending: 3 } },
  { department: 'IT', totalOrders: 4, totalSpend: 2000, avgOrderValue: 500, statusBreakdown: { Approved: 2, Rejected: 2 } },
];

const STATUS_DATA = [
  { status: 'Approved',  totalOrders: 9, totalSpend: 4500, avgOrderValue: 500 },
  { status: 'Pending',   totalOrders: 3, totalSpend: 1500, avgOrderValue: 500 },
  { status: 'Rejected',  totalOrders: 2, totalSpend: 1000, avgOrderValue: 500 },
  { status: 'Completed', totalOrders: 1, totalSpend:  500, avgOrderValue: 500 },
];

const OVERALL = [{ _id: null, totalOrders: 15, totalSpend: 7500, avgOrderValue: 500 }];

// ── getSpendByDepartment ───────────────────────────────────────────────────────
describe('getSpendByDepartment', () => {
  beforeEach(() => {
    PurchaseOrder.aggregate = jest.fn().mockResolvedValue(DEPT_DATA);
  });

  it('returns byDepartment array and grandTotalSpend', async () => {
    const res = mockRes();
    await getSpendByDepartment(mockReq(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          byDepartment: DEPT_DATA,
          grandTotalSpend: 7000,
        }),
      })
    );
  });

  it('passes startDate and endDate into the pipeline via $match', async () => {
    const res = mockRes();
    await getSpendByDepartment(mockReq({ startDate: '2026-01-01', endDate: '2026-06-30' }), res);

    const pipeline = PurchaseOrder.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.createdAt.$gte).toEqual(new Date('2026-01-01'));
    expect(matchStage.$match.createdAt.$lte).toEqual(new Date('2026-06-30'));
  });

  it('includes status filter in $match when provided', async () => {
    const res = mockRes();
    await getSpendByDepartment(mockReq({ status: 'Approved' }), res);

    const pipeline = PurchaseOrder.aggregate.mock.calls[0][0];
    const matchStage = pipeline.find((s) => s.$match);
    expect(matchStage.$match.status).toBe('Approved');
  });

  it('returns 500 on aggregation error', async () => {
    PurchaseOrder.aggregate = jest.fn().mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await getSpendByDepartment(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getSpendByStatus ──────────────────────────────────────────────────────────
describe('getSpendByStatus', () => {
  beforeEach(() => {
    PurchaseOrder.aggregate = jest.fn().mockResolvedValue(STATUS_DATA);
  });

  it('returns byStatus array and approvedSpend (Approved + Completed)', async () => {
    const res = mockRes();
    await getSpendByStatus(mockReq(), res);

    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          approvedSpend: 5000, // 4500 + 500
        }),
      })
    );
  });

  it('includes $lookup when department filter is provided', async () => {
    const res = mockRes();
    await getSpendByStatus(mockReq({ department: 'IT' }), res);

    const pipeline = PurchaseOrder.aggregate.mock.calls[0][0];
    expect(pipeline.some((s) => s.$lookup)).toBe(true);
    const deptMatch = pipeline.find((s) => s.$match?.['_staffUser.Department']);
    expect(deptMatch.$match['_staffUser.Department']).toBe('IT');
  });

  it('skips $lookup when no department filter', async () => {
    const res = mockRes();
    await getSpendByStatus(mockReq(), res);

    const pipeline = PurchaseOrder.aggregate.mock.calls[0][0];
    expect(pipeline.some((s) => s.$lookup)).toBe(false);
  });

  it('returns 500 on aggregation error', async () => {
    PurchaseOrder.aggregate = jest.fn().mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await getSpendByStatus(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ── getSpendSummary ───────────────────────────────────────────────────────────
describe('getSpendSummary', () => {
  beforeEach(() => {
    PurchaseOrder.aggregate = jest.fn()
      .mockResolvedValueOnce(OVERALL)      // overall totals
      .mockResolvedValueOnce(DEPT_DATA)    // by department
      .mockResolvedValueOnce(STATUS_DATA); // by status
  });

  it('returns totals, byDepartment, and byStatus in one response', async () => {
    const res = mockRes();
    await getSpendSummary(mockReq(), res);

    const { data } = res.json.mock.calls[0][0];
    expect(data.totals.totalOrders).toBe(15);
    expect(data.totals.totalSpend).toBe(7500);
    expect(data.totals.avgOrderValue).toBe(500);
    expect(data.byDepartment).toEqual(DEPT_DATA);
    expect(data.byStatus).toEqual(STATUS_DATA);
  });

  it('runs all three aggregations in parallel (3 calls)', async () => {
    const res = mockRes();
    await getSpendSummary(mockReq(), res);
    expect(PurchaseOrder.aggregate).toHaveBeenCalledTimes(3);
  });

  it('handles empty database gracefully (zero totals)', async () => {
    PurchaseOrder.aggregate = jest.fn()
      .mockResolvedValueOnce([])  // overall returns empty
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const res = mockRes();
    await getSpendSummary(mockReq(), res);

    const { data } = res.json.mock.calls[0][0];
    expect(data.totals.totalOrders).toBe(0);
    expect(data.totals.totalSpend).toBe(0);
  });

  it('applies date filter to all three aggregations', async () => {
    const res = mockRes();
    await getSpendSummary(mockReq({ startDate: '2026-01-01', endDate: '2026-12-31' }), res);

    // All 3 pipelines should start with a $match
    PurchaseOrder.aggregate.mock.calls.forEach(([pipeline]) => {
      expect(pipeline[0].$match.createdAt.$gte).toEqual(new Date('2026-01-01'));
    });
  });

  it('returns 500 on aggregation error', async () => {
    PurchaseOrder.aggregate = jest.fn().mockRejectedValue(new Error('DB error'));
    const res = mockRes();
    await getSpendSummary(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
