const router = require('express').Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { audit } = require('../lib/audit');
const { wrap, httpError, uuid } = require('../lib/http');
const { attendanceRate } = require('../lib/stats');

const STATUSES = ['present', 'late', 'absent', 'excused'];
const log = (req, action, id, details) => audit({ actorId: req.user.id, action, entityType: 'attendance_session', entityId: id, details, ip: req.ip });

async function cohortOpen(cohortId) {
  const { rows: [c] } = await query('select status from cohorts where id = $1', [cohortId]);
  if (!c) throw httpError(404, 'Cohort not found');
  if (c.status === 'archived') throw httpError(409, 'This cohort is archived, so attendance can no longer be changed.');
}
async function loadSession(id) {
  const { rows: [s] } = await query('select id, cohort_id, stack_id, kind, week_number, title, held_on::text as held_on from attendance_sessions where id = $1', [id]);
  if (!s) throw httpError(404, 'Class not found');
  return s;
}
// Learners who can be marked for a class: not withdrawn, and in the class's stack if it is limited to one.
const rosterSql = `select l.id, l.full_name, l.email::text as email, st.name as stack, r.status, r.note
  from learners l join stacks st on st.id = l.stack_id left join attendance_records r on r.session_id = $2 and r.learner_id = l.id
  where l.cohort_id = $1 and l.status <> 'withdrawn' and ($3::uuid is null or l.stack_id = $3) order by st.name, l.full_name`;

// Makes sure the six standard weekly classes exist (dated on the class Saturdays). Safe to call every time.
router.post('/attendance/sessions/ensure', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  await cohortOpen(cohortId);
  const r = await query(
    `insert into attendance_sessions (cohort_id, kind, week_number, title, held_on, created_by)
     select c.id, 'weekly', n, 'Week ' || n || ' class', c.week1_class_date + (n - 1) * 7, $2 from cohorts c, generate_series(1, 6) n where c.id = $1
     on conflict (cohort_id, week_number) where kind = 'weekly' do nothing`, [cohortId, req.user.id]);
  res.json({ ok: true, created: r.rowCount });
}));

router.get('/attendance/sessions', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const { rows } = await query(
    `select s.id, s.kind, s.week_number, s.title, s.held_on::text as held_on, s.stack_id, st.name as stack,
            count(r.*) filter (where r.status = 'present')::int as present, count(r.*) filter (where r.status = 'late')::int as late,
            count(r.*) filter (where r.status = 'absent')::int as absent, count(r.*) filter (where r.status = 'excused')::int as excused,
            (select count(*)::int from learners l where l.cohort_id = s.cohort_id and l.status <> 'withdrawn' and (s.stack_id is null or l.stack_id = s.stack_id)) as eligible
     from attendance_sessions s left join stacks st on st.id = s.stack_id
     left join (select r.* from attendance_records r join learners l on l.id = r.learner_id and l.status <> 'withdrawn') r on r.session_id = s.id
     where s.cohort_id = $1 group by s.id, st.name order by s.held_on, s.created_at`, [cohortId]);
  res.json({ sessions: rows.map((s) => ({ ...s, marked: s.present + s.late + s.absent + s.excused, rate: attendanceRate(s) })) });
}));

// An EXTRA class (beyond the six standard ones), created only so attendance can be marked for it.
router.post('/attendance/sessions', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const p = z.object({ title: z.string().trim().min(2).max(120), heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), stackId: z.string().uuid().nullable().optional() }).safeParse(req.body);
  if (!p.success || Number.isNaN(Date.parse(`${p.data.heldOn}T00:00:00Z`))) throw httpError(400, 'Enter a title and the date of the class');
  await cohortOpen(cohortId);
  if (p.data.stackId && !(await query('select 1 from stacks where id = $1', [p.data.stackId])).rowCount) throw httpError(400, 'Choose a stack from the list');
  const { rows: [s] } = await query(`insert into attendance_sessions (cohort_id, kind, title, held_on, stack_id, created_by) values ($1,'extra',$2,$3,$4,$5) returning id`,
    [cohortId, p.data.title, p.data.heldOn, p.data.stackId ?? null, req.user.id]);
  await log(req, 'attendance.session_create', s.id, { cohortId, title: p.data.title, heldOn: p.data.heldOn });
  res.status(201).json({ id: s.id });
}));

