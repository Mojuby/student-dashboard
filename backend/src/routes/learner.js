const router = require('express').Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { wrap, httpError, uuid } = require('../lib/http');
const logger = require('../lib/logger');
const { normalizeDocUrl } = require('../lib/urls');
const { windowState } = require('../lib/assessmentState');
const { computeTotals } = require('../lib/grading');
const { gradeQuiz, publicQuestion } = require('../lib/quiz');
const { fetchCohortRows, buildDashboard } = require('../services/sheets');
const { loadProgress } = require('../services/progress');
const { getOrientation, completeOrientationItem } = require('../services/onboarding');
const storage = require('../services/storage');

const withCode = (err, code) => Object.assign(err, { errorCode: code });

// The learner and cohort are always derived from the session's own enrolments, never from an id in the request.
// If a learner is enrolled in several active cohorts, the most recent one is used.
async function getLearner(profileId) {
  const { rows: [l] } = await query(
    `select l.id, l.email, l.full_name, l.status, l.cohort_id, l.stack_id, l.capstone_qualified, s.name as stack,
            c.number, c.name as cohort_name, c.timezone, c.status as cohort_status, c.week1_class_date::text as week1_class_date
     from learners l join cohorts c on c.id = l.cohort_id join stacks s on s.id = l.stack_id
     where l.profile_id = $1 and c.status = 'active' and l.status <> 'withdrawn'
     order by c.number desc limit 1`, [profileId]);
  if (!l) throw httpError(403, 'Your cohort is not currently active.');
  return l;
}

// An assessment applies to a learner when it is for the whole cohort or for the learner's own stack, and a stack-specific
// assessment for the same week replaces the cohort-wide one for that stack. $c = cohort id, $s = stack id.
const applicable = (c, s) => `a.cohort_id = ${c}::uuid and a.is_enabled and (a.stack_id is null or a.stack_id = ${s}::uuid)
  and not (a.stack_id is null and exists (select 1 from assessments s2 where s2.cohort_id = a.cohort_id and s2.week_number = a.week_number and s2.stack_id = ${s}::uuid))`;
const extendedDue = (learnerParam) => `greatest(a.due_at, coalesce((select max(e.new_due_at) from deadline_extensions e where e.assessment_id = a.id and e.learner_id = ${learnerParam}::uuid), a.due_at))`;

// Capstone events are only for learners explicitly marked qualified (unknown counts as not qualified), plus facilitators.
const eventAudience = (qualifiedParam) => `(e.audience = 'everyone' and e.event_type <> 'capstone_milestone' or ${qualifiedParam}::boolean is true)`;

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

  // A PUBLISHED grade saved in the LMS (or an auto-graded quiz) overrides the sheet's assessment column for that week.
  // Drafts are never shown to the learner.
  const { rows: grades } = await query(
    `select a.week_number, g.score from grades g join submissions s on s.id = g.submission_id
       join assessments a on a.id = s.assessment_id where s.learner_id = $1 and g.published_at is not null
     union all
     select a.week_number, qa.score from quiz_attempts qa join assessments a on a.id = qa.assessment_id where qa.learner_id = $1`, [l.id]);
  for (const g of grades) data.assessments[`w${g.week_number}`] = Number(g.score);
  data.totals = computeTotals(data);
  data.hasScores = data.totals.hasScores;
  res.json(data);
}));

const eventRow = (e) => ({ id: e.id, title: e.title, description: e.description, eventType: e.event_type, startsAt: e.starts_at, endsAt: e.ends_at, linkUrl: e.link_url });

