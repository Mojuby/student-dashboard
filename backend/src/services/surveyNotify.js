const { query } = require('../db');
const config = require('../config');
const logger = require('../lib/logger');
const { sendEmail } = require('./mailer');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Emails a survey invitation to learners who have not been told yet. Bounded batches; safe to repeat (anyone already emailed,
// or issued without email in dry-run mode, is skipped; failures are retried next time).
async function sendSurveyNotifications({ surveyId, limit = 25 }) {
  const { rows: [s] } = await query(
    `select s.id, s.title, s.published, s.opens_at, s.closes_at, s.cohort_id, c.timezone from surveys s join cohorts c on c.id = s.cohort_id where s.id = $1`, [surveyId]);
  const now = new Date();
  if (!s || !s.published || new Date(s.opens_at) > now || new Date(s.closes_at) <= now) return { sent: 0, dryRun: 0, failed: 0, remaining: 0, skipped: true };
  const pending = `l.cohort_id = $1 and l.status <> 'withdrawn' and l.profile_id is not null
    and not exists (select 1 from survey_notifications n where n.survey_id = $2 and n.learner_id = l.id and n.status in ('sent','dry_run'))`;
  const { rows } = await query(`select l.id, l.full_name, l.email::text as email from learners l where ${pending} order by l.full_name limit $3`, [s.cohort_id, s.id, limit]);
  const link = `${config.app.url.replace(/\/$/, '')}/surveys`;
  const closes = new Date(s.closes_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: s.timezone });
  const out = { sent: 0, dryRun: 0, failed: 0 };
  for (const l of rows) {
    let status; let error = null;
    try {
      const first = l.full_name.split(' ')[0];
      const r = await sendEmail({
        to: l.email, subject: `Please complete the ${s.title}`,
        html: `<p>Hi ${esc(first)},</p><p>The <strong>${esc(s.title)}</strong> is now open. It takes about five minutes and helps us improve the bootcamp.</p><p><a href="${esc(link)}">Open the survey</a></p><p>It closes on ${esc(closes)}.</p><p>FUSE Varsity</p>`,
        text: `Hi ${first},\n\nThe ${s.title} is now open. It takes about five minutes.\nOpen it here: ${link}\nIt closes on ${closes}.\n\nFUSE Varsity`,
      });
      status = r.status;
    } catch (e) { status = 'failed'; error = String(e.message).slice(0, 200); logger.warn('survey.notify_failed', { surveyId, message: error }); }
    await query(
      `insert into survey_notifications (survey_id, learner_id, status, error) values ($1,$2,$3,$4)
       on conflict (survey_id, learner_id) do update set status = excluded.status, error = excluded.error, sent_at = now()`, [s.id, l.id, status, error]);
    if (status === 'sent') { out.sent++; if (config.mail.sendDelayMs) await sleep(config.mail.sendDelayMs); } else if (status === 'dry_run') out.dryRun++; else out.failed++;
  }
  const { rows: [rem] } = await query(`select count(*)::int as n from learners l where ${pending}`, [s.cohort_id, s.id]);
  if (rem.n === 0) await query('update surveys set notified_at = coalesce(notified_at, now()) where id = $1', [s.id]);
  return { ...out, remaining: rem.n };
}

// For the scheduled job: every published survey that has opened and not finished notifying.
async function runSurveyNotifications() {
  const { rows } = await query(`select id from surveys where published and opens_at <= now() and closes_at > now() and notified_at is null`);
  const results = [];
  for (const s of rows) {
    let total = { sent: 0, dryRun: 0, failed: 0 };
    for (let i = 0; i < 8; i++) {
      const r = await sendSurveyNotifications({ surveyId: s.id, limit: 25 });
      total = { sent: total.sent + r.sent, dryRun: total.dryRun + r.dryRun, failed: total.failed + r.failed };
      if (!r.remaining || (r.sent + r.dryRun) === 0) break;
    }
    results.push({ surveyId: s.id, ...total });
  }
  return results;
}

module.exports = { sendSurveyNotifications, runSurveyNotifications };
