import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import useCohort from '../lib/useCohort';
import { fmt } from '../lib/format';
import { Banner, Card, CohortPicker } from '../components/ui';

const input = 'w-full px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';
const btnGhost = 'px-3 py-2 rounded-lg border border-brand-line bg-white text-sm font-semibold hover:bg-slate-50 disabled:opacity-50';
const ALLOWED = ['.pdf', '.doc', '.docx', '.ppt', '.pptx', '.xls', '.xlsx', '.csv', '.txt', '.png', '.jpg', '.jpeg', '.zip'];
const MAX_BYTES = 10 * 1024 * 1024;
const LETTERS = 'abcdefgh';
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const blankQuestion = () => ({ prompt: '', qtype: 'single', options: [{ id: 'a', text: '' }, { id: 'b', text: '' }], correct: [], points: 1 });

function FilesPanel({ assessmentId, onChanged }) {
  const [files, setFiles] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api(`/admin/assessments/${assessmentId}/files`).then((r) => setFiles(r.files)).catch((e) => setErr(e.message)), [assessmentId]);
  useEffect(() => { api(`/admin/assessments/${assessmentId}/files`).then((r) => setFiles(r.files)).catch((e) => setErr(e.message)); }, [assessmentId]);

  async function upload(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setErr('');
    const ext = `.${file.name.split('.').pop().toLowerCase()}`;
    if (!ALLOWED.includes(ext)) return setErr(`That file type is not allowed. Use: ${ALLOWED.join(', ')}`);
    if (file.size > MAX_BYTES) return setErr('Files must be 10 MB or smaller.');
    setBusy(true);
    try {
      const dataBase64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(',')[1]);
        r.onerror = () => reject(new Error('Could not read that file.'));
        r.readAsDataURL(file);
      });
      await api(`/admin/assessments/${assessmentId}/files`, { method: 'POST', body: { fileName: file.name, dataBase64 } });
      await load(); onChanged();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  async function open(f) { try { window.open((await api(`/admin/assessment-files/${f.id}/url`)).url, '_blank', 'noopener'); } catch (e) { setErr(e.message); } }
  async function remove(f) {
    if (!window.confirm(`Delete ${f.name}? Learners will no longer be able to download it.`)) return;
    try { await api(`/admin/assessment-files/${f.id}`, { method: 'DELETE' }); await load(); onChanged(); } catch (e) { setErr(e.message); }
  }

  return (
    <div>
      <h4 className="mb-1 font-semibold text-brand-navy">Files for learners</h4>
      <ul className="mb-2 space-y-1 text-sm">
        {files?.map((f) => (
          <li key={f.id} className="flex flex-wrap items-center gap-3">
            <span className="break-anywhere">{f.name} <span className="text-brand-body">({size(f.size)})</span></span>
            <button type="button" className="text-brand-blue underline" onClick={() => open(f)}>Download</button>
            <button type="button" className="text-red-700 underline" onClick={() => remove(f)}>Delete</button>
          </li>
        ))}
        {files?.length === 0 && <li className="text-brand-body">No files yet.</li>}
      </ul>
      <label className={`${btnGhost} inline-block cursor-pointer`}>{busy ? 'Uploading…' : 'Upload a file'}
        <input type="file" accept={ALLOWED.join(',')} onChange={upload} disabled={busy} className="sr-only" />
      </label>
      <span className="ml-2 text-xs text-brand-body">PDF, Word, PowerPoint, Excel, CSV, text, images or zip, up to 10 MB</span>
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
    </div>
  );
}

