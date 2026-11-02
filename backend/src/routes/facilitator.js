const router = require('express').Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { audit } = require('../lib/audit');
const { wrap, httpError, uuid } = require('../lib/http');
const { loadProgress } = require('../services/progress');

// Facilitator scope = rows in facilitator_assignments (cohort + stack). Every read and write below is joined to it,
// so changing a URL, query string or request body cannot reach a learner outside the assignment.
// Out-of-scope resources answer 404, the same as missing ones, so their existence is not revealed.
async function scopeFor(req, cohortIdParam) {
  let cohortId = cohortIdParam ? uuid(cohortIdParam) : null;
  if (!cohortId) {
    const { rows: [c] } = await query(
      `select fa.cohort_id from facilitator_assignments fa join cohorts c on c.id = fa.cohort_id
       where fa.facilitator_id = $1 and c.status = 'active' order by c.number desc limit 1`, [req.user.id]);
    if (!c) throw httpError(404, 'You have no active cohort assignment.');
    cohortId = c.cohort_id;
  }
  const { rows } = await query(
    `select fa.stack_id, c.status from facilitator_assignments fa join cohorts c on c.id = fa.cohort_id
     where fa.facilitator_id = $1 and fa.cohort_id = $2`, [req.user.id, cohortId]);
  if (!rows.length) throw httpError(404, 'Cohort not found');
  return { cohortId, stackIds: rows.map((r) => r.stack_id), cohortStatus: rows[0].status };
}
const inAssignment = (alias) => `exists (select 1 from facilitator_assignments fa where fa.facilitator_id = $FAC
  and fa.cohort_id = ${alias}.cohort_id and fa.stack_id = ${alias}.stack_id)`;

router.get('/me', wrap(async (req, res) => {
  const { rows } = await query(
    `select c.id as cohort_id, c.number as cohort_number, c.name as cohort_name, c.status as cohort_status, s.id as stack_id, s.name as stack
     from facilitator_assignments fa join cohorts c on c.id = fa.cohort_id join stacks s on s.id = fa.stack_id
     where fa.facilitator_id = $1 order by c.number desc, s.name`, [req.user.id]);
  res.json({
    assignments: rows.filter((r) => r.cohort_status === 'active').map((r) => ({ cohort_number: r.cohort_number, stack: r.stack })), // legacy shape
    cohorts: rows.map((r) => ({ cohortId: r.cohort_id, number: r.cohort_number, name: r.cohort_name, status: r.cohort_status, stackId: r.stack_id, stack: r.stack })),
  });
}));

router.get('/learners', wrap(async (req, res) => {
  const { cohortId } = await scopeFor(req, req.query.cohortId);
  const stackId = req.query.stackId ? uuid(req.query.stackId) : null;
  const q = String(req.query.q || '').trim().toLowerCase();
  const p = await loadProgress({ cohortId, facilitatorId: req.user.id, stackId });
  const learners = p.learners
    .filter((l) => !q || l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q))
    .map((l) => ({
      id: l.id, name: l.name, email: l.email, stack: l.stack, stackId: l.stackId, group: l.group,
      completionPct: l.completionPct, scorePct: l.scorePct, latestScore: l.latestScore,
      needsFollowUp: l.risk.status === 'at_risk', riskReasons: l.risk.reasons.map((r) => r.action ?? r.reason ?? r), lastActivityAt: l.lastActivityAt,
      weekStatuses: l.cells.filter((c) => c.isEnabled).map((c) => ({ week: c.weekNumber, status: c.status, gradeState: c.gradeState })),
    }));
  res.json({ cohort: { number: p.cohort.number }, learners });
}));

router.get('/assessments', wrap(async (req, res) => {
  const { cohortId, stackIds } = await scopeFor(req, req.query.cohortId);
  // Cohort-wide assessments plus any made for the facilitator's own stacks.
  const { rows } = await query(
    `select a.id, a.week_number, a.title, a.max_score, a.opens_at, a.due_at, a.kind, s.name as stack from assessments a
     left join stacks s on s.id = a.stack_id
     where a.cohort_id = $1 and a.is_enabled and (a.stack_id is null or a.stack_id = any($2::uuid[]))
     order by a.week_number, s.name nulls first`, [cohortId, stackIds]);
  res.json({ assessments: rows.map((a) => ({ id: a.id, weekNumber: a.week_number, title: a.title, maxScore: Number(a.max_score), opensAt: a.opens_at, dueAt: a.due_at, kind: a.kind, stack: a.stack })) });
}));

