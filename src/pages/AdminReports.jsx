import { useCallback, useEffect, useState } from 'react';
import { api, SESSION_EXPIRED } from '../api';
import { getPortal } from '../lib/portal';
import useCohort from '../lib/useCohort';
import { fmt } from '../lib/format';
import { Banner, Card, CohortPicker } from '../components/ui';

const input = 'w-full px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';
const ghost = 'px-3 py-2 rounded-lg border border-brand-line bg-white text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';

const SYSTEM = [
  ['overview', 'Cohort overview', 'Dates, number of learners and stacks'],
  ['enrolment', 'Enrolment', 'Learners by stack and by status'],
  ['performance', 'Learner performance', 'Average and median, grade spread and results by stack (from the grading sheet)'],
  ['assessments', 'Assessments', 'Submission rate and average score for each assessment'],
  ['attendance', 'Attendance', 'Rates for every class, including extra classes (from the Attendance page)'],
  ['risk', 'Learners needing follow-up', 'How many were flagged and why (counts only)'],
  ['capstone', 'Capstone', 'Qualified, not qualified and groups'],
  ['feedback', 'Learner feedback received', 'How many messages, by type'],
  ['facilitators', 'Facilitators', 'Who taught which stack'],
  ['learnerTable', 'Learner table (names every learner)', 'Each learner with their total, grade and attendance. Leave this off if the report will be shared widely.'],
];
const HUMAN = [['summary', 'Executive summary'], ['activities', 'Activities held'], ['risks', 'Risks'], ['lessons', 'Lessons learned'], ['recommendations', 'Recommendations'], ['custom', 'Your own sections']];

