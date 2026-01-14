// Integrity View Component - Detailed Integrity Scanning

import { icon } from '../../lib/icons.js';

export class IntegrityView {
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
            <h2 class="text-2xl font-bold text-darklock-text-primary">Integrity Check</h2>
            <p class="text-darklock-text-secondary mt-1">Verify file integrity and detect modifications</p>
          </div>
          <button 
            data-action="scan" 
            class="btn btn-primary flex items-center gap-2"
            ${state.integrityStatus === 'scanning' ? 'disabled' : ''}
          >
            ${state.integrityStatus === 'scanning' ? icon('loader', 'animate-spin') : icon('refresh')}
            <span>${state.integrityStatus === 'scanning' ? 'Scanning...' : 'Start Full Scan'}</span>
          </button>
        </div>

        <!-- Status Banner -->
        ${this.renderStatusBanner(state)}

        <!-- Scan Results -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
          ${this.renderScanOverview(state)}
          ${this.renderIntegrityDetails(state)}
        </div>

        <!-- Recent Scan Results Table -->
        ${this.renderScanResultsTable(state)}
      </div>
    `;
  }

  renderStatusBanner(state) {
    const bannerConfig = {
      verified: {
        title: 'All Files Verified',
        description: 'No unauthorized modifications detected. Your files are secure.',
        icon: 'shieldCheck',
        bgClass: 'bg-gradient-to-r from-darklock-success/20 to-darklock-success/5 border-darklock-success/30',
        iconClass: 'text-darklock-success',
      },
      compromised: {
        title: 'Integrity Violations Detected',
        description: 'Some files have been modified since the last baseline. Review the changes below.',
        icon: 'shieldAlert',
        bgClass: 'bg-gradient-to-r from-darklock-error/20 to-darklock-error/5 border-darklock-error/30',
        iconClass: 'text-darklock-error',
      },
      scanning: {
        title: 'Scan in Progress',
        description: 'Analyzing file hashes and comparing against baseline...',
        icon: 'loader',
        bgClass: 'bg-gradient-to-r from-darklock-info/20 to-darklock-info/5 border-darklock-info/30',
        iconClass: 'text-darklock-info animate-spin',
      },
      unknown: {
        title: 'Run a Scan',
        description: 'Start an integrity scan to verify your protected files.',
        icon: 'shield',
        bgClass: 'bg-darklock-bg-secondary border-darklock-border',
        iconClass: 'text-darklock-text-muted',
      },
    };

    const config = bannerConfig[state.integrityStatus] || bannerConfig.unknown;

    return `
      <div class="card ${config.bgClass} border p-6">
        <div class="flex items-center gap-4">
          <div class="w-16 h-16 rounded-xl bg-darklock-bg-primary/50 flex items-center justify-center">
            ${icon(config.icon, `w-8 h-8 ${config.iconClass}`)}
          </div>
          <div>
            <h3 class="text-xl font-bold text-darklock-text-primary">${config.title}</h3>
            <p class="text-darklock-text-secondary">${config.description}</p>
          </div>
        </div>
      </div>
    `;
  }

  renderScanOverview(state) {
    // Mock data - will come from actual scan results
    const scanData = {
      totalFiles: 1247,
      verified: 1245,
      modified: 2,
      deleted: 0,
      added: 0,
      scanDuration: '2.4s',
    };

    return `
      <div class="card p-6">
        <h3 class="text-lg font-semibold mb-4">Scan Overview</h3>
        
        <div class="space-y-4">
          <div class="flex items-center justify-between p-3 rounded-lg bg-darklock-bg-tertiary">
            <div class="flex items-center gap-3">
              ${icon('file', 'w-5 h-5 text-darklock-text-muted')}
              <span class="text-darklock-text-secondary">Total Files</span>
            </div>
            <span class="font-bold text-darklock-text-primary">${scanData.totalFiles}</span>
          </div>

          <div class="flex items-center justify-between p-3 rounded-lg bg-darklock-success-bg">
            <div class="flex items-center gap-3">
              ${icon('fileCheck', 'w-5 h-5 text-darklock-success')}
              <span class="text-darklock-text-secondary">Verified</span>
            </div>
            <span class="font-bold text-darklock-success">${scanData.verified}</span>
          </div>

          <div class="flex items-center justify-between p-3 rounded-lg bg-darklock-warning-bg">
            <div class="flex items-center gap-3">
              ${icon('alertTriangle', 'w-5 h-5 text-darklock-warning')}
              <span class="text-darklock-text-secondary">Modified</span>
            </div>
            <span class="font-bold text-darklock-warning">${scanData.modified}</span>
          </div>

