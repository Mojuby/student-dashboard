const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, actor } = require('../helpers/harness');

const skip = !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL not set (needs a LOCAL Postgres whose name contains "test")';
const PW = 'Session-Pass-12345';
const P = (role) => ({ 'x-fv-portal': role });

// One browser holds ONE cookie jar. Admins, facilitators and learners are often signed in side by side
// (different tabs, or staff testing each portal). Each portal must keep its own session.
describe('sessions: roles in the same browser do not clobber each other', { skip }, () => {
  let h;
  before(async () => {
    h = await boot();
    const { db, fake } = h;
    for (const [email, name, role] of [['admin@example.test', 'Admin', 'admin'], ['fac@example.test', 'Facil', 'facilitator'], ['lrn@example.test', 'Learner', 'learner']]) {
      const u = await fake.addUser(email, PW);
      await db.query('insert into profiles (id,email,full_name,role) values ($1,$2,$3,$4)', [u.id, email, name, role]);
    }
    const { rows: [s] } = await db.query(`insert into stacks (name) values ('Product Management') returning id`);
    const { rows: [c] } = await db.query(`insert into cohorts (number,name,week1_class_date,status,is_active) values (10,'Cohort 10','2026-11-07','active',true) returning id`);
    const lp = (await db.query(`select id from profiles where email='lrn@example.test'`)).rows[0].id;
    await db.query(`insert into learners (cohort_id,stack_id,full_name,email,profile_id,status) values ($1,$2,'Learner','lrn@example.test',$3,'active')`, [c.id, s.id, lp]);
  });
  after(async () => { if (h) await h.close(); });

  it('keeps learner, facilitator and admin signed in together in one browser', async () => {
    const browser = actor(h.base); // single cookie jar
    assert.equal((await browser.post('/api/auth/learner/login', { email: 'lrn@example.test', password: PW })).status, 200);
    assert.equal((await browser.post('/api/auth/facilitator/login', { email: 'fac@example.test', password: PW })).status, 200);
    assert.equal((await browser.post('/api/auth/admin/login', { email: 'admin@example.test', password: PW })).status, 200);

    // Each call below is what a page of that portal does. All three must still succeed.
    const calls = [['/api/learner/orientation', 'learner'], ['/api/facilitator/me', 'facilitator'], ['/api/admin/cohorts', 'admin']];
    for (const [path, portal] of [...calls, ...calls.slice().reverse()]) {
      const r = await browser.get(path, P(portal));
      assert.equal(r.status, 200, `${portal} portal got ${r.status} ${r.text}`);
    }
  });

  it('/auth/me answers for the portal asking, and logout only ends that portal', async () => {
    const browser = actor(h.base);
    for (const [r, e] of [['learner', 'lrn'], ['facilitator', 'fac'], ['admin', 'admin']]) {
      assert.equal((await browser.post(`/api/auth/${r}/login`, { email: `${e}@example.test`, password: PW })).status, 200);
    }
    assert.equal((await browser.get('/api/auth/me', P('facilitator'))).body.user.role, 'facilitator');
    assert.equal((await browser.get('/api/auth/me', P('admin'))).body.user.role, 'admin');
    assert.equal((await browser.get('/api/auth/me', P('learner'))).body.user.role, 'learner');
    assert.equal((await browser.post('/api/auth/logout', {}, P('admin'))).status, 200);
    assert.equal((await browser.get('/api/admin/cohorts', P('admin'))).status, 401, 'admin session ended');
    assert.equal((await browser.get('/api/facilitator/me', P('facilitator'))).status, 200, 'facilitator unaffected');
    assert.equal((await browser.get('/api/learner/orientation', P('learner'))).status, 200, 'learner unaffected');
  });

  it('a portal never accepts another portal\'s session (no privilege crossover)', async () => {
    const browser = actor(h.base);
    assert.equal((await browser.post('/api/auth/learner/login', { email: 'lrn@example.test', password: PW })).status, 200);
    assert.equal((await browser.get('/api/admin/cohorts')).status, 401, 'a learner session is not an admin session');
    assert.equal((await browser.get('/api/facilitator/me')).status, 401);
  });
});
