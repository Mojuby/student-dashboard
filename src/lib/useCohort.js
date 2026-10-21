import { useEffect, useState } from 'react';
import { api } from '../api';

export default function useCohort() {
  const [cohorts, setCohorts] = useState([]);
  const [cohortId, setCohortId] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    api('/admin/cohorts')
      .then((r) => { setCohorts(r.cohorts); setCohortId((r.cohorts.find((c) => c.is_active) || r.cohorts[0])?.id || ''); })
      .catch((e) => setError(e.message));
  }, []);
  return { cohorts, cohortId, setCohortId, error };
}