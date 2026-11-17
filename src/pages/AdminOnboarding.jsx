import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import useCohort from '../lib/useCohort';
import { fmt } from '../lib/format';
import { Banner, Card, CohortPicker, StatusBadge } from '../components/ui';
import CodesPanel from '../components/CodesPanel';

const btn = 'bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50';
const sel = 'px-3 py-2 border border-brand-line rounded-lg bg-white';
const ACTION_TONE = { create: 'text-green-700', update: 'text-amber-700', unchanged: 'text-brand-body', skipped: 'text-brand-body', error: 'text-red-700' };
const STATE_ORDER = ['enrolled', 'invited', 'activated', 'orientation', 'active', 'completed', 'withdrawn'];

function Chip({ label, value, tone = '' }) {
  return <div className={`rounded-xl border border-brand-border px-4 py-2 text-center ${tone}`}><div className="text-2xl font-bold">{value}</div><div className="text-xs text-brand-body">{label}</div></div>;
}

function inviteLabel(l) {
  if (l.status === 'withdrawn') return '—';
  if (['activated', 'orientation', 'active', 'completed'].includes(l.status)) return 'Account created';
  if (!l.delivery_status) return 'Not invited yet';
  if (l.delivery_status === 'failed') return `Email failed${l.delivery_attempts > 1 ? ` (${l.delivery_attempts} tries)` : ''}`;
  if (l.invite_expired) return 'Invite expired';
  if (l.delivery_status === 'dry_run') return 'Code issued (not emailed)';
  return `Emailed ${fmt(l.sent_at)}`;
}

