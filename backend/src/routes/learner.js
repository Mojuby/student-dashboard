const router = require('express').Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { wrap, httpError, uuid } = require('../lib/http');
const logger = require('../lib/logger');
const { normalizeDocUrl } = require('../lib/urls');
const { windowState } = require('../lib/assessmentState');
const { computeTotals } = require('../lib/grading');
const { fetchCohortRows, buildDashboard } = require('../services/sheets');
const { loadProgress } = require('../services/progress');
const { getOrientation, completeOrientationItem } = require('../services/onboarding');

const withCode = (err, code) => Object.assign(err, { errorCode: code });

// The learner and cohort are always derived from the session's own enrolments, never from an id in the request.
// If a learner is enrolled in several active cohorts, the most recent one is used.
async function getLearner(profileId) {
  const { rows: [l] } = await query(
    `select l.id, l.email, l.full_name, l.status, l.cohort_id, l.stack_id, s.name as stack,
            c.number, c.name as cohort_name, c.timezone, c.status as cohort_status, c.week1_class_date::text as week1_class_date
     from learners l join cohorts c on c.id = l.cohort_id join stacks s on s.id = l.stack_id
     where l.profile_id = $1 and c.status = 'active' and l.status <> 'withdrawn'
     order by c.number desc limit 1`, [profileId]);
  if (!l) throw httpError(403, 'Your cohort is not currently active.');
  return l;
}

router.get('/dashboard', wrap(async (req, res) => {
  const l = await getLearner(req.user.id);
  let rows;
  try {
    rows = await fetchCohortRows(l.number);
  } catch (e) {
    logger.error('learner.dashboard.sheet_failed', { requestId: req.id, message: e.message });
    throw withCode(httpError(503, 'Your grades are temporarily unavailable. Please try again shortly.'), 'GRADES_UNAVAILABLE');
  }
  const row = rows.slice(1).find((r) => String(r[1] || '').toLowerCase().trim() === l.email.toLowerCase());
  if (!row) throw withCode(httpError(404, 'Your grades are not available yet.'), 'NO_GRADE_RECORD');
  const data = buildDashboard(row, l.number);

  // A PUBLISHED grade saved in the LMS overrides the sheet's assessment column for that week.
  // Drafts are never shown to the learner.
  const { rows: grades } = await query(
    `select a.week_number, g.score from grades g join submissions s on s.id = g.submission_id
     join assessments a on a.id = s.assessment_id where s.learner_id = $1 and g.published_at is not null`, [l.id]);
  for (const g of grades) data.assessments[`w${g.week_number}`] = Number(g.score);
  data.totals = computeTotals(data);
  data.hasScores = data.totals.hasScores;
  res.json(data);
}));

router.get('/overview', wrap(async (req, res) => {
  const l = await getLearner(req.user.id);
  const progress = await loadProgress({ cohortId: l.cohort_id, learnerId: l.id, learnerView: true });
  const me = progress.learners[0];
  if (!me) throw httpError(404, 'Your enrolment could not be found.');
  const now = new Date();

  const [ev, grp, ann, orientation, enrol] = await Promise.all([
    query(
      `select id, title, description, event_type, starts_at, ends_at, link_url from events
       where cohort_id = $1 and is_active and (stack_id is null or stack_id = $2) and coalesce(ends_at, starts_at) >= now()
       order by starts_at limit 15`, [l.cohort_id, l.stack_id]),
    query(`select g.name, g.whatsapp_url from capstone_members m join capstone_groups g on g.id = m.group_id where m.learner_id = $1`, [l.id]),
    query(
      `select id, title, body, created_at from announcements
       where cohort_id = $1 and is_active and (stack_id is null or stack_id = $2) order by created_at desc limit 10`, [l.cohort_id, l.stack_id]),
    getOrientation(l.id),
    query(`select count(*)::int as n from learners where profile_id = $1 and status <> 'withdrawn'`, [req.user.id]),
  ]);

  // Assessment dates come from the assessment schedule itself (including this learner's extensions).
  const derived = me.cells.filter((c) => c.isEnabled).flatMap((c) => [
    { title: `Week ${c.weekNumber} assessment opens`, eventType: 'assessment_open', startsAt: c.opensAt },
    { title: `Week ${c.weekNumber} assessment due`, eventType: 'assessment_deadline', startsAt: c.dueAt },
  ]).filter((e) => new Date(e.startsAt) >= now);
  const events = [
    ...ev.rows.map((e) => ({ title: e.title, description: e.description, eventType: e.event_type, startsAt: e.starts_at, endsAt: e.ends_at, linkUrl: e.link_url })),
    ...derived,
  ].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)).slice(0, 12);
  const nextClass = ev.rows.find((e) => e.event_type === 'class');

  res.json({
    timezone: l.timezone,
    learner: { name: l.full_name, email: l.email, status: l.status },
    cohort: { number: l.number, name: l.cohort_name, week1ClassDate: l.week1_class_date },
    stack: l.stack,
    enrolmentCount: enrol.rows[0].n,
    orientation: { required: ['activated', 'orientation'].includes(l.status), ...orientation },
    announcements: ann.rows.map((a) => ({ id: a.id, title: a.title, body: a.body, createdAt: a.created_at })),
    nextClass: nextClass ? { title: nextClass.title, startsAt: nextClass.starts_at, linkUrl: nextClass.link_url } : null,
    assessments: me.cells.filter((c) => c.isEnabled).map((c) => ({
      id: c.assessmentId, weekNumber: c.weekNumber, title: c.title, maxScore: c.maxScore,
      opensAt: c.opensAt, dueAt: c.dueAt, status: c.status, gradeState: c.gradeState,
      submission: c.url ? { url: c.url, submittedAt: c.submittedAt } : null,
      score: c.score, feedback: c.feedback, // null until a facilitator publishes: never a fake zero
    })),
    group: grp.rows[0] ? { name: grp.rows[0].name, whatsappUrl: grp.rows[0].whatsapp_url } : null, // read-only
    events,
  });
}));

