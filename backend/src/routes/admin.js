const router = require('express').Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { audit } = require('../lib/audit');
const { wrap, httpError, emailField, uuid } = require('../lib/http');
const { buildAssessmentSchedule } = require('../lib/schedule');
const { createInvite } = require('../services/invites');
const { importLearners } = require('../services/importCohort');

const log = (req, action, entityType, entityId, details) =>
  audit({ actorId: req.user.id, action, entityType, entityId, details, ip: req.ip });

router.get('/cohorts', wrap(async (req, res) => {
  const { rows } = await query(
    'select id, number, name, timezone, week1_class_date, is_active, reminders_enabled from cohorts order by number desc'
  );
  res.json({ cohorts: rows });
}));

const cohortSchema = z.object({
  number: z.number().int().positive(),
  name: z.string().trim().min(1).max(100).optional(),
  week1ClassDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timezone: z.string().default('Africa/Lagos'),
});

router.post('/cohorts', wrap(async (req, res) => {
  const p = cohortSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter a cohort number and a week 1 class date');
  const { number, week1ClassDate, timezone } = p.data;
  let schedule;
  try { schedule = buildAssessmentSchedule({ week1ClassDate, timezone }); } catch (e) { throw httpError(400, e.message); }

  const cohort = await tx(async (c) => {
    const { rows: [co] } = await c.query(
      'insert into cohorts (number, name, timezone, week1_class_date) values ($1,$2,$3,$4) returning id, number',
      [number, p.data.name || `Cohort ${number}`, timezone, week1ClassDate]
    );
    for (const a of schedule) {
      await c.query(
        'insert into assessments (cohort_id, week_number, title, max_score, opens_at, due_at) values ($1,$2,$3,$4,$5,$6)',
        [co.id, a.weekNumber, a.title, a.maxScore, a.opensAt, a.dueAt]
      );
    }
    return co;
  });
  await log(req, 'cohort.create', 'cohort', cohort.id, { number, week1ClassDate, timezone });
  res.status(201).json({ cohort });
}));

// Activating one cohort deactivates the rest, so previous cohorts' learners can no longer log in.
router.post('/cohorts/:id/activate', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  await tx(async (c) => {
    await c.query('update cohorts set is_active = false where is_active');
    const r = await c.query('update cohorts set is_active = true where id = $1', [id]);
    if (!r.rowCount) throw httpError(404, 'Cohort not found'); // rolls back: previous active cohort stays active
  });
  await log(req, 'cohort.activate', 'cohort', id, {});
  res.json({ ok: true });
}));

router.get('/stacks', wrap(async (req, res) => {
  const { rows } = await query('select id, name, is_active from stacks order by name');
  res.json({ stacks: rows });
}));

router.post('/stacks', wrap(async (req, res) => {
  const p = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter a stack name');
  const { rows: [s] } = await query('insert into stacks (name) values ($1) returning id, name', [p.data.name]);
  await log(req, 'stack.create', 'stack', s.id, { name: s.name });
  res.status(201).json({ stack: s });
}));

router.patch('/stacks/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ name: z.string().trim().min(2).max(80).optional(), isActive: z.boolean().optional() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid stack update');
  const { rows: [s] } = await query(
    'update stacks set name = coalesce($2, name), is_active = coalesce($3, is_active) where id = $1 returning id, name, is_active',
    [id, p.data.name ?? null, p.data.isActive ?? null]
  );
  if (!s) throw httpError(404, 'Stack not found');
  await log(req, 'stack.update', 'stack', id, p.data);
  res.json({ stack: s });
}));

// Facilitators can only join through an admin-issued invite bound to a cohort and a stack from the managed list.
const inviteSchema = z.object({ email: emailField, fullName: z.string().trim().min(2).max(120), cohortId: z.string().uuid(), stackId: z.string().uuid() });

router.post('/facilitator-invites', wrap(async (req, res) => {
  const p = inviteSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Fill in name, email, cohort and stack');
  const { email, fullName, cohortId, stackId } = p.data;
  const ok = await query('select 1 from stacks s, cohorts c where s.id = $1 and s.is_active and c.id = $2', [stackId, cohortId]);
  if (!ok.rowCount) throw httpError(400, 'Choose an active stack and an existing cohort');
  if ((await query('select 1 from profiles where email = $1', [email])).rowCount) throw httpError(409, 'That email already has an account');
  const code = await createInvite({ query }, { role: 'facilitator', email, fullName, cohortId, stackId, days: 14, createdBy: req.user.id });
  await log(req, 'invite.facilitator', 'invite', null, { email, cohortId, stackId });
  res.status(201).json({ code });
}));

router.post('/cohorts/:id/import-learners', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const { rows: [cohort] } = await query('select id, number from cohorts where id = $1', [id]);
  if (!cohort) throw httpError(404, 'Cohort not found');
  const result = await importLearners(cohort, req.user.id);
  await log(req, 'cohort.import', 'cohort', id, { imported: result.imported, skipped: result.skipped, codesIssued: result.codes.length });
  res.json(result);
}));

router.post('/learners/reissue-invite', wrap(async (req, res) => {
  const p = z.object({ email: emailField }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter a valid email');
  const { email } = p.data;
  const { rows: [l] } = await query('select full_name from learners where email = $1 order by created_at desc limit 1', [email]);
  if (!l) throw httpError(404, 'No learner with that email');
  if ((await query('select 1 from profiles where email = $1', [email])).rowCount) throw httpError(409, 'This learner already has an account');
  const code = await createInvite({ query }, { role: 'learner', email, fullName: l.full_name, days: 30, createdBy: req.user.id });
  await log(req, 'invite.learner_reissue', 'invite', null, { email });
  res.json({ code });
}));

module.exports = router;