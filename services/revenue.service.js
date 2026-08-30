const projectRepo = require("../repositories/project.repository");
const skipRepo = require("../repositories/skip.repository");

const DAY = 24 * 60 * 60 * 1000;

/**
 * Skip revenue = billable days × the project's daily USD rate.
 *
 * Billable days for a skip = time deployed on site: DateMobilized →
 * DemobilizationOfFilledSkips (or "now" if still out), clamped to the requested
 * [from, to] window. Day granularity, rounded up (a partial day counts as a day).
 *
 * @param {{from?: string, to?: string}} q  optional ISO date range
 */
exports.computeRevenue = async ({ from, to } = {}) => {
  const now = Date.now();
  const fromT = from ? new Date(from).getTime() : -Infinity;
  const toT = to ? new Date(to).getTime() : now;

  const projects = await projectRepo.findAll({});
  const pmap = new Map(projects.map((p) => [String(p._id), p]));

  const skips = await skipRepo.findDeployedWithProject();

  const agg = new Map(); // projectId -> { skipCount, billableDays, revenue }
  let unratedSkipCount = 0;

  for (const s of skips) {
    const pid = String(s.projectId);
    const proj = pmap.get(pid);
    // Per-skip override wins over the project's rate.
    const rate = s.dailyRateUsdOverride != null
      ? Number(s.dailyRateUsdOverride)
      : (proj ? Number(proj.dailyRateUsd || 0) : 0);

    const mobT = new Date(s.DateMobilized).getTime();
    const demobT = s.DemobilizationOfFilledSkips ? new Date(s.DemobilizationOfFilledSkips).getTime() : now;
    const start = Math.max(mobT, fromT);
    const end = Math.min(demobT, toT);
    const days = end > start ? Math.ceil((end - start) / DAY) : 0;

    if (!rate) unratedSkipCount += 1;

    const cur = agg.get(pid) || { skipCount: 0, billableDays: 0, revenue: 0 };
    cur.skipCount += 1;
    cur.billableDays += days;
    cur.revenue += days * rate;
    agg.set(pid, cur);
  }

  const projectsOut = [...agg.entries()]
    .map(([pid, a]) => {
      const p = pmap.get(pid) || {};
      return { projectId: pid, name: p.name, code: p.code, client: p.client, dailyRateUsd: Number(p.dailyRateUsd || 0), ...a };
    })
    .sort((x, y) => y.revenue - x.revenue);

  const totals = projectsOut.reduce(
    (t, r) => ({ skipCount: t.skipCount + r.skipCount, billableDays: t.billableDays + r.billableDays, revenue: t.revenue + r.revenue }),
    { skipCount: 0, billableDays: 0, revenue: 0 }
  );

  return {
    currency: "USD",
    range: { from: from || null, to: to || new Date(now).toISOString() },
    projects: projectsOut,
    totals,
    unratedSkipCount,
  };
};
