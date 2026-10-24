import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import useCohort from '../lib/useCohort';
import { fmt } from '../lib/format';
import { Banner, Card, CohortPicker } from '../components/ui';

const input = 'px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';
const TYPES = ['cohort_start', 'class', 'assessment', 'capstone_milestone', 'demo_day', 'other'];

function AssessmentRow({ a, run }) {
  const [v, setV] = useState({ opens: a.opensAtLocal, due: a.dueAtLocal, enabled: a.isEnabled, reason: '' });
  return (
    <tr className="border-t border-brand-border align-top">
      <td className="py-2 font-semibold">Week {a.weekNumber}<br /><span className="text-xs text-brand-body">/{a.maxScore}</span></td>
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
  const evBody = (f) => ({ title: f.title, description: f.description || null, eventType: f.type, stackId: f.stackId || null, startsAtLocal: f.starts, endsAtLocal: f.ends || null, linkUrl: f.link || null });
  const addEvent = (e) => { const f = fd(e); run(() => api(`/admin/events?cohortId=${cohortId}`, { method: 'POST', body: evBody(f) }), 'Event created'); };
  const saveEvent = (e) => { const f = fd(e); const id = editing.id; setEditing(null); run(() => api(`/admin/events/${id}`, { method: 'PUT', body: evBody(f) }), 'Event updated'); };

  const eventForm = (ev, onSubmit, label) => (
    <form onSubmit={onSubmit} className="grid md:grid-cols-3 gap-2 mb-3">
      <input name="title" defaultValue={ev?.title} placeholder="Title" className={input} required />
      <select name="type" defaultValue={ev?.event_type || 'class'} className={input}>{TYPES.map((t) => <option key={t}>{t}</option>)}</select>
      <select name="stackId" defaultValue={ev?.stack_id || ''} className={input}><option value="">All stacks</option>{stacks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
      <input name="starts" type="datetime-local" defaultValue={ev?.startsAtLocal} className={input} required />
      <input name="ends" type="datetime-local" defaultValue={ev?.endsAtLocal} className={input} />
      <input name="link" defaultValue={ev?.link_url || ''} placeholder="Link (https://…)" className={input} />
      <input name="description" defaultValue={ev?.description || ''} placeholder="Description" className={`${input} md:col-span-2`} />
      <button className={btn}>{label}</button>
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
            <select name="assessmentId" className={input} required>{sched.assessments.map((a) => <option key={a.id} value={a.id}>Week {a.weekNumber}</option>)}</select>
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
          <h2 className="font-heading text-lg font-bold mb-2">Calendar events</h2>
          {editing ? (<><p className="text-sm font-semibold mb-1">Editing: {editing.title}</p>{eventForm(editing, saveEvent, 'Save changes')}<button className="text-sm underline mb-3" onClick={() => setEditing(null)}>Cancel</button></>)
            : eventForm(null, addEvent, 'Add event')}
          <ul className="text-sm space-y-1">
            {events.events.map((e) => (
              <li key={e.id} className={`flex flex-wrap justify-between gap-2 border-t border-brand-border py-1 ${e.is_active ? '' : 'opacity-50'}`}>
                <span><strong>{e.title}</strong> · {e.event_type}{e.stack ? ` · ${e.stack}` : ''} · {fmt(e.starts_at, events.timezone)}{e.is_active ? '' : ' (inactive)'}</span>
                <span className="flex gap-3">
                  <button className="text-brand-blue" onClick={() => setEditing(e)}>Edit</button>
                  <button className="text-brand-blue" onClick={() => run(() => api(`/admin/events/${e.id}/active`, { method: 'PATCH', body: { isActive: !e.is_active } }))}>{e.is_active ? 'Deactivate' : 'Reactivate'}</button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {rem && (
        <Card>
          <h2 className="font-heading text-lg font-bold mb-2">Assessment reminders</h2>
          <p className="text-sm text-brand-body mb-2">Wednesdays and Fridays during the first 6 weeks, from {rem.hour}:00 ({rem.timezone}). Only learners who haven't submitted an open assessment are emailed.</p>
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