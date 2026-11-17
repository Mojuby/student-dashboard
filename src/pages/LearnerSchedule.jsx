import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import LearnerNav from '../components/LearnerNav';
import FeedbackWidget from '../components/FeedbackWidget';
import ScheduleView from '../components/ScheduleView';
import { Banner, Card } from '../components/ui';

export default function LearnerSchedule() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { api('/learner/events').then(setData).catch((e) => setErr(e.message)); }, []);
  const events = useMemo(() => data?.events || [], [data]);

  return (
    <div className="min-h-screen bg-brand-bg font-body">
      <LearnerNav />
      <main className="mx-auto w-full max-w-5xl px-4 py-4 sm:px-6 sm:py-8">
        <h1 className="mb-1 font-heading text-2xl font-extrabold text-brand-navy sm:text-3xl">My schedule</h1>
        <p className="mb-4 text-sm text-brand-body">{data ? `${data.stack} classes, assessment dates and events. Times are shown in ${data.timezone}.` : 'Your classes, assessment dates and events.'}</p>
        <Banner error={err} />
        <Card>
          {!data && !err ? <p className="text-sm text-brand-body">Loading your schedule…</p>
            : <ScheduleView events={events} timezone={data?.timezone || 'Africa/Lagos'} emptyText="Your facilitators have not scheduled anything yet. Check back soon." />}
        </Card>
      </main>
      <FeedbackWidget />
    </div>
  );
}
