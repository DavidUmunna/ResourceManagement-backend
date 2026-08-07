// Verifies the FCM message the backend builds is well-formed and that dead
// tokens get pruned.
const mockSend = jest.fn();
const mockUpdateMany = jest.fn().mockResolvedValue({});

jest.mock('firebase-admin', () => ({
  credential: { cert: jest.fn(() => ({})) },
  initializeApp: jest.fn(),
  messaging: jest.fn(() => ({ send: mockSend })),
}));
jest.mock('../models/users_', () => ({ updateMany: mockUpdateMany }));

const { sendPushNotification } = require('../Global_Functions/firebasePushNotification');
const fcmError = (code) => Object.assign(new Error(code), { errorInfo: { code } });

describe('sendPushNotification', () => {
  beforeEach(() => jest.clearAllMocks());

  it('builds a data-only message with title/body inside data, and returns the send result', async () => {
    mockSend.mockResolvedValue('projects/haldenerp/messages/abc123');

    const res = await sendPushNotification('device-token-1', 'New request submitted', 'PO created by John', {
      type: 'new_request',
      orderId: 'order-001',
      department: 'waste_management_dep',
    });

    expect(mockSend).toHaveBeenCalledWith({
      token: 'device-token-1',
      data: {
        type: 'new_request',
        orderId: 'order-001',
        department: 'waste_management_dep',
        title: 'New request submitted',
        body: 'PO created by John',
      },
    });
    // no top-level notification payload (data-only)
    expect(mockSend.mock.calls[0][0]).not.toHaveProperty('notification');
    expect(res).toBe('projects/haldenerp/messages/abc123');
  });

  it('always carries title and body in the data payload', async () => {
    mockSend.mockResolvedValue('ok');

    await sendPushNotification('device-token-1', 'Title', 'Body');

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: 'Title', body: 'Body' }) })
    );
  });

  it('sends all data values as strings (FCM requirement)', async () => {
    mockSend.mockResolvedValue('ok');

    await sendPushNotification('device-token-1', 'T', 'B', {
      type: 'new_request',
      orderId: 'order-001',
    });

    const { data } = mockSend.mock.calls[0][0];
    Object.values(data).forEach((v) => expect(typeof v).toBe('string'));
  });

  it('prunes a dead/unregistered token instead of throwing', async () => {
    mockSend.mockRejectedValue(fcmError('messaging/registration-token-not-registered'));

    const res = await sendPushNotification('dead-token', 'T', 'B');

    expect(res).toEqual(expect.objectContaining({ pruned: true }));
    expect(mockUpdateMany).toHaveBeenCalledWith(
      { NotificationToken: 'dead-token' },
      { $set: { NotificationToken: '' } }
    );
  });

  it('also prunes on invalid-argument (bad token)', async () => {
    mockSend.mockRejectedValue(fcmError('messaging/invalid-argument'));

    const res = await sendPushNotification('bad-token', 'T', 'B');

    expect(res).toEqual(expect.objectContaining({ pruned: true }));
    expect(mockUpdateMany).toHaveBeenCalled();
  });

  it('propagates non-token errors and does NOT prune', async () => {
    mockSend.mockRejectedValue(fcmError('messaging/internal-error'));

    await expect(sendPushNotification('good-token', 'T', 'B')).rejects.toThrow();
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
