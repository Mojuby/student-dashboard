import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/context';
import { fmt } from '../lib/format';
import { Banner, Card, StatusBadge } from '../components/ui';

const NOTICE = 'Important: Before submitting, ensure your Google Doc or Google Drive folder is accessible to the relevant reviewers. Set the sharing permissions so anyone with the link can view the deliverables. FUSE Varsity does not automatically verify or change your Google Drive sharing permissions.';

function AssessmentCard({ a, tz, onSaved }) {
  const [url, setUrl] = useState(a.submission?.url || '');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const editable = a.status === 'open' || a.status === 'submitted';

  async function save(e) {
    e.preventDefault();
    setBusy(true); setErr(''); setMsg('');
    try {
      await api(`/learner/assessments/${a.id}/submission`, { method: 'PUT', body: { url } });
      setMsg('Link saved.');
      onSaved();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-heading text-lg font-bold text-brand-navy">Week {a.weekNumber}: {a.title}</h3>
          <p className="text-sm text-brand-body">Opens {fmt(a.opensAt, tz)} · Due {fmt(a.dueAt, tz)} · Out of {a.maxScore}</p>
        </div>
        <StatusBadge status={a.status} />
      </div>

      {a.status === 'graded' && (
        <div className="mt-3 text-sm">
          <p><strong>Score:</strong> {a.score} / {a.maxScore}</p>
          {a.feedback && <p className="mt-1"><strong>Feedback:</strong> {a.feedback}</p>}
        </div>
      )}

      {a.status === 'locked' && <p className="mt-3 text-sm text-brand-body">This assessment opens on {fmt(a.opensAt, tz)}.</p>}
      {a.status === 'closed' && <p className="mt-3 text-sm text-brand-body">The deadline has passed and no submission was received.</p>}

      {a.submission && !editable && (
        <p className="mt-3 text-sm">Your submission: <a className="text-brand-blue underline break-all" href={a.submission.url} target="_blank" rel="noreferrer">{a.submission.url}</a></p>
      )}

      {a.status !== 'graded' && a.status !== 'closed' && (
        <form onSubmit={save} className="mt-4 space-y-2">
          <p className="text-sm bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-900">{NOTICE}</p>
          <label className="block">
            <span className="text-sm font-semibold text-brand-navy">Google Docs or Google Drive folder link</span>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} disabled={!editable || busy}
              placeholder="https://docs.google.com/document/d/…" className="mt-1 w-full px-3 py-2 border border-brand-line rounded-lg disabled:bg-slate-100" />
          </label>
          <Banner error={err} message={msg} />
          <button disabled={!editable || busy || !url} className="bg-brand-blue text-white px-4 py-2 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50">
            {busy ? 'Saving…' : a.submission ? 'Update link' : 'Submit link'}
          </button>
        </form>
      )}
    </Card>
  );
}

export default function LearnerAssessments() {
  const { logout } = useAuth();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => api('/learner/overview').then(setData).catch((e) => setErr(e.message)), []);
  useEffect(() => { load(); }, [load]);

  if (err) return <div className="p-6 text-red-600">{err}</div>;
  if (!data) return <div className="min-h-screen flex items-center justify-center text-brand-body">Loading…</div>;

  return (
    <div className="min-h-screen bg-brand-bg font-body p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-4">
        <div className="flex justify-between items-center">
          <h1 className="font-heading text-2xl md:text-3xl font-extrabold text-brand-navy">Weekly Assessments</h1>
          <div className="flex gap-4 text-sm">
            <Link to="/" className="text-brand-blue font-semibold">← Dashboard</Link>
            <button onClick={logout} className="text-brand-body hover:text-brand-blue">Logout</button>
          </div>
        </div>

        <Card>
          <h2 className="font-heading text-lg font-bold text-brand-navy mb-1">Capstone group</h2>
          {data.group ? (
            <p className="text-sm">{data.group.name} · <a className="text-brand-blue underline" href={data.group.whatsappUrl} target="_blank" rel="noreferrer">Join the WhatsApp group</a></p>
          ) : <p className="text-sm text-brand-body">You have not been assigned to a capstone group yet.</p>}
        </Card>

        <Card>
          <h2 className="font-heading text-lg font-bold text-brand-navy mb-2">Upcoming</h2>
          {data.events.length === 0 ? <p className="text-sm text-brand-body">Nothing scheduled.</p> : (
            <ul className="text-sm space-y-1">
              {data.events.map((e, i) => (
                <li key={i} className="flex justify-between gap-3 border-b border-brand-border py-1">
                  <span>{e.linkUrl ? <a className="text-brand-blue underline" href={e.linkUrl} target="_blank" rel="noreferrer">{e.title}</a> : e.title}</span>
                  <span className="text-brand-body whitespace-nowrap">{fmt(e.startsAt, data.timezone)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {data.assessments.map((a) => <AssessmentCard key={a.id} a={a} tz={data.timezone} onSaved={load} />)}
      </div>
    </div>
  );
}