// Calendar helpers. All day grouping is done in the COHORT's timezone, so an 11pm class never lands on the wrong day.
export const dayKey = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
export const timeLabel = (d, tz) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date(d));
export const dayLabel = (key) => new Date(`${key}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
export const monthLabel = (y, m) => new Date(Date.UTC(y, m, 1)).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// 6 rows x 7 days (Sunday first) for a month; m is 0-11.
export function monthCells(y, m) {
  const first = new Date(Date.UTC(y, m, 1));
  const start = Date.UTC(y, m, 1 - first.getUTCDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start + i * 86400000);
    return { key: d.toISOString().slice(0, 10), day: d.getUTCDate(), inMonth: d.getUTCMonth() === m };
  });
}

export const isPast = (ev, now = new Date()) => new Date(ev.endsAt || ev.startsAt) < now;

export function groupByDay(events, tz) {
  const map = new Map();
  for (const e of [...events].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))) {
    const k = dayKey(e.startsAt, tz);
    map.set(k, [...(map.get(k) || []), e]);
  }
  return map;
}

// Colour per kind of event (past events are greyed regardless of kind).
export const TYPE_STYLE = {
  class: 'bg-blue-100 text-blue-900', cohort_start: 'bg-indigo-100 text-indigo-900', assessment: 'bg-amber-100 text-amber-900',
  assessment_open: 'bg-emerald-100 text-emerald-900', assessment_deadline: 'bg-red-100 text-red-900',
  capstone_milestone: 'bg-purple-100 text-purple-900', demo_day: 'bg-pink-100 text-pink-900', other: 'bg-slate-100 text-slate-800',
};
export const TYPE_LABEL = {
  class: 'Class', cohort_start: 'Cohort start', assessment: 'Assessment', assessment_open: 'Assessment opens', assessment_deadline: 'Assessment due',
  capstone_milestone: 'Capstone', demo_day: 'Demo day', other: 'Event',
};
export const typeStyle = (t) => TYPE_STYLE[t] || TYPE_STYLE.other;
