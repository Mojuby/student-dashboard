import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import useCohort from '../lib/useCohort';
import { fmt } from '../lib/format';
import { Banner, Card, CohortPicker } from '../components/ui';

const input = 'w-full px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';
const ghost = 'px-3 py-2 rounded-lg border border-brand-line bg-white text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
const STATUS = { draft: ['Draft', 'bg-slate-200 text-slate-700'], scheduled: ['Scheduled', 'bg-blue-100 text-blue-800'], open: ['Open', 'bg-green-100 text-green-800'], closed: ['Closed', 'bg-amber-100 text-amber-900'] };
const Badge = ({ status }) => <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[status]?.[1]}`}>{STATUS[status]?.[0] || status}</span>;

// A simple horizontal bar: width is the value's share of the largest value, drawn in plain CSS (no chart library).
function Bar({ label, value, max, suffix = '', tone = 'bg-brand-blue' }) {
  const w = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-40 shrink-0 break-anywhere sm:w-56">{label}</span>
      <div className="h-3 flex-1 overflow-hidden rounded bg-slate-100"><div className={`h-3 rounded ${tone}`} style={{ width: `${w}%` }} /></div>
      <span className="w-16 shrink-0 text-right font-semibold tabular-nums">{value}{suffix}</span>
    </div>
  );
}

function TextList({ items, limit = 8 }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, limit);
  if (!items.length) return <p className="text-sm text-brand-body">No written answers.</p>;
  return (
    <div>
      <ul className="space-y-1.5 text-sm">{shown.map((t, i) => <li key={i} className="rounded-lg bg-slate-50 p-2 break-anywhere whitespace-pre-wrap">{t.text}<span className="ml-2 text-xs text-brand-body">{t.stack}</span></li>)}</ul>
      {items.length > limit && <button type="button" className="mt-1 text-sm text-brand-blue underline" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>}
    </div>
  );
}

function Dashboard({ id }) {
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api(`/admin/surveys/${id}/results`).then(setR).catch((e) => setErr(e.message)), [id]);
  useEffect(() => { api(`/admin/surveys/${id}/results`).then(setR).catch((e) => setErr(e.message)); }, [id]);
  async function release(noteId, released) { try { await api(`/admin/surveys/${id}/notes/${noteId}`, { method: 'PATCH', body: { released } }); await load(); } catch (e) { setErr(e.message); } }
  async function viewPhoto(p) { try { window.open((await api(`/admin/surveys/${id}/photos/${p.id}/url`)).url, '_blank', 'noopener'); } catch (e) { setErr(e.message); } }
  if (!r) return <p className="text-brand-body">{err || 'Loading…'}</p>;
  const maxStack = Math.max(1, ...r.byStack.map((s) => s.eligible));

  return (
    <div className="space-y-4">
      <Banner error={err} />
      <Card>
        <div className="grid gap-4 sm:grid-cols-3">
          <div><p className="text-3xl font-extrabold text-brand-navy">{r.responded}<span className="text-lg font-semibold text-brand-body"> of {r.eligible}</span></p><p className="text-sm text-brand-body">learners responded</p></div>
          <div><p className="text-3xl font-extrabold text-brand-navy">{r.rate === null ? '—' : `${r.rate}%`}</p><p className="text-sm text-brand-body">response rate</p></div>
          <div><Badge status={r.survey.status} /><p className="mt-1 text-sm text-brand-body">Closes {fmt(r.survey.closesAt)}</p></div>
        </div>
        <div className="mt-4 space-y-1.5">
          {r.byStack.map((s) => <Bar key={s.stack} label={`${s.stack} (${s.responded}/${s.eligible})`} value={s.responded} max={maxStack} tone="bg-emerald-600" />)}
        </div>
      </Card>

      {r.questions.map((q) => (
        <Card key={q.id}>
          <p className="font-semibold text-brand-navy">{q.position}. {q.prompt}</p>
          <p className="mb-2 text-xs text-brand-body">{q.n} answer{q.n === 1 ? '' : 's'}{q.flag === 'instructor_note' ? ' · shared with facilitators anonymously, after filtering' : ''}</p>
          {q.kind === 'rating' && (
            <div className="space-y-2">
              <p className="text-sm"><span className="text-2xl font-extrabold text-brand-navy">{q.average ?? '—'}</span> <span className="text-brand-body">average out of 5 (1 = {q.low}, 5 = {q.high})</span></p>
              {[5, 4, 3, 2, 1].map((n) => <Bar key={n} label={`${n}`} value={q.counts[n]} max={Math.max(1, ...Object.values(q.counts))} />)}
              <details className="text-sm"><summary className="cursor-pointer text-brand-blue">Average by stack</summary>
                <div className="mt-1 space-y-1">{q.byStack.map((s) => <Bar key={s.stack} label={`${s.stack} (${s.n})`} value={s.average ?? 0} max={5} tone="bg-emerald-600" />)}</div>
              </details>
            </div>
          )}
          {q.kind === 'yesno' && <div className="space-y-1.5"><Bar label="Yes" value={q.yes} max={Math.max(1, q.yes, q.no)} tone="bg-green-600" /><Bar label="No" value={q.no} max={Math.max(1, q.yes, q.no)} tone="bg-red-500" /></div>}
          {q.kind === 'choice_text' && (
            <div className="space-y-1.5">
              {[...q.options].sort((a, b) => b.count - a.count).map((o) => <Bar key={o.label} label={o.label} value={o.count} max={Math.max(1, ...q.options.map((x) => x.count))} />)}
              {q.other.length > 0 && <div className="pt-2"><p className="mb-1 text-sm font-semibold">Written answers</p><TextList items={q.other} /></div>}
            </div>
          )}
          {q.kind === 'text' && !q.notes && <TextList items={q.responses} />}
          {q.kind === 'text' && q.notes && (
            <ul className="space-y-2 text-sm">
              {q.notes.length === 0 && <li className="text-brand-body">No notes.</li>}
              {q.notes.map((n) => (
                <li key={n.id} className={`rounded-lg border p-2 ${n.flagged && !n.released ? 'border-amber-300 bg-amber-50' : 'border-brand-border'}`}>
                  <p className="whitespace-pre-wrap break-anywhere">{n.text}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-brand-body">{n.stack}
                    {n.flagged && <span className="font-semibold text-amber-800">{n.released ? 'Flagged as rude · released to the facilitator' : 'Flagged as possibly rude · hidden from the facilitator'}</span>}
                    {n.flagged && <button type="button" className="text-brand-blue underline" onClick={() => release(n.id, !n.released)}>{n.released ? 'Hide again' : 'Release to facilitator'}</button>}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {q.kind === 'photo' && (
            <div className="space-y-1 text-sm">
              <p>{r.photos.length} photo(s) shared with consent.</p>
              {r.photos.map((p) => <p key={p.id} className="flex flex-wrap items-center gap-3">{p.name} <span className="text-xs text-brand-body">{p.stack}</span> <button type="button" className="text-brand-blue underline" onClick={() => viewPhoto(p)}>View photo</button></p>)}
            </div>
          )}
          {q.kind === 'consent' && <p className="text-sm">{q.n} learner(s) ticked the consent box. Only photos with consent are listed above.</p>}
        </Card>
      ))}
    </div>
  );
}

function Responses({ id }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/admin/surveys/${id}/responses?page=${page}&pageSize=25`).then(setData).catch((e) => setErr(e.message)); }, [id, page]);
  return (
    <div className="space-y-3">
      <Banner error={err} />
      <p className="text-sm text-brand-body">Who said what. Only admins can see names here. Facilitators never do.</p>
      {data?.responses.length === 0 && <Card><p className="text-brand-body">No responses yet.</p></Card>}
      {data?.responses.map((x) => (
        <Card key={x.id}>
          <details>
            <summary className="cursor-pointer font-semibold">{x.name} <span className="text-sm font-normal text-brand-body">· {x.stack} · {fmt(x.submittedAt)}{x.photoId ? ' · shared a photo' : ''}</span></summary>
            <dl className="mt-2 space-y-2 text-sm">{x.answers.map((a) => <div key={a.position}><dt className="text-brand-body">{a.position}. {a.prompt}</dt><dd className="font-medium whitespace-pre-wrap break-anywhere">{a.display}</dd></div>)}</dl>
          </details>
        </Card>
      ))}
      {data && data.total > data.pageSize && (
        <div className="flex items-center gap-3 text-sm">
          <button className="font-semibold text-brand-blue disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</button>
          <span>Page {page} of {Math.ceil(data.total / data.pageSize)}</span>
          <button className="font-semibold text-brand-blue disabled:opacity-40" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Older →</button>
        </div>
      )}
    </div>
  );
}

