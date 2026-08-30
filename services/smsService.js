/**
 * smsService — provider-agnostic SMS seam.
 *
 * Swap providers by changing only this file. The rest of the app calls
 * `sendSms({ to, message })` and never sees Termii/Twilio specifics.
 *
 * Termii adapter env:
 *   TERMII_API_KEY    – account API key
 *   TERMII_SENDER_ID  – approved sender ID / alphanumeric (default "Halden")
 *   TERMII_BASE_URL   – override (default https://api.ng.termii.com)
 *
 * If TERMII_API_KEY is unset we fall back to a console adapter that logs the
 * message (dev / not-yet-provisioned) instead of throwing — so OTP flows can be
 * exercised end-to-end before the provider is wired.
 */

const TERMII_BASE_URL = process.env.TERMII_BASE_URL || "https://api.ng.termii.com";

async function sendViaTermii({ to, message }) {
  const res = await fetch(`${TERMII_BASE_URL}/api/sms/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to,
      from: process.env.TERMII_SENDER_ID || "Halden",
      sms: message,
      type: "plain",
      channel: "generic",
      api_key: process.env.TERMII_API_KEY,
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Termii send failed (${res.status}): ${data.message || "unknown error"}`);
    err.status = 502;
    throw err;
  }
  return { provider: "termii", ...data };
}

function sendViaConsole({ to, message }) {
  console.log(`[smsService:console] (no TERMII_API_KEY) → ${to}: ${message}`);
  return Promise.resolve({ provider: "console", to });
}

/**
 * Send an SMS. Resolves with the provider response, rejects (with .status 502)
 * on provider failure so callers can decide whether the failure is fatal.
 * @param {{to: string, message: string}} p
 */
async function sendSms({ to, message }) {
  if (!to) throw Object.assign(new Error("SMS recipient (to) is required"), { status: 400 });
  if (!message) throw Object.assign(new Error("SMS message is required"), { status: 400 });

  if (!process.env.TERMII_API_KEY) return sendViaConsole({ to, message });
  return sendViaTermii({ to, message });
}

module.exports = { sendSms };