async function downloadDocx(id) {
  const res = await fetch(`/api/admin/reports/${id}/download`, { credentials: 'same-origin', headers: { 'X-FV-Portal': getPortal() } });
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(SESSION_EXPIRED));
    let message = 'The report could not be generated. Please try again.';
    try { message = (await res.json()).error || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') || '')?.[1] || 'Cohort-Report.docx';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

function previewLines(d) {
  const L = [];
  const pct = (v) => (v === null || v === undefined ? 'not enough data yet' : `${v}%`);
  L.push(`${d.overview.enrolled} learners enrolled (${d.overview.active} active, ${d.overview.withdrawn} withdrawn) across ${d.overview.stacks.length} stack(s).`);
  if (d.performance) L.push(`Performance: ${d.performance.scored} of ${d.performance.learners} learners have scores recorded. Average ${pct(d.performance.mean)}, median ${pct(d.performance.median)}.`);
  if (d.assessments) L.push(`Assessments: ${d.assessments.length} assessment(s) have opened.`);
  if (d.attendance) L.push(`Attendance: ${d.attendance.sessions.length} class(es) recorded; overall rate ${pct(d.attendance.overallRate)}.`);
  if (d.risk) L.push(`Follow-up: ${d.risk.atRisk} learner(s) flagged, ${d.risk.onTrack} on track.`);
  if (d.capstone) L.push(`Capstone: ${d.capstone.qualified} qualified, ${d.capstone.notQualified} not qualified, ${d.capstone.notConfirmed} not yet confirmed.`);
  if (d.feedback) L.push(`Feedback: ${d.feedback.total} message(s), ${d.feedback.open} still open.`);
  if (d.facilitators) L.push(`Facilitators: ${d.facilitators.length}.`);
  if (d.learnerTable) L.push(`The learner table will list ${d.learnerTable.length} learner(s) by name.`);
  return L;
}

function Editor({ initial, onBack, onListChanged }) {
  const snap = (r) => JSON.stringify({ title: r.title, status: r.status, sections: r.sections, narrative: r.narrative });
  const [draft, setDraft] = useState({ title: initial.title, status: initial.status, sections: initial.sections, narrative: initial.narrative });
  const [saved, setSaved] = useState(() => snap(initial));
  const [version, setVersion] = useState(initial.version);
  const [meta, setMeta] = useState({ updatedBy: initial.updatedBy, lastDownloadedAt: initial.lastDownloadedAt });
  const [busy, setBusy] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [conflict, setConflict] = useState(false);
  const [preview, setPreview] = useState(null);
  const dirty = snap(draft) !== saved;
  const N = draft.narrative;
  const setN = (patch) => setDraft((d) => ({ ...d, narrative: { ...d.narrative, ...patch } }));
  const setSection = (k, v) => setDraft((d) => ({ ...d, sections: { ...d.sections, [k]: v } }));
  const setItem = (key, i, patch) => setN({ [key]: N[key].map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const addItem = (key, item) => setN({ [key]: [...N[key], item] });
  const dropItem = (key, i) => setN({ [key]: N[key].filter((_, k) => k !== i) });

  useEffect(() => {
    if (!dirty) return undefined;
    const warn = (e) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save() {
    setErr(''); setMsg(''); setConflict(false);
    try {
      const r = (await api(`/admin/reports/${initial.id}`, { method: 'PUT', body: { ...draft, version } })).report;
      setSaved(snap(r)); setVersion(r.version); setMeta({ updatedBy: r.updatedBy, lastDownloadedAt: r.lastDownloadedAt });
      setMsg('Draft saved.'); onListChanged();
      return true;
    } catch (e) {
      if (e.status === 409) setConflict(true);
      setErr(e.message);
      return false;
    }
  }
  const run = async (label, fn) => { if (busy) return; setBusy(label); try { await fn(); } finally { setBusy(''); } };
  const download = () => run('download', async () => {
    if (dirty && !(await save())) return; // the file always matches what is on screen
    setErr(''); setMsg('');
    try { await downloadDocx(initial.id); setMsg('Report downloaded.'); } catch (e) { setErr(e.message); }
  });
  const showPreview = () => run('preview', async () => {
    setErr(''); setMsg('');
    if (dirty && !(await save())) return;
    try { setPreview((await api(`/admin/reports/${initial.id}/data`)).data); } catch (e) { setErr(e.message); }
  });
  const reload = () => run('reload', async () => {
    if (!window.confirm('Reload the latest saved version? Your unsaved edits on this screen will be lost.')) return;
    const r = (await api(`/admin/reports/${initial.id}`)).report;
    setDraft({ title: r.title, status: r.status, sections: r.sections, narrative: r.narrative }); setSaved(snap(r)); setVersion(r.version); setConflict(false); setErr(''); setMsg('Loaded the latest version.');
  });
  const remove = () => run('delete', async () => {
    if (!window.confirm('Delete this report draft? This cannot be undone.')) return;
    try { await api(`/admin/reports/${initial.id}`, { method: 'DELETE' }); onListChanged(); onBack(); } catch (e) { setErr(e.message); }
  });
  const back = () => { if (!dirty || window.confirm('You have unsaved changes. Leave without saving?')) onBack(); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button className="text-sm font-semibold text-brand-blue underline" onClick={back}>← All reports</button>
        <span className="text-xs text-brand-body">{dirty ? 'Unsaved changes' : 'All changes saved'}{meta.updatedBy ? ` · last saved by ${meta.updatedBy}` : ''}{meta.lastDownloadedAt ? ` · last downloaded ${fmt(meta.lastDownloadedAt)}` : ''}</span>
      </div>
      <Banner error={err} message={msg} />
      {conflict && <button className={ghost} onClick={reload}>Reload the latest version</button>}

      <Card>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-semibold md:col-span-2">Report title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} maxLength={160} className={`${input} mt-1 font-normal`} /></label>
          <label className="text-sm font-semibold">Status<select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })} className={`${input} mt-1 font-normal`}><option value="draft">Draft</option><option value="final">Final</option></select></label>
        </div>
      </Card>

      <Card>
        <h2 className="font-heading text-lg font-bold">1. What the system should include</h2>
        <p className="mb-3 text-sm text-brand-body">These figures are worked out from the platform's data when you download. Untick anything you do not want in the report.</p>
        <div className="grid gap-2 md:grid-cols-2">
          {SYSTEM.map(([k, label, hint]) => (
            <label key={k} className={`flex items-start gap-2 rounded-lg border p-2 text-sm ${k === 'learnerTable' ? 'border-amber-300 bg-amber-50' : 'border-brand-border'}`}>
              <input type="checkbox" className="mt-1" checked={!!draft.sections[k]} onChange={(e) => setSection(k, e.target.checked)} />
              <span><span className="font-semibold">{label}</span><span className="block text-xs text-brand-body">{hint}</span></span>
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-heading text-lg font-bold">2. What only you can add</h2>
        <p className="mb-3 text-sm text-brand-body">The system cannot know these. Anything left empty is simply left out of the report. Untick a heading to keep your text but not include it.</p>

        <div className="space-y-5">
          <section>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!draft.sections.summary} onChange={(e) => setSection('summary', e.target.checked)} />{HUMAN[0][1]}</label>
            <textarea value={N.summary} onChange={(e) => setN({ summary: e.target.value })} rows={5} maxLength={10000} className={`${input} mt-1`} placeholder="A short overview of how the cohort went, for people who will only read one paragraph." />
          </section>

          <section>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!draft.sections.activities} onChange={(e) => setSection('activities', e.target.checked)} />{HUMAN[1][1]}</label>
            <p className="text-xs text-brand-body">For example: a demo day, a guest speaker, a partner visit, a bootcamp event.</p>
            <div className="mt-2 space-y-2">
              {N.activities.map((a, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-brand-border p-2 md:grid-cols-6">
                  <input value={a.date} onChange={(e) => setItem('activities', i, { date: e.target.value })} placeholder="Date" aria-label="Activity date" maxLength={40} className={input} />
                  <input value={a.title} onChange={(e) => setItem('activities', i, { title: e.target.value })} placeholder="Activity" aria-label="Activity" maxLength={200} className={`${input} md:col-span-2`} />
                  <input value={a.description} onChange={(e) => setItem('activities', i, { description: e.target.value })} placeholder="What happened" aria-label="What happened" maxLength={3000} className={`${input} md:col-span-2`} />
                  <button type="button" className="text-sm text-red-700 underline" onClick={() => dropItem('activities', i)}>Remove</button>
                </div>
              ))}
              <button type="button" className={ghost} onClick={() => addItem('activities', { title: '', date: '', description: '' })}>Add an activity</button>
            </div>
          </section>

          <section>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!draft.sections.risks} onChange={(e) => setSection('risks', e.target.checked)} />{HUMAN[2][1]}</label>
            <p className="text-xs text-brand-body">Things that could have gone wrong, or did, and what was done about them.</p>
            <div className="mt-2 space-y-2">
              {N.risks.map((r, i) => (
                <div key={i} className="grid gap-2 rounded-lg border border-brand-border p-2 md:grid-cols-6">
                  <input value={r.risk} onChange={(e) => setItem('risks', i, { risk: e.target.value })} placeholder="Risk" aria-label="Risk" maxLength={300} className={`${input} md:col-span-2`} />
                  <select value={r.severity} onChange={(e) => setItem('risks', i, { severity: e.target.value })} aria-label="Severity" className={input}><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
                  <input value={r.mitigation} onChange={(e) => setItem('risks', i, { mitigation: e.target.value })} placeholder="How it is being handled" aria-label="How it is being handled" maxLength={2000} className={`${input} md:col-span-2`} />
                  <button type="button" className="text-sm text-red-700 underline" onClick={() => dropItem('risks', i)}>Remove</button>
                </div>
              ))}
              <button type="button" className={ghost} onClick={() => addItem('risks', { risk: '', severity: 'medium', mitigation: '' })}>Add a risk</button>
            </div>
          </section>

          <section>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!draft.sections.lessons} onChange={(e) => setSection('lessons', e.target.checked)} />{HUMAN[3][1]}</label>
            <div className="mt-2 space-y-2">
              {N.lessons.map((l, i) => (
                <div key={i} className="flex items-start gap-2">
                  <textarea value={l} onChange={(e) => setN({ lessons: N.lessons.map((x, k) => (k === i ? e.target.value : x)) })} rows={2} maxLength={2000} aria-label={`Lesson ${i + 1}`} className={input} />
                  <button type="button" className="text-sm text-red-700 underline" onClick={() => setN({ lessons: N.lessons.filter((_, k) => k !== i) })}>Remove</button>
                </div>
              ))}
              <button type="button" className={ghost} onClick={() => setN({ lessons: [...N.lessons, ''] })}>Add a lesson learned</button>
            </div>
          </section>

          <section>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!draft.sections.recommendations} onChange={(e) => setSection('recommendations', e.target.checked)} />{HUMAN[4][1]}</label>
            <textarea value={N.recommendations} onChange={(e) => setN({ recommendations: e.target.value })} rows={4} maxLength={10000} className={`${input} mt-1`} placeholder="What should be done differently next cohort?" />
          </section>

          <section>
            <label className="flex items-center gap-2 font-semibold"><input type="checkbox" checked={!!draft.sections.custom} onChange={(e) => setSection('custom', e.target.checked)} />{HUMAN[5][1]}</label>
            <p className="text-xs text-brand-body">Anything else, with a heading of your choice (for example "Partner feedback" or "Budget notes").</p>
            <div className="mt-2 space-y-2">
              {N.custom.map((c, i) => (
                <div key={i} className="space-y-2 rounded-lg border border-brand-border p-2">
                  <div className="flex gap-2"><input value={c.heading} onChange={(e) => setItem('custom', i, { heading: e.target.value })} placeholder="Heading" aria-label="Section heading" maxLength={120} className={input} /><button type="button" className="text-sm text-red-700 underline" onClick={() => dropItem('custom', i)}>Remove</button></div>
                  <textarea value={c.body} onChange={(e) => setItem('custom', i, { body: e.target.value })} rows={4} maxLength={10000} aria-label="Section text" className={input} />
                </div>
              ))}
              {N.custom.length < 20 && <button type="button" className={ghost} onClick={() => addItem('custom', { heading: '', body: '' })}>Add a section</button>}
            </div>
          </section>
        </div>
      </Card>

      {preview && (
        <Card>
          <h2 className="font-heading text-lg font-bold">What the report will contain</h2>
          {preview.notices.map((n) => <p key={n} className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">{n}</p>)}
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">{previewLines(preview).map((l) => <li key={l}>{l}</li>)}</ul>
          <p className="mt-2 text-xs text-brand-body">Figures are as of {fmt(preview.generatedAt)}. They are recalculated each time you download.</p>
        </Card>
      )}

      <div className="sticky bottom-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-t border-brand-border bg-white/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
        <button className={btn} onClick={() => run('save', save)} disabled={!!busy || !dirty}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
        <button className={ghost} onClick={showPreview} disabled={!!busy}>{busy === 'preview' ? 'Working…' : 'Preview figures'}</button>
        <button className={btn} onClick={download} disabled={!!busy}>{busy === 'download' ? 'Preparing…' : 'Download Word document'}</button>
        <button className={`${ghost} ml-auto text-red-700`} onClick={remove} disabled={!!busy}>Delete draft</button>
      </div>
    </div>
  );
}

export default function AdminReports() {
  const { cohorts, cohortId, setCohortId, error } = useCohort();
  const [list, setList] = useState(null);
  const [open, setOpen] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const loadList = useCallback(() => (cohortId ? api(`/admin/reports?cohortId=${cohortId}`).then((r) => setList(r.reports)).catch((e) => setErr(e.message)) : Promise.resolve()), [cohortId]);
  useEffect(() => { if (cohortId) api(`/admin/reports?cohortId=${cohortId}`).then((r) => setList(r.reports)).catch((e) => setErr(e.message)); }, [cohortId]);

  async function openReport(id) { setErr(''); try { setOpen((await api(`/admin/reports/${id}`)).report); } catch (e) { setErr(e.message); } }
  async function create() {
    if (busy) return;
    setBusy(true); setErr('');
    try { const r = (await api(`/admin/reports?cohortId=${cohortId}`, { method: 'POST', body: {} })).report; await loadList(); setOpen(r); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Cohort reports</h1>
      <Banner error={error || err} />
      {open ? <Editor key={open.id} initial={open} onBack={() => setOpen(null)} onListChanged={loadList} /> : (
        <>
          <CohortPicker cohorts={cohorts} value={cohortId} onChange={(id) => { setCohortId(id); setList(null); }} />
          <p className="text-sm text-brand-body">Build a performance report for a cohort. Choose what the system includes, add the things only you know, save it as a draft as often as you like, and download it as a Word document when it is ready.</p>
          <button className={btn} onClick={create} disabled={busy || !cohortId}>{busy ? 'Creating…' : 'New report'}</button>
          {!list && !err && <p className="text-brand-body">Loading…</p>}
          {list?.length === 0 && <Card><p className="text-brand-body">No reports for this cohort yet.</p></Card>}
          {list?.map((r) => (
            <Card key={r.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold text-brand-navy">{r.title} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-semibold ${r.status === 'final' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>{r.status === 'final' ? 'Final' : 'Draft'}</span></p>
                  <p className="text-xs text-brand-body">Last saved {fmt(r.updatedAt)}{r.updatedBy ? ` by ${r.updatedBy}` : ''}{r.lastDownloadedAt ? ` · downloaded ${fmt(r.lastDownloadedAt)}` : ' · not downloaded yet'}</p>
                </div>
                <button className={ghost} onClick={() => openReport(r.id)}>Open</button>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
