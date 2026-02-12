import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  Shield,
  Download,
  BookOpen,
  LayoutDashboard,
  Monitor,
  ScrollText,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useState } from 'react';

const publicNav = [
  { to: '/', label: 'Home', icon: Shield },
  { to: '/download', label: 'Download', icon: Download },
  { to: '/docs', label: 'Docs', icon: BookOpen },
];

const dashboardNav = [
  { to: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { to: '/dashboard/devices', label: 'Devices', icon: Monitor },
  { to: '/dashboard/logs', label: 'Logs', icon: ScrollText },
  { to: '/dashboard/settings', label: 'Settings', icon: Settings },
];

export default function Layout({ variant }: { variant?: 'dashboard' }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const isDashboard = variant === 'dashboard';
  const navItems = isDashboard ? dashboardNav : publicNav;

  return (
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-dark-950/80 backdrop-blur-xl border-b border-dark-800/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            {/* Logo */}
            <Link to={isDashboard ? '/dashboard' : '/'} className="flex items-center gap-3 group">
              <div className="w-9 h-9 rounded-xl bg-brand-600 flex items-center justify-center shadow-lg shadow-brand-600/20 group-hover:shadow-brand-500/30 transition-all">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <span className="text-lg font-bold tracking-tight">
                Darklock <span className="text-brand-400">Guard</span>
              </span>
            </Link>

            {/* Desktop Nav */}
            <nav className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const active = location.pathname === item.to;
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      active
                        ? 'bg-brand-600/10 text-brand-400'
                        : 'text-dark-400 hover:text-white hover:bg-dark-800/50'
                    }`}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            {/* Actions */}
            <div className="hidden md:flex items-center gap-3">
              {user ? (
                <>
                  {!isDashboard && (
                    <Link to="/dashboard" className="btn-ghost text-sm">
                      <LayoutDashboard className="w-4 h-4" />
                      Dashboard
                    </Link>
                  )}
                  <span className="text-sm text-dark-400">{user.username}</span>
                  <button
                    onClick={() => logout()}
                    className="btn-ghost text-sm text-dark-400 hover:text-red-400"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </>
              ) : (
                <>
                  <Link to="/login" className="btn-ghost text-sm">
                    Sign In
                  </Link>
                  <Link to="/register" className="btn-primary text-sm !py-2 !px-4">
                    Get Started
                  </Link>
                </>
              )}
            </div>

            {/* Mobile Toggle */}
            <button
              className="md:hidden btn-ghost"
              onClick={() => setMobileOpen(!mobileOpen)}
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile Nav */}
        {mobileOpen && (
          <div className="md:hidden border-t border-dark-800/50 bg-dark-950/95 backdrop-blur-xl">
            <div className="px-4 py-3 space-y-1">
              {navItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-dark-300 hover:text-white hover:bg-dark-800/50"
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </Link>
              ))}
              <div className="pt-2 border-t border-dark-800/50">
                {user ? (
                  <button onClick={() => { logout(); setMobileOpen(false); }} className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-red-400">
                    <LogOut className="w-4 h-4" /> Sign Out
                  </button>
                ) : (
                  <Link to="/login" onClick={() => setMobileOpen(false)} className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-brand-400">
                    Sign In
                  </Link>
                )}
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main */}
      <main className="flex-1">
        <Outlet />
      </main>

      {/* Footer (public pages only) */}
      {!isDashboard && (
        <footer className="border-t border-dark-800/50 bg-dark-950">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
              <div>
                <div className="flex items-center gap-2 mb-4">
                  <Shield className="w-5 h-5 text-brand-500" />
                  <span className="font-bold">Darklock Guard</span>
                </div>
                <p className="text-sm text-dark-400 leading-relaxed">
                  Tamper-proof integrity protection for your critical systems. Detect unauthorized changes before they cause damage.
                </p>
              </div>
              <div>
                <h4 className="font-semibold text-dark-200 mb-3 text-sm uppercase tracking-wide">Product</h4>
                <div className="space-y-2">
                  <Link to="/download" className="block text-sm text-dark-400 hover:text-white transition-colors">Download</Link>
                  <Link to="/docs" className="block text-sm text-dark-400 hover:text-white transition-colors">Documentation</Link>
                  <a href="#features" className="block text-sm text-dark-400 hover:text-white transition-colors">Features</a>
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-dark-200 mb-3 text-sm uppercase tracking-wide">Platform</h4>
                <div className="space-y-2">
                  <Link to="/login" className="block text-sm text-dark-400 hover:text-white transition-colors">Sign In</Link>
                  <Link to="/register" className="block text-sm text-dark-400 hover:text-white transition-colors">Create Account</Link>
                  <Link to="/dashboard" className="block text-sm text-dark-400 hover:text-white transition-colors">Dashboard</Link>
                </div>
              </div>
              <div>
                <h4 className="font-semibold text-dark-200 mb-3 text-sm uppercase tracking-wide">Security</h4>
                <div className="space-y-2">
                  <span className="block text-sm text-dark-400">End-to-end encrypted</span>
                  <span className="block text-sm text-dark-400">Zero-knowledge architecture</span>
                  <span className="block text-sm text-dark-400">Open audit trail</span>
                </div>
              </div>
            </div>
            <div className="mt-8 pt-8 border-t border-dark-800/50 text-center text-sm text-dark-500">
              &copy; {new Date().getFullYear()} Darklock Security. All rights reserved.
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}
