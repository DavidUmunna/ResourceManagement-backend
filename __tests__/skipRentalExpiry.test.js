jest.mock('../repositories/skip.repository', () => ({ findExpiringRentals: jest.fn() }));
jest.mock('../services/NotificationService', () => ({
  notifyIssue: jest.fn().mockResolvedValue({ notified: 1 }), EmailNotificationService: class {},
}));

const skipRepo = require('../repositories/skip.repository');
const { notifyIssue } = require('../services/NotificationService');
const { runRentalExpiryCheck } = require('../Global_Functions/checkSkipRentalExpiry');

beforeEach(() => jest.clearAllMocks());

describe('runRentalExpiryCheck', () => {
  it('raises a consolidated issue for expiring rentals', async () => {
    skipRepo.findExpiringRentals.mockResolvedValue([
      { skip_id: 'SKIP-1', rentedFromCompany: 'Acme', rentalExpectedEnd: new Date(Date.now() + 86400000) },
      { skip_id: 'SKIP-2', rentedFromCompany: 'Acme', rentalExpectedEnd: new Date(Date.now() - 86400000) },
    ]);

    const res = await runRentalExpiryCheck(new Date());
    expect(res.count).toBe(2);
    expect(notifyIssue).toHaveBeenCalledTimes(1);
    const arg = notifyIssue.mock.calls[0][0];
    expect(arg.context.skips).toHaveLength(2);
    // the past-due one is flagged overdue
    expect(arg.context.skips.find((s) => s.skip === 'SKIP-2').overdue).toBe(true);
  });

  it('does nothing when no rentals are near expiry', async () => {
    skipRepo.findExpiringRentals.mockResolvedValue([]);
    const res = await runRentalExpiryCheck(new Date());
    expect(res.count).toBe(0);
    expect(notifyIssue).not.toHaveBeenCalled();
  });
});
