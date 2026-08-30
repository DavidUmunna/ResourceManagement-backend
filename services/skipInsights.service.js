const Skip = require("../models/skips_tracking");
const skipRepo = require("../repositories/skip.repository");
const { computeRevenue } = require("./revenue.service");

const DAY = 24 * 60 * 60 * 1000;
const OVERDUE_DAYS = Number(process.env.SKIP_OVERDUE_DAYS || 14);
const RENTAL_LEAD_DAYS = Number(process.env.SKIP_RENTAL_NAG_LEAD_DAYS || 7);

const tonnesOf = (s) => {
  const v = Number(s.Quantity?.value || 0);
  return s.Quantity?.unit === "kg" ? v / 1000 : v;
};

// Monday-anchored week key (YYYY-MM-DD) for a timestamp.
function weekKey(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d.toISOString().slice(0, 10);
}

/**
 * Operational insights for the skips dashboard: now-based KPIs + range-based
 * weekly trends and breakdowns. Replaces the (low-value) moving-average chart.
 */
exports.compute = async ({ from, to } = {}) => {
  const now = Date.now();
  const fromT = from ? new Date(from).getTime() : now - 90 * DAY; // default: last 90 days
  const toT = to ? new Date(to).getTime() : now;

  // ── Now-based KPIs ──────────────────────────────────────────────────────────
  const [onSiteDocs, totalActive, expiring] = await Promise.all([
    Skip.find({ DateMobilized: { $ne: null }, DemobilizationOfFilledSkips: { $in: [null, undefined] }, active: { $ne: false } })
      .select("DateMobilized").lean(),
    Skip.countDocuments({ active: { $ne: false } }),
    skipRepo.findExpiringRentals(new Date(now + RENTAL_LEAD_DAYS * DAY)),
  ]);

  const onSite = onSiteDocs.length;
  const overdue = onSiteDocs.filter((s) => now - new Date(s.DateMobilized).getTime() > OVERDUE_DAYS * DAY).length;
  const utilizationPct = totalActive ? Math.round((onSite / totalActive) * 100) : 0;

  // ── Range-based aggregations ────────────────────────────────────────────────
  // Skips mobilized OR demobilized within the window drive the trends/breakdowns.
  const activity = await Skip.find({
    $or: [
      { DateMobilized: { $gte: new Date(fromT), $lte: new Date(toT) } },
      { DemobilizationOfFilledSkips: { $gte: new Date(fromT), $lte: new Date(toT) } },
    ],
  }).select("DateMobilized DemobilizationOfFilledSkips WasteStream Quantity").lean();

  // Pre-seed weekly buckets so the chart has no gaps.
  const weeks = new Map();
  for (let t = new Date(weekKey(fromT)).getTime(); t <= toT; t += 7 * DAY) {
    weeks.set(weekKey(t), { week: weekKey(t), mobilized: 0, demobilized: 0, turnaroundSum: 0, turnaroundN: 0 });
  }
  const bucket = (key) => {
    if (!weeks.has(key)) weeks.set(key, { week: key, mobilized: 0, demobilized: 0, turnaroundSum: 0, turnaroundN: 0 });
    return weeks.get(key);
  };

  const streamMap = new Map(); // stream -> { stream, tonnes, count }
  let turnaroundSum = 0, turnaroundN = 0;

  for (const s of activity) {
    const mobT = s.DateMobilized ? new Date(s.DateMobilized).getTime() : null;
    const demT = s.DemobilizationOfFilledSkips ? new Date(s.DemobilizationOfFilledSkips).getTime() : null;

    if (mobT && mobT >= fromT && mobT <= toT) {
      bucket(weekKey(mobT)).mobilized += 1;
      // by-stream is measured on mobilization (deployment) within the window
      const stream = s.WasteStream || "Unknown";
      const cur = streamMap.get(stream) || { stream, tonnes: 0, count: 0 };
      cur.tonnes += tonnesOf(s);
      cur.count += 1;
      streamMap.set(stream, cur);
    }
    if (demT && demT >= fromT && demT <= toT) {
      const b = bucket(weekKey(demT));
      b.demobilized += 1;
      if (mobT && demT > mobT) {
        const days = (demT - mobT) / DAY;
        b.turnaroundSum += days;
        b.turnaroundN += 1;
        turnaroundSum += days;
        turnaroundN += 1;
      }
    }
  }

  const ordered = [...weeks.values()].sort((a, b) => a.week.localeCompare(b.week));
  const throughput = ordered.map((w) => ({ week: w.week, mobilized: w.mobilized, demobilized: w.demobilized }));
  const turnaround = ordered.map((w) => ({ week: w.week, avgDays: w.turnaroundN ? +(w.turnaroundSum / w.turnaroundN).toFixed(1) : null }));
  const byStream = [...streamMap.values()].map((s) => ({ ...s, tonnes: +s.tonnes.toFixed(2) })).sort((a, b) => b.tonnes - a.tonnes);

  const revenue = await computeRevenue({ from, to });

  return {
    range: { from: new Date(fromT).toISOString(), to: new Date(toT).toISOString() },
    kpis: {
      onSite,
      overdue,
      overdueDaysThreshold: OVERDUE_DAYS,
      utilizationPct,
      totalActive,
      rentalsExpiringSoon: expiring.length,
      avgTurnaroundDays: turnaroundN ? +(turnaroundSum / turnaroundN).toFixed(1) : 0,
      periodRevenueUsd: revenue.totals.revenue,
    },
    throughput,
    turnaround,
    byStream,
    byProject: revenue.projects.slice(0, 8),
  };
};
