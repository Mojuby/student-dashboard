import { useMemo, useState } from 'react';
import { WEEKDAYS, dayKey, dayLabel, groupByDay, isPast, monthCells, monthLabel, timeLabel, typeStyle, TYPE_LABEL } from '../lib/calendar';

const GREY = 'bg-slate-100 text-slate-400 line-through decoration-slate-300';

// Event row used under the grid and in list view. Past events are greyed out.
export function EventLine({ ev, tz, now, onSelect }) {
  const past = isPast(ev, now);
  const body = (
    <>
      <span className={`inline-block shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${past ? GREY : typeStyle(ev.eventType)}`}>{TYPE_LABEL[ev.eventType] || 'Event'}</span>
      <span className="min-w-0 flex-1">
        <span className={`block font-semibold break-anywhere ${past ? 'text-slate-400' : 'text-brand-navy'}`}>{ev.title}{past ? ' (past)' : ''}{ev.inactive ? ' (inactive)' : ''}</span>
        <span className={`block text-xs ${past ? 'text-slate-400' : 'text-brand-body'}`}>
          {timeLabel(ev.startsAt, tz)}{ev.endsAt ? ` – ${timeLabel(ev.endsAt, tz)}` : ''}{ev.stack ? ` · ${ev.stack}` : ''}{ev.audience === 'capstone' ? ' · Capstone-qualified only' : ''}
        </span>
        {ev.linkUrl && !past && <a href={ev.linkUrl} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-xs text-brand-blue underline">Join link</a>}
      </span>
    </>
  );
  return onSelect
    ? <button type="button" onClick={() => onSelect(ev)} className="flex w-full items-start gap-2 rounded-lg border border-brand-border bg-white p-2 text-left hover:border-brand-blue">{body}</button>
    : <div className="flex items-start gap-2 rounded-lg border border-brand-border bg-white p-2">{body}</div>;
}

// Monthly calendar. On phones each day shows coloured dots and the selected day's events are listed underneath;
// on larger screens event titles appear inside the day cells.
export default function MonthCalendar({ events, timezone, onSelectEvent, onSelectDay, now = new Date() }) {
  const today = dayKey(now, timezone);
  const [cursor, setCursor] = useState(() => ({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }));
  const [selected, setSelected] = useState(today);
  const byDay = useMemo(() => groupByDay(events, timezone), [events, timezone]);
  const cells = useMemo(() => monthCells(cursor.y, cursor.m), [cursor]);
  const move = (delta) => setCursor(({ y, m }) => { const d = new Date(Date.UTC(y, m + delta, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() }; });
  const pick = (key) => { setSelected(key); onSelectDay?.(key); };
  const dayEvents = byDay.get(selected) || [];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-heading text-lg font-bold text-brand-navy" aria-live="polite">{monthLabel(cursor.y, cursor.m)}</h3>
        <div className="flex gap-2">
          <button type="button" onClick={() => move(-1)} aria-label="Previous month" className="rounded-lg border border-brand-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">←</button>
          <button type="button" onClick={() => { setCursor({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) - 1 }); pick(today); }} className="rounded-lg border border-brand-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">Today</button>
          <button type="button" onClick={() => move(1)} aria-label="Next month" className="rounded-lg border border-brand-line bg-white px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">→</button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-brand-border bg-brand-border text-xs">
        {WEEKDAYS.map((d) => <div key={d} className="bg-slate-50 py-1.5 text-center font-semibold text-brand-body">{d}</div>)}
        {cells.map((c) => {
          const list = byDay.get(c.key) || [];
          const isSel = c.key === selected;
          return (
            <button key={c.key} type="button" onClick={() => pick(c.key)} aria-label={`${dayLabel(c.key)}, ${list.length} event${list.length === 1 ? '' : 's'}`} aria-pressed={isSel}
              className={`flex min-h-[3.25rem] flex-col items-stretch gap-0.5 p-1 text-left sm:min-h-[6.5rem] ${c.inMonth ? 'bg-white' : 'bg-slate-50 text-slate-400'} ${isSel ? 'ring-2 ring-inset ring-brand-blue' : ''}`}>
              <span className={`mx-auto inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold sm:mx-0 ${c.key === today ? 'bg-brand-blue text-white' : ''}`}>{c.day}</span>
              <span className="mx-auto flex gap-0.5 sm:hidden">
                {list.slice(0, 3).map((e, i) => <span key={i} className={`h-1.5 w-1.5 rounded-full ${isPast(e, now) ? 'bg-slate-300' : 'bg-brand-blue'}`} />)}
              </span>
              <span className="hidden flex-col gap-0.5 sm:flex">
                {list.slice(0, 3).map((e, i) => (
                  <span key={i} className={`truncate rounded px-1 py-0.5 text-[11px] font-medium ${isPast(e, now) ? GREY : typeStyle(e.eventType)}`}>{timeLabel(e.startsAt, timezone)} {e.title}</span>
                ))}
                {list.length > 3 && <span className="px-1 text-[11px] text-brand-body">+{list.length - 3} more</span>}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-3">
        <p className="mb-2 text-sm font-semibold text-brand-navy">{dayLabel(selected)}</p>
        {dayEvents.length === 0 ? <p className="text-sm text-brand-body">Nothing scheduled this day.</p>
          : <div className="space-y-2">{dayEvents.map((e) => <EventLine key={e.id || `${e.title}-${e.startsAt}`} ev={e} tz={timezone} now={now} onSelect={onSelectEvent} />)}</div>}
      </div>
    </div>
  );
}
