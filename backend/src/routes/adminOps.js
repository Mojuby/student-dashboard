const router = require('express').Router();
const { z } = require('zod');
const { query } = require('../db');
const { audit } = require('../lib/audit');
const { wrap, httpError, uuid } = require('../lib/http');
const { normalizeWhatsAppInvite, normalizeHttps } = require('../lib/urls');
const { toUtcDate, toLocalInput } = require('../lib/tz');
const { severity } = require('../lib/risk');
const { weeklyMetrics, funnel, DEFINITIONS } = require('../lib/analytics');
const config = require('../config');
const { loadProgress } = require('../services/progress');
const { runReminders } = require('../services/reminders');

const log = (req, action, entityType, entityId, details) =>
  audit({ actorId: req.user.id, action, entityType, entityId, details, ip: req.ip });

// An explicit ?cohortId is always honoured (any status, so history stays reachable). Without one we fall back to the
// most recent ACTIVE cohort; several can be active at once, so the UI should always send cohortId.
async function cohortIdFrom(req) {
  if (req.query.cohortId) return uuid(req.query.cohortId);
  const { rows: [c] } = await query(
    'select id from cohorts where is_active order by (number = $1::int) desc nulls last, number desc limit 1', [config.activeCohortNumber]);
  if (!c) throw httpError(404, 'No active cohort. Choose a cohort.');
  return c.id;
}
async function cohortTz(cohortId) {
  const { rows: [c] } = await query('select timezone from cohorts where id = $1', [cohortId]);
  if (!c) throw httpError(404, 'Cohort not found');
  return c.timezone;
}
const localDate = (v, tz) => { try { return toUtcDate(v, tz); } catch { throw httpError(400, 'Invalid date or time'); } };

// ---------- Learners ----------
router.get('/learners-overview', wrap(async (req, res) => {
  const stackId = req.query.stackId ? uuid(req.query.stackId) : null;
  const q = String(req.query.q || '').trim().toLowerCase();
  const pageSize = Math.min(500, Math.max(1, Number(req.query.pageSize) || 200));
  const pg = Math.max(1, Number(req.query.page) || 1);
  const p = await loadProgress({ cohortId: await cohortIdFrom(req), stackId });
  const matched = p.learners.filter((l) => !q || l.name.toLowerCase().includes(q) || l.email.toLowerCase().includes(q));
  res.json({
    cohort: { id: p.cohort.id, number: p.cohort.number },
    total: matched.length, page: pg, pageSize,
    learners: matched.slice((pg - 1) * pageSize, pg * pageSize).map((l) => ({
      id: l.id, name: l.name, email: l.email, stack: l.stack, cohortNumber: p.cohort.number, group: l.group,
      completionPct: l.completionPct, scorePct: l.scorePct, latestScore: l.latestScore,
      riskStatus: l.risk.status, riskCount: l.risk.reasons.length, potentiallyDisengaged: l.risk.potentiallyDisengaged,
      weekStatuses: l.cells.filter((c) => c.isEnabled).map((c) => ({ week: c.weekNumber, status: c.status })),
    })),
  });
}));

router.get('/learners/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const { rows: [l] } = await query(
    `select l.cohort_id, l.status, l.invited_at, l.activated_at, l.orientation_completed_at, l.withdrawn_at, (l.profile_id is not null) as has_account
     from learners l where l.id = $1`, [id]);
  if (!l) throw httpError(404, 'Learner not found');
  const p = await loadProgress({ cohortId: l.cohort_id, learnerId: id });
  const { rows: [inv] } = await query(
    `select delivery_status, delivery_attempts, delivery_error, sent_at, expires_at, used_at from invites where learner_id = $1 order by created_at desc limit 1`, [id]);
  res.json({
    cohort: { number: p.cohort.number, timezone: p.cohort.timezone },
    learner: p.learners[0],
    enrolment: { status: l.status, hasAccount: l.has_account, invitedAt: l.invited_at, activatedAt: l.activated_at, orientationCompletedAt: l.orientation_completed_at, withdrawnAt: l.withdrawn_at, invitation: inv || null },
  });
}));

// ---------- Capstone groups ----------
const groupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  whatsappUrl: z.string().max(2048),
  stackId: z.string().uuid().nullable().optional(),
});

