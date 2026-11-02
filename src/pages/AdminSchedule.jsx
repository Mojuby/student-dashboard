import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import useCohort from '../lib/useCohort';
import { fmt } from '../lib/format';
import { Banner, Card, CohortPicker } from '../components/ui';
import ScheduleView from '../components/ScheduleView';

const input = 'px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';
const TYPES = ['cohort_start', 'class', 'assessment', 'capstone_milestone', 'demo_day', 'other'];
const TYPE_NAMES = { cohort_start: 'Cohort start', class: 'Class', assessment: 'Assessment', capstone_milestone: 'Capstone (qualified learners only)', demo_day: 'Demo day', other: 'Other' };

function AssessmentRow({ a, run }) {
  const [v, setV] = useState({ opens: a.opensAtLocal, due: a.dueAtLocal, enabled: a.isEnabled, reason: '' });
  return (
    <tr className="border-t border-brand-border align-top">
      <td className="py-2 font-semibold">Week {a.weekNumber}<br /><span className="text-xs font-normal text-brand-body">{a.kind === 'quiz' ? 'Quiz' : 'Assignment'} · /{a.maxScore}<br />{a.stack || 'All stacks'}</span></td>
      <td><input type="datetime-local" value={v.opens} onChange={(e) => setV({ ...v, opens: e.target.value })} className={input} aria-label={`Week ${a.weekNumber} opens`} /></td>
      <td><input type="datetime-local" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} className={input} aria-label={`Week ${a.weekNumber} due`} /></td>
      <td><label className="text-sm"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /> Enabled</label></td>
      <td><input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} placeholder="Reason (required)" className={input} /></td>
      <td><button disabled={v.reason.trim().length < 3} className={btn}
        onClick={() => run(() => api(`/admin/assessments/${a.id}`, { method: 'PATCH', body: { opensAtLocal: v.opens, dueAtLocal: v.due, isEnabled: v.enabled, reason: v.reason } }), `Week ${a.weekNumber} updated`)}>Save</button></td>
    </tr>
  );
}

