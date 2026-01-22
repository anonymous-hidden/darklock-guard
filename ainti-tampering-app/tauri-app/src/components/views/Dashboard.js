// Dashboard View Component

import { icon } from '../../lib/icons.js';
import { timeAgo, truncatePath, getStatusClasses } from '../../lib/utils.js';

/**
 * Dashboard State Model
 * 
 * @typedef {Object} DashboardState
 * @property {'SECURE'|'CHANGED'|'COMPROMISED'|'NOT_SCANNED'} globalVerdict - Overall integrity state
 * @property {string|null} lastVerifiedAt - ISO timestamp of last successful verification
 * @property {string|null} lastScanAt - ISO timestamp of last scan (any result)
 * @property {'quick'|'full'|'paranoid'|null} lastScanMode - Mode of last scan
 * @property {boolean} chainValid - Event chain integrity status
 * @property {PathHealthCounts} pathHealth - Aggregate path status counts
 * 
 * @typedef {Object} PathHealthCounts
 * @property {number} verified - Paths with verified status
 * @property {number} changed - Paths with detected changes
 * @property {number} error - Paths with scan errors
 * @property {number} paused - Paths with monitoring paused
 * @property {number} notScanned - Paths never scanned
 */

export class Dashboard {
  constructor({ store, api }) {
    this.store = store;
    this.api = api;
  }

  /**
   * Compute global integrity verdict from backend data
   * 
   * LOGIC:
   * 1. COMPROMISED: chain invalid OR any path has error status
   * 2. NOT_SCANNED: no paths OR all paths have never been scanned
   * 3. CHANGED: any path has 'changed' status
   * 4. SECURE: all paths verified AND chain valid
   * 
   * @returns {'SECURE'|'CHANGED'|'COMPROMISED'|'NOT_SCANNED'}
   */
  computeGlobalVerdict(state) {
    const paths = state.protectedPaths || [];
    const chainValid = state.eventChainValid !== false;
    
    // No protected paths = NOT_SCANNED
    if (paths.length === 0) {
      return 'NOT_SCANNED';
    }
    
    // Check for compromised states
    const hasError = paths.some(p => p.status === 'error');
    if (!chainValid || hasError) {
      return 'COMPROMISED';
    }
    
    // Check if any path never scanned
    const allNotScanned = paths.every(p => p.status === 'not_scanned' || !p.status);
    if (allNotScanned) {
      return 'NOT_SCANNED';
    }
    
    // Check for changes
    const hasChanged = paths.some(p => p.status === 'changed');
    if (hasChanged) {
      return 'CHANGED';
    }
    
    // All verified
    const allVerified = paths.every(p => p.status === 'verified' || p.status === 'paused');
    if (allVerified) {
      return 'SECURE';
    }
    
    // Fallback for scanning or mixed states
    const isScanning = paths.some(p => p.status === 'scanning');
    if (isScanning) {
      return state.integrityStatus === 'scanning' ? 'SECURE' : 'CHANGED';
    }
    
    return 'NOT_SCANNED';
  }

  /**
   * Compute path health counts
   * @returns {PathHealthCounts}
   */
  computePathHealth(state) {
    const paths = state.protectedPaths || [];
    return {
      verified: paths.filter(p => p.status === 'verified').length,
      changed: paths.filter(p => p.status === 'changed').length,
      error: paths.filter(p => p.status === 'error').length,
      paused: paths.filter(p => p.status === 'paused').length,
      notScanned: paths.filter(p => p.status === 'not_scanned' || !p.status).length,
    };
  }

  /**
   * Get last verified timestamp
   * Only returns value when: scan successful + no diffs + chain valid
   */
  getLastVerifiedAt(state) {
    const verdict = this.computeGlobalVerdict(state);
    if (verdict === 'SECURE' && state.lastScanTime) {
      return state.lastScanTime;
    }
    // Return stored lastVerifiedAt if we have one
    return state.lastVerifiedAt || null;
  }

