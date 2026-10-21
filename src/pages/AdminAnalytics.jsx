import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import useCohort from '../lib/useCohort';
import { fmt } from '../lib/format';
import { Banner, Card, CohortPicker } from '../components/ui';

const CODES = { missed_deadline: 'Missed deadline', consecutive_missing: 'Consecutive missing', multiple_missing: 'Multiple missing', low_score: 'Low score', declining: 'Declining score' };
const sel = 'px-3 py-2 border border-brand-line rounded-lg bg-white';

export default function AdminAnalytics() {
  const { cohorts, cohortId, setCohortId, error } = useCohort();
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [stack, setStack] = useState('');
  const [week, setWeek] = useState('');
  const [code, setCode] = useState('');

  useEffect(() => { if (cohortId) api(`/admin/analytics?cohortId=${cohortId}`).then(setD).catch((e) => setErr(e.message)); }, [cohortId]);
  const list = useMemo(() => (d?.followUps || []).filter((f) =>
    (!stack || f.stack === stack) && (!week || f.reasons.some((r) => String(r.week) === week)) && (!code || f.reasons.some((r) => r.code === code))), [d, stack, week, code]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Cohort analytics</h1>
      <Banner error={error || err} />
      <CohortPicker cohorts={cohorts} value={cohortId} onChange={setCohortId} />

      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[['At risk', d.summary.atRisk], ['Falling behind', d.summary.fallingBehind], ['Potentially disengaged', d.summary.potentiallyDisengaged], ['High performers', d.summary.highPerformers]].map(([k, v]) => (
              <Card key={k}><p className="text-sm text-brand-body">{k}</p><p className="font-heading text-3xl font-bold text-brand-navy">{v}</p></Card>
            ))}
          </div>

          <Card>
            <h2 className="font-heading text-lg font-bold mb-2">Funnel</h2>
            {d.funnel.map((s) => (
              <div key={s.key} className="mb-2">
                <div className="flex justify-between text-sm"><span>{s.label}</span><span>{s.count} ({s.pct}%)</span></div>
                <div className="h-3 bg-slate-100 rounded-full" role="img" aria-label={`${s.label}: ${s.pct}%`}><div className="h-3 bg-brand-blue rounded-full" style={{ width: `${s.pct}%` }} /></div>
              </div>
            ))}
          </Card>

          <Card>
            <h2 className="font-heading text-lg font-bold mb-2">Week by week</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-brand-body"><th>Week</th><th>Enrolled</th><th>Submitted</th><th>Not submitted</th><th>Awaiting grading</th><th>Graded</th><th>Submission %</th><th>Grading %</th><th>Avg score %</th><th>Low scores</th></tr></thead>
                <tbody>{d.weekly.map((w) => (
                  <tr key={w.assessmentId} className="border-t border-brand-border">
                    <td className="py-1 font-semibold">{w.weekNumber}</td><td>{w.enrolled}</td><td>{w.submitted}</td>
                    <td>{w.notSubmitted} <span className="text-brand-body">({w.missing} missed, {w.pending} pending)</span></td>
                    <td>{w.awaitingGrading}</td><td>{w.graded}</td><td>{w.submissionRate}</td><td>{w.gradingRate}</td><td>{w.avgScorePct ?? '—'}</td><td>{w.lowScores}</td>
                  </tr>))}</tbody>
              </table>
            </div>
            <details className="mt-3 text-sm text-brand-body"><summary className="cursor-pointer">How these are calculated</summary>
              <ul className="list-disc ml-5 mt-1">{Object.entries(d.definitions).map(([k, v]) => <li key={k}><strong>{k}:</strong> {v}</li>)}</ul>
            </details>
          </Card>

          <Card>
            <h2 className="font-heading text-lg font-bold mb-2">Who to check in on first</h2>
            <p className="text-sm text-brand-body mb-3">Recommendations for human follow-up, ordered by how many signals apply. They are not conclusions about why someone is struggling.</p>
            <div className="flex flex-wrap gap-2 mb-3">
              <select className={sel} value={stack} onChange={(e) => setStack(e.target.value)}><option value="">All stacks</option>{d.stacks.map((s) => <option key={s}>{s}</option>)}</select>
              <select className={sel} value={week} onChange={(e) => setWeek(e.target.value)}><option value="">All weeks</option>{d.weekly.map((w) => <option key={w.weekNumber} value={w.weekNumber}>Week {w.weekNumber}</option>)}</select>
              <select className={sel} value={code} onChange={(e) => setCode(e.target.value)}><option value="">All reasons</option>{Object.entries(CODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            </div>
            {list.length === 0 ? <p className="text-sm text-brand-body">No learners match.</p> : list.map((f) => (
              <div key={f.id} className="border-t border-brand-border py-3 text-sm">
                <p><strong>{f.name}</strong> · {f.stack}{f.potentiallyDisengaged ? ' · Potentially disengaged' : ''} · Last activity {f.lastActivityAt ? fmt(f.lastActivityAt, d.cohort.timezone) : 'none recorded'}</p>
                <ul className="list-disc ml-5">{f.reasons.map((r, i) => <li key={i}>{r.text}</li>)}</ul>
                <p className="text-brand-navy"><strong>Next step:</strong> {f.recommended.join(' ')}</p>
              </div>
            ))}
          </Card>
        </>
      )}
    </div>
  );
}