export default function AdminSchedule() {
  const { cohorts, cohortId, setCohortId, error } = useCohort();
  const [sched, setSched] = useState(null);
  const [events, setEvents] = useState(null);
  const [rem, setRem] = useState(null);
  const [stacks, setStacks] = useState([]);
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [editing, setEditing] = useState(null);
  const [stackFilter, setStackFilter] = useState('');
  const [prefillDay, setPrefillDay] = useState('');
  const [calStacks, setCalStacks] = useState({});
  const [classTime, setClassTime] = useState('10:00');
  const [capstone, setCapstone] = useState(null);
  const formRef = useRef(null);

  const fetchAll = (id) => Promise.all([api(`/admin/assessments?cohortId=${id}`), api(`/admin/events?cohortId=${id}`), api(`/admin/reminders?cohortId=${id}`)]);
  const load = useCallback(async (id) => { const [a, e, r] = await fetchAll(id); setSched(a); setEvents(e); setRem(r); }, []);
  useEffect(() => { api('/admin/stacks').then((r) => setStacks(r.stacks)).catch(() => {}); }, []);
  useEffect(() => {
    if (!cohortId) return;
    fetchAll(cohortId).then(([a, e, r]) => { setSched(a); setEvents(e); setRem(r); }).catch((e) => setErr(e.message));
  }, [cohortId]);

  async function run(fn, ok) {
    setErr(''); setMsg('');
    try { const r = await fn(); if (ok) setMsg(ok); await load(cohortId); return r; } catch (e) { setErr(e.message); return null; }
  }
  const fd = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); e.currentTarget.reset(); return f; };
  const addExt = (e) => { const f = fd(e); run(() => api(`/admin/assessments/${f.assessmentId}/extensions`, { method: 'POST', body: { learnerId: f.learnerId, newDueAtLocal: f.due, reason: f.reason } }), 'Extension recorded'); };
  const evBody = (f) => ({ title: f.title, description: f.description || null, eventType: f.type, stackId: f.stackId || null, startsAtLocal: f.starts, endsAtLocal: f.ends || null, linkUrl: f.link || null, audience: f.type === 'capstone_milestone' ? 'capstone' : (f.audience || 'everyone') });
  const addEvent = (e) => { const f = fd(e); setPrefillDay(''); run(() => api(`/admin/events?cohortId=${cohortId}`, { method: 'POST', body: evBody(f) }), 'Event created'); };
  const generate = async () => {
    const stackIds = Object.keys(calStacks).filter((k) => calStacks[k]);
    const r = await run(() => api(`/admin/cohorts/${cohortId}/default-calendar`, { method: 'POST', body: { stackIds, classTime } }));
    if (r) setMsg(`Default calendar: ${r.created} event(s) created${r.existing ? `, ${r.existing} already existed and were left as they are` : ''}.`);
  };
  const syncCapstone = async () => {
    const r = await run(() => api(`/admin/cohorts/${cohortId}/capstone-qualification/sync`, { method: 'POST' }));
    if (r) setCapstone(r);
  };
  const pickEvent = (ev) => { if (!ev.raw) return; setEditing(ev.raw); setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 50); };
  const calEvents = useMemo(() => {
    const real = (events?.events || []).filter((e) => !stackFilter || !e.stack_id || e.stack_id === stackFilter)
      .map((e) => ({ id: e.id, title: e.title, eventType: e.event_type, startsAt: e.starts_at, endsAt: e.ends_at, stack: e.stack, linkUrl: e.link_url, audience: e.audience, inactive: !e.is_active, raw: e }));
    // Assessment open/due dates, read-only markers (change them in the assessment schedule below).
    const marks = (sched?.assessments || []).filter((a) => a.isEnabled && (!stackFilter || !a.stackId || a.stackId === stackFilter)).flatMap((a) => [
      { title: `Week ${a.weekNumber} ${a.kind === 'quiz' ? 'quiz' : 'assessment'} opens${a.stack ? ` (${a.stack})` : ''}`, eventType: 'assessment_open', startsAt: a.opensAt },
      { title: `Week ${a.weekNumber} ${a.kind === 'quiz' ? 'quiz' : 'assessment'} due${a.stack ? ` (${a.stack})` : ''}`, eventType: 'assessment_deadline', startsAt: a.dueAt },
    ]);
    return [...real, ...marks];
  }, [events, sched, stackFilter]);
  const saveEvent = (e) => { const f = fd(e); const id = editing.id; setEditing(null); run(() => api(`/admin/events/${id}`, { method: 'PUT', body: evBody(f) }), 'Event updated'); };

  const eventForm = (ev, onSubmit, label) => (
    <form ref={formRef} key={ev?.id || `new-${prefillDay}`} onSubmit={onSubmit} className="grid md:grid-cols-3 gap-2 mb-3">
      <input name="title" defaultValue={ev?.title} placeholder="Title" className={input} required />
      <select name="type" defaultValue={ev?.event_type || 'class'} className={input}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_NAMES[t]}</option>)}</select>
      <select name="stackId" defaultValue={ev?.stack_id || ''} className={input}><option value="">All stacks</option>{stacks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <input name="starts" type="datetime-local" defaultValue={ev?.startsAtLocal || (prefillDay ? `${prefillDay}T10:00` : '')} className={input} required aria-label="Starts" />
      <input name="ends" type="datetime-local" defaultValue={ev?.endsAtLocal} className={input} aria-label="Ends" />
      <input name="link" defaultValue={ev?.link_url || ''} placeholder="Link (https://…)" className={input} />
      <select name="audience" defaultValue={ev?.audience || 'everyone'} className={input} aria-label="Who can see this"><option value="everyone">Visible to everyone in scope</option><option value="capstone">Capstone-qualified learners and facilitators only</option></select>
      <input name="description" defaultValue={ev?.description || ''} placeholder="Description" className={`${input} md:col-span-2`} />
      <button className={btn}>{label}</button>
      <p className="md:col-span-3 text-xs text-brand-body">Capstone events are always limited to learners marked capstone-qualified, plus facilitators. Learners who are not qualified (or not yet confirmed) never see them.</p>
    </form>
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Schedule</h1>
      <Banner error={error || err} message={msg} />
      <CohortPicker cohorts={cohorts} value={cohortId} onChange={setCohortId} />
      {sched && <p className="text-sm text-brand-body">All times are in the cohort timezone: {sched.timezone}. Every change is audited.</p>}

      {sched && (
        <Card>
          <h2 className="font-heading text-lg font-bold mb-2">Assessment schedule (drives learner dashboards and reminders)</h2>
          <div className="overflow-x-auto"><table className="w-full text-sm"><tbody>
            {sched.assessments.map((a) => <AssessmentRow key={`${a.id}-${a.opensAtLocal}-${a.dueAtLocal}-${a.isEnabled}`} a={a} run={run} />)}
          </tbody></table></div>

          <h3 className="font-heading font-bold mt-5 mb-2">Extend a deadline for one learner</h3>
          <form onSubmit={addExt} className="flex flex-wrap gap-2 items-end">
            <select name="assessmentId" className={input} required>{sched.assessments.map((a) => <option key={a.id} value={a.id}>Week {a.weekNumber}{a.stack ? ` (${a.stack})` : ''}</option>)}</select>
            <select name="learnerId" className={input} required><option value="">Learner…</option>{sched.learners.map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}</select>
            <input name="due" type="datetime-local" className={input} required />
            <input name="reason" placeholder="Reason (required)" className={`${input} flex-1 min-w-[180px]`} required />
            <button className={btn}>Record extension</button>
          </form>
          {sched.extensions.length > 0 && (
            <ul className="text-sm mt-3 space-y-1">{sched.extensions.map((x) => <li key={x.id}>Week {x.week_number} · {x.full_name} → {fmt(x.new_due_at, sched.timezone)} — {x.reason}</li>)}</ul>
          )}
        </Card>
      )}

      {events && (
        <Card>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-heading text-lg font-bold">Calendar</h2>
            <label className="text-sm font-semibold">Show <select value={stackFilter} onChange={(e) => setStackFilter(e.target.value)} className={`${input} ml-1 font-normal`}><option value="">all stacks</option>{stacks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          </div>
          <p className="mb-3 text-sm text-brand-body">Click an event to edit it, or click a day to start a new event on that date. Past events are greyed out.</p>
          {editing ? (<><p className="text-sm font-semibold mb-1">Editing: {editing.title}</p>{eventForm(editing, saveEvent, 'Save changes')}
            <div className="mb-3 flex gap-4 text-sm"><button className="underline" onClick={() => setEditing(null)}>Cancel</button>
              <button className="text-brand-blue underline" onClick={() => run(() => api(`/admin/events/${editing.id}/active`, { method: 'PATCH', body: { isActive: !editing.is_active } }), editing.is_active ? 'Event deactivated' : 'Event reactivated').then(() => setEditing(null))}>{editing.is_active ? 'Deactivate this event' : 'Reactivate this event'}</button></div></>)
            : eventForm(null, addEvent, 'Add event')}
          <ScheduleView events={calEvents} timezone={events.timezone} onSelectEvent={pickEvent} onSelectDay={(day) => { if (!editing) setPrefillDay(day); }} emptyText="No events yet. Add one above, or create the default calendar below." />
        </Card>
      )}

      {sched && (
        <Card>
          <h2 className="font-heading text-lg font-bold mb-1">Default calendar for this cohort</h2>
          <p className="text-sm text-brand-body mb-3">Creates a weekly class (Weeks 1 to 6, on the class Saturday) for each stack you tick, plus a cohort start marker. Everything it creates can be edited above. Running it again only adds what is missing.</p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 mb-3">
            {stacks.filter((s) => s.is_active).map((s) => <label key={s.id} className="text-sm"><input type="checkbox" checked={!!calStacks[s.id]} onChange={(e) => setCalStacks({ ...calStacks, [s.id]: e.target.checked })} /> {s.name}</label>)}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-semibold">Class start time <input type="time" value={classTime} onChange={(e) => setClassTime(e.target.value)} className={`${input} ml-1 font-normal`} /></label>
            <button className={btn} onClick={generate} disabled={!Object.values(calStacks).some(Boolean) || !classTime}>Create default calendar</button>
          </div>
        </Card>
      )}

      {sched && (
        <Card>
          <h2 className="font-heading text-lg font-bold mb-1">Capstone qualification</h2>
          <p className="text-sm text-brand-body mb-3">Only learners marked qualified see capstone events, and unconfirmed counts as not qualified. Copy the qualification from the grading sheet, or set it per learner on the Learners page.</p>
          <button className={btn} onClick={syncCapstone}>Sync from the grading sheet</button>
          {capstone && <p className="mt-2 text-sm">{capstone.qualified} qualified · {capstone.notQualified} not qualified · {capstone.unknown} not yet confirmed (they will not see capstone events until the sheet has their result or you set it).</p>}
        </Card>
      )}

      {rem && (
        <Card>
          <h2 className="font-heading text-lg font-bold mb-2">Assessment reminders</h2>
          <p className="text-sm text-brand-body mb-2">Wednesdays and Fridays from {rem.hour}:00 ({rem.timezone}). Weeks 1 to 5: one email for each open assessment a learner has not submitted. Week 6: only learners who still have unsubmitted, still-open work, in a single email. Work that has been submitted and is waiting to be graded never triggers a reminder.</p>
          {(rem.mail.dryRun || !rem.mail.configured) && (
            <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-2 mb-2">Email is in <strong>dry-run</strong> mode: nothing is actually sent until the email provider is configured and dry-run is switched off.</p>
          )}
          <div className="flex flex-wrap gap-3 items-center">
            <label className="text-sm font-semibold"><input type="checkbox" checked={rem.enabled} onChange={(e) => run(() => api(`/admin/reminders?cohortId=${cohortId}`, { method: 'PATCH', body: { enabled: e.target.checked } }), 'Reminder setting saved')} /> Reminders enabled for this cohort</label>
            <label className="text-sm">Hour (0–20) <input type="number" min="0" max="20" defaultValue={rem.hour} onBlur={(e) => run(() => api(`/admin/reminders?cohortId=${cohortId}`, { method: 'PATCH', body: { hour: Number(e.target.value) } }), 'Hour saved')} className={`${input} w-20`} /></label>
            <button className={btn} onClick={async () => setPreview(await run(() => api(`/admin/reminders/preview?cohortId=${cohortId}`, { method: 'POST' })))}>Preview recipients now</button>
          </div>
          {preview?.cohorts?.map((c) => (
            <div key={c.cohort} className="text-sm mt-2">Cohort {c.cohort}: {c.skipped || `${c.recipients} reminder(s) would be sent`}
              {c.sample?.length > 0 && <ul className="list-disc ml-5 max-h-40 overflow-auto">{c.sample.map((s, i) => <li key={i}>{s.name} · Week {s.week}</li>)}</ul>}
            </div>
          ))}
          <h3 className="font-heading font-bold mt-4 mb-1">Delivery log (latest 100)</h3>
          <div className="max-h-56 overflow-auto text-sm">
            {rem.log.length === 0 ? <p className="text-brand-body">No reminders recorded yet.</p> : rem.log.map((r) => (
              <p key={r.id} className="border-t border-brand-border py-1">{r.slot} · Week {r.week_number} · {r.full_name} · <strong>{r.status}</strong>{r.attempts > 1 ? ` (attempt ${r.attempts})` : ''}{r.error ? ` — ${r.error}` : ''}</p>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}