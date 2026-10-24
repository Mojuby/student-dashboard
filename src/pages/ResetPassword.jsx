import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { AuthCard, Field, ErrorNote, PrimaryButton } from '../components/ui';

// Supabase's reset email lands here with the recovery token in the URL fragment (#access_token=...).
const tokenFromHash = () => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('access_token') || '';

export default function ResetPassword() {
  const [token] = useState(tokenFromHash);
  const [form, setForm] = useState({ password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { accessToken: token, newPassword: form.password } });
      window.history.replaceState(null, '', window.location.pathname); // drop the token from the address bar
      setDone(true);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }

  if (done) {
    return <AuthCard title="Password updated" subtitle="Sign in with your new password."><Link className="text-brand-blue font-semibold" to="/login">Go to sign in</Link></AuthCard>;
  }
  if (!token) {
    return (
      <AuthCard title="Reset link needed" subtitle="Open the link from your reset email, or request a new one.">
        <Link className="text-brand-blue font-semibold" to="/forgot-password">Request a reset link</Link>
      </AuthCard>
    );
  }
  return (
    <AuthCard title="Choose a new password" subtitle="Use at least 10 characters.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="New password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} autoComplete="new-password" minLength={10} required />
        <Field label="Confirm password" type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} autoComplete="new-password" required />
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton disabled={busy}>{busy ? 'Saving…' : 'Update password'}</PrimaryButton>
      </form>
    </AuthCard>
  );
}
