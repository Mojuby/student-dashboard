import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle, TrendingUp, Award, Circle, CheckCircle2 } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/context';
import { fmt } from '../lib/format';
import { Banner } from '../components/ui';

// A score that has not been recorded is shown as a dash. It is never shown as 0.
const pct = (v) => (v == null ? '—' : `${v}%`);
const card = 'bg-white rounded-2xl shadow-lg p-6 mb-6';

function Orientation({ data, onChange }) {
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');
  async function done(key) {
    if (busy) return;
    setBusy(key); setErr('');
    try { onChange(await api(`/learner/orientation/${key}`, { method: 'POST' })); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  }
  return (
    <div className={`${card} border-2 border-[#FF6600]`}>
      <h2 className="text-xl font-bold text-[#111827] mb-1">Get started</h2>
      <p className="text-sm text-gray-600 mb-4">{data.completed} of {data.total} done. Finish these to complete your orientation.</p>
      <ul className="space-y-2">
        {data.items.map((i) => (
          <li key={i.key} className="flex items-center gap-3">
            {i.completedAt ? <CheckCircle2 className="text-green-600 shrink-0" size={22} /> : <Circle className="text-gray-400 shrink-0" size={22} />}
            <span className={`flex-1 ${i.completedAt ? 'text-gray-500 line-through' : 'text-[#111827]'}`}>{i.label}</span>
            {!i.completedAt && <button onClick={() => done(i.key)} disabled={!!busy} className="text-sm text-[#0A3DA8] font-semibold disabled:opacity-50">{busy === i.key ? 'Saving…' : 'Mark done'}</button>}
          </li>
        ))}
      </ul>
      <div className="mt-3"><Banner error={err} /></div>
    </div>
  );
}

function Grades({ d }) {
  const t = d.totals;
  const progress = t.total == null ? 0 : Math.min(parseFloat(t.total), 100);
  return (
    <>
      <div className={card}>
        <div className="flex justify-between items-center mb-3">
          <h2 className="text-lg font-bold text-[#111827]">Overall Progress</h2>
          <span className="text-2xl font-bold text-[#0A3DA8]">{t.total == null ? '—' : `${t.total}%`}</span>
        </div>
        <div className="relative w-full h-6 bg-gray-200 rounded-full overflow-hidden">
          <div className="absolute top-0 left-0 h-full bg-gradient-to-r from-[#0A3DA8] to-[#FF6600] rounded-full transition-all duration-1000 ease-out" style={{ width: `${progress}%` }} />
        </div>
        {!d.hasScores && <p className="text-sm text-gray-600 mt-3">No scores have been recorded for you yet. They will appear here as your facilitators record them.</p>}
      </div>

      <div className="bg-gradient-to-r from-[#0A3DA8] to-[#FF6600] rounded-2xl p-6 mb-6 text-white shadow-lg">
        <div className="flex items-center justify-between">
          <div><p className="text-blue-100 text-sm mb-1">Current Grade</p><p className="text-5xl font-bold">{t.total == null ? '—' : `${t.total}%`}</p></div>
          <div className="text-right"><p className="text-blue-100 text-sm mb-1">Letter Grade</p><p className="text-4xl font-bold">{t.grade ?? '—'}</p></div>
        </div>
      </div>

      {d.hasScores && (
        <div className={`rounded-2xl p-5 mb-6 flex items-center gap-3 shadow-lg ${d.qualifiedForCapstone ? 'bg-green-50 border-2 border-green-300' : 'bg-amber-50 border-2 border-amber-300'}`}>
          {d.qualifiedForCapstone ? <CheckCircle className="text-green-600 shrink-0" size={28} /> : <AlertCircle className="text-amber-600 shrink-0" size={28} />}
          <div>
            <p className={`font-bold text-lg ${d.qualifiedForCapstone ? 'text-green-800' : 'text-amber-800'}`}>{d.qualifiedForCapstone ? 'Qualified for Capstone' : 'Not Yet Qualified for Capstone'}</p>
            <p className={`text-sm ${d.qualifiedForCapstone ? 'text-green-700' : 'text-amber-700'}`}>{d.qualifiedForCapstone ? 'You are eligible to proceed with the capstone project' : 'Continue working to meet the requirements'}</p>
          </div>
        </div>
      )}

      <div className={card}>
        <div className="flex items-center gap-2 mb-4"><TrendingUp className="text-[#0A3DA8]" size={24} /><h2 className="text-xl font-bold text-[#111827]">Attendance (30% Total)</h2></div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
          {Object.entries(d.attendance).map(([key, v], i) => (
            <div key={key} className="bg-white p-4 rounded-lg border-2 border-gray-100">
              <p className="text-sm text-gray-600 font-medium">Week {i + 1}</p><p className="text-3xl font-bold text-[#0A3DA8]">{pct(v)}</p><p className="text-xs text-gray-500">of 5%</p>
            </div>
          ))}
        </div>
        <div className="bg-gradient-to-r from-[#0A3DA8] to-blue-600 p-4 rounded-lg text-white"><p className="text-sm font-medium opacity-90">Total Attendance</p><p className="text-3xl font-bold">{pct(t.attendance)}</p></div>
      </div>

      <div className={card}>
        <h2 className="text-xl font-bold text-[#111827] mb-4">Assessment Scores (45% Total)</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
          {[['w1', 5], ['w2', 10], ['w3', 10], ['w4', 10], ['w5', 10]].map(([k, max], i) => (
            <div key={k} className="bg-white p-4 rounded-lg border-2 border-gray-100">
              <p className="text-sm text-gray-600 font-medium">Week {i + 1}</p><p className="text-3xl font-bold text-[#FF6600]">{pct(d.assessments[k])}</p><p className="text-xs text-gray-500">of {max}%</p>
            </div>
          ))}
        </div>
        <div className="bg-gradient-to-r from-[#FF6600] to-orange-600 p-4 rounded-lg text-white"><p className="text-sm font-medium opacity-90">Total Assessment Score</p><p className="text-3xl font-bold">{pct(t.assessment)}</p></div>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 mb-4"><Award className="text-[#FF6600]" size={24} /><h2 className="text-xl font-bold text-[#111827]">Bonus Sessions (5% Total)</h2></div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[['LinkedIn Session', d.linkedinBonus], ['Soft Skills Session', d.softSkillBonus]].map(([label, v]) => (
            <div key={label} className="bg-amber-50 rounded-xl p-5 border-2 border-amber-200">
              <p className="text-sm text-amber-800 font-medium mb-2">{label}</p><p className="text-4xl font-bold text-[#FF6600]">{pct(v)}</p><p className="text-xs text-amber-700 mt-1">of 2.5%</p>
            </div>
          ))}
        </div>
      </div>

      <div className={card}>
        <h2 className="text-xl font-bold text-[#111827] mb-4">Capstone Project (20% Total)</h2>
        <div className="bg-indigo-50 rounded-xl p-6 border-2 border-indigo-200"><p className="text-sm text-indigo-800 font-medium mb-3">Capstone Score</p><p className="text-5xl font-bold text-[#0A3DA8]">{pct(d.capstone)}</p></div>
      </div>
    </>
  );
}