function QuestionEditor({ surveyId, q, locked, onSaved }) {
  const [prompt, setPrompt] = useState(q.prompt);
  const [required, setRequired] = useState(q.required);
  const [choices, setChoices] = useState((q.options.choices || []).join('\n'));
  const [low, setLow] = useState(q.options.low || '');
  const [high, setHigh] = useState(q.options.high || '');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  async function save() {
    setMsg(''); setErr('');
    const body = { prompt, required };
    if (q.kind === 'choice_text') body.options = { choices: choices.split('\n').map((c) => c.trim()).filter(Boolean), allowText: q.options.allowText ?? true, textLabel: q.options.textLabel };
    if (q.kind === 'rating') body.options = { low, high };
    try { await api(`/admin/surveys/${surveyId}/questions/${q.id}`, { method: 'PATCH', body }); setMsg('Saved'); onSaved(); } catch (e) { setErr(e.message); }
  }
  return (
    <div className="rounded-xl border border-brand-border p-3">
      <p className="mb-1 text-xs text-brand-body">Question {q.position} · {q.kind.replace('_', ' + ')}{q.show_if ? ` · shown only if question ${q.show_if.position} is "${q.show_if.equals}"` : ''}</p>
      <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={2} disabled={locked} aria-label={`Question ${q.position} text`} className={input} />
      {q.kind === 'choice_text' && <label className="mt-2 block text-sm font-semibold">Options (one per line)<textarea value={choices} onChange={(e) => setChoices(e.target.value)} rows={Math.min(10, (q.options.choices || []).length + 1)} disabled={locked} className={`${input} mt-1 font-normal`} /></label>}
      {q.kind === 'rating' && <div className="mt-2 grid gap-2 sm:grid-cols-2"><label className="text-sm font-semibold">1 means<input value={low} onChange={(e) => setLow(e.target.value)} disabled={locked} maxLength={40} className={`${input} mt-1 font-normal`} /></label><label className="text-sm font-semibold">5 means<input value={high} onChange={(e) => setHigh(e.target.value)} disabled={locked} maxLength={40} className={`${input} mt-1 font-normal`} /></label></div>}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
        <label><input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} disabled={locked} /> Required</label>
        <button type="button" className={ghost} onClick={save} disabled={locked}>Save question</button>
        {msg && <span role="status" className="text-green-700">{msg}</span>}{err && <span role="alert" className="text-red-700">{err}</span>}
      </div>
    </div>
  );
}

