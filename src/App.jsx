import { Navigate, Route, Routes } from 'react-router-dom';
import RequireRole from './auth/RequireRole';
import Login from './pages/Login';
import Claim from './pages/Claim';
import ChangePassword from './pages/ChangePassword';
import LearnerDashboard from './pages/LearnerDashboard';
import FacilitatorHome from './pages/FacilitatorHome';
import AdminHome from './pages/AdminHome';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login role="learner" />} />
      <Route path="/claim" element={<Claim />} />
      <Route path="/facilitator/login" element={<Login role="facilitator" />} />
      <Route path="/facilitator/signup" element={<Claim />} />
      <Route path="/admin/login" element={<Login role="admin" />} />
      <Route path="/change-password" element={<ChangePassword />} />

      <Route path="/" element={<RequireRole role="learner" loginPath="/login"><LearnerDashboard /></RequireRole>} />
      <Route path="/facilitator" element={<RequireRole role="facilitator" loginPath="/facilitator/login"><FacilitatorHome /></RequireRole>} />
      <Route path="/admin" element={<RequireRole role="admin" loginPath="/admin/login"><AdminHome /></RequireRole>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}