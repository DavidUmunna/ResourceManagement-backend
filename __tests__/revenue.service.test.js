jest.mock('../repositories/project.repository', () => ({ findAll: jest.fn() }));
jest.mock('../repositories/skip.repository', () => ({ findDeployedWithProject: jest.fn() }));

const projectRepo = require('../repositories/project.repository');
const skipRepo = require('../repositories/skip.repository');
const { computeRevenue } = require('../services/revenue.service');

const DAY = 24 * 60 * 60 * 1000;
beforeEach(() => jest.clearAllMocks());

describe('computeRevenue', () => {
  it('bills mobilized→demobilized days × project rate, rolled up', async () => {
    projectRepo.findAll.mockResolvedValue([
      { _id: 'p1', name: 'Acme Rig 7', code: 'ACME-RIG7', client: 'Acme IOC', dailyRateUsd: 120 },
      { _id: 'p2', name: 'Shell B12', code: 'SHELL-B12', client: 'Shell', dailyRateUsd: 200 },
    ]);
    const now = Date.now();
    skipRepo.findDeployedWithProject.mockResolvedValue([
      // 8 full days on p1 → 8 × 120 = 960
      { _id: 's1', skip_id: 'S1', projectId: 'p1', DateMobilized: new Date(now - 8 * DAY), DemobilizationOfFilledSkips: new Date(now) },
      // 3 full days on p1 → 3 × 120 = 360
      { _id: 's2', skip_id: 'S2', projectId: 'p1', DateMobilized: new Date(now - 3 * DAY), DemobilizationOfFilledSkips: new Date(now) },
      // still out 5 days on p2 (no demob) → 5 × 200 = 1000
      { _id: 's3', skip_id: 'S3', projectId: 'p2', DateMobilized: new Date(now - 5 * DAY), DemobilizationOfFilledSkips: null },
    ]);

    const res = await computeRevenue({});
    const p1 = res.projects.find((p) => p.projectId === 'p1');
    const p2 = res.projects.find((p) => p.projectId === 'p2');

    expect(p1.billableDays).toBe(11);
    expect(p1.revenue).toBe(1320); // 960 + 360
    expect(p1.skipCount).toBe(2);
    expect(p2.revenue).toBe(1000);
    expect(res.totals.revenue).toBe(2320);
    expect(res.currency).toBe('USD');
    // sorted by revenue desc
    expect(res.projects[0].projectId).toBe('p1');
  });

  it('counts a project with no rate as unrated (revenue 0)', async () => {
    const now = Date.now();
    projectRepo.findAll.mockResolvedValue([{ _id: 'p1', name: 'NoRate', dailyRateUsd: 0 }]);
    skipRepo.findDeployedWithProject.mockResolvedValue([
      { _id: 's1', projectId: 'p1', DateMobilized: new Date(now - 4 * DAY), DemobilizationOfFilledSkips: new Date(now) },
    ]);
    const res = await computeRevenue({});
    expect(res.totals.revenue).toBe(0);
    expect(res.unratedSkipCount).toBe(1);
    expect(res.projects[0].billableDays).toBe(4);
  });

  it('uses a per-skip rate override instead of the project rate', async () => {
    const now = Date.now();
    projectRepo.findAll.mockResolvedValue([{ _id: 'p1', name: 'Acme', dailyRateUsd: 100 }]);
    skipRepo.findDeployedWithProject.mockResolvedValue([
      // project rate 100, but this skip overrides to 250 → 4 × 250 = 1000
      { _id: 's1', projectId: 'p1', dailyRateUsdOverride: 250, DateMobilized: new Date(now - 4 * DAY), DemobilizationOfFilledSkips: new Date(now) },
      // no override → uses project 100 → 2 × 100 = 200
      { _id: 's2', projectId: 'p1', dailyRateUsdOverride: null, DateMobilized: new Date(now - 2 * DAY), DemobilizationOfFilledSkips: new Date(now) },
    ]);
    const res = await computeRevenue({});
    expect(res.projects[0].revenue).toBe(1200); // 1000 + 200
  });

  it('clamps billable days to the requested date range', async () => {
    const base = new Date('2026-06-01T00:00:00Z').getTime();
    projectRepo.findAll.mockResolvedValue([{ _id: 'p1', dailyRateUsd: 100 }]);
    skipRepo.findDeployedWithProject.mockResolvedValue([
      // deployed 20 days, but window only covers 5 of them
      { _id: 's1', projectId: 'p1', DateMobilized: new Date(base), DemobilizationOfFilledSkips: new Date(base + 20 * DAY) },
    ]);
    const res = await computeRevenue({ from: new Date(base + 5 * DAY).toISOString(), to: new Date(base + 10 * DAY).toISOString() });
    expect(res.projects[0].billableDays).toBe(5);
    expect(res.projects[0].revenue).toBe(500);
  });
});
