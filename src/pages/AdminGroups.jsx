import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import useCohort from '../lib/useCohort';
import { Banner, Card, CohortPicker } from '../components/ui';

const input = 'px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';

function GroupCard({ g, learners, stacks, run }) {
  const [edit, setEdit] = useState({ name: g.name, whatsappUrl: g.whatsapp_url, stackId: g.stack_id || '' });
  const [picked, setPicked] = useState([]);
  const eligible = learners.filter((l) => !g.stack_id || l.stack_id === g.stack_id);
  return (
    <Card>
      <div className="flex flex-wrap gap-2 items-end">
        <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} className={input} aria-label="Group name" />
        <input value={edit.whatsappUrl} onChange={(e) => setEdit({ ...edit, whatsappUrl: e.target.value })} className={`${input} flex-1 min-w-[220px]`} aria-label="WhatsApp link" />
        <select value={edit.stackId} onChange={(e) => setEdit({ ...edit, stackId: e.target.value })} className={input} aria-label="Stack">
          <option value="">Any stack</option>{stacks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <button className={btn} onClick={() => run(() => api(`/admin/groups/${g.id}`, { method: 'PUT', body: { name: edit.name, whatsappUrl: edit.whatsappUrl, stackId: edit.stackId || null } }), 'Group saved')}>Save</button>
      </div>
      <h3 className="font-heading font-bold mt-3">Members ({g.members.length})</h3>
      <div className="flex flex-wrap gap-2 my-2">
        {g.members.map((m) => (
          <span key={m.id} className="text-sm bg-slate-100 rounded-full pl-3 pr-1 py-0.5 flex items-center gap-1">
            {m.full_name} <span className="text-brand-body">({m.stack})</span>
            <button aria-label={`Remove ${m.full_name}`} onClick={() => run(() => api(`/admin/groups/${g.id}/members/${m.id}`, { method: 'DELETE' }), 'Member removed')} className="px-1.5 text-brand-body hover:text-red-600">✕</button>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-2 items-start">
        <select multiple size={6} value={picked} onChange={(e) => setPicked(Array.from(e.target.selectedOptions, (o) => o.value))} className={`${input} min-w-[260px]`} aria-label="Learners to assign">
          {eligible.map((l) => <option key={l.id} value={l.id}>{l.full_name} · {l.stack}{l.group_id && l.group_id !== g.id ? ' (moves from another group)' : ''}</option>)}
        </select>
        <button disabled={!picked.length} className={btn} onClick={() => { run(() => api(`/admin/groups/${g.id}/members`, { method: 'PUT', body: { learnerIds: picked } }), 'Learners assigned'); setPicked([]); }}>Assign / reassign</button>
      </div>
    </Card>
  );
}

export default function AdminGroups() {
  const { cohorts, cohortId, setCohortId, error } = useCohort();
  const [data, setData] = useState({ groups: [], learners: [] });
  const [stacks, setStacks] = useState([]);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback((id) => api(`/admin/groups?cohortId=${id}`).then(setData), []);
  useEffect(() => { api('/admin/stacks').then((r) => setStacks(r.stacks.filter((s) => s.is_active))).catch((e) => setErr(e.message)); }, []);
  useEffect(() => { if (cohortId) load(cohortId).catch((e) => setErr(e.message)); }, [cohortId, load]);

  async function run(fn, ok) {
    setErr(''); setMsg('');
    try { await fn(); setMsg(ok); await load(cohortId); } catch (e) { setErr(e.message); }
  }
  function create(e) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    e.currentTarget.reset();
    run(() => api(`/admin/groups?cohortId=${cohortId}`, { method: 'POST', body: { name: f.name, whatsappUrl: f.url, stackId: f.stackId || null } }), 'Group created');
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Capstone groups</h1>
      <Banner error={error || err} message={msg} />
      <CohortPicker cohorts={cohorts} value={cohortId} onChange={setCohortId} />
      <Card>
        <h2 className="font-heading font-bold mb-2">New group</h2>
        <form onSubmit={create} className="flex flex-wrap gap-2 items-end">
          <input name="name" placeholder="Group 1" className={input} required />
          <input name="url" placeholder="https://chat.whatsapp.com/…" className={`${input} flex-1 min-w-[220px]`} required />
          <select name="stackId" className={input}><option value="">Any stack</option>{stacks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <button className={btn}>Create</button>
        </form>
      </Card>
      {data.groups.map((g) => <GroupCard key={`${g.id}-${g.updated_at}`} g={g} learners={data.learners} stacks={stacks} run={run} />)}
    </div>
  );
}