router.get('/groups', wrap(async (req, res) => {
  const cohortId = await cohortIdFrom(req);
  const [g, m, l] = await Promise.all([
    query(`select g.id, g.name, g.whatsapp_url, g.stack_id, s.name as stack, g.updated_at from capstone_groups g
           left join stacks s on s.id = g.stack_id where g.cohort_id = $1 order by g.created_at`, [cohortId]),
    query(`select m.group_id, l.id, l.full_name, s.name as stack from capstone_members m
           join capstone_groups g on g.id = m.group_id join learners l on l.id = m.learner_id join stacks s on s.id = l.stack_id
           where g.cohort_id = $1 order by l.full_name`, [cohortId]),
    query(`select l.id, l.full_name, s.name as stack, l.stack_id, m.group_id from learners l join stacks s on s.id = l.stack_id
           left join capstone_members m on m.learner_id = l.id where l.cohort_id = $1 order by s.name, l.full_name`, [cohortId]),
  ]);
  res.json({ groups: g.rows.map((x) => ({ ...x, members: m.rows.filter((y) => y.group_id === x.id) })), learners: l.rows });
}));

router.post('/groups', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const p = groupSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter a group name and a WhatsApp link');
  const wa = normalizeWhatsAppInvite(p.data.whatsappUrl);
  if (!wa) throw httpError(400, 'That is not a valid WhatsApp invite link (https://chat.whatsapp.com/...)');
  const { rows: [g] } = await query(
    'insert into capstone_groups (cohort_id, stack_id, name, whatsapp_url) values ($1,$2,$3,$4) returning id',
    [cohortId, p.data.stackId ?? null, p.data.name, wa]);
  await log(req, 'group.create', 'group', g.id, { name: p.data.name });
  res.status(201).json({ id: g.id });
}));

router.put('/groups/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = groupSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter a group name and a WhatsApp link');
  const wa = normalizeWhatsAppInvite(p.data.whatsappUrl);
  if (!wa) throw httpError(400, 'That is not a valid WhatsApp invite link (https://chat.whatsapp.com/...)');
  const r = await query(
    'update capstone_groups set name = $2, whatsapp_url = $3, stack_id = $4, updated_at = now() where id = $1',
    [id, p.data.name, wa, p.data.stackId ?? null]);
  if (!r.rowCount) throw httpError(404, 'Group not found');
  await log(req, 'group.update', 'group', id, { name: p.data.name });
  res.json({ ok: true });
}));

// Assigning moves a learner out of any previous group (one group per learner).
router.put('/groups/:id/members', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ learnerIds: z.array(z.string().uuid()).min(1).max(200) }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose at least one learner');
  const { rows: [g] } = await query('select cohort_id, stack_id from capstone_groups where id = $1', [id]);
  if (!g) throw httpError(404, 'Group not found');
  const ids = [...new Set(p.data.learnerIds)];
  const ok = await query(
    'select id from learners where id = any($1::uuid[]) and cohort_id = $2 and ($3::uuid is null or stack_id = $3)',
    [ids, g.cohort_id, g.stack_id]);
  if (ok.rowCount !== ids.length) throw httpError(400, "Every learner must be in this group's cohort (and stack, if the group is stack-specific)");
  await query(
    `insert into capstone_members (group_id, learner_id) select $1, unnest($2::uuid[])
     on conflict (learner_id) do update set group_id = excluded.group_id`, [id, ids]);
  await query('update capstone_groups set updated_at = now() where id = $1', [id]);
  await log(req, 'group.assign', 'group', id, { learnerIds: ids });
  res.json({ ok: true });
}));

router.delete('/groups/:id/members/:learnerId', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const learnerId = uuid(req.params.learnerId);
  await query('delete from capstone_members where group_id = $1 and learner_id = $2', [id, learnerId]);
  await query('update capstone_groups set updated_at = now() where id = $1', [id]);
  await log(req, 'group.remove_member', 'group', id, { learnerId });
  res.json({ ok: true });
}));

// ---------- Assessment schedule and extensions ----------
router.get('/assessments', wrap(async (req, res) => {
  const cohortId = await cohortIdFrom(req);
  const tz = await cohortTz(cohortId);
  const { rows } = await query(
    'select id, week_number, title, max_score, opens_at, due_at, is_enabled from assessments where cohort_id = $1 order by week_number', [cohortId]);
  const { rows: ext } = await query(
    `select e.id, a.week_number, l.full_name, e.new_due_at, e.reason, e.created_at from deadline_extensions e
     join assessments a on a.id = e.assessment_id join learners l on l.id = e.learner_id
     where a.cohort_id = $1 order by e.created_at desc`, [cohortId]);
  const { rows: learners } = await query('select id, full_name from learners where cohort_id = $1 order by full_name', [cohortId]);
  res.json({
    timezone: tz, learners,
    assessments: rows.map((a) => ({
      id: a.id, weekNumber: a.week_number, title: a.title, maxScore: Number(a.max_score), isEnabled: a.is_enabled,
      opensAtLocal: toLocalInput(a.opens_at, tz), dueAtLocal: toLocalInput(a.due_at, tz),
    })),
    extensions: ext,
  });
}));

