const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { audit } = require('../lib/audit');
const logger = require('../lib/logger');
const { wrap, httpError, uuid } = require('../lib/http');
const { toUtcDate } = require('../lib/tz');
const { quizSchema } = require('../lib/quiz');
const { fetchCohortRows, buildDashboard } = require('../services/sheets');
const storage = require('../services/storage');

const log = (req, action, entityType, entityId, details) =>
  audit({ actorId: req.user.id, action, entityType, entityId, details, ip: req.ip });
const tzOf = async (cohortId) => {
  const { rows: [c] } = await query('select timezone from cohorts where id = $1', [cohortId]);
  if (!c) throw httpError(404, 'Cohort not found');
  return c.timezone;
};
const localDate = (v, tz) => { try { return toUtcDate(v, tz); } catch { throw httpError(400, 'Invalid date or time'); } };

router.get('/cohort-stacks', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const { rows } = await query('select s.id, s.name from cohort_stacks cs join stacks s on s.id = cs.stack_id where cs.cohort_id = $1 order by s.name', [cohortId]);
  res.json({ stacks: rows });
}));

// ---------------------------------------------------------------- assessments (assignments and quizzes, cohort-wide or per stack)
const createSchema = z.object({
  weekNumber: z.number().int().min(1).max(6),
  stackId: z.string().uuid().nullable().optional(),
  kind: z.enum(['assignment', 'quiz']),
  title: z.string().trim().min(2).max(120),
  maxScore: z.number().positive().max(1000),
  opensAtLocal: z.string(),
  dueAtLocal: z.string(),
  instructions: z.string().trim().max(10000).nullable().optional(),
});