          <div class="flex items-center justify-between p-3 rounded-lg bg-darklock-error-bg">
            <div class="flex items-center gap-3">
              ${icon('fileX', 'w-5 h-5 text-darklock-error')}
              <span class="text-darklock-text-secondary">Deleted</span>
            </div>
            <span class="font-bold text-darklock-error">${scanData.deleted}</span>
          </div>

          <div class="flex items-center justify-between p-3 rounded-lg bg-darklock-bg-tertiary mt-4 border-t border-darklock-border pt-4">
            <div class="flex items-center gap-3">
              ${icon('clock', 'w-5 h-5 text-darklock-text-muted')}
              <span class="text-darklock-text-secondary">Scan Duration</span>
            </div>
            <span class="font-mono text-darklock-text-primary">${scanData.scanDuration}</span>
          </div>
        </div>
      </div>
    `;
  }

  renderIntegrityDetails(state) {
    return `
      <div class="card p-6">
        <h3 class="text-lg font-semibold mb-4">Integrity Verification</h3>
        
        <div class="space-y-4">
          <!-- Hash Algorithm -->
          <div class="p-4 rounded-lg bg-darklock-bg-tertiary">
            <div class="flex items-center gap-3 mb-2">
              ${icon('hash', 'w-5 h-5 text-darklock-accent')}
              <span class="font-medium">Hash Algorithm</span>
            </div>
            <p class="text-sm text-darklock-text-secondary ml-8">
              SHA-256 (FIPS 180-4 compliant)
            </p>
          </div>

          <!-- Merkle Tree -->
          <div class="p-4 rounded-lg bg-darklock-bg-tertiary">
            <div class="flex items-center gap-3 mb-2">
              ${icon('activity', 'w-5 h-5 text-darklock-accent')}
              <span class="font-medium">Merkle Tree Root</span>
            </div>
            <p class="text-xs font-mono text-darklock-text-muted ml-8 break-all">
              a7f3d8e2c1b4...9f2e1d3c4b5a
            </p>
          </div>

          <!-- Event Chain -->
          <div class="p-4 rounded-lg bg-darklock-bg-tertiary">
            <div class="flex items-center gap-3 mb-2">
              ${icon('lock', 'w-5 h-5 text-darklock-accent')}
              <span class="font-medium">Event Chain</span>
            </div>
            <div class="flex items-center gap-2 ml-8">
              <span class="status-dot ${state.eventChainValid ? 'status-dot-success' : 'status-dot-error'}"></span>
              <span class="text-sm text-darklock-text-secondary">
                ${state.eventChainValid ? 'Chain intact - no tampering detected' : 'Chain integrity compromised'}
              </span>
            </div>
          </div>

          <button data-action="verify-chain" class="w-full btn btn-secondary mt-4">
            ${icon('shieldCheck', 'inline mr-2')}
            Verify Event Chain
          </button>
        </div>
      </div>
    `;
  }

  renderScanResultsTable(state) {
    // Mock data for modified files
    const modifiedFiles = [
      { path: 'C:\\Projects\\App\\config.json', status: 'modified', oldHash: 'a1b2c3...', newHash: 'd4e5f6...' },
      { path: 'C:\\Projects\\App\\src\\main.rs', status: 'modified', oldHash: 'g7h8i9...', newHash: 'j0k1l2...' },
    ];

    if (modifiedFiles.length === 0) {
      return `
        <div class="card p-6 text-center">
          <div class="w-16 h-16 mx-auto rounded-full bg-darklock-success-bg flex items-center justify-center mb-4">
            ${icon('check', 'w-8 h-8 text-darklock-success')}
          </div>
          <h3 class="text-lg font-semibold text-darklock-text-primary">No Modifications Detected</h3>
          <p class="text-darklock-text-secondary">All monitored files match their baseline hashes.</p>
        </div>
      `;
    }

    return `
      <div class="card">
        <div class="px-6 py-4 border-b border-darklock-border">
          <h3 class="text-lg font-semibold">Modified Files</h3>
        </div>
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>File Path</th>
                <th>Status</th>
                <th>Previous Hash</th>
                <th>Current Hash</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${modifiedFiles.map(file => `
                <tr>
                  <td>
                    <div class="flex items-center gap-2">
                      ${icon('file', 'w-4 h-4 text-darklock-text-muted')}
                      <span class="font-mono text-sm">${file.path}</span>
                    </div>
                  </td>
                  <td>
                    <span class="badge badge-warning">${file.status}</span>
                  </td>
                  <td>
                    <span class="font-mono text-xs text-darklock-text-muted">${file.oldHash}</span>
                  </td>
                  <td>
                    <span class="font-mono text-xs text-darklock-text-muted">${file.newHash}</span>
                  </td>
                  <td>
                    <button class="btn-icon text-darklock-accent" title="View Details">
                      ${icon('externalLink', 'w-4 h-4')}
                    </button>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }
}