function QuizBuilder({ assessmentId, onChanged }) {
  const [questions, setQuestions] = useState(null);
  const [attempts, setAttempts] = useState(0);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api(`/admin/assessments/${assessmentId}/quiz`).then((r) => { setAttempts(r.attempts); setQuestions(r.questions.length ? r.questions : [blankQuestion()]); }).catch((e) => setErr(e.message));
  }, [assessmentId]);
  if (!questions) return <p className="text-sm text-brand-body">{err || 'Loading quiz…'}</p>;
  const locked = attempts > 0;
  const patch = (i, change) => setQuestions(questions.map((q, k) => (k === i ? { ...q, ...change } : q)));
  const setOption = (qi, oi, text) => patch(qi, { options: questions[qi].options.map((o, k) => (k === oi ? { ...o, text } : o)) });
  const toggleCorrect = (qi, id) => {
    const q = questions[qi];
    patch(qi, { correct: q.qtype === 'single' ? [id] : q.correct.includes(id) ? q.correct.filter((c) => c !== id) : [...q.correct, id] });
  };
  const addOption = (qi) => {
    const q = questions[qi];
    const id = [...LETTERS].find((l) => !q.options.some((o) => o.id === l));
    if (id) patch(qi, { options: [...q.options, { id, text: '' }] });
  };
  const removeOption = (qi, id) => { const q = questions[qi]; patch(qi, { options: q.options.filter((o) => o.id !== id), correct: q.correct.filter((c) => c !== id) }); };
  const total = questions.reduce((n, q) => n + (Number(q.points) || 0), 0);

  async function save() {
    if (busy) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      await api(`/admin/assessments/${assessmentId}/quiz`, { method: 'PUT', body: { questions: questions.map((q) => ({ prompt: q.prompt, qtype: q.qtype, options: q.options, correct: q.correct, points: Number(q.points) || 1 })) } });
      setMsg('Quiz saved.'); onChanged();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <h4 className="font-semibold text-brand-navy">Quiz questions</h4>
      {locked && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">{attempts} learner(s) have already taken this quiz, so the questions can no longer be changed.</p>}
      {questions.map((q, qi) => (
        <fieldset key={qi} disabled={locked} className="space-y-2 rounded-xl border border-brand-border p-3">
          <div className="flex items-start justify-between gap-2">
            <label className="flex-1 text-sm font-semibold">Question {qi + 1}<textarea value={q.prompt} onChange={(e) => patch(qi, { prompt: e.target.value })} rows={2} className={`${input} mt-1 font-normal`} /></label>
            {questions.length > 1 && !locked && <button type="button" className="text-sm text-red-700 underline" onClick={() => setQuestions(questions.filter((_, k) => k !== qi))}>Remove</button>}
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <label>Type <select value={q.qtype} onChange={(e) => patch(qi, { qtype: e.target.value, correct: [] })} className="ml-1 rounded-lg border border-brand-line bg-white px-2 py-1"><option value="single">One correct answer</option><option value="multiple">Several correct answers</option></select></label>
            <label>Points <input type="number" min="0.5" step="0.5" value={q.points} onChange={(e) => patch(qi, { points: e.target.value })} className="ml-1 w-20 rounded-lg border border-brand-line px-2 py-1" /></label>
          </div>
          <p className="text-xs text-brand-body">Tick the correct {q.qtype === 'single' ? 'answer' : 'answers'}.</p>
          {q.options.map((o, oi) => (
            <div key={o.id} className="flex items-center gap-2">
              <input type={q.qtype === 'single' ? 'radio' : 'checkbox'} name={`q${qi}`} checked={q.correct.includes(o.id)} onChange={() => toggleCorrect(qi, o.id)} aria-label={`Option ${o.id} is correct`} />
              <input value={o.text} onChange={(e) => setOption(qi, oi, e.target.value)} placeholder={`Option ${o.id.toUpperCase()}`} className={input} />
              {q.options.length > 2 && !locked && <button type="button" onClick={() => removeOption(qi, o.id)} aria-label={`Remove option ${o.id}`} className="text-red-700">✕</button>}
            </div>
          ))}
          {q.options.length < 8 && !locked && <button type="button" className="text-sm text-brand-blue underline" onClick={() => addOption(qi)}>Add an option</button>}
        </fieldset>
      ))}
      {!locked && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={btnGhost} onClick={() => setQuestions([...questions, blankQuestion()])} disabled={questions.length >= 50}>Add a question</button>
          <span className="text-sm text-brand-body">{questions.length} question(s) · {total} point(s). The score is scaled to the quiz's maximum score.</span>
          <button type="button" className={btn} onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save quiz'}</button>
        </div>
      )}
      {msg && <p role="status" className="text-sm text-green-700">{msg}</p>}
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
    </div>
  );
}

