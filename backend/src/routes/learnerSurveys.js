const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { wrap, httpError, uuid } = require('../lib/http');
const logger = require('../lib/logger');
const { validateAnswers } = require('../lib/surveyValidate');
const storage = require('../services/storage');

async function me(req) {
  const { rows: [l] } = await query(
    `select l.id, l.cohort_id, l.stack_id from learners l join cohorts c on c.id = l.cohort_id
     where l.profile_id = $1 and c.status = 'active' and l.status <> 'withdrawn' order by c.number desc limit 1`, [req.user.id]);
  if (!l) throw httpError(403, 'Your cohort is not currently active.');
  return l;
}
// A learner can only reach surveys of their own cohort that are published and currently open.
async function openSurvey(l, id) {
  const { rows: [s] } = await query(
    `select id, title, intro, closes_at from surveys where id = $1 and cohort_id = $2 and published and opens_at <= now() and closes_at > now()`, [id, l.cohort_id]);
  if (!s) throw httpError(404, 'This survey is not open.');
  return s;
}
const dropPhoto = async (photo) => {
  await query('delete from survey_photos where id = $1', [photo.id]);
  await storage.removeFile(photo.storage_path, storage.SURVEY_BUCKET).catch((e) => logger.warn('survey.photo_cleanup_failed', { message: e.message }));
};

router.get('/surveys', wrap(async (req, res) => {
  const l = await me(req);
  const { rows } = await query(
    `select s.id, s.title, s.intro, s.closes_at, exists (select 1 from survey_responses r where r.survey_id = s.id and r.learner_id = $2) as submitted
     from surveys s where s.cohort_id = $1 and s.published and s.opens_at <= now() and s.closes_at > now() order by s.opens_at`, [l.cohort_id, l.id]);
  res.json({ surveys: rows.map((s) => ({ id: s.id, title: s.title, intro: s.intro, closesAt: s.closes_at, submitted: s.submitted })) });
}));

router.get('/surveys/:id', wrap(async (req, res) => {
  const l = await me(req);
  const s = await openSurvey(l, uuid(req.params.id));
  const [qs, done, photo] = await Promise.all([
    query('select id, position, kind, prompt, help, options, required, show_if from survey_questions where survey_id = $1 order by position', [s.id]), // never the internal flag
    query('select 1 from survey_responses where survey_id = $1 and learner_id = $2', [s.id, l.id]),
    query('select file_name from survey_photos where survey_id = $1 and learner_id = $2', [s.id, l.id]),
  ]);
  res.json({ survey: { id: s.id, title: s.title, intro: s.intro, closesAt: s.closes_at }, submitted: done.rowCount > 0, photo: photo.rows[0] ? { fileName: photo.rows[0].file_name } : null, questions: qs.rows });
}));

// The photo is uploaded first, then kept only if the learner answers "Yes" to sharing it AND ticks the consent box.
router.post('/surveys/:id/photo', express.json({ limit: '9mb' }), wrap(async (req, res) => {
  const l = await me(req);
  const s = await openSurvey(l, uuid(req.params.id));
  if ((await query('select 1 from survey_responses where survey_id = $1 and learner_id = $2', [s.id, l.id])).rowCount) throw httpError(409, 'You have already submitted this survey.');
  const p = z.object({ fileName: z.string().trim().min(1).max(200), dataBase64: z.string().min(4) }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose a photo to upload');
  const buffer = Buffer.from(p.data.dataBase64, 'base64');
  const info = storage.describePhoto(p.data.fileName, buffer);
  if (info.error) throw httpError(400, info.error);
  const storagePath = storage.newPath(s.id, l.id, info.safeName);
  try { await storage.putFile(storagePath, buffer, info.contentType, storage.SURVEY_BUCKET); } catch (e) { logger.error('survey.photo_upload_failed', { message: e.message, requestId: req.id }); throw httpError(502, 'The photo could not be saved. Please try again.'); }
  const { rows: [old] } = await query('select id, storage_path from survey_photos where survey_id = $1 and learner_id = $2', [s.id, l.id]);
  if (old) await dropPhoto(old);
  await query('insert into survey_photos (survey_id, learner_id, storage_path, file_name, size_bytes) values ($1,$2,$3,$4,$5)', [s.id, l.id, storagePath, info.safeName, buffer.length]);
  res.status(201).json({ fileName: info.safeName });
}));

router.delete('/surveys/:id/photo', wrap(async (req, res) => {
  const l = await me(req);
  const s = await openSurvey(l, uuid(req.params.id));
  const { rows: [photo] } = await query('select id, storage_path from survey_photos where survey_id = $1 and learner_id = $2', [s.id, l.id]);
  if (photo) await dropPhoto(photo);
  res.json({ ok: true });
}));

router.post('/surveys/:id/respond', wrap(async (req, res) => {
  const l = await me(req);
  const s = await openSurvey(l, uuid(req.params.id));
  const { rows: questions } = await query('select id, position, kind, options, required, show_if, flag from survey_questions where survey_id = $1 order by position', [s.id]);
  const { rows: [photo] } = await query('select id, storage_path from survey_photos where survey_id = $1 and learner_id = $2', [s.id, l.id]);
  const { clean, errors, moderation } = validateAnswers(questions, req.body?.answers || {}, { photoExists: !!photo });
  if (errors.length) throw Object.assign(httpError(400, errors[0]), { errorCode: 'SURVEY_INVALID' });
  const saved = await tx(async (c) => {
    const { rows: [r] } = await c.query(
      `insert into survey_responses (survey_id, learner_id, stack_id) values ($1,$2,$3) on conflict (survey_id, learner_id) do nothing returning id`, [s.id, l.id, l.stack_id]);
    if (!r) return false;
    for (const [qid, value] of clean) {
      await c.query('insert into survey_answers (response_id, question_id, value, moderation) values ($1,$2,$3,$4)', [r.id, qid, JSON.stringify(value), moderation.get(qid) || 'clean']);
    }
    return true;
  });
  if (!saved) throw httpError(409, 'You have already submitted this survey.');
  if (photo) {
    const consentQ = questions.find((q) => q.kind === 'consent');
    if (consentQ && clean.has(consentQ.id)) await query('update survey_photos set consented = true where id = $1', [photo.id]);
    else await dropPhoto(photo); // no "Yes" + consent: the photo is not kept
  }
  res.status(201).json({ ok: true });
}));

module.exports = router;
