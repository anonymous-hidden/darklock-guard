import { Routes, Route } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import Layout from './components/Layout';
import LandingPage from './pages/LandingPage';
import DownloadPage from './pages/DownloadPage';
import DocsPage from './pages/DocsPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import DashboardPage from './pages/dashboard/DashboardPage';
import DevicesPage from './pages/dashboard/DevicesPage';
import DeviceDetailPage from './pages/dashboard/DeviceDetailPage';
import LogsPage from './pages/dashboard/LogsPage';
import SettingsPage from './pages/dashboard/SettingsPage';
import AdminPage from './pages/admin/AdminPage';
import ProtectedRoute from './components/ProtectedRoute';
import AdminRoute from './components/AdminRoute';

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        {/* Public pages */}
        <Route element={<Layout />}>
          <Route path="/" element={<LandingPage />} />
          <Route path="/download" element={<DownloadPage />} />
          <Route path="/docs" element={<DocsPage />} />
        </Route>

        {/* Auth pages */}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        {/* Dashboard (protected) */}
        <Route element={<ProtectedRoute />}>
          <Route element={<Layout variant="dashboard" />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/dashboard/devices" element={<DevicesPage />} />
            <Route path="/dashboard/devices/:id" element={<DeviceDetailPage />} />
            <Route path="/dashboard/logs" element={<LogsPage />} />
            <Route path="/dashboard/settings" element={<SettingsPage />} />
          </Route>
        </Route>

        {/* Admin (admin-only) */}
        <Route element={<AdminRoute />}>
          <Route element={<Layout variant="dashboard" />}>
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  );
}