function Manage({ a, run, reload }) {
  const [v, setV] = useState({ title: a.title, maxScore: a.maxScore, instructions: a.instructions || '' });
  return (
    <div className="mt-3 space-y-5 border-t border-brand-border pt-3">
      <form className="grid gap-2 md:grid-cols-3" onSubmit={(e) => { e.preventDefault(); run(() => api(`/admin/assessments/${a.id}/details`, { method: 'PATCH', body: { title: v.title, maxScore: Number(v.maxScore), instructions: v.instructions || null } }), 'Details saved'); }}>
        <label className="text-sm font-semibold md:col-span-2">Title<input value={v.title} onChange={(e) => setV({ ...v, title: e.target.value })} className={`${input} mt-1 font-normal`} required /></label>
        <label className="text-sm font-semibold">Maximum score<input type="number" min="1" step="0.5" value={v.maxScore} disabled={a.hasWork} onChange={(e) => setV({ ...v, maxScore: e.target.value })} className={`${input} mt-1 font-normal`} /></label>
        <label className="text-sm font-semibold md:col-span-3">{a.kind === 'quiz' ? 'Introduction for learners (optional)' : 'Instructions for learners'}
          <textarea value={v.instructions} onChange={(e) => setV({ ...v, instructions: e.target.value })} rows={5} maxLength={10000} className={`${input} mt-1 font-normal`} placeholder="What should learners do? What does a good submission look like?" /></label>
        <div className="md:col-span-3"><button className={btn}>Save details</button>{a.hasWork && <span className="ml-3 text-xs text-brand-body">The maximum score is locked because learners have submitted work.</span>}</div>
      </form>
      {a.kind === 'assignment' ? <FilesPanel assessmentId={a.id} onChanged={reload} /> : <QuizBuilder assessmentId={a.id} onChanged={reload} />}
    </div>
  );
}

