// Dev-only OTP bypass. Enabled ONLY when DEV_BYPASS_OTP=true AND we are not in
// production. Double-guarded so a stray env var can never disable OTP on prod.
//
// ⚠️  Never set DEV_BYPASS_OTP in a production/staging environment.
function otpBypassEnabled() {
  return (
    process.env.DEV_BYPASS_OTP === "true" &&
    process.env.NODE_ENV !== "production" &&
    process.env.NODE_ENV !== "test" // keep Jest + E2E scripts exercising REAL OTP
  );
}

// Logs a loud, consistent warning at each bypass so it's never silent.
function warnBypass(where) {
  console.warn(`⚠️  [DEV_BYPASS_OTP] OTP verification bypassed in ${where} — dev only, MUST be off in production.`);
}

module.exports = { otpBypassEnabled, warnBypass };
