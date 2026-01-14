// Dashboard View Component

import { icon } from '../../lib/icons.js';
import { timeAgo, truncatePath, getStatusClasses } from '../../lib/utils.js';

export class Dashboard {
  constructor({ store, api }) {
    this.store = store;
    this.api = api;
  }

  render() {
    const state = this.store.getState();

    return `
      <div class="space-y-6">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-darklock-text-primary">Dashboard</h2>
            <p class="text-darklock-text-secondary mt-1">Monitor your file integrity status</p>
          </div>
          <button data-action="scan" class="btn btn-primary flex items-center gap-2">
            ${icon('refresh')}
            <span>Run Scan</span>
          </button>
        </div>

        <!-- Stats Grid -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          ${this.renderStatCard('Protected Paths', state.protectedPaths.length, 'folder', 'bg-darklock-accent-subtle text-darklock-accent')}
          ${this.renderStatCard('Total Files', this.getTotalFiles(state), 'file', 'bg-darklock-info-bg text-darklock-info')}
          ${this.renderStatCard('Last Scan', state.lastScanTime ? timeAgo(state.lastScanTime) : 'Never', 'clock', 'bg-darklock-warning-bg text-darklock-warning')}
          ${this.renderStatCard('Status', this.formatStatus(state.integrityStatus), 'shieldCheck', this.getStatusIconBg(state.integrityStatus))}
        </div>

        <!-- Main Content Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Protected Paths -->
          <div class="lg:col-span-2">
            ${this.renderProtectedPaths(state)}
          </div>

          <!-- Quick Actions -->
          <div class="space-y-6">
            ${this.renderQuickActions()}
            ${this.renderIntegrityStatus(state)}
          </div>
        </div>
      </div>
    `;
  }

  renderStatCard(label, value, iconName, iconBg) {
    return `
      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="stat-value">${value}</p>
            <p class="stat-label">${label}</p>
          </div>
          <div class="stat-icon ${iconBg}">
            ${icon(iconName, 'w-6 h-6')}
          </div>
        </div>
      </div>
    `;
  }

  renderProtectedPaths(state) {
    const paths = state.protectedPaths;

    return `
      <div class="card">
        <div class="px-6 py-4 border-b border-darklock-border flex items-center justify-between">
          <h3 class="text-lg font-semibold">Protected Paths</h3>
          <button data-action="add-path" class="btn-icon" title="Add Path">
            ${icon('plus')}
          </button>
        </div>
        
        ${paths.length === 0 ? `
          <div class="p-8 text-center">
            <div class="w-16 h-16 mx-auto rounded-full bg-darklock-bg-hover flex items-center justify-center mb-4">
              ${icon('folder', 'w-8 h-8 text-darklock-text-muted')}
            </div>
            <p class="text-darklock-text-secondary mb-4">No protected paths configured</p>
            <button data-action="add-path" class="btn btn-primary">
              Add Protected Path
            </button>
          </div>
        ` : `
          <ul class="divide-y divide-darklock-border">
            ${paths.map(p => this.renderPathItem(p)).join('')}
          </ul>
        `}
      </div>
    `;
  }

  renderPathItem(path) {
    const statusClass = getStatusClasses(path.status);
    
    return `
      <li class="px-6 py-4 hover:bg-darklock-bg-hover transition-colors">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3 min-w-0">
            <div class="flex-shrink-0">
              ${icon('folderOpen', 'w-5 h-5 text-darklock-accent')}
            </div>
            <div class="min-w-0">
              <p class="text-sm font-medium text-darklock-text-primary truncate" title="${path.path}">
                ${truncatePath(path.path, 40)}
              </p>
              <p class="text-xs text-darklock-text-muted">
                ${path.fileCount} files
              </p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="badge ${statusClass}">${path.status}</span>
            <button 
              data-action="remove-path" 
              data-path-id="${path.id}"
              class="btn-icon text-darklock-text-muted hover:text-darklock-error"
              title="Remove"
            >
              ${icon('trash', 'w-4 h-4')}
            </button>
          </div>
        </div>
      </li>
    `;
  }

  renderQuickActions() {
    return `
      <div class="card p-6">
        <h3 class="text-lg font-semibold mb-4">Quick Actions</h3>
        <div class="space-y-3">
          <button data-action="scan" class="w-full btn btn-secondary flex items-center gap-3">
            ${icon('refresh')}
            <span>Full Integrity Scan</span>
          </button>
          <button data-action="add-path" class="w-full btn btn-secondary flex items-center gap-3">
            ${icon('plus')}
            <span>Add Protected Path</span>
          </button>
          <button data-action="export-report" class="w-full btn btn-secondary flex items-center gap-3">
            ${icon('download')}
            <span>Export Report</span>
          </button>
          <button data-action="verify-chain" class="w-full btn btn-secondary flex items-center gap-3">
            ${icon('hash')}
            <span>Verify Event Chain</span>
          </button>
        </div>
      </div>
    `;
  }

  renderIntegrityStatus(state) {
    const statusConfig = {
      verified: {
        title: 'All Files Verified',
        description: 'No integrity violations detected',
        icon: 'shieldCheck',
        bgClass: 'bg-darklock-success-bg border-darklock-success/30',
        iconClass: 'text-darklock-success',
      },
      compromised: {
        title: 'Integrity Alert',
        description: 'File modifications detected',
        icon: 'shieldAlert',
        bgClass: 'bg-darklock-error-bg border-darklock-error/30',
        iconClass: 'text-darklock-error',
      },
      scanning: {
        title: 'Scanning...',
        description: 'Verifying file integrity',
        icon: 'loader',
        bgClass: 'bg-darklock-info-bg border-darklock-info/30',
        iconClass: 'text-darklock-info',
      },
      unknown: {
        title: 'Status Unknown',
        description: 'Run a scan to check integrity',
        icon: 'shield',
        bgClass: 'bg-darklock-bg-hover border-darklock-border',
        iconClass: 'text-darklock-text-muted',
      },
    };

    const config = statusConfig[state.integrityStatus] || statusConfig.unknown;

    return `
      <div class="card p-6 ${config.bgClass} border">
        <div class="flex items-center gap-4">
          <div class="flex-shrink-0">
            ${icon(config.icon, `w-8 h-8 ${config.iconClass}`)}
          </div>
          <div>
            <h4 class="font-semibold">${config.title}</h4>
            <p class="text-sm text-darklock-text-secondary">${config.description}</p>
          </div>
        </div>
      </div>
    `;
  }

  getTotalFiles(state) {
    return state.protectedPaths.reduce((sum, p) => sum + (p.fileCount || 0), 0);
  }

  formatStatus(status) {
    const map = {
      verified: 'Secure',
      compromised: 'Alert',
      scanning: 'Scanning',
      unknown: 'Unknown',
    };
    return map[status] || 'Unknown';
  }

  getStatusIconBg(status) {
    const map = {
      verified: 'bg-darklock-success-bg text-darklock-success',
      compromised: 'bg-darklock-error-bg text-darklock-error',
      scanning: 'bg-darklock-info-bg text-darklock-info',
      unknown: 'bg-darklock-bg-hover text-darklock-text-muted',
    };
    return map[status] || map.unknown;
  }
}