const patchSchema = z.object({
  opensAtLocal: z.string().optional(), dueAtLocal: z.string().optional(),
  isEnabled: z.boolean().optional(), reason: z.string().trim().min(3).max(300),
});

router.patch('/assessments/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = patchSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'A reason (3+ characters) is required for any schedule change');
  const { rows: [a] } = await query(
    'select a.opens_at, a.due_at, a.is_enabled, c.timezone from assessments a join cohorts c on c.id = a.cohort_id where a.id = $1', [id]);
  if (!a) throw httpError(404, 'Assessment not found');
  const opens = p.data.opensAtLocal ? localDate(p.data.opensAtLocal, a.timezone) : a.opens_at;
  const due = p.data.dueAtLocal ? localDate(p.data.dueAtLocal, a.timezone) : a.due_at;
  const enabled = p.data.isEnabled ?? a.is_enabled;
  if (!(new Date(due) > new Date(opens))) throw httpError(400, 'The deadline must be after the opening date');
  await query('update assessments set opens_at = $2, due_at = $3, is_enabled = $4 where id = $1', [id, opens, due, enabled]);
  await log(req, 'assessment.schedule_change', 'assessment', id, {
    reason: p.data.reason,
    before: { opensAt: a.opens_at, dueAt: a.due_at, isEnabled: a.is_enabled },
    after: { opensAt: opens, dueAt: due, isEnabled: enabled },
  });
  res.json({ ok: true });
}));

router.post('/assessments/:id/extensions', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ learnerId: z.string().uuid(), newDueAtLocal: z.string(), reason: z.string().trim().min(3).max(300) }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Choose a learner, a new deadline and a reason');
  const { rows: [a] } = await query(
    'select a.cohort_id, a.due_at, c.timezone from assessments a join cohorts c on c.id = a.cohort_id where a.id = $1', [id]);
  if (!a) throw httpError(404, 'Assessment not found');
  const newDue = localDate(p.data.newDueAtLocal, a.timezone);
  if (!(newDue > new Date(a.due_at))) throw httpError(400, 'An extension must be later than the current deadline');
  const ok = await query('select 1 from learners where id = $1 and cohort_id = $2', [p.data.learnerId, a.cohort_id]);
  if (!ok.rowCount) throw httpError(400, 'That learner is not in this cohort');
  await query(
    'insert into deadline_extensions (assessment_id, learner_id, new_due_at, reason, created_by) values ($1,$2,$3,$4,$5)',
    [id, p.data.learnerId, newDue, p.data.reason, req.user.id]);
  await log(req, 'assessment.extension', 'assessment', id, { learnerId: p.data.learnerId, newDueAt: newDue, reason: p.data.reason });
  res.status(201).json({ ok: true });
}));

// ---------- Calendar events ----------
const EVENT_TYPES = ['cohort_start', 'class', 'assessment', 'capstone_milestone', 'demo_day', 'other'];
const eventSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  eventType: z.enum(EVENT_TYPES),
  stackId: z.string().uuid().nullable().optional(),
  startsAtLocal: z.string(),
  endsAtLocal: z.string().nullable().optional(),
  linkUrl: z.string().max(2048).nullable().optional(),
});

function eventValues(data, tz) {
  const link = data.linkUrl ? normalizeHttps(data.linkUrl) : null;
  if (data.linkUrl && !link) throw httpError(400, 'The link must be a valid https URL');
  const starts = localDate(data.startsAtLocal, tz);
  const ends = data.endsAtLocal ? localDate(data.endsAtLocal, tz) : null;
  if (ends && ends < starts) throw httpError(400, 'The end must be after the start');
  return [data.title, data.description ?? null, data.eventType, data.stackId ?? null, starts, ends, link];
}

router.get('/events', wrap(async (req, res) => {
  const cohortId = await cohortIdFrom(req);
  const tz = await cohortTz(cohortId);
  const { rows } = await query(
    `select e.id, e.title, e.description, e.event_type, e.stack_id, s.name as stack, e.starts_at, e.ends_at, e.link_url, e.is_active
     from events e left join stacks s on s.id = e.stack_id where e.cohort_id = $1 order by e.starts_at`, [cohortId]);
  res.json({ timezone: tz, events: rows.map((e) => ({ ...e, startsAtLocal: toLocalInput(e.starts_at, tz), endsAtLocal: e.ends_at ? toLocalInput(e.ends_at, tz) : '' })) });
}));

