const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db');
const { audit } = require('../lib/audit');
const { wrap, httpError, uuid } = require('../lib/http');
const storage = require('../services/storage');

// Facilitator scope = rows in facilitator_assignments (cohort + stack). Out-of-scope things answer 404, like missing ones.
async function scopeFor(req, cohortIdParam) {
  const cohortId = uuid(cohortIdParam);
  const { rows } = await query('select stack_id from facilitator_assignments where facilitator_id = $1 and cohort_id = $2', [req.user.id, cohortId]);
  if (!rows.length) throw httpError(404, 'Cohort not found');
  return { cohortId, stackIds: rows.map((r) => r.stack_id) };
}
// An assessment is in scope when it is cohort-wide or for one of the facilitator's stacks in a cohort they are assigned to.
const inScope = (a, fac) => `exists (select 1 from facilitator_assignments fa where fa.facilitator_id = ${fac} and fa.cohort_id = ${a}.cohort_id and (${a}.stack_id is null or ${a}.stack_id = fa.stack_id))`;

// What the admin has set for each week: instructions, files and resources. Read-only.
router.get('/assessment-overview', wrap(async (req, res) => {
  const { cohortId, stackIds } = await scopeFor(req, req.query.cohortId);
  const [asm, files, res2] = await Promise.all([
    query(`select a.id, a.week_number, a.title, a.kind, a.max_score, a.opens_at, a.due_at, a.instructions, a.is_enabled, s.name as stack from assessments a left join stacks s on s.id = a.stack_id
           where a.cohort_id = $1 and (a.stack_id is null or a.stack_id = any($2::uuid[])) order by a.week_number, s.name nulls first`, [cohortId, stackIds]),
    query('select f.id, f.assessment_id, f.file_name, f.size_bytes from assessment_files f join assessments a on a.id = f.assessment_id where a.cohort_id = $1 order by f.created_at', [cohortId]),
    query('select r.id, r.assessment_id, r.title, r.url, r.note from assessment_resources r join assessments a on a.id = r.assessment_id where a.cohort_id = $1 order by r.position, r.created_at', [cohortId]),
  ]);
  const group = (rows, key, map) => rows.reduce((m, r) => m.set(r[key], [...(m.get(r[key]) || []), map(r)]), new Map());
  const filesBy = group(files.rows, 'assessment_id', (f) => ({ id: f.id, name: f.file_name, size: f.size_bytes }));
  const resBy = group(res2.rows, 'assessment_id', (r) => ({ id: r.id, title: r.title, url: r.url, note: r.note }));
  res.json({
    assessments: asm.rows.map((a) => ({ id: a.id, weekNumber: a.week_number, title: a.title, kind: a.kind, maxScore: Number(a.max_score), opensAt: a.opens_at, dueAt: a.due_at, enabled: a.is_enabled, stack: a.stack,
      instructions: a.instructions, files: filesBy.get(a.id) || [], resources: resBy.get(a.id) || [] })),
  });
}));

router.get('/assessment-files/:fileId/url', wrap(async (req, res) => {
  const { rows: [f] } = await query(
    `select f.storage_path, f.file_name from assessment_files f join assessments a on a.id = f.assessment_id where f.id = $1 and ${inScope('a', '$2')}`, [uuid(req.params.fileId), req.user.id]);
  if (!f) throw httpError(404, 'File not found');
  res.json({ url: await storage.signedUrl(f.storage_path, f.file_name) });
}));

// Facilitators cannot edit an assessment; they ask the admin to.
router.post('/change-requests', wrap(async (req, res) => {
  const p = z.object({ assessmentId: z.string().uuid(), message: z.string().trim().min(5).max(2000) }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose the assessment and describe the change you would like (at least 5 characters)');
  const { rows: [a] } = await query(`select a.id, a.cohort_id from assessments a where a.id = $1 and ${inScope('a', '$2')}`, [p.data.assessmentId, req.user.id]);
  if (!a) throw httpError(404, 'Assessment not found');
  const { rows: [recent] } = await query(`select count(*)::int as n from assessment_change_requests where requested_by = $1 and created_at > now() - interval '1 day'`, [req.user.id]);
  if (recent.n >= 20) throw httpError(429, 'You have sent many requests today. Please wait before sending more.');
  const { rows: [r] } = await query('insert into assessment_change_requests (assessment_id, cohort_id, requested_by, message) values ($1,$2,$3,$4) returning id', [a.id, a.cohort_id, req.user.id, p.data.message]);
  await audit({ actorId: req.user.id, action: 'change_request.create', entityType: 'assessment', entityId: a.id, details: {}, ip: req.ip });
  res.status(201).json({ id: r.id });
}));

router.get('/change-requests', wrap(async (req, res) => {
  const { rows } = await query(
    `select r.id, r.message, r.status, r.admin_note, r.created_at, r.resolved_at, a.week_number, a.title, st.name as stack from assessment_change_requests r
     join assessments a on a.id = r.assessment_id left join stacks st on st.id = a.stack_id where r.requested_by = $1 order by r.created_at desc limit 100`, [req.user.id]);
  res.json({ requests: rows });
}));

// What learners wrote for their instructor, ANONYMISED (no names, no dates, shuffled) and FILTERED (notes the respectful-feedback
// filter flagged stay hidden until an admin releases them). Only from closed surveys, and only once at least 3 learners in the
// stack have responded, so a single learner cannot be identified.
const MIN_RESPONSES = 3;
router.get('/survey-notes', wrap(async (req, res) => {
  const { cohortId, stackIds } = await scopeFor(req, req.query.cohortId);
  const { rows: surveys } = await query(
    `select s.id, s.title from surveys s where s.cohort_id = $1 and s.published and s.closes_at <= now()
       and exists (select 1 from survey_questions q where q.survey_id = s.id and q.flag = 'instructor_note') order by s.closes_at desc`, [cohortId]);
  const out = [];
  for (const s of surveys) {
    for (const stackId of stackIds) {
      const { rows: [stack] } = await query('select name from stacks where id = $1', [stackId]);
      const { rows: [n] } = await query('select count(*)::int as n from survey_responses where survey_id = $1 and stack_id = $2', [s.id, stackId]);
      if (n.n < MIN_RESPONSES) { out.push({ surveyId: s.id, title: s.title, stack: stack.name, responses: n.n, held: true, notes: [] }); continue; }
      const { rows } = await query(
        `select a.value->>'text' as text from survey_answers a join survey_questions q on q.id = a.question_id and q.flag = 'instructor_note'
         join survey_responses r on r.id = a.response_id where r.survey_id = $1 and r.stack_id = $2 and (a.moderation = 'clean' or a.released)
         order by md5(a.response_id::text || $1::text)`, [s.id, stackId]);
      out.push({ surveyId: s.id, title: s.title, stack: stack.name, responses: n.n, held: false, notes: rows.map((r) => r.text).filter(Boolean) });
    }
  }
  res.json({ minResponses: MIN_RESPONSES, surveys: out });
}));

module.exports = router;
