import React, { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle, TrendingUp, Award } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth/context';

export default function LearnerDashboard() {
  const { logout } = useAuth();
  const [studentData, setStudentData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/learner/dashboard').then(setStudentData).catch((e) => setError(e.message));
  }, []);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={logout} className="text-sm text-gray-600 underline">Sign out</button>
        </div>
      </div>
    );
  }
  if (!studentData) return <div className="min-h-screen flex items-center justify-center text-gray-600">Loading your progress…</div>;

  // The server now computes these; the JSX below uses them exactly as before.
  const totals = studentData.totals;
  const cohortNumber = studentData.cohortNumber;
  const progressPercentage = parseFloat(totals.total);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 p-4 md:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header with Cohort Info */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-2xl md:text-3xl font-bold text-[#111827] mb-1">
                FUSE Varsity Cohort {cohortNumber}
              </h1>
              <p className="text-gray-600">Welcome back, <span className="font-semibold text-[#0A3DA8]">{studentData?.name}</span></p>
            </div>
            <button
              onClick={logout}
              className="text-sm text-gray-600 hover:text-[#0A3DA8] font-medium transition-colors"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6">
          <div className="flex justify-between items-center mb-3">
            <h2 className="text-lg font-bold text-[#111827]">Overall Progress</h2>
            <span className="text-2xl font-bold text-[#0A3DA8]">{totals.total}%</span>
          </div>
          <div className="relative w-full h-6 bg-gray-200 rounded-full overflow-hidden">
            <div 
              className="absolute top-0 left-0 h-full bg-gradient-to-r from-[#0A3DA8] to-[#FF6600] rounded-full transition-all duration-1000 ease-out"
              style={{ width: `${Math.min(progressPercentage, 100)}%` }}
            ></div>
          </div>
          <div className="flex justify-between mt-2 text-xs text-gray-500">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>

        {/* Grade Card */}
        <div className="bg-gradient-to-r from-[#0A3DA8] to-[#FF6600] rounded-2xl p-6 mb-6 text-white shadow-lg">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-blue-100 text-sm mb-1">Current Grade</p>
              <p className="text-5xl font-bold">{totals.total}%</p>
            </div>
            <div className="text-right">
              <p className="text-blue-100 text-sm mb-1">Letter Grade</p>
              <p className="text-4xl font-bold">{totals.grade}</p>
            </div>
          </div>
        </div>

        {/* Capstone Qualification */}
        <div className={`rounded-2xl p-5 mb-6 flex items-center gap-3 shadow-lg transition-all duration-300 ${
          studentData?.qualifiedForCapstone 
            ? 'bg-green-50 border-2 border-green-300' 
            : 'bg-amber-50 border-2 border-amber-300'
        }`}>
          {studentData?.qualifiedForCapstone ? (
            <>
              <CheckCircle className="text-green-600 flex-shrink-0" size={28} />
              <div>
                <p className="font-bold text-green-800 text-lg">Qualified for Capstone</p>
                <p className="text-sm text-green-700">You are eligible to proceed with the capstone project</p>
              </div>
            </>
          ) : (
            <>
              <AlertCircle className="text-amber-600 flex-shrink-0" size={28} />
              <div>
                <p className="font-bold text-amber-800 text-lg">Not Yet Qualified for Capstone</p>
                <p className="text-sm text-amber-700">Continue working to meet the requirements</p>
              </div>
            </>
          )}
        </div>

        {/* Attendance Section */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 transition-all duration-300 hover:shadow-xl">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="text-[#0A3DA8]" size={24} />
            <h2 className="text-xl font-bold text-[#111827]">Attendance (30% Total)</h2>
          </div>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              {Object.entries(studentData?.attendance || {}).map(([key, value], idx) => (
                <div key={key} className="bg-white p-4 rounded-lg border-2 border-gray-100 hover:border-[#0A3DA8] transition-all duration-200 hover:shadow-md transform hover:-translate-y-1">
                  <p className="text-sm text-gray-600 font-medium">Week {idx + 1}</p>
                  <p className="text-3xl font-bold text-[#0A3DA8]">{value}%</p>
                  <p className="text-xs text-gray-500">of 5%</p>
                </div>
              ))}
            </div>
            <div className="bg-gradient-to-r from-[#0A3DA8] to-blue-600 p-4 rounded-lg text-white">
              <p className="text-sm font-medium opacity-90">Total Attendance</p>
              <p className="text-3xl font-bold">{totals.attendance}%</p>
            </div>
          </div>
        </div>

        {/* Assessment Section */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 transition-all duration-300 hover:shadow-xl">
          <h2 className="text-xl font-bold text-[#111827] mb-4">Assessment Scores (45% Total)</h2>
          <div className="bg-gray-50 rounded-xl p-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
              {[
                { week: 1, score: studentData?.assessments.w1, max: 5 },
                { week: 2, score: studentData?.assessments.w2, max: 10 },
                { week: 3, score: studentData?.assessments.w3, max: 10 },
                { week: 4, score: studentData?.assessments.w4, max: 10 },
                { week: 5, score: studentData?.assessments.w5, max: 10 },
              ].map((item) => (
                <div key={item.week} className="bg-white p-4 rounded-lg border-2 border-gray-100 hover:border-[#FF6600] transition-all duration-200 hover:shadow-md transform hover:-translate-y-1">
                  <p className="text-sm text-gray-600 font-medium">Week {item.week}</p>
                  <p className="text-3xl font-bold text-[#FF6600]">{item.score}%</p>
                  <p className="text-xs text-gray-500">of {item.max}%</p>
                </div>
              ))}
            </div>
            <div className="bg-gradient-to-r from-[#FF6600] to-orange-600 p-4 rounded-lg text-white">
              <p className="text-sm font-medium opacity-90">Total Assessment Score</p>
              <p className="text-3xl font-bold">{totals.assessment}%</p>
            </div>
          </div>
        </div>

        {/* Bonus Section */}
        <div className="bg-white rounded-2xl shadow-lg p-6 mb-6 transition-all duration-300 hover:shadow-xl">
          <div className="flex items-center gap-2 mb-4">
            <Award className="text-[#FF6600]" size={24} />
            <h2 className="text-xl font-bold text-[#111827]">Bonus Sessions (5% Total)</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-5 border-2 border-amber-200 hover:border-[#FF6600] transition-all duration-200 hover:shadow-md transform hover:-translate-y-1">
              <p className="text-sm text-amber-800 font-medium mb-2">LinkedIn Session</p>
              <p className="text-4xl font-bold text-[#FF6600]">{studentData?.linkedinBonus}%</p>
              <p className="text-xs text-amber-700 mt-1">of 2.5%</p>
            </div>
            <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl p-5 border-2 border-amber-200 hover:border-[#FF6600] transition-all duration-200 hover:shadow-md transform hover:-translate-y-1">
              <p className="text-sm text-amber-800 font-medium mb-2">Soft Skills Session</p>
              <p className="text-4xl font-bold text-[#FF6600]">{studentData?.softSkillBonus}%</p>
              <p className="text-xs text-amber-700 mt-1">of 2.5%</p>
            </div>
          </div>
        </div>

        {/* Capstone Section */}
        <div className="bg-white rounded-2xl shadow-lg p-6 transition-all duration-300 hover:shadow-xl">
          <h2 className="text-xl font-bold text-[#111827] mb-4">Capstone Project (20% Total)</h2>
          <div className="bg-gradient-to-br from-indigo-50 to-blue-50 rounded-xl p-6 border-2 border-indigo-200">
            <p className="text-sm text-indigo-800 font-medium mb-3">Capstone Score</p>
            <p className="text-5xl font-bold text-[#0A3DA8]">{studentData?.capstone}%</p>
          </div>
        </div>
      </div>
    </div>
  );
}