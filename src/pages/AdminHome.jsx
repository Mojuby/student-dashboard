import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { Banner, Card } from '../components/ui';
import CodesPanel from '../components/CodesPanel';
import { fmt } from '../lib/format';

const input = 'w-full px-3 py-2 border border-brand-line rounded-lg bg-white';
const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';
const STATUS_HELP = {
  upcoming: 'Learners can activate accounts but cannot sign in yet.',
  active: 'Learners can sign in. Other cohorts are NOT affected.',
  completed: 'Finished. Learners can no longer sign in; all data is kept.',
  archived: 'Closed and read-only. All data is kept and stays visible to admins.',
};

export default function AdminHome() {
  const [cohorts, setCohorts] = useState([]);
  const [stacks, setStacks] = useState([]);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [codes, setCodes] = useState(null);
  const [annCohort, setAnnCohort] = useState('');
  const [anns, setAnns] = useState([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [c, s] = await Promise.all([api('/admin/cohorts'), api('/admin/stacks')]);
    setCohorts(c.cohorts);
    setStacks(s.stacks);
    return c.cohorts;
  }, []);
  useEffect(() => { load().then((cs) => setAnnCohort((cur) => cur || (cs.find((c) => c.is_active) || cs[0])?.id || '')).catch((e) => setErr(e.message)); }, [load]);
  useEffect(() => {
    if (!annCohort) return;
    api(`/admin/announcements?cohortId=${annCohort}`).then((r) => setAnns(r.announcements)).catch((e) => setErr(e.message));
  }, [annCohort]);

  async function run(fn, ok) {
    if (busy) return null;
    setErr(''); setMsg(''); setBusy(true);
    try { const r = await fn(); if (ok) setMsg(ok); await load(); return r; } catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  }
  const formData = (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)); e.currentTarget.reset(); return f; };
  const refreshAnns = () => api(`/admin/announcements?cohortId=${annCohort}`).then((r) => setAnns(r.announcements));

  const createCohort = (e) => {
    const f = formData(e);
    run(() => api('/admin/cohorts', { method: 'POST', body: { number: Number(f.number), week1ClassDate: f.date } }), 'Cohort created (status: upcoming)');
  };
  const setStatus = (c, status) => {
    if (status === c.status) return;
    const warn = status === 'archived' ? ' It will be closed to learners and read-only.' : status === 'completed' ? ' Its learners will no longer be able to sign in.' : '';
    if (!window.confirm(`Change ${c.name} from "${c.status}" to "${status}"?${warn} No other cohort is affected.`)) return;
    run(() => api(`/admin/cohorts/${c.id}/status`, { method: 'POST', body: { status } }), `${c.name} is now ${status}`);
  };
  const addStack = (e) => { const f = formData(e); run(() => api('/admin/stacks', { method: 'POST', body: { name: f.name } }), 'Stack added'); };
  const toggleStack = (s) => run(() => api(`/admin/stacks/${s.id}`, { method: 'PATCH', body: { isActive: !s.is_active } }));
  const reissue = async (e) => {
    const f = formData(e);
    const r = await run(() => api('/admin/learners/reissue-invite', { method: 'POST', body: { email: f.email } }));
    if (!r) return;
    if (r.outcome === 'sent') setMsg(`A new invitation was emailed to ${f.email}.`);
    else { setCodes({ title: 'Learner invite (could not be emailed)', rows: [{ email: f.email, code: r.code }] }); if (r.error) setErr(`Email failed: ${r.error}`); }
  };
  const addAnnouncement = async (e) => {
    const f = formData(e);
    const r = await run(() => api(`/admin/announcements?cohortId=${annCohort}`, { method: 'POST', body: { title: f.title, body: f.body, stackId: f.stackId || null } }), 'Announcement published to learners');
    if (r) await refreshAnns();
  };
  const toggleAnn = async (a) => { await run(() => api(`/admin/announcements/${a.id}/active`, { method: 'PATCH', body: { isActive: !a.is_active } })); await refreshAnns(); };

  return (
    <div className="p-4 md:p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Setup</h1>
        <Banner error={err} message={msg} />
        <CodesPanel title={codes?.title} rows={codes?.rows} onDismiss={() => setCodes(null)} />

        <Card>
          <h2 className="font-heading text-xl font-bold text-brand-navy mb-1">Cohorts</h2>
          <p className="text-sm text-brand-body mb-3">Several cohorts can be active at the same time. Changing one cohort never affects another.</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm mb-4">
              <thead><tr className="text-left text-brand-body"><th>Cohort</th><th>Week 1 class (Sat)</th><th>Learners</th><th>Status</th></tr></thead>
              <tbody>
                {cohorts.map((c) => (
                  <tr key={c.id} className="border-t border-brand-border">
                    <td className="py-2 font-semibold">{c.name}</td>
                    <td>{String(c.week1_class_date).slice(0, 10)}</td>
                    <td>{c.learner_count}</td>
                    <td>
                      <select aria-label={`Status of ${c.name}`} value={c.status} disabled={busy} onChange={(e) => setStatus(c, e.target.value)} className="px-2 py-1 border border-brand-line rounded-lg bg-white" title={STATUS_HELP[c.status]}>
                        {['upcoming', 'active', 'completed', 'archived'].map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <span className="block text-xs text-brand-body">{STATUS_HELP[c.status]}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <form onSubmit={createCohort} className="flex flex-wrap gap-3 items-end">
            <label className="w-32"><span className="text-sm font-semibold">Cohort no.</span><input name="number" type="number" min="1" className={input} required /></label>
            <label className="w-48"><span className="text-sm font-semibold">Week 1 class date (a Saturday)</span><input name="date" type="date" className={input} required /></label>
            <button className={btn} disabled={busy}>Create cohort</button>
          </form>
          <p className="text-sm text-brand-body mt-3">Next: open <strong>Onboarding</strong> to import learners from the registration sheet and send invitations.</p>
        </Card>

        <Card>
          <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">Stacks</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            {stacks.map((s) => (
              <button key={s.id} onClick={() => toggleStack(s)} disabled={busy} className={`px-3 py-1 rounded-full text-sm border ${s.is_active ? 'bg-brand-blue text-white border-brand-blue' : 'bg-white text-brand-body border-brand-line line-through'}`}>{s.name}</button>
            ))}
          </div>
          <form onSubmit={addStack} className="flex gap-3 items-end">
            <label className="flex-1"><span className="text-sm font-semibold">New stack</span><input name="name" className={input} required /></label>
            <button className={btn} disabled={busy}>Add</button>
          </form>
        </Card>

        <Card>
          <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">Announcements</h2>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <label className="text-sm font-semibold">Cohort
              <select value={annCohort} onChange={(e) => setAnnCohort(e.target.value)} className="ml-2 px-3 py-2 border border-brand-line rounded-lg bg-white font-normal">
                {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
          <form onSubmit={addAnnouncement} className="grid md:grid-cols-2 gap-3 mb-4">
            <input name="title" placeholder="Title" className={input} required maxLength={140} />
            <select name="stackId" className={input} defaultValue=""><option value="">Everyone in the cohort</option>{stacks.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name} only</option>)}</select>
            <textarea name="body" placeholder="Message" className={`${input} md:col-span-2`} rows={3} required maxLength={4000} />
            <button className={`${btn} md:col-span-2`} disabled={busy || !annCohort}>Publish announcement</button>
          </form>
          <ul className="text-sm space-y-2">
            {anns.map((a) => (
              <li key={a.id} className="flex justify-between gap-3 border-t border-brand-border pt-2">
                <span><strong>{a.title}</strong> <span className="text-brand-body">· {a.stack || 'Everyone'} · {fmt(a.created_at)}</span></span>
                <button onClick={() => toggleAnn(a)} className="text-brand-blue font-semibold whitespace-nowrap">{a.is_active ? 'Hide' : 'Show'}</button>
              </li>
            ))}
            {anns.length === 0 && <li className="text-brand-body">No announcements yet.</li>}
          </ul>
        </Card>

        <Card>
          <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">Send a learner a new invitation</h2>
          <form onSubmit={reissue} className="flex gap-3 items-end">
            <label className="flex-1"><span className="text-sm font-semibold">Learner email</span><input name="email" type="email" className={input} required /></label>
            <button className={btn} disabled={busy}>Send</button>
          </form>
          <p className="text-xs text-brand-body mt-2">Replaces any earlier unused code for that learner.</p>
        </Card>
      </div>
    </div>
  );
}
