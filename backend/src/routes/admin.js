const router = require('express').Router();
const { z } = require('zod');
const { query, tx } = require('../db');
const { audit } = require('../lib/audit');
const { wrap, httpError, emailField, uuid } = require('../lib/http');
const { buildAssessmentSchedule } = require('../lib/schedule');
const { createInvite } = require('../services/invites');
const { previewImport, commitImport } = require('../services/importCohort');
const { issueInvitation, sendInvitations } = require('../services/invitations');
const { onboardingOverview } = require('../services/onboarding');
const { mailMode } = require('../services/mailer');
const config = require('../config');

const log = (req, action, entityType, entityId, details) =>
  audit({ actorId: req.user.id, action, entityType, entityId, details, ip: req.ip });
const page = (req, max = 100, def = 50) => {
  const pageSize = Math.min(max, Math.max(1, Number(req.query.pageSize) || def));
  return { page: Math.max(1, Number(req.query.page) || 1), pageSize };
};

// ---------------------------------------------------------------- cohorts
router.get('/cohorts', wrap(async (req, res) => {
  const { rows } = await query(
    `select c.id, c.number, c.name, c.timezone, c.week1_class_date, c.is_active, c.status, c.archived_at, c.reminders_enabled,
            (select count(*)::int from learners l where l.cohort_id = c.id) as learner_count
     from cohorts c order by c.number desc`);
  res.json({ cohorts: rows, registrationCohortNumber: config.activeCohortNumber });
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
      `insert into cohorts (number, name, timezone, week1_class_date) values ($1,$2,$3,$4) returning id, number, status`,
      [number, p.data.name || `Cohort ${number}`, timezone, week1ClassDate]
    );
    for (const a of schedule) {
      await c.query(
        'insert into assessments (cohort_id, week_number, title, max_score, opens_at, due_at) values ($1,$2,$3,$4,$5,$6)',
        [co.id, a.weekNumber, a.title, a.maxScore, a.opensAt, a.dueAt]
      );
    }
    await audit({ db: c, actorId: req.user.id, action: 'cohort.create', entityType: 'cohort', entityId: co.id, details: { number, week1ClassDate, timezone }, ip: req.ip });
    return co;
  });
  res.status(201).json({ cohort });
}));

// Lifecycle: upcoming -> active -> completed -> archived. Changing ONE cohort never touches any other cohort, so several
// can run at once and history stays in place. Archiving keeps all data; it only closes learner access and grading.
const STATUSES = ['upcoming', 'active', 'completed', 'archived'];
async function setCohortStatus(req, id, status) {
  return tx(async (c) => {
    const { rows: [cur] } = await c.query('select number, status from cohorts where id = $1 for update', [id]);
    if (!cur) throw httpError(404, 'Cohort not found');
    if (cur.status === 'archived' && status !== 'archived' && status !== 'completed') {
      throw httpError(409, 'An archived cohort must be restored to "completed" before it can be reopened.');
    }
    await c.query(
      `update cohorts set status = $2, is_active = ($2 = 'active'),
         archived_at = case when $2 = 'archived' then coalesce(archived_at, now()) else null end where id = $1`, [id, status]);
    await audit({ db: c, actorId: req.user.id, action: 'cohort.status', entityType: 'cohort', entityId: id, details: { number: cur.number, from: cur.status, to: status }, ip: req.ip });
    return { number: cur.number, from: cur.status, to: status };
  });
}

router.post('/cohorts/:id/status', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ status: z.enum(STATUSES) }).safeParse(req.body);
  if (!p.success) throw httpError(400, `Status must be one of: ${STATUSES.join(', ')}`);
  res.json({ ok: true, ...(await setCohortStatus(req, id, p.data.status)) });
}));

// Kept for older clients. It no longer deactivates other cohorts.
router.post('/cohorts/:id/activate', wrap(async (req, res) => {
  res.json({ ok: true, ...(await setCohortStatus(req, uuid(req.params.id), 'active')) });
}));

