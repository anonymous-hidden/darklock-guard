import React from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Shield, Lock, ScanLine, ListOrdered, MonitorSmartphone, Download, Settings, HelpCircle, WifiOff, Zap } from 'lucide-react';
import { useService } from '../state/service';
import { StatusBadge } from './StatusBadge';
import { DarklockLogo } from './DarklockLogo';

const navItems = [
  { to: '/', label: 'Status', icon: Shield },
  { to: '/protection', label: 'Protection', icon: Lock },
  { to: '/scans', label: 'Scans', icon: ScanLine },
  { to: '/events', label: 'Events', icon: ListOrdered },
  { to: '/device-control', label: 'Device Control', icon: MonitorSmartphone },
  { to: '/updates', label: 'Updates', icon: Download },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/support', label: 'Support', icon: HelpCircle },
];

export const Layout: React.FC = () => {
  const { status, serviceAvailable } = useService();

  return (
    <div className="flex h-screen bg-bg-primary text-text-primary">
      <aside className="w-60 bg-bg-secondary border-r border-[rgba(148,163,184,0.1)] flex flex-col">
        <div className="p-4 text-lg font-semibold flex items-center gap-2">
          <DarklockLogo size={20} className="flex-shrink-0" />
          Darklock Guard
        </div>
        <nav className="flex-1 px-2 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition ${
                    isActive ? 'bg-bg-tertiary text-text-primary border border-[rgba(0,240,255,0.2)]' : 'text-text-secondary hover:bg-bg-tertiary'
                  }`
                }
              >
                <Icon size={18} />
                {item.label}
              </NavLink>
            );
          })}
        </nav>
        <div className="p-3 text-xs text-text-muted border-t border-[rgba(148,163,184,0.1)]">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-warning" />
            Beta v2.0.0
          </div>
          <div className="flex items-center gap-2 mt-1 text-[11px]">
            <WifiOff size={14} />
            {serviceAvailable ? 'Connected to service' : 'Service unavailable'}
          </div>
        </div>
      </aside>
      <div className="flex-1 flex flex-col">
        <header className="h-14 border-b border-[rgba(148,163,184,0.1)] flex items-center justify-between px-4 bg-bg-primary/80 backdrop-blur">
          <div className="text-sm text-text-secondary">Darklock Guard v2</div>
          <StatusBadge status={status} serviceAvailable={serviceAvailable} />
        </header>
        <main className="flex-1 overflow-y-auto bg-bg-primary">
          <Outlet />
        </main>
      </div>
    </div>
  );
};