function Setup({ id, onChanged, onDeleted }) {
  const [d, setD] = useState(null);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const apply = (r) => { setD(r); setForm({ title: r.survey.title, opens: r.survey.opensAtLocal, closes: r.survey.closesAtLocal, published: r.survey.published }); };
  const reload = () => api(`/admin/surveys/${id}`).then(apply).catch((e) => setErr(e.message));
  useEffect(() => { api(`/admin/surveys/${id}`).then(apply).catch((e) => setErr(e.message)); }, [id]);
  if (!d || !form) return <p className="text-brand-body">{err || 'Loading…'}</p>;
  const locked = d.survey.responded > 0;

  async function run(fn, ok) { if (busy) return; setBusy(true); setErr(''); setMsg(''); try { await fn(); if (ok) setMsg(ok); await reload(); onChanged(); } catch (e) { setErr(e.message); } finally { setBusy(false); } }
  const save = () => run(() => api(`/admin/surveys/${id}`, { method: 'PATCH', body: { title: form.title, opensAtLocal: form.opens, closesAtLocal: form.closes, published: form.published } }), 'Saved');
  async function send(openNow) {
    await run(async () => {
      let sent = 0; let dry = 0; let failed = 0;
      for (let i = 0; i < 20; i++) { // bounded batches; repeat until nobody is left to email
        const r = await api(`/admin/surveys/${id}/send`, { method: 'POST', body: { openNow } });
        sent += r.sent; dry += r.dryRun; failed += r.failed;
        if (r.skipped || !r.remaining || (r.sent + r.dryRun) === 0) break;
      }
      setMsg(`${openNow ? 'The survey is open. ' : ''}Emailed ${sent}${dry ? `, ${dry} issued without email (email is off)` : ''}${failed ? `, ${failed} failed (press the button again to retry)` : ''}.`);
    });
  }
  const remove = () => { if (window.confirm('Delete this survey?')) run(async () => { await api(`/admin/surveys/${id}`, { method: 'DELETE' }); onDeleted(); }); };

  return (
    <div className="space-y-4">
      <Banner error={err} message={msg} />
      <Card>
        <h3 className="mb-2 font-heading text-lg font-bold">Details and schedule</h3>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-semibold md:col-span-3">Title<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={`${input} mt-1 font-normal`} maxLength={160} /></label>
          <label className="text-sm font-semibold">Opens<input type="datetime-local" value={form.opens} onChange={(e) => setForm({ ...form, opens: e.target.value })} className={`${input} mt-1 font-normal`} /></label>
          <label className="text-sm font-semibold">Closes<input type="datetime-local" value={form.closes} onChange={(e) => setForm({ ...form, closes: e.target.value })} className={`${input} mt-1 font-normal`} /></label>
          <label className="flex items-end gap-2 pb-2 text-sm font-semibold"><input type="checkbox" checked={form.published} onChange={(e) => setForm({ ...form, published: e.target.checked })} /> Published (visible to learners when it opens)</label>
        </div>
        <p className="mt-2 text-xs text-brand-body">Times are in the cohort's timezone ({d.survey.timezone}). Learners are emailed automatically when a published survey opens (by the scheduled job), or straight away with the buttons below.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={btn} onClick={save} disabled={busy}>Save</button>
          {d.survey.status !== 'open' && d.survey.status !== 'closed' && <button className={btn} onClick={() => send(true)} disabled={busy}>Open now and email learners</button>}
          {d.survey.status === 'open' && <button className={ghost} onClick={() => send(false)} disabled={busy}>Email learners who have not been emailed</button>}
          <button className={`${ghost} ml-auto text-red-700`} onClick={remove} disabled={busy || locked} title={locked ? 'Learners have responded, so it cannot be deleted' : ''}>Delete survey</button>
        </div>
        <p className="mt-2 text-xs text-brand-body">{d.survey.notified} learner(s) have been emailed so far.</p>
      </Card>
      <Card>
        <h3 className="mb-1 font-heading text-lg font-bold">Questions</h3>
        <p className="mb-3 text-sm text-brand-body">{locked ? 'Learners have already responded, so the questions can no longer be changed.' : 'You can reword questions and change the answer options until the first response arrives.'}</p>
        <div className="space-y-3">{d.questions.map((q) => <QuestionEditor key={q.id} surveyId={id} q={q} locked={locked} onSaved={reload} />)}</div>
      </Card>
    </div>
  );
}