router.get('/submissions', wrap(async (req, res) => {
  const { cohortId, stackIds } = await scopeFor(req, req.query.cohortId);
  const assessmentId = uuid(req.query.assessmentId);
  const stackId = req.query.stackId ? uuid(req.query.stackId) : null;
  const { rows: [a] } = await query(
    'select id, week_number, title, max_score, due_at, kind from assessments where id = $1 and cohort_id = $2 and (stack_id is null or stack_id = any($3::uuid[]))',
    [assessmentId, cohortId, stackIds]);
  if (!a) throw httpError(404, 'Assessment not found');
  const { rows } = await query(
    `select l.id as learner_id, l.full_name, s.name as stack, sub.id as submission_id, sub.url, sub.submitted_at,
            g.score, g.feedback, g.published_at, g.graded_at, (g.graded_at is not null and sub.updated_at > g.graded_at) as resubmitted,
            qa.score as quiz_score, qa.submitted_at as quiz_at
     from learners l join stacks s on s.id = l.stack_id
     join assessments a on a.id = $2
     left join submissions sub on sub.assessment_id = a.id and sub.learner_id = l.id and a.kind = 'assignment'
     left join grades g on g.submission_id = sub.id
     left join quiz_attempts qa on qa.assessment_id = a.id and qa.learner_id = l.id and a.kind = 'quiz'
     where l.cohort_id = $1 and l.status <> 'withdrawn' and ($3::uuid is null or l.stack_id = $3)
       and (a.stack_id is null or a.stack_id = l.stack_id)
       and not (a.stack_id is null and exists (select 1 from assessments s2 where s2.cohort_id = a.cohort_id and s2.week_number = a.week_number and s2.stack_id = l.stack_id))
       and ${inAssignment('l').replace('$FAC', '$4')}
     order by s.name, l.full_name`, [cohortId, assessmentId, stackId, req.user.id]);
  res.json({
    assessment: { id: a.id, weekNumber: a.week_number, title: a.title, maxScore: Number(a.max_score), dueAt: a.due_at, kind: a.kind },
    submissions: rows.map((r) => ({
      learnerId: r.learner_id, name: r.full_name, stack: r.stack, submissionId: r.submission_id, url: r.url, submittedAt: r.submitted_at,
      grade: r.score == null ? null : { score: Number(r.score), feedback: r.feedback, published: !!r.published_at, gradedAt: r.graded_at },
      resubmitted: !!r.resubmitted, // the learner edited after a grade was saved
      quiz: r.quiz_score == null ? null : { score: Number(r.quiz_score), submittedAt: r.quiz_at }, // auto-graded, read-only
    })),
  });
}));

const gradeSchema = z.object({
  score: z.number().finite().min(0),
  feedback: z.string().trim().max(2000).nullable().optional(),
  publish: z.boolean().default(false),
});

// Save (or correct) a grade. Drafts are invisible to the learner until published. Every save is revisioned and audited
// inside the same transaction as the change.
router.put('/submissions/:id/grade', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = gradeSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter a numeric score (0 or more) and optional feedback');
  const { rows: [t] } = await query(
    `select sub.id, a.max_score, c.status as cohort_status, c.id as cohort_id from submissions sub
     join assessments a on a.id = sub.assessment_id join cohorts c on c.id = a.cohort_id join learners l on l.id = sub.learner_id
     where sub.id = $1 and ${inAssignment('l').replace('$FAC', '$2')}`, [id, req.user.id]);
  if (!t) throw httpError(404, 'Submission not found');
  if (t.cohort_status === 'archived') throw httpError(409, 'This cohort is archived and can no longer be graded.');
  const score = Math.round(p.data.score * 100) / 100;
  if (score > Number(t.max_score)) throw httpError(400, `Score cannot be more than ${Number(t.max_score)} for this assessment.`);
  const feedback = p.data.feedback || null;

  const saved = await tx(async (c) => {
    const { rows: [g] } = await c.query(
      `insert into grades (submission_id, score, feedback, graded_by, published_at, published_by)
       values ($1,$2,$3,$4, case when $5::boolean then now() end, case when $5::boolean then $4::uuid end)
       on conflict (submission_id) do update set score = excluded.score, feedback = excluded.feedback, graded_by = excluded.graded_by,
         graded_at = now(), updated_at = now(),
         published_at = case when $5::boolean then coalesce(grades.published_at, now()) end,
         published_by = case when $5::boolean then coalesce(grades.published_by, $4::uuid) end
       returning id, score, feedback, published_at`, [id, score, feedback, req.user.id, p.data.publish]);
    await c.query('insert into grade_revisions (grade_id, score, feedback, published, changed_by) values ($1,$2,$3,$4,$5)',
      [g.id, score, feedback, !!g.published_at, req.user.id]);
    await audit({ db: c, actorId: req.user.id, action: 'grade.save', entityType: 'submission', entityId: id, details: { score, published: !!g.published_at, cohortId: t.cohort_id }, ip: req.ip });
    return g;
  });
  res.json({ ok: true, grade: { score: Number(saved.score), feedback: saved.feedback, published: !!saved.published_at } });
}));

