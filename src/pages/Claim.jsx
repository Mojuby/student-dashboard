import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { AuthCard, Field, ErrorNote, PrimaryButton, Banner } from '../components/ui';

// The invitation email links to /claim?email=...#code=... The code sits in the fragment so it never reaches a server log.
function fromLink(search, hash) {
  const email = new URLSearchParams(search).get('email') || '';
  const code = new URLSearchParams(hash.replace(/^#/, '')).get('code') || '';
  return { email, code };
}

export default function Claim() {
  const location = useLocation();
  const isFacilitator = location.pathname.startsWith('/facilitator');
  const [form, setForm] = useState(() => ({ ...fromLink(location.search, location.hash), password: '', confirm: '' }));
  const [error, setError] = useState('');
  const [errCode, setErrCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneRole, setDoneRole] = useState(null);
  const [requested, setRequested] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    if (busy) return; // no double submits
    setError(''); setErrCode('');
    if (form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      const r = await api('/auth/claim', { method: 'POST', body: { email: form.email.trim(), code: form.code.trim(), password: form.password } });
      setDoneRole(r.role);
    } catch (err) {
      setError(err.message);
      setErrCode(err.code || '');
    } finally {
      setBusy(false);
    }
  }

  async function requestNew() {
    setBusy(true); setError('');
    try { setRequested((await api('/auth/request-invite', { method: 'POST', body: { email: form.email.trim() } })).message); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  if (doneRole) {
    return (
      <AuthCard title="Account activated" subtitle="You can now sign in with your new password.">
        <Link className="text-brand-blue font-semibold" to={doneRole === 'facilitator' ? '/facilitator/login' : '/login'}>Go to sign in</Link>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={isFacilitator ? 'Facilitator sign-up' : 'Activate your account'}
      subtitle="Use the email and invite code FUSE Varsity sent you, then choose a password."
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" type="email" value={form.email} onChange={set('email')} autoComplete="username" required />
        <Field label="Invite code" value={form.code} onChange={set('code')} autoComplete="off" required />
        <Field label="New password (10+ characters)" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" minLength={10} required />
        <Field label="Confirm password" type="password" value={form.confirm} onChange={set('confirm')} autoComplete="new-password" required />
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton disabled={busy}>{busy ? 'Activating…' : 'Activate account'}</PrimaryButton>
      </form>

      {errCode === 'ACCOUNT_EXISTS' && <p className="text-sm mt-4"><Link className="text-brand-blue font-semibold" to="/login">Sign in instead</Link></p>}

      {!isFacilitator && (errCode === 'INVITE_INVALID' || requested) && (
        <div className="mt-5 border-t border-brand-border pt-4 text-sm space-y-2">
          <p className="text-brand-body">Code expired or lost? We can email a fresh invitation to the address FUSE Varsity has on file.</p>
          <Banner message={requested} />
          {!requested && (
            <button type="button" onClick={requestNew} disabled={busy || !form.email} className="text-brand-blue font-semibold underline disabled:opacity-50">
              Email me a new invitation
            </button>
          )}
        </div>
      )}
    </AuthCard>
  );
}
