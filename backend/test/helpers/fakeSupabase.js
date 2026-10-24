// Test double for Supabase Auth. Mirrors users into the test database's auth.users table so the real
// profiles -> auth.users foreign key is exercised. TEST CODE ONLY: never imported by production code.
const crypto = require('crypto');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeFakeSupabase() {
  const users = new Map();
  const sessions = new Map();
  const refresh = new Map();
  const sentResets = [];
  const hooks = { db: null, createDelayMs: 0, failCreateOnce: false };

  const byEmail = (e) => [...users.values()].find((u) => u.email === String(e).toLowerCase());
  const session = (u) => {
    const at = `at_${crypto.randomUUID()}`; const rt = `rt_${crypto.randomUUID()}`;
    sessions.set(at, u.id); refresh.set(rt, u.id);
    return { access_token: at, refresh_token: rt, expires_in: 3600 };
  };
  const err = (message, code, status = 400) => ({ message, code, status });

  const admin = {
    auth: {
      getUser: async (token) => {
        const u = users.get(sessions.get(token));
        return u ? { data: { user: { id: u.id, email: u.email } }, error: null } : { data: { user: null }, error: err('invalid token', 'bad_jwt', 401) };
      },
      signOut: async (token) => { sessions.delete(token); return { error: null }; },
      admin: {
        createUser: async ({ email, password }) => {
          if (hooks.createDelayMs) await sleep(hooks.createDelayMs);
          if (hooks.failCreateOnce) { hooks.failCreateOnce = false; return { data: { user: null }, error: err('provider outage', 'unexpected_failure', 500) }; }
          if (byEmail(email)) return { data: { user: null }, error: err('A user with this email address has already been registered', 'email_exists', 422) };
          const u = { id: crypto.randomUUID(), email: String(email).toLowerCase(), password };
          users.set(u.id, u);
          if (hooks.db) await hooks.db.query('insert into auth.users (id, email) values ($1,$2)', [u.id, u.email]);
          return { data: { user: { id: u.id, email: u.email } }, error: null };
        },
        deleteUser: async (id) => {
          users.delete(id);
          if (hooks.db) await hooks.db.query('delete from auth.users where id = $1', [id]);
          return { error: null };
        },
        updateUserById: async (id, attrs) => {
          const u = users.get(id);
          if (!u) return { error: err('not found', 'user_not_found', 404) };
          if (attrs.password) u.password = attrs.password;
          return { data: { user: { id } }, error: null };
        },
        listUsers: async () => ({ data: { users: [...users.values()].map((u) => ({ id: u.id, email: u.email })) }, error: null }),
      },
    },
  };

  const anon = () => ({
    auth: {
      signInWithPassword: async ({ email, password }) => {
        const u = byEmail(email);
        if (!u || u.password !== password) return { data: { session: null, user: null }, error: err('Invalid login credentials', 'invalid_credentials', 400) };
        return { data: { session: session(u), user: { id: u.id, email: u.email } }, error: null };
      },
      refreshSession: async ({ refresh_token: rt }) => {
        const u = users.get(refresh.get(rt));
        return u ? { data: { session: session(u), user: { id: u.id, email: u.email } }, error: null } : { data: { session: null, user: null }, error: err('bad refresh', 'refresh_token_not_found', 400) };
      },
      resetPasswordForEmail: async (email, opts) => { sentResets.push({ email, redirectTo: opts?.redirectTo }); return { data: {}, error: null }; },
    },
  });

  return {
    module: { admin, anon },
    hooks, users, sentResets,
    // A user that exists only in Auth (e.g. left behind by an interrupted activation).
    async addAuthOnly(email, password) {
      const { data } = await admin.auth.admin.createUser({ email, password });
      return data.user;
    },
    async addUser(email, password) { return this.addAuthOnly(email, password); },
    recoveryToken(email) { return session(byEmail(email)).access_token; },
    reset() { users.clear(); sessions.clear(); refresh.clear(); sentResets.length = 0; hooks.createDelayMs = 0; hooks.failCreateOnce = false; },
  };
}

module.exports = { makeFakeSupabase };
