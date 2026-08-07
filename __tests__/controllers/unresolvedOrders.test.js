// Unit tests for the UnresolvedOrders controller (the "Unresolved Requests" panel).
jest.mock('../../models/PurchaseOrder');
jest.mock('../../models/users_', () => ({}));
jest.mock('../../controllers/v1.controllers/notification', () => ({
  StaffResponseAlert: jest.fn(),
  MoreInformationAlert: jest.fn(),
}));

const PurchaseOrder = require('../../models/PurchaseOrder');
const { UnresolvedOrders } = require('../../controllers/v1.controllers/RequestController');

// PurchaseOrder.find(query).populate().populate().populate().sort() → orders
function mockFind(orders) {
  const chain = {
    populate: jest.fn(() => chain),
    sort: jest.fn(() => Promise.resolve(orders)),
  };
  PurchaseOrder.find = jest.fn(() => chain);
  return chain;
}

function mockRes() {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

const APPROVER = { userId: 'admin-001', Department: 'waste_management_dep', role: 'global_admin' };

describe('UnresolvedOrders controller', () => {
  beforeEach(() => jest.clearAllMocks());

  it('blocks staff with a 403 and never queries the DB', async () => {
    mockFind([]);
    const req = { user: { ...APPROVER, role: 'staff' }, query: {} };
    const res = mockRes();

    await UnresolvedOrders(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(PurchaseOrder.find).not.toHaveBeenCalled();
  });

  it('blocks "Staff" (any casing) too', async () => {
    mockFind([]);
    const req = { user: { ...APPROVER, role: 'Staff' }, query: {} };
    const res = mockRes();

    await UnresolvedOrders(req, res);

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('scopes the DB query to orders where the user is a pending reviewer', async () => {
    mockFind([]);
    const req = { user: APPROVER, query: {} };
    const res = mockRes();

    await UnresolvedOrders(req, res);

    expect(PurchaseOrder.find).toHaveBeenCalledWith(
      expect.objectContaining({ 'PendingApprovals.Reviewer': 'admin-001' })
    );
  });

  it('returns orders where the user is a reviewer at the lowest pending level', async () => {
    const actionable = {
      _id: 'o1',
      PendingApprovals: [{ Level: 1, Reviewer: { _id: 'admin-001' } }],
      staff: { role: 'staff', Department: 'waste_management_dep' },
      createdAt: new Date(),
    };
    mockFind([actionable]);
    const req = { user: APPROVER, query: {} };
    const res = mockRes();

    await UnresolvedOrders(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.data).toHaveLength(1);
    expect(body.data[0]._id).toBe('o1');
  });

  it('excludes orders where the user is only a higher-level reviewer (not their turn yet)', async () => {
    const blocked = {
      _id: 'o2',
      PendingApprovals: [
        { Level: 1, Reviewer: { _id: 'someone-else' } }, // lower level still pending
        { Level: 2, Reviewer: { _id: 'admin-001' } },    // user is here, but not min level
      ],
      staff: { role: 'staff', Department: 'waste_management_dep' },
      createdAt: new Date(),
    };
    mockFind([blocked]);
    const req = { user: APPROVER, query: {} };
    const res = mockRes();

    await UnresolvedOrders(req, res);

    const body = res.json.mock.calls[0][0];
    expect(body.data).toHaveLength(0);
  });

  it('applies a createdAt window when a date filter is given', async () => {
    mockFind([]);
    const req = { user: APPROVER, query: { date: 'Last 7 Days' } };
    const res = mockRes();

    await UnresolvedOrders(req, res);

    const query = PurchaseOrder.find.mock.calls[0][0];
    expect(query.createdAt.$gte).toBeInstanceOf(Date);
    expect(query.createdAt.$lte).toBeInstanceOf(Date);
  });
});
