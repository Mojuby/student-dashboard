import { NavLink } from 'react-router-dom';
import { useAuth } from '../auth/context';

const links = [['/', 'Dashboard', true], ['/schedule', 'Schedule'], ['/assessments', 'Assessments']];

export default function LearnerNav() {
  const { logout } = useAuth();
  return (
    <nav aria-label="Learner" className="sticky top-0 z-30 border-b border-brand-border bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-1 overflow-x-auto px-3 py-2 sm:px-6">
        {links.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold ${isActive ? 'bg-brand-blue text-white' : 'text-brand-body hover:text-brand-blue'}`}>{label}</NavLink>
        ))}
        <button onClick={logout} className="ml-auto whitespace-nowrap px-3 py-1.5 text-sm text-brand-body hover:text-brand-blue">Logout</button>
      </div>
    </nav>
  );
}
