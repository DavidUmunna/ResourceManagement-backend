// backend/src/services/NotificationService.js
class EmailNotificationService {
  async sendConfirmation(feedback) {
    // Implement email sending logic
    console.log(`Sending confirmation email to ${feedback.email} for feedback ${feedback.id}`);
    
    // In production: integrate with email service like SendGrid, AWS SES, etc.
    // Example with nodemailer:
    // const transporter = nodemailer.createTransport({ ... });
    // await transporter.sendMail({
    //   from: 'noreply@yourapp.com',
    //   to: feedback.email,
    //   subject: `Feedback Received: ${feedback.title}`,
    //   html: `<p>Thank you for your feedback!</p><p>Reference ID: ${feedback.id}</p>`
    // });
  }
  
  async sendStatusUpdate(feedback) {
    console.log(`Sending status update email to ${feedback.email} for feedback ${feedback.id}`);
    // Implementation similar to above
  }
}

/**
 * notifyIssue — consolidated alert seam for RFID-skip exception events
 * (manual scans, waybill rejections, rental expiry, etc.). Emails everyone
 * holding an issue-notify role. Best-effort: never throws into the caller so a
 * notification failure can't break the primary action. (FR-28; Phase 8 widens
 * the set of events that call this.)
 *
 * @param {Object}  p
 * @param {string}  p.event        one of ISSUE_EVENTS
 * @param {string}  p.title        short subject line
 * @param {string}  p.message      human-readable body
 * @param {Object}  [p.context]    extra structured detail (skip id, actor, …)
 */
async function notifyIssue({ event, title, message, context = {} }) {
  try {
    const User = require("../models/users_");
    const { transporter } = require("../emailnotification/emailNotification");
    const { ISSUE_NOTIFY_ROLES } = require("../constants/skips.constants");

    const recipients = await User.find({ role: { $in: ISSUE_NOTIFY_ROLES } })
      .select("email")
      .lean();
    const to = recipients.map((u) => u.email).filter(Boolean);

    console.log(`[notifyIssue] ${event}: ${title} → ${to.length} recipient(s)`, context);
    if (!to.length) return { notified: 0 };

    await transporter.sendMail({
      from: process.env.EMAIL_USER || "noreply@haldengroup.ng",
      to,
      subject: `[Skip Tracking] ${title}`,
      html: `<p>${message}</p><pre>${JSON.stringify(context, null, 2)}</pre>`,
    });
    return { notified: to.length };
  } catch (err) {
    console.error("[notifyIssue] failed (non-fatal):", err.message);
    return { notified: 0, error: err.message };
  }
}

module.exports={EmailNotificationService, notifyIssue};