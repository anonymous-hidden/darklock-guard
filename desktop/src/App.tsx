import React from 'react';
import { Routes, Route } from 'react-router-dom';
import { Layout } from './components/Layout';
import { ServiceProvider } from './state/service';
import StatusPage from './pages/StatusPage';
import ProtectionPage from './pages/ProtectionPage';
import ScansPage from './pages/ScansPage';
import EventsPage from './pages/EventsPage';
import DeviceControlPage from './pages/DeviceControlPage';
import UpdatesPage from './pages/UpdatesPage';
import SettingsPage from './pages/SettingsPage';
import SupportPage from './pages/SupportPage';
import SetupWizardPage from './pages/SetupWizardPage';

const App: React.FC = () => {
  return (
    <ServiceProvider>
      <Routes>
        <Route path="/setup" element={<SetupWizardPage />} />
        <Route path="/" element={<Layout />}>
          <Route index element={<StatusPage />} />
          <Route path="protection" element={<ProtectionPage />} />
          <Route path="scans" element={<ScansPage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="device-control" element={<DeviceControlPage />} />
          <Route path="updates" element={<UpdatesPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="support" element={<SupportPage />} />
        </Route>
      </Routes>
    </ServiceProvider>
  );
};

export default App;
