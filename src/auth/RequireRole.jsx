import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './context';

export default function RequireRole({ role, loginPath, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="min-h-screen flex items-center justify-center text-brand-body">Loading…</div>;
  if (!user || user.role !== role) return <Navigate to={loginPath} replace state={{ from: location }} />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return children;
}