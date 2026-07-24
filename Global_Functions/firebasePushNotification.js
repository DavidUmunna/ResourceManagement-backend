const admin = require('firebase-admin');

// Initialize with service account
const serviceAccount = require('../haldenerp-firebase-adminsdk.json');
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Function to send push notification
async function sendPushNotification(token, title, body, data = {}) {
  const message = {
    token,
    notification: { title, body },
    data,
  };
  console.log(message);

  try {
    const response = await admin.messaging().send(message);
    console.log("Successfully sent message:", response);
    return response;
  } catch (error) {
    console.error("Error sending message:", error);
    throw error;
  }
}

module.exports={sendPushNotification}
