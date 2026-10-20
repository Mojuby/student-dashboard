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