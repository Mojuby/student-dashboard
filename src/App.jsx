import React, { useState } from 'react';
import { AlertCircle, CheckCircle, TrendingUp, Award, BookOpen, Eye, EyeOff } from 'lucide-react';

const StudentDashboard = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [studentData, setStudentData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [cohortNumber, setCohortNumber] = useState('6');

  // BAD OLD CODE

  // const fetchStudentData = async (studentEmail, studentPassword) => {
  //   setLoading(true);
  //   setError('');
    
  //   try {
  //     const url = `https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/${RANGE}?key=${API_KEY}`;
  //     const response = await fetch(url);
  //     const data = await response.json();
      
  //     if (!data.values) {
  //       throw new Error('No data found in sheet');
  //     }

  //     // Extract cohort number from sheet name
  //     const cohortMatch = RANGE.match(/Cohort (\d+)/i);
  //     if (cohortMatch) {
  //       setCohortNumber(cohortMatch[1]);
  //     }

  //     // Find student row (email is in column B, index 1)
  //     //const headers = data.values[0];
  //     const studentRow = data.values.find(row => row[1]?.toLowerCase().trim() === studentEmail.toLowerCase().trim());
      
  //     if (!studentRow) {
  //       throw new Error('Student not found');
  //     }

  //     // Verify password matches stack (column C, index 2)
  //     const studentStack = studentRow[2]?.toLowerCase() || '';
  //     if (studentStack !== studentPassword.toLowerCase()) {
  //       throw new Error('Invalid password');
  //     }

  //     // Parse student data based on your column structure
  //     const parsed = {
  //       name: studentRow[0] || 'Student',
  //       email: studentRow[1],
  //       stack: studentRow[2] || '',
  //       attendance: {
  //         class1: parseFloat(studentRow[3]) || 0,
  //         class2: parseFloat(studentRow[4]) || 0,
  //         class3: parseFloat(studentRow[5]) || 0,
  //         class4: parseFloat(studentRow[6]) || 0,
  //         class5: parseFloat(studentRow[7]) || 0,
  //         class6: parseFloat(studentRow[8]) || 0,
  //       },
  //       assessments: {
  //         w1: parseFloat(studentRow[9]) || 0,
  //         w2: parseFloat(studentRow[10]) || 0,
  //         w3: parseFloat(studentRow[11]) || 0,
  //         w4: parseFloat(studentRow[12]) || 0,
  //         w5: parseFloat(studentRow[13]) || 0,
  //       },
  //       softSkillBonus: parseFloat(studentRow[14]) || 0,
  //       linkedinBonus: parseFloat(studentRow[15]) || 0,
  //       capstone: parseFloat(studentRow[16]) || 0,
  //       totalGrade: parseFloat(studentRow[17]) || 0,
  //       finalGrade: studentRow[18] || '',
  //       qualifiedForCapstone: studentRow[19]?.toUpperCase().trim() === 'QUALIFIED'
  //     };

  //     setStudentData(parsed);
  //   } catch (err) {
  //     setError(err.message || 'Failed to fetch data');
  //     setIsLoggedIn(false);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

const fetchStudentData = async (studentEmail, studentPassword) => {
  setLoading(true);
  setError('');
  
  try {
    const response = await fetch('https://student-dashboard-0sdq.onrender.com/api/student-data', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: studentEmail,
        password: studentPassword,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to fetch data');
    }

    const data = await response.json();
    setStudentData(data);
    setCohortNumber(data.cohortNumber || '6');
  } catch (err) {
    setError(err.message || 'Failed to fetch data');
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
    setIsLoggedIn(true);
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
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl p-8 w-full max-w-md">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-gradient-to-br from-[#0A3DA8] to-[#FF6600] rounded-full mx-auto mb-4 flex items-center justify-center">
              <BookOpen className="text-white" size={32} />
            </div>
            <h1 className="text-3xl font-bold text-[#111827] mb-2">Student Dashboard</h1>
            <p className="text-gray-600">Login to view your progress</p>
          </div>
          
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A3DA8] focus:border-transparent transition-all duration-200"
                placeholder="your.email@example.com"
                onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-[#111827] mb-2">Password (Your Stack)</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded-lg focus:ring-2 focus:ring-[#0A3DA8] focus:border-transparent transition-all duration-200"
                  placeholder="Enter your stack"
                  onKeyPress={(e) => e.key === 'Enter' && handleLogin()}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-[#0A3DA8] transition-colors"
                >
                  {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                </button>
              </div>
            </div>
            
            {error && (
              <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
                <AlertCircle size={16} />
                {error}
              </div>
            )}
            
            <button
              onClick={handleLogin}
              className="w-full bg-gradient-to-r from-[#0A3DA8] to-[#FF6600] text-white py-3 rounded-lg hover:shadow-lg transform hover:-translate-y-0.5 transition-all duration-200 font-semibold"
            >
              Login
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="w-20 h-20 border-4 border-gray-200 rounded-full"></div>
            <div className="w-20 h-20 border-4 border-[#0A3DA8] border-t-transparent rounded-full animate-spin absolute top-0 left-0"></div>
          </div>
          <p className="text-gray-600 mt-4 font-medium">Loading your progress...</p>
        </div>
      </div>
    );
  }

  const totals = calculateTotals();
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
              onClick={() => setIsLoggedIn(false)}
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
            <h2 className="text-xl font-bold text-[#111827]">Attendance (25% Total)</h2>
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
};

export default StudentDashboard;