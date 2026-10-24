import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Banner, Card } from '../components/ui';
import CodesPanel from '../components/CodesPanel';
import { fmt } from '../lib/format';

const input = 'w-full px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';

export default function AdminFacilitators() {
  const [data, setData] = useState(null);
  const [cohorts, setCohorts] = useState([]);
  const [stacks, setStacks] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [codes, setCodes] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [f, c, s] = await Promise.all([api('/admin/facilitators'), api('/admin/cohorts'), api('/admin/stacks')]);
    setData(f);
    setCohorts(c.cohorts.filter((x) => x.status !== 'archived'));
    setStacks(s.stacks.filter((x) => x.is_active));
  }, []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  async function run(fn, ok) {
    if (busy) return null;
    setBusy(true); setErr(''); setMsg('');
    try { const r = await fn(); if (ok) setMsg(ok); await load(); return r; } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  }
  const form = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); e.currentTarget.reset(); return f; };

  const invite = async (e) => {
    const f = form(e);
    const r = await run(() => api('/admin/facilitator-invites', { method: 'POST', body: { email: f.email, fullName: f.name, cohortId: f.cohortId, stackId: f.stackId } }));
    if (r) setCodes({ title: 'Facilitator invite', rows: [{ name: f.name, email: f.email, code: r.code }] });
  };
  const assign = (e) => {
    const f = form(e);
    run(() => api(`/admin/facilitators/${f.facilitatorId}/assignments`, { method: 'POST', body: { cohortId: f.cohortId, stackId: f.stackId } }), 'Assignment saved');
  };
  const unassign = (a, who) => {
    if (!window.confirm(`Remove ${who} from Cohort ${a.cohortNumber} · ${a.stack}? They will lose access to that stack's learners and grading.`)) return;
    run(() => api(`/admin/facilitator-assignments/${a.id}`, { method: 'DELETE' }), 'Assignment removed');
  };

  const cohortOptions = cohorts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status})</option>);
  const stackOptions = stacks.map((s) => <option key={s.id} value={s.id}>{s.name}</option>);

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Facilitators</h1>
      <Banner error={err} message={msg} />
      <CodesPanel title={codes?.title} rows={codes?.rows} onDismiss={() => setCodes(null)} />

      <Card>
        <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">Invite a new facilitator</h2>
        <form onSubmit={invite} className="grid md:grid-cols-2 gap-3">
          <input name="name" placeholder="Full name" className={input} required />
          <input name="email" type="email" placeholder="Email" className={input} required />
          <select name="cohortId" className={input} required>{cohortOptions}</select>
          <select name="stackId" className={input} required>{stackOptions}</select>
          <button className={`${btn} md:col-span-2`} disabled={busy}>Generate invite code</button>
        </form>
        <p className="text-xs text-brand-body mt-2">Send them the code privately and ask them to open <code>/facilitator/signup</code> on your site. The code works once and expires in 14 days.</p>
        {data?.pendingInvites.length > 0 && (
          <div className="mt-3 text-sm"><strong>Waiting to activate:</strong> {data.pendingInvites.map((p) => `${p.full_name} (expires ${fmt(p.expires_at)})`).join(' · ')}</div>
        )}
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">Assign an existing facilitator</h2>
        <form onSubmit={assign} className="grid md:grid-cols-4 gap-3">
          <select name="facilitatorId" className={input} required>
            <option value="">Facilitator…</option>
            {data?.facilitators.filter((f) => f.is_active).map((f) => <option key={f.id} value={f.id}>{f.full_name}</option>)}
          </select>
          <select name="cohortId" className={input} required>{cohortOptions}</select>
          <select name="stackId" className={input} required>{stackOptions}</select>
          <button className={btn} disabled={busy}>Assign</button>
        </form>
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">Current facilitators</h2>
        {data?.facilitators.length === 0 && <p className="text-sm text-brand-body">No facilitators have activated their accounts yet.</p>}
        <div className="space-y-3">
          {data?.facilitators.map((f) => (
            <div key={f.id} className="border border-brand-border rounded-xl p-3">
              <p className="font-semibold">{f.full_name} <span className="text-sm text-brand-body font-normal">{f.email}{f.is_active ? '' : ' · deactivated'}</span></p>
              <div className="flex flex-wrap gap-2 mt-2">
                {f.assignments.length === 0 && <span className="text-sm text-brand-body">No assignments</span>}
                {f.assignments.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-2 bg-slate-100 rounded-full px-3 py-1 text-sm">
                    Cohort {a.cohortNumber} · {a.stack}
                    <button aria-label={`Remove ${a.stack} assignment`} className="text-red-700 font-bold" onClick={() => unassign(a, f.full_name)}>×</button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
