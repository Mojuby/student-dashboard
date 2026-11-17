// Which portal this tab belongs to. The server keeps a separate session per portal (admin / facilitator / learner),
// so a login in one tab can no longer replace the session another tab is using.
const KEY = 'fv.portal';

export function getPortal() {
  const path = window.location.pathname;
  if (path.startsWith('/admin')) return 'admin';
  if (path.startsWith('/facilitator')) return 'facilitator';
  if (path === '/change-password') { // shared page: use what this tab signed in as
    try { return sessionStorage.getItem(KEY) || 'learner'; } catch { return 'learner'; }
  }
  return 'learner';
}

export function rememberPortal(role) {
  try { sessionStorage.setItem(KEY, role); } catch { /* storage blocked: path-based detection still works */ }
}