function parse(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    return u;
  } catch {
    return null;
  }
}

const ID = '[\\w-]{10,}'; // Google file/folder ids are long URL-safe strings
const DOC_KINDS = '(?:document|spreadsheets|presentation|forms|drawings)'; // Docs, Sheets, Slides, Forms, Drawings
const rx = (src) => new RegExp(src);

// Every Google Workspace link a learner may submit. The HOSTNAME must match exactly (so look-alikes such as
// docs.google.com.evil.com are rejected) and the PATH must have the shape of a real file/folder link with an id.
const GOOGLE_LINKS = [
  // Docs, Sheets, Slides, Forms, Drawings (including /u/0/ account switchers and /a/yourdomain.com/ workspace links)
  ['docs.google.com', rx(`^/${DOC_KINDS}/(?:u/\\d+/)?d/(?:e/)?${ID}`)],
  ['docs.google.com', rx(`^/a/[\\w.-]+/${DOC_KINDS}/d/(?:e/)?${ID}`)],
  // Drive: any uploaded file (PDF, PowerPoint .pptx, Word .docx, Excel .xlsx, images, video ...) and folders
  ['drive.google.com', rx(`^/file/(?:u/\\d+/)?d/${ID}`)],
  ['drive.google.com', rx(`^/drive/(?:u/\\d+/)?folders/${ID}`)],
  // Google Sites (portfolios / project sites)
  ['sites.google.com', rx('^/(?:view|site)/[\\w.-]+')],
  // Looker Studio dashboards (formerly Data Studio) and Colab notebooks saved to Drive
  ['lookerstudio.google.com', rx(`^/(?:u/\\d+/)?(?:reporting|s|embed/reporting)/${ID}`)],
  ['datastudio.google.com', rx(`^/(?:u/\\d+/)?(?:reporting|s|embed/reporting)/${ID}`)],
  ['colab.research.google.com', rx(`^/drive/${ID}`)],
  // Google's own short link for Forms
  ['forms.gle', rx('^/[\\w-]{6,}$')],
];

// Accepts a link to Google Docs, Sheets, Slides, Forms, Drawings, a Drive file or folder, a Google Site, a Looker Studio
// report or a Colab notebook. Returns the normalised URL or null.
function normalizeGoogleUrl(raw) {
  const u = parse(raw);
  if (!u) return null;
  const known = GOOGLE_LINKS.some(([host, re]) => u.hostname === host && re.test(u.pathname));
  // The older Drive "open?id=" link form
  const open = u.hostname === 'drive.google.com' && u.pathname === '/open' && new RegExp(`^${ID}$`).test(u.searchParams.get('id') || '');
  return known || open ? u.toString() : null;
}

function normalizeWhatsAppInvite(raw) {
  const u = parse(raw);
  return u && u.hostname === 'chat.whatsapp.com' && /^\/[A-Za-z0-9]{10,}$/.test(u.pathname) ? u.toString() : null;
}

const normalizeHttps = (raw) => parse(raw)?.toString() ?? null;

// normalizeDocUrl is the name the rest of the code already imports; it now accepts all of the links above.
module.exports = { normalizeGoogleUrl, normalizeDocUrl: normalizeGoogleUrl, normalizeWhatsAppInvite, normalizeHttps };