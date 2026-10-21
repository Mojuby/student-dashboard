import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/context';

const card = 'bg-white rounded-2xl border border-brand-border p-6';
const input = 'w-full px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';

function downloadCsv(name, rows) {
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // blocks spreadsheet formula injection
    return `"${s.replace(/"/g, '""')}"`;
  };
  const cols = Object.keys(rows[0] || {});
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function AdminHome() {
  const { user, logout } = useAuth();
  const [cohorts, setCohorts] = useState([]);
  const [stacks, setStacks] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [codes, setCodes] = useState(null);

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([api('/admin/cohorts'), api('/admin/stacks')]);
    setCohorts(c.cohorts);
    setStacks(s.stacks);
  }, []);
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [load]);

  async function run(fn, ok) {
    setErr(''); setMsg('');
    try { const r = await fn(); if (ok) setMsg(ok); await load(); return r; } catch (e) { setErr(e.message); return null; }
  }
  const formData = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); e.currentTarget.reset(); return f; };
  const active = cohorts.find((c) => c.is_active);

  const createCohort = (e) => {
    const f = formData(e);
    run(() => api('/admin/cohorts', { method: 'POST', body: { number: Number(f.number), week1ClassDate: f.date } }), 'Cohort created');
  };
  const activate = (c) => {
    if (!window.confirm(`Activate Cohort ${c.number}? Learners from every other cohort will be unable to log in.`)) return;
    run(() => api(`/admin/cohorts/${c.id}/activate`, { method: 'POST' }), `Cohort ${c.number} is now active`);
  };
  const addStack = (e) => { const f = formData(e); run(() => api('/admin/stacks', { method: 'POST', body: { name: f.name } }), 'Stack added'); };
  const toggleStack = (s) => run(() => api(`/admin/stacks/${s.id}`, { method: 'PATCH', body: { isActive: !s.is_active } }));
  const invite = async (e) => {
    const f = formData(e);
    const r = await run(() => api('/admin/facilitator-invites', { method: 'POST', body: { email: f.email, fullName: f.name, cohortId: f.cohortId, stackId: f.stackId } }));
    if (r) setCodes({ title: 'Facilitator invite', rows: [{ name: f.name, email: f.email, code: r.code }] });
  };
  const reissue = async (e) => {
    const f = formData(e);
    const r = await run(() => api('/admin/learners/reissue-invite', { method: 'POST', body: { email: f.email } }));
    if (r) setCodes({ title: 'Learner invite', rows: [{ email: f.email, code: r.code }] });
  };
  const importLearners = async () => {
    const r = await run(() => api(`/admin/cohorts/${active.id}/import-learners`, { method: 'POST' }));
    if (!r) return;
    setMsg(`Imported ${r.imported} learners. Skipped ${r.skipped}${r.unmatchedStacks.length ? ` (stacks not in your list: ${r.unmatchedStacks.join(', ')})` : ''}.`);
    setCodes({ title: 'Learner invites', rows: r.codes });
  };

  return (
    <div className="min-h-screen bg-brand-bg font-body p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Admin dashboard</h1>
            <p className="text-brand-body">{user.email} · Active cohort: {active ? active.number : 'none'}</p>
          </div>
          <button onClick={logout} className="text-sm text-brand-body hover:text-brand-blue">Logout</button>
        </div>

        {err && <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{err}</div>}
        {msg && <div className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">{msg}</div>}

        {codes && (
          <div className={`${card} border-brand-gold`}>
            <h2 className="font-heading text-xl font-bold text-brand-navy mb-1">{codes.title} codes</h2>
            <p className="text-sm text-brand-body mb-3">Shown once. Download or copy them now. Only hashes are stored.</p>
            {codes.rows.length === 0 ? <p>No new codes were needed.</p> : (
              <>
                <div className="max-h-64 overflow-auto text-sm">
                  {codes.rows.map((r) => <div key={r.email} className="flex gap-4 py-1 border-b border-brand-border"><span className="flex-1">{r.name || ''} {r.email}</span><code className="font-bold">{r.code}</code></div>)}
                </div>
                <button className={`${btn} mt-3`} onClick={() => downloadCsv('invite-codes.csv', codes.rows)}>Download CSV</button>
              </>
            )}
            <button className="ml-3 text-sm text-brand-body underline" onClick={() => setCodes(null)}>Dismiss</button>
          </div>
        )}

        <section className={card}>
          <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">Cohorts</h2>
          <table className="w-full text-sm mb-4">
            <thead><tr className="text-left text-brand-body"><th>Cohort</th><th>Week 1 class (Sat)</th><th>Status</th><th /></tr></thead>
            <tbody>
              {cohorts.map((c) => (
                <tr key={c.id} className="border-t border-brand-border">
                  <td className="py-2">{c.name}</td>
                  <td>{String(c.week1_class_date).slice(0, 10)}</td>
                  <td>{c.is_active ? <strong className="text-brand-blue">Active</strong> : 'Inactive'}</td>
                  <td className="text-right">{!c.is_active && <button className="text-brand-blue font-semibold" onClick={() => activate(c)}>Make active</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <form onSubmit={createCohort} className="flex flex-wrap gap-3 items-end">
            <label className="w-32"><span className="text-sm font-semibold">Cohort no.</span><input name="number" type="number" min="1" className={input} required /></label>
            <label className="w-48"><span className="text-sm font-semibold">Week 1 class date</span><input name="date" type="date" className={input} required /></label>
            <button className={btn}>Create cohort</button>
          </form>
          {active && <button className={`${btn} mt-4`} onClick={importLearners}>Import learners for Cohort {active.number} from the sheet</button>}
        </section>

        <section className={card}>
          <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">Stacks</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {stacks.map((s) => (
              <button key={s.id} onClick={() => toggleStack(s)} className={`px-3 py-1 rounded-full text-sm border ${s.is_active ? 'bg-brand-blue text-white border-brand-blue' : 'bg-white text-brand-body border-brand-line line-through'}`}>{s.name}</button>
            ))}
          </div>
          <form onSubmit={addStack} className="flex gap-3 items-end">
            <label className="flex-1"><span className="text-sm font-semibold">New stack</span><input name="name" className={input} required /></label>
            <button className={btn}>Add</button>
          </form>
        </section>

        <section className={card}>
          <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">Invite a facilitator</h2>
          <form onSubmit={invite} className="grid md:grid-cols-2 gap-3">
            <input name="name" placeholder="Full name" className={input} required />
            <input name="email" type="email" placeholder="Email" className={input} required />
            <select name="cohortId" className={input} defaultValue={active?.id} required>{cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
            <select name="stackId" className={input} required>{stacks.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
            <button className={`${btn} md:col-span-2`}>Generate invite code</button>
          </form>
        </section>

        <section className={card}>
          <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">Reissue a learner code</h2>
          <form onSubmit={reissue} className="flex gap-3 items-end">
            <label className="flex-1"><span className="text-sm font-semibold">Learner email</span><input name="email" type="email" className={input} required /></label>
            <button className={btn}>Reissue</button>
          </form>
        </section>
      </div>
    </div>
  );
}