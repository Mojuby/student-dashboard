// Structured JSON logs to stdout (Render/Vercel log drains pick these up). Secrets are redacted by key name.
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };
const SECRET_KEYS = /^(password|newpassword|currentpassword|token|accesstoken|access_token|refresh_token|refreshtoken|authorization|cookie|set-cookie|invitecode|code_hash|apikey|api_key|secret|database_url|databaseurl|private_key|service_key)$/i;

function clean(value, depth = 0) {
  if (value == null || typeof value !== 'object') return value;
  if (depth > 4) return '[depth]';
  if (value instanceof Error) return { name: value.name, message: value.message, status: value.status, pgCode: value.code };
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => clean(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : clean(v, depth + 1);
  return out;
}

function write(level, msg, fields) {
  const threshold = LEVELS[process.env.LOG_LEVEL || 'info'] ?? LEVELS.info;
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ ts: new Date().toISOString(), level, msg, ...clean(fields) });
  (level === 'error' ? process.stderr : process.stdout).write(`${line}\n`);
}

module.exports = {
  debug: (m, f) => write('debug', m, f),
  info: (m, f) => write('info', m, f),
  warn: (m, f) => write('warn', m, f),
  error: (m, f) => write('error', m, f),
  clean,
};
