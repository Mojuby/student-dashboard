import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import useCohort from '../lib/useCohort';
import { dayLabel } from '../lib/calendar';
import { Banner, Card, CohortPicker } from '../components/ui';

const input = 'w-full px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';
const ghost = 'px-3 py-2 rounded-lg border border-brand-line bg-white text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
const STATUS = [['present', 'Present', 'bg-green-600 text-white'], ['late', 'Late', 'bg-amber-500 text-white'], ['absent', 'Absent', 'bg-red-600 text-white'], ['excused', 'Excused', 'bg-slate-600 text-white']];
const LETTER = { present: ['P', 'bg-green-100 text-green-800'], late: ['L', 'bg-amber-100 text-amber-800'], absent: ['A', 'bg-red-100 text-red-800'], excused: ['E', 'bg-slate-200 text-slate-700'] };
const shortDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function Overview({ cohortId, stacks, refreshKey }) {
  const [stackId, setStackId] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    api(`/admin/attendance/summary?cohortId=${cohortId}${stackId ? `&stackId=${stackId}` : ''}`).then(setData).catch((e) => setErr(e.message));
  }, [cohortId, stackId, refreshKey]);
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold">Stack <select value={stackId} onChange={(e) => setStackId(e.target.value)} className="ml-1 rounded-lg border border-brand-line bg-white px-2 py-1.5 font-normal"><option value="">All stacks</option>{stacks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <span className="text-xs text-brand-body"><b>P</b> present · <b>L</b> late · <b>A</b> absent · <b>E</b> excused · – not marked · n/a class is for another stack. Rate = (present + late) ÷ (present + late + absent).</span>
      </div>
      <Banner error={err} />
      {!data && !err && <p className="text-sm text-brand-body">Loading…</p>}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-brand-body">
                <th className="sticky left-0 bg-white py-1 pr-3">Learner</th>
                {data.sessions.map((s) => <th key={s.id} className="px-1 text-center font-semibold" title={`${s.title} · ${dayLabel(s.held_on)}`}>{s.kind === 'weekly' ? `W${s.week_number}` : 'Extra'}<span className="block text-[10px] font-normal">{shortDay(s.held_on)}</span></th>)}
                <th className="px-2 text-right">Rate</th>
              </tr>
            </thead>
            <tbody>
              {data.learners.map((l) => (
                <tr key={l.id} className="border-t border-brand-border">
                  <td className="sticky left-0 bg-white py-1.5 pr-3"><span className="font-semibold">{l.name}</span><span className="block text-xs text-brand-body">{l.stack}</span></td>
                  {l.cells.map((c, i) => <td key={i} className="px-1 text-center">{c && LETTER[c] ? <span className={`inline-block w-6 rounded text-xs font-bold ${LETTER[c][1]}`} title={c}>{LETTER[c][0]}</span> : <span className="text-xs text-slate-400">{c === 'n/a' ? 'n/a' : '–'}</span>}</td>)}
                  <td className="px-2 text-right font-semibold">{l.rate === null ? '—' : `${l.rate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {data.learners.length === 0 && <p className="py-3 text-sm text-brand-body">No learners to show.</p>}
        </div>
      )}
    </Card>
  );
}

export default function AdminAttendance() {
  const { cohorts, cohortId, setCohortId, error } = useCohort();
  const [stacks, setStacks] = useState([]);
  const [sessions, setSessions] = useState(null);
  const [selected, setSelected] = useState('');
  const [roster, setRoster] = useState(null);
  const [marks, setMarks] = useState({});
  const [tab, setTab] = useState('mark');
  const [stackFilter, setStackFilter] = useState('');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [tick, setTick] = useState(0);

  const loadSessions = useCallback(() => api(`/admin/attendance/sessions?cohortId=${cohortId}`).then((r) => { setSessions(r.sessions); return r.sessions; }), [cohortId]);

  // Opening a cohort makes sure its six standard weekly classes exist, then picks the class nearest to today.
  useEffect(() => {
    if (!cohortId) return;
    api(`/admin/attendance/sessions/ensure?cohortId=${cohortId}`, { method: 'POST' })
      .then(() => api(`/admin/attendance/sessions?cohortId=${cohortId}`))
      .then((r) => {
        setSessions(r.sessions);
        const today = new Date().toISOString().slice(0, 10);
        const past = r.sessions.filter((s) => s.held_on <= today);
        setSelected((past.at(-1) || r.sessions[0])?.id || '');
      })
      .catch((e) => setErr(e.message));
  }, [cohortId]);
  useEffect(() => { api('/admin/stacks').then((r) => setStacks(r.stacks.filter((s) => s.is_active))).catch(() => {}); }, []);
  useEffect(() => {
    if (!selected) return;
    api(`/admin/attendance/sessions/${selected}/roster`).then((r) => {
      setRoster(r);
      setMarks(Object.fromEntries(r.learners.map((l) => [l.id, { status: l.status, note: l.note || '' }])));
    }).catch((e) => setErr(e.message));
  }, [selected]);

  const session = sessions?.find((s) => s.id === selected);
  const changes = useMemo(() => (roster?.learners || []).filter((l) => (marks[l.id]?.status ?? null) !== (l.status ?? null) || (marks[l.id]?.note || '') !== (l.note || '')), [roster, marks]);
  const visible = (roster?.learners || []).filter((l) => (!stackFilter || l.stack === stackFilter) && (!q || `${l.full_name} ${l.email}`.toLowerCase().includes(q.toLowerCase())));
  const markedCount = (roster?.learners || []).filter((l) => marks[l.id]?.status).length;

  async function run(fn, ok) {
    if (busy) return null;
    setBusy(true); setErr(''); setMsg('');
    try { const r = await fn(); if (ok) setMsg(ok); return r; } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  }
  const pick = (id) => {
    if (id === selected) return;
    if (changes.length && !window.confirm('You have unsaved attendance marks for this class. Switch anyway and lose them?')) return;
    setSelected(id); setRoster(null);
  };
  const setMark = (id, patch) => setMarks((m) => ({ ...m, [id]: { ...m[id], ...patch } }));
  const setAll = (status) => setMarks((m) => ({ ...m, ...Object.fromEntries(visible.map((l) => [l.id, { ...m[l.id], status }])) }));

  async function save() {
    const records = changes.map((l) => ({ learnerId: l.id, status: marks[l.id].status ?? null, note: marks[l.id].status ? (marks[l.id].note.trim() || null) : null }));
    const r = await run(() => api(`/admin/attendance/sessions/${selected}/records`, { method: 'PUT', body: { records } }));
    if (!r) return;
    setMsg(`Saved: ${r.saved} mark(s)${r.cleared ? `, ${r.cleared} cleared` : ''}.`);
    const fresh = await api(`/admin/attendance/sessions/${selected}/roster`);
    setRoster(fresh); setMarks(Object.fromEntries(fresh.learners.map((l) => [l.id, { status: l.status, note: l.note || '' }])));
    await loadSessions(); setTick((t) => t + 1);
  }
  async function addExtra(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form));
    const r = await run(() => api(`/admin/attendance/sessions?cohortId=${cohortId}`, { method: 'POST', body: { title: f.title, heldOn: f.heldOn, stackId: f.stackId || null } }), 'Extra class created. Mark who attended below.');
    if (r) { form.reset(); await loadSessions(); setSelected(r.id); setRoster(null); setTab('mark'); }
  }
  async function saveDetails(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const body = { heldOn: f.heldOn };
    if (session.kind === 'extra') body.title = f.title;
    if (await run(() => api(`/admin/attendance/sessions/${session.id}`, { method: 'PATCH', body }), 'Class details saved')) await loadSessions();
  }
  async function removeExtra() {
    if (!window.confirm(`Delete the extra class "${session.title}"?`)) return;
    if (await run(() => api(`/admin/attendance/sessions/${session.id}`, { method: 'DELETE' }), 'Extra class deleted')) {
      const list = await loadSessions(); setSelected(list[0]?.id || ''); setRoster(null);
    }
  }

  const stackNames = [...new Set((roster?.learners || []).map((l) => l.stack))];
  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Attendance</h1>
      <Banner error={error || err} message={msg} />
      <CohortPicker cohorts={cohorts} value={cohortId} onChange={(id) => { setCohortId(id); setSessions(null); setRoster(null); setSelected(''); }} />
      <p className="text-sm text-brand-body">Mark who attended each weekly class, or add an extra class just to record attendance. Attendance recorded here is used in the cohort report; it does not change the attendance points in learners' grades.</p>

      <div role="tablist" className="inline-flex rounded-lg border border-brand-line bg-white p-0.5">
        {[['mark', 'Mark attendance'], ['overview', 'Overview']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-md px-4 py-1.5 text-sm font-semibold ${tab === k ? 'bg-brand-blue text-white' : 'text-brand-body'}`}>{l}</button>)}
      </div>

      {tab === 'overview' && cohortId && <Overview cohortId={cohortId} stacks={stacks} refreshKey={tick} />}

      {tab === 'mark' && (
        <>
          <Card>
            <h2 className="mb-2 font-heading text-lg font-bold">Classes</h2>
            {!sessions && !err && <p className="text-sm text-brand-body">Loading…</p>}
            <div className="flex flex-wrap gap-2">
              {sessions?.map((s) => (
                <button key={s.id} type="button" onClick={() => pick(s.id)} aria-pressed={s.id === selected}
                  className={`rounded-xl border px-3 py-2 text-left text-sm ${s.id === selected ? 'border-brand-blue bg-blue-50 ring-1 ring-brand-blue' : 'border-brand-border bg-white hover:border-brand-blue'}`}>
                  <span className="block font-semibold text-brand-navy">{s.title}{s.kind === 'extra' ? ' (extra)' : ''}{s.stack ? ` · ${s.stack}` : ''}</span>
                  <span className="block text-xs text-brand-body">{shortDay(s.held_on)} · {s.marked}/{s.eligible} marked{s.rate !== null ? ` · ${s.rate}%` : ''}</span>
                </button>
              ))}
            </div>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-semibold text-brand-blue">Add an extra class</summary>
              <form onSubmit={addExtra} className="mt-3 grid gap-2 md:grid-cols-4">
                <input name="title" placeholder="e.g. Revision class" className={`${input} md:col-span-2`} required maxLength={120} aria-label="Class name" />
                <input name="heldOn" type="date" className={input} required aria-label="Date of the class" />
                <select name="stackId" className={input} defaultValue="" aria-label="Who attends"><option value="">Whole cohort</option>{stacks.map((s) => <option key={s.id} value={s.id}>{s.name} only</option>)}</select>
                <button className={`${btn} md:col-span-4`} disabled={busy}>Create extra class</button>
              </form>
              <p className="mt-1 text-xs text-brand-body">An extra class is only for recording attendance. It does not appear on learners' calendars.</p>
            </details>
          </Card>

          {session && (
            <Card>
              <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-heading text-lg font-bold">{session.title}{session.stack ? ` · ${session.stack}` : ''}</h2>
                  <p className="text-sm text-brand-body">{dayLabel(session.held_on)} · {markedCount} of {roster?.learners.length ?? '…'} marked</p>
                </div>
                <form key={session.id} onSubmit={saveDetails} className="flex flex-wrap items-end gap-2 text-sm">
                  {session.kind === 'extra' && <input name="title" defaultValue={session.title} className="rounded-lg border border-brand-line px-2 py-1.5" aria-label="Class name" required />}
                  <input name="heldOn" type="date" defaultValue={session.held_on} className="rounded-lg border border-brand-line px-2 py-1.5" aria-label="Class date" required />
                  <button className={ghost} disabled={busy}>Save details</button>
                  {session.kind === 'extra' && <button type="button" className={`${ghost} text-red-700`} onClick={removeExtra} disabled={busy || session.marked > 0} title={session.marked > 0 ? 'Clear the marks first' : ''}>Delete</button>}
                </form>
              </div>

              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="rounded-lg border border-brand-line px-3 py-2 text-sm" aria-label="Search learners" />
                {stackNames.length > 1 && <select value={stackFilter} onChange={(e) => setStackFilter(e.target.value)} className="rounded-lg border border-brand-line bg-white px-2 py-2 text-sm" aria-label="Filter by stack"><option value="">All stacks</option>{stackNames.map((n) => <option key={n} value={n}>{n}</option>)}</select>}
                <button type="button" className={ghost} onClick={() => setAll('present')}>Mark shown as present</button>
                <button type="button" className={ghost} onClick={() => setAll(null)}>Clear shown</button>
              </div>

              {!roster && <p className="text-sm text-brand-body">Loading learners…</p>}
              <div className="space-y-2">
                {visible.map((l) => {
                  const m = marks[l.id] || {};
                  return (
                    <div key={l.id} className={`rounded-xl border p-2 ${m.status ? 'border-brand-border' : 'border-amber-300 bg-amber-50/50'}`}>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold">{l.full_name} <span className="text-xs font-normal text-brand-body">{l.stack}</span></p>
                        <div role="group" aria-label={`Attendance for ${l.full_name}`} className="flex flex-wrap gap-1">
                          {STATUS.map(([k, label, on]) => (
                            <button key={k} type="button" aria-pressed={m.status === k} onClick={() => setMark(l.id, { status: m.status === k ? null : k })}
                              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${m.status === k ? on : 'border border-brand-line bg-white text-brand-body hover:bg-slate-50'}`}>{label}</button>
                          ))}
                        </div>
                      </div>
                      {m.status && <input value={m.note || ''} onChange={(e) => setMark(l.id, { note: e.target.value })} maxLength={300} placeholder="Note (optional, e.g. joined late)" aria-label={`Note for ${l.full_name}`} className="mt-2 w-full rounded-lg border border-brand-line px-3 py-1.5 text-sm" />}
                    </div>
                  );
                })}
                {roster && visible.length === 0 && <p className="text-sm text-brand-body">No learners match.</p>}
              </div>

              <div className="sticky bottom-0 -mx-4 mt-4 flex flex-wrap items-center gap-3 border-t border-brand-border bg-white/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:px-5">
                <button className={btn} onClick={save} disabled={busy || changes.length === 0}>{busy ? 'Saving…' : `Save attendance${changes.length ? ` (${changes.length} change${changes.length === 1 ? '' : 's'})` : ''}`}</button>
                <span className="text-sm text-brand-body">{changes.length ? 'You have unsaved changes.' : 'Everything is saved.'} Highlighted rows have not been marked yet.</span>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
