const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { boot, actor } = require('../helpers/harness');

const skip = !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL not set (needs a LOCAL Postgres whose name contains "test")';
const PW = 'Survey-Pass-12345';
const ok = (res, code = 200) => assert.equal(res.status, code, `expected ${code}, got ${res.status}: ${res.text}`);
const localIn = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 16);
const png = (extra = 50) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(extra)]).toString('base64');

describe('assessment resources, change requests and surveys', { skip }, () => {
  let h; let admin; let pm; let da; let cohortId; let c9; let pmAsm; let survey;
  const L = {}; const A = {}; const F = {};
  const mkUser = async (email, name, role) => {
    const u = await h.fake.addUser(email, PW);
    await h.db.query('insert into profiles (id,email,full_name,role) values ($1,$2,$3,$4)', [u.id, email, name, role]);
    return u.id;
  };
  const addLearner = async (key, name, stackId, status = 'active') => {
    const email = `${key}@example.test`; const pid = await mkUser(email, name, 'learner');
    L[key] = (await h.db.query(`insert into learners (cohort_id,stack_id,full_name,email,profile_id,status) values ($1,$2,$3,$4,$5,$6) returning id`, [cohortId, stackId, name, email, pid, status])).rows[0].id;
    if (status === 'active') { A[key] = actor(h.base); ok(await A[key].post('/api/auth/learner/login', { email, password: PW })); }
  };
  const addFac = async (key, stackId) => {
    const id = await mkUser(`${key}@example.test`, `Facilitator ${key}`, 'facilitator');
    if (stackId) await h.db.query('insert into facilitator_assignments (facilitator_id, cohort_id, stack_id) values ($1,$2,$3)', [id, cohortId, stackId]);
    F[key] = actor(h.base); ok(await F[key].post('/api/auth/facilitator/login', { email: `${key}@example.test`, password: PW }));
  };
  const qid = (qs, n) => qs.find((q) => q.position === n).id;
  const midAnswers = (qs, { r, q9, q10, note, choices = ['Live classes'] }) => {
    const set = [[1, r], [2, { choices }], [3, 4], [4, 4], [5, 4], [6, { choices: ['Assessments and deadlines'] }], [8, 4], [9, q9], [11, 4], [12, 4]];
    if (q10) set.push([10, q10]); if (note) set.push([13, note]);
    return Object.fromEntries(set.map(([n, v]) => [qid(qs, n), v]));
  };
  const createSurvey = async (template, extra = {}) => {
    const r = await admin.post('/api/admin/surveys', { cohortId, template, opensAtLocal: localIn(-1), closesAtLocal: localIn(7), ...extra }); ok(r, 201); return r.body.id;
  };
  const questions = async (id) => (await admin.get(`/api/admin/surveys/${id}`)).body.questions;

  before(async () => {
    h = await boot();
    await mkUser('admin@example.test', 'Admin Person', 'admin');
    pm = (await h.db.query(`insert into stacks (name) values ('Product Management') returning id`)).rows[0].id;
    da = (await h.db.query(`insert into stacks (name) values ('Data Analysis') returning id`)).rows[0].id;
    c9 = (await h.db.query(`insert into cohorts (number,name,week1_class_date,status,is_active) values (9,'Cohort 9','2026-08-01','active',true) returning id`)).rows[0].id;
    admin = actor(h.base); ok(await admin.post('/api/auth/admin/login', { email: 'admin@example.test', password: PW }));
    const c = await admin.post('/api/admin/cohorts', { number: 31, week1ClassDate: '2026-10-03', stackIds: [pm, da] }); ok(c, 201); cohortId = c.body.cohort.id;
    ok(await admin.post(`/api/admin/cohorts/${cohortId}/status`, { status: 'active' }));
    await addLearner('l1', 'Ada One', pm); await addLearner('l2', 'Bola Two', pm); await addLearner('l3', 'Chi Three', pm);
    await addLearner('l4', 'Dayo Four', da); await addLearner('l5', 'Efe Five', da); await addLearner('lw', 'Wendy Withdrawn', da, 'withdrawn');
    await addFac('fpm', pm); await addFac('fda', da); await addFac('fnone', null);
  });
  after(async () => { if (h) await h.close(); });

  describe('assessment resources', () => {
    const body = (extra) => ({ weekNumber: 2, stackId: pm, kind: 'assignment', title: 'PM case study', maxScore: 10, opensAtLocal: '2026-11-14T00:00', dueAtLocal: '2026-11-27T23:59', instructions: 'Write the case study.', ...extra });
    it('lets the admin add resources while creating an assessment, and rejects unsafe links', async () => {
      for (const bad of ['http://example.com/x', 'javascript:alert(1)', 'not a link']) {
        const r = await admin.post(`/api/admin/assessments?cohortId=${cohortId}`, body({ resources: [{ title: 'Bad', url: bad }] }));
        assert.equal(r.status, 400, bad);
      }
      assert.equal((await h.db.query(`select count(*)::int n from assessments where cohort_id = $1 and stack_id = $2`, [cohortId, pm])).rows[0].n, 0, 'a rejected request creates nothing');
      const r = await admin.post(`/api/admin/assessments?cohortId=${cohortId}`, body({ resources: [{ title: 'Reading', url: 'https://example.com/read', note: 'Chapter 3' }, { title: 'Video', url: 'https://youtu.be/abc123' }] }));
      ok(r, 201); pmAsm = r.body.id;
      const list = (await admin.get(`/api/admin/assessments?cohortId=${cohortId}`)).body.assessments;
      assert.equal(list.find((a) => a.id === pmAsm).resourceCount, 2);
    });
    it('lets the admin add, edit and remove resources afterwards', async () => {
      assert.equal((await admin.post(`/api/admin/assessments/${pmAsm}/resources`, { title: 'Insecure', url: 'http://x.com' })).status, 400);
      const added = await admin.post(`/api/admin/assessments/${pmAsm}/resources`, { title: 'Template', url: 'https://example.com/template' }); ok(added, 201);
      ok(await admin.patch(`/api/admin/assessment-resources/${added.body.id}`, { title: 'Template (updated)', note: 'Use this layout' }));
      assert.equal((await admin.patch(`/api/admin/assessment-resources/${added.body.id}`, { url: 'ftp://x' })).status, 400);
      assert.deepEqual((await admin.get(`/api/admin/assessments/${pmAsm}/resources`)).body.resources.map((r) => r.title), ['Reading', 'Video', 'Template (updated)']);
      ok(await admin.del(`/api/admin/assessment-resources/${added.body.id}`));
      assert.equal((await admin.get(`/api/admin/assessments/${pmAsm}/resources`)).body.resources.length, 2);
    });
    it('shows resources to learners of that stack only', async () => {
      await h.db.query(`update assessments set opens_at = now() - interval '1 day', due_at = now() + interval '5 day' where id = $1`, [pmAsm]);
      const mine = (await A.l1.get('/api/learner/overview')).body.assessments.find((a) => a.id === pmAsm);
      assert.deepEqual(mine.resources.map((r) => r.title), ['Reading', 'Video']); assert.equal(mine.resources[0].note, 'Chapter 3');
      assert.ok(!(await A.l4.get('/api/learner/overview')).body.assessments.some((a) => a.id === pmAsm), 'a DA learner does not see the PM assessment');
    });
    it('shows the facilitator each week\'s assessments, instructions, files and resources, read-only and in scope', async () => {
      ok(await admin.raw('POST', `/api/admin/assessments/${pmAsm}/files`, { fileName: 'brief.pdf', dataBase64: Buffer.alloc(300).toString('base64') }), 201);
      const pmView = (await F.fpm.get(`/api/facilitator/assessment-overview?cohortId=${cohortId}`)).body.assessments;
      const a = pmView.find((x) => x.id === pmAsm);
      assert.equal(a.instructions, 'Write the case study.'); assert.deepEqual(a.resources.map((r) => r.title), ['Reading', 'Video']); assert.equal(a.files[0].name, 'brief.pdf');
      assert.ok(pmView.some((x) => x.stack === null), 'cohort-wide assessments are included');
      assert.ok(!(await F.fda.get(`/api/facilitator/assessment-overview?cohortId=${cohortId}`)).body.assessments.some((x) => x.id === pmAsm), 'a DA facilitator does not see PM-only work');
      assert.equal((await F.fnone.get(`/api/facilitator/assessment-overview?cohortId=${cohortId}`)).status, 404);
      ok(await F.fpm.get(`/api/facilitator/assessment-files/${a.files[0].id}/url`));
      assert.equal((await F.fda.get(`/api/facilitator/assessment-files/${a.files[0].id}/url`)).status, 404);
      for (const [m, p] of [['patch', `/api/admin/assessments/${pmAsm}/details`], ['post', `/api/admin/assessments/${pmAsm}/resources`], ['del', `/api/admin/assessments/${pmAsm}`]]) {
        assert.equal((await F.fpm[m](p, { title: 'Hack' })).status, 401, `facilitators cannot ${m} ${p}`);
      }
    });
  });

  describe('facilitator change requests', () => {
    let reqId;
    it('lets a facilitator ask for a change, but only on assessments in their scope', async () => {
      assert.equal((await F.fpm.post('/api/facilitator/change-requests', { assessmentId: pmAsm, message: 'no' })).status, 400, 'too short');
      assert.equal((await F.fda.post('/api/facilitator/change-requests', { assessmentId: pmAsm, message: 'Please add a rubric link' })).status, 404, 'out of scope');
      const r = await F.fpm.post('/api/facilitator/change-requests', { assessmentId: pmAsm, message: 'Please add a link to the grading rubric' }); ok(r, 201); reqId = r.body.id;
    });
    it('shows the admin the request, and the facilitator its progress once the admin has implemented it', async () => {
      assert.equal((await admin.get('/api/admin/change-requests/summary')).body.open, 1);
      const list = (await admin.get('/api/admin/change-requests?status=open')).body.requests;
      assert.equal(list.length, 1); assert.equal(list[0].requested_by, 'Facilitator fpm'); assert.equal(list[0].title, 'PM case study'); assert.equal(list[0].week_number, 2);
      assert.equal((await F.fda.get('/api/facilitator/change-requests')).body.requests.length, 0, 'other facilitators never see it');
      // the admin implements the change on the assessment itself: it is live for learners immediately
      ok(await admin.post(`/api/admin/assessments/${pmAsm}/resources`, { title: 'Grading rubric', url: 'https://example.com/rubric' }), 201);
      assert.ok((await A.l1.get('/api/learner/overview')).body.assessments.find((a) => a.id === pmAsm).resources.some((r) => r.title === 'Grading rubric'));
      ok(await admin.patch(`/api/admin/change-requests/${reqId}`, { status: 'implemented', note: 'Added the rubric as a resource' }));
      assert.equal((await admin.get('/api/admin/change-requests/summary')).body.open, 0);
      const mine = (await F.fpm.get('/api/facilitator/change-requests')).body.requests[0];
      assert.equal(mine.status, 'implemented'); assert.equal(mine.admin_note, 'Added the rubric as a resource');
      assert.equal((await A.l1.get('/api/admin/change-requests')).status, 401);
    });
  });

  describe('surveys: set up, schedule and send', () => {
    it('creates the standard surveys from templates and validates the dates', async () => {
      assert.equal((await admin.post('/api/admin/surveys', { cohortId, template: 'mid', opensAtLocal: localIn(2), closesAtLocal: localIn(1) })).status, 400, 'closes before it opens');
      assert.equal((await admin.post('/api/admin/surveys', { cohortId, template: 'mid', opensAtLocal: localIn(-9), closesAtLocal: localIn(-8) })).status, 400, 'already over');
      survey = await createSurvey('mid');
      const s = (await admin.get(`/api/admin/surveys/${survey}`)).body;
      assert.equal(s.survey.status, 'draft'); assert.equal(s.questions.length, 14); assert.equal(s.survey.title, 'Cohort 31 Mid-Bootcamp Survey');
      assert.deepEqual((await A.l1.get('/api/learner/surveys')).body.surveys, [], 'learners cannot see an unpublished survey');
      assert.equal((await A.l1.get(`/api/learner/surveys/${survey}`)).status, 404);
    });
    it('lets the admin edit wording and options before anyone responds', async () => {
      const qs = await questions(survey);
      ok(await admin.patch(`/api/admin/surveys/${survey}/questions/${qid(qs, 2)}`, { options: { choices: ['Live classes', 'Facilitator support'], allowText: true } }));
      assert.equal((await admin.patch(`/api/admin/surveys/${survey}/questions/${qid(qs, 2)}`, { options: { choices: ['Only one'] } })).status, 400);
      ok(await admin.patch(`/api/admin/surveys/${survey}/questions/${qid(qs, 4)}`, { prompt: 'How are you finding your assessments so far?' }));
    });
    it('opens and emails every active learner once, with a link and no password', async () => {
      const subject = (m) => /Please complete the Cohort 31 Mid-Bootcamp Survey/.test(m.subject);
      const r = await admin.post(`/api/admin/surveys/${survey}/send`, { openNow: true }); ok(r);
      assert.equal(r.body.sent, 5); assert.equal(r.body.remaining, 0);
      const mails = h.mail.sent.filter(subject);
      assert.equal(mails.length, 5); assert.ok(!mails.some((m) => m.to === 'lw@example.test'), 'the withdrawn learner is not emailed');
      assert.match(mails[0].text, /https:\/\/app\.test\/surveys/); assert.ok(!/password\s*[:=]/i.test(mails[0].text));
      ok(await admin.post(`/api/admin/surveys/${survey}/send`, {}));
      assert.equal(h.mail.sent.filter(subject).length, 5, 'pressing send again emails nobody twice');
      assert.equal((await admin.get(`/api/admin/surveys/${survey}`)).body.survey.status, 'open');
    });
  });

  describe('surveys: learners respond', () => {
    let qs;
    it('shows the survey without internal flags, and enforces required and conditional questions', async () => {
      const r = await A.l1.get(`/api/learner/surveys/${survey}`); ok(r);
      assert.ok(!r.text.includes('"flag"') && !r.text.includes('instructor_note'), 'internal flags are not sent to learners');
      qs = r.body.questions;
      const base = midAnswers(qs, { r: 5, q9: 'yes' });
      const missing = { ...base }; delete missing[qid(qs, 1)];
      const e1 = await A.l1.post(`/api/learner/surveys/${survey}/respond`, { answers: missing }); assert.equal(e1.status, 400); assert.match(e1.body.error, /Question 1/);
      const e2 = await A.l1.post(`/api/learner/surveys/${survey}/respond`, { answers: midAnswers(qs, { r: 5, q9: 'no' }) }); assert.equal(e2.status, 400); assert.match(e2.body.error, /Question 10/);
      assert.equal((await A.l1.post(`/api/learner/surveys/${survey}/respond`, { answers: midAnswers(qs, { r: 9, q9: 'yes' }) })).status, 400, 'rating out of range');
    });
    it('accepts each learner\'s answers once', async () => {
      const go = (key, o) => A[key].post(`/api/learner/surveys/${survey}/respond`, { answers: midAnswers(qs, o) });
      ok(await go('l1', { r: 5, q9: 'yes', note: 'Very clear, thank you' }), 201);
      ok(await go('l2', { r: 2, q9: 'no', q10: 'The pace was too fast', note: 'you are an idiot', choices: ['Live classes', 'Facilitator support'] }), 201);
      ok(await go('l3', { r: 4, q9: 'yes', note: 'Please slow down a little' }), 201);
      ok(await go('l4', { r: 3, q9: 'yes', note: 'Good sessions' }), 201);
      ok(await go('l5', { r: 4, q9: 'no', q10: 'Not what I expected' }), 201);
      assert.equal((await go('l1', { r: 1, q9: 'yes' })).status, 409, 'one response per learner');
      assert.equal((await A.l1.get('/api/learner/surveys')).body.surveys[0].submitted, true);
    });
  });

  describe('surveys: the admin dashboard', () => {
    it('summarises every question, by stack, with the response rate', async () => {
      const r = (await admin.get(`/api/admin/surveys/${survey}/results`)).body;
      assert.deepEqual({ e: r.eligible, n: r.responded, rate: r.rate }, { e: 5, n: 5, rate: 100 });
      assert.deepEqual(r.byStack.map((x) => [x.stack, x.eligible, x.responded]), [['Data Analysis', 2, 2], ['Product Management', 3, 3]]);
      const q = (n) => r.questions.find((x) => x.position === n);
      assert.deepEqual(q(1).counts, { 1: 0, 2: 1, 3: 1, 4: 2, 5: 1 }); assert.equal(q(1).average, 3.6);
      assert.deepEqual(q(1).byStack.map((x) => [x.stack, x.average]), [['Data Analysis', 3.5], ['Product Management', 3.7]]);
      assert.deepEqual({ yes: q(9).yes, no: q(9).no }, { yes: 3, no: 2 });
      assert.deepEqual(q(10).responses.map((x) => x.text).sort(), ['Not what I expected', 'The pace was too fast']);
      assert.deepEqual(q(2).options.find((o) => o.label === 'Live classes'), { label: 'Live classes', count: 5 });
      assert.equal(q(2).options.find((o) => o.label === 'Facilitator support').count, 1);
      assert.equal(q(13).notes.length, 4); assert.equal(q(13).notes.filter((n) => n.flagged).length, 1, 'the rude note is flagged');
      assert.ok(!JSON.stringify(q(10)).includes('Bola'), 'the dashboard lists answers without names');
    });
    it('shows individual responses with names to admins only', async () => {
      const r = (await admin.get(`/api/admin/surveys/${survey}/responses`)).body;
      assert.equal(r.total, 5); assert.ok(r.responses.some((x) => x.name === 'Bola Two' && x.answers.some((a) => a.display === '2 / 5')));
      assert.equal((await A.l1.get(`/api/admin/surveys/${survey}/responses`)).status, 401);
      assert.equal((await F.fpm.get(`/api/admin/surveys/${survey}/results`)).status, 401);
    });
  });

  describe('surveys: instructor notes reach facilitators anonymised and filtered', () => {
    it('shows nothing while the survey is still open', async () => {
      assert.deepEqual((await F.fpm.get(`/api/facilitator/survey-notes?cohortId=${cohortId}`)).body.surveys, []);
    });
    it('after it closes: clean notes only, no names, and nothing for a stack with fewer than 3 responses', async () => {
      await h.db.query(`update surveys set opens_at = now() - interval '3 day', closes_at = now() - interval '1 minute' where id = $1`, [survey]);
      const pmRes = await F.fpm.get(`/api/facilitator/survey-notes?cohortId=${cohortId}`); ok(pmRes);
      const entry = pmRes.body.surveys[0];
      assert.deepEqual({ stack: entry.stack, held: entry.held, responses: entry.responses }, { stack: 'Product Management', held: false, responses: 3 });
      assert.deepEqual([...entry.notes].sort(), ['Please slow down a little', 'Very clear, thank you']);
      assert.ok(!pmRes.text.includes('idiot'), 'the filtered note is not shown');
      for (const leak of ['Ada', 'Bola', 'Chi', 'l1@example', 'l2@example', 'submitted_at', 'learner']) assert.ok(!pmRes.text.includes(leak), `anonymised: no "${leak}"`);
      const daEntry = (await F.fda.get(`/api/facilitator/survey-notes?cohortId=${cohortId}`)).body.surveys[0];
      assert.deepEqual({ held: daEntry.held, notes: daEntry.notes, responses: daEntry.responses }, { held: true, notes: [], responses: 2 });
      assert.equal((await F.fnone.get(`/api/facilitator/survey-notes?cohortId=${cohortId}`)).status, 404);
      assert.equal((await A.l1.get(`/api/facilitator/survey-notes?cohortId=${cohortId}`)).status, 401);
    });
    it('lets an admin release a held-back note and hide it again', async () => {
      const r = (await admin.get(`/api/admin/surveys/${survey}/results`)).body;
      const rude = r.questions.find((x) => x.position === 13).notes.find((n) => n.flagged);
      ok(await admin.patch(`/api/admin/surveys/${survey}/notes/${rude.id}`, { released: true }));
      assert.ok((await F.fpm.get(`/api/facilitator/survey-notes?cohortId=${cohortId}`)).body.surveys[0].notes.includes('you are an idiot'));
      ok(await admin.patch(`/api/admin/surveys/${survey}/notes/${rude.id}`, { released: false }));
      assert.ok(!(await F.fpm.get(`/api/facilitator/survey-notes?cohortId=${cohortId}`)).text.includes('idiot'));
    });
  });

  describe('surveys: locks, schedule and isolation', () => {
    it('locks questions and deletion once learners have responded, but lets a fresh draft be deleted', async () => {
      const qs = await questions(survey);
      assert.equal((await admin.patch(`/api/admin/surveys/${survey}/questions/${qid(qs, 1)}`, { prompt: 'A different question now?' })).status, 409);
      assert.equal((await admin.del(`/api/admin/surveys/${survey}`)).status, 409);
      const draft = await createSurvey('mid');
      ok(await admin.del(`/api/admin/surveys/${draft}`));
      assert.equal((await admin.get(`/api/admin/surveys/${draft}`)).status, 404);
    });
    it('the scheduled job emails a survey that has opened, exactly once', async () => {
      const { runSurveyNotifications } = require('../../src/services/surveyNotify');
      const s2 = await createSurvey('mid', { title: 'Scheduled check-in survey' });
      ok(await admin.patch(`/api/admin/surveys/${s2}`, { published: true }));
      const count = () => h.mail.sent.filter((m) => /Scheduled check-in survey/.test(m.subject)).length;
      assert.equal(count(), 0, 'publishing alone sends nothing');
      await runSurveyNotifications(); assert.equal(count(), 5);
      await runSurveyNotifications(); assert.equal(count(), 5, 'a second run sends nothing more');
      assert.ok((await h.db.query('select notified_at from surveys where id = $1', [s2])).rows[0].notified_at);
    });
    it('a learner only reaches surveys of their own cohort', async () => {
      const c2 = (await admin.post('/api/admin/cohorts', { number: 32, week1ClassDate: '2026-12-05', stackIds: [pm] })).body.cohort.id;
      const other = (await admin.post('/api/admin/surveys', { cohortId: c2, template: 'mid', opensAtLocal: localIn(-1), closesAtLocal: localIn(7) })).body.id;
      ok(await admin.patch(`/api/admin/surveys/${other}`, { published: true }));
      assert.ok(!(await A.l1.get('/api/learner/surveys')).body.surveys.some((x) => x.id === other));
      assert.equal((await A.l1.get(`/api/learner/surveys/${other}`)).status, 404);
      assert.equal((await A.l1.post(`/api/learner/surveys/${other}/respond`, { answers: {} })).status, 404);
    });
  });

  describe('final survey: optional photo with consent', () => {
    let fin; let fqs;
    const finalAnswers = (o) => {
      const set = [[1, 5], [2, { choices: ['Live classes'] }], [4, 4], [5, 4], [6, 3], [7, 5], [8, 'yes'], [10, o.q10]];
      if (o.consent) set.push([12, true]);
      return Object.fromEntries(set.map(([n, v]) => [qid(fqs, n), v]));
    };
    const upload = (key, fileName, dataBase64) => A[key].raw('POST', `/api/learner/surveys/${fin}/photo`, { fileName, dataBase64 });
    const respond = (key, o) => A[key].post(`/api/learner/surveys/${fin}/respond`, { answers: finalAnswers(o) });
    const photoRows = async () => (await h.db.query('select learner_id, consented from survey_photos where survey_id = $1', [fin])).rows;

    it('creates the final survey from its template', async () => {
      fin = await createSurvey('final'); ok(await admin.patch(`/api/admin/surveys/${fin}`, { published: true }));
      fqs = (await A.l1.get(`/api/learner/surveys/${fin}`)).body.questions;
      assert.equal(fqs.length, 12); assert.match(fqs[0].prompt, /Cohort 31 Bootcamp/); assert.match(fqs[11].prompt, /Consent & Permission/);
    });
    it('refuses unsafe photo uploads', async () => {
      assert.equal((await upload('l3', 'me.png', Buffer.from('<html><script>x</script></html>').toString('base64'))).status, 400, 'not really an image');
      assert.equal((await upload('l3', 'me.gif', png())).status, 400, 'wrong type');
      assert.equal((await upload('l3', 'me.png', png(5 * 1024 * 1024 + 1))).status, 400, 'over 5 MB');
      assert.equal((await photoRows()).length, 0);
    });
    it('keeps a photo only with a Yes and the consent box ticked', async () => {
      ok(await upload('l1', 'ada.png', png()), 201);
      const noConsent = await respond('l1', { q10: 'yes' }); assert.equal(noConsent.status, 400); assert.match(noConsent.body.error, /consent/i);
      ok(await respond('l1', { q10: 'yes', consent: true }), 201);
      assert.deepEqual(await photoRows(), [{ learner_id: L.l1, consented: true }]);
      assert.equal(h.fake.buckets.get('survey-photos').size, 1);
      // says No: an uploaded photo is discarded, not kept
      ok(await upload('l2', 'bola.png', png()), 201); assert.equal(h.fake.buckets.get('survey-photos').size, 2);
      ok(await respond('l2', { q10: 'no' }), 201);
      assert.deepEqual((await photoRows()).map((r) => r.learner_id), [L.l1], 'the photo of a learner who said No is gone');
      assert.equal(h.fake.buckets.get('survey-photos').size, 1, 'and removed from storage');
      ok(await respond('l5', { q10: 'yes' }), 201); // the photo is optional
      assert.equal((await upload('l1', 'again.png', png())).status, 409, 'no uploads after submitting');
    });
    it('lets only an admin see consented photos', async () => {
      const r = (await admin.get(`/api/admin/surveys/${fin}/results`)).body;
      assert.deepEqual(r.photos.map((p) => p.name), ['Ada One']);
      const url = await admin.get(`/api/admin/surveys/${fin}/photos/${r.photos[0].id}/url`); ok(url);
      assert.match(url.body.url, /^https:\/\/storage\.test\/survey-photos\//);
      assert.equal((await admin.get(`/api/admin/surveys/${fin}/photos/00000000-0000-0000-0000-000000000000/url`)).status, 404);
      assert.equal((await A.l1.get(`/api/admin/surveys/${fin}/photos/${r.photos[0].id}/url`)).status, 401);
      assert.equal((await F.fpm.get(`/api/admin/surveys/${fin}/photos/${r.photos[0].id}/url`)).status, 401);
    });
  });

  it('Cohort 9 canary: no surveys, resources or requests were created for it', async () => {
    assert.equal((await h.db.query('select count(*)::int n from surveys where cohort_id = $1', [c9])).rows[0].n, 0);
    assert.equal((await h.db.query('select count(*)::int n from assessment_change_requests where cohort_id = $1', [c9])).rows[0].n, 0);
  });
});
