const config = require('../config');

// Sends nothing unless REMINDERS_DRY_RUN=false AND RESEND_API_KEY + EMAIL_FROM are set.
async function sendEmail({ to, subject, html }) {
  const { resendKey, emailFrom, dryRun } = config.mail;
  if (dryRun || !resendKey || !emailFrom) return { status: 'dry_run' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: emailFrom, to, subject, html }),
  });
  if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
  return { status: 'sent' };
}

module.exports = { sendEmail };