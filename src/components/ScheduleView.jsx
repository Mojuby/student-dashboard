import { useMemo, useState } from 'react';
import MonthCalendar, { EventLine } from './MonthCalendar';
import { dayKey, dayLabel, groupByDay } from '../lib/calendar';

// One schedule, two views: a monthly calendar or a day-by-day list. Past events are greyed out in both.
export default function ScheduleView({ events, timezone, onSelectEvent, onSelectDay, emptyText = 'Nothing scheduled yet.', defaultView }) {
  const [view, setView] = useState(() => defaultView || (typeof window !== 'undefined' && window.innerWidth >= 768 ? 'calendar' : 'list'));
  const now = useMemo(() => new Date(), []);
  const grouped = useMemo(() => [...groupByDay(events, timezone).entries()], [events, timezone]);
  const today = dayKey(now, timezone);

  return (
    <div>
      <div role="tablist" aria-label="Schedule view" className="mb-3 inline-flex rounded-lg border border-brand-line bg-white p-0.5">
        {[['calendar', 'Calendar'], ['list', 'List']].map(([k, l]) => (
          <button key={k} role="tab" type="button" aria-selected={view === k} onClick={() => setView(k)}
            className={`rounded-md px-4 py-1.5 text-sm font-semibold ${view === k ? 'bg-brand-blue text-white' : 'text-brand-body hover:text-brand-blue'}`}>{l}</button>
        ))}
      </div>

      {view === 'calendar' ? (
        <MonthCalendar events={events} timezone={timezone} onSelectEvent={onSelectEvent} onSelectDay={onSelectDay} now={now} />
      ) : events.length === 0 ? <p className="text-sm text-brand-body">{emptyText}</p> : (
        <div className="space-y-4">
          {grouped.map(([key, list]) => (
            <section key={key} aria-label={dayLabel(key)}>
              <h3 className={`mb-1 text-sm font-bold ${key === today ? 'text-brand-blue' : key < today ? 'text-slate-400' : 'text-brand-navy'}`}>{dayLabel(key)}{key === today ? ' · Today' : ''}</h3>
              <div className="space-y-2">{list.map((e) => <EventLine key={e.id || `${e.title}-${e.startsAt}`} ev={e} tz={timezone} now={now} onSelect={onSelectEvent} />)}</div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
