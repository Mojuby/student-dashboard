export function AuthCard({ title, subtitle, children }) {
  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4 font-body">
      <div className="bg-white rounded-2xl border border-brand-border shadow-sm p-8 w-full max-w-md">
        <h1 className="font-heading text-2xl font-bold text-brand-navy mb-1">{title}</h1>
        <p className="text-brand-body mb-6">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, ...props }) {
  return (
    <label className="block">
      <span className="block text-sm font-semibold text-brand-navy mb-1">{label}</span>
      <input {...props} className="w-full px-4 py-2.5 border border-brand-line rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue" />
    </label>
  );
}

export function ErrorNote({ children }) {
  return <div role="alert" className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3">{children}</div>;
}

export function PrimaryButton({ children, ...props }) {
  return (
    <button {...props} className="w-full bg-brand-blue text-white py-2.5 rounded-lg font-semibold hover:bg-brand-navy disabled:opacity-50 disabled:cursor-not-allowed">
      {children}
    </button>
  );
}
export function Banner({ error, message }) {
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (message) return <div role="status" className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-lg p-3">{message}</div>;
  return null;
}

export function Card({ children, className = '' }) {
  return <section className={`bg-white rounded-2xl border border-brand-border p-5 ${className}`}>{children}</section>;
}

const BADGES = {
  open: ['Open', 'bg-blue-100 text-blue-800'],
  submitted: ['Submitted', 'bg-indigo-100 text-indigo-800'],
  graded: ['Graded', 'bg-green-100 text-green-800'],
  missing: ['Missing', 'bg-red-100 text-red-800'],
  closed: ['Closed', 'bg-slate-200 text-slate-700'],
  locked: ['Locked', 'bg-slate-100 text-slate-600'],
  disabled: ['Off', 'bg-slate-100 text-slate-500'],
  // enrolment states
  enrolled: ['Enrolled', 'bg-slate-100 text-slate-700'],
  invited: ['Invited', 'bg-blue-100 text-blue-800'],
  activated: ['Activated', 'bg-indigo-100 text-indigo-800'],
  orientation: ['Orientation', 'bg-amber-100 text-amber-800'],
  active: ['Active', 'bg-green-100 text-green-800'],
  completed: ['Completed', 'bg-emerald-100 text-emerald-800'],
  withdrawn: ['Withdrawn', 'bg-red-100 text-red-800'],
};

export function StatusBadge({ status }) {
  const [label, tone] = BADGES[status] || [String(status || '—'), 'bg-slate-100 text-slate-600'];
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${tone}`}>{label}</span>;
}

export function CohortPicker({ cohorts, value, onChange }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm font-semibold text-brand-navy">
      Cohort
      <select value={value} onChange={(e) => onChange(e.target.value)} className="px-3 py-2 border border-brand-line rounded-lg bg-white font-normal">
        {cohorts.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.status || (c.is_active ? 'active' : 'inactive')})</option>)}
      </select>
    </label>
  );
}