router.get('/overview', wrap(async (req, res) => {
  const l = await getLearner(req.user.id);
  const progress = await loadProgress({ cohortId: l.cohort_id, learnerId: l.id, learnerView: true });
  const me = progress.learners[0];
  if (!me) throw httpError(404, 'Your enrolment could not be found.');
  const now = new Date();

  const [ev, grp, ann, orientation, enrol, detail, files] = await Promise.all([
    query(
      `select e.id, e.title, e.description, e.event_type, e.starts_at, e.ends_at, e.link_url from events e
       where e.cohort_id = $1 and e.is_active and (e.stack_id is null or e.stack_id = $2) and ${eventAudience('$3')}
         and coalesce(e.ends_at, e.starts_at) >= now() order by e.starts_at limit 15`, [l.cohort_id, l.stack_id, l.capstone_qualified === true]),
    query(`select g.name, g.whatsapp_url from capstone_members m join capstone_groups g on g.id = m.group_id where m.learner_id = $1`, [l.id]),
    query(
      `select id, title, body, created_at from announcements
       where cohort_id = $1 and is_active and (stack_id is null or stack_id = $2) order by created_at desc limit 10`, [l.cohort_id, l.stack_id]),
    getOrientation(l.id),
    query(`select count(*)::int as n from learners where profile_id = $1 and status <> 'withdrawn'`, [req.user.id]),
    query('select id, instructions from assessments where cohort_id = $1', [l.cohort_id]),
    query(
      `select f.id, f.assessment_id, f.file_name, f.size_bytes from assessment_files f join assessments a on a.id = f.assessment_id
       where a.cohort_id = $1 order by f.created_at`, [l.cohort_id]),
  ]);
  const instructions = new Map(detail.rows.map((r) => [r.id, r.instructions]));
  const filesBy = new Map();
  for (const f of files.rows) filesBy.set(f.assessment_id, [...(filesBy.get(f.assessment_id) || []), { id: f.id, name: f.file_name, size: f.size_bytes }]);

  // Assessment dates come from the assessment schedule itself (including this learner's extensions).
  const derived = me.cells.filter((c) => c.isEnabled).flatMap((c) => [
    { title: `Week ${c.weekNumber} assessment opens`, eventType: 'assessment_open', startsAt: c.opensAt },
    { title: `Week ${c.weekNumber} assessment due`, eventType: 'assessment_deadline', startsAt: c.dueAt },
  ]).filter((e) => new Date(e.startsAt) >= now);
  const events = [...ev.rows.map(eventRow), ...derived].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)).slice(0, 12);
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
      id: c.assessmentId, weekNumber: c.weekNumber, title: c.title, maxScore: c.maxScore, kind: c.kind,
      opensAt: c.opensAt, dueAt: c.dueAt, status: c.status, gradeState: c.gradeState,
      // Instructions and files stay hidden until the assessment actually opens (same rule the download endpoint enforces).
      instructions: new Date(c.opensAt) > now ? null : (instructions.get(c.assessmentId) || null),
      files: new Date(c.opensAt) > now ? [] : (filesBy.get(c.assessmentId) || []),
      submission: c.url ? { url: c.url, submittedAt: c.submittedAt } : null,
      editedAfterGrade: c.resubmitted,
      score: c.score, feedback: c.feedback, // null until a facilitator publishes: never a fake zero
    })),
    group: grp.rows[0] ? { name: grp.rows[0].name, whatsappUrl: grp.rows[0].whatsapp_url } : null, // read-only
    events,
  });
}));

