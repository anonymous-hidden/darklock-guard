// Sidebar Component

import { icon } from '../lib/icons.js';

export class Sidebar {
  constructor({ store, router }) {
    this.store = store;
    this.router = router;
  }

  render() {
    const state = this.store.getState();
    const currentView = state.currentView;

    const navItems = [
      { id: 'dashboard', path: '/', label: 'Dashboard', icon: 'dashboard' },
      { id: 'files', path: '/files', label: 'Protected Files', icon: 'folder' },
      { id: 'integrity', path: '/integrity', label: 'Integrity Check', icon: 'shieldCheck' },
      { id: 'events', path: '/events', label: 'Event Log', icon: 'activity' },
      { id: 'settings', path: '/settings', label: 'Settings', icon: 'settings' },
    ];

    return `
      <aside class="sidebar">
        <!-- Logo -->
        <div class="px-6 py-5 border-b border-darklock-border">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-lg bg-darklock-accent flex items-center justify-center">
              ${icon('shield', 'w-6 h-6 text-white')}
            </div>
            <div>
              <h1 class="text-lg font-bold text-darklock-text-primary">Darklock</h1>
              <p class="text-xs text-darklock-text-muted">Guard v1.0.0</p>
            </div>
          </div>
        </div>

        <!-- Navigation -->
        <nav class="flex-1 py-4 overflow-y-auto">
          <ul class="space-y-1">
            ${navItems.map(item => this.renderNavItem(item, currentView)).join('')}
          </ul>
        </nav>

        <!-- Status Footer -->
        <div class="p-4 border-t border-darklock-border space-y-3">
          ${this.renderStatusIndicator(state)}
          
          <!-- Logout Button -->
          <button 
            data-action="logout" 
            class="w-full btn-secondary flex items-center justify-center gap-2 text-sm py-2"
          >
            ${icon('logOut', 'w-4 h-4')}
            <span>Logout</span>
          </button>
        </div>
      </aside>
    `;
  }

  renderNavItem(item, currentView) {
    const isActive = currentView === item.id;
    
    return `
      <li>
        <a
          href="#${item.path}"
          data-navigate="${item.path}"
          class="sidebar-item ${isActive ? 'active' : ''}"
        >
          <span class="flex-shrink-0 ${isActive ? 'text-darklock-accent' : ''}">${icon(item.icon)}</span>
          <span>${item.label}</span>
        </a>
      </li>
    `;
  }

  renderStatusIndicator(state) {
    const statusConfig = {
      verified: {
        label: 'All Systems Secure',
        dotClass: 'status-dot-success',
        textClass: 'text-darklock-success',
      },
      compromised: {
        label: 'Integrity Alert',
        dotClass: 'status-dot-error',
        textClass: 'text-darklock-error',
      },
      scanning: {
        label: 'Scanning...',
        dotClass: 'bg-darklock-info animate-pulse',
        textClass: 'text-darklock-info',
      },
      unknown: {
        label: 'Status Unknown',
        dotClass: 'bg-darklock-text-muted',
        textClass: 'text-darklock-text-muted',
      },
    };

    const config = statusConfig[state.integrityStatus] || statusConfig.unknown;

    return `
      <div class="card-elevated p-3">
        <div class="flex items-center gap-3">
          <div class="status-dot ${config.dotClass}"></div>
          <div>
            <p class="text-sm font-medium ${config.textClass}">${config.label}</p>
            ${state.lastScanTime ? `
              <p class="text-xs text-darklock-text-muted">
                Last scan: ${new Date(state.lastScanTime).toLocaleString()}
              </p>
            ` : ''}
          </div>
        </div>
      </div>
    `;
  }
}