export default function AdminAssessments() {
  const { cohorts, cohortId, setCohortId, error } = useCohort();
  const [stacks, setStacks] = useState([]);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState('assignment');

  const reload = useCallback(() => (cohortId ? api(`/admin/assessments?cohortId=${cohortId}`).then(setData).catch((e) => setErr(e.message)) : Promise.resolve()), [cohortId]);
  useEffect(() => { api('/admin/stacks').then((r) => setStacks(r.stacks.filter((s) => s.is_active))).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (cohortId) api(`/admin/assessments?cohortId=${cohortId}`).then(setData).catch((e) => setErr(e.message)); }, [cohortId]);

  async function run(fn, ok) {
    if (busy) return null;
    setBusy(true); setErr(''); setMsg('');
    try { const r = await fn(); if (ok) setMsg(ok); await reload(); return r; } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  }
  async function create(e) {
    e.preventDefault();
    const form = e.currentTarget;
    const f = Object.fromEntries(new FormData(form));
    const r = await run(() => api(`/admin/assessments?cohortId=${cohortId}`, { method: 'POST', body: {
      weekNumber: Number(f.week), stackId: f.stackId || null, kind: f.kind, title: f.title, maxScore: Number(f.maxScore),
      opensAtLocal: f.opens, dueAtLocal: f.due, instructions: f.instructions || null } }),
    f.kind === 'quiz' ? 'Quiz created. Open it below to add the questions.' : 'Assessment created. Open it below to add instructions and files.');
    if (r) { form.reset(); setKind('assignment'); setOpen(r.id); }
  }
  async function remove(a) {
    if (!window.confirm(`Delete Week ${a.weekNumber} "${a.title}"${a.stack ? ` for ${a.stack}` : ''}? This cannot be undone.`)) return;
    await run(() => api(`/admin/assessments/${a.id}`, { method: 'DELETE' }), 'Assessment deleted');
  }

  const weeks = data ? [...new Set(data.assessments.map((a) => a.weekNumber))].sort((x, y) => x - y) : [];
  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Assessments and quizzes</h1>
      <Banner error={error || err} message={msg} />
      <CohortPicker cohorts={cohorts} value={cohortId} onChange={(id) => { setCohortId(id); setData(null); setOpen(''); }} />
      <p className="text-sm text-brand-body">Every cohort starts with a standard assessment for Weeks 1 to 5 that applies to all stacks. Add a stack-specific one, or a quiz, for any week from 1 to 6. A stack-specific assessment replaces the standard one for that stack in the same week. Change dates and deadlines on the Schedule page.</p>

      <Card>
        <h2 className="mb-3 font-heading text-lg font-bold">New assessment</h2>
        <form onSubmit={create} className="grid gap-3 md:grid-cols-3">
          <label className="text-sm font-semibold">Week<select name="week" className={`${input} mt-1 font-normal`} defaultValue="1">{[1, 2, 3, 4, 5, 6].map((w) => <option key={w} value={w}>Week {w}</option>)}</select></label>
          <label className="text-sm font-semibold">For<select name="stackId" className={`${input} mt-1 font-normal`} defaultValue=""><option value="">All stacks</option>{stacks.map((s) => <option key={s.id} value={s.id}>{s.name} only</option>)}</select></label>
          <label className="text-sm font-semibold">Type<select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className={`${input} mt-1 font-normal`}><option value="assignment">Assignment (learners submit a link)</option><option value="quiz">Quiz (auto-graded)</option></select></label>
          <label className="text-sm font-semibold md:col-span-2">Title<input name="title" className={`${input} mt-1 font-normal`} required maxLength={120} placeholder={kind === 'quiz' ? 'e.g. Week 2 Product Discovery Quiz' : 'e.g. Week 2 Case Study'} /></label>
          <label className="text-sm font-semibold">Maximum score<input name="maxScore" type="number" min="1" step="0.5" defaultValue="10" className={`${input} mt-1 font-normal`} required /></label>
          <label className="text-sm font-semibold">Opens<input name="opens" type="datetime-local" className={`${input} mt-1 font-normal`} required /></label>
          <label className="text-sm font-semibold">Due<input name="due" type="datetime-local" className={`${input} mt-1 font-normal`} required /></label>
          <div className="hidden md:block" />
          <label className="text-sm font-semibold md:col-span-3">{kind === 'quiz' ? 'Introduction (optional)' : 'Instructions'}<textarea name="instructions" rows={3} maxLength={10000} className={`${input} mt-1 font-normal`} /></label>
          <div className="md:col-span-3"><button className={btn} disabled={busy || !cohortId}>Create {kind === 'quiz' ? 'quiz' : 'assessment'}</button><span className="ml-3 text-xs text-brand-body">Times are in the cohort's timezone{data ? ` (${data.timezone})` : ''}.</span></div>
        </form>
      </Card>

      {!data && !err && <p className="text-brand-body">Loading…</p>}
      {weeks.map((w) => (
        <section key={w} aria-label={`Week ${w}`} className="space-y-2">
          <h2 className="font-heading text-lg font-bold text-brand-navy">Week {w}</h2>
          {data.assessments.filter((a) => a.weekNumber === w).map((a) => (
            <Card key={a.id}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-brand-navy">{a.title}{!a.isEnabled ? ' (disabled)' : ''}</p>
                  <p className="text-sm text-brand-body">{a.kind === 'quiz' ? 'Quiz' : 'Assignment'} · {a.stack ? `${a.stack} only` : 'All stacks'} · out of {a.maxScore} · opens {fmt(a.opensAt, data.timezone)} · due {fmt(a.dueAt, data.timezone)}</p>
                  <p className="text-xs text-brand-body">{a.kind === 'quiz' ? `${a.questionCount} question(s)` : `${a.fileCount} file(s)`}{a.instructions ? ' · has instructions' : ' · no instructions yet'}{a.hasWork ? ' · learners have started' : ''}</p>
                </div>
                <div className="flex gap-2">
                  <button className={btnGhost} onClick={() => setOpen(open === a.id ? '' : a.id)} aria-expanded={open === a.id}>{open === a.id ? 'Close' : 'Manage'}</button>
                  <button className={`${btnGhost} text-red-700`} onClick={() => remove(a)} disabled={a.hasWork || busy} title={a.hasWork ? 'Learners have submitted work, so this cannot be deleted' : ''}>Delete</button>
                </div>
              </div>
              {open === a.id && <Manage key={a.id} a={a} run={run} reload={reload} />}
            </Card>
          ))}
        </section>
      ))}
    </div>
  );
}
