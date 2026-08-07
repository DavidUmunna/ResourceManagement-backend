const admin = require('firebase-admin');
const User = require('../models/users_');

// Initialize with service account
const serviceAccount = require('../haldenerp-firebase-adminsdk.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// FCM error codes that mean the token is dead and should be removed
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

// Function to send push notification.
// Data-only message (title/body live in `data`) so the service worker fully
// controls display via showNotification — the `notification` payload is
// unreliable on web (the browser auto-handles it and the SW handler is skipped).
async function sendPushNotification(token, title, body, data = {}) {
  const message = {
    token,
    data: { ...data, title: String(title ?? ''), body: String(body ?? '') },
  };

  try {
    const response = await admin.messaging().send(message);
    return response;
  } catch (error) {
    const code = error?.errorInfo?.code || error?.code;

    // A dead/unregistered token: remove it so we stop trying it, and don't
    // treat it as a hard failure (it's expected as tokens rotate/expire).
    if (DEAD_TOKEN_CODES.has(code)) {
      try {
        await User.updateMany({ NotificationToken: token }, { $set: { NotificationToken: '' } });
      } catch (pruneErr) {
        console.error('Failed to prune dead FCM token:', pruneErr.message);
      }
      console.warn(`Pruned dead FCM token (${code})`);
      return { pruned: true, code };
    }

    console.error('Error sending message:', error);
    throw error;
  }
}

module.exports = { sendPushNotification };
