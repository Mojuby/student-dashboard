import { useEffect, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth/context';

export default function FacilitatorHome() {
  const { user, logout } = useAuth();
  const [assignments, setAssignments] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/facilitator/me').then((r) => setAssignments(r.assignments)).catch((e) => setError(e.message));
  }, []);

  return (
    <div className="min-h-screen bg-brand-bg font-body p-6">
      <div className="max-w-3xl mx-auto bg-white rounded-2xl border border-brand-border p-6">
        <div className="flex justify-between items-start mb-4">
          <div>
            <h1 className="font-heading text-2xl font-bold text-brand-navy">Facilitator dashboard</h1>
            <p className="text-brand-body">{user.fullName}</p>
          </div>
          <button onClick={logout} className="text-sm text-brand-body hover:text-brand-blue">Logout</button>
        </div>
        {error && <p className="text-red-600">{error}</p>}
        {assignments && assignments.length === 0 && <p className="text-brand-body">No assignments in the active cohort yet.</p>}
        <ul className="space-y-2">
          {assignments?.map((a) => (
            <li key={`${a.cohort_number}-${a.stack}`} className="border border-brand-border rounded-lg p-3">
              Cohort {a.cohort_number} · <strong>{a.stack}</strong>
            </li>
          ))}
        </ul>
        <p className="text-sm text-brand-body mt-6">Submission review and grading arrive in the next slice.</p>
      </div>
    </div>
  );
}