// Publish every saved-but-unpublished grade for one assessment within the facilitator's own scope.
router.post('/assessments/:id/publish', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const { cohortId } = await scopeFor(req, req.body?.cohortId);
  const { rows: [a] } = await query('select id from assessments where id = $1 and cohort_id = $2', [id, cohortId]);
  if (!a) throw httpError(404, 'Assessment not found');
  const stackId = req.body?.stackId ? uuid(req.body.stackId) : null;
  const n = await tx(async (c) => {
    const { rows } = await c.query(
      `update grades g set published_at = now(), published_by = $2, updated_at = now()
       from submissions sub join learners l on l.id = sub.learner_id
       where g.submission_id = sub.id and sub.assessment_id = $1 and g.published_at is null
         and ($3::uuid is null or l.stack_id = $3) and ${inAssignment('l').replace('$FAC', '$2')}
       returning g.id, g.score, g.feedback`, [id, req.user.id, stackId]);
    for (const g of rows) await c.query('insert into grade_revisions (grade_id, score, feedback, published, changed_by) values ($1,$2,$3,true,$4)', [g.id, g.score, g.feedback, req.user.id]);
    await audit({ db: c, actorId: req.user.id, action: 'grade.publish_bulk', entityType: 'assessment', entityId: id, details: { count: rows.length, cohortId }, ip: req.ip });
    return rows.length;
  });
  res.json({ ok: true, published: n });
}));

// Class schedule and links for the facilitator's own stacks (plus cohort-wide events).
router.get('/events', wrap(async (req, res) => {
  const { cohortId, stackIds } = await scopeFor(req, req.query.cohortId);
  const { rows } = await query(
    `select e.id, e.title, e.description, e.event_type, e.starts_at, e.ends_at, e.link_url, e.audience, s.name as stack from events e
     left join stacks s on s.id = e.stack_id
     where e.cohort_id = $1 and e.is_active and (e.stack_id is null or e.stack_id = any($2::uuid[])) order by e.starts_at`, [cohortId, stackIds]);
  // Assessment open/due dates for the facilitator's own stacks, shown on the calendar alongside classes.
  const { rows: asm } = await query(
    `select a.week_number, a.kind, a.opens_at, a.due_at, s.name as stack from assessments a left join stacks s on s.id = a.stack_id
     where a.cohort_id = $1 and a.is_enabled and (a.stack_id is null or a.stack_id = any($2::uuid[]))`, [cohortId, stackIds]);
  const derived = asm.flatMap((a) => {
    const noun = a.kind === 'quiz' ? 'quiz' : 'assessment';
    return [
      { title: `Week ${a.week_number} ${noun} opens`, eventType: 'assessment_open', startsAt: a.opens_at, stack: a.stack },
      { title: `Week ${a.week_number} ${noun} due`, eventType: 'assessment_deadline', startsAt: a.due_at, stack: a.stack },
    ];
  });
  const real = rows.map((e) => ({ id: e.id, title: e.title, description: e.description, eventType: e.event_type, startsAt: e.starts_at, endsAt: e.ends_at, linkUrl: e.link_url, stack: e.stack, audience: e.audience }));
  const { rows: [co] } = await query('select timezone from cohorts where id = $1', [cohortId]);
  res.json({ timezone: co.timezone, events: [...real, ...derived].sort((x, y) => new Date(x.startsAt) - new Date(y.startsAt)) });
}));

module.exports = router;