  render() {
    const state = this.store.getState();
    const globalVerdict = this.computeGlobalVerdict(state);
    const pathHealth = this.computePathHealth(state);
    const lastVerifiedAt = this.getLastVerifiedAt(state);
    const chainValid = state.eventChainValid !== false;

    return `
      <div class="space-y-6">
        <!-- Header with Global Verdict -->
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            ${this.renderGlobalVerdict(globalVerdict)}
            <div>
              <h2 class="text-2xl font-bold text-darklock-text-primary">Dashboard</h2>
              <p class="text-darklock-text-secondary text-sm">${this.getVerdictSubtitle(globalVerdict)}</p>
            </div>
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
          ${this.renderLastScanCard(state)}
          ${this.renderLastVerifiedCard(lastVerifiedAt)}
        </div>

        <!-- Main Content Grid -->
        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Protected Paths with Health Summary -->
          <div class="lg:col-span-2">
            ${this.renderProtectedPaths(state, pathHealth)}
          </div>

          <!-- Status Panel -->
          <div class="space-y-4">
            ${this.renderChainBadge(chainValid)}
            ${this.renderQuickActions()}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render global verdict indicator
   */
  renderGlobalVerdict(verdict) {
    const config = {
      SECURE: {
        icon: 'shieldCheck',
        bg: 'bg-darklock-success',
        ring: 'ring-darklock-success/30',
      },
      CHANGED: {
        icon: 'shieldAlert',
        bg: 'bg-darklock-warning',
        ring: 'ring-darklock-warning/30',
      },
      COMPROMISED: {
        icon: 'shieldX',
        bg: 'bg-darklock-error',
        ring: 'ring-darklock-error/30',
      },
      NOT_SCANNED: {
        icon: 'shield',
        bg: 'bg-darklock-text-muted',
        ring: 'ring-darklock-border',
      },
    };

    const c = config[verdict] || config.NOT_SCANNED;
    
    return `
      <div class="flex-shrink-0 w-14 h-14 ${c.bg} rounded-xl flex items-center justify-center ring-4 ${c.ring}">
        ${icon(c.icon, 'w-7 h-7 text-white')}
      </div>
    `;
  }

  getVerdictSubtitle(verdict) {
    const map = {
      SECURE: 'All systems verified',
      CHANGED: 'Changes detected — review required',
      COMPROMISED: 'Integrity violation — immediate action required',
      NOT_SCANNED: 'Run a scan to establish baseline',
    };
    return map[verdict] || '';
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

  /**
   * Last Scan card with mode indicator
   */
  renderLastScanCard(state) {
    const lastScan = state.lastScanTime ? timeAgo(state.lastScanTime) : 'Never';
    const scanMode = state.lastScanMode || null;
    const modeLabel = scanMode ? this.formatScanMode(scanMode) : '';
    
    return `
      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="stat-value">${lastScan}</p>
            <p class="stat-label">Last Scan${modeLabel ? ` · ${modeLabel}` : ''}</p>
          </div>
          <div class="stat-icon bg-darklock-warning-bg text-darklock-warning">
            ${icon('clock', 'w-6 h-6')}
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Last Verified card - only updates on clean scan + valid chain
   */
  renderLastVerifiedCard(lastVerifiedAt) {
    const display = lastVerifiedAt ? timeAgo(lastVerifiedAt) : 'Never';
    const statusClass = lastVerifiedAt ? 'bg-darklock-success-bg text-darklock-success' : 'bg-darklock-bg-hover text-darklock-text-muted';
    
    return `
      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="stat-value">${display}</p>
            <p class="stat-label">Last Verified</p>
          </div>
          <div class="stat-icon ${statusClass}">
            ${icon('checkCircle', 'w-6 h-6')}
          </div>
        </div>
      </div>
    `;
  }

  formatScanMode(mode) {
    const map = {
      quick: 'Quick',
      full: 'Full',
      paranoid: 'Paranoid',
    };
    return map[mode] || mode;
  }

  /**
   * Protected Paths card with health summary
   */
  renderProtectedPaths(state, pathHealth) {
    const paths = state.protectedPaths;
    const hasAnyPaths = paths.length > 0;

    return `
      <div class="card">
        <div class="px-6 py-4 border-b border-darklock-border flex items-center justify-between">
          <h3 class="text-lg font-semibold">Protected Paths</h3>
          <button data-action="add-path" class="btn-icon" title="Add Path">
            ${icon('plus')}
          </button>
        </div>
        
        ${hasAnyPaths ? `
          <!-- Health Summary -->
          <div class="px-6 py-3 bg-darklock-bg-secondary border-b border-darklock-border">
            <div class="flex items-center gap-4 text-sm">
              ${pathHealth.verified > 0 ? `<span class="flex items-center gap-1.5 text-darklock-success"><span class="w-2 h-2 rounded-full bg-darklock-success"></span>${pathHealth.verified} Verified</span>` : ''}
              ${pathHealth.changed > 0 ? `<span class="flex items-center gap-1.5 text-darklock-warning"><span class="w-2 h-2 rounded-full bg-darklock-warning"></span>${pathHealth.changed} Changed</span>` : ''}
              ${pathHealth.error > 0 ? `<span class="flex items-center gap-1.5 text-darklock-error"><span class="w-2 h-2 rounded-full bg-darklock-error"></span>${pathHealth.error} Error</span>` : ''}
              ${pathHealth.paused > 0 ? `<span class="flex items-center gap-1.5 text-darklock-text-muted"><span class="w-2 h-2 rounded-full bg-darklock-text-muted"></span>${pathHealth.paused} Paused</span>` : ''}
              ${pathHealth.notScanned > 0 ? `<span class="flex items-center gap-1.5 text-darklock-text-secondary"><span class="w-2 h-2 rounded-full bg-darklock-border"></span>${pathHealth.notScanned} Not Scanned</span>` : ''}
            </div>
          </div>
          
          <ul class="divide-y divide-darklock-border">
            ${paths.map(p => this.renderPathItem(p)).join('')}
          </ul>
        ` : `
          <div class="p-8 text-center">
            <div class="w-16 h-16 mx-auto rounded-full bg-darklock-bg-hover flex items-center justify-center mb-4">
              ${icon('folder', 'w-8 h-8 text-darklock-text-muted')}
            </div>
            <p class="text-darklock-text-secondary mb-4">No protected paths configured</p>
            <button data-action="add-path" class="btn btn-primary">
              Add Protected Path
            </button>
          </div>
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
                ${path.fileCount || 0} files
              </p>
            </div>
          </div>
          <div class="flex items-center gap-3">
            <span class="badge ${statusClass}">${path.status || 'not_scanned'}</span>
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

  /**
   * Event Chain Badge - passive indicator
   */
  renderChainBadge(chainValid) {
    if (chainValid) {
      return `
        <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-darklock-bg-secondary text-darklock-text-secondary text-sm">
          ${icon('link', 'w-4 h-4')}
          <span>Chain OK</span>
        </div>
      `;
    } else {
      return `
        <div class="flex items-center gap-2 px-3 py-2 rounded-lg bg-darklock-error-bg border border-darklock-error/30 text-darklock-error text-sm font-medium">
          ${icon('alertTriangle', 'w-4 h-4')}
          <span>Chain Broken</span>
        </div>
      `;
    }
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
          <button data-action="verify-chain" class="w-full btn btn-secondary flex items-center gap-3">
            ${icon('link')}
            <span>Verify Event Chain</span>
          </button>
        </div>
      </div>
    `;
  }

  getTotalFiles(state) {
    return state.protectedPaths.reduce((sum, p) => sum + (p.fileCount || 0), 0);
  }
}
