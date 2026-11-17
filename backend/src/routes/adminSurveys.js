const router = require('express').Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { audit } = require('../lib/audit');
const { wrap, httpError, uuid } = require('../lib/http');
const { toUtcDate, toLocalInput } = require('../lib/tz');
const { build } = require('../lib/surveyTemplates');
const { statusOf, buildResults } = require('../services/surveyResults');
const { sendSurveyNotifications } = require('../services/surveyNotify');
const storage = require('../services/storage');

const log = (req, action, id, details) => audit({ actorId: req.user.id, action, entityType: 'survey', entityId: id, details, ip: req.ip });
const localDate = (v, tz) => { try { return toUtcDate(v, tz); } catch { throw httpError(400, 'Invalid date or time'); } };
async function loadSurvey(id) {
  const { rows: [s] } = await query(
    `select s.*, c.timezone, c.name as cohort_name, c.status as cohort_status,
            (select count(*)::int from survey_responses r where r.survey_id = s.id) as responded from surveys s join cohorts c on c.id = s.cohort_id where s.id = $1`, [id]);
  if (!s) throw httpError(404, 'Survey not found');
  return s;
}

router.get('/surveys', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const { rows } = await query(
    `select s.id, s.kind, s.title, s.published, s.opens_at, s.closes_at, s.notified_at,
            (select count(*)::int from survey_responses r where r.survey_id = s.id) as responded,
            (select count(*)::int from learners l where l.cohort_id = s.cohort_id and l.status <> 'withdrawn') as eligible
     from surveys s where s.cohort_id = $1 order by s.opens_at desc`, [cohortId]);
  res.json({ surveys: rows.map((s) => ({ id: s.id, kind: s.kind, title: s.title, status: statusOf(s), opensAt: s.opens_at, closesAt: s.closes_at, notified: !!s.notified_at, responded: s.responded, eligible: s.eligible })) });
}));

// Creates a survey from the standard Mid-bootcamp or Final template, with the dates it should be open.
router.post('/surveys', wrap(async (req, res) => {
  const p = z.object({
    cohortId: z.string().uuid(), template: z.enum(['mid', 'final']), title: z.string().trim().min(2).max(160).optional(),
    opensAtLocal: z.string(), closesAtLocal: z.string(),
  }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose the survey type and when it opens and closes');
  const { rows: [c] } = await query('select id, name, number, timezone, status from cohorts where id = $1', [p.data.cohortId]);
  if (!c) throw httpError(404, 'Cohort not found');
  if (c.status === 'archived') throw httpError(409, 'Archived cohorts cannot get new surveys.');
  const opens = localDate(p.data.opensAtLocal, c.timezone); const closes = localDate(p.data.closesAtLocal, c.timezone);
  if (!(closes > opens)) throw httpError(400, 'The survey must close after it opens');
  if (!(closes > new Date())) throw httpError(400, 'The closing date must be in the future');
  const t = build(p.data.template, c);
  const id = await tx(async (client) => {
    const { rows: [s] } = await client.query(
      `insert into surveys (cohort_id, kind, title, intro, opens_at, closes_at, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [c.id, t.kind, p.data.title || t.title, t.intro, opens, closes, req.user.id]);
    for (const [i, q] of t.questions.entries()) {
      await client.query(
        `insert into survey_questions (survey_id, position, kind, prompt, help, options, required, show_if, flag) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [s.id, i + 1, q.kind, q.prompt, q.help || null, JSON.stringify(q.options || {}), q.required, q.show_if ? JSON.stringify(q.show_if) : null, q.flag || null]);
    }
    await audit({ db: client, actorId: req.user.id, action: 'survey.create', entityType: 'survey', entityId: s.id, details: { template: p.data.template, cohortId: c.id }, ip: req.ip });
    return s.id;
  });
  res.status(201).json({ id });
}));

router.get('/surveys/:id', wrap(async (req, res) => {
  const s = await loadSurvey(uuid(req.params.id));
  const [qs, notified] = await Promise.all([
    query('select id, position, kind, prompt, help, options, required, show_if, flag from survey_questions where survey_id = $1 order by position', [s.id]),
    query(`select count(*)::int as n from survey_notifications where survey_id = $1 and status in ('sent','dry_run')`, [s.id]),
  ]);
  res.json({
    survey: { id: s.id, cohortId: s.cohort_id, kind: s.kind, title: s.title, intro: s.intro, status: statusOf(s), published: s.published, responded: s.responded, timezone: s.timezone,
      opensAtLocal: toLocalInput(s.opens_at, s.timezone), closesAtLocal: toLocalInput(s.closes_at, s.timezone), opensAt: s.opens_at, closesAt: s.closes_at, notified: notified.rows[0].n },
    questions: qs.rows,
  });
}));

