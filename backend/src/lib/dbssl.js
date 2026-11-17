// DATABASE_SSL: "verify" (recommended in production), "no-verify" (legacy default: encrypted, certificate not
// checked) or "disable" (local/test databases only).
function sslOption(mode = process.env.DATABASE_SSL || 'no-verify') {
  const m = String(mode).toLowerCase();
  if (m === 'disable') return false;
  if (m === 'verify') return { rejectUnauthorized: true };
  if (m === 'no-verify') return { rejectUnauthorized: false };
  throw new Error(`DATABASE_SSL must be verify, no-verify or disable (got "${mode}")`);
}
module.exports = { sslOption };
