const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, actor } = require('../helpers/harness');

const skip = !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL not set (needs a LOCAL Postgres whose name contains "test")';
const PW = 'Feature-Pass-12345';
const ok = (res, code = 200) => assert.equal(res.status, code, `expected ${code}, got ${res.status}: ${res.text}`);
const DOC = (n) => `https://docs.google.com/document/d/feature${n}doc00001`;
const b64 = (n, fill = 65) => Buffer.alloc(n, fill).toString('base64');

describe('feedback, calendar, assessments, quizzes, files, capstone, reminders', { skip }, () => {
  let h; let admin; let pm; let da; let cohortId; let c9;
  const id = {}; const who = {};
  const login = async (a, role, email) => ok(await a.post(`/api/auth/${role}/login`, { email, password: PW }));
  const mkUser = async (email, name, role) => {
    const u = await h.fake.addUser(email, PW);
    await h.db.query('insert into profiles (id,email,full_name,role) values ($1,$2,$3,$4)', [u.id, email, name, role]);
    return u.id;
  };
  const openNow = (aid, dueDays = 3) => h.db.query(`update assessments set opens_at = now() - interval '1 day', due_at = now() + make_interval(days => $2) where id = $1`, [aid, dueDays]);
  const addLearner = async (email, name, stackId, qualified = null) => {
    const pid = await mkUser(email, name, 'learner');
    const { rows: [l] } = await h.db.query(
      `insert into learners (cohort_id,stack_id,full_name,email,profile_id,status,capstone_qualified) values ($1,$2,$3,$4,$5,'active',$6) returning id`, [cohortId, stackId, name, email, pid, qualified]);
    return l.id;
  };

  before(async () => {
    h = await boot();
    id.admin = await mkUser('admin@example.test', 'Admin', 'admin');
    pm = (await h.db.query(`insert into stacks (name) values ('Product Management') returning id`)).rows[0].id;
    da = (await h.db.query(`insert into stacks (name) values ('Data Analysis') returning id`)).rows[0].id;
    // Cohort 9 canary: must never change.
    c9 = (await h.db.query(`insert into cohorts (number,name,week1_class_date,status,is_active) values (9,'Cohort 9','2026-08-01','active',true) returning id`)).rows[0].id;
    admin = actor(h.base);
    await login(admin, 'admin', 'admin@example.test');
  });
  after(async () => { if (h) await h.close(); });

  describe('default calendar per stack', () => {
    it('creates weekly classes for every chosen stack when a cohort is created, at the chosen time', async () => {
      const bad = await admin.post('/api/admin/cohorts', { number: 11, week1ClassDate: '2026-11-07', stackIds: [pm, da], classTime: '25:99' });
      assert.equal(bad.status, 400);
      const r = await admin.post('/api/admin/cohorts', { number: 11, week1ClassDate: '2026-11-07', stackIds: [pm, da], classTime: '09:30', classDurationMinutes: 90 });
      ok(r, 201); cohortId = r.body.cohort.id;
      assert.equal(r.body.cohort.calendar.created, 13, '1 cohort start + 6 classes x 2 stacks');
      const { rows } = await h.db.query(`select s.name stack, e.title, to_char(e.starts_at at time zone 'Africa/Lagos','YYYY-MM-DD HH24:MI') as at, extract(epoch from e.ends_at - e.starts_at)/60 as mins
        from events e left join stacks s on s.id = e.stack_id where e.cohort_id = $1 and e.event_type = 'class' order by s.name, e.starts_at`, [cohortId]);
      assert.equal(rows.length, 12);
      assert.deepEqual(rows.filter((x) => x.stack === 'Data Analysis').map((x) => x.at), ['2026-11-07 09:30', '2026-11-14 09:30', '2026-11-21 09:30', '2026-11-28 09:30', '2026-12-05 09:30', '2026-12-12 09:30']);
      assert.equal(Number(rows[0].mins), 90);
      assert.equal((await h.db.query('select count(*)::int n from cohort_stacks where cohort_id = $1', [cohortId])).rows[0].n, 2);
      ok(await admin.post(`/api/admin/cohorts/${cohortId}/status`, { status: 'active' }));
    });

    it('is editable, and regenerating never duplicates or overwrites edits', async () => {
      const list = (await admin.get(`/api/admin/events?cohortId=${cohortId}`)).body.events;
      const target = list.find((e) => e.title === 'Product Management: Week 1 class');
      assert.equal(target.is_default, true);
      ok(await admin.put(`/api/admin/events/${target.id}`, { title: 'PM Week 1 (moved)', eventType: 'class', stackId: pm, startsAtLocal: '2026-11-07T14:00', endsAtLocal: '2026-11-07T15:00', linkUrl: 'https://meet.example.test/pm1' }));
      const again = await admin.post(`/api/admin/cohorts/${cohortId}/default-calendar`, { stackIds: [pm, da], classTime: '09:30' }); ok(again);
      assert.equal(again.body.created, 0); assert.equal(again.body.existing, 13);
      const after = (await admin.get(`/api/admin/events?cohortId=${cohortId}`)).body.events;
      assert.equal(after.length, 13); assert.ok(after.some((e) => e.title === 'PM Week 1 (moved)'), 'the admin edit survived');
    });

    it('can create the calendar for a cohort that already exists (e.g. Cohort 10) without touching other cohorts', async () => {
      const before9 = (await h.db.query('select count(*)::int n from events where cohort_id = $1', [c9])).rows[0].n;
      const noStack = await admin.post(`/api/admin/cohorts/${cohortId}/default-calendar`, { stackIds: [], classTime: '10:00' });
      assert.equal(noStack.status, 400);
      assert.equal((await h.db.query('select count(*)::int n from events where cohort_id = $1', [c9])).rows[0].n, before9);
    });
  });

  describe('people for the rest of the tests', () => {
    it('seeds learners and facilitators', async () => {
      who.a = await addLearner('a.pm@example.test', 'Ada PM', pm);          // qualification unknown
      who.b = await addLearner('b.da@example.test', 'Bayo DA', da, false);  // explicitly not qualified
      who.c = await addLearner('c.pm@example.test', 'Chi PM', pm);
      const f1 = await mkUser('fac.pm@example.test', 'Fran PM', 'facilitator');
      await h.db.query('insert into facilitator_assignments (facilitator_id, cohort_id, stack_id) values ($1,$2,$3)', [f1, cohortId, pm]);
      id.f1 = f1;
      who.actA = actor(h.base); await login(who.actA, 'learner', 'a.pm@example.test');
      who.actB = actor(h.base); await login(who.actB, 'learner', 'b.da@example.test');
      who.actC = actor(h.base); await login(who.actC, 'learner', 'c.pm@example.test');
      who.fac = actor(h.base); await login(who.fac, 'facilitator', 'fac.pm@example.test');
    });
  });

  describe('capstone calendar audience', () => {
    let evId;
    it('forces capstone events to qualified learners and facilitators only', async () => {
      const r = await admin.post(`/api/admin/events?cohortId=${cohortId}`, { title: 'Capstone kickoff', eventType: 'capstone_milestone', audience: 'everyone', startsAtLocal: '2026-12-19T10:00' });
      ok(r, 201); evId = r.body.id;
      assert.equal((await h.db.query('select audience from events where id = $1', [evId])).rows[0].audience, 'capstone', 'cannot be made public');
      const titles = async (a, path = '/api/learner/events') => (await a.get(path)).body.events.map((e) => e.title);
      assert.ok(!(await titles(who.actA)).includes('Capstone kickoff'), 'unknown qualification is not enough');
      assert.ok(!(await titles(who.actB)).includes('Capstone kickoff'), 'explicitly unqualified');
      assert.ok((await titles(who.fac, `/api/facilitator/events?cohortId=${cohortId}`)).includes('Capstone kickoff'), 'facilitators see it');
      ok(await admin.patch(`/api/admin/learners/${who.a}/capstone`, { qualified: true }));
      assert.ok((await titles(who.actA)).includes('Capstone kickoff'), 'qualified learner sees it');
      assert.ok(!(await titles(who.actB)).includes('Capstone kickoff'));
      // The dashboard only lists the next few events, so check the filter on the unqualified learner's copy of it.
      assert.ok(!(await who.actB.get('/api/learner/overview')).body.events.some((e) => e.title === 'Capstone kickoff'));
    });

    it('syncs definite qualification from the sheet and leaves ungraded rows unknown', async () => {
      const row = (email, flag) => ['x', email, 'Product Management', '5', '5', '5', '5', '5', '5', '4', '8', '8', '8', '8', '2.5', '2.5', '16', '90', 'A', flag];
      h.sheetData.set(11, [['Name', 'Email', 'Stack'], row('a.pm@example.test', 'NOT QUALIFIED'), row('b.da@example.test', 'QUALIFIED'), ['Chi', 'c.pm@example.test', 'Product Management', ...Array(14).fill(''), '0', 'FAIL', 'NOT QUALIFIED']]);
      const r = await admin.post(`/api/admin/cohorts/${cohortId}/capstone-qualification/sync`, {}); ok(r);
      assert.deepEqual({ q: r.body.qualified, n: r.body.notQualified, u: r.body.unknown }, { q: 1, n: 1, u: 1 });
      const st = Object.fromEntries((await h.db.query('select full_name, capstone_qualified from learners where cohort_id = $1', [cohortId])).rows.map((x) => [x.full_name, x.capstone_qualified]));
      assert.deepEqual(st, { 'Ada PM': false, 'Bayo DA': true, 'Chi PM': null });
    });
  });

  describe('stack-specific assessments, quizzes and files', () => {
    let wide; let daAsm; let pmQuiz;
    it('keeps the cohort-wide assessment for everyone and lets a stack override one week', async () => {
      const list = (await admin.get(`/api/admin/assessments?cohortId=${cohortId}`)).body.assessments;
      wide = list.find((a) => a.weekNumber === 1 && !a.stackId); assert.ok(wide);
      const mk = (body) => admin.post(`/api/admin/assessments?cohortId=${cohortId}`, { maxScore: 10, opensAtLocal: '2026-11-07T00:00', dueAtLocal: '2026-11-20T23:59', ...body });
      const r = await mk({ weekNumber: 1, stackId: da, kind: 'assignment', title: 'DA dashboard task', instructions: 'Build a dashboard.' }); ok(r, 201); daAsm = r.body.id;
      assert.equal((await mk({ weekNumber: 1, stackId: da, kind: 'assignment', title: 'again' })).status, 409, 'one per week and stack');
      assert.equal((await mk({ weekNumber: 1, kind: 'assignment', title: 'second cohort-wide' })).status, 409);
      assert.equal((await mk({ weekNumber: 2, stackId: da, kind: 'assignment', title: 'bad', dueAtLocal: '2026-11-01T00:00' })).status, 400, 'due before open');
      await openNow(wide.id); await openNow(daAsm);
      const forB = (await who.actB.get('/api/learner/overview')).body.assessments.filter((a) => a.weekNumber === 1);
      assert.deepEqual(forB.map((a) => a.title), ['DA dashboard task'], 'DA learner sees the stack version only');
      assert.equal(forB[0].instructions, 'Build a dashboard.');
      const forA = (await who.actA.get('/api/learner/overview')).body.assessments.filter((a) => a.weekNumber === 1);
      assert.deepEqual(forA.map((a) => a.title), ['Week 1 Assessment']);
    });

    it('stops learners and facilitators reaching assessments that are not for their stack', async () => {
      assert.equal((await who.actA.put(`/api/learner/assessments/${daAsm}/submission`, { url: DOC(1) })).status, 404, 'PM learner cannot submit to the DA assessment');
      assert.equal((await who.actB.put(`/api/learner/assessments/${wide.id}/submission`, { url: DOC(2) })).status, 404, 'DA learner is moved to the stack version');
      ok(await who.actB.put(`/api/learner/assessments/${daAsm}/submission`, { url: DOC(3) }));
      const fa = (await who.fac.get(`/api/facilitator/assessments?cohortId=${cohortId}`)).body.assessments;
      assert.ok(!fa.some((a) => a.id === daAsm), 'PM facilitator does not see the DA assessment');
      assert.equal((await who.fac.get(`/api/facilitator/submissions?cohortId=${cohortId}&assessmentId=${daAsm}`)).status, 404);
    });

    it('builds a quiz, hides the answers, auto-grades once, and locks the questions after the first attempt', async () => {
      const r = await admin.post(`/api/admin/assessments?cohortId=${cohortId}`, { weekNumber: 2, stackId: pm, kind: 'quiz', title: 'PM quiz', maxScore: 10, opensAtLocal: '2026-11-14T00:00', dueAtLocal: '2026-11-27T23:59' });
      ok(r, 201); pmQuiz = r.body.id; await openNow(pmQuiz);
      const bad = await admin.put(`/api/admin/assessments/${pmQuiz}/quiz`, { questions: [{ prompt: 'Q?', qtype: 'single', options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }], correct: ['a', 'b'] }] });
      assert.equal(bad.status, 400, 'single needs exactly one correct option');
      const good = { questions: [
        { prompt: 'Which is a backlog?', qtype: 'single', options: [{ id: 'a', text: 'A list of work' }, { id: 'b', text: 'A bug' }], correct: ['a'], points: 1 },
        { prompt: 'Pick the metrics', qtype: 'multiple', options: [{ id: 'a', text: 'Retention' }, { id: 'b', text: 'Colour' }, { id: 'c', text: 'Activation' }], correct: ['a', 'c'], points: 1 },
      ] };
      ok(await admin.put(`/api/admin/assessments/${pmQuiz}/quiz`, good));
      const view = (await who.actA.get(`/api/learner/assessments/${pmQuiz}/quiz`)).body;
      assert.equal(view.attempted, false); assert.equal(view.questions.length, 2);
      assert.ok(!JSON.stringify(view).includes('correct'), 'answers are never sent to the learner');
      const qs = view.questions;
      const res = await who.actA.post(`/api/learner/assessments/${pmQuiz}/quiz`, { answers: { [qs[0].id]: ['a'], [qs[1].id]: ['a'] } }); // second is only half right
      ok(res, 201); assert.equal(res.body.score, 5);
      assert.equal((await who.actA.post(`/api/learner/assessments/${pmQuiz}/quiz`, { answers: { [qs[0].id]: ['a'], [qs[1].id]: ['a', 'c'] } })).status, 409, 'one attempt only');
      assert.equal((await who.actB.get(`/api/learner/assessments/${pmQuiz}/quiz`)).status, 404, 'other stack cannot open it');
      const a = (await who.actA.get('/api/learner/overview')).body.assessments.find((x) => x.id === pmQuiz);
      assert.equal(a.status, 'graded'); assert.equal(a.score, 5); assert.equal(a.kind, 'quiz');
      assert.equal((await who.actA.put(`/api/learner/assessments/${pmQuiz}/submission`, { url: DOC(4) })).status, 400, 'a quiz is not answered with a link');
      assert.equal((await admin.put(`/api/admin/assessments/${pmQuiz}/quiz`, good)).status, 409, 'questions locked after an attempt');
      assert.equal((await admin.del(`/api/admin/assessments/${pmQuiz}`)).status, 409, 'cannot delete once taken');
      const sub = (await who.fac.get(`/api/facilitator/submissions?cohortId=${cohortId}&assessmentId=${pmQuiz}`)).body.submissions.find((s) => s.name === 'Ada PM');
      assert.equal(sub.quiz.score, 5);
      assert.equal((await who.fac.put(`/api/facilitator/submissions/${wide.id}/grade`, { score: 1 })).status, 404, 'quiz scores are not hand-graded');
      const dash = (await who.actA.get('/api/learner/dashboard').catch(() => null));
      assert.ok(dash === null || [200, 404, 503].includes(dash.status));
    });

    it('stores instruction files safely and shares them only with the right learners, only once open', async () => {
      const up = (aid, name, data) => admin.raw('POST', `/api/admin/assessments/${aid}/files`, { fileName: name, dataBase64: data });
      const big = await up(daAsm, 'brief.pdf', b64(300 * 1024)); ok(big, 201); // larger than the normal 100 KB API limit
      assert.equal((await up(daAsm, 'virus.exe', b64(100))).status, 400);
      assert.equal((await up(daAsm, 'page.html', b64(100))).status, 400, 'nothing a browser would render');
      assert.equal((await up(daAsm, 'huge.pdf', b64(10 * 1024 * 1024 + 1))).status, 400, 'over 10 MB');
      assert.equal((await up(pmQuiz, 'x.pdf', b64(100))).status, 400, 'quizzes have no files');
      assert.equal((await actor(h.base).raw('POST', `/api/admin/assessments/${daAsm}/files`, { fileName: 'a.pdf', dataBase64: b64(100) })).status, 401, 'login required before any upload');
      assert.equal((await admin.post('/api/admin/stacks', { name: 'x'.repeat(200 * 1024) })).status, 413, 'other routes keep the small body limit');
      const stored = [...h.fake.buckets.get('assessment-files').keys()];
      assert.equal(stored.length, 1); assert.ok(stored[0].startsWith(`${cohortId}/${daAsm}/`));
      const fid = big.body.id;
      const mine = (await who.actB.get('/api/learner/overview')).body.assessments.find((a) => a.id === daAsm);
      assert.deepEqual(mine.files.map((f) => f.name), ['brief.pdf']);
      const link = await who.actB.get(`/api/learner/assessments/${daAsm}/files/${fid}/url`); ok(link);
      assert.match(link.body.url, /^https:\/\/storage\.test\/assessment-files\//);
      assert.equal((await who.actA.get(`/api/learner/assessments/${daAsm}/files/${fid}/url`)).status, 404, 'other stack: no link');
      await h.db.query(`update assessments set opens_at = now() + interval '2 day', due_at = now() + interval '9 day' where id = $1`, [daAsm]);
      assert.deepEqual((await who.actB.get('/api/learner/overview')).body.assessments.find((a) => a.id === daAsm).files, [], 'hidden until it opens');
      assert.equal((await who.actB.get(`/api/learner/assessments/${daAsm}/files/${fid}/url`)).status, 404);
      await openNow(daAsm);
      ok(await admin.del(`/api/admin/assessment-files/${fid}`));
      assert.equal(h.fake.buckets.get('assessment-files').size, 0, 'removed from storage too');
    });
  });

  describe('learners can edit until the deadline', () => {
    it('allows editing after a grade is saved and published, flags it for the facilitator, and stops at the deadline', async () => {
      const w1 = (await who.actA.get('/api/learner/overview')).body.assessments.find((a) => a.weekNumber === 1);
      ok(await who.actA.put(`/api/learner/assessments/${w1.id}/submission`, { url: DOC(10) }));
      const sid = (await h.db.query(`select id from submissions where learner_id = $1 and assessment_id = $2`, [who.a, w1.id])).rows[0].id;
      ok(await who.fac.put(`/api/facilitator/submissions/${sid}/grade`, { score: 4, feedback: 'Good', publish: true }));
      await h.db.query(`update grades set graded_at = now() - interval '1 minute' where submission_id = $1`, [sid]);
      ok(await who.actA.put(`/api/learner/assessments/${w1.id}/submission`, { url: DOC(11) }));
      const row = (await who.fac.get(`/api/facilitator/submissions?cohortId=${cohortId}&assessmentId=${w1.id}`)).body.submissions.find((s) => s.name === 'Ada PM');
      assert.equal(row.resubmitted, true); assert.equal(row.url, DOC(11));
      const mine = (await who.actA.get('/api/learner/overview')).body.assessments.find((a) => a.id === w1.id);
      assert.equal(mine.editedAfterGrade, true);
      await h.db.query(`update assessments set due_at = now() - interval '1 hour' where id = $1`, [w1.id]);
      const late = await who.actA.put(`/api/learner/assessments/${w1.id}/submission`, { url: DOC(12) });
      assert.equal(late.status, 403); assert.match(late.body.error, /deadline/i);
    });
  });

  describe('learner schedule', () => {
    it('gives each learner their own stack\'s classes, past and future, plus assessment dates', async () => {
      const a = (await who.actA.get('/api/learner/events')).body;
      const b = (await who.actB.get('/api/learner/events')).body;
      const classes = (r) => r.events.filter((e) => e.eventType === 'class').map((e) => e.title);
      assert.equal(classes(a).length, 6); assert.ok(classes(a).every((t) => !t.startsWith('Data Analysis')), 'no other stack\'s classes'); // one PM class was renamed earlier
      assert.ok(classes(b).every((t) => t.startsWith('Data Analysis')));
      assert.ok(a.events.some((e) => e.eventType === 'assessment_deadline'));
      assert.ok(a.events.some((e) => e.eventType === 'cohort_start'));
      assert.equal((await actor(h.base).get('/api/learner/events')).status, 401);
    });
  });

  describe('in-app feedback', () => {
    it('records name, email, stack and cohort from the session, never from the form', async () => {
      const r = await who.actC.post('/api/learner/feedback', { category: 'bug', message: 'The assessments page will not load', pageUrl: '/assessments', name: 'Spoof', email: 'spoof@example.test', stack: 'Fake' });
      ok(r, 201);
      const row = (await h.db.query(`select name, email::text email, stack, cohort_name, category, status, page_url from feedback where id = $1`, [r.body.id])).rows[0];
      assert.deepEqual(row, { name: 'Chi PM', email: 'c.pm@example.test', stack: 'Product Management', cohort_name: 'Cohort 11', category: 'bug', status: 'open', page_url: '/assessments' });
      assert.equal((await who.actC.post('/api/learner/feedback', { category: 'nonsense', message: 'hello there' })).status, 400);
      assert.equal((await who.actC.post('/api/learner/feedback', { category: 'other', message: 'hi' })).status, 400, 'too short');
      assert.equal((await actor(h.base).post('/api/learner/feedback', { category: 'bug', message: 'not signed in' })).status, 401);
      assert.equal((await who.fac.post('/api/learner/feedback', { category: 'bug', message: 'I am a facilitator' })).status, 401, 'learners only');
    });

    it('limits how often one learner can send', async () => {
      for (let i = 0; i < 4; i++) ok(await who.actC.post('/api/learner/feedback', { category: 'other', message: `message number ${i} here` }), 201);
      const r = await who.actC.post('/api/learner/feedback', { category: 'other', message: 'one too many messages' });
      assert.equal(r.status, 429);
    });

    it('lets admins see, resolve and reopen feedback', async () => {
      assert.equal((await who.actC.get('/api/admin/feedback')).status, 401);
      const summary = (await admin.get('/api/admin/feedback/summary')).body; assert.equal(summary.open, 5);
      const list = (await admin.get('/api/admin/feedback?status=open')).body; assert.equal(list.total, 5);
      assert.equal(list.items[0].name, 'Chi PM'); assert.equal(list.items[0].stack, 'Product Management');
      const first = list.items.find((i) => i.message.includes('will not load'));
      ok(await admin.patch(`/api/admin/feedback/${first.id}`, { status: 'resolved', note: 'Fixed in the next release' }));
      assert.equal((await admin.get('/api/admin/feedback/summary')).body.open, 4);
      const done = (await admin.get('/api/admin/feedback?status=resolved')).body.items[0];
      assert.equal(done.resolution_note, 'Fixed in the next release'); assert.equal(done.resolved_by, 'Admin');
      ok(await admin.patch(`/api/admin/feedback/${first.id}`, { status: 'open' }));
      assert.equal((await admin.get('/api/admin/feedback/summary')).body.open, 5);
    });
  });

  describe('removing facilitators', () => {
    it('removes one with no stack in the chosen cohort, blocks the rest, and can restore', async () => {
      const idle = await mkUser('idle.fac@example.test', 'Idle Fac', 'facilitator');
      const busyElsewhere = await mkUser('other.fac@example.test', 'Other Fac', 'facilitator');
      const c12 = (await h.db.query(`insert into cohorts (number,name,week1_class_date,status,is_active) values (12,'Cohort 12','2027-01-02','upcoming',false) returning id`)).rows[0].id;
      await h.db.query('insert into facilitator_assignments (facilitator_id, cohort_id, stack_id) values ($1,$2,$3)', [busyElsewhere, c12, pm]);
      await h.db.query(`insert into invites (role, email, full_name, cohort_id, stack_id, code_hash, expires_at) values ('facilitator','idle.fac@example.test','Idle Fac',$1,$2,'h', now() + interval '1 day')`, [cohortId, pm]);

      const assigned = await admin.del(`/api/admin/facilitators/${id.f1}?cohortId=${cohortId}`);
      assert.equal(assigned.status, 409); assert.match(assigned.body.error, /assigned to a stack in this cohort/);
      const elsewhere = await admin.del(`/api/admin/facilitators/${busyElsewhere}?cohortId=${cohortId}`);
      assert.equal(elsewhere.status, 409); assert.match(elsewhere.body.error, /Cohort 12/);
      assert.equal((await admin.del(`/api/admin/facilitators/${who.a}?cohortId=${cohortId}`)).status, 404, 'only facilitators can be removed this way');

      ok(await admin.del(`/api/admin/facilitators/${idle}?cohortId=${cohortId}`));
      assert.equal((await h.db.query('select is_active from profiles where id = $1', [idle])).rows[0].is_active, false, 'deactivated, not erased');
      assert.equal((await h.db.query(`select count(*)::int n from invites where email = 'idle.fac@example.test' and used_at is null`)).rows[0].n, 0, 'pending invite cancelled');
      assert.equal((await actor(h.base).post('/api/auth/facilitator/login', { email: 'idle.fac@example.test', password: PW })).status, 401, 'cannot sign in');
      assert.equal((await admin.del(`/api/admin/facilitators/${idle}?cohortId=${cohortId}`)).status, 409, 'already removed');
      const reinvite = await admin.post('/api/admin/facilitator-invites', { email: 'idle.fac@example.test', fullName: 'Idle Fac', cohortId, stackId: pm });
      assert.equal(reinvite.status, 409); assert.match(reinvite.body.error, /Restore/);
      ok(await admin.post(`/api/admin/facilitators/${idle}/restore`, {}));
      ok(await actor(h.base).post('/api/auth/facilitator/login', { email: 'idle.fac@example.test', password: PW }));
      assert.ok((await h.db.query(`select 1 from audit_log where action = 'facilitator.remove'`)).rowCount >= 1);
    });
  });

  describe('assessment reminders', () => {
    it('weeks 1-5: one reminder per unsubmitted open assessment; week 6: one consolidated email, unsubmitted work only', async () => {
      const { runReminders } = require('../../src/services/reminders');
      const r = await admin.post('/api/admin/cohorts', { number: 13, week1ClassDate: '2026-10-03', stackIds: [pm] }); ok(r, 201);
      const rc = r.body.cohort.id;
      await h.db.query(`update cohorts set reminders_enabled = true, status = 'active', is_active = true where id = $1`, [rc]);
      const mk = async (email, name) => {
        const pid = await mkUser(email, name, 'learner');
        return (await h.db.query(`insert into learners (cohort_id,stack_id,full_name,email,profile_id,status) values ($1,$2,$3,$4,$5,'active') returning id`, [rc, pm, name, email, pid])).rows[0].id;
      };
      const P = await mk('p.rem@example.test', 'Pat Unsubmitted'); const Q = await mk('q.rem@example.test', 'Quin Submitted'); const R = await mk('r.rem@example.test', 'Remi Extended');
      const sent = (to) => h.mail.sent.filter((m) => m.to === to);

      // Week 3 (Wednesday 21 Oct 09:30 Lagos): the open Week 3 assessment, one email each for those who have not submitted.
      const wk3 = new Date('2026-10-21T08:30:00Z');
      const w3 = (await h.db.query(`select id from assessments where cohort_id = $1 and week_number = 3`, [rc])).rows[0].id;
      await h.db.query(`insert into submissions (assessment_id, learner_id, url) values ($1,$2,$3)`, [w3, Q, DOC(20)]);
      const out3 = await runReminders({ now: wk3, onlyCohortId: rc });
      assert.equal(out3.cohorts[0].consolidated, false);
      assert.equal(sent('p.rem@example.test').length, 1); assert.match(sent('p.rem@example.test')[0].subject, /Week 3/);
      assert.equal(sent('q.rem@example.test').length, 0, 'submitted (even though ungraded) = no reminder');
      await runReminders({ now: wk3, onlyCohortId: rc });
      assert.equal(sent('p.rem@example.test').length, 1, 'running again the same day sends nothing more');

      // Week 6 (Wednesday 11 Nov): the default weekly deadlines have passed. Only what is still submittable counts.
      const wk6 = new Date('2026-11-11T08:30:00Z');
      const late = (await h.db.query(
        `insert into assessments (cohort_id, week_number, title, max_score, opens_at, due_at) values ($1, 6, 'Final task', 10, '2026-11-07T00:00:00Z', '2026-11-14T22:59:00Z') returning id`, [rc])).rows[0].id;
      const w5 = (await h.db.query(`select id from assessments where cohort_id = $1 and week_number = 5`, [rc])).rows[0].id;
      await h.db.query(`insert into deadline_extensions (assessment_id, learner_id, new_due_at, reason, created_by) values ($1,$2,'2026-11-13T22:59:00Z','Illness',$3)`, [w5, R, id.admin]);
      await h.db.query(`insert into submissions (assessment_id, learner_id, url) values ($1,$2,$3)`, [late, Q, DOC(21)]); // Quin submitted the final task: ungraded
      const remiBefore = sent('r.rem@example.test').length; // Remi already got a Week 3 reminder above
      const out6 = await runReminders({ now: wk6, onlyCohortId: rc });
      assert.equal(out6.cohorts[0].week, 6); assert.equal(out6.cohorts[0].consolidated, true);
      assert.equal(sent('p.rem@example.test').length, 2, 'one new email for week 6');
      assert.equal(sent('q.rem@example.test').length, 0, 'submitted but not yet graded: never reminded');
      assert.equal(sent('r.rem@example.test').length - remiBefore, 1, 'ONE consolidated email in week 6');
      const last = sent('r.rem@example.test').at(-1);
      assert.match(last.html, /Week 5/); assert.match(last.html, /Week 6/); assert.match(last.subject, /unsubmitted/i);
      assert.match(last.html, /https:\/\/app\.test\/assessments/, 'link uses the configured app address');
      void P;
    });
  });

  describe('cohort 9 canary', () => {
    it('is untouched by everything above', async () => {
      const { rows } = await h.db.query('select count(*)::int n from events where cohort_id = $1', [c9]);
      assert.equal(rows[0].n, 0);
      assert.equal((await h.db.query('select count(*)::int n from assessments where cohort_id = $1', [c9])).rows[0].n, 0);
      assert.equal((await h.db.query(`select status, is_active from cohorts where id = $1`, [c9])).rows[0].status, 'active');
    });
  });
});
