// The public address of the frontend, used in every emailed link (/claim, /assessments, /reset-password ...).
// APP_URL wins. If it is not set, use the first allowed origin that is NOT a *.vercel.app host (so an old Vercel address
// that happens to be listed first is never put into an email), and only then fall back to the first origin.
function pickAppUrl({ appUrl, origins = [] }) {
  const clean = (u) => String(u || '').trim().replace(/\/+$/, '');
  if (clean(appUrl)) return clean(appUrl);
  const custom = origins.map(clean).find((o) => {
    try { return o && !/\.vercel\.app$/i.test(new URL(o).hostname); } catch { return false; }
  });
  return custom || clean(origins[0]) || '';
}
module.exports = { pickAppUrl };
