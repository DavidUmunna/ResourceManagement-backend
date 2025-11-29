const cron = require("node-cron");
const FileTracks = require("../models/FileTracking");
const Users = require("../models/users_");
const { transporter } = require("../emailnotification/emailNotification");
const {
  generateExpiredFiletracksEmail,
  generateExpiredFiletracksText,
} = require("../controllers/v1.controllers/notification");

const CONTRACT_MANAGER_ROLE = "Contracts_manager";

// Send expired filetrack emails to contract managers
async function notifyContractManagers(expiredTracks) {
  const contractManagers = await Users.find({ role: CONTRACT_MANAGER_ROLE }).lean();
  const recipientEmails = contractManagers
    .map((user) => user.email)
    .filter(Boolean);

  if (!recipientEmails.length) {
    console.warn("No contract managers with email found for expiry notification.");
    return;
  }

  const expiredFiletracks = expiredTracks.map((track) => ({
    name: track.FileName,
    expiryDate: track.ExpiresAt,
  }));

  const loginUrl = process.env.FRONTEND_BASED_URL || process.env.FRONTEND_URL || "#";
  const recipientName =contractManagers.map((user)=>user.name).filter(Boolean);

  const mailOptions = {
    from: "Halden Resources Management <noreply@haldenresources.com>",
    to: recipientEmails,
    subject: "Expired filetracks require renewal",
    html: generateExpiredFiletracksEmail(recipientName, expiredFiletracks, loginUrl),
    text: generateExpiredFiletracksText(recipientName, expiredFiletracks, loginUrl),
  };

  await transporter.sendMail(mailOptions);
}

// Runs every day at 12:00 AM
cron.schedule("0 0 * * *", async () => {
  console.log("Running daily expiry check...");

  try {
    const currentDate = new Date();

    // Identify newly expired tracks first so we only email once per expiry
    const newlyExpiredTracks = await FileTracks.find({
      ExpiresAt: { $lt: currentDate },
      status: { $ne: "Expired" },
    }).lean();

    // Update all expired tracks to "Expired"
    await FileTracks.updateMany(
      { ExpiresAt: { $lt: currentDate } },
      { status: "Expired" }
    );

    if (newlyExpiredTracks.length) {
      await notifyContractManagers(newlyExpiredTracks);
      console.log(`Sent expiry notifications for ${newlyExpiredTracks.length} filetracks.`);
    } else {
      console.log("No newly expired filetracks to notify.");
    }

    console.log("Expiry check completed.");
  } catch (error) {
    console.error("Error during daily expiry check:", error);
  }
});
