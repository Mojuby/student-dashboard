import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/context';
import { AuthCard, Field, ErrorNote, PrimaryButton } from '../components/ui';

const CONFIG = {
  learner: { title: 'Learner Login', sub: 'Sign in to view your progress', home: '/', activate: '/claim' },
  facilitator: { title: 'Facilitator Login', sub: 'Sign in to review and grade submissions', home: '/facilitator', activate: '/facilitator/signup' },
  admin: { title: 'Administrator Login', sub: 'Authorised staff only', home: '/admin' },
};

export default function Login({ role }) {
  const cfg = CONFIG[role];
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user?.role === role && !user.mustChangePassword) return <Navigate to={cfg.home} replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const u = await login(role, email, password);
      navigate(u.mustChangePassword ? '/change-password' : cfg.home, { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthCard title={cfg.title} subtitle={cfg.sub}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        {error && <ErrorNote>{error}</ErrorNote>}
        <PrimaryButton disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</PrimaryButton>
      </form>
      <p className="text-sm text-brand-body mt-4"><Link className="text-brand-blue font-semibold" to="/forgot-password">Forgot your password?</Link></p>
      {cfg.activate && (
        <p className="text-sm text-brand-body mt-4">
          First time here? <Link className="text-brand-blue font-semibold" to={cfg.activate}>Activate your account</Link>
        </p>
      )}
    </AuthCard>
  );
}