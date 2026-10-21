import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../api';
import { AuthCard, Field, ErrorNote, PrimaryButton } from '../components/ui';

export default function Claim() {
  const isFacilitator = useLocation().pathname.startsWith('/facilitator');
  const [form, setForm] = useState({ email: '', code: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [doneRole, setDoneRole] = useState(null);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setError('');
    if (form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      const r = await api('/auth/claim', { method: 'POST', body: { email: form.email, code: form.code, password: form.password } });
      setDoneRole(r.role);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
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
    </AuthCard>
  );
}