// The learner's full class schedule (past and upcoming) for the calendar and list views.
router.get('/events', wrap(async (req, res) => {
  const l = await getLearner(req.user.id);
  const [ev, asm] = await Promise.all([
    query(
      `select e.id, e.title, e.description, e.event_type, e.starts_at, e.ends_at, e.link_url from events e
       where e.cohort_id = $1 and e.is_active and (e.stack_id is null or e.stack_id = $2) and ${eventAudience('$3')}
       order by e.starts_at limit 500`, [l.cohort_id, l.stack_id, l.capstone_qualified === true]),
    loadProgress({ cohortId: l.cohort_id, learnerId: l.id, learnerView: true }),
  ]);
  const cells = (asm.learners[0]?.cells || []).filter((c) => c.isEnabled);
  const derived = cells.flatMap((c) => [
    { title: `Week ${c.weekNumber} ${c.kind === 'quiz' ? 'quiz' : 'assessment'} opens`, eventType: 'assessment_open', startsAt: c.opensAt },
    { title: `Week ${c.weekNumber} ${c.kind === 'quiz' ? 'quiz' : 'assessment'} due`, eventType: 'assessment_deadline', startsAt: c.dueAt },
  ]);
  res.json({ timezone: l.timezone, stack: l.stack, events: [...ev.rows.map(eventRow), ...derived].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt)) });
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

// A submission stays editable until the deadline (including any personal extension), even after a grade was saved or
// published. Editing after grading is recorded so the facilitator sees it needs another look.
router.put('/assessments/:id/submission', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ url: z.string().max(2048) }).safeParse(req.body);
  const url = p.success ? normalizeDocUrl(p.data.url) : null;
    if (!url) throw httpError(400, 'Enter a valid Google link: Docs, Sheets, Slides, Forms or a Drive file or folder (it must start with https://).');
  const l = await getLearner(req.user.id);

  // The deadline rule lives in the WHERE clause, so a manipulated frontend or direct API call cannot bypass it.
  // The assessment must belong to the learner's own cohort and apply to their stack.
  const saved = await tx(async (c) => {
    const { rows: [row] } = await c.query(
      `insert into submissions (assessment_id, learner_id, url)
       select a.id, $2::uuid, $3::text from assessments a
       where a.id = $1::uuid and a.kind = 'assignment' and ${applicable('$4', '$5')}
         and now() >= a.opens_at and now() <= ${extendedDue('$2')}
       on conflict (assessment_id, learner_id) do update set url = excluded.url, updated_at = now()
       returning id, submitted_at`, [id, l.id, url, l.cohort_id, l.stack_id]);
    if (row) await c.query('insert into submission_revisions (submission_id, url) values ($1,$2)', [row.id, url]);
    return row;
  });

  if (!saved) {
    const { rows: [a] } = await query(
      `select a.kind, a.opens_at, a.is_enabled, ${extendedDue('$3')} as due_at from assessments a where a.id = $1 and ${applicable('$2', '$4')}`,
      [id, l.cohort_id, l.id, l.stack_id]);
    if (!a) throw httpError(404, 'Assessment not found');
    if (a.kind === 'quiz') throw httpError(400, 'This is a quiz. Open it to answer the questions.');
    const w = windowState({ now: new Date(), opensAt: a.opens_at, dueAt: a.due_at, isEnabled: a.is_enabled });
    if (w === 'locked' || w === 'disabled') throw httpError(403, 'This assessment has not opened yet.');
    throw httpError(403, 'The deadline for this assessment has passed.');
  }
  res.json({ ok: true, submittedAt: saved.submitted_at });
}));

// ---------------------------------------------------------------- quizzes
async function loadQuizAssessment(l, id) {
  const { rows: [a] } = await query(
    `select a.id, a.title, a.max_score, a.opens_at, a.is_enabled, ${extendedDue('$3')} as due_at from assessments a
     where a.id = $1 and a.kind = 'quiz' and ${applicable('$2', '$4')}`, [id, l.cohort_id, l.id, l.stack_id]);
  if (!a) throw httpError(404, 'Quiz not found');
  return a;
}

router.get('/assessments/:id/quiz', wrap(async (req, res) => {
  const l = await getLearner(req.user.id);
  const a = await loadQuizAssessment(l, uuid(req.params.id));
  const { rows: [attempt] } = await query('select score, submitted_at from quiz_attempts where assessment_id = $1 and learner_id = $2', [a.id, l.id]);
  if (attempt) return res.json({ attempted: true, title: a.title, score: Number(attempt.score), maxScore: Number(a.max_score), submittedAt: attempt.submitted_at });
  const w = windowState({ now: new Date(), opensAt: a.opens_at, dueAt: a.due_at, isEnabled: a.is_enabled });
  if (w === 'locked' || w === 'disabled') throw httpError(403, 'This quiz has not opened yet.');
  if (w === 'closed') throw httpError(403, 'The deadline for this quiz has passed.');
  const { rows } = await query('select id, position, prompt, qtype, options, points from quiz_questions where assessment_id = $1 order by position', [a.id]);
  res.json({ attempted: false, title: a.title, maxScore: Number(a.max_score), dueAt: a.due_at, questions: rows.map(publicQuestion) });
}));

