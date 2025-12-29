import React, { useState } from 'react';
import { AlertCircle, CheckCircle, TrendingUp, Award } from 'lucide-react';

const StudentDashboard = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [studentData, setStudentData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchStudentData = async (studentEmail, studentPassword) => {
    setLoading(true);
    setError('');
    
    try {
      // Call backend API instead of directly accessing Google Sheets
      const response = await fetch('/api/get-student-data', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: studentEmail,
          password: studentPassword
        })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch data');
      }

      setStudentData(data);
      setIsLoggedIn(true);
    } catch (err) {
      setError(err.message || 'Failed to login');
      setIsLoggedIn(false);
    } finally {
      setLoading(false);
    }
  };

  const handleLogin = () => {
    if (!email || !password) {
      setError('Please enter email and password');
      return;
    }
    fetchStudentData(email, password);
  };

  const calculateTotals = () => {
    if (!studentData) return { attendance: 0, assessment: 0, bonus: 0, total: 0, grade: 'N/A' };
    
    const attendanceTotal = Object.values(studentData.attendance).reduce((sum, val) => sum + val, 0);
    const assessmentTotal = Object.values(studentData.assessments).reduce((sum, val) => sum + val, 0);
    const bonusTotal = studentData.linkedinBonus + studentData.softSkillBonus;
    const total = attendanceTotal + assessmentTotal + bonusTotal + studentData.capstone;
    
    let grade = 'Fail';
    if (total >= 70) grade = 'A';
    else if (total >= 50) grade = 'B';
    else if (total >= 40) grade = 'C';
    
    return { 
      attendance: attendanceTotal,
      assessment: assessmentTotal,
      bonus: bonusTotal, 
      total: total.toFixed(2), 
      grade 
    };
  };

  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Student Dashboard</h1>
            <p className="text-gray-600">Login to view your progress</p>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="your.email@example.com"
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                disabled={loading}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Password (Your Stack)</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Enter your stack"
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                disabled={loading}
              />
            </div>
            
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            
            <button
              onClick={handleLogin}
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your progress...</p>
        </div>
      </div>
    );
  }

  const totals = calculateTotals();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-6 md:p-8">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h1 className="text-3xl font-bold text-gray-800">Welcome, {studentData?.name}</h1>
              <p className="text-gray-600">{studentData?.email}</p>
              <p className="text-sm text-gray-500 mt-1">Stack: {studentData?.stack}</p>
            </div>
            <button
              onClick={() => {
                setIsLoggedIn(false);
                setStudentData(null);
                setEmail('');
                setPassword('');
              }}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              Logout
            </button>
          </div>

          {/* Total Grade */}
          <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg p-6 mb-6 text-white">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-blue-100 text-sm mb-1">Total Grade</p>
                <p className="text-5xl font-bold">{totals.total}%</p>
              </div>
              <div className="text-right">
                <p className="text-blue-100 text-sm mb-1">Final Grade</p>
                <p className="text-4xl font-bold">{totals.grade}</p>
              </div>
            </div>
          </div>

          {/* Capstone Qualification */}
          <div className={`rounded-lg p-4 mb-6 flex items-center gap-3 ${
            studentData?.qualifiedForCapstone 
              ? 'bg-green-50 border border-green-200' 
              : 'bg-amber-50 border border-amber-200'
          }`}>
            {studentData?.qualifiedForCapstone ? (
              <>
                <CheckCircle className="text-green-600" size={24} />
                <div>
                  <p className="font-semibold text-green-800">Qualified for Capstone</p>
                  <p className="text-sm text-green-700">You are eligible to proceed with the capstone project</p>
                </div>
              </>
            ) : (
              <>
                <AlertCircle className="text-amber-600" size={24} />
                <div>
                  <p className="font-semibold text-amber-800">Not Yet Qualified for Capstone</p>
                  <p className="text-sm text-amber-700">Continue working to meet the requirements</p>
                </div>
              </>
            )}
          </div>

          {/* Attendance Section */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <TrendingUp className="text-blue-600" size={20} />
              <h2 className="text-xl font-bold text-gray-800">Attendance (30% Total)</h2>
            </div>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                {Object.entries(studentData?.attendance || {}).map(([key, value], idx) => (
                  <div key={key} className="bg-white p-3 rounded-lg border border-gray-200">
                    <p className="text-sm text-gray-600">Week {idx + 1}</p>
                    <p className="text-2xl font-bold text-gray-800">{value}%</p>
                    <p className="text-xs text-gray-500">of 5%</p>
                  </div>
                ))}
              </div>
              <div className="bg-blue-100 p-3 rounded-lg">
                <p className="text-sm text-blue-800 font-medium">Total Attendance</p>
                <p className="text-3xl font-bold text-blue-900">{totals.attendance}%</p>
              </div>
            </div>
          </div>

          {/* Assessment Section */}
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Assessment Scores (45% Total)</h2>
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                <div className="bg-white p-3 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-600">Week 1</p>
                  <p className="text-2xl font-bold text-gray-800">{studentData?.assessments.w1}%</p>
                  <p className="text-xs text-gray-500">of 5%</p>
                </div>
                <div className="bg-white p-3 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-600">Week 2</p>
                  <p className="text-2xl font-bold text-gray-800">{studentData?.assessments.w2}%</p>
                  <p className="text-xs text-gray-500">of 10%</p>
                </div>
                <div className="bg-white p-3 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-600">Week 3</p>
                  <p className="text-2xl font-bold text-gray-800">{studentData?.assessments.w3}%</p>
                  <p className="text-xs text-gray-500">of 10%</p>
                </div>
                <div className="bg-white p-3 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-600">Week 4</p>
                  <p className="text-2xl font-bold text-gray-800">{studentData?.assessments.w4}%</p>
                  <p className="text-xs text-gray-500">of 10%</p>
                </div>
                <div className="bg-white p-3 rounded-lg border border-gray-200">
                  <p className="text-sm text-gray-600">Week 5</p>
                  <p className="text-2xl font-bold text-gray-800">{studentData?.assessments.w5}%</p>
                  <p className="text-xs text-gray-500">of 10%</p>
                </div>
              </div>
              <div className="bg-purple-100 p-3 rounded-lg">
                <p className="text-sm text-purple-800 font-medium">Total Assessment Score</p>
                <p className="text-3xl font-bold text-purple-900">{totals.assessment}%</p>
              </div>
            </div>
          </div>

          {/* Bonus Section */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <Award className="text-amber-600" size={20} />
              <h2 className="text-xl font-bold text-gray-800">Bonus Sessions (5% Total)</h2>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                <p className="text-sm text-amber-800 font-medium">LinkedIn Session</p>
                <p className="text-3xl font-bold text-amber-900">{studentData?.linkedinBonus}%</p>
                <p className="text-xs text-amber-700">of 2.5%</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
                <p className="text-sm text-amber-800 font-medium">Soft Skills Session</p>
                <p className="text-3xl font-bold text-amber-900">{studentData?.softSkillBonus}%</p>
                <p className="text-xs text-amber-700">of 2.5%</p>
              </div>
            </div>
          </div>

          {/* Capstone Section */}
          <div>
            <h2 className="text-xl font-bold text-gray-800 mb-4">Capstone Project (20% Total)</h2>
            <div className="bg-indigo-50 rounded-lg p-4 border border-indigo-200">
              <p className="text-sm text-indigo-800 font-medium mb-2">Capstone Score</p>
              <p className="text-4xl font-bold text-indigo-900">{studentData?.capstone}%</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StudentDashboard;