// ---------------------------------------------------------------- stacks and aliases
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

// An alias lets a known registration-sheet spelling (e.g. "Data Analyis") resolve to a managed stack.
router.get('/stack-aliases', wrap(async (req, res) => {
  const { rows } = await query('select a.alias::text as alias, a.stack_id, s.name as stack from stack_aliases a join stacks s on s.id = a.stack_id order by a.alias');
  res.json({ aliases: rows });
}));

router.post('/stack-aliases', wrap(async (req, res) => {
  const p = z.object({ alias: z.string().trim().min(2).max(80), stackId: z.string().uuid() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter the sheet spelling and choose the stack it means');
  const { rows: [s] } = await query('select id from stacks where id = $1 and is_active', [p.data.stackId]);
  if (!s) throw httpError(400, 'Choose an active stack');
  await query('insert into stack_aliases (alias, stack_id) values ($1,$2) on conflict (alias) do update set stack_id = excluded.stack_id', [p.data.alias, p.data.stackId]);
  await log(req, 'stack.alias', 'stack', p.data.stackId, { alias: p.data.alias });
  res.status(201).json({ ok: true });
}));

router.delete('/stack-aliases/:alias', wrap(async (req, res) => {
  const r = await query('delete from stack_aliases where alias = $1', [String(req.params.alias)]);
  if (!r.rowCount) throw httpError(404, 'Alias not found');
  await log(req, 'stack.alias_delete', 'stack_alias', String(req.params.alias), {});
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- registration import (preview -> confirm -> summary)
router.post('/cohorts/:id/import-preview', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const { rows: [cohort] } = await query('select id, number, status from cohorts where id = $1', [id]);
  if (!cohort) throw httpError(404, 'Cohort not found');
  if (cohort.status === 'archived') throw httpError(409, 'Archived cohorts cannot be imported into.');
  if (config.activeCohortNumber && cohort.number !== config.activeCohortNumber) {
    throw httpError(409, `This platform is set to import registrations for Cohort ${config.activeCohortNumber} only (ACTIVE_COHORT_NUMBER). Change that setting to import Cohort ${cohort.number}.`);
  }
  const out = await previewImport(cohort, req.user.id);
  await log(req, 'cohort.import_preview', 'import_batch', out.batchId, { cohortId: id, ...out.summary, unmatchedStacks: out.summary.unmatchedStacks.length });
  res.json(out);
}));

router.get('/import-batches/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const { rows: [b] } = await query('select id, cohort_id, status, summary, created_at, committed_at from import_batches where id = $1', [id]);
  if (!b) throw httpError(404, 'Import not found');
  const { page: pg, pageSize } = page(req, 500, 200);
  const action = ['create', 'update', 'unchanged', 'skipped', 'error'].includes(req.query.action) ? req.query.action : null;
  const { rows } = await query(
    `select row_number, email::text as email, full_name, stack_raw, action, requires_confirmation, message, applied_at
     from import_rows where batch_id = $1 and ($2::text is null or action = $2) order by row_number limit $3 offset $4`,
    [id, action, pageSize, (pg - 1) * pageSize]);
  res.json({ batch: b, rows });
}));

router.post('/import-batches/:id/commit', wrap(async (req, res) => {
  const p = z.object({ confirmStackChanges: z.boolean().default(false) }).safeParse(req.body ?? {});
  if (!p.success) throw httpError(400, 'Invalid request');
  res.json(await commitImport(uuid(req.params.id), req.user.id, p.data));
}));

// ---------------------------------------------------------------- invitations and onboarding
router.get('/onboarding', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const { page: pg, pageSize } = page(req);
  const q = String(req.query.q || '').trim().slice(0, 80) || null;
  const status = ['enrolled', 'invited', 'activated', 'orientation', 'active', 'completed', 'withdrawn'].includes(req.query.status) ? req.query.status : null;
  const stackId = req.query.stackId ? uuid(req.query.stackId) : null;
  res.json({ mail: mailMode(), ...(await onboardingOverview({ cohortId, stackId, q, status, page: pg, pageSize })) });
}));

