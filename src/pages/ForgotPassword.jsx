import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { AuthCard, Field, ErrorNote, PrimaryButton, Banner } from '../components/ui';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setError('');
    try { setMsg((await api('/auth/forgot-password', { method: 'POST', body: { email: email.trim() } })).message); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return (
    <AuthCard title="Reset your password" subtitle="Enter your account email and we will send you a reset link.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        {error && <ErrorNote>{error}</ErrorNote>}
        <Banner message={msg} />
        <PrimaryButton disabled={busy || !!msg}>{busy ? 'Sending…' : 'Send reset link'}</PrimaryButton>
      </form>
      <p className="text-sm mt-4"><Link className="text-brand-blue font-semibold" to="/login">Back to sign in</Link></p>
    </AuthCard>
  );
}
