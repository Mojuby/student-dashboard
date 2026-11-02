import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { fmt } from '../lib/format';
import { Banner, Card } from '../components/ui';

const CATEGORY = { bug: 'Something is broken', content: 'Assessment or class problem', access: 'Cannot sign in / open something', suggestion: 'Suggestion', other: 'Other' };
const TABS = [['open', 'Open'], ['resolved', 'Resolved'], ['all', 'All']];

function Item({ f, onChanged }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function set(status) {
    if (busy) return;
    setBusy(true); setErr('');
    try { await api(`/admin/feedback/${f.id}`, { method: 'PATCH', body: { status, note: note.trim() || null } }); onChanged(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }
  const open = f.status === 'open';
  return (
    <Card className={open ? '' : 'bg-slate-50'}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-brand-navy">{f.name} <span className="font-normal text-brand-body">· {f.stack || 'No stack'} · {f.cohort_name || 'No cohort'}</span></p>
          <p className="text-sm text-brand-body"><a className="text-brand-blue underline break-anywhere" href={`mailto:${f.email}`}>{f.email}</a> · {fmt(f.created_at)}{f.page_url ? ` · on ${f.page_url}` : ''}</p>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${open ? 'bg-amber-100 text-amber-900' : 'bg-green-100 text-green-800'}`}>{open ? 'Open' : 'Resolved'}</span>
      </div>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-brand-body">{CATEGORY[f.category] || f.category}</p>
      <p className="mt-1 whitespace-pre-wrap break-anywhere">{f.message}</p>
      {!open && <p className="mt-2 text-sm text-brand-body">Resolved {fmt(f.resolved_at)}{f.resolved_by ? ` by ${f.resolved_by}` : ''}{f.resolution_note ? `: ${f.resolution_note}` : ''}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {open && <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Optional note (what was done)" aria-label="Resolution note" className="min-w-[14rem] flex-1 rounded-lg border border-brand-line px-3 py-2 text-sm" />}
        <button disabled={busy} onClick={() => set(open ? 'resolved' : 'open')} className="rounded-lg bg-brand-blue px-4 py-2 text-sm font-semibold text-white hover:bg-brand-navy disabled:opacity-50">{open ? 'Mark resolved' : 'Reopen'}</button>
      </div>
      {err && <p role="alert" className="mt-2 text-sm text-red-700">{err}</p>}
    </Card>
  );
}

export default function AdminFeedback() {
  const [tab, setTab] = useState('open');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const url = `/admin/feedback?status=${tab === 'all' ? '' : tab}&page=${page}&pageSize=25`;
  const reload = useCallback(() => api(url).then(setData).catch((e) => setErr(e.message)), [url]);
  useEffect(() => { api(url).then(setData).catch((e) => setErr(e.message)); }, [url]);
  const changed = () => { reload(); window.dispatchEvent(new Event('fv:feedback-changed')); };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4 md:p-6">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Learner feedback</h1>
      <p className="text-sm text-brand-body">Problems reported by learners from inside the platform. Each one already includes the learner's name, email, stack and cohort.</p>
      <Banner error={err} />
      <div role="tablist" className="inline-flex rounded-lg border border-brand-line bg-white p-0.5">
        {TABS.map(([k, l]) => <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setPage(1); setData(null); }} className={`rounded-md px-4 py-1.5 text-sm font-semibold ${tab === k ? 'bg-brand-blue text-white' : 'text-brand-body'}`}>{l}</button>)}
      </div>
      {!data && !err && <p className="text-brand-body">Loading…</p>}
      {data && data.items.length === 0 && <Card><p className="text-brand-body">{tab === 'open' ? 'Nothing waiting. All feedback has been resolved.' : 'No feedback here yet.'}</p></Card>}
      {data?.items.map((f) => <Item key={`${f.id}-${f.status}`} f={f} onChanged={changed} />)}
      {data && data.total > data.pageSize && (
        <div className="flex items-center gap-3 text-sm">
          <button className="font-semibold text-brand-blue disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button>
          <span>Page {page} of {Math.ceil(data.total / data.pageSize)} · {data.total} items</span>
          <button className="font-semibold text-brand-blue disabled:opacity-40" disabled={page * data.pageSize >= data.total} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
