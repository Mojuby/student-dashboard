import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../lib/format';
import LearnerNav from '../components/LearnerNav';
import FeedbackWidget from '../components/FeedbackWidget';
import { Banner, Card, StatusBadge } from '../components/ui';

const input = 'w-full rounded-lg border border-brand-line bg-white px-3 py-2';
const btn = 'rounded-lg bg-brand-blue px-4 py-2 font-semibold text-white hover:bg-brand-navy disabled:opacity-50';
const size = (b) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

function Quiz({ a, onDone }) {
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api(`/learner/assessments/${a.id}/quiz`).then(setQuiz).catch((e) => setErr(e.message)); }, [a.id]);

  const toggle = (q, optId) => setAnswers((cur) => {
    const now = new Set(cur[q.id] || []);
    if (q.qtype === 'single') return { ...cur, [q.id]: [optId] };
    if (now.has(optId)) now.delete(optId); else now.add(optId);
    return { ...cur, [q.id]: [...now] };
  });
  async function submit() {
    if (busy) return;
    const unanswered = quiz.questions.filter((q) => !(answers[q.id] || []).length).length;
    if (unanswered && !window.confirm(`${unanswered} question(s) are unanswered. Submit anyway? You only get one attempt.`)) return;
    setBusy(true); setErr('');
    try { await api(`/learner/assessments/${a.id}/quiz`, { method: 'POST', body: { answers } }); await onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  if (err && !quiz) return <p role="alert" className="mt-3 text-sm text-red-700">{err}</p>;
  if (!quiz) return <p className="mt-3 text-sm text-brand-body">Loading quiz…</p>;
  if (quiz.attempted) return <p className="mt-3 text-sm font-semibold text-green-800">You scored {quiz.score} out of {quiz.maxScore}.</p>;
  return (
    <div className="mt-3 space-y-4 border-t border-brand-border pt-3">
      <p className="text-sm text-brand-body">You have one attempt. Your score is shown straight after you submit.</p>
      {quiz.questions.map((q, i) => (
        <fieldset key={q.id} className="space-y-2">
          <legend className="font-semibold text-brand-navy">{i + 1}. {q.prompt} <span className="text-xs font-normal text-brand-body">({q.qtype === 'multiple' ? 'choose all that apply' : 'choose one'})</span></legend>
          {q.options.map((o) => (
            <label key={o.id} className="flex items-start gap-2 text-sm">
              <input type={q.qtype === 'multiple' ? 'checkbox' : 'radio'} name={q.id} checked={(answers[q.id] || []).includes(o.id)} onChange={() => toggle(q, o.id)} className="mt-1" />
              <span>{o.text}</span>
            </label>
          ))}
        </fieldset>
      ))}
      {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
      <button className={btn} onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit quiz'}</button>
    </div>
  );
}

function AssessmentCard({ a, tz, onSaved }) {
  // Keep what the learner typed if their session expires mid-edit.
  const draftKey = `fv.draft.${a.id}`;
  const [url, setUrl] = useState(() => sessionStorage.getItem(draftKey) ?? a.submission?.url ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [quizOpen, setQuizOpen] = useState(false);
  const now = new Date();
  const opened = new Date(a.opensAt) <= now;
  const beforeDeadline = new Date(a.dueAt) > now;
  const canEdit = opened && beforeDeadline && a.kind === 'assignment';
  const hasGrade = a.status === 'graded' && a.score != null;

  async function save(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setErr(''); setMsg('');
    try {
      await api(`/learner/assessments/${a.id}/submission`, { method: 'PUT', body: { url: url.trim() } });
      sessionStorage.removeItem(draftKey);
      setMsg('Link saved.');
      onSaved();
    } catch (e2) { setErr(e2.message); } finally { setBusy(false); }
  }
  async function download(f) {
    setErr('');
    try { window.open((await api(`/learner/assessments/${a.id}/files/${f.id}/url`)).url, '_blank', 'noopener'); } catch (e) { setErr(e.message); }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-heading text-lg font-bold text-brand-navy">Week {a.weekNumber}{a.title ? `: ${a.title}` : ''}</h2>
          <p className="text-sm text-brand-body">{a.kind === 'quiz' ? 'Quiz' : 'Assignment'} · out of {a.maxScore} · opens {fmt(a.opensAt, tz)} · due {fmt(a.dueAt, tz)}</p>
        </div>
        <StatusBadge status={a.status} />
      </div>

      {!opened && <p className="mt-3 text-sm text-brand-body">This opens on {fmt(a.opensAt, tz)}. Instructions and files appear then.</p>}
      {a.instructions && <div className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm break-anywhere"><p className="mb-1 font-semibold text-brand-navy">Instructions</p>{a.instructions}</div>}
      {a.files.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {a.files.map((f) => <li key={f.id}><button type="button" onClick={() => download(f)} className="text-left text-brand-blue underline break-anywhere">⬇ {f.name}</button> <span className="text-brand-body">({size(f.size)})</span></li>)}
        </ul>
      )}

      {a.kind === 'assignment' && opened && (
        canEdit ? (
          <form onSubmit={save} className="mt-3 space-y-2">
            <label className="block text-sm font-semibold text-brand-navy">Your Google link (Docs, Sheets, Slides, Forms or Drive)
              <input value={url} onChange={(e) => { setUrl(e.target.value); sessionStorage.setItem(draftKey, e.target.value); }} placeholder="https://docs.google.com/… or https://drive.google.com/…" className={`${input} mt-1 font-normal`} required />
            </label>
            {hasGrade && <p className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-900">This has already been graded. You can still change it until the deadline, and your facilitator will be able to see that you did.</p>}
            <button className={btn} disabled={busy || !url.trim()}>{busy ? 'Saving…' : a.submission ? 'Update link' : 'Submit link'}</button>
            <p className="text-xs text-brand-body">Any Google Docs, Sheets, Slides, Forms or Drive file or folder link works (a PowerPoint or PDF uploaded to Drive too). Make sure sharing is set so your facilitator can open it. You can change your link any time before {fmt(a.dueAt, tz)}.</p>
          </form>
        ) : (
          <p className="mt-3 text-sm text-brand-body">{a.submission ? <>Submitted: <a href={a.submission.url} target="_blank" rel="noreferrer" className="text-brand-blue underline break-anywhere">your link</a>. The deadline has passed, so it can no longer be changed.</> : 'The deadline has passed and nothing was submitted.'}</p>
        )
      )}

      {a.kind === 'quiz' && opened && (
        quizOpen || a.status === 'graded'
          ? <Quiz a={a} onDone={async () => { await onSaved(); }} />
          : beforeDeadline ? <button className={`${btn} mt-3`} onClick={() => setQuizOpen(true)}>Start quiz</button>
            : <p className="mt-3 text-sm text-brand-body">The deadline has passed.</p>
      )}

      {a.editedAfterGrade && <p className="mt-3 text-sm text-amber-800">You changed this after it was graded. Your facilitator will take another look.</p>}
      {a.status !== 'graded' && a.gradeState === 'awaiting_grade' && a.submission && <p className="mt-3 text-sm text-brand-body">Submitted. Your grade and feedback will appear here once your facilitator publishes them.</p>}
      {hasGrade && a.kind === 'assignment' && (
        <div className="mt-3 rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-semibold text-green-900">Score: {a.score} / {a.maxScore}</p>
          {a.feedback && <p className="mt-1 whitespace-pre-wrap text-green-900 break-anywhere">{a.feedback}</p>}
        </div>
      )}
      {msg && <p role="status" className="mt-2 text-sm text-green-700">{msg}</p>}
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
    </Card>
  );
}

export default function LearnerAssessments() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const reload = useCallback(() => api('/learner/overview').then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { api('/learner/overview').then(setData).catch((e) => setErr(e.message)); }, []);

  return (
    <div className="min-h-screen bg-brand-bg font-body">
      <LearnerNav />
      <main className="mx-auto w-full max-w-3xl space-y-4 px-4 py-4 sm:px-6 sm:py-8">
        <div>
          <h1 className="font-heading text-2xl font-extrabold text-brand-navy sm:text-3xl">Weekly assessments</h1>
          {data && <p className="text-sm text-brand-body">{data.stack} · times shown in {data.timezone}</p>}
        </div>
        <Banner error={err} />
        {!data && !err && <p className="text-brand-body">Loading…</p>}
        {data?.assessments.length === 0 && <Card><p className="text-brand-body">No assessments have been set up for you yet.</p></Card>}
        {data?.assessments.map((a) => <AssessmentCard key={`${a.id}-${a.status}-${a.score}`} a={a} tz={data.timezone} onSaved={reload} />)}
      </main>
      <FeedbackWidget />
    </div>
  );
}
