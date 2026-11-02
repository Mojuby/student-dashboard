const { DateTime } = require('luxon');
const config = require('../config');
const { query } = require('../db');
const { loadProgress } = require('./progress');
const { sendEmail } = require('./mailer');
const { reminderSlot } = require('../lib/reminderSchedule');
const { cohortWeek, selectReminderTargets, isConsolidatedWeek } = require('../lib/reminderTargets');

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
    const weekNumber = slotInfo.weekNumber ?? cohortWeek(now, c.timezone, c.week1);
    const consolidated = isConsolidatedWeek(weekNumber);
    const groups = selectReminderTargets({ learners, now });
    // Weeks 1-5: one email per outstanding assessment. Week 6+: one email per learner covering everything outstanding.
    const sends = consolidated ? groups.map((g) => ({ l: g.learner, cells: g.cells })) : groups.flatMap((g) => g.cells.map((cell) => ({ l: g.learner, cells: [cell] })));
    const result = { cohort: c.number, slot: slotInfo.slot, week: weekNumber, consolidated, recipients: sends.length, processed: 0, failed: 0, dryRun: config.mail.dryRun };
    if (preview) {
      result.sample = sends.slice(0, 200).map(({ l, cells }) => ({ name: l.name, email: l.email, week: cells.map((x) => x.weekNumber).join(', ') }));
      out.push(result);
      continue;
    }

    for (const { l, cells } of sends) {
      // Claim each (assessment, learner, day) slot. Only a previously FAILED row (under 3 attempts) can be re-claimed.
      const claimed = [];
      for (const cell of cells) {
        const { rows: [claim] } = await query(
          `insert into reminder_log (assessment_id, learner_id, slot, status) values ($1,$2,$3,'pending')
           on conflict (assessment_id, learner_id, slot) do update
             set status = 'pending', attempts = reminder_log.attempts + 1, updated_at = now()
             where reminder_log.status = 'failed' and reminder_log.attempts < 3
           returning id`,
          [cell.assessmentId, l.id, slotInfo.slot]
        );
        if (claim) claimed.push({ cell, id: claim.id });
      }
      if (!claimed.length) continue;
      try {
        const link = `${config.app.url.replace(/\/$/, '')}/assessments`;
        const dueOf = (cell) => DateTime.fromJSDate(new Date(cell.dueAt), { zone: c.timezone }).toFormat("cccc d LLLL 'at' h:mm a");
        const first = esc(l.name.split(' ')[0]);
        const items = claimed.map(({ cell }) => `<li>Week ${cell.weekNumber}${cell.title ? ` (${esc(cell.title)})` : ''}: due <strong>${esc(dueOf(cell))}</strong></li>`).join('');
        const r = await sendEmail({
          to: l.email,
          subject: claimed.length > 1 || consolidated ? 'You still have unsubmitted assessments' : `Week ${claimed[0].cell.weekNumber} assessment reminder`,
          html: `<p>Hi ${first},</p>
                 <p>A quick reminder: ${claimed.length > 1 ? 'these assessments have' : 'this assessment has'} not been submitted yet.</p>
                 <ul>${items}</ul>
                 <p><a href="${esc(link)}">Open your assessments</a></p>
                 <p>FUSE Varsity</p>`,
        });
        for (const { id } of claimed) await query('update reminder_log set status = $2, updated_at = now() where id = $1', [id, r.status]);
        result.processed++;
        if (r.status === 'sent') await sleep(600); // stay under provider rate limits
      } catch (e) {
        for (const { id } of claimed) await query(`update reminder_log set status = 'failed', error = $2, updated_at = now() where id = $1`, [id, String(e.message).slice(0, 200)]);
        result.failed++;
      }
    }
    out.push(result);
  }
  return { cohorts: out };
}

module.exports = { runReminders };