router.patch('/surveys/:id', wrap(async (req, res) => {
  const s = await loadSurvey(uuid(req.params.id));
  const p = z.object({ title: z.string().trim().min(2).max(160).optional(), intro: z.string().trim().max(2000).nullable().optional(),
    opensAtLocal: z.string().optional(), closesAtLocal: z.string().optional(), published: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid survey details');
  const opens = p.data.opensAtLocal ? localDate(p.data.opensAtLocal, s.timezone) : new Date(s.opens_at);
  const closes = p.data.closesAtLocal ? localDate(p.data.closesAtLocal, s.timezone) : new Date(s.closes_at);
  if (!(closes > opens)) throw httpError(400, 'The survey must close after it opens');
  const published = p.data.published ?? s.published;
  if (published && !(closes > new Date())) throw httpError(400, 'The closing date must be in the future to publish this survey');
  await query(
    `update surveys set title = coalesce($2, title), intro = case when $3::boolean then $4 else intro end, opens_at = $5, closes_at = $6, published = $7 where id = $1`,
    [s.id, p.data.title ?? null, p.data.intro !== undefined, p.data.intro ?? null, opens, closes, published]);
  await log(req, 'survey.update', s.id, { published });
  res.json({ ok: true });
}));

// Wording and options can be edited until the first response arrives, so every answer means the same question.
router.patch('/surveys/:id/questions/:qid', wrap(async (req, res) => {
  const s = await loadSurvey(uuid(req.params.id));
  if (s.responded > 0) throw httpError(409, 'Learners have already responded, so the questions can no longer be changed.');
  const { rows: [q] } = await query('select id, kind, options from survey_questions where id = $1 and survey_id = $2', [uuid(req.params.qid), s.id]);
  if (!q) throw httpError(404, 'Question not found');
  const p = z.object({ prompt: z.string().trim().min(3).max(1000).optional(), help: z.string().trim().max(1000).nullable().optional(), required: z.boolean().optional(),
    options: z.record(z.string(), z.unknown()).optional() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid question');
  let options = null;
  if (p.data.options) {
    const o = q.kind === 'choice_text'
      ? z.object({ choices: z.array(z.string().trim().min(1).max(120)).min(2).max(12), allowText: z.boolean().default(true), textLabel: z.string().trim().max(120).optional() }).safeParse(p.data.options)
      : q.kind === 'rating' ? z.object({ low: z.string().trim().min(1).max(40), high: z.string().trim().min(1).max(40) }).safeParse(p.data.options) : null;
    if (!o || !o.success) throw httpError(400, q.kind === 'choice_text' ? 'Give between 2 and 12 options' : 'This question has no editable options');
    options = o.data;
  }
  await query(`update survey_questions set prompt = coalesce($2, prompt), help = case when $3::boolean then $4 else help end, required = coalesce($5, required), options = coalesce($6::jsonb, options) where id = $1`,
    [q.id, p.data.prompt ?? null, p.data.help !== undefined, p.data.help ?? null, p.data.required ?? null, options ? JSON.stringify(options) : null]);
  await log(req, 'survey.question_edit', s.id, { position: q.id });
  res.json({ ok: true });
}));

// Publishes (and optionally opens right now) and emails learners in bounded batches; press again while `remaining` > 0.
// Scheduled surveys are emailed automatically when they open by the scheduled job (`npm run reminders`).
router.post('/surveys/:id/send', wrap(async (req, res) => {
  const s = await loadSurvey(uuid(req.params.id));
  const openNow = req.body?.openNow === true;
  if (s.cohort_status === 'archived') throw httpError(409, 'Archived cohorts cannot send surveys.');
  if (!(new Date(s.closes_at) > new Date())) throw httpError(400, 'The closing date has passed. Change it first.');
  await query('update surveys set published = true, opens_at = case when $2::boolean and opens_at > now() then now() else opens_at end where id = $1', [s.id, openNow]);
  const r = await sendSurveyNotifications({ surveyId: s.id, limit: 25 });
  await log(req, 'survey.send', s.id, { sent: r.sent, dryRun: r.dryRun, failed: r.failed });
  res.json({ ok: true, ...r });
}));

router.delete('/surveys/:id', wrap(async (req, res) => {
  const s = await loadSurvey(uuid(req.params.id));
  if (s.responded > 0) throw httpError(409, 'Learners have already responded, so this survey cannot be deleted. Close it instead.');
  const { rows: photos } = await query('select storage_path from survey_photos where survey_id = $1', [s.id]);
  for (const ph of photos) await storage.removeFile(ph.storage_path, storage.SURVEY_BUCKET).catch(() => {});
  await query('delete from surveys where id = $1', [s.id]);
  await log(req, 'survey.delete', s.id, { title: s.title });
  res.json({ ok: true });
}));

router.get('/surveys/:id/results', wrap(async (req, res) => {
  const r = await buildResults(uuid(req.params.id));
  if (!r) throw httpError(404, 'Survey not found');
  res.json(r);
}));

// Individual responses with the learner's name: admin only.
router.get('/surveys/:id/responses', wrap(async (req, res) => {
  const s = await loadSurvey(uuid(req.params.id));
  const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 50)); const page = Math.max(1, Number(req.query.page) || 1);
  const [rows, qs] = await Promise.all([
    query(`select r.id, l.full_name as name, st.name as stack, r.submitted_at from survey_responses r join learners l on l.id = r.learner_id left join stacks st on st.id = r.stack_id
           where r.survey_id = $1 order by r.submitted_at desc limit $2 offset $3`, [s.id, pageSize, (page - 1) * pageSize]),
    query('select id, position, kind, prompt from survey_questions where survey_id = $1 order by position', [s.id]),
  ]);
  const ids = rows.rows.map((r) => r.id);
  const { rows: answers } = ids.length ? await query('select response_id, question_id, value from survey_answers where response_id = any($1::uuid[])', [ids]) : { rows: [] };
  const { rows: photos } = ids.length ? await query('select p.id, p.learner_id, r.id as response_id from survey_photos p join survey_responses r on r.learner_id = p.learner_id and r.survey_id = p.survey_id where p.survey_id = $1 and p.consented', [s.id]) : { rows: [] };
  const show = (q, v) => (q.kind === 'rating' ? `${v.n} / 5` : q.kind === 'yesno' ? (v.v === 'yes' ? 'Yes' : 'No') : q.kind === 'choice_text' ? [(v.choices || []).join(', '), v.text].filter(Boolean).join(' — ') : q.kind === 'consent' ? 'Consent given' : v.text);
  const { rows: [t] } = await query('select count(*)::int as n from survey_responses where survey_id = $1', [s.id]);
  res.json({
    total: t.n, page, pageSize,
    responses: rows.rows.map((r) => ({
      id: r.id, name: r.name, stack: r.stack, submittedAt: r.submitted_at,
      photoId: photos.find((p) => p.response_id === r.id)?.id || null,
      answers: qs.rows.map((q) => { const a = answers.find((x) => x.response_id === r.id && x.question_id === q.id); return a ? { position: q.position, prompt: q.prompt, display: show(q, a.value) } : null; }).filter(Boolean),
    })),
  });
}));

router.get('/surveys/:id/photos/:photoId/url', wrap(async (req, res) => {
  const { rows: [p] } = await query('select storage_path, file_name from survey_photos where id = $1 and survey_id = $2 and consented', [uuid(req.params.photoId), uuid(req.params.id)]);
  if (!p) throw httpError(404, 'Photo not found');
  res.json({ url: await storage.signedUrl(p.storage_path, p.file_name, storage.SURVEY_BUCKET) });
}));

// A note the respectful-feedback filter held back can be released to the facilitator, or hidden again, by an admin.
router.patch('/surveys/:id/notes/:responseId', wrap(async (req, res) => {
  const p = z.object({ released: z.boolean() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Send released as true or false');
  const r = await query(
    `update survey_answers a set released = $3 from survey_questions q where q.id = a.question_id and q.flag = 'instructor_note' and q.survey_id = $1 and a.response_id = $2`,
    [uuid(req.params.id), uuid(req.params.responseId), p.data.released]);
  if (!r.rowCount) throw httpError(404, 'Note not found');
  await log(req, p.data.released ? 'survey.note_release' : 'survey.note_hide', uuid(req.params.id), {});
  res.json({ ok: true });
}));

module.exports = router;
