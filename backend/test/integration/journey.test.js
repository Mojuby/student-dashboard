const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, actor, sheetRows } = require('../helpers/harness');

const skip = !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL not set (needs a LOCAL Postgres whose name contains "test")';

// Synthetic people only. Passwords are test constants.
const ADMIN = { email: 'admin@example.test', pw: 'Admin-Pass-12345' };
const FAC = { email: 'fac.pm@example.test', pw: 'Facil-Pass-12345' };
const LP = 'Learner-Pass-12345';
const ok = (res, code = 200) => assert.equal(res.status, code, `expected ${code}, got ${res.status}: ${res.text}`);

describe('FUSE platform: onboarding, cohorts, grading, security', { skip }, () => {
  let h; let admin; let cohort10; let c9; let before9;
  const stack = {};
  const inbox = (email) => h.mail.sent.filter((m) => m.to === email);
  const codeFor = (email) => {
    const m = inbox(email).at(-1);
    assert.ok(m, `no email sent to ${email}`);
    return m.text.match(/invite code: ([A-Z2-9]{10})/)[1];
  };

  before(async () => {
    h = await boot();
    const { db, fake } = h;
    // Cohort 9: the live cohort that must be left completely alone by everything below.
    const seedUser = async (email, name, role, pw) => {
      const u = await fake.addUser(email, pw);
      await db.query('insert into profiles (id,email,full_name,role) values ($1,$2,$3,$4)', [u.id, email, name, role]);
      return u;
    };
    const adminUser = await seedUser(ADMIN.email, 'Test Admin', 'admin', ADMIN.pw);
    const l9 = await seedUser('learner9@example.test', 'Learner Nine', 'learner', LP);
    const { rows: [s] } = await db.query(`insert into stacks (name) values ('Product Management') returning id`);
    stack['Product Management'] = s.id;
    ({ rows: [c9] } = await db.query(
      `insert into cohorts (number,name,week1_class_date,status,is_active) values (9,'Cohort 9','2026-08-01','active',true) returning id`));
    const { rows: [l9row] } = await db.query(
      `insert into learners (cohort_id,stack_id,full_name,email,profile_id,status,activated_at,orientation_completed_at)
       values ($1,$2,'Learner Nine','learner9@example.test',$3,'active',now(),now()) returning id`, [c9.id, s.id, l9.id]);
    const { rows: [a9] } = await db.query(
      `insert into assessments (cohort_id,week_number,title,max_score,opens_at,due_at) values ($1,1,'W1',5,now()-interval '9 day',now()-interval '2 day') returning id`, [c9.id]);
    c9.assessmentId = a9.id;
    const { rows: [sub9] } = await db.query(`insert into submissions (assessment_id,learner_id,url) values ($1,$2,'https://docs.google.com/document/d/c9learnerdoc1') returning id`, [a9.id, l9row.id]);
    await db.query(`insert into grades (submission_id,score,feedback,graded_by) values ($1,4,'ok',$2)`, [sub9.id, adminUser.id]);
    const snap = async () => ({
      cohort: (await db.query('select * from cohorts where number = 9')).rows,
      learners: (await db.query('select * from learners where cohort_id = $1', [c9.id])).rows,
      assessments: (await db.query('select * from assessments where cohort_id = $1', [c9.id])).rows,
      submissions: (await db.query('select s.* from submissions s join assessments a on a.id = s.assessment_id where a.cohort_id = $1', [c9.id])).rows,
      grades: (await db.query('select g.* from grades g join submissions s on s.id = g.submission_id join assessments a on a.id = s.assessment_id where a.cohort_id = $1', [c9.id])).rows,
    });
    c9.snap = snap;
    before9 = await snap();
    admin = actor(h.base);
  });
  after(async () => { if (h) await h.close(); });

  describe('platform basics', () => {
    it('serves liveness and readiness', async () => {
      const a = actor(h.base);
      const live = await a.get('/api/health'); ok(live); assert.equal(live.body.ok, true);
      const ready = await a.get('/api/ready'); ok(ready);
      assert.equal(ready.body.checks.database.ok, true); assert.equal(ready.body.checks.auth.ok, true);
      assert.ok(ready.body.checks.database.latencyMs >= 0);
    });

    it('reports NOT ready (503) when the database is unreachable', async () => {
      const real = h.db.healthCheck;
      h.db.healthCheck = async () => { throw new Error('connection refused'); };
      try {
        const res = await actor(h.base).get('/api/ready');
        assert.equal(res.status, 503); assert.equal(res.body.ok, false); assert.equal(res.body.checks.database.ok, false);
        assert.ok(!/connection refused/.test(res.text), 'internal error text must not leak');
      } finally { h.db.healthCheck = real; }
    });

    it('uses one error shape with a request id, and hides internals', async () => {
      const a = actor(h.base);
      const nf = await a.get('/api/nope', { 'x-request-id': 'req-test-12345678' });
      assert.equal(nf.status, 404); assert.equal(nf.body.requestId, 'req-test-12345678'); assert.equal(nf.headers.get('x-request-id'), 'req-test-12345678');
      const bad = await a.raw('POST', '/api/auth/learner/login', '{not json', { 'content-type': 'application/json' });
      assert.equal(bad.status, 400); assert.ok(bad.body.requestId);
      assert.ok(!/at JSON|SyntaxError|stack/i.test(bad.text));
    });

    it('rejects cross-origin and non-JSON state-changing requests (CSRF defence)', async () => {
      const a = actor(h.base);
      assert.equal((await a.post('/api/auth/learner/login', { email: 'a@example.test', password: 'x' }, { origin: 'https://evil.test' })).status, 403);
      assert.equal((await a.post('/api/auth/learner/login', { email: 'a@example.test', password: 'x' }, { 'sec-fetch-site': 'cross-site' })).status, 403);
      assert.equal((await a.raw('POST', '/api/auth/learner/login', 'email=a&password=b', { 'content-type': 'application/x-www-form-urlencoded' })).status, 415);
      assert.equal((await a.post('/api/auth/learner/login', { email: 'a@example.test', password: 'x' }, { origin: 'https://app.test' })).status, 401);
    });

    it('requires login and the right role for every area', async () => {
      const anon = actor(h.base);
      for (const p of ['/api/admin/cohorts', '/api/admin/learners-overview', '/api/learner/overview', '/api/facilitator/me']) assert.equal((await anon.get(p)).status, 401, p);
      const l = actor(h.base);
      ok(await l.post('/api/auth/learner/login', { email: 'learner9@example.test', password: LP }));
      assert.equal((await l.get('/api/admin/cohorts')).status, 403);
      assert.equal((await l.get('/api/facilitator/me')).status, 403);
      assert.equal((await actor(h.base).post('/api/auth/admin/login', { email: 'learner9@example.test', password: LP })).status, 401, 'a learner cannot use the admin portal');
    });
  });

  describe('admin: cohort and stacks', () => {
    it('logs in as admin', async () => { ok(await admin.post('/api/auth/admin/login', { email: ADMIN.email, password: ADMIN.pw })); });

    it('creates stacks and Cohort 10 (upcoming), validating the class date', async () => {
      for (const name of ['Project Management', 'Data Analysis', 'Content Writing', 'Digital Marketing & SEO']) {
        const r = await admin.post('/api/admin/stacks', { name }); ok(r, 201); stack[name] = r.body.stack.id;
      }
      assert.equal((await admin.post('/api/admin/cohorts', { number: 10, week1ClassDate: '2026-11-09' })).status, 400, 'a Monday is not a class day');
      const r = await admin.post('/api/admin/cohorts', { number: 10, week1ClassDate: '2026-11-07' });
      ok(r, 201); cohort10 = r.body.cohort;
      assert.equal(cohort10.status, 'upcoming');
      assert.equal((await admin.post('/api/admin/cohorts', { number: 10, week1ClassDate: '2026-11-07' })).status, 409, 'duplicate cohort number');
    });

    it('serves the previously unmounted admin operations (adminOps) on the admin guard', async () => {
      ok(await admin.get(`/api/admin/learners-overview?cohortId=${cohort10.id}`));
      ok(await admin.get(`/api/admin/assessments?cohortId=${cohort10.id}`));
      ok(await admin.get(`/api/admin/analytics?cohortId=${cohort10.id}`));
      ok(await admin.get(`/api/admin/events?cohortId=${cohort10.id}`));
      ok(await admin.get(`/api/admin/reminders?cohortId=${cohort10.id}`));
      ok(await admin.get(`/api/admin/groups?cohortId=${cohort10.id}`));
    });
  });

  describe('registration import: preview, confirm, idempotency', () => {
    const rows = () => ([
      ['Ada Tester', 'ada.tester@example.test', 'Product Management'],
      ['Bola   Tester ', 'BOLA.TESTER@example.test', 'Project Management'],      // messy spacing and case
      ['Chidi Tester', 'chidi.tester@example.test', 'Data Analyis '],            // typo + trailing space
      ['Dayo Tester', 'dayo.tester@example.test', 'content writing'],            // case differs
      ['Efe Tester', '', 'Product Management'],                                  // no email
      ['Femi Tester', 'femi.tester@example.test', 'Product Management'],         // same email, conflicting stacks
      ['Femi Tester', 'femi.tester@example.test', 'Project Management'],
      ['Gina Tester', 'gina.tester@example.test', 'Product Management'],
      ['Gina Tester', 'gina.tester@example.test', 'Product Management'],         // exact duplicate row
      [],                                                                         // spacer row
      ['Hadi Tester', 'hadi.tester@example.test', 'Digital Marketing & SEO'],
      ['Ife Tester', 'not-an-email', 'Product Management'],
    ]);
    let batch;

    it('previews without changing any learner, and explains every row', async () => {
      h.sheetData.set(10, sheetRows(rows()));
      const r = await admin.post(`/api/admin/cohorts/${cohort10.id}/import-preview`); ok(r);
      batch = r.body;
      assert.deepEqual({ create: batch.summary.create, error: batch.summary.error, skipped: batch.summary.skipped, unchanged: batch.summary.unchanged },
        { create: 5, error: 5, skipped: 1, unchanged: 0 });
      assert.equal((await h.db.query('select count(*)::int n from learners where cohort_id = $1', [cohort10.id])).rows[0].n, 0, 'preview must not create learners');
      const by = (email) => batch.rows.find((x) => x.email === email);
      assert.match(by('chidi.tester@example.test').message, /did you mean "Data Analysis"/);
      assert.match(by('femi.tester@example.test').message, /different stacks/);
      assert.equal(by('bola.tester@example.test').fullName, 'Bola Tester', 'name spacing normalised, email lower-cased');
      assert.deepEqual(batch.summary.unmatchedStacks, [{ stack: 'Data Analyis', suggestion: 'Data Analysis' }]);
      assert.equal(batch.rows.find((x) => x.rowNumber === 11), undefined, 'blank spacer row is ignored');
    });

    it('does not apply a typo automatically; an admin alias resolves it', async () => {
      const alias = await admin.post('/api/admin/stack-aliases', { alias: 'Data Analyis', stackId: stack['Data Analysis'] }); ok(alias, 201);
      const r = await admin.post(`/api/admin/cohorts/${cohort10.id}/import-preview`); ok(r);
      batch = r.body;
      assert.equal(batch.summary.create, 6);
      assert.equal(batch.summary.unmatchedStacks.length, 0);
    });

    it('a stale preview cannot be committed once superseded', async () => {
      const old = (await admin.post(`/api/admin/cohorts/${cohort10.id}/import-preview`)).body;
      const fresh = (await admin.post(`/api/admin/cohorts/${cohort10.id}/import-preview`)).body;
      assert.equal((await admin.post(`/api/admin/import-batches/${old.batchId}/commit`, {})).status, 409);
      batch = fresh;
    });

    it('commits exactly the previewed learners, once', async () => {
      const r = await admin.post(`/api/admin/import-batches/${batch.batchId}/commit`, {}); ok(r);
      assert.equal(r.body.applied.created, 6);
      const { rows } = await h.db.query(`select l.email::text email, s.name stack, l.status from learners l join stacks s on s.id=l.stack_id where l.cohort_id=$1 order by 1`, [cohort10.id]);
      assert.deepEqual(rows.map((x) => [x.email, x.stack, x.status]), [
        ['ada.tester@example.test', 'Product Management', 'enrolled'], ['bola.tester@example.test', 'Project Management', 'enrolled'],
        ['chidi.tester@example.test', 'Data Analysis', 'enrolled'], ['dayo.tester@example.test', 'Content Writing', 'enrolled'],
        ['gina.tester@example.test', 'Product Management', 'enrolled'], ['hadi.tester@example.test', 'Digital Marketing & SEO', 'enrolled']].sort());
      assert.equal((await admin.post(`/api/admin/import-batches/${batch.batchId}/commit`, {})).status, 409, 'a batch cannot be applied twice');
    });

    it('re-importing unchanged data creates no duplicates and changes nothing', async () => {
      const r = (await admin.post(`/api/admin/cohorts/${cohort10.id}/import-preview`)).body;
      assert.equal(r.summary.create, 0); assert.equal(r.summary.update, 0); assert.equal(r.summary.unchanged, 6);
      ok(await admin.post(`/api/admin/import-batches/${r.batchId}/commit`, {}));
      assert.equal((await h.db.query('select count(*)::int n from learners where cohort_id = $1', [cohort10.id])).rows[0].n, 6);
    });

    it('never moves a learner between stacks without explicit confirmation', async () => {
      const changed = rows(); changed[0][2] = 'Project Management';
      h.sheetData.set(10, sheetRows(changed));
      const p1 = (await admin.post(`/api/admin/cohorts/${cohort10.id}/import-preview`)).body;
      assert.equal(p1.summary.update, 1); assert.equal(p1.summary.needsConfirmation, 1);
      const held = (await admin.post(`/api/admin/import-batches/${p1.batchId}/commit`, {})).body;
      assert.equal(held.applied.heldBack, 1);
      const stackOf = async () => (await h.db.query(`select s.name from learners l join stacks s on s.id=l.stack_id where l.email='ada.tester@example.test' and l.cohort_id=$1`, [cohort10.id])).rows[0].name;
      assert.equal(await stackOf(), 'Product Management', 'unconfirmed stack change must not be applied');
      const p2 = (await admin.post(`/api/admin/cohorts/${cohort10.id}/import-preview`)).body;
      assert.equal((await admin.post(`/api/admin/import-batches/${p2.batchId}/commit`, { confirmStackChanges: true })).body.applied.updated, 1);
      assert.equal(await stackOf(), 'Project Management');
      // restore for the rest of the journey
      h.sheetData.set(10, sheetRows(rows()));
      const p3 = (await admin.post(`/api/admin/cohorts/${cohort10.id}/import-preview`)).body;
      ok(await admin.post(`/api/admin/import-batches/${p3.batchId}/commit`, { confirmStackChanges: true }));
      assert.equal(await stackOf(), 'Product Management');
    });

    it('reports a missing sheet tab clearly', async () => {
      const { rows: [c11] } = await h.db.query(`insert into cohorts (number,name,week1_class_date) values (11,'Cohort 11','2027-01-02') returning id`);
      const r = await admin.post(`/api/admin/cohorts/${c11.id}/import-preview`);
      assert.equal(r.status, 404); assert.match(r.body.error, /Cohort 11 Grading/);
    });
  });

  describe('invitations: delivery, failure and recovery', () => {
    it('emails every enrolled learner an invite with no password in it, and stores only a hash', async () => {
      const r = await admin.post(`/api/admin/cohorts/${cohort10.id}/invitations/send`, {}); ok(r);
      assert.equal(r.body.sent, 6); assert.equal(r.body.failed, 0); assert.equal(r.body.remaining, 0); assert.equal(r.body.handDelivery.length, 0);
      assert.equal(h.mail.sent.length, 6);
      const m = inbox('ada.tester@example.test')[0];
      assert.match(m.text, /\/claim\?email=ada\.tester%40example\.test#code=[A-Z2-9]{10}/, 'code travels in the URL fragment');
      assert.ok(!/password\s*[:=]/i.test(m.text), 'no credentials in the email');
      const code = codeFor('ada.tester@example.test');
      const { rows: [inv] } = await h.db.query(`select code_hash, delivery_status, learner_id from invites where email='ada.tester@example.test'`);
      assert.notEqual(inv.code_hash, code); assert.equal(inv.delivery_status, 'sent'); assert.ok(inv.learner_id, 'invite is bound to the enrolment');
      assert.equal((await h.db.query(`select status from learners where email='ada.tester@example.test'`)).rows[0].status, 'invited');
    });

    it('does not re-send to people already successfully invited', async () => {
      const r = await admin.post(`/api/admin/cohorts/${cohort10.id}/invitations/send`, {}); ok(r);
      assert.equal(r.body.processed, 0); assert.equal(h.mail.sent.length, 6);
    });

    it('keeps a late registrant enrolled when the email provider is down, then recovers', async () => {
      const rows = [...h.sheetData.get(10), ['Jo Tester', 'jo.tester@example.test', 'Product Management']];
      h.sheetData.set(10, rows);
      const p = (await admin.post(`/api/admin/cohorts/${cohort10.id}/import-preview`)).body;
      ok(await admin.post(`/api/admin/import-batches/${p.batchId}/commit`, {}));
      h.mail.mode = 'fail';
      const bad = (await admin.post(`/api/admin/cohorts/${cohort10.id}/invitations/send`, {})).body;
      assert.equal(bad.failed, 1); assert.equal(bad.handDelivery.length, 1, 'admin gets a hand-delivery fallback');
      assert.match(bad.handDelivery[0].code, /^[A-Z2-9]{10}$/);
      const l = (await h.db.query(`select l.status, i.delivery_status, i.delivery_error from learners l join invites i on i.learner_id=l.id where l.email='jo.tester@example.test'`)).rows[0];
      assert.equal(l.status, 'enrolled', 'a failed send must not mark the learner as invited'); assert.equal(l.delivery_status, 'failed');
      assert.ok(!/re_test_key/.test(l.delivery_error || ''), 'provider key must never be stored');
      h.mail.mode = 'ok';
      const good = (await admin.post(`/api/admin/cohorts/${cohort10.id}/invitations/send`, {})).body;
      assert.equal(good.sent, 1);
      assert.equal((await h.db.query(`select status from learners where email='jo.tester@example.test'`)).rows[0].status, 'invited');
    });

    it('shows onboarding status and delivery to the admin', async () => {
      const r = await admin.get(`/api/admin/onboarding?cohortId=${cohort10.id}`); ok(r);
      assert.equal(r.body.counts.invited, 7); assert.equal(r.body.total, 7);
      const s = await admin.get(`/api/admin/onboarding?cohortId=${cohort10.id}&q=ada`); assert.equal(s.body.learners.length, 1);
      assert.equal(s.body.learners[0].delivery_status, 'sent');
    });
  });

  describe('account activation', () => {
    it('rejects a wrong code with a generic error and counts the failure', async () => {
      const r = await actor(h.base).post('/api/auth/claim', { email: 'ada.tester@example.test', code: 'AAAAAAAAAA', password: LP });
      assert.equal(r.status, 400); assert.equal(r.body.code, 'INVITE_INVALID');
    });

    it('activates with the emailed code, once only', async () => {
      const a = actor(h.base);
      const code = codeFor('ada.tester@example.test');
      ok(await a.post('/api/auth/claim', { email: 'ada.tester@example.test', code, password: LP }), 201);
      assert.equal((await actor(h.base).post('/api/auth/claim', { email: 'ada.tester@example.test', code, password: LP })).status, 400, 'code is single-use');
      const { rows: [l] } = await h.db.query(`select status, profile_id, activated_at from learners where email='ada.tester@example.test'`);
      assert.equal(l.status, 'activated'); assert.ok(l.profile_id && l.activated_at);
    });

    it('is safe under concurrent activation: one account, one winner', async () => {
      h.fake.hooks.createDelayMs = 25;
      const code = codeFor('bola.tester@example.test');
      const attempts = await Promise.all(Array.from({ length: 6 }, () => actor(h.base).post('/api/auth/claim', { email: 'bola.tester@example.test', code, password: LP })));
      h.fake.hooks.createDelayMs = 0;
      assert.equal(attempts.filter((r) => r.status === 201).length, 1);
      assert.equal(attempts.filter((r) => r.status === 400).length, 5);
      assert.equal((await h.db.query(`select count(*)::int n from profiles where email='bola.tester@example.test'`)).rows[0].n, 1);
      assert.equal([...h.fake.users.values()].filter((u) => u.email === 'bola.tester@example.test').length, 1, 'exactly one auth identity');
    });

    it('leaves the invite usable if account creation fails, then succeeds on retry', async () => {
      const code = codeFor('chidi.tester@example.test');
      h.fake.hooks.failCreateOnce = true;
      const fail = await actor(h.base).post('/api/auth/claim', { email: 'chidi.tester@example.test', code, password: LP });
      assert.equal(fail.status, 400); assert.equal(fail.body.code, 'CLAIM_FAILED');
      assert.equal((await h.db.query(`select count(*)::int n from profiles where email='chidi.tester@example.test'`)).rows[0].n, 0);
      assert.ok((await h.db.query(`select 1 from audit_log where action = 'auth.claim_failed'`)).rowCount >= 1, 'failure is audited');
      ok(await actor(h.base).post('/api/auth/claim', { email: 'chidi.tester@example.test', code, password: LP }), 201);
    });

    it('recovers an interrupted activation (auth identity exists, profile does not)', async () => {
      await h.fake.addAuthOnly('gina.tester@example.test', 'old-forgotten-pass');
      const code = codeFor('gina.tester@example.test');
      ok(await actor(h.base).post('/api/auth/claim', { email: 'gina.tester@example.test', code, password: LP }), 201);
      assert.equal((await h.db.query(`select count(*)::int n from profiles where email='gina.tester@example.test'`)).rows[0].n, 1);
      assert.equal([...h.fake.users.values()].filter((u) => u.email === 'gina.tester@example.test').length, 1, 'no duplicate identity');
      const g = actor(h.base); await h.db.query(`update cohorts set status='active', is_active=true where id=$1`, [cohort10.id]);
      ok(await g.post('/api/auth/learner/login', { email: 'gina.tester@example.test', password: LP }));
      await h.db.query(`update cohorts set status='upcoming', is_active=false where id=$1`, [cohort10.id]);
    });

    it('offers a recovery path for an expired invite without revealing who is enrolled', async () => {
      await h.db.query(`update invites set expires_at = now() - interval '1 hour' where email = 'dayo.tester@example.test'`);
      const stale = codeFor('dayo.tester@example.test');
      const expired = await actor(h.base).post('/api/auth/claim', { email: 'dayo.tester@example.test', code: stale, password: LP });
      assert.equal(expired.status, 400); assert.equal(expired.body.code, 'INVITE_INVALID');

      const before = h.mail.sent.length;
      const known = await actor(h.base).post('/api/auth/request-invite', { email: 'dayo.tester@example.test' });
      const unknown = await actor(h.base).post('/api/auth/request-invite', { email: 'nobody@example.test' });
      assert.equal(known.status, 202); assert.equal(unknown.status, 202);
      assert.deepEqual(known.body, unknown.body, 'identical response for enrolled and unknown emails');
      assert.equal(h.mail.sent.length, before + 1, 'only the enrolled address receives a new invite');
      assert.equal(h.mail.sent.at(-1).to, 'dayo.tester@example.test');
      ok(await actor(h.base).post('/api/auth/claim', { email: 'dayo.tester@example.test', code: codeFor('dayo.tester@example.test'), password: LP }), 201);
    });

    it('rate-limits invitation requests', async () => {
      const a = actor(h.base); const email = 'ratelimit@example.test';
      for (let i = 0; i < 3; i++) assert.equal((await a.post('/api/auth/request-invite', { email })).status, 202);
      const limited = await a.post('/api/auth/request-invite', { email });
      assert.equal(limited.status, 429); assert.ok(limited.headers.get('retry-after'));
    });

    it('refuses an invite whose enrolment was withdrawn after issue', async () => {
      const { rows: [l] } = await h.db.query(`select id from learners where email='hadi.tester@example.test'`);
      const code = codeFor('hadi.tester@example.test');
      ok(await admin.patch(`/api/admin/learners/${l.id}/status`, { action: 'withdraw', reason: 'Requested deferral' }));
      assert.equal((await actor(h.base).post('/api/auth/claim', { email: 'hadi.tester@example.test', code, password: LP })).status, 400);
      ok(await admin.patch(`/api/admin/learners/${l.id}/status`, { action: 'reinstate', reason: 'Back on the programme' }));
      assert.equal((await h.db.query('select status from learners where id=$1', [l.id])).rows[0].status, 'enrolled');
    });
  });

  describe('multiple cohorts at once', () => {
    it('blocks learners of a cohort that is not active yet', async () => {
      const r = await actor(h.base).post('/api/auth/learner/login', { email: 'ada.tester@example.test', password: LP });
      assert.equal(r.status, 403); assert.match(r.body.error, /not currently active/);
    });

    it('activating Cohort 10 leaves Cohort 9 active and both groups can sign in', async () => {
      const r = await admin.post(`/api/admin/cohorts/${cohort10.id}/status`, { status: 'active' }); ok(r);
      assert.equal((await h.db.query('select count(*)::int n from cohorts where is_active')).rows[0].n, 2);
      assert.equal((await h.db.query(`select status from cohorts where number = 9`)).rows[0].status, 'active');
      ok(await actor(h.base).post('/api/auth/learner/login', { email: 'learner9@example.test', password: LP }));
      ok(await actor(h.base).post('/api/auth/learner/login', { email: 'ada.tester@example.test', password: LP }));
    });

    it('closes access to a completed or archived cohort without deleting its data', async () => {
      const { rows: [c8] } = await h.db.query(`insert into cohorts (number,name,week1_class_date,status,is_active) values (8,'Cohort 8','2026-05-02','active',true) returning id`);
      const { rows: [s] } = await h.db.query('select id from stacks limit 1');
      const u = await h.fake.addUser('old.learner@example.test', LP);
      await h.db.query(`insert into profiles (id,email,full_name,role) values ($1,'old.learner@example.test','Old Learner','learner')`, [u.id]);
      await h.db.query(`insert into learners (cohort_id,stack_id,full_name,email,profile_id,status) values ($1,$2,'Old Learner','old.learner@example.test',$3,'active')`, [c8.id, s.id, u.id]);
      ok(await actor(h.base).post('/api/auth/learner/login', { email: 'old.learner@example.test', password: LP }));
      ok(await admin.post(`/api/admin/cohorts/${c8.id}/status`, { status: 'completed' }));
      assert.equal((await actor(h.base).post('/api/auth/learner/login', { email: 'old.learner@example.test', password: LP })).status, 403);
      ok(await admin.post(`/api/admin/cohorts/${c8.id}/status`, { status: 'archived' }));
      const hist = await admin.get(`/api/admin/learners-overview?cohortId=${c8.id}`); ok(hist);
      assert.equal(hist.body.learners.length, 1, 'history stays queryable by admins');
      assert.equal((await admin.post(`/api/admin/cohorts/${c8.id}/status`, { status: 'active' })).status, 409, 'archived cohorts need restoring first');
      assert.equal((await admin.post(`/api/admin/cohorts/${c8.id}/import-preview`)).status, 409);
      assert.equal((await h.db.query('select count(*)::int n from learners where cohort_id=$1', [c8.id])).rows[0].n, 1);
    });
  });

  describe('learner experience', () => {
    let ada; let w1;
    before(async () => {
      ada = actor(h.base);
      ok(await ada.post('/api/auth/learner/login', { email: 'ada.tester@example.test', password: LP }));
      await h.db.query(`update assessments set opens_at = now() - interval '1 day', due_at = now() + interval '3 day' where cohort_id=$1 and week_number=1`, [cohort10.id]);
    });

    it('shows the correct cohort, stack and a required orientation checklist', async () => {
      const r = await ada.get('/api/learner/overview'); ok(r);
      assert.equal(r.body.cohort.number, 10); assert.equal(r.body.stack, 'Product Management'); assert.equal(r.body.learner.name, 'Ada Tester');
      assert.equal(r.body.orientation.required, true); assert.equal(r.body.orientation.total, 4); assert.equal(r.body.orientation.completed, 0);
      assert.equal(r.body.assessments.length, 5);
      w1 = r.body.assessments.find((a) => a.weekNumber === 1);
    });

    it('never shows a missing grade as zero', async () => {
      const r = await ada.get('/api/learner/overview');
      assert.ok(r.body.assessments.every((a) => a.score === null && a.feedback === null));
      h.sheetData.set(10, h.sheetData.get(10)); // rows exist but carry no scores
      const d = await ada.get('/api/learner/dashboard'); ok(d);
      assert.equal(d.body.hasScores, false); assert.equal(d.body.totals.total, null); assert.equal(d.body.totals.grade, null);
      assert.equal(d.body.attendance.class1, null); assert.equal(d.body.finalGrade, ''); assert.equal(d.body.qualifiedForCapstone, null);
    });

    it('treats blank, N/A and numeric sheet cells differently', async () => {
      const rows = h.sheetData.get(10).map((r) => (r[1] === 'ada.tester@example.test' ? [...r.slice(0, 3), '5', 'N/A', '', '5', ...Array(6).fill(''), 'FAIL', 'NOT QUALIFIED'].slice(0, 20) : r));
      h.sheetData.set(10, rows);
      const d = (await ada.get('/api/learner/dashboard')).body;
      assert.equal(d.attendance.class1, 5); assert.equal(d.attendance.class2, null, 'N/A is not zero'); assert.equal(d.attendance.class3, null); assert.equal(d.attendance.class4, 5);
      assert.equal(d.hasScores, true); assert.equal(d.totals.attendance, 10);
    });

    it('moves through orientation to active, idempotently', async () => {
      const keys = (await ada.get('/api/learner/orientation')).body.items.map((i) => i.key);
      assert.equal((await ada.post('/api/learner/orientation/not_a_step')).status, 400);
      let r = (await ada.post(`/api/learner/orientation/${keys[0]}`)).body; assert.equal(r.status, 'orientation'); assert.equal(r.completed, 1);
      r = (await ada.post(`/api/learner/orientation/${keys[0]}`)).body; assert.equal(r.completed, 1, 'repeat is a no-op');
      for (const k of keys.slice(1)) r = (await ada.post(`/api/learner/orientation/${k}`)).body;
      assert.equal(r.status, 'active'); assert.equal(r.completed, 4);
      assert.equal((await ada.get('/api/learner/overview')).body.orientation.required, false);
    });

    it('accepts a submission once per assessment, and rejects links that are not Google Docs/Drive', async () => {
      assert.equal((await ada.put(`/api/learner/assessments/${w1.id}/submission`, { url: 'https://evil.test/x' })).status, 400);
      ok(await ada.put(`/api/learner/assessments/${w1.id}/submission`, { url: 'https://docs.google.com/document/d/adadoc0001abc' }));
      ok(await ada.put(`/api/learner/assessments/${w1.id}/submission`, { url: 'https://docs.google.com/document/d/adadoc0002abc' }));
      assert.equal((await h.db.query(`select count(*)::int n from submissions s join learners l on l.id=s.learner_id where l.email='ada.tester@example.test'`)).rows[0].n, 1, 'resubmitting updates, never duplicates');
    });

    it("cannot reach another cohort's assessment or another learner's records (IDOR)", async () => {
      assert.equal((await ada.put(`/api/learner/assessments/${c9.assessmentId}/submission`, { url: 'https://docs.google.com/document/d/adadoc0003abc' })).status, 404);
      const r = await ada.get(`/api/admin/learners-overview?cohortId=${c9.id}`); assert.equal(r.status, 403);
      const ov = (await ada.get('/api/learner/overview?learnerId=anything&cohortId=' + c9.id)).body;
      assert.equal(ov.cohort.number, 10, 'client-supplied ids never select the cohort');
      assert.ok(!JSON.stringify(ov).includes('learner9@example.test'));
    });
  });

  describe('facilitator: scope, grading, publishing', () => {
    let fac; let w1id; let adaSub; let bolaSub;
    before(async () => {
      const inv = await admin.post('/api/admin/facilitator-invites', { email: FAC.email, fullName: 'Fran Facilitator', cohortId: cohort10.id, stackId: stack['Product Management'] }); ok(inv, 201);
      ok(await actor(h.base).post('/api/auth/claim', { email: FAC.email, code: inv.body.code, password: FAC.pw }), 201);
      fac = actor(h.base);
      ok(await fac.post('/api/auth/facilitator/login', { email: FAC.email, password: FAC.pw }));
      w1id = (await h.db.query(`select id from assessments where cohort_id=$1 and week_number=1`, [cohort10.id])).rows[0].id;
      // Bola (Project Management) also submits, so there is a submission OUTSIDE the facilitator's stack.
      const bola = actor(h.base); ok(await bola.post('/api/auth/learner/login', { email: 'bola.tester@example.test', password: LP }));
      ok(await bola.put(`/api/learner/assessments/${w1id}/submission`, { url: 'https://docs.google.com/document/d/boladoc0001a' }));
      adaSub = (await h.db.query(`select s.id from submissions s join learners l on l.id=s.learner_id where l.email='ada.tester@example.test'`)).rows[0].id;
      bolaSub = (await h.db.query(`select s.id from submissions s join learners l on l.id=s.learner_id where l.email='bola.tester@example.test'`)).rows[0].id;
    });

    it('lists only learners in the facilitator\'s own stack', async () => {
      const r = await fac.get('/api/facilitator/learners'); ok(r);
      assert.deepEqual(r.body.learners.map((l) => l.name).sort(), ['Ada Tester', 'Gina Tester', 'Jo Tester']);
      assert.ok(r.body.learners.every((l) => l.stack === 'Product Management'));
    });

    it('cannot see or grade anything outside the assignment, even by guessing ids or parameters', async () => {
      const sub = await fac.get(`/api/facilitator/submissions?assessmentId=${w1id}`); ok(sub);
      assert.ok(!sub.body.submissions.some((s) => s.name === 'Bola Tester'), 'other stack is invisible');
      assert.equal((await fac.get(`/api/facilitator/submissions?assessmentId=${w1id}&stackId=${stack['Project Management']}`)).body.submissions.length, 0);
      assert.equal((await fac.put(`/api/facilitator/submissions/${bolaSub}/grade`, { score: 3 })).status, 404, 'other stack grade -> 404');
      assert.equal((await fac.put(`/api/facilitator/submissions/${bolaSub}/grade`, { score: 3, learnerId: 'x', stackId: stack['Project Management'] })).status, 404, 'body parameters cannot widen scope');
      assert.equal((await fac.get(`/api/facilitator/learners?cohortId=${c9.id}`)).status, 404, 'unassigned cohort -> 404');
      assert.equal((await fac.put(`/api/facilitator/submissions/${adaSub}/grade`, { score: 3 })).status, 200);
      const none = (await h.db.query(`select count(*)::int n from grades where submission_id=$1`, [bolaSub])).rows[0].n; assert.equal(none, 0);
    });

    it('validates scores against the assessment maximum', async () => {
      assert.equal((await fac.put(`/api/facilitator/submissions/${adaSub}/grade`, { score: 99 })).status, 400);
      assert.equal((await fac.put(`/api/facilitator/submissions/${adaSub}/grade`, { score: -1 })).status, 400);
      assert.equal((await fac.put(`/api/facilitator/submissions/${adaSub}/grade`, { score: 'five' })).status, 400);
    });

    it('keeps a saved grade hidden from the learner until it is published', async () => {
      ok(await fac.put(`/api/facilitator/submissions/${adaSub}/grade`, { score: 4, feedback: 'Good structure, tighten the intro.' }));
      const ada = actor(h.base); ok(await ada.post('/api/auth/learner/login', { email: 'ada.tester@example.test', password: LP }));
      const a = (await ada.get('/api/learner/overview')).body.assessments.find((x) => x.weekNumber === 1);
      assert.equal(a.score, null); assert.equal(a.feedback, null); assert.equal(a.gradeState, 'awaiting_grade', 'a draft is not even hinted at');
      assert.equal((await ada.get('/api/learner/dashboard')).body.assessments.w1, null, 'a draft never reaches the grade page');
    });

    it('shows score and feedback once published, and the grade page follows', async () => {
      ok(await fac.put(`/api/facilitator/submissions/${adaSub}/grade`, { score: 4, feedback: 'Good structure, tighten the intro.', publish: true }));
      const ada = actor(h.base); ok(await ada.post('/api/auth/learner/login', { email: 'ada.tester@example.test', password: LP }));
      const a = (await ada.get('/api/learner/overview')).body.assessments.find((x) => x.weekNumber === 1);
      assert.equal(a.score, 4); assert.match(a.feedback, /tighten the intro/); assert.equal(a.status, 'graded'); assert.equal(a.gradeState, 'published');
      const d = (await ada.get('/api/learner/dashboard')).body;
      assert.equal(d.assessments.w1, 4); assert.equal(d.hasScores, true);
      assert.equal((await ada.put(`/api/learner/assessments/${w1id}/submission`, { url: 'https://docs.google.com/document/d/adadoc0009abc' })).status, 403, 'graded work is locked');
    });

    it('records corrections as revisions and audits every grade change', async () => {
      ok(await fac.put(`/api/facilitator/submissions/${adaSub}/grade`, { score: 3.5, feedback: 'Corrected after moderation.', publish: true }));
      const { rows } = await h.db.query(`select r.score::text, r.published from grade_revisions r join grades g on g.id=r.grade_id where g.submission_id=$1 order by r.id`, [adaSub]);
      assert.ok(rows.length >= 4, 'every save is kept'); assert.equal(rows.at(-1).score, '3.50');
      const audit = await h.db.query(`select count(*)::int n from audit_log where action = 'grade.save' and entity_id = $1`, [adaSub]);
      assert.ok(audit.rows[0].n >= 4);
    });

    it('bulk-publishes saved drafts for the facilitator\'s own stack only', async () => {
      const gina = actor(h.base); ok(await gina.post('/api/auth/learner/login', { email: 'gina.tester@example.test', password: LP }));
      ok(await gina.put(`/api/learner/assessments/${w1id}/submission`, { url: 'https://docs.google.com/document/d/ginadoc001abc' }));
      const ginaSub = (await h.db.query(`select s.id from submissions s join learners l on l.id=s.learner_id where l.email='gina.tester@example.test'`)).rows[0].id;
      ok(await fac.put(`/api/facilitator/submissions/${ginaSub}/grade`, { score: 2 }));
      // a draft outside the facilitator's stack (written directly, as an admin could) must not be published by them
      const admin1 = (await h.db.query(`select id from profiles where email=$1`, [ADMIN.email])).rows[0].id;
      await h.db.query(`insert into grades (submission_id, score, graded_by) values ($1, 1, $2)`, [bolaSub, admin1]);
      const r = await fac.post(`/api/facilitator/assessments/${w1id}/publish`, {}); ok(r);
      assert.equal(r.body.published, 1);
      assert.equal((await h.db.query('select published_at from grades where submission_id=$1', [bolaSub])).rows[0].published_at, null);
      assert.ok((await h.db.query('select published_at from grades where submission_id=$1', [ginaSub])).rows[0].published_at);
    });

    it('is not an admin: staff areas stay separate', async () => {
      assert.equal((await fac.get('/api/admin/cohorts')).status, 403);
      assert.equal((await fac.post(`/api/admin/cohorts/${cohort10.id}/status`, { status: 'completed' })).status, 403);
    });
  });

  describe('admin oversight', () => {
    it('shows updated progress and an activity trail', async () => {
      const r = await admin.get(`/api/admin/learners-overview?cohortId=${cohort10.id}&q=ada`); ok(r);
      assert.equal(r.body.total, 1);
      assert.ok(r.body.learners[0].weekStatuses.some((w) => w.status === 'graded'));
      const detail = await admin.get(`/api/admin/learners/${r.body.learners[0].id}`); ok(detail);
      assert.equal(detail.body.enrolment.status, 'active'); assert.equal(detail.body.enrolment.hasAccount, true);
      ok(await admin.get(`/api/admin/analytics?cohortId=${cohort10.id}`));
      const log = await admin.get('/api/admin/audit-log?action=grade.'); ok(log);
      assert.ok(log.body.entries.length >= 4); assert.ok(log.body.entries.every((e) => e.action.startsWith('grade.')));
      const actions = new Set((await admin.get('/api/admin/audit-log?pageSize=100')).body.entries.map((e) => e.action));
      for (const a of ['cohort.create', 'cohort.status', 'cohort.import_commit', 'invite.issue', 'auth.claim']) assert.ok(actions.has(a), `missing audit: ${a}`);
    });

    it('manages facilitator assignments', async () => {
      const list = await admin.get('/api/admin/facilitators'); ok(list);
      const f = list.body.facilitators.find((x) => x.email === FAC.email);
      assert.equal(f.assignments.length, 1);
      const add = await admin.post(`/api/admin/facilitators/${f.id}/assignments`, { cohortId: cohort10.id, stackId: stack['Content Writing'] }); ok(add, 201);
      assert.equal((await admin.post(`/api/admin/facilitators/${f.id}/assignments`, { cohortId: cohort10.id, stackId: stack['Content Writing'] })).body.created, false, 'assigning twice is harmless');
      const fac2 = actor(h.base); ok(await fac2.post('/api/auth/facilitator/login', { email: FAC.email, password: FAC.pw }));
      assert.ok((await fac2.get('/api/facilitator/learners')).body.learners.some((l) => l.name === 'Dayo Tester'), 'new assignment takes effect immediately');
      const fresh = (await admin.get('/api/admin/facilitators')).body.facilitators.find((x) => x.email === FAC.email);
      ok(await admin.del(`/api/admin/facilitator-assignments/${fresh.assignments.find((a) => a.stack === 'Content Writing').id}`));
      assert.ok(!(await fac2.get('/api/facilitator/learners')).body.learners.some((l) => l.name === 'Dayo Tester'), 'removal takes effect immediately');
    });

    it('publishes announcements to the right learners', async () => {
      ok(await admin.post(`/api/admin/announcements?cohortId=${cohort10.id}`, { title: 'Welcome to Cohort 10', body: 'Orientation call on Saturday.' }), 201);
      ok(await admin.post(`/api/admin/announcements?cohortId=${cohort10.id}`, { title: 'PM only', body: 'Bring your case study.', stackId: stack['Product Management'] }), 201);
      const ada = actor(h.base); ok(await ada.post('/api/auth/learner/login', { email: 'ada.tester@example.test', password: LP }));
      const bola = actor(h.base); ok(await bola.post('/api/auth/learner/login', { email: 'bola.tester@example.test', password: LP }));
      assert.deepEqual((await ada.get('/api/learner/overview')).body.announcements.map((a) => a.title).sort(), ['PM only', 'Welcome to Cohort 10']);
      assert.deepEqual((await bola.get('/api/learner/overview')).body.announcements.map((a) => a.title), ['Welcome to Cohort 10']);
    });
  });

  describe('password recovery', () => {
    it('answers identically for known and unknown emails and only mails real accounts', async () => {
      const a = actor(h.base);
      const known = await a.post('/api/auth/forgot-password', { email: 'learner9@example.test' });
      const unknown = await a.post('/api/auth/forgot-password', { email: 'ghost@example.test' });
      assert.equal(known.status, 202); assert.deepEqual(known.body, unknown.body);
      assert.deepEqual(h.fake.sentResets.map((r) => r.email), ['learner9@example.test']);
      assert.equal(h.fake.sentResets[0].redirectTo, 'https://app.test/reset-password');
    });

    it('resets with a valid recovery token and rejects bad ones', async () => {
      const a = actor(h.base);
      assert.equal((await a.post('/api/auth/reset-password', { accessToken: 'x'.repeat(30), newPassword: 'Brand-New-Pass-99' })).status, 400);
      ok(await a.post('/api/auth/reset-password', { accessToken: h.fake.recoveryToken('learner9@example.test'), newPassword: 'Brand-New-Pass-99' }));
      assert.equal((await actor(h.base).post('/api/auth/learner/login', { email: 'learner9@example.test', password: LP })).status, 401, 'old password stops working');
      ok(await actor(h.base).post('/api/auth/learner/login', { email: 'learner9@example.test', password: 'Brand-New-Pass-99' }));
    });
  });

  describe('Cohort 9 canary', () => {
    it('is exactly as it was before any of the above ran', async () => {
      const after = await c9.snap();
      assert.ok(after.learners.length === 1 && after.grades.length === 1 && after.submissions.length === 1, 'canary data present');
      assert.deepEqual(after, before9);
    });
  });
});