// One attempt per learner. Graded immediately; the score counts from the moment it is handed in.
router.post('/assessments/:id/quiz', wrap(async (req, res) => {
  const p = z.object({ answers: z.record(z.string(), z.array(z.string().max(20)).max(8)) }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Answer the questions and try again');
  const l = await getLearner(req.user.id);
  const a = await loadQuizAssessment(l, uuid(req.params.id));
  const w = windowState({ now: new Date(), opensAt: a.opens_at, dueAt: a.due_at, isEnabled: a.is_enabled });
  if (w === 'locked' || w === 'disabled') throw httpError(403, 'This quiz has not opened yet.');
  if (w === 'closed') throw httpError(403, 'The deadline for this quiz has passed.');
  const { rows: questions } = await query('select id, points, correct from quiz_questions where assessment_id = $1', [a.id]);
  if (!questions.length) throw httpError(409, 'This quiz has no questions yet.');
  const result = gradeQuiz(questions, p.data.answers, a.max_score);
  const { rows: [row] } = await query(
    `insert into quiz_attempts (assessment_id, learner_id, answers, points_earned, points_total, score) values ($1,$2,$3,$4,$5,$6)
     on conflict (assessment_id, learner_id) do nothing returning submitted_at`,
    [a.id, l.id, JSON.stringify(p.data.answers), result.earned, result.total, result.score]);
  if (!row) throw httpError(409, 'You have already submitted this quiz.');
  res.status(201).json({ ok: true, score: result.score, maxScore: Number(a.max_score), submittedAt: row.submitted_at });
}));

// ---------------------------------------------------------------- assessment files (signed, short-lived links)
router.get('/assessments/:id/files/:fileId/url', wrap(async (req, res) => {
  const l = await getLearner(req.user.id);
  const { rows: [f] } = await query(
    `select f.storage_path, f.file_name from assessment_files f join assessments a on a.id = f.assessment_id
     where f.id = $1 and a.id = $2 and ${applicable('$3', '$4')} and now() >= a.opens_at`,
    [uuid(req.params.fileId), uuid(req.params.id), l.cohort_id, l.stack_id]);
  if (!f) throw httpError(404, 'File not found');
  res.json({ url: await storage.signedUrl(f.storage_path, f.file_name) });
}));

// ---------------------------------------------------------------- in-app feedback
const feedbackSchema = z.object({
  category: z.enum(['bug', 'content', 'access', 'suggestion', 'other']),
  message: z.string().trim().min(5).max(2000),
  pageUrl: z.string().trim().max(300).optional(),
});

// Name, email, stack and cohort are copied from the signed-in learner on the server; the form cannot supply or change them.
router.post('/feedback', wrap(async (req, res) => {
  const p = feedbackSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose a category and describe the problem (at least 5 characters)');
  const l = await getLearner(req.user.id);
  const { rows: [recent] } = await query(`select count(*)::int as n from feedback where profile_id = $1 and created_at > now() - interval '1 hour'`, [req.user.id]);
  if (recent.n >= 5) throw httpError(429, 'You have sent several messages recently. Please wait a little before sending another.');
  const { rows: [f] } = await query(
    `insert into feedback (learner_id, profile_id, cohort_id, name, email, stack, cohort_name, category, message, page_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
    [l.id, req.user.id, l.cohort_id, l.full_name, l.email, l.stack, l.cohort_name, p.data.category, p.data.message, p.data.pageUrl || null]);
  res.status(201).json({ ok: true, id: f.id });
}));

module.exports = router;
