const express = require('express');
const request = require('supertest');
const cookieParser = require('cookie-parser');

const mockRedis = { connect: jest.fn().mockResolvedValue(), get: jest.fn(), expire: jest.fn().mockResolvedValue() };
jest.mock('redis', () => ({ createClient: jest.fn(() => mockRedis) }));

jest.mock('../../../repositories/requestFollowUp.repository', () => ({
  create: jest.fn(), findByOrder: jest.fn(), findLatestByUserForOrder: jest.fn(),
  countByOrder: jest.fn(), findSentByUser: jest.fn(), findReceivedByUser: jest.fn(),
}));
// PurchaseOrder + User are Mongoose models used directly by the service — mock them.
jest.mock('../../../models/PurchaseOrder', () => ({ findById: jest.fn() }));
jest.mock('../../../models/users_', () => ({ find: jest.fn() }));
jest.mock('../../../Global_Functions/firebasePushNotification', () => ({ sendPushNotification: jest.fn().mockResolvedValue({}) }));

const followUpRepo = require('../../../repositories/requestFollowUp.repository');
const PurchaseOrder = require('../../../models/PurchaseOrder');
const auth = require('../../../middlewares/check-auth');
const c = require('../../../controllers/v1.controllers/requestFollowUp.controllers');

const REQUESTER = JSON.stringify({ userId: 'req-1', role: 'staff', name: 'Requester' });
const cookie = ['sessionId=s1'];

function app() {
  const a = express(); a.use(express.json()); a.use(cookieParser());
  a.post('/api/orders/:id/followup', auth, c.create);
  a.get('/api/orders/:id/followups', auth, c.listForOrder);
  a.get('/api/orders/followups/sent', auth, c.sent);
  a.get('/api/orders/followups/received', auth, c.received);
  return a;
}
// helper: PurchaseOrder.findById(...).select(...).lean() → resolves the given order
const mockOrder = (order) => PurchaseOrder.findById.mockReturnValue({ select: () => ({ lean: () => Promise.resolve(order) }) });

beforeEach(() => { jest.clearAllMocks(); mockRedis.get.mockResolvedValue(REQUESTER); });

describe('POST /orders/:id/followup', () => {
  const pending = { _id: 'o1', staff: 'req-1', status: 'Pending', orderNumber: 'PO-1', PendingApprovals: [{ Reviewer: 'appr-1' }] };

  it('creates a follow-up on a Pending request owned by the requester', async () => {
    mockOrder(pending);
    followUpRepo.findLatestByUserForOrder.mockResolvedValue(null);
    followUpRepo.create.mockResolvedValue({ _id: 'f1', order: 'o1', requestedBy: 'req-1', note: 'still waiting', notifiedUserIds: ['appr-1'], toObject() { return { _id: 'f1', notifiedUserIds: ['appr-1'] }; } });
    require('../../../models/users_').find.mockReturnValue({ select: () => ({ lean: () => Promise.resolve([]) }) });

    const res = await request(app()).post('/api/orders/o1/followup').set('Cookie', cookie).send({ note: 'still waiting' });
    expect(res.status).toBe(201);
    expect(followUpRepo.create).toHaveBeenCalledWith(expect.objectContaining({ order: 'o1', requestedBy: 'req-1', notifiedUserIds: ['appr-1'] }));
  });

  it('403 when a non-requester tries to follow up', async () => {
    mockOrder({ ...pending, staff: 'someone-else' });
    const res = await request(app()).post('/api/orders/o1/followup').set('Cookie', cookie).send({});
    expect(res.status).toBe(403);
  });

  it('400 when the request is in More Information', async () => {
    mockOrder({ ...pending, status: 'More Information' });
    const res = await request(app()).post('/api/orders/o1/followup').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/more information/i);
  });

  it('400 when the request is terminal (Approved)', async () => {
    mockOrder({ ...pending, status: 'Approved' });
    const res = await request(app()).post('/api/orders/o1/followup').set('Cookie', cookie).send({});
    expect(res.status).toBe(400);
  });

  it('429 when within the cooldown window', async () => {
    mockOrder(pending);
    followUpRepo.findLatestByUserForOrder.mockResolvedValue({ createdAt: new Date(Date.now() - 60 * 60 * 1000) }); // 1h ago
    const res = await request(app()).post('/api/orders/o1/followup').set('Cookie', cookie).send({});
    expect(res.status).toBe(429);
    expect(res.body.message).toMatch(/already followed up/i);
  });

  it('404 when the request does not exist', async () => {
    mockOrder(null);
    const res = await request(app()).post('/api/orders/nope/followup').set('Cookie', cookie).send({});
    expect(res.status).toBe(404);
  });
});

describe('follow-up dashboards', () => {
  it('lists follow-ups sent by the requester', async () => {
    followUpRepo.findSentByUser.mockResolvedValue([{ _id: 'f1', order: { orderNumber: 'PO-1', status: 'Pending' } }]);
    const res = await request(app()).get('/api/orders/followups/sent').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('received list only includes still-Pending requests', async () => {
    followUpRepo.findReceivedByUser.mockResolvedValue([
      { _id: 'f1', order: { orderNumber: 'PO-1', status: 'Pending' } },
      { _id: 'f2', order: { orderNumber: 'PO-2', status: 'Approved' } }, // resolved → excluded
    ]);
    const res = await request(app()).get('/api/orders/followups/received').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].order.orderNumber).toBe('PO-1');
  });
});
