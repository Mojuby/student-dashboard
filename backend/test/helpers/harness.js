require('./env');
const path = require('path');
const { Client } = require('pg');
const { makeFakeSupabase } = require('./fakeSupabase');

// Refuse to run against anything that is not an obviously local, test-named database. These tests DROP the public schema.
function assertSafeTestDb(url) {
  let u;
  try { u = new URL(url); } catch { throw new Error('TEST_DATABASE_URL is not a valid URL'); }
  const local = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  if (!local || !/test/i.test(u.pathname)) {
    throw new Error('Refusing to run: TEST_DATABASE_URL must be a LOCAL database whose name contains "test" (these tests wipe the public schema).');
  }
}

const realFetch = global.fetch;

async function boot() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return null;
  assertSafeTestDb(url);
  process.env.DATABASE_URL = url;

  // Fresh database: stand-in for Supabase's auth schema, then every real migration in order.
  const admin = new Client({ connectionString: url });
  await admin.connect();
  await admin.query('drop schema if exists public cascade; create schema public; drop schema if exists auth cascade; create schema auth;');
  await admin.query('create table auth.users (id uuid primary key default gen_random_uuid(), email text)');
  const { runMigrations } = require('../../scripts/migrate');
  const applied = await runMigrations(admin, { log: () => {} });
  await admin.end();

  // Swap Supabase for the fake BEFORE the app loads.
  const fake = makeFakeSupabase();
  const supaPath = require.resolve('../../src/supabase');
  require.cache[supaPath] = { id: supaPath, filename: supaPath, loaded: true, exports: fake.module };

  const db = require('../../src/db');
  fake.hooks.db = db;
  const app = require('../../src/app');
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;

  // Capture outgoing email instead of calling the provider.
  const mail = { sent: [], mode: 'ok', failures: 0 };
  global.fetch = async (input, init) => {
    const target = typeof input === 'string' ? input : input.url;
    if (target.startsWith('https://api.resend.com')) {
      if (mail.mode === 'fail') { mail.failures++; return { ok: false, status: 500, text: async () => 'err' }; }
      mail.sent.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ id: 'test' }), text: async () => '{}' };
    }
    return realFetch(input, init);
  };

  const sheets = require('../../src/services/sheets');
  const sheetData = new Map();
  sheets.source.fetch = async (n) => {
    if (!sheetData.has(n)) throw Object.assign(new Error('no tab'), { code: 'TAB_NOT_FOUND' });
    return sheetData.get(n);
  };

  return {
    applied, db, fake, mail, base, sheetData, server,
    async close() { global.fetch = realFetch; await new Promise((r) => server.close(r)); await db.pool.end(); },
  };
}

// Minimal cookie-aware JSON client: one per actor, so sessions never mix.
function actor(base) {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  async function call(method, p, body, headers = {}) {
    const res = await realFetch(base + p, {
      method,
      headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(jar.size ? { cookie: cookieHeader() } : {}), ...headers },
      body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
    });
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair, ...attrs] = c.split(';');
      const [k, ...v] = pair.split('=');
      const val = v.join('=');
      const expired = !val || attrs.some((a) => /max-age=0/i.test(a)) || attrs.some((a) => /expires=.*1970/i.test(a));
      if (expired) jar.delete(k.trim()); else jar.set(k.trim(), val);
    }
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, body: json, text, headers: res.headers };
  }
  return {
    get: (p, h) => call('GET', p, undefined, h), post: (p, b, h) => call('POST', p, b ?? {}, h),
    put: (p, b, h) => call('PUT', p, b ?? {}, h), patch: (p, b, h) => call('PATCH', p, b ?? {}, h), del: (p, h) => call('DELETE', p, undefined, h),
    raw: call, jar,
  };
}

// Synthetic registration-sheet rows (header + data), matching the real column layout A:T.
function sheetRows(dataRows) {
  const header = ['Student Name', 'Student Email Address', 'Stack', 'Attendance W1-5%'];
  return [header, ...dataRows];
}

module.exports = { boot, actor, sheetRows, assertSafeTestDb, path };