export default function AdminOnboarding() {
  const { cohorts, cohortId, setCohortId, registrationCohortNumber, error } = useCohort();
  const cohort = cohorts.find((c) => c.id === cohortId);
  const [stacks, setStacks] = useState([]);
  const [list, setList] = useState(null);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState(null);
  const [rowFilter, setRowFilter] = useState('');
  const [confirmMoves, setConfirmMoves] = useState(false);
  const [result, setResult] = useState('');
  const [codes, setCodes] = useState(null);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [aliasPick, setAliasPick] = useState({});

  const loadList = useCallback(async () => {
    if (!cohortId) return;
    const params = new URLSearchParams({ cohortId, page: String(page), pageSize: '50' });
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    setList(await api(`/admin/onboarding?${params}`));
  }, [cohortId, page, q, status]);
  useEffect(() => { loadList().catch((e) => setErr(e.message)); }, [loadList]);
  useEffect(() => { api('/admin/stacks').then((r) => setStacks(r.stacks.filter((s) => s.is_active))).catch((e) => setErr(e.message)); }, []);

  async function run(label, fn) {
    if (busy) return null;
    setBusy(label); setErr(''); setMsg('');
    try { return await fn(); } catch (e) { setErr(e.message); return null; } finally { setBusy(''); }
  }

  const doPreview = () => run('preview', async () => {
    setResult(''); setConfirmMoves(false);
    const r = await api(`/admin/cohorts/${cohortId}/import-preview`, { method: 'POST' });
    setPreview(r); setRowFilter(r.summary.error ? 'error' : '');
  });

  const addAlias = (raw) => run('alias', async () => {
    await api('/admin/stack-aliases', { method: 'POST', body: { alias: raw, stackId: aliasPick[raw] } });
    const r = await api(`/admin/cohorts/${cohortId}/import-preview`, { method: 'POST' });
    setPreview(r); setMsg(`"${raw}" will now be read as ${stacks.find((s) => s.id === aliasPick[raw])?.name}.`);
  });

  const commit = () => {
    const s = preview.summary;
    const skippedRows = s.error + s.skipped;
    if (!window.confirm(`Apply this import to ${cohort.name}?\n\n${s.create} new learner(s), ${s.update} update(s).${skippedRows ? `\n${skippedRows} row(s) with problems will be left out.` : ''}`)) return;
    run('commit', async () => {
      const r = await api(`/admin/import-batches/${preview.batchId}/commit`, { method: 'POST', body: { confirmStackChanges: confirmMoves } });
      const a = r.applied;
      setResult(`Done. Created ${a.created}, updated ${a.updated}${a.heldBack ? `, held back ${a.heldBack} stack change(s) that were not confirmed` : ''}. ${s.unchanged} were already up to date.`);
      setPreview(null);
      await loadList();
    });
  };

  const sendInvites = (learnerIds) => run('send', async () => {
    const handDelivery = []; const failures = []; let sent = 0; let dry = 0;
    for (let i = 0; i < 20; i++) { // bounded batches; repeat until nothing remains
      const r = await api(`/admin/cohorts/${cohortId}/invitations/send`, { method: 'POST', body: learnerIds ? { learnerIds } : {} });
      sent += r.sent; dry += r.dryRun; handDelivery.push(...r.handDelivery); failures.push(...r.failures);
      if (r.remaining === 0 || r.processed === 0 || learnerIds) break;
      if (r.sent + r.dryRun === 0) break; // nothing succeeded in this batch: stop instead of looping on failures
    }
    setMsg(`Emailed ${sent}${dry ? `, ${dry} issued without email` : ''}${failures.length ? `, ${failures.length} failed` : ''}.`);
    if (failures.length) setErr(`${failures.length} email(s) could not be sent. Their codes are listed below so you can hand them over, or retry later.`);
    if (handDelivery.length) setCodes({ title: 'Invitations to hand over', rows: handDelivery });
    await loadList();
  });

  const changeStatus = (l, action) => {
    const reason = window.prompt(`${action === 'withdraw' ? 'Withdraw' : action === 'reinstate' ? 'Reinstate' : 'Mark complete'}: ${l.full_name}\n\nReason (kept in the activity log):`);
    if (!reason || reason.trim().length < 3) return;
    run('status', async () => { await api(`/admin/learners/${l.id}/status`, { method: 'PATCH', body: { action, reason: reason.trim() } }); await loadList(); });
  };

  const wrongCohort = registrationCohortNumber && cohort && cohort.number !== registrationCohortNumber;
  const counts = list?.counts || {};
  const needInvite = (counts.enrolled || 0);
  const rows = (preview?.rows || []).filter((r) => !rowFilter || r.action === rowFilter);

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-4">
      <h1 className="font-heading text-3xl font-extrabold text-brand-navy">Onboarding</h1>
      <Banner error={error || err} message={msg} />
      <div className="flex flex-wrap items-center gap-3">
        <CohortPicker cohorts={cohorts} value={cohortId} onChange={(id) => { setCohortId(id); setPage(1); setPreview(null); setResult(''); }} />
        {registrationCohortNumber && <span className="text-sm text-brand-body">Registrations are set to import for <strong>Cohort {registrationCohortNumber}</strong> only.</span>}
      </div>
      <CodesPanel title={codes?.title} rows={codes?.rows} onDismiss={() => setCodes(null)} />

      <Card>
        <h2 className="font-heading text-xl font-bold text-brand-navy">1. Import registrations</h2>
        <p className="text-sm text-brand-body mb-3">Reads the “Cohort {cohort?.number} Grading” tab of the registration sheet (name, email, stack). You review everything before anything is saved. Running it again never creates duplicates.</p>
        {wrongCohort && <Banner error={`The platform is set to import Cohort ${registrationCohortNumber}. Choose that cohort, or change ACTIVE_COHORT_NUMBER in Render.`} />}
        <button className={btn} onClick={doPreview} disabled={!!busy || !cohort || wrongCohort || cohort.status === 'archived'}>{busy === 'preview' ? 'Reading sheet…' : 'Preview import from sheet'}</button>
        {result && <div className="mt-3"><Banner message={result} /></div>}

        {preview && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              <Chip label="New" value={preview.summary.create} tone="text-green-700" />
              <Chip label="Updates" value={preview.summary.update} tone="text-amber-700" />
              <Chip label="Unchanged" value={preview.summary.unchanged} />
              <Chip label="Duplicates skipped" value={preview.summary.skipped} />
              <Chip label="Problems" value={preview.summary.error} tone={preview.summary.error ? 'text-red-700' : ''} />
            </div>

            {preview.summary.unmatchedStacks.length > 0 && (
              <div className="border border-amber-300 bg-amber-50 rounded-xl p-3 text-sm space-y-2">
                <p className="font-semibold text-amber-900">Some stack names in the sheet are not in your stack list. Nobody is placed in a guessed stack: choose what each one means.</p>
                {preview.summary.unmatchedStacks.map((u) => (
                  <div key={u.stack} className="flex flex-wrap items-center gap-2">
                    <code className="bg-white border border-brand-border rounded px-2 py-0.5">{u.stack}</code> means
                    <select className={sel} value={aliasPick[u.stack] || ''} onChange={(e) => setAliasPick({ ...aliasPick, [u.stack]: e.target.value })}>
                      <option value="">Choose a stack…</option>
                      {stacks.map((s) => <option key={s.id} value={s.id}>{s.name}{u.suggestion === s.name ? ' (suggested)' : ''}</option>)}
                    </select>
                    <button className="text-brand-blue font-semibold disabled:opacity-50" disabled={!aliasPick[u.stack] || !!busy} onClick={() => addAlias(u.stack)}>Use this and re-check</button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center gap-2 text-sm">
              <label>Show <select className={sel} value={rowFilter} onChange={(e) => setRowFilter(e.target.value)}>
                <option value="">all rows</option><option value="error">problems</option><option value="update">updates</option><option value="create">new</option><option value="unchanged">unchanged</option><option value="skipped">skipped</option>
              </select></label>
              <span className="text-brand-body">{rows.length} row(s)</span>
            </div>
            <div className="overflow-x-auto max-h-96 overflow-y-auto border border-brand-border rounded-xl">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-white"><tr className="text-left text-brand-body"><th className="p-2">Row</th><th>Name</th><th>Email</th><th>Stack (sheet)</th><th>Result</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.rowNumber} className="border-t border-brand-border">
                      <td className="p-2">{r.rowNumber}</td><td>{r.fullName}</td><td className="break-all">{r.email}</td><td>{r.stackRaw}</td>
                      <td className={ACTION_TONE[r.action]}><strong className="capitalize">{r.action}</strong>{r.message ? ` · ${r.message}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.summary.needsConfirmation > 0 && (
              <label className="flex items-start gap-2 text-sm bg-amber-50 border border-amber-300 rounded-xl p-3">
                <input type="checkbox" className="mt-1" checked={confirmMoves} onChange={(e) => setConfirmMoves(e.target.checked)} />
                <span>I confirm that {preview.summary.needsConfirmation} learner(s) should be moved to a different stack. If unticked, those moves are left out.</span>
              </label>
            )}
            <button className={btn} onClick={commit} disabled={!!busy || (preview.summary.create + preview.summary.update === 0)}>{busy === 'commit' ? 'Applying…' : 'Apply this import'}</button>
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold text-brand-navy">2. Invite learners</h2>
        <div className="flex flex-wrap gap-2 my-3">
          {STATE_ORDER.map((s) => <Chip key={s} label={s} value={counts[s] || 0} />)}
        </div>
        {list && list.mail && (list.mail.dryRun || !list.mail.configured) && (
          <p className="text-sm bg-amber-50 border border-amber-300 rounded-xl p-3 mb-3">Email sending is <strong>off</strong> ({list.mail.configured ? 'MAIL_DRY_RUN is on' : 'no email provider configured'}). Sending will create the codes and show them here so you can hand them over yourself. See the go-live guide to turn email on.</p>
        )}
        <button className={btn} onClick={() => sendInvites(null)} disabled={!!busy || !cohort || !['upcoming', 'active'].includes(cohort.status)}>
          {busy === 'send' ? 'Sending…' : `Send invitations${needInvite ? ` (${needInvite} not yet invited)` : ''}`}
        </button>
        <p className="text-xs text-brand-body mt-2">Only people who have not been successfully invited are included, so it is safe to press this again after a failure.</p>
      </Card>

      <Card>
        <h2 className="font-heading text-xl font-bold text-brand-navy mb-3">3. Learners and their status</h2>
        <div className="flex flex-wrap gap-2 mb-3">
          <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name or email" className={sel} />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className={sel}>
            <option value="">All statuses</option>{STATE_ORDER.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-brand-body"><th className="py-1">Name</th><th>Email</th><th>Stack</th><th>Status</th><th>Invitation</th><th /></tr></thead>
            <tbody>
              {list?.learners.map((l) => (
                <tr key={l.id} className="border-t border-brand-border align-top">
                  <td className="py-2 font-semibold">{l.full_name}</td><td className="break-all">{l.email}</td><td>{l.stack}</td>
                  <td><StatusBadge status={l.status} /></td>
                  <td>{inviteLabel(l)}{l.delivery_status === 'failed' && l.delivery_error ? <span className="block text-xs text-red-700">{l.delivery_error}</span> : null}</td>
                  <td className="text-right whitespace-nowrap">
                    {['enrolled', 'invited'].includes(l.status) && <button className="text-brand-blue font-semibold mr-3 disabled:opacity-50" disabled={!!busy} onClick={() => sendInvites([l.id])}>Resend</button>}
                    {l.status === 'withdrawn'
                      ? <button className="text-brand-blue font-semibold" onClick={() => changeStatus(l, 'reinstate')}>Reinstate</button>
                      : <button className="text-red-700 font-semibold" onClick={() => changeStatus(l, 'withdraw')}>Withdraw</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {list && list.learners.length === 0 && <p className="text-brand-body text-sm py-3">No learners match. Import registrations above to enrol learners.</p>}
        {list && list.total > list.pageSize && (
          <div className="flex items-center gap-3 mt-3 text-sm">
            <button className="text-brand-blue font-semibold disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>← Previous</button>
            <span>Page {page} of {Math.ceil(list.total / list.pageSize)} · {list.total} learners</span>
            <button className="text-brand-blue font-semibold disabled:opacity-40" disabled={page * list.pageSize >= list.total} onClick={() => setPage(page + 1)}>Next →</button>
          </div>
        )}
      </Card>
    </div>
  );
}