router.post('/assessments', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const p = createSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose the week, type, title, score, and opening and due dates');
  const tz = await tzOf(cohortId);
  const opens = localDate(p.data.opensAtLocal, tz);
  const due = localDate(p.data.dueAtLocal, tz);
  if (!(due > opens)) throw httpError(400, 'The deadline must be after the opening date');
  if (p.data.stackId && !(await query('select 1 from stacks where id = $1 and is_active', [p.data.stackId])).rowCount) throw httpError(400, 'Choose an active stack');
  let row;
  try {
    ({ rows: [row] } = await query(
      `insert into assessments (cohort_id, week_number, title, max_score, opens_at, due_at, stack_id, kind, instructions, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
      [cohortId, p.data.weekNumber, p.data.title, p.data.maxScore, opens, due, p.data.stackId ?? null, p.data.kind, p.data.instructions || null, req.user.id]));
  } catch (e) {
    if (e.code === '23505') throw httpError(409, 'There is already an assessment for that week and stack in this cohort. Edit it instead.');
    throw e;
  }
  await log(req, 'assessment.create', 'assessment', row.id, { cohortId, week: p.data.weekNumber, kind: p.data.kind, stackId: p.data.stackId ?? null });
  res.status(201).json({ id: row.id });
}));

const workCount = async (id) => (await query(
  `select ((select count(*) from submissions where assessment_id = $1) + (select count(*) from quiz_attempts where assessment_id = $1))::int as n`, [id])).rows[0].n;

router.patch('/assessments/:id/details', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({
    title: z.string().trim().min(2).max(120).optional(),
    instructions: z.string().trim().max(10000).nullable().optional(),
    maxScore: z.number().positive().max(1000).optional(),
  }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid assessment details');
  const { rows: [a] } = await query('select max_score from assessments where id = $1', [id]);
  if (!a) throw httpError(404, 'Assessment not found');
  if (p.data.maxScore !== undefined && Number(a.max_score) !== p.data.maxScore && (await workCount(id)) > 0) {
    throw httpError(409, 'Learners have already submitted work, so the maximum score can no longer be changed.');
  }
  await query(
    `update assessments set title = coalesce($2, title), instructions = case when $3::boolean then $4 else instructions end,
       max_score = coalesce($5, max_score) where id = $1`,
    [id, p.data.title ?? null, p.data.instructions !== undefined, p.data.instructions ?? null, p.data.maxScore ?? null]);
  await log(req, 'assessment.details', 'assessment', id, { title: p.data.title, maxScore: p.data.maxScore, instructionsChanged: p.data.instructions !== undefined });
  res.json({ ok: true });
}));

// Only an assessment nobody has worked on can be deleted; otherwise disable it from the Schedule page.
router.delete('/assessments/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const { rows: [a] } = await query('select week_number, kind from assessments where id = $1', [id]);
  if (!a) throw httpError(404, 'Assessment not found');
  if ((await workCount(id)) > 0) throw httpError(409, 'Learners have already submitted work for this assessment, so it cannot be deleted. Disable it instead.');
  const { rows: files } = await query('select storage_path from assessment_files where assessment_id = $1', [id]);
  for (const f of files) await storage.removeFile(f.storage_path).catch((e) => logger.warn('assessment.file_cleanup_failed', { message: e.message }));
  await query('delete from assessments where id = $1', [id]);
  await log(req, 'assessment.delete', 'assessment', id, { week: a.week_number, kind: a.kind });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- instruction files (non-quiz assessments)
const MAX_FILES = 10;
// The body is JSON with the file base64-encoded, so this one route accepts a larger body than the rest of the API.
// (app.js skips its small global parser for exactly this path; authentication already ran before this point.)
router.post('/assessments/:id/files', express.json({ limit: '14mb' }), wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ fileName: z.string().trim().min(1).max(200), dataBase64: z.string().min(4) }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose a file to upload');
  const { rows: [a] } = await query('select cohort_id, kind from assessments where id = $1', [id]);
  if (!a) throw httpError(404, 'Assessment not found');
  if (a.kind === 'quiz') throw httpError(400, 'Quizzes use questions, not uploaded files.');
  if ((await query('select count(*)::int as n from assessment_files where assessment_id = $1', [id])).rows[0].n >= MAX_FILES) throw httpError(409, `An assessment can have at most ${MAX_FILES} files.`);
  const buffer = Buffer.from(p.data.dataBase64, 'base64');
  const info = storage.describeFile(p.data.fileName, buffer.length);
  if (info.error) throw httpError(400, info.error);
  const storagePath = storage.newPath(a.cohort_id, id, info.safeName);
  try { await storage.putFile(storagePath, buffer, info.contentType); } catch (e) { logger.error('assessment.file_upload_failed', { message: e.message, requestId: req.id }); throw httpError(502, 'The file could not be stored. Please try again.'); }
  let row;
  try {
    ({ rows: [row] } = await query(
      `insert into assessment_files (assessment_id, storage_path, file_name, content_type, size_bytes, uploaded_by) values ($1,$2,$3,$4,$5,$6) returning id`,
      [id, storagePath, info.safeName, info.contentType, buffer.length, req.user.id]));
  } catch (e) { await storage.removeFile(storagePath).catch(() => {}); throw e; }
  await log(req, 'assessment.file_add', 'assessment', id, { fileName: info.safeName, bytes: buffer.length });
  res.status(201).json({ id: row.id, name: info.safeName, size: buffer.length });
}));

router.get('/assessments/:id/files', wrap(async (req, res) => {
  const { rows } = await query('select id, file_name, size_bytes, created_at from assessment_files where assessment_id = $1 order by created_at', [uuid(req.params.id)]);
  res.json({ files: rows.map((f) => ({ id: f.id, name: f.file_name, size: f.size_bytes, createdAt: f.created_at })) });
}));

router.get('/assessment-files/:fileId/url', wrap(async (req, res) => {
  const { rows: [f] } = await query('select storage_path, file_name from assessment_files where id = $1', [uuid(req.params.fileId)]);
  if (!f) throw httpError(404, 'File not found');
  res.json({ url: await storage.signedUrl(f.storage_path, f.file_name) });
}));

router.delete('/assessment-files/:fileId', wrap(async (req, res) => {
  const id = uuid(req.params.fileId);
  const { rows: [f] } = await query('select storage_path, assessment_id, file_name from assessment_files where id = $1', [id]);
  if (!f) throw httpError(404, 'File not found');
  await query('delete from assessment_files where id = $1', [id]);
  await storage.removeFile(f.storage_path).catch((e) => logger.warn('assessment.file_cleanup_failed', { message: e.message }));
  await log(req, 'assessment.file_remove', 'assessment', f.assessment_id, { fileName: f.file_name });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- quizzes
router.get('/assessments/:id/quiz', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const { rows: [a] } = await query('select kind, title from assessments where id = $1', [id]);
  if (!a) throw httpError(404, 'Assessment not found');
  const { rows } = await query('select position, prompt, qtype, options, correct, points from quiz_questions where assessment_id = $1 order by position', [id]);
  res.json({ kind: a.kind, title: a.title, attempts: await workCount(id), questions: rows.map((q) => ({ ...q, points: Number(q.points) })) });
}));

// Replaces the whole question set. Blocked once anyone has attempted the quiz, so scores already given stay meaningful.
router.put('/assessments/:id/quiz', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = quizSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, p.error.issues[0]?.message || 'Check the questions: each needs a prompt, 2-8 options and the correct answer');
  const { rows: [a] } = await query('select kind from assessments where id = $1', [id]);
  if (!a) throw httpError(404, 'Assessment not found');
  if (a.kind !== 'quiz') throw httpError(400, 'This assessment is not a quiz.');
  if ((await workCount(id)) > 0) throw httpError(409, 'Learners have already taken this quiz, so its questions can no longer be changed.');
  await tx(async (c) => {
    await c.query('delete from quiz_questions where assessment_id = $1', [id]);
    for (const [i, q] of p.data.questions.entries()) {
      await c.query(
        `insert into quiz_questions (assessment_id, position, prompt, qtype, options, correct, points) values ($1,$2,$3,$4,$5,$6,$7)`,
        [id, i + 1, q.prompt, q.qtype, JSON.stringify(q.options), JSON.stringify(q.correct), q.points]);
    }
    await audit({ db: c, actorId: req.user.id, action: 'assessment.quiz_save', entityType: 'assessment', entityId: id, details: { questions: p.data.questions.length }, ip: req.ip });
  });
  res.json({ ok: true, questions: p.data.questions.length });
}));

// ---------------------------------------------------------------- capstone qualification (who may see capstone events)
// Qualification lives in the grading sheet. A sync copies a DEFINITE value (QUALIFIED / NOT QUALIFIED on a row that has scores);
// blank, not-yet-graded rows are left as "unknown", and unknown is treated as NOT qualified wherever it matters.
router.post('/cohorts/:id/capstone-qualification/sync', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const { rows: [c] } = await query('select number from cohorts where id = $1', [id]);
  if (!c) throw httpError(404, 'Cohort not found');
  let rows;
  try { rows = await fetchCohortRows(c.number); } catch (e) {
    logger.error('capstone.sync_sheet_failed', { message: e.message, requestId: req.id });
    throw httpError(e.code === 'TAB_NOT_FOUND' ? 404 : 502, e.code === 'TAB_NOT_FOUND' ? `There is no sheet tab for Cohort ${c.number}.` : 'Could not read the grading sheet. Try again shortly.');
  }
  const byEmail = new Map();
  for (const r of rows.slice(1)) {
    const email = String(r[1] || '').trim().toLowerCase();
    if (!email) continue;
    const q = buildDashboard(r, c.number).qualifiedForCapstone;
    if (q !== null) byEmail.set(email, q);
  }
  const counts = await tx(async (client) => {
    let qualified = 0; let notQualified = 0;
    for (const [email, q] of byEmail) {
      const r = await client.query('update learners set capstone_qualified = $3 where cohort_id = $1 and email = $2', [id, email, q]);
      if (r.rowCount) { if (q) qualified++; else notQualified++; }
    }
    const { rows: [u] } = await client.query('select count(*)::int as n from learners where cohort_id = $1 and capstone_qualified is null and status <> \'withdrawn\'', [id]);
    await audit({ db: client, actorId: req.user.id, action: 'capstone.sync', entityType: 'cohort', entityId: id, details: { qualified, notQualified, unknown: u.n }, ip: req.ip });
    return { qualified, notQualified, unknown: u.n };
  });
  res.json({ ok: true, ...counts });
}));

router.patch('/learners/:id/capstone', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ qualified: z.boolean().nullable() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Send qualified as true, false or null');
  const r = await query('update learners set capstone_qualified = $2 where id = $1', [id, p.data.qualified]);
  if (!r.rowCount) throw httpError(404, 'Learner not found');
  await log(req, 'capstone.set', 'learner', id, { qualified: p.data.qualified });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- learner feedback inbox
router.get('/feedback/summary', wrap(async (req, res) => {
  const { rows: [r] } = await query(`select count(*) filter (where status = 'open')::int as open, count(*)::int as total from feedback`);
  res.json(r);
}));

router.get('/feedback', wrap(async (req, res) => {
  const status = ['open', 'resolved'].includes(req.query.status) ? req.query.status : null;
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 25));
  const page = Math.max(1, Number(req.query.page) || 1);
  const [list, total] = await Promise.all([
    query(
      `select f.id, f.name, f.email::text as email, f.stack, f.cohort_name, f.category, f.message, f.page_url, f.status, f.resolution_note,
              f.created_at, f.resolved_at, p.full_name as resolved_by
       from feedback f left join profiles p on p.id = f.resolved_by
       where ($1::text is null or f.status = $1) order by (f.status = 'open') desc, f.created_at desc limit $2 offset $3`, [status, pageSize, (page - 1) * pageSize]),
    query(`select count(*)::int as n from feedback where ($1::text is null or status = $1)`, [status]),
  ]);
  res.json({ page, pageSize, total: total.rows[0].n, items: list.rows });
}));

router.patch('/feedback/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ status: z.enum(['open', 'resolved']), note: z.string().trim().max(1000).nullable().optional() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose open or resolved');
  const resolved = p.data.status === 'resolved';
  const r = await query(
    `update feedback set status = $2, resolution_note = case when $3 then $4 else null end,
       resolved_by = case when $3 then $5::uuid end, resolved_at = case when $3 then now() end where id = $1`,
    [id, p.data.status, resolved, p.data.note || null, req.user.id]);
  if (!r.rowCount) throw httpError(404, 'Feedback not found');
  await log(req, resolved ? 'feedback.resolve' : 'feedback.reopen', 'feedback', id, {});
  res.json({ ok: true });
}));

module.exports = router;
