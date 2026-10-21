function parse(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u;
  } catch {
    return null;
  }
}

// Accepts a Google Doc or a Google Drive FOLDER link. Returns the normalised URL or null.
function normalizeDocUrl(raw) {
  const u = parse(raw);
  if (!u) return null;
  const doc = u.hostname === 'docs.google.com' && /^\/document\/(u\/\d+\/)?d\/[\w-]{10,}/.test(u.pathname);
  const folder = u.hostname === 'drive.google.com' && /^\/drive\/(u\/\d+\/)?folders\/[\w-]{10,}/.test(u.pathname);
  return doc || folder ? u.toString() : null;
}

function normalizeWhatsAppInvite(raw) {
  const u = parse(raw);
  return u && u.hostname === 'chat.whatsapp.com' && /^\/[A-Za-z0-9]{10,}$/.test(u.pathname) ? u.toString() : null;
}

const normalizeHttps = (raw) => parse(raw)?.toString() ?? null;

module.exports = { normalizeDocUrl, normalizeWhatsAppInvite, normalizeHttps };