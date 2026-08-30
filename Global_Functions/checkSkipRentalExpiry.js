const cron = require("node-cron");
const skipRepo = require("../repositories/skip.repository");
const { notifyIssue } = require("../services/NotificationService");
const { ISSUE_EVENTS } = require("../constants/skips.constants");

// How many days ahead of rentalExpectedEnd we start nagging.
const LEAD_DAYS = Number(process.env.SKIP_RENTAL_NAG_LEAD_DAYS || 3);

/**
 * Core check (exported for testing). Finds active rented skips at/within
 * LEAD_DAYS of their rental end and raises a single consolidated issue.
 * @param {Date} [now]
 */
async function runRentalExpiryCheck(now = new Date()) {
  const threshold = new Date(now.getTime() + LEAD_DAYS * 24 * 60 * 60 * 1000);
  const expiring = await skipRepo.findExpiringRentals(threshold);

  if (!expiring || !expiring.length) {
    console.log("[skip-rental-nag] no rentals nearing expiry");
    return { count: 0 };
  }

  const items = expiring.map((s) => ({
    skip: s.skip_id,
    rentedFrom: s.rentedFromCompany,
    project: s.projectRef,
    expiresOn: s.rentalExpectedEnd,
    overdue: s.rentalExpectedEnd && s.rentalExpectedEnd.getTime() < now.getTime(),
  }));

  await notifyIssue({
    event: ISSUE_EVENTS.RENTAL_EXPIRING,
    title: `${items.length} rented skip(s) nearing/over rental expiry`,
    message: "The following rented skips are within their rental-expiry window and may need return or renewal.",
    context: { leadDays: LEAD_DAYS, skips: items },
  });

  console.log(`[skip-rental-nag] raised issue for ${items.length} skip(s)`);
  return { count: items.length };
}

// Daily at 07:00. Guarded so importing the module in tests/CLI doesn't schedule.
if (process.env.NODE_ENV !== "test") {
  cron.schedule("0 7 * * *", () => {
    runRentalExpiryCheck().catch((e) => console.error("[skip-rental-nag] failed:", e.message));
  });
}

module.exports = { runRentalExpiryCheck };
