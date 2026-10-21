const { DateTime } = require('luxon');

// Wednesday (3) and Friday (5), first six weeks, inside a 3-hour window from the reminder hour.
// `slot` is the cohort-local date; (assessment, learner, slot) is unique in reminder_log, so retries never double-send.
function reminderSlot({ now, timezone, week1ClassDate, reminderHour = 9 }) {
  const local = DateTime.fromJSDate(now, { zone: timezone });
  const start = DateTime.fromISO(week1ClassDate, { zone: timezone }).startOf('day');
  if (!local.isValid || !start.isValid) return null;
  const weekNumber = Math.floor(local.startOf('day').diff(start, 'days').days / 7) + 1;
  if (weekNumber < 1 || weekNumber > 6) return null;
  if (![3, 5].includes(local.weekday)) return null;
  if (local.hour < reminderHour || local.hour >= reminderHour + 3) return null;
  return { slot: local.toISODate(), weekNumber, weekday: local.weekday };
}

module.exports = { reminderSlot };