const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db');
const { audit } = require('../lib/audit');
const { wrap, httpError, uuid } = require('../lib/http');
const { normalizeHttps } = require('../lib/urls');

const log = (req, action, type, id, details) => audit({ actorId: req.user.id, action, entityType: type, entityId: id, details, ip: req.ip });
const resourceSchema = z.object({ title: z.string().trim().min(2).max(160), url: z.string().max(2048), note: z.string().trim().max(500).nullable().optional() });
const MAX_RESOURCES = 20;

// ---------------------------------------------------------------- resources (links and notes learners and facilitators can open)
router.get('/assessments/:id/resources', wrap(async (req, res) => {
  const { rows } = await query('select id, title, url, note, position from assessment_resources where assessment_id = $1 order by position, created_at', [uuid(req.params.id)]);
  res.json({ resources: rows });
}));

router.post('/assessments/:id/resources', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = resourceSchema.safeParse(req.body);
  const url = p.success ? normalizeHttps(p.data.url) : null;
  if (!p.success || !url) throw httpError(400, 'Give the resource a title and a link that starts with https://');
  if (!(await query('select 1 from assessments where id = $1', [id])).rowCount) throw httpError(404, 'Assessment not found');
  const { rows: [n] } = await query('select count(*)::int as n from assessment_resources where assessment_id = $1', [id]);
  if (n.n >= MAX_RESOURCES) throw httpError(409, `An assessment can have at most ${MAX_RESOURCES} resources.`);
  const { rows: [r] } = await query(
    `insert into assessment_resources (assessment_id, title, url, note, position, created_by) values ($1,$2,$3,$4,$5,$6) returning id`,
    [id, p.data.title, url, p.data.note || null, n.n, req.user.id]);
  await log(req, 'assessment.resource_add', 'assessment', id, { title: p.data.title });
  res.status(201).json({ id: r.id });
}));

router.patch('/assessment-resources/:rid', wrap(async (req, res) => {
  const rid = uuid(req.params.rid);
  const p = resourceSchema.partial().safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid resource');
  const url = p.data.url === undefined ? null : normalizeHttps(p.data.url);
  if (p.data.url !== undefined && !url) throw httpError(400, 'The link must start with https://');
  const r = await query(
    `update assessment_resources set title = coalesce($2, title), url = coalesce($3, url), note = case when $4::boolean then $5 else note end where id = $1 returning assessment_id`,
    [rid, p.data.title ?? null, url, p.data.note !== undefined, p.data.note || null]);
  if (!r.rowCount) throw httpError(404, 'Resource not found');
  await log(req, 'assessment.resource_edit', 'assessment', r.rows[0].assessment_id, {});
  res.json({ ok: true });
}));

router.delete('/assessment-resources/:rid', wrap(async (req, res) => {
  const r = await query('delete from assessment_resources where id = $1 returning assessment_id, title', [uuid(req.params.rid)]);
  if (!r.rowCount) throw httpError(404, 'Resource not found');
  await log(req, 'assessment.resource_remove', 'assessment', r.rows[0].assessment_id, { title: r.rows[0].title });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- change requests from facilitators
router.get('/change-requests/summary', wrap(async (req, res) => {
  const { rows: [r] } = await query(`select count(*) filter (where status = 'open')::int as open from assessment_change_requests`);
  res.json(r);
}));

router.get('/change-requests', wrap(async (req, res) => {
  const status = ['open', 'implemented', 'declined'].includes(req.query.status) ? req.query.status : null;
  const { rows } = await query(
    `select r.id, r.message, r.status, r.admin_note, r.created_at, r.resolved_at, a.id as assessment_id, a.week_number, a.title, a.kind, st.name as stack,
            c.id as cohort_id, c.name as cohort_name, p.full_name as requested_by, rp.full_name as resolved_by
     from assessment_change_requests r join assessments a on a.id = r.assessment_id join cohorts c on c.id = r.cohort_id
     join profiles p on p.id = r.requested_by left join profiles rp on rp.id = r.resolved_by left join stacks st on st.id = a.stack_id
     where ($1::text is null or r.status = $1) order by (r.status = 'open') desc, r.created_at desc limit 200`, [status]);
  res.json({ requests: rows });
}));

// The admin makes the change on the assessment itself (it goes live for learners immediately), then marks the request.
router.patch('/change-requests/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ status: z.enum(['open', 'implemented', 'declined']), note: z.string().trim().max(1000).nullable().optional() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose implemented, declined or open');
  const done = p.data.status !== 'open';
  const r = await query(
    `update assessment_change_requests set status = $2, admin_note = case when $3 then $4 else null end,
       resolved_by = case when $3 then $5::uuid end, resolved_at = case when $3 then now() end where id = $1`,
    [id, p.data.status, done, p.data.note || null, req.user.id]);
  if (!r.rowCount) throw httpError(404, 'Request not found');
  await log(req, `change_request.${p.data.status}`, 'assessment_change_request', id, {});
  res.json({ ok: true });
}));

module.exports = router;
