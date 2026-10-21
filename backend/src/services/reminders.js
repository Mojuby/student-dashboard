const { DateTime } = require('luxon');
const config = require('../config');
const { query } = require('../db');
const { loadProgress } = require('./progress');
const { sendEmail } = require('./mailer');
const { reminderSlot } = require('../lib/reminderSchedule');

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// preview=true: list who WOULD be emailed, write nothing, send nothing.
async function runReminders({ now = new Date(), onlyCohortId = null, preview = false, ignoreWindow = false } = {}) {
  const { rows: cohorts } = await query(
    `select id, number, timezone, week1_class_date::text as week1, reminder_hour from cohorts
     where is_active and ($2::boolean or reminders_enabled) and ($1::uuid is null or id = $1)`,
    [onlyCohortId, preview]
  );
  const out = [];
  for (const c of cohorts) {
    const slotInfo = ignoreWindow
      ? { slot: DateTime.fromJSDate(now, { zone: c.timezone }).toISODate() }
      : reminderSlot({ now, timezone: c.timezone, week1ClassDate: c.week1, reminderHour: c.reminder_hour });
    if (!slotInfo) { out.push({ cohort: c.number, skipped: 'Not a reminder window' }); continue; }

    const { learners } = await loadProgress({ cohortId: c.id, now });
    const targets = [];
    for (const l of learners) {
      for (const cell of l.cells) {
        // Only opened, enabled, unsubmitted assessments whose (extended) deadline hasn't passed.
        if (cell.isEnabled && !cell.submitted && new Date(cell.opensAt) <= now && new Date(cell.dueAt) > now) targets.push({ l, cell });
      }
    }
    const result = { cohort: c.number, slot: slotInfo.slot, recipients: targets.length, processed: 0, failed: 0, dryRun: config.mail.dryRun };
    if (preview) {
      result.sample = targets.slice(0, 200).map(({ l, cell }) => ({ name: l.name, email: l.email, week: cell.weekNumber }));
      out.push(result);
      continue;
    }

    for (const { l, cell } of targets) {
      // Claim the (assessment, learner, day) slot. Only a previously FAILED row (under 3 attempts) can be re-claimed.
      const { rows: [claim] } = await query(
        `insert into reminder_log (assessment_id, learner_id, slot, status) values ($1,$2,$3,'pending')
         on conflict (assessment_id, learner_id, slot) do update
           set status = 'pending', attempts = reminder_log.attempts + 1, updated_at = now()
           where reminder_log.status = 'failed' and reminder_log.attempts < 3
         returning id`,
        [cell.assessmentId, l.id, slotInfo.slot]
      );
      if (!claim) continue;
      try {
        const due = DateTime.fromJSDate(new Date(cell.dueAt), { zone: c.timezone }).toFormat("cccc d LLLL 'at' h:mm a");
        const link = `${config.app.url.replace(/\/$/, '')}/assessments`;
        const r = await sendEmail({
          to: l.email,
          subject: `Week ${cell.weekNumber} assessment reminder`,
          html: `<p>Hi ${esc(l.name.split(' ')[0])},</p>
                 <p>A quick reminder: your Week ${cell.weekNumber} assessment is due on <strong>${esc(due)}</strong>.</p>
                 <p><a href="${esc(link)}">Submit your Google Docs or Drive link here</a></p>
                 <p>FUSE Varsity</p>`,
        });
        await query('update reminder_log set status = $2, updated_at = now() where id = $1', [claim.id, r.status]);
        result.processed++;
        if (r.status === 'sent') await sleep(600); // stay under provider rate limits
      } catch (e) {
        await query(`update reminder_log set status = 'failed', error = $2, updated_at = now() where id = $1`, [claim.id, String(e.message).slice(0, 200)]);
        result.failed++;
      }
    }
    out.push(result);
  }
  return { cohorts: out };
}

module.exports = { runReminders };