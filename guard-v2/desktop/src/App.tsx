import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { invoke } from '@tauri-apps/api/core';
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
import { OnboardingPage } from './onboarding';
import UnlockPage from './pages/UnlockPage';
import {
  isStrictModeEnabled,
  isAppUnlocked,
  setAppUnlocked,
  verifyStrictModePassword,
} from './utils/strictMode';

/**
 * First-run detection.
 * Checks: 1) localStorage flag, 2) vault existence via Tauri command.
 * Returns true if onboarding is needed.
 */
function useNeedsOnboarding(): { loading: boolean; needsOnboarding: boolean } {
  const [loading, setLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    const check = async () => {
      // Require both a stored auth token AND completed onboarding flag.
      // If either is missing the user must log in / complete setup.
      const authToken = localStorage.getItem('darklock_auth_token');
      const onboardingComplete = localStorage.getItem('darklock_onboarding_complete') === 'true';

      if (authToken && onboardingComplete) {
        setNeedsOnboarding(false);
        setLoading(false);
        return;
      }

      // No valid session — show login / onboarding
      setNeedsOnboarding(true);
      setLoading(false);
    };
    check();
  }, []);

  return { loading, needsOnboarding };
}

/** Loading screen while checking first-run state */
const StartupLoader: React.FC = () => (
  <div className="min-h-screen bg-bg-primary flex items-center justify-center">
    <div className="text-center">
      <div className="w-10 h-10 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin mx-auto mb-4" />
      <p className="text-xs text-text-muted">Starting Darklock Guard…</p>
    </div>
  </div>
);

/** Route guard that redirects to /setup if onboarding is needed */
const OnboardingGate: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { loading, needsOnboarding } = useNeedsOnboarding();
  const location = useLocation();

  if (loading) return <StartupLoader />;

  // If onboarding is needed and user isn't on /setup, redirect
  if (needsOnboarding && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }

  // If onboarding is done and user navigates to /setup, redirect to dashboard
  if (!needsOnboarding && location.pathname === '/setup') {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

const App: React.FC = () => {
  const [locked, setLocked] = useState(false);
  const [checkingLock, setCheckingLock] = useState(true);

  useEffect(() => {
    // Always clear unlock status on app startup to ensure password is required
    setAppUnlocked(false);
    
    // Check if strict mode is enabled and app is locked
    const needsUnlock = isStrictModeEnabled();
    setLocked(needsUnlock);
    setCheckingLock(false);

    // Clear unlock status when app closes (backup mechanism)
    const handleBeforeUnload = () => {
      setAppUnlocked(false);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, []);

  const handleUnlock = async (password: string) => {
    const valid = await verifyStrictModePassword(password);
    if (!valid) {
      throw new Error('Incorrect password');
    }
    setAppUnlocked(true);
    setLocked(false);
  };

  // Show loading screen while checking lock status
  if (checkingLock) {
    return (
      <div className="min-h-screen bg-bg-primary flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 border-2 border-accent-primary/30 border-t-accent-primary rounded-full animate-spin mx-auto mb-4" />
          <p className="text-xs text-text-muted">Starting Darklock Guard…</p>
        </div>
      </div>
    );
  }

  // Show unlock screen if locked
  if (locked) {
    return <UnlockPage onUnlock={handleUnlock} />;
  }

  return (
    <ServiceProvider>
      <OnboardingGate>
        <Routes>
          <Route path="/setup" element={<OnboardingPage />} />
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
      </OnboardingGate>
    </ServiceProvider>
  );
};

export default App;
