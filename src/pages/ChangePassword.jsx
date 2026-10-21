import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/context';
import { AuthCard, Field, ErrorNote, PrimaryButton } from '../components/ui';

const LOGIN = { admin: '/admin/login', facilitator: '/facilitator/login', learner: '/login' };

export default function ChangePassword() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/change-password', { method: 'POST', body: form });
      const target = LOGIN[user.role];
      await logout();
      navigate(target, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title="Change your password" subtitle="Choose a new password to continue. You'll sign in again afterwards.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Current password" type="password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} autoComplete="current-password" required />
        <Field label="New password (10+ characters)" type="password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} autoComplete="new-password" minLength={10} required />
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton disabled={busy}>{busy ? 'Saving…' : 'Update password'}</PrimaryButton>
      </form>
    </AuthCard>
  );
}