router.patch('/attendance/sessions/:id', wrap(async (req, res) => {
  const s = await loadSession(uuid(req.params.id));
  await cohortOpen(s.cohort_id);
  const p = z.object({ title: z.string().trim().min(2).max(120).optional(), heldOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid class details');
  if (p.data.title && s.kind === 'weekly') throw httpError(400, 'The standard weekly classes keep their names. You can change the date.');
  await query('update attendance_sessions set title = coalesce($2, title), held_on = coalesce($3::date, held_on) where id = $1', [s.id, p.data.title ?? null, p.data.heldOn ?? null]);
  await log(req, 'attendance.session_update', s.id, p.data);
  res.json({ ok: true });
}));

// Only an extra class with nothing recorded can be deleted, so recorded attendance is never lost by accident.
router.delete('/attendance/sessions/:id', wrap(async (req, res) => {
  const s = await loadSession(uuid(req.params.id));
  await cohortOpen(s.cohort_id);
  if (s.kind === 'weekly') throw httpError(409, 'The standard weekly classes cannot be deleted.');
  if ((await query('select 1 from attendance_records where session_id = $1 limit 1', [s.id])).rowCount) throw httpError(409, 'Attendance has already been recorded for this class. Clear the marks first if you really want to delete it.');
  await query('delete from attendance_sessions where id = $1', [s.id]);
  await log(req, 'attendance.session_delete', s.id, { title: s.title });
  res.json({ ok: true });
}));

router.get('/attendance/sessions/:id/roster', wrap(async (req, res) => {
  const s = await loadSession(uuid(req.params.id));
  const { rows } = await query(rosterSql, [s.cohort_id, s.id, s.stack_id]);
  res.json({ session: s, statuses: STATUSES, learners: rows });
}));

// Saves marks for many learners at once. A null status clears that learner's mark (back to "not marked").
router.put('/attendance/sessions/:id/records', wrap(async (req, res) => {
  const s = await loadSession(uuid(req.params.id));
  await cohortOpen(s.cohort_id);
  const p = z.object({ records: z.array(z.object({ learnerId: z.string().uuid(), status: z.enum(STATUSES).nullable(), note: z.string().trim().max(300).nullable().optional() })).min(1).max(500) }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose present, late, absent or excused for each learner');
  const ids = p.data.records.map((r) => r.learnerId);
  const { rows: ok } = await query(`select id from learners where cohort_id = $1 and status <> 'withdrawn' and ($2::uuid is null or stack_id = $2) and id = any($3::uuid[])`, [s.cohort_id, s.stack_id, ids]);
  if (ok.length !== new Set(ids).size) throw httpError(400, 'Some of those learners are not in this class (wrong cohort or stack, or withdrawn).');
  const out = await tx(async (c) => {
    let saved = 0; let cleared = 0;
    for (const r of p.data.records) {
      if (r.status === null) { cleared += (await c.query('delete from attendance_records where session_id = $1 and learner_id = $2', [s.id, r.learnerId])).rowCount; continue; }
      await c.query(
        `insert into attendance_records (session_id, learner_id, status, note, marked_by) values ($1,$2,$3,$4,$5)
         on conflict (session_id, learner_id) do update set status = excluded.status, note = excluded.note, marked_by = excluded.marked_by, marked_at = now()`,
        [s.id, r.learnerId, r.status, r.note || null, req.user.id]);
      saved++;
    }
    await audit({ db: c, actorId: req.user.id, action: 'attendance.mark', entityType: 'attendance_session', entityId: s.id, details: { saved, cleared, title: s.title }, ip: req.ip });
    return { saved, cleared };
  });
  res.json({ ok: true, ...out });
}));

// Learners x classes grid with each learner's attendance rate.
router.get('/attendance/summary', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const stackId = req.query.stackId ? uuid(req.query.stackId) : null;
  const [sessions, learners, records] = await Promise.all([
    query('select id, kind, week_number, title, held_on::text as held_on, stack_id from attendance_sessions where cohort_id = $1 order by held_on, created_at', [cohortId]),
    query(`select l.id, l.full_name, st.name as stack, l.stack_id from learners l join stacks st on st.id = l.stack_id where l.cohort_id = $1 and l.status <> 'withdrawn' and ($2::uuid is null or l.stack_id = $2) order by st.name, l.full_name`, [cohortId, stackId]),
    query('select r.session_id, r.learner_id, r.status from attendance_records r join attendance_sessions s on s.id = r.session_id where s.cohort_id = $1', [cohortId]),
  ]);
  const by = new Map(records.rows.map((r) => [`${r.session_id}:${r.learner_id}`, r.status]));
  res.json({
    sessions: sessions.rows,
    learners: learners.rows.map((l) => {
      const cells = sessions.rows.map((s) => (s.stack_id && s.stack_id !== l.stack_id ? 'n/a' : by.get(`${s.id}:${l.id}`) || null));
      const t = { present: 0, late: 0, absent: 0, excused: 0 };
      for (const c of cells) if (t[c] !== undefined) t[c]++;
      return { id: l.id, name: l.full_name, stack: l.stack, cells, rate: attendanceRate(t) };
    }),
  });
}));

module.exports = router;
