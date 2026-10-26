const { admin, anon } = require('../supabase');
const { query } = require('../db');
const { isProd } = require('../config');

const ROLES = ['admin', 'facilitator', 'learner'];
const base = { httpOnly: true, secure: isProd, sameSite: 'lax', path: '/' };

// Each portal (admin / facilitator / learner) has its OWN cookie pair. A browser holds one cookie jar, and staff are
// often signed in to several portals at once (different tabs). With a single shared pair, the last login replaced every
// other tab's session and its next request failed with 403 Forbidden.
const cookieNames = (role) => ({ at: `fv_${role}_at`, rt: `fv_${role}_rt` });
const LEGACY_COOKIES = ['fv_at', 'fv_rt']; // the old shared pair; retired on the next login/logout

// Which portal is asking. Role-bound routes know it already; the shared /auth routes (me, logout, change-password)
// read it from a header the frontend sets from the page the user is on. Unknown values fall back to "learner".
function portalOf(req) {
  const p = String(req.get('x-fv-portal') || '').toLowerCase();
  return ROLES.includes(p) ? p : 'learner';
}

// Idle expiry: admins 8h, everyone else 7d (refreshed while active).
function setSessionCookies(res, session, role) {
  const n = cookieNames(role);
  const refreshMs = (role === 'admin' ? 8 : 24 * 7) * 3600 * 1000;
  res.cookie(n.at, session.access_token, { ...base, maxAge: session.expires_in * 1000 });
  res.cookie(n.rt, session.refresh_token, { ...base, maxAge: refreshMs });
  for (const c of LEGACY_COOKIES) res.clearCookie(c, base);
}

// With a role: ends only that portal's session. Without one: ends every portal's (used when a password is reset).
function clearSessionCookies(res, role) {
  for (const r of role ? [role] : ROLES) {
    const n = cookieNames(r);
    res.clearCookie(n.at, base);
    res.clearCookie(n.rt, base);
  }
  for (const c of LEGACY_COOKIES) res.clearCookie(c, base);
}

// requireAuth('admin') or requireAuth((req) => portalOf(req)). Only the named portal's cookies are consulted.
function requireAuth(roleOrFn) {
  return async (req, res, next) => {
    try {
      const role = typeof roleOrFn === 'function' ? roleOrFn(req) : roleOrFn;
      const n = cookieNames(role);
      let user = null;
      let session = null;
      const at = req.cookies[n.at];
      const rt = req.cookies[n.rt];
      if (at) {
        const { data, error } = await admin.auth.getUser(at);
        if (!error) user = data.user;
      }
      if (!user && rt) {
        const { data, error } = await anon().auth.refreshSession({ refresh_token: rt });
        if (!error && data.session) { user = data.user; session = data.session; }
      }
      const none = () => { clearSessionCookies(res, role); return res.status(401).json({ error: 'Authentication required', requestId: req.id }); };
      if (!user) return none();

      const { rows: [p] } = await query(
        'select id, email, full_name, role, is_active, must_change_password from profiles where id = $1', [user.id]
      );
      // A portal's cookies must belong to an active account of that same role; anything else is treated as signed out.
      if (!p || !p.is_active || p.role !== role) return none();

      if (session) setSessionCookies(res, session, p.role);
      req.user = { id: p.id, email: p.email, fullName: p.full_name, role: p.role, mustChangePassword: p.must_change_password };
      next();
    } catch (e) {
      next(e);
    }
  };
}

module.exports = { requireAuth, setSessionCookies, clearSessionCookies, cookieNames, portalOf, ROLES };