const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { unzipSync, strFromU8 } = require('fflate');
const { boot, actor } = require('../helpers/harness');

const skip = !process.env.TEST_DATABASE_URL && 'TEST_DATABASE_URL not set (needs a LOCAL Postgres whose name contains "test")';
const PW = 'Report-Pass-12345';
const ok = (res, code = 200) => assert.equal(res.status, code, `expected ${code}, got ${res.status}: ${res.text}`);
const docXml = (buf) => strFromU8(unzipSync(new Uint8Array(buf))['word/document.xml']);
const sheetRow = (email, stack, att, asm, soft = '', link = '', cap = '') => ['x', email, stack, ...att, ...asm, soft, link, cap, '', '', ''];

describe('attendance, reports and extensions', { skip }, () => {
  let h; let admin; let cohortId; let pm; let da; let c9;
  const L = {};
  const mkUser = async (email, name, role) => {
    const u = await h.fake.addUser(email, PW);
    await h.db.query('insert into profiles (id,email,full_name,role) values ($1,$2,$3,$4)', [u.id, email, name, role]);
    return u.id;
  };
  const addLearner = async (key, name, stackId, status = 'active') => {
    const email = `${key}@example.test`;
    const pid = await mkUser(email, name, 'learner');
    L[key] = (await h.db.query(`insert into learners (cohort_id,stack_id,full_name,email,profile_id,status) values ($1,$2,$3,$4,$5,$6) returning id`, [cohortId, stackId, name, email, pid, status])).rows[0].id;
  };
  const localIn = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 16);
  const download = async (rid) => {
    const r = await fetch(`${h.base}/api/admin/reports/${rid}/download`, { headers: { cookie: [...admin.jar].map(([k, v]) => `${k}=${v}`).join('; '), 'x-fv-portal': 'admin' } });
    return { status: r.status, headers: r.headers, buf: Buffer.from(await r.arrayBuffer()) };
  };

  before(async () => {
    h = await boot();
    await mkUser('admin@example.test', 'Admin Person', 'admin');
    pm = (await h.db.query(`insert into stacks (name) values ('Product Management') returning id`)).rows[0].id;
    da = (await h.db.query(`insert into stacks (name) values ('Data Analysis') returning id`)).rows[0].id;
    c9 = (await h.db.query(`insert into cohorts (number,name,week1_class_date,status,is_active) values (9,'Cohort 9','2026-08-01','active',true) returning id`)).rows[0].id;
    admin = actor(h.base);
    ok(await admin.post('/api/auth/admin/login', { email: 'admin@example.test', password: PW }));
    const c = await admin.post('/api/admin/cohorts', { number: 21, week1ClassDate: '2026-10-03', stackIds: [pm, da] }); ok(c, 201);
    cohortId = c.body.cohort.id;
    await addLearner('p1', 'Zainab Alpha', pm); await addLearner('p2', 'Bola Bravo', pm); await addLearner('p3', 'Chidi Charlie', pm);
    await addLearner('d1', 'Dayo Delta', da); await addLearner('d2', 'Efe Echo', da); await addLearner('w1', 'Withdrawn Person', da, 'withdrawn');
  });
  after(async () => { if (h) await h.close(); });

  describe('deadline extensions cannot be set in the past', () => {
    it('rejects a past date, accepts a future one', async () => {
      const asm = (await h.db.query(`select id from assessments where cohort_id = $1 and week_number = 1`, [cohortId])).rows[0].id;
      await h.db.query(`update assessments set opens_at = now() - interval '30 day', due_at = now() - interval '20 day' where id = $1`, [asm]);
      const body = (newDueAtLocal) => ({ learnerId: L.p1, newDueAtLocal, reason: 'Illness' });
      const past = await admin.post(`/api/admin/assessments/${asm}/extensions`, body(localIn(-5)));
      assert.equal(past.status, 400); assert.match(past.body.error, /in the future/i);
      assert.equal((await admin.post(`/api/admin/assessments/${asm}/extensions`, body(localIn(-40)))).status, 400);
      assert.equal((await h.db.query('select count(*)::int n from deadline_extensions where assessment_id = $1', [asm])).rows[0].n, 0, 'nothing saved');
      ok(await admin.post(`/api/admin/assessments/${asm}/extensions`, body(localIn(3))), 201);
    });
  });

  describe('attendance', () => {
    let weekly; let extra;
    it('creates the six standard weekly classes once, on the class Saturdays', async () => {
      assert.equal((await admin.post(`/api/admin/attendance/sessions/ensure?cohortId=${cohortId}`, {})).body.created, 6);
      assert.equal((await admin.post(`/api/admin/attendance/sessions/ensure?cohortId=${cohortId}`, {})).body.created, 0);
      const list = (await admin.get(`/api/admin/attendance/sessions?cohortId=${cohortId}`)).body.sessions;
      assert.deepEqual(list.map((s) => s.held_on), ['2026-10-03', '2026-10-10', '2026-10-17', '2026-10-24', '2026-10-31', '2026-11-07']);
      assert.equal(list[0].eligible, 5, 'withdrawn learners are not expected'); weekly = list[0];
    });
    it('adds an extra class for the whole cohort or one stack, only to mark attendance', async () => {
      assert.equal((await admin.post(`/api/admin/attendance/sessions?cohortId=${cohortId}`, { title: 'Revision session', heldOn: 'nope' })).status, 400);
      const r = await admin.post(`/api/admin/attendance/sessions?cohortId=${cohortId}`, { title: 'PM revision class', heldOn: '2026-10-14', stackId: pm }); ok(r, 201); extra = r.body.id;
      assert.equal((await admin.get(`/api/admin/attendance/sessions/${extra}/roster`)).body.learners.length, 3, 'PM learners only');
      assert.equal((await admin.get(`/api/admin/attendance/sessions/${weekly.id}/roster`)).body.learners.length, 5);
    });
    it('records statuses and notes, can clear a mark, and unmarked is not absent', async () => {
      const mark = (records) => admin.put(`/api/admin/attendance/sessions/${weekly.id}/records`, { records });
      ok(await mark([{ learnerId: L.p1, status: 'present' }, { learnerId: L.p2, status: 'late', note: 'Joined late' }, { learnerId: L.p3, status: 'absent' }, { learnerId: L.d1, status: 'excused', note: 'Medical' }]));
      const by = Object.fromEntries((await admin.get(`/api/admin/attendance/sessions/${weekly.id}/roster`)).body.learners.map((l) => [l.full_name, l]));
      assert.equal(by['Bola Bravo'].note, 'Joined late'); assert.equal(by['Efe Echo'].status, null);
      ok(await mark([{ learnerId: L.p3, status: null }]));
      ok(await mark([{ learnerId: L.p3, status: 'absent' }]));
      const s = (await admin.get(`/api/admin/attendance/sessions?cohortId=${cohortId}`)).body.sessions.find((x) => x.id === weekly.id);
      assert.deepEqual({ marked: s.marked, rate: s.rate }, { marked: 4, rate: 66.7 });
    });
    it('refuses marks for learners outside the class, invalid statuses, and archived cohorts', async () => {
      const mark = (id, records) => admin.put(`/api/admin/attendance/sessions/${id}/records`, { records });
      assert.equal((await mark(extra, [{ learnerId: L.d1, status: 'present' }])).status, 400, 'DA learner, PM-only class');
      assert.equal((await mark(weekly.id, [{ learnerId: L.w1, status: 'present' }])).status, 400, 'withdrawn');
      assert.equal((await mark(weekly.id, [{ learnerId: L.p1, status: 'maybe' }])).status, 400);
      await h.db.query(`update cohorts set status = 'archived', is_active = false where id = $1`, [cohortId]);
      assert.equal((await mark(weekly.id, [{ learnerId: L.p1, status: 'present' }])).status, 409);
      await h.db.query(`update cohorts set status = 'active', is_active = true where id = $1`, [cohortId]);
    });
    it('summarises each learner (excused and unmarked left out of the rate) and protects recorded attendance', async () => {
      ok(await admin.put(`/api/admin/attendance/sessions/${extra}/records`, { records: [{ learnerId: L.p1, status: 'absent' }, { learnerId: L.p2, status: 'present' }] }));
      const sum = (await admin.get(`/api/admin/attendance/summary?cohortId=${cohortId}`)).body;
      const row = (n) => sum.learners.find((l) => l.name === n);
      assert.equal(row('Zainab Alpha').rate, 50); assert.equal(row('Bola Bravo').rate, 100, 'late counts as attended');
      assert.equal(row('Dayo Delta').rate, null, 'only excused so far: no rate, not 0%'); assert.ok(row('Dayo Delta').cells.includes('n/a'));
      assert.equal((await admin.del(`/api/admin/attendance/sessions/${extra}`)).status, 409, 'has marks');
      assert.equal((await admin.del(`/api/admin/attendance/sessions/${weekly.id}`)).status, 409, 'standard class');
      assert.equal((await admin.patch(`/api/admin/attendance/sessions/${weekly.id}`, { title: 'Renamed' })).status, 400);
      ok(await admin.patch(`/api/admin/attendance/sessions/${weekly.id}`, { heldOn: '2026-10-04' }));
      const blank = (await admin.post(`/api/admin/attendance/sessions?cohortId=${cohortId}`, { title: 'Mistaken class', heldOn: '2026-10-20' })).body.id;
      ok(await admin.del(`/api/admin/attendance/sessions/${blank}`));
    });
    it('is admin-only', async () => {
      const learner = actor(h.base); ok(await learner.post('/api/auth/learner/login', { email: 'p1@example.test', password: PW }));
      assert.equal((await learner.get(`/api/admin/attendance/sessions?cohortId=${cohortId}`)).status, 401);
    });
  });

  describe('cohort report', () => {
    let rid; let version;
    const narrative = {
      summary: 'A strong cohort overall.',
      activities: [{ title: 'Demo day', date: '2026-11-14', description: 'Learners presented to partners.' }, { title: '', date: '', description: '' }],
      risks: [{ risk: 'Facilitator availability', severity: 'high', mitigation: 'Cover rota agreed' }],
      lessons: ['Start onboarding earlier', ''], recommendations: 'Run an orientation call in week 0.',
      custom: [{ heading: 'Partner notes', body: 'Use <script>alert(1)</script> & "quotes"\u0001 safely' }],
    };
    it('creates a draft, saves the human-written sections, and refuses to overwrite a newer save', async () => {
      const r = await admin.post(`/api/admin/reports?cohortId=${cohortId}`, {}); ok(r, 201);
      rid = r.body.report.id; version = r.body.report.version;
      assert.equal(r.body.report.sections.learnerTable, false, 'names are opt-in');
      const saved = await admin.put(`/api/admin/reports/${rid}`, { title: 'Cohort 21 Report', sections: { learnerTable: false }, narrative, version }); ok(saved);
      const stale = version; version = saved.body.report.version;
      const conflict = await admin.put(`/api/admin/reports/${rid}`, { title: 'Mine', narrative, version: stale });
      assert.equal(conflict.status, 409); assert.match(conflict.body.error, /Someone else/);
      assert.equal((await admin.get(`/api/admin/reports/${rid}`)).body.report.title, 'Cohort 21 Report');
      assert.equal((await admin.put(`/api/admin/reports/${rid}`, { title: 'Ok title', narrative: { summary: 'x'.repeat(10001) }, version })).status, 400);
    });
    it('shows the system figures from real data (excluding withdrawn learners)', async () => {
      h.sheetData.set(21, [['Name', 'Email', 'Stack'],
        sheetRow('p1@example.test', 'Product Management', ['5', '5', '5', '5', '5', '5'], ['4', '8', '8', '8', '8'], '2.5', '2.5', '16'),
        sheetRow('p2@example.test', 'Product Management', ['5', '5', '0', '0', '0', '0'], ['2', '4', '0', '0', '0']),
        sheetRow('p3@example.test', 'Product Management', ['', '', '', '', '', ''], ['', '', '', '', '']),
        sheetRow('d1@example.test', 'Data Analysis', ['5', '5', '5', '5', '5', '0'], ['3', '6', '6', '6', '6'])]);
      const fac = await mkUser('fac@example.test', 'Fran Facilitator', 'facilitator');
      await h.db.query('insert into facilitator_assignments (facilitator_id, cohort_id, stack_id) values ($1,$2,$3)', [fac, cohortId, pm]);
      await h.db.query(`update learners set capstone_qualified = true where id = $1`, [L.p1]);
      await h.db.query(`insert into feedback (cohort_id, name, email, category, message, status) values ($1,'A','a@example.test','bug','Broken page here','open'), ($1,'B','b@example.test','suggestion','Please add more time','resolved')`, [cohortId]);
      const d = (await admin.get(`/api/admin/reports/${rid}/data`)).body.data;
      assert.deepEqual({ e: d.overview.enrolled, a: d.overview.active, w: d.overview.withdrawn }, { e: 6, a: 5, w: 1 });
      assert.deepEqual({ scored: d.performance.scored, mean: d.performance.mean, median: d.performance.median }, { scored: 3, mean: 51.7, median: 52 });
      assert.deepEqual(d.performance.distribution, { A: 1, B: 1, C: 0, Fail: 1 });
      assert.equal(d.attendance.overallRate, 60, '3 attended of 5 counted; excused left out');
      assert.deepEqual({ q: d.capstone.qualified, nc: d.capstone.notConfirmed }, { q: 1, nc: 4 });
      assert.deepEqual({ t: d.feedback.total, o: d.feedback.open }, { t: 2, o: 1 });
      assert.deepEqual(d.facilitators, [{ name: 'Fran Facilitator', stacks: ['Product Management'] }]);
      assert.equal(d.risk.atRisk + d.risk.onTrack, 5, 'the withdrawn learner is not counted');
      assert.equal(d.learnerTable, undefined, 'not requested, not computed');
    });
    it('downloads a Word document with the chosen sections and the written text, safely escaped', async () => {
      const r = await download(rid);
      assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /wordprocessingml\.document/);
      assert.match(r.headers.get('content-disposition'), /attachment; filename="Cohort-21-Report\.docx"/);
      const xml = docXml(r.buf);
      for (const t of ['Executive summary', 'A strong cohort overall.', 'Cohort overview', 'Learner performance', 'Attendance', 'Demo day', 'Facilitator availability', 'Cover rota agreed', 'Lessons learned', 'Start onboarding earlier', 'Recommendations', 'Partner notes', 'Admin Person']) assert.ok(xml.includes(t), `should contain "${t}"`);
      assert.ok(xml.includes('&lt;script&gt;') && !xml.includes('<script>'), 'markup is escaped'); assert.ok(!xml.includes('\u0001'));
      for (const n of ['Zainab Alpha', 'Bola Bravo', 'Dayo Delta']) assert.ok(!xml.includes(n), `names stay out unless the learner table is on: ${n}`);
      assert.ok((await h.db.query('select last_downloaded_at from cohort_reports where id = $1', [rid])).rows[0].last_downloaded_at);
    });
    it('leaves out switched-off sections, adds the learner table only when asked, and survives a sheet outage', async () => {
      const cur = (await admin.get(`/api/admin/reports/${rid}`)).body.report;
      ok(await admin.put(`/api/admin/reports/${rid}`, { title: cur.title, narrative: cur.narrative, version: cur.version, sections: { ...cur.sections, attendance: false, risks: false, lessons: false, learnerTable: true } }));
      const xml = docXml((await download(rid)).buf);
      assert.ok(!xml.includes('Overall attendance') && !xml.includes('Facilitator availability') && !xml.includes('Lessons learned'));
      assert.ok(xml.includes('Learner table') && xml.includes('Zainab Alpha') && !xml.includes('Withdrawn Person'));
      h.sheetData.delete(21);
      const d = (await admin.get(`/api/admin/reports/${rid}/data`)).body.data;
      assert.ok(d.notices.some((n) => /grading sheet could not be read/.test(n)));
      const r = await download(rid); assert.equal(r.status, 200); assert.ok(docXml(r.buf).includes('grading sheet could not be read'));
    });
    it('is admin-only and drafts can be deleted', async () => {
      const learner = actor(h.base); ok(await learner.post('/api/auth/learner/login', { email: 'p1@example.test', password: PW }));
      assert.equal((await learner.get(`/api/admin/reports/${rid}/download`)).status, 401);
      ok(await admin.del(`/api/admin/reports/${rid}`));
      assert.equal((await admin.get(`/api/admin/reports/${rid}`)).status, 404);
    });
  });

  it('Cohort 9 canary: no attendance or reports were created for it', async () => {
    assert.equal((await h.db.query('select count(*)::int n from attendance_sessions where cohort_id = $1', [c9])).rows[0].n, 0);
    assert.equal((await h.db.query('select count(*)::int n from cohort_reports where cohort_id = $1', [c9])).rows[0].n, 0);
  });
});