function Detail({ id, onBack, onChanged }) {
  const [tab, setTab] = useState('dashboard');
  return (
    <div className="space-y-4">
      <button className="text-sm font-semibold text-brand-blue underline" onClick={onBack}>← All surveys</button>
      <div role="tablist" className="inline-flex rounded-lg border border-brand-line bg-white p-0.5">
        {[['dashboard', 'Dashboard'], ['responses', 'Responses'], ['setup', 'Setup']].map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`rounded-md px-4 py-1.5 text-sm font-semibold ${tab === k ? 'bg-brand-blue text-white' : 'text-brand-body'}`}>{l}</button>)}
      </div>
      {tab === 'dashboard' && <Dashboard id={id} />}
      {tab === 'responses' && <Responses id={id} />}
      {tab === 'setup' && <Setup id={id} onChanged={onChanged} onDeleted={() => { onChanged(); onBack(); }} />}
    </div>
  );
}

export default function AdminSurveys() {
  const { cohorts, cohortId, setCohortId, error } = useCohort();
  const [list, setList] = useState(null);
  const [openId, setOpenId] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const reload = useCallback(() => (cohortId ? api(`/admin/surveys?cohortId=${cohortId}`).then((r) => setList(r.surveys)).catch((e) => setErr(e.message)) : Promise.resolve()), [cohortId]);
  useEffect(() => { if (cohortId) api(`/admin/surveys?cohortId=${cohortId}`).then((r) => setList(r.surveys)).catch((e) => setErr(e.message)); }, [cohortId]);

  async function create(e) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form));
    setBusy(true); setErr(''); setMsg('');
    try {
      const r = await api('/admin/surveys', { method: 'POST', body: { cohortId, template: f.template, title: f.title || undefined, opensAtLocal: f.opens, closesAtLocal: f.closes } });
      form.reset(); await reload(); setMsg('Survey created as a draft. Check the questions, then publish or open it.'); setOpenId(r.id);
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Surveys</h1>
      <Banner error={error || err} message={msg} />
      {openId ? <Detail key={openId} id={openId} onBack={() => setOpenId('')} onChanged={reload} /> : (
        <>
          <CohortPicker cohorts={cohorts} value={cohortId} onChange={(id) => { setCohortId(id); setList(null); }} />
          <Card>
            <h2 className="mb-2 font-heading text-lg font-bold">Set up a survey</h2>
            <form onSubmit={create} className="grid gap-3 md:grid-cols-4">
              <label className="text-sm font-semibold">Type<select name="template" className={`${input} mt-1 font-normal`} defaultValue="mid"><option value="mid">Mid-bootcamp survey</option><option value="final">Final bootcamp survey</option></select></label>
              <label className="text-sm font-semibold md:col-span-3">Title (optional)<input name="title" maxLength={160} className={`${input} mt-1 font-normal`} placeholder="Leave empty to use the standard title" /></label>
              <label className="text-sm font-semibold md:col-span-2">Opens<input name="opens" type="datetime-local" className={`${input} mt-1 font-normal`} required /></label>
              <label className="text-sm font-semibold md:col-span-2">Closes<input name="closes" type="datetime-local" className={`${input} mt-1 font-normal`} required /></label>
              <div className="md:col-span-4"><button className={btn} disabled={busy || !cohortId}>Create survey</button><span className="ml-3 text-xs text-brand-body">Times are in the cohort's timezone. It starts as a draft: nothing is visible to learners until you publish or open it.</span></div>
            </form>
          </Card>
          {!list && !err && <p className="text-brand-body">Loading…</p>}
          {list?.length === 0 && <Card><p className="text-brand-body">No surveys for this cohort yet.</p></Card>}
          {list?.map((s) => (
            <Card key={s.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-brand-navy">{s.title} <Badge status={s.status} /></p>
                  <p className="text-sm text-brand-body">{fmt(s.opensAt)} to {fmt(s.closesAt)} · {s.responded} of {s.eligible} responded</p>
                </div>
                <button className={ghost} onClick={() => setOpenId(s.id)}>Open</button>
              </div>
            </Card>
          ))}
        </>
      )}
    </div>
  );
}
