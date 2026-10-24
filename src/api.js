export const SESSION_EXPIRED = 'fv:session-expired';

// One client for the whole app. Same-origin (Vercel proxies /api to the backend) so the session cookie is first-party.
export async function api(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      signal,
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    const err = new Error('Cannot reach the server. Check your internet connection and try again.');
    err.status = 0;
    err.code = 'NETWORK';
    throw err;
  }
  let data = null;
  const text = await res.text();
  if (text) { try { data = JSON.parse(text); } catch { /* a proxy/HTML error page: handled below */ } }
  if (!res.ok) {
    const fallback = res.status >= 500 ? 'The server had a problem. Please try again in a moment.' : 'Something went wrong. Please try again.';
    const err = new Error(data?.error || fallback);
    err.status = res.status;
    err.code = data?.code;
    err.requestId = data?.requestId;
    // A 401 from a protected call means the session ended. Auth endpoints (login/claim) are excluded so a wrong password
    // never looks like an expired session, and there is no redirect loop.
    if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(SESSION_EXPIRED));
    throw err;
  }
  return data;
}
