const bcrypt = require('bcrypt');

jest.mock('../repositories/siteApprover.repository', () => ({ findById: jest.fn(), update: jest.fn() }));
const approverRepo = require('../repositories/siteApprover.repository');
const checkApproverOtp = require('../middlewares/check-approver-otp');

function run(body, approver) {
  approverRepo.findById.mockResolvedValue(approver);
  approverRepo.update.mockResolvedValue({});
  const req = { body, siteApprover: { id: 'a1' } };
  const res = { statusCode: 200, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  let nexted = false;
  return checkApproverOtp(req, res, () => { nexted = true; }).then(() => ({ res, nexted }));
}

describe('checkApproverOtp (FR-19)', () => {
  it('passes with a valid, unexpired code and consumes it', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { res, nexted } = await run({ otp: '123456' }, { _id: 'a1', otpHash, otpExpiresAt: new Date(Date.now() + 60000) });
    expect(nexted).toBe(true);
    expect(approverRepo.update).toHaveBeenCalledWith('a1', { otpHash: null, otpExpiresAt: null });
    expect(res.statusCode).toBe(200);
  });

  it('400 when no code supplied', async () => {
    const { res, nexted } = await run({}, { _id: 'a1' });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(400);
  });

  it('401 on a wrong code', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { res, nexted } = await run({ otp: '000000' }, { _id: 'a1', otpHash, otpExpiresAt: new Date(Date.now() + 60000) });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
  });

  it('401 on an expired code', async () => {
    const otpHash = await bcrypt.hash('123456', 10);
    const { res, nexted } = await run({ otp: '123456' }, { _id: 'a1', otpHash, otpExpiresAt: new Date(Date.now() - 1000) });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(401);
  });
});