// Sends (or retries) invitations in bounded batches; call again while `remaining` > 0.
router.post('/cohorts/:id/invitations/send', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ learnerIds: z.array(z.string().uuid()).min(1).max(200).optional(), limit: z.number().int().min(1).max(50).default(25) }).safeParse(req.body ?? {});
  if (!p.success) throw httpError(400, 'Invalid request');
  const { rows: [c] } = await query('select status from cohorts where id = $1', [id]);
  if (!c) throw httpError(404, 'Cohort not found');
  if (!['upcoming', 'active'].includes(c.status)) throw httpError(409, 'Invitations can only be sent for upcoming or active cohorts.');
  const result = await sendInvitations({ cohortId: id, actorId: req.user.id, learnerIds: p.data.learnerIds ?? null, limit: p.data.limit });
  await log(req, 'cohort.invitations_send', 'cohort', id, { processed: result.processed, sent: result.sent, dryRun: result.dryRun, failed: result.failed });
  res.json({ mail: mailMode(), ...result });
}));

router.post('/learners/reissue-invite', wrap(async (req, res) => {
  const p = z.object({ email: emailField }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter a valid email');
  const { rows: [l] } = await query(
    `select l.id from learners l join cohorts c on c.id = l.cohort_id where l.email = $1 and c.status in ('upcoming','active')
     order by c.number desc limit 1`, [p.data.email]);
  if (!l) throw httpError(404, 'No learner with that email in an open cohort');
  const out = await issueInvitation({ learnerId: l.id, actorId: req.user.id });
  if (out.outcome === 'skipped') throw httpError(409, out.reason);
  res.json({ outcome: out.outcome, code: out.code, error: out.error, mail: mailMode() });
}));

const LEARNER_ACTIONS = { withdraw: 'withdrawn', reinstate: 'reinstated', complete: 'completed' };
router.patch('/learners/:id/status', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ action: z.enum(Object.keys(LEARNER_ACTIONS)), reason: z.string().trim().min(3).max(300) }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose an action and give a reason (3+ characters)');
  const out = await tx(async (c) => {
    const { rows: [l] } = await c.query('select id, status, profile_id, orientation_completed_at from learners where id = $1 for update', [id]);
    if (!l) throw httpError(404, 'Learner not found');
    let next;
    if (p.data.action === 'withdraw') next = 'withdrawn';
    else if (p.data.action === 'complete') next = 'completed';
    else next = l.profile_id ? (l.orientation_completed_at ? 'active' : 'activated') : 'enrolled';
    await c.query(`update learners set status = $2, withdrawn_at = case when $2 = 'withdrawn' then now() else null end where id = $1`, [id, next]);
    await audit({ db: c, actorId: req.user.id, action: `learner.${p.data.action}`, entityType: 'learner', entityId: id, details: { from: l.status, to: next, reason: p.data.reason }, ip: req.ip });
    return { from: l.status, to: next };
  });
  res.json({ ok: true, ...out });
}));

// ---------------------------------------------------------------- facilitators
const inviteSchema = z.object({ email: emailField, fullName: z.string().trim().min(2).max(120), cohortId: z.string().uuid(), stackId: z.string().uuid() });

// Facilitators join through an admin-issued invite bound to a cohort and a stack from the managed list.
// The code is handed over by the admin (shown once); it is not emailed.
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

