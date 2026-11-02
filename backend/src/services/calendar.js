const { parseClassDate } = require('../lib/schedule');

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

// Pure: the default calendar for a cohort. One cohort-start marker, plus one class per week for EVERY chosen stack.
// Each event has a stable default_key so generating it again never duplicates anything and never overwrites an admin's edits.
function defaultCalendar({ week1ClassDate, timezone, cohortName, stacks, classTime = '10:00', durationMinutes = 120, weeks = 6 }) {
  const m = TIME_RE.exec(classTime);
  if (!m) throw new Error('Class start time must look like 10:00');
  const start = parseClassDate(week1ClassDate, timezone);
  const at = (day) => day.set({ hour: Number(m[1]), minute: Number(m[2]) });
  const events = [{
    defaultKey: 'default:cohort_start', stackId: null, title: `${cohortName} starts`, eventType: 'cohort_start',
    startsAt: at(start).toUTC().toJSDate(), endsAt: null,
  }];
  for (const stack of stacks) {
    for (let i = 0; i < weeks; i++) {
      const startsAt = at(start.plus({ days: 7 * i }));
      events.push({
        defaultKey: `default:class:w${i + 1}:${stack.id}`, stackId: stack.id, title: `${stack.name}: Week ${i + 1} class`, eventType: 'class',
        startsAt: startsAt.toUTC().toJSDate(), endsAt: startsAt.plus({ minutes: durationMinutes }).toUTC().toJSDate(),
      });
    }
  }
  return events;
}

// `db` is a transaction client. Records which stacks run in the cohort and inserts only the events that do not exist yet.
async function applyDefaultCalendar(db, { cohortId, stackIds, classTime, durationMinutes }) {
  const { rows: [c] } = await db.query('select name, timezone, week1_class_date::text as week1 from cohorts where id = $1', [cohortId]);
  if (!c) throw Object.assign(new Error('Cohort not found'), { status: 404 });
  const { rows: stacks } = stackIds.length
    ? await db.query('select id, name from stacks where id = any($1::uuid[]) and is_active order by name', [stackIds])
    : { rows: [] };
  if (stacks.length !== new Set(stackIds).size) throw Object.assign(new Error('Choose only active stacks'), { status: 400 });
  for (const s of stacks) await db.query('insert into cohort_stacks (cohort_id, stack_id) values ($1,$2) on conflict do nothing', [cohortId, s.id]);
  if (!stacks.length) return { created: 0, existing: 0 };

  const events = defaultCalendar({ week1ClassDate: c.week1, timezone: c.timezone, cohortName: c.name, stacks, classTime, durationMinutes });
  let created = 0;
  for (const e of events) {
    const r = await db.query(
      `insert into events (cohort_id, stack_id, title, event_type, starts_at, ends_at, default_key) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (cohort_id, default_key) where default_key is not null do nothing`,
      [cohortId, e.stackId, e.title, e.eventType, e.startsAt, e.endsAt, e.defaultKey]);
    created += r.rowCount;
  }
  return { created, existing: events.length - created };
}

module.exports = { defaultCalendar, applyDefaultCalendar, TIME_RE };