router.get('/orientation', wrap(async (req, res) => {
  const l = await getLearner(req.user.id);
  res.json({ status: l.status, ...(await getOrientation(l.id)) });
}));

router.post('/orientation/:key', wrap(async (req, res) => {
  const l = await getLearner(req.user.id);
  const orientation = await completeOrientationItem(l.id, String(req.params.key));
  const { rows: [now] } = await query('select status from learners where id = $1', [l.id]);
  res.json({ status: now.status, ...orientation });
}));

router.put('/assessments/:id/submission', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ url: z.string().max(2048) }).safeParse(req.body);
  const url = p.success ? normalizeDocUrl(p.data.url) : null;
  if (!url) throw httpError(400, 'Enter a valid Google Docs link or Google Drive folder link (https).');
  const l = await getLearner(req.user.id);

  // The deadline rule lives in the WHERE clause, so a manipulated frontend or direct API call cannot bypass it.
  // The assessment must belong to the learner's own cohort.
  const saved = await tx(async (c) => {
    const { rows: [row] } = await c.query(
      `insert into submissions (assessment_id, learner_id, url)
       select a.id, $2::uuid, $3::text from assessments a
       where a.id = $1::uuid and a.cohort_id = $4::uuid and a.is_enabled
         and now() >= a.opens_at
         and now() <= greatest(a.due_at, coalesce(
               (select max(e.new_due_at) from deadline_extensions e where e.assessment_id = a.id and e.learner_id = $2::uuid), a.due_at))
         and not exists (select 1 from grades g join submissions s on s.id = g.submission_id
                         where s.assessment_id = a.id and s.learner_id = $2::uuid)
       on conflict (assessment_id, learner_id) do update set url = excluded.url, updated_at = now()
       returning id, submitted_at`, [id, l.id, url, l.cohort_id]);
    if (row) await c.query('insert into submission_revisions (submission_id, url) values ($1,$2)', [row.id, url]);
    return row;
  });

  if (!saved) {
    const { rows: [a] } = await query(
      `select a.opens_at, a.is_enabled,
              greatest(a.due_at, coalesce((select max(e.new_due_at) from deadline_extensions e
                       where e.assessment_id = a.id and e.learner_id = $3), a.due_at)) as due_at
       from assessments a where a.id = $1 and a.cohort_id = $2`, [id, l.cohort_id, l.id]);
    if (!a) throw httpError(404, 'Assessment not found');
    const w = windowState({ now: new Date(), opensAt: a.opens_at, dueAt: a.due_at, isEnabled: a.is_enabled });
    if (w === 'locked' || w === 'disabled') throw httpError(403, 'This assessment has not opened yet.');
    if (w === 'closed') throw httpError(403, 'The deadline for this assessment has passed.');
    throw httpError(403, 'This assessment has already been graded and can no longer be edited.');
  }
  res.json({ ok: true, submittedAt: saved.submitted_at });
}));

module.exports = router;
