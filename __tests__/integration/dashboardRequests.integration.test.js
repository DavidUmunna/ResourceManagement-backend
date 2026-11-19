/**
 * Dashboard request counts (GetOverallMonthlyRequests, MonthlyStaffRequest).
 * Regression: hiding user.password (select:false) made the "-password" in an
 * inclusion projection throw, so every dashboard value showed 0.
 */
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

jest.mock('../../controllers/v1.controllers/notification', () => ({
  StaffResponseAlert: jest.fn(), MoreInformationAlert: jest.fn(),
}));

const User = require('../../models/users_');
const PurchaseOrder = require('../../models/PurchaseOrder');
const { GetOverallMonthlyRequests, MonthlyStaffRequest } = require('../../controllers/v1.controllers/RequestController');

let mongo, staff, other;
const call = async (handler, query) => {
  const res = { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, json(b) { this.body = b; return this; } };
  await handler({ query }, res);
  return res;
};

beforeAll(async () => { mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri()); });
afterAll(async () => { await mongoose.disconnect(); await mongo.stop(); });

beforeEach(async () => {
  await Promise.all([User.deleteMany({}), PurchaseOrder.collection.deleteMany({})]);
  staff = await User.create({ name: 'Staff', email: 's@t.com', password: 'hash', Department: 'IT' });
  other = await User.create({ name: 'Other', email: 'o@t.com', password: 'hash', Department: 'accounts_dep' });
  const now = new Date();
  const thisMonth = (day) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day, 12));
  const lastDayOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 22));
  const lastDayOfPrevMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0, 12));
  await PurchaseOrder.collection.insertMany([
    { staff: staff._id, orderNumber: 'PO-T0', Title: 'first of month', status: 'Pending', createdAt: thisMonth(1) },
    { staff: staff._id, orderNumber: 'PO-T1', Title: 'end of month', status: 'Approved', createdAt: lastDayOfMonth },
    { staff: staff._id, orderNumber: 'PO-T2', Title: 'last month', status: 'Approved', createdAt: lastDayOfPrevMonth },
    { staff: other._id, orderNumber: 'PO-T3', Title: 'other dept', status: 'Pending', createdAt: thisMonth(2) },
  ]);
});

it('overall monthly requests load (no projection error) and never include passwords', async () => {
  const res = await call(GetOverallMonthlyRequests, {});
  expect(res.statusCode).toBe(200);
  expect(res.body.data).toHaveLength(3);
  expect(JSON.stringify(res.body)).not.toContain('password');
});

it('department filter still works', async () => {
  const res = await call(GetOverallMonthlyRequests, { Department: 'IT' });
  expect(res.statusCode).toBe(200);
  expect(res.body.data.map((r) => r.Title).sort()).toEqual(['end of month', 'first of month']);
});

it("staff monthly requests cover the whole current month and nothing from last month", async () => {
  const res = await call(MonthlyStaffRequest, { userId: String(staff._id) });
  expect(res.statusCode).toBe(200);
  expect(res.body.data.map((r) => r.Title).sort()).toEqual(['end of month', 'first of month']);
});