router.get('/facilitators', wrap(async (req, res) => {
  const [people, pending] = await Promise.all([
    query(
      `select p.id, p.full_name, p.email::text as email, p.is_active,
              coalesce(json_agg(json_build_object('id', fa.id, 'cohortId', fa.cohort_id, 'cohortNumber', c.number, 'stackId', fa.stack_id, 'stack', s.name)
                order by c.number desc, s.name) filter (where fa.id is not null), '[]') as assignments
       from profiles p left join facilitator_assignments fa on fa.facilitator_id = p.id
       left join cohorts c on c.id = fa.cohort_id left join stacks s on s.id = fa.stack_id
       where p.role = 'facilitator' group by p.id order by p.full_name`),
    query(`select email::text as email, full_name, expires_at from invites where role = 'facilitator' and used_at is null order by created_at desc`),
  ]);
  res.json({ facilitators: people.rows, pendingInvites: pending.rows });
}));

router.post('/facilitators/:id/assignments', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ cohortId: z.string().uuid(), stackId: z.string().uuid() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose a cohort and a stack');
  const ok = await query(
    `select 1 from profiles p, cohorts c, stacks s where p.id = $1 and p.role = 'facilitator' and p.is_active and c.id = $2 and s.id = $3 and s.is_active`,
    [id, p.data.cohortId, p.data.stackId]);
  if (!ok.rowCount) throw httpError(400, 'Choose an active facilitator, an existing cohort and an active stack');
  const r = await query('insert into facilitator_assignments (facilitator_id, cohort_id, stack_id) values ($1,$2,$3) on conflict do nothing', [id, p.data.cohortId, p.data.stackId]);
  if (r.rowCount) await log(req, 'facilitator.assign', 'profile', id, p.data);
  res.status(r.rowCount ? 201 : 200).json({ ok: true, created: r.rowCount === 1 });
}));

router.delete('/facilitator-assignments/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const { rows: [a] } = await query('delete from facilitator_assignments where id = $1 returning facilitator_id, cohort_id, stack_id', [id]);
  if (!a) throw httpError(404, 'Assignment not found');
  await log(req, 'facilitator.unassign', 'profile', a.facilitator_id, { cohortId: a.cohort_id, stackId: a.stack_id });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- announcements
router.get('/announcements', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const { rows } = await query(
    `select a.id, a.title, a.body, a.is_active, a.created_at, s.name as stack from announcements a left join stacks s on s.id = a.stack_id
     where a.cohort_id = $1 order by a.created_at desc limit 100`, [cohortId]);
  res.json({ announcements: rows });
}));

router.post('/announcements', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const p = z.object({ title: z.string().trim().min(2).max(140), body: z.string().trim().min(2).max(4000), stackId: z.string().uuid().nullable().optional() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter a title and a message');
  const { rows: [a] } = await query(
    'insert into announcements (cohort_id, stack_id, title, body, created_by) values ($1,$2,$3,$4,$5) returning id', [cohortId, p.data.stackId ?? null, p.data.title, p.data.body, req.user.id]);
  await log(req, 'announcement.create', 'announcement', a.id, { cohortId, title: p.data.title });
  res.status(201).json({ id: a.id });
}));

router.patch('/announcements/:id/active', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid request');
  const r = await query('update announcements set is_active = $2 where id = $1', [id, p.data.isActive]);
  if (!r.rowCount) throw httpError(404, 'Announcement not found');
  await log(req, p.data.isActive ? 'announcement.show' : 'announcement.hide', 'announcement', id, {});
  res.json({ ok: true });
}));

// ---------------------------------------------------------------- audit log (read-only, paginated)
router.get('/audit-log', wrap(async (req, res) => {
  const { page: pg, pageSize } = page(req, 100, 50);
  const action = String(req.query.action || '').trim().slice(0, 60) || null;
  const { rows } = await query(
    `select a.id, a.action, a.entity_type, a.entity_id, a.details, a.created_at, p.full_name as actor
     from audit_log a left join profiles p on p.id = a.actor_id
     where ($1::text is null or a.action like $1 || '%') order by a.created_at desc, a.id desc limit $2 offset $3`,
    [action, pageSize, (pg - 1) * pageSize]);
  res.json({ page: pg, pageSize, entries: rows });
}));

module.exports = router;
