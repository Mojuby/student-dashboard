const { DateTime } = require('luxon');

// Which cohort week (1-based) a moment falls in, using the cohort's own timezone. Week 1 starts on the first class Saturday.
function cohortWeek(now, timezone, week1ClassDate) {
  const local = DateTime.fromJSDate(now, { zone: timezone }).startOf('day');
  const start = DateTime.fromISO(week1ClassDate, { zone: timezone }).startOf('day');
  if (!local.isValid || !start.isValid) return null;
  return Math.floor(local.diff(start, 'days').days / 7) + 1;
}

// Who should be nudged. ONLY work that is still SUBMITTABLE and has NOT been submitted counts:
//   - enabled, already open, deadline (including any personal extension) not yet passed
//   - not submitted. Submitted-but-not-yet-graded work NEVER triggers a reminder: waiting for a grade is not the learner's job.
// Returns [{ learner, cells }] with at least one outstanding cell each.
function selectReminderTargets({ learners, now }) {
  const out = [];
  for (const learner of learners) {
    const cells = learner.cells.filter((c) => c.isEnabled && !c.submitted && new Date(c.opensAt) <= now && new Date(c.dueAt) > now);
    if (cells.length) out.push({ learner, cells });
  }
  return out;
}

// Weeks 1-5: one reminder per outstanding assessment (each is tracked separately so a retry never double-sends).
// Week 6 (and later): ONE consolidated email per learner listing everything still outstanding.
const isConsolidatedWeek = (weekNumber) => weekNumber >= 6;

module.exports = { cohortWeek, selectReminderTargets, isConsolidatedWeek };
