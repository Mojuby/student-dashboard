import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Banner, Card, CohortPicker } from '../components/ui';
import useCohort from '../lib/useCohort';
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
  const { cohorts: viewCohorts, cohortId: viewCohort, setCohortId: setViewCohort } = useCohort();

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
        <h2 className="font-heading text-xl font-bold text-brand-navy mb-2">Current facilitators</h2>
        <div className="mb-3"><CohortPicker cohorts={viewCohorts} value={viewCohort} onChange={setViewCohort} /></div>
        <p className="mb-3 text-sm text-brand-body">Facilitators with no stack in the selected cohort can be deleted. Their grades and history are kept, they can no longer sign in, and they can be restored.</p>
        {data?.facilitators.filter((f) => f.is_active).length === 0 && <p className="text-sm text-brand-body">No facilitators have activated their accounts yet.</p>}
        <div className="space-y-3">
          {data?.facilitators.filter((f) => f.is_active).map((f) => {
            const here = f.assignments.filter((a) => a.cohortId === viewCohort);
            return (
              <div key={f.id} className="rounded-xl border border-brand-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="font-semibold">{f.full_name} <span className="text-sm font-normal text-brand-body break-anywhere">{f.email}</span></p>
                  {here.length === 0 && (
                    <button disabled={busy} className="rounded-lg border border-red-200 px-3 py-1 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                      onClick={() => { if (window.confirm(`Delete ${f.full_name}? They will no longer be able to sign in. Their past grades are kept.`)) run(() => api(`/admin/facilitators/${f.id}?cohortId=${viewCohort}`, { method: 'DELETE' }), `${f.full_name} was removed`); }}>Delete</button>
                  )}
                </div>
                <p className="mt-1 text-xs text-brand-body">{here.length ? 'Assigned in this cohort:' : 'Not assigned to any stack in this cohort.'}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {f.assignments.length === 0 && <span className="text-sm text-brand-body">No assignments anywhere</span>}
                  {f.assignments.map((a) => (
                    <span key={a.id} className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm ${a.cohortId === viewCohort ? 'bg-blue-100' : 'bg-slate-100'}`}>
                      Cohort {a.cohortNumber} · {a.stack}
                      <button aria-label={`Remove ${a.stack} assignment`} className="font-bold text-red-700" onClick={() => unassign(a, f.full_name)}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
        {data?.facilitators.some((f) => !f.is_active) && (
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold text-brand-body">Removed facilitators ({data.facilitators.filter((f) => !f.is_active).length})</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {data.facilitators.filter((f) => !f.is_active).map((f) => (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2"><span>{f.full_name} <span className="text-brand-body">{f.email}</span></span>
                  <button disabled={busy} className="font-semibold text-brand-blue underline" onClick={() => run(() => api(`/admin/facilitators/${f.id}/restore`, { method: 'POST' }), `${f.full_name} was restored`)}>Restore</button></li>
              ))}
            </ul>
          </details>
        )}
      </Card>
    </div>
  );
}
