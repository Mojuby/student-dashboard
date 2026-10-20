const { DateTime } = require('luxon');

const WEIGHTS = [5, 10, 10, 10, 10]; // weeks 1-5. Week 6 has no assessment.

function parseClassDate(isoDate, timezone) {
  const d = DateTime.fromISO(isoDate, { zone: timezone });
  if (!d.isValid) throw new Error('Invalid date or timezone');
  if (d.weekday !== 6) throw new Error('Week 1 class date must be a Saturday');
  return d.startOf('day');
}

// Week N starts on its class Saturday. Defaults: opens that Saturday, due the Sunday
// 8 days after the class (end of day). Both offsets are configurable per cohort.
function buildAssessmentSchedule({ week1ClassDate, timezone = 'Africa/Lagos', openOffsetDays = 0, dueOffsetDays = 8 }) {
  const start = parseClassDate(week1ClassDate, timezone);
  return WEIGHTS.map((maxScore, i) => {
    const classDay = start.plus({ days: i * 7 });
    return {
      weekNumber: i + 1,
      title: `Week ${i + 1} Assessment`,
      maxScore,
      opensAt: classDay.plus({ days: openOffsetDays }).startOf('day').toUTC().toJSDate(),
      dueAt: classDay.plus({ days: dueOffsetDays }).endOf('day').toUTC().toJSDate(),
    };
  });
}

module.exports = { buildAssessmentSchedule, parseClassDate, WEIGHTS };