const { query } = require('../db');
const config = require('../config');
const { httpError } = require('../lib/http');
const { audit } = require('../lib/audit');
const logger = require('../lib/logger');
const { createInviteRecord } = require('./invites');
const { sendEmail } = require('./mailer');

const INVITE_DAYS = 30;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// The email carries an invite code, never a password. The code also rides in the URL fragment (#code=...), which
// browsers do not send to servers or log, so it stays out of access logs.
function inviteEmail({ fullName, email, code, appUrl, cohortName }) {
  const link = `${appUrl}/claim?email=${encodeURIComponent(email)}#code=${encodeURIComponent(code)}`;
  const first = String(fullName).split(' ')[0];
  return {
    subject: `Activate your FUSE Varsity account (${cohortName})`,
    html: `<p>Hi ${esc(first)},</p>
<p>You are enrolled in <strong>${esc(cohortName)}</strong>. Activate your account and choose your own password here:</p>
<p><a href="${esc(link)}">Activate my account</a></p>
<p>Or open ${esc(appUrl)}/claim and enter your email with this invite code: <strong>${esc(code)}</strong></p>
<p>The code works once and expires in ${INVITE_DAYS} days. If it has expired, use the "request a new invitation" option on the activation page.</p>
<p>FUSE Varsity</p>`,
    text: `Hi ${first},\n\nYou are enrolled in ${cohortName}. Activate your account: ${link}\n\nOr open ${appUrl}/claim and enter your email with this invite code: ${code}\n\nThe code works once and expires in ${INVITE_DAYS} days.\n\nFUSE Varsity`,
  };
}

// Issues a fresh invite for one enrolment and attempts delivery. Safe to call repeatedly: each call replaces the open invite.
// `code` is returned ONLY when it was not emailed (dry run / provider failure) so an admin can hand it over; it is never logged or stored.
async function issueInvitation({ learnerId, actorId = null, source = 'admin' }) {
  const { rows: [l] } = await query(
    `select l.id, l.email, l.full_name, l.status, l.profile_id, l.cohort_id, c.name as cohort_name, c.status as cohort_status
     from learners l join cohorts c on c.id = l.cohort_id where l.id = $1`, [learnerId]);
  if (!l) throw httpError(404, 'Learner not found');
  const base = { learnerId: l.id, email: l.email, name: l.full_name };
  if (l.status === 'withdrawn') return { ...base, outcome: 'skipped', reason: 'Learner is withdrawn' };
  if (!['upcoming', 'active'].includes(l.cohort_status)) return { ...base, outcome: 'skipped', reason: 'Cohort is not open for activation' };
  const hasAccount = l.profile_id || (await query('select 1 from profiles where email = $1', [l.email])).rowCount;
  if (hasAccount) return { ...base, outcome: 'skipped', reason: 'Learner already has an account' };

  const { code, id: inviteId } = await createInviteRecord({ query }, {
    role: 'learner', email: l.email, fullName: l.full_name, cohortId: l.cohort_id, learnerId: l.id, days: INVITE_DAYS, createdBy: actorId,
  });

  let delivery; let error = null;
  try {
    const mail = inviteEmail({ fullName: l.full_name, email: l.email, code, appUrl: config.app.url, cohortName: l.cohort_name });
    delivery = (await sendEmail({ to: l.email, ...mail })).status; // 'sent' | 'dry_run'
  } catch (e) {
    delivery = 'failed';
    error = String(e.message).slice(0, 200);
    logger.warn('invite.delivery_failed', { learnerId: l.id, message: error });
  }

  await query(
    `update invites set delivery_status = $2, delivery_attempts = delivery_attempts + 1, delivery_error = $3,
       sent_at = case when $2 = 'sent' then now() else sent_at end where id = $1`, [inviteId, delivery, error]);
  // A failed delivery leaves the learner "enrolled" so the next send run picks them up again.
  if (delivery !== 'failed') {
    await query(
      `update learners set status = case when status = 'enrolled' then 'invited' else status end,
         invited_at = coalesce(invited_at, now()) where id = $1`, [l.id]);
  }
  await audit({ actorId, action: 'invite.issue', entityType: 'learner', entityId: l.id, details: { delivery, source, ...(error ? { error } : {}) } });
  return { ...base, outcome: delivery, error, ...(delivery === 'sent' ? {} : { code }) };
}

// Bounded batch so an HTTP request never runs for minutes. Call again until `remaining` is 0.
// With explicit learnerIds every listed learner gets a fresh code (resend). Without, only learners who have not
// been successfully invited (never invited, failed delivery, or invite expired) are included.
async function sendInvitations({ cohortId, actorId, learnerIds = null, limit = 25 }) {
  const where = `l.cohort_id = $1 and l.profile_id is null and l.status in ('enrolled','invited')
    and not exists (select 1 from profiles p where p.email = l.email)
    and ($2::uuid[] is not null or not exists (
      select 1 from invites i where i.email = l.email and i.role = 'learner' and i.used_at is null
        and i.expires_at > now() and i.delivery_status in ('sent','dry_run')))
    and ($2::uuid[] is null or l.id = any($2::uuid[]))`;
  const { rows } = await query(`select l.id from learners l where ${where} order by l.full_name limit $3`, [cohortId, learnerIds, limit]);
  const results = [];
  for (const r of rows) {
    const out = await issueInvitation({ learnerId: r.id, actorId });
    results.push(out);
    if (out.outcome === 'sent' && config.mail.sendDelayMs) await sleep(config.mail.sendDelayMs);
  }
  const { rows: [rem] } = await query(`select count(*)::int as n from learners l where ${where}`, [cohortId, learnerIds]);
  // When resending explicit ids, "remaining" is only meaningful for the pending queue.
  const remaining = learnerIds ? 0 : Math.max(0, rem.n - results.filter((x) => x.outcome === 'sent' || x.outcome === 'dry_run').length);
  const count = (o) => results.filter((x) => x.outcome === o).length;
  return {
    processed: results.length, sent: count('sent'), dryRun: count('dry_run'), failed: count('failed'), skipped: count('skipped'), remaining,
    // Codes for anything that could not be emailed. Shown once to the admin; hash-only at rest.
    handDelivery: results.filter((x) => x.code).map((x) => ({ learnerId: x.learnerId, name: x.name, email: x.email, code: x.code, outcome: x.outcome })),
    failures: results.filter((x) => x.outcome === 'failed').map((x) => ({ learnerId: x.learnerId, email: x.email, error: x.error })),
  };
}

module.exports = { issueInvitation, sendInvitations, inviteEmail, INVITE_DAYS };
