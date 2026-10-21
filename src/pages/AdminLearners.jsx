import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import useCohort from '../lib/useCohort';
import { fmt } from '../lib/format';
import { Banner, Card, CohortPicker, StatusBadge } from '../components/ui';

export default function AdminLearners() {
  const { cohorts, cohortId, setCohortId, error } = useCohort();
  const [data, setData] = useState(null);
  const [q, setQ] = useState('');
  const [stack, setStack] = useState('');
  const [risk, setRisk] = useState('');
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { if (cohortId) api(`/admin/learners-overview?cohortId=${cohortId}`).then(setData).catch((e) => setErr(e.message)); }, [cohortId]);
  const stacks = useMemo(() => [...new Set((data?.learners || []).map((l) => l.stack))].sort(), [data]);
  const grouped = useMemo(() => {
    const list = (data?.learners || []).filter((l) =>
      (!q || `${l.name} ${l.email}`.toLowerCase().includes(q.toLowerCase())) && (!stack || l.stack === stack) && (!risk || l.riskStatus === risk));
    const m = new Map();
    list.forEach((l) => m.set(l.stack, [...(m.get(l.stack) || []), l]));
    return [...m.entries()];
  }, [data, q, stack, risk]);

  const open = (id) => api(`/admin/learners/${id}`).then(setDetail).catch((e) => setErr(e.message));

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Learners</h1>
      <Banner error={error || err} />
      <div className="flex flex-wrap gap-2">
        <CohortPicker cohorts={cohorts} value={cohortId} onChange={setCohortId} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email" className="px-3 py-2 border border-brand-line rounded-lg" />
        <select value={stack} onChange={(e) => setStack(e.target.value)} className="px-3 py-2 border border-brand-line rounded-lg"><option value="">All stacks</option>{stacks.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={risk} onChange={(e) => setRisk(e.target.value)} className="px-3 py-2 border border-brand-line rounded-lg">
          <option value="">All performance</option><option value="at_risk">At risk</option><option value="on_track">On track</option>
        </select>
      </div>

      {grouped.map(([name, list]) => (
        <Card key={name}>
          <h2 className="font-heading text-lg font-bold text-brand-navy mb-2">{name} <span className="text-sm text-brand-body font-normal">({list.length})</span></h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-brand-body"><th className="py-1">Name</th><th>Email</th><th>Assessments</th><th>Latest score</th><th>Progress</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((l) => (
                  <tr key={l.id} onClick={() => open(l.id)} className="border-t border-brand-border cursor-pointer hover:bg-slate-50">
                    <td className="py-2 font-semibold text-brand-blue">{l.name}</td>
                    <td>{l.email}</td>
                    <td><div className="flex gap-1">{l.weekStatuses.map((w) => <StatusBadge key={w.week} status={w.status} />).slice(0, 5)}</div></td>
                    <td>{l.latestScore ? `W${l.latestScore.week}: ${l.latestScore.score}/${l.latestScore.max}` : '—'}</td>
                    <td>{l.completionPct}%</td>
                    <td>{l.riskStatus === 'at_risk' ? <strong className="text-amber-800">At risk ({l.riskCount})</strong> : 'On track'}{l.potentiallyDisengaged ? ' · Possibly disengaged' : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ))}
      {data && grouped.length === 0 && <p className="text-brand-body">No learners match.</p>}

      {detail && (
        <div className="fixed inset-y-0 right-0 w-full md:w-[34rem] bg-white shadow-2xl border-l border-brand-border p-5 overflow-y-auto z-20">
          <button onClick={() => setDetail(null)} className="float-right text-brand-body hover:text-brand-blue">Close ✕</button>
          <h2 className="font-heading text-2xl font-bold text-brand-navy">{detail.learner.name}</h2>
          <p className="text-sm text-brand-body">{detail.learner.email} · {detail.learner.stack} · Cohort {detail.cohort.number}</p>
          <p className="text-sm mt-1">Capstone group: {detail.learner.group ? detail.learner.group.name : 'Not assigned'}</p>
          <p className="text-sm">Completion {detail.learner.completionPct}% · Score {detail.learner.scorePct ?? '—'}%</p>

          <h3 className="font-heading font-bold mt-4 mb-1">Why flagged</h3>
          {detail.learner.risk.reasons.length === 0 ? <p className="text-sm text-brand-body">No risk indicators.</p>
            : <ul className="text-sm list-disc ml-5">{detail.learner.risk.reasons.map((r, i) => <li key={i}>{r.text}</li>)}</ul>}

          <h3 className="font-heading font-bold mt-4 mb-1">Assessments</h3>
          {detail.learner.cells.filter((c) => c.isEnabled).map((c) => (
            <div key={c.assessmentId} className="border border-brand-border rounded-lg p-3 mb-2 text-sm">
              <div className="flex justify-between"><strong>Week {c.weekNumber}</strong><StatusBadge status={c.status} /></div>
              <p className="text-brand-body">Due {fmt(c.dueAt, detail.cohort.timezone)}{c.submittedAt ? ` · Submitted ${fmt(c.submittedAt, detail.cohort.timezone)}` : ''}</p>
              {c.url && <a href={c.url} target="_blank" rel="noreferrer" className="text-brand-blue underline break-all">{c.url}</a>}
              {c.score != null && <p>Score {c.score}/{c.maxScore}{c.feedback ? ` — ${c.feedback}` : ''}</p>}
            </div>
          ))}

          <h3 className="font-heading font-bold mt-4 mb-1">Facilitator flags (manual)</h3>
          {detail.learner.flags.length === 0 ? <p className="text-sm text-brand-body">None.</p>
            : detail.learner.flags.map((f) => <p key={f.id} className="text-sm">{f.kind === 'support' ? 'Support' : 'High performer'} — {f.reason} ({f.by_name})</p>)}
        </div>
      )}
    </div>
  );
}