import { useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../lib/format';
import { Banner, Card } from '../components/ui';

const FILTERS = [['', 'Everything'], ['grade.', 'Grades'], ['cohort.', 'Cohorts and imports'], ['invite.', 'Invitations'], ['auth.', 'Sign-ins and activation'], ['learner.', 'Learner status'], ['facilitator.', 'Facilitators']];

export default function AdminActivity() {
  const [page, setPage] = useState(1);
  const [action, setAction] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    const p = new URLSearchParams({ page: String(page), pageSize: '50' });
    if (action) p.set('action', action);
    api(`/admin/audit-log?${p}`).then(setData).catch((e) => setErr(e.message));
  }, [page, action]);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Activity log</h1>
      <p className="text-sm text-brand-body">Who did what: grade changes, imports, invitations, cohort and learner changes. Passwords and codes are never recorded.</p>
      <Banner error={err} />
      <select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }} className="px-3 py-2 border border-brand-line rounded-lg bg-white">
        {FILTERS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <Card>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-brand-body"><th className="py-1">When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
            <tbody>
              {data?.entries.map((e) => (
                <tr key={e.id} className="border-t border-brand-border align-top">
                  <td className="py-2 whitespace-nowrap">{fmt(e.created_at)}</td><td>{e.actor || 'System / visitor'}</td><td><code>{e.action}</code></td>
                  <td className="text-xs text-brand-body break-all">{Object.entries(e.details || {}).map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`).join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data && data.entries.length === 0 && <p className="text-sm text-brand-body py-3">Nothing recorded yet.</p>}
        <div className="flex items-center gap-3 mt-3 text-sm">
          <button className="text-brand-blue font-semibold disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Newer</button>
          <span>Page {page}</span>
          <button className="text-brand-blue font-semibold disabled:opacity-40" disabled={!data || data.entries.length < data.pageSize} onClick={() => setPage(page + 1)}>Older →</button>
        </div>
      </Card>
    </div>
  );
}
