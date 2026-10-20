const { admin, anon } = require('../supabase');
const { query } = require('../db');
const { isProd } = require('../config');

const base = { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' };

// Idle expiry: admins 8h, everyone else 7d (refreshed while active).
function setSessionCookies(res, session, role) {
  const refreshMs = (role === 'admin' ? 8 : 24 * 7) * 3600 * 1000;
  res.cookie('fv_at', session.access_token, { ...base, maxAge: session.expires_in * 1000 });
  res.cookie('fv_rt', session.refresh_token, { ...base, maxAge: refreshMs });
}

function clearSessionCookies(res) {
  res.clearCookie('fv_at', base);
  res.clearCookie('fv_rt', base);
}

async function requireAuth(req, res, next) {
  try {
    let user = null;
    let session = null;
    const at = req.cookies.fv_at;
    const rt = req.cookies.fv_rt;
    if (at) {
      const { data, error } = await admin.auth.getUser(at);
      if (!error) user = data.user;
    }
    if (!user && rt) {
      const { data, error } = await anon().auth.refreshSession({ refresh_token: rt });
      if (!error && data.session) { user = data.user; session = data.session; }
    }
    if (!user) { clearSessionCookies(res); return res.status(401).json({ error: 'Authentication required' }); }

    const { rows: [p] } = await query(
      'select id, email, full_name, role, is_active, must_change_password from profiles where id = $1', [user.id]
    );
    if (!p || !p.is_active) { clearSessionCookies(res); return res.status(401).json({ error: 'Authentication required' }); }

    if (session) setSessionCookies(res, session, p.role);
    req.user = { id: p.id, email: p.email, fullName: p.full_name, role: p.role, mustChangePassword: p.must_change_password };
    next();
  } catch (e) {
    next(e);
  }
}

module.exports = { requireAuth, setSessionCookies, clearSessionCookies };