export default function LearnerDashboard() {
  const { logout } = useAuth();
  const [overview, setOverview] = useState(null);
  const [grades, setGrades] = useState(null);
  const [overviewErr, setOverviewErr] = useState('');
  const [gradesErr, setGradesErr] = useState(null);

  // Independent requests: a grade-sheet problem must never hide the rest of the dashboard.
  useEffect(() => {
    api('/learner/overview').then(setOverview).catch((e) => setOverviewErr(e.message));
    api('/learner/dashboard').then(setGrades).catch((e) => setGradesErr(e));
  }, []);

  if (overviewErr) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center"><p className="text-red-600 mb-4">{overviewErr}</p><button onClick={logout} className="text-sm text-gray-600 underline">Sign out</button></div>
      </div>
    );
  }
  if (!overview) return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading your dashboard…</div>;

  const outstanding = overview.assessments.filter((a) => a.status === 'open' && !a.submission);
  const gradesNote = gradesErr?.code === 'NO_GRADE_RECORD'
    ? 'Your grade record has not been set up yet. It will appear once your first scores are recorded.'
    : gradesErr?.message;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        <div className={card}>
          <div className="flex flex-wrap justify-between items-center gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-[#111827] mb-1">FUSE Varsity {overview.cohort.name}</h1>
              <p className="text-gray-600">Welcome back, <span className="font-semibold text-[#0A3DA8]">{overview.learner.name}</span> · {overview.stack}</p>
            </div>
            <div className="flex gap-4 text-sm font-medium">
              <Link to="/assessments" className="text-[#0A3DA8] hover:underline">Weekly assessments</Link>
              <button onClick={logout} className="text-gray-600 hover:text-[#0A3DA8]">Logout</button>
            </div>
          </div>
        </div>

        {overview.orientation.required && <Orientation data={overview.orientation} onChange={(o) => setOverview({ ...overview, orientation: { ...o, required: o.status === 'orientation' || o.status === 'activated' }, learner: { ...overview.learner, status: o.status } })} />}

        {(overview.nextClass || outstanding.length > 0) && (
          <div className="grid md:grid-cols-2 gap-6 mb-6">
            {overview.nextClass && (
              <div className="bg-white rounded-2xl shadow-lg p-6">
                <h2 className="text-lg font-bold text-[#111827] mb-1">Next class</h2>
                <p className="text-gray-700">{overview.nextClass.title}</p>
                <p className="text-sm text-gray-600">{fmt(overview.nextClass.startsAt, overview.timezone)}</p>
                {overview.nextClass.linkUrl && <a href={overview.nextClass.linkUrl} target="_blank" rel="noreferrer" className="inline-block mt-2 text-[#0A3DA8] font-semibold underline">Join class</a>}
              </div>
            )}
            {outstanding.length > 0 && (
              <div className="bg-white rounded-2xl shadow-lg p-6">
                <h2 className="text-lg font-bold text-[#111827] mb-1">Needs your submission</h2>
                <ul className="text-sm space-y-1">{outstanding.map((a) => <li key={a.id}>Week {a.weekNumber}: due {fmt(a.dueAt, overview.timezone)}</li>)}</ul>
                <Link to="/assessments" className="inline-block mt-2 text-[#0A3DA8] font-semibold underline">Submit now</Link>
              </div>
            )}
          </div>
        )}

        {overview.announcements.length > 0 && (
          <div className={card}>
            <h2 className="text-lg font-bold text-[#111827] mb-3">Announcements</h2>
            <div className="space-y-3">
              {overview.announcements.map((a) => (
                <div key={a.id} className="border-b border-gray-100 pb-3 last:border-0 last:pb-0">
                  <p className="font-semibold text-[#111827]">{a.title}</p>
                  <p className="text-sm text-gray-700 whitespace-pre-wrap">{a.body}</p>
                  <p className="text-xs text-gray-500 mt-1">{fmt(a.createdAt, overview.timezone)}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {grades ? <Grades d={grades} /> : (
          <div className={card}>
            <h2 className="text-lg font-bold text-[#111827] mb-1">Your grades</h2>
            <p className="text-gray-600">{gradesErr ? gradesNote : 'Loading your grades…'}</p>
          </div>
        )}

        <div className="text-center text-sm text-gray-500 pb-6">Need help? Contact your facilitator or the FUSE Varsity team.</div>
      </div>
    </div>
  );
}
