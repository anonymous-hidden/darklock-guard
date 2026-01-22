// Files View Component - Protected Files Browser

import { icon } from '../../lib/icons.js';
import { truncatePath, formatBytes } from '../../lib/utils.js';

export class FilesView {
  constructor({ store, api }) {
    this.store = store;
    this.api = api;
    this.isTauri = api.ready;
  }

  render() {
    const state = this.store.getState();
    const paths = state.protectedPaths;

    return `
      <div class="space-y-6">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-darklock-text-primary">Protected Files</h2>
            <p class="text-darklock-text-secondary mt-1">Browse and manage protected directories</p>
          </div>
          <button data-action="add-path" class="btn btn-primary flex items-center gap-2" ${!this.isTauri ? 'disabled title="File system access is only available in the desktop app"' : ''}>
            ${icon('plus')}
            <span>Add Path</span>
          </button>
        </div>

        ${paths.length === 0 ? this.renderEmptyState() : this.renderPathList(paths)}
      </div>
    `;
  }

  renderEmptyState() {
    return `
      <div class="card">
        <div class="p-12 text-center">
          <div class="w-20 h-20 mx-auto rounded-full bg-darklock-bg-hover flex items-center justify-center mb-6">
            ${icon('folder', 'w-10 h-10 text-darklock-text-muted')}
          </div>
          <h3 class="text-xl font-semibold text-darklock-text-primary mb-2">No Protected Paths</h3>
          <p class="text-darklock-text-secondary mb-6 max-w-md mx-auto">
            Add directories to protect and monitor their file integrity. 
            Any unauthorized modifications will be detected and logged.
          </p>
          <button data-action="add-path" class="btn btn-primary" ${!this.isTauri ? 'disabled title="File system access is only available in the desktop app"' : ''}>
            ${icon('plus', 'inline mr-2')}
            Add Your First Path
          </button>
          ${!this.isTauri ? '<p class="text-darklock-text-muted text-sm mt-4">💡 Download the desktop app to add and monitor protected paths</p>' : ''}
        </div>
      </div>
    `;
  }

  renderPathList(paths) {
    return `
      <div class="grid grid-cols-1 gap-4">
        ${paths.map(p => this.renderPathCard(p)).join('')}
      </div>
    `;
  }

  renderPathCard(path) {
    const statusConfig = {
      verified: { label: 'Verified', class: 'badge-success', icon: 'shieldCheck' },
      modified: { label: 'Modified', class: 'badge-warning', icon: 'alertTriangle' },
      compromised: { label: 'Compromised', class: 'badge-error', icon: 'shieldAlert' },
    };
    const status = statusConfig[path.status] || statusConfig.verified;

    return `
      <div class="card hover:border-darklock-accent transition-all">
        <div class="p-6">
          <div class="flex items-start justify-between mb-4">
            <div class="flex items-center gap-3">
              <div class="w-12 h-12 rounded-lg bg-darklock-accent-subtle flex items-center justify-center">
                ${icon('folderOpen', 'w-6 h-6 text-darklock-accent')}
              </div>
              <div>
                <h3 class="font-semibold text-darklock-text-primary" title="${path.path}">
                  ${truncatePath(path.path, 50)}
                </h3>
                <p class="text-sm text-darklock-text-muted">
                  ${path.fileCount} files monitored
                </p>
              </div>
            </div>
            <span class="badge ${status.class} flex items-center gap-1">
              ${icon(status.icon, 'w-3 h-3')}
              ${status.label}
            </span>
          </div>

          <!-- Path Stats -->
          <div class="grid grid-cols-3 gap-4 mb-4">
            <div class="text-center p-3 rounded-lg bg-darklock-bg-tertiary">
              <p class="text-lg font-bold text-darklock-text-primary">${path.fileCount || 0}</p>
              <p class="text-xs text-darklock-text-muted">Files</p>
            </div>
            <div class="text-center p-3 rounded-lg bg-darklock-bg-tertiary">
              <p class="text-lg font-bold text-darklock-text-primary">${path.dirCount || 0}</p>
              <p class="text-xs text-darklock-text-muted">Directories</p>
            </div>
            <div class="text-center p-3 rounded-lg bg-darklock-bg-tertiary">
              <p class="text-lg font-bold text-darklock-text-primary">${formatBytes(path.totalSize || 0)}</p>
              <p class="text-xs text-darklock-text-muted">Total Size</p>
            </div>
          </div>

          <!-- Last Scan -->
          ${path.lastScan ? `
            <div class="flex items-center gap-2 text-sm text-darklock-text-muted mb-4">
              ${icon('clock', 'w-4 h-4')}
              <span>Last scanned: ${new Date(path.lastScan).toLocaleString()}</span>
            </div>
          ` : ''}

          <!-- Actions -->
          <div class="flex items-center gap-2 pt-4 border-t border-darklock-border">
            <button 
              data-action="scan-path" 
              data-path-id="${path.id}"
              class="btn btn-secondary text-sm flex items-center gap-2"
            >
              ${icon('refresh', 'w-4 h-4')}
              Scan Now
            </button>
            <button 
              data-action="view-tree" 
              data-path-id="${path.id}"
              class="btn btn-secondary text-sm flex items-center gap-2"
            >
              ${icon('file', 'w-4 h-4')}
              View Files
            </button>
            <button 
              data-action="remove-path" 
              data-path-id="${path.id}"
              class="btn btn-danger text-sm flex items-center gap-2 ml-auto"
            >
              ${icon('trash', 'w-4 h-4')}
              Remove
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
