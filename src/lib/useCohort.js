import { useEffect, useState } from 'react';
import { api } from '../api';

const KEY = 'fv.cohort';

// The admin chooses which cohort to LOOK AT. Choosing never changes any cohort's status, and several cohorts can be active.
// Default: the last choice, else the cohort Render's ACTIVE_COHORT_NUMBER names, else the newest active cohort.
export default function useCohort() {
  const [cohorts, setCohorts] = useState([]);
  const [cohortId, setId] = useState('');
  const [registrationCohortNumber, setReg] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api('/admin/cohorts')
      .then((r) => {
        setCohorts(r.cohorts);
        setReg(r.registrationCohortNumber ?? null);
        const saved = sessionStorage.getItem(KEY);
        const pick = r.cohorts.find((c) => c.id === saved)
          || r.cohorts.find((c) => c.number === r.registrationCohortNumber)
          || r.cohorts.find((c) => c.is_active) || r.cohorts[0];
        setId(pick?.id || '');
      })
      .catch((e) => setError(e.message));
  }, []);
  const setCohortId = (id) => { sessionStorage.setItem(KEY, id); setId(id); };
  return { cohorts, cohortId, setCohortId, registrationCohortNumber, error };
}
