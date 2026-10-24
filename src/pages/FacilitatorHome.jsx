import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/context';
import { fmt } from '../lib/format';
import { Banner, Card, StatusBadge } from '../components/ui';

const sel = 'px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-3 py-1.5 rounded-lg text-sm font-semibold hover:bg-brand-navy disabled:opacity-50';

function Learners({ cohortId }) {
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [onlyFollowUp, setOnlyFollowUp] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/facilitator/learners?cohortId=${cohortId}`).then(setData).catch((e) => setErr(e.message)); }, [cohortId]);
  const list = useMemo(() => (data?.learners || []).filter((l) => (!onlyFollowUp || l.needsFollowUp) && (!q || `${l.name} ${l.email}`.toLowerCase().includes(q.toLowerCase()))), [data, q, onlyFollowUp]);
  return (
    <Card>
      <Banner error={err} />
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className={sel} />
        <label className="text-sm flex items-center gap-2"><input type="checkbox" checked={onlyFollowUp} onChange={(e) => setOnlyFollowUp(e.target.checked)} /> Needs follow-up only</label>
        {data && <span className="text-sm text-brand-body">{list.length} learner(s)</span>}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-brand-body"><th className="py-1">Name</th><th>Stack</th><th>Assessments</th><th>Progress</th><th>Follow-up</th></tr></thead>
          <tbody>
            {list.map((l) => (
              <tr key={l.id} className="border-t border-brand-border align-top">
                <td className="py-2"><span className="font-semibold">{l.name}</span><span className="block text-xs text-brand-body break-all">{l.email}</span></td>
                <td>{l.stack}</td>
                <td><div className="flex gap-1 flex-wrap">{l.weekStatuses.map((w) => <StatusBadge key={w.week} status={w.status} />)}</div></td>
                <td>{l.completionPct}%{l.latestScore ? ` · W${l.latestScore.week}: ${l.latestScore.score}/${l.latestScore.max}` : ''}</td>
                <td>{l.needsFollowUp ? <strong className="text-amber-800">Needs follow-up</strong> : 'On track'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && list.length === 0 && <p className="text-sm text-brand-body py-3">No learners to show.</p>}
    </Card>
  );
}

function GradeRow({ sub, max, cohortId, onSaved }) {
  const [score, setScore] = useState(sub.grade ? String(sub.grade.score) : '');
  const [feedback, setFeedback] = useState(sub.grade?.feedback || '');
  const [state, setState] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const status = sub.grade ? (sub.grade.published ? 'Published' : 'Saved, not published') : sub.submissionId ? 'Not graded' : 'Not submitted';

  async function save(publish) {
    if (busy) return;
    setErr(''); setState('');
    const n = Number(score);
    if (score === '' || !Number.isFinite(n) || n < 0 || n > max) { setErr(`Enter a score from 0 to ${max}.`); return; }
    setBusy(true);
    try {
      const r = await api(`/facilitator/submissions/${sub.submissionId}/grade`, { method: 'PUT', body: { score: n, feedback: feedback.trim() || null, publish } });
      setState(r.grade.published ? 'Saved and published ✓' : 'Saved as draft ✓');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  void cohortId;
  return (
    <tr className="border-t border-brand-border align-top">
      <td className="py-2"><span className="font-semibold">{sub.name}</span><span className="block text-xs text-brand-body">{sub.stack}</span></td>
      <td className="text-xs">
        {sub.url ? <><a className="text-brand-blue underline break-all" href={sub.url} target="_blank" rel="noreferrer">Open submission</a><span className="block text-brand-body">{fmt(sub.submittedAt)}</span></> : '—'}
      </td>
      <td>
        {sub.submissionId ? (
          <div className="space-y-1 min-w-[16rem]">
            <div className="flex items-center gap-2"><input aria-label={`Score for ${sub.name}`} type="number" min="0" max={max} step="0.5" value={score} onChange={(e) => setScore(e.target.value)} className="w-24 px-2 py-1 border border-brand-line rounded-lg" /><span className="text-xs text-brand-body">/ {max}</span></div>
            <textarea aria-label={`Feedback for ${sub.name}`} value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={2} maxLength={2000} placeholder="Feedback for the learner" className="w-full px-2 py-1 border border-brand-line rounded-lg text-sm" />
            <div className="flex gap-2"><button className={btn} disabled={busy} onClick={() => save(false)}>Save draft</button><button className={btn} disabled={busy} onClick={() => save(true)}>Save and publish</button></div>
            {state && <p className="text-xs text-green-700" role="status">{state}</p>}
            {err && <p className="text-xs text-red-700" role="alert">{err}</p>}
          </div>
        ) : <span className="text-sm text-brand-body">Waiting for the learner to submit</span>}
      </td>
      <td className="text-sm">{status}</td>
    </tr>
  );
}

function Grading({ cohortId }) {
  const [assessments, setAssessments] = useState([]);
  const [aid, setAid] = useState('');
  const [data, setData] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    api(`/facilitator/assessments?cohortId=${cohortId}`).then((r) => { setAssessments(r.assessments); setAid(r.assessments[0]?.id || ''); }).catch((e) => setErr(e.message));
  }, [cohortId]);
  const load = useCallback(() => (aid ? api(`/facilitator/submissions?cohortId=${cohortId}&assessmentId=${aid}`).then(setData).catch((e) => setErr(e.message)) : Promise.resolve()), [cohortId, aid]);
  useEffect(() => { load(); }, [load]);

  const drafts = (data?.submissions || []).filter((s) => s.grade && !s.grade.published).length;
  async function publishAll() {
    if (!window.confirm(`Publish ${drafts} saved grade(s)? Learners will see their score and feedback.`)) return;
    setErr(''); setMsg('');
    try { const r = await api(`/facilitator/assessments/${aid}/publish`, { method: 'POST', body: { cohortId } }); setMsg(`Published ${r.published} grade(s).`); await load(); } catch (e) { setErr(e.message); }
  }

  return (
    <Card>
      <Banner error={err} message={msg} />
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select aria-label="Assessment" value={aid} onChange={(e) => { setAid(e.target.value); setData(null); setMsg(''); }} className={sel}>
          {assessments.map((a) => <option key={a.id} value={a.id}>Week {a.weekNumber}: {a.title} (out of {a.maxScore})</option>)}
        </select>
        {drafts > 0 && <button className={btn} onClick={publishAll}>Publish {drafts} saved grade(s)</button>}
        {data && <span className="text-sm text-brand-body">Due {fmt(data.assessment.dueAt)}</span>}
      </div>
      <p className="text-xs text-brand-body mb-2">Saved grades stay hidden from learners until you publish them. You can correct a grade at any time; every change is recorded.</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-brand-body"><th className="py-1">Learner</th><th>Submission</th><th>Grade</th><th>Status</th></tr></thead>
          <tbody>{data?.submissions.map((s) => <GradeRow key={`${aid}-${s.learnerId}`} sub={s} max={data.assessment.maxScore} cohortId={cohortId} onSaved={load} />)}</tbody>
        </table>
      </div>
      {data && data.submissions.length === 0 && <p className="text-sm text-brand-body py-3">No learners in your stacks for this cohort yet.</p>}
    </Card>
  );
}

function Schedule({ cohortId }) {
  const [events, setEvents] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api(`/facilitator/events?cohortId=${cohortId}`).then((r) => setEvents(r.events)).catch((e) => setErr(e.message)); }, [cohortId]);
  return (
    <Card>
      <Banner error={err} />
      {events && events.length === 0 && <p className="text-sm text-brand-body">No classes or events scheduled yet.</p>}
      <ul className="text-sm space-y-2">
        {events?.map((e) => (
          <li key={e.id} className="flex flex-wrap justify-between gap-2 border-b border-brand-border pb-2">
            <span><strong>{e.title}</strong>{e.stack ? ` · ${e.stack}` : ''}{e.linkUrl && <> · <a className="text-brand-blue underline" href={e.linkUrl} target="_blank" rel="noreferrer">Class link</a></>}</span>
            <span className="text-brand-body">{fmt(e.startsAt)}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export default function FacilitatorHome() {
  const { user, logout } = useAuth();
  const [me, setMe] = useState(null);
  const [cohortId, setCohortId] = useState('');
  const [tab, setTab] = useState('grading');
  const [error, setError] = useState('');

  useEffect(() => {
    api('/facilitator/me').then((r) => { setMe(r); setCohortId((r.cohorts.find((c) => c.status === 'active') || r.cohorts[0])?.cohortId || ''); }).catch((e) => setError(e.message));
  }, []);
  const cohorts = useMemo(() => [...new Map((me?.cohorts || []).map((c) => [c.cohortId, c])).values()], [me]);
  const stacks = (me?.cohorts || []).filter((c) => c.cohortId === cohortId).map((c) => c.stack);

  return (
    <div className="min-h-screen bg-brand-bg font-body p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-4">
        <div className="flex flex-wrap justify-between items-start gap-3">
          <div>
            <h1 className="font-heading text-2xl md:text-3xl font-extrabold text-brand-navy">Facilitator dashboard</h1>
            <p className="text-brand-body">{user.fullName}{stacks.length ? ` · ${stacks.join(', ')}` : ''}</p>
          </div>
          <button onClick={logout} className="text-sm text-brand-body hover:text-brand-blue">Logout</button>
        </div>
        <Banner error={error} />
        {me && cohorts.length === 0 && <Card><p className="text-brand-body">You have no cohort assignments yet. Ask an administrator to assign you to a cohort and stack.</p></Card>}
        {cohorts.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-semibold text-brand-navy">Cohort <select value={cohortId} onChange={(e) => setCohortId(e.target.value)} className={`${sel} font-normal ml-2`}>{cohorts.map((c) => <option key={c.cohortId} value={c.cohortId}>{c.name} ({c.status})</option>)}</select></label>
              <div role="tablist" className="flex gap-1">
                {[['grading', 'Grading'], ['learners', 'My learners'], ['schedule', 'Schedule']].map(([k, l]) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === k ? 'bg-brand-blue text-white' : 'bg-white border border-brand-border text-brand-body'}`}>{l}</button>
                ))}
              </div>
            </div>
            {cohortId && tab === 'grading' && <Grading key={cohortId} cohortId={cohortId} />}
            {cohortId && tab === 'learners' && <Learners key={cohortId} cohortId={cohortId} />}
            {cohortId && tab === 'schedule' && <Schedule key={cohortId} cohortId={cohortId} />}
          </>
        )}
      </div>
    </div>
  );
}
