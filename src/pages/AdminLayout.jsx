import { NavLink, Outlet } from 'react-router-dom';

const links = [['/admin', 'Setup', true], ['/admin/learners', 'Learners'], ['/admin/groups', 'Capstone groups'], ['/admin/schedule', 'Schedule'], ['/admin/analytics', 'Analytics']];

export default function AdminLayout() {
  return (
    <div className="min-h-screen bg-brand-bg font-body">
      <nav aria-label="Admin" className="bg-brand-navy px-4 py-2 flex gap-1 overflow-x-auto">
        {links.map(([to, label, end]) => (
          <NavLink key={to} to={to} end={end}
            className={({ isActive }) => `px-3 py-1.5 rounded-lg text-sm font-semibold whitespace-nowrap ${isActive ? 'bg-brand-blue text-white' : 'text-white/80 hover:text-white'}`}>
            {label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </div>
  );
}