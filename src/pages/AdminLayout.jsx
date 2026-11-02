import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth/context';

const links = [
  ['/admin', 'Setup', true], ['/admin/onboarding', 'Onboarding'], ['/admin/learners', 'Learners'], ['/admin/facilitators', 'Facilitators'],
  ['/admin/assessments', 'Assessments'], ['/admin/schedule', 'Schedule'], ['/admin/groups', 'Capstone groups'], ['/admin/analytics', 'Analytics'],
  ['/admin/feedback', 'Feedback'], ['/admin/activity', 'Activity log'],
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const { pathname } = useLocation();
  const [openFeedback, setOpenFeedback] = useState(0);

  // Refresh the "open feedback" count when moving between pages and after a resolve.
  useEffect(() => {
    const load = () => api('/admin/feedback/summary').then((r) => setOpenFeedback(r.open)).catch(() => {});
    load();
    window.addEventListener('fv:feedback-changed', load);
    return () => window.removeEventListener('fv:feedback-changed', load);
  }, [pathname]);

  return (
    <div className="min-h-screen bg-brand-bg font-body">
      {/* Frozen: the bar stays at the top while the page scrolls underneath it. */}
      <nav aria-label="Admin" className="sticky top-0 z-40 flex items-center gap-1 overflow-x-auto bg-brand-navy px-3 py-2 shadow-md sm:px-4">
        {links.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${isActive ? 'bg-brand-blue text-white' : 'text-white/80 hover:text-white'}`}>
            {label}
            {to === '/admin/feedback' && openFeedback > 0 && <span className="rounded-full bg-amber-400 px-1.5 text-xs font-bold text-brand-navy" aria-label={`${openFeedback} open`}>{openFeedback}</span>}
          </NavLink>
        ))}
        <span className="ml-auto flex items-center gap-3 whitespace-nowrap pl-4 text-sm text-white/80">
          <span className="hidden md:inline">{user?.email}</span>
          <button onClick={logout} className="underline hover:text-white">Logout</button>
        </span>
      </nav>
      <Outlet />
    </div>
  );
}
