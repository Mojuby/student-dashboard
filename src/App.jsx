import { Navigate, Route, Routes } from 'react-router-dom';
import RequireRole from './auth/RequireRole';
import Login from './pages/Login';
import Claim from './pages/Claim';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import ChangePassword from './pages/ChangePassword';
import LearnerDashboard from './pages/LearnerDashboard';
import LearnerAssessments from './pages/LearnerAssessments';
import FacilitatorHome from './pages/FacilitatorHome';
import AdminLayout from './pages/AdminLayout';
import AdminHome from './pages/AdminHome';
import AdminOnboarding from './pages/AdminOnboarding';
import AdminLearners from './pages/AdminLearners';
import AdminFacilitators from './pages/AdminFacilitators';
import AdminGroups from './pages/AdminGroups';
import AdminSchedule from './pages/AdminSchedule';
import AdminAnalytics from './pages/AdminAnalytics';
import AdminActivity from './pages/AdminActivity';

export default function App() {
  return (
    <Routes>
      {/* public */}
      <Route path="/login" element={<Login role="learner" />} />
      <Route path="/claim" element={<Claim />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
      <Route path="/facilitator/login" element={<Login role="facilitator" />} />
      <Route path="/facilitator/signup" element={<Claim />} />
      <Route path="/admin/login" element={<Login role="admin" />} />
      <Route path="/change-password" element={<ChangePassword />} />

      {/* learner */}
      <Route path="/" element={<RequireRole role="learner" loginPath="/login"><LearnerDashboard /></RequireRole>} />
      <Route path="/assessments" element={<RequireRole role="learner" loginPath="/login"><LearnerAssessments /></RequireRole>} />

      {/* facilitator */}
      <Route path="/facilitator" element={<RequireRole role="facilitator" loginPath="/facilitator/login"><FacilitatorHome /></RequireRole>} />

      {/* admin: every page sits under one guard and one navigation bar */}
      <Route path="/admin" element={<RequireRole role="admin" loginPath="/admin/login"><AdminLayout /></RequireRole>}>
        <Route index element={<AdminHome />} />
        <Route path="onboarding" element={<AdminOnboarding />} />
        <Route path="learners" element={<AdminLearners />} />
        <Route path="facilitators" element={<AdminFacilitators />} />
        <Route path="groups" element={<AdminGroups />} />
        <Route path="schedule" element={<AdminSchedule />} />
        <Route path="analytics" element={<AdminAnalytics />} />
        <Route path="activity" element={<AdminActivity />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
