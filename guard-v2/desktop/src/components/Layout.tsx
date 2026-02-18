import React from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Lock, ScanLine, Activity, MonitorSmartphone, Download, Settings, HelpCircle, Wifi, WifiOff, Zap, LogOut } from 'lucide-react';
import { useService } from '../state/service';
import { StatusBadge } from './StatusBadge';
import { DarklockLogo } from './DarklockLogo';
import { invoke } from '@tauri-apps/api/core';

const navItems = [
  { to: '/', label: 'Status', icon: DarklockLogo },
  { to: '/protection', label: 'Protection', icon: Lock },
  { to: '/scans', label: 'Scans', icon: ScanLine },
  { to: '/events', label: 'Events', icon: Activity },
  { to: '/device-control', label: 'Device', icon: MonitorSmartphone },
  { to: '/updates', label: 'Updates', icon: Download },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/support', label: 'Support', icon: HelpCircle },
];

const pageLabels: Record<string, string> = {
  '/': 'Dashboard',
  '/protection': 'Protection Settings',
  '/scans': 'Integrity Scans',
  '/events': 'Event Log',
  '/device-control': 'Device Control',
  '/updates': 'Software Updates',
  '/settings': 'Configuration',
  '/support': 'Support & Diagnostics',
};

export const Layout: React.FC = () => {
  const { status, serviceAvailable } = useService();
  const location = useLocation();
  const currentLabel = pageLabels[location.pathname] || 'Darklock Guard';

  const handleLogout = async () => {
    if (confirm('Lock vault and exit Darklock Guard?\n\nYou\'ll need to re-enter your password when you restart the app.')) {
      try {
        await invoke('lock_vault');
      } catch (error) {
        console.error('Failed to lock vault:', error);
      }
    }
  };

  return (
    <div className="flex h-screen bg-bg-primary text-text-primary overflow-hidden">
      {/* Sidebar */}
      <aside className="w-56 bg-bg-secondary/80 border-r border-white/5 flex flex-col backdrop-blur-sm">
        {/* Logo */}
        <div className="h-14 px-4 flex items-center gap-2.5 border-b border-white/5">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center">
            <DarklockLogo size={28} />
          </div>
          <div>
            <p className="text-sm font-bold tracking-tight">Darklock</p>
            <p className="text-[10px] text-text-muted -mt-0.5 font-medium">GUARD v2</p>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-2 py-3 space-y-0.5 overflow-y-auto scrollbar-thin">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-accent-primary/10 text-accent-primary border border-accent-primary/20 shadow-sm shadow-accent-primary/5'
                      : 'text-text-secondary hover:text-text-primary hover:bg-white/[0.03]'
                  }`
                }
              >
                <Icon size={16} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="px-3 py-3 border-t border-white/5 space-y-1.5">
          <div className="flex items-center gap-2 text-[11px]">
            {serviceAvailable ? (
              <>
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-semantic-success opacity-50"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-semantic-success"></span>
                </span>
                <span className="text-semantic-success font-medium">Service Connected</span>
              </>
            ) : (
              <>
                <span className="h-2 w-2 rounded-full bg-semantic-error"></span>
                <span className="text-semantic-error font-medium">Service Unavailable</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
            <Zap size={10} />
            <span>Beta v2.0.0</span>
          </div>
          
          {/* Logout Button */}
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-all duration-150 text-text-secondary hover:text-semantic-error hover:bg-semantic-error/10 border border-transparent hover:border-semantic-error/20 mt-2"
            title="Lock vault and exit"
          >
            <LogOut size={14} />
            <span>Lock & Exit</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 border-b border-white/5 flex items-center justify-between px-5 bg-bg-primary/90 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-text-primary">{currentLabel}</h1>
          </div>
          <StatusBadge status={status} serviceAvailable={serviceAvailable} />
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto scrollbar-thin">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
