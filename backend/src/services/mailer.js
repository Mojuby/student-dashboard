const config = require('../config');

// Sends nothing unless MAIL_DRY_RUN=false AND RESEND_API_KEY + EMAIL_FROM are set; otherwise returns "dry_run"
// so callers can fall back to handing the invitation over another way.
async function sendEmail({ to, subject, html, text }) {
  const { resendKey, emailFrom, dryRun } = config.mail;
  if (dryRun || !resendKey || !emailFrom) return { status: 'dry_run' };
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: emailFrom, to, subject, html, text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`Email provider responded ${res.status}`);
  return { status: 'sent' };
}

const mailMode = () => ({ dryRun: config.mail.dryRun, configured: !!(config.mail.resendKey && config.mail.emailFrom) });

module.exports = { sendEmail, mailMode };