router.post('/events', wrap(async (req, res) => {
  const cohortId = uuid(req.query.cohortId);
  const p = eventSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter a title, type and start time');
  const vals = eventValues(p.data, await cohortTz(cohortId));
  const { rows: [e] } = await query(
    `insert into events (cohort_id, title, description, event_type, stack_id, starts_at, ends_at, link_url)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [cohortId, ...vals]);
  await log(req, 'event.create', 'event', e.id, { title: p.data.title });
  res.status(201).json({ id: e.id });
}));

router.put('/events/:id', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = eventSchema.safeParse(req.body);
  if (!p.success) throw httpError(400, 'Enter a title, type and start time');
  const { rows: [ev] } = await query('select cohort_id from events where id = $1', [id]);
  if (!ev) throw httpError(404, 'Event not found');
  const vals = eventValues(p.data, await cohortTz(ev.cohort_id));
  await query(
    `update events set title = $2, description = $3, event_type = $4, stack_id = $5, starts_at = $6, ends_at = $7,
       link_url = $8, updated_at = now() where id = $1`, [id, ...vals]);
  await log(req, 'event.update', 'event', id, { title: p.data.title });
  res.json({ ok: true });
}));

router.patch('/events/:id/active', wrap(async (req, res) => {
  const id = uuid(req.params.id);
  const p = z.object({ isActive: z.boolean() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid request');
  const r = await query('update events set is_active = $2, updated_at = now() where id = $1', [id, p.data.isActive]);
  if (!r.rowCount) throw httpError(404, 'Event not found');
  await log(req, p.data.isActive ? 'event.activate' : 'event.deactivate', 'event', id, {});
  res.json({ ok: true });
}));

// ---------- Reminders ----------
router.get('/reminders', wrap(async (req, res) => {
  const cohortId = await cohortIdFrom(req);
  const { rows: [c] } = await query('select reminders_enabled, reminder_hour, timezone from cohorts where id = $1', [cohortId]);
  const { rows: logRows } = await query(
    `select r.id, r.status, r.attempts, r.error, r.slot::text as slot, r.updated_at, l.full_name, a.week_number
     from reminder_log r join learners l on l.id = r.learner_id join assessments a on a.id = r.assessment_id
     where a.cohort_id = $1 order by r.updated_at desc limit 100`, [cohortId]);
  res.json({
    enabled: c.reminders_enabled, hour: c.reminder_hour, timezone: c.timezone,
    mail: { dryRun: config.mail.dryRun, configured: !!(config.mail.resendKey && config.mail.emailFrom) },
    log: logRows,
  });
}));

router.patch('/reminders', wrap(async (req, res) => {
  const cohortId = await cohortIdFrom(req);
  const p = z.object({ enabled: z.boolean().optional(), hour: z.number().int().min(0).max(20).optional() }).safeParse(req.body);
  if (!p.success) throw httpError(400, 'Invalid reminder settings');
  await query(
    'update cohorts set reminders_enabled = coalesce($2, reminders_enabled), reminder_hour = coalesce($3, reminder_hour) where id = $1',
    [cohortId, p.data.enabled ?? null, p.data.hour ?? null]);
  await log(req, 'reminders.config', 'cohort', cohortId, p.data);
  res.json({ ok: true });
}));

// Lists who WOULD be emailed right now. Never sends and never writes.
router.post('/reminders/preview', wrap(async (req, res) => {
  res.json(await runReminders({ onlyCohortId: await cohortIdFrom(req), preview: true, ignoreWindow: true }));
}));

// ---------- Analytics ----------
router.get('/analytics', wrap(async (req, res) => {
  const p = await loadProgress({ cohortId: await cohortIdFrom(req) });
  const now = new Date();
  const atRisk = p.learners.filter((l) => l.risk.status === 'at_risk');
  const followUps = atRisk.map((l) => ({
    id: l.id, name: l.name, stack: l.stack, reasons: l.risk.reasons, severity: severity(l.risk.reasons),
    potentiallyDisengaged: l.risk.potentiallyDisengaged, lastActivityAt: l.lastActivityAt,
    recommended: [...new Set(l.risk.reasons.map((r) => r.action))],
  })).sort((a, b) => b.severity - a.severity);
  res.json({
    cohort: { number: p.cohort.number, timezone: p.cohort.timezone },
    weekly: weeklyMetrics({ assessments: p.assessments.filter((a) => a.isEnabled), learners: p.learners, now, lowScorePct: p.cohort.risk_low_score_pct }),
    funnel: funnel({ learners: p.learners, now }),
    summary: {
      atRisk: atRisk.length,
      fallingBehind: atRisk.filter((l) => l.risk.missedCount > 0).length,
      potentiallyDisengaged: p.learners.filter((l) => l.risk.potentiallyDisengaged).length,
      highPerformers: p.learners.filter((l) => l.risk.highPerformer).length,
    },
    stacks: [...new Set(p.learners.map((l) => l.stack))].sort(),
    followUps,
    definitions: DEFINITIONS,
  });
}));

module.exports = router;