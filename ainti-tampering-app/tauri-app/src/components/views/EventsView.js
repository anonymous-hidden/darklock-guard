// Events View Component - Event Chain Log

import { icon } from '../../lib/icons.js';
import { timeAgo, formatDate } from '../../lib/utils.js';

export class EventsView {
  constructor({ store, api }) {
    this.store = store;
    this.api = api;
  }

  render() {
    const state = this.store.getState();

    // Mock events data
    const events = [
      { id: '1', timestamp: new Date().toISOString(), type: 'scan_complete', message: 'Full integrity scan completed successfully', severity: 'info', hash: 'a1b2c3d4e5f6...' },
      { id: '2', timestamp: new Date(Date.now() - 3600000).toISOString(), type: 'file_modified', message: 'File modification detected: config.json', severity: 'warning', hash: 'b2c3d4e5f6g7...' },
      { id: '3', timestamp: new Date(Date.now() - 7200000).toISOString(), type: 'path_added', message: 'Protected path added: C:\\Projects\\MyApp', severity: 'info', hash: 'c3d4e5f6g7h8...' },
      { id: '4', timestamp: new Date(Date.now() - 86400000).toISOString(), type: 'scan_complete', message: 'Full integrity scan completed successfully', severity: 'info', hash: 'd4e5f6g7h8i9...' },
      { id: '5', timestamp: new Date(Date.now() - 172800000).toISOString(), type: 'baseline_created', message: 'Initial baseline created for 156 files', severity: 'success', hash: 'e5f6g7h8i9j0...' },
    ];

    return `
      <div class="space-y-6">
        <!-- Header -->
        <div class="flex items-center justify-between">
          <div>
            <h2 class="text-2xl font-bold text-darklock-text-primary">Event Log</h2>
            <p class="text-darklock-text-secondary mt-1">Tamper-evident audit trail of all security events</p>
          </div>
          <div class="flex items-center gap-2">
            <button data-action="verify-chain" class="btn btn-secondary flex items-center gap-2">
              ${icon('shieldCheck')}
              <span>Verify Chain</span>
            </button>
            <button data-action="export-events" class="btn btn-secondary flex items-center gap-2">
              ${icon('download')}
              <span>Export</span>
            </button>
          </div>
        </div>

        <!-- Chain Status -->
        ${this.renderChainStatus(state)}

        <!-- Event Filters -->
        ${this.renderFilters()}

        <!-- Events Timeline -->
        ${this.renderEventsTimeline(events)}
      </div>
    `;
  }

  renderChainStatus(state) {
    return `
      <div class="card p-4">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-4">
            <div class="w-12 h-12 rounded-lg ${state.eventChainValid ? 'bg-darklock-success-bg' : 'bg-darklock-error-bg'} flex items-center justify-center">
              ${icon(state.eventChainValid ? 'lock' : 'shieldAlert', `w-6 h-6 ${state.eventChainValid ? 'text-darklock-success' : 'text-darklock-error'}`)}
            </div>
            <div>
              <h3 class="font-semibold text-darklock-text-primary">
                ${state.eventChainValid ? 'Event Chain Verified' : 'Chain Integrity Alert'}
              </h3>
              <p class="text-sm text-darklock-text-secondary">
                ${state.eventChainValid 
                  ? 'All events are cryptographically linked and unmodified' 
                  : 'Potential tampering detected in the event chain'}
              </p>
            </div>
          </div>
          <div class="text-right">
            <p class="text-sm text-darklock-text-muted">Chain Length</p>
            <p class="text-2xl font-bold text-darklock-text-primary">247</p>
          </div>
        </div>
      </div>
    `;
  }

  renderFilters() {
    return `
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-2 bg-darklock-bg-secondary rounded-lg p-1">
          <button class="px-3 py-1.5 rounded-md bg-darklock-bg-active text-darklock-text-primary text-sm font-medium">
            All Events
          </button>
          <button class="px-3 py-1.5 rounded-md text-darklock-text-secondary hover:text-darklock-text-primary text-sm">
            Scans
          </button>
          <button class="px-3 py-1.5 rounded-md text-darklock-text-secondary hover:text-darklock-text-primary text-sm">
            Modifications
          </button>
          <button class="px-3 py-1.5 rounded-md text-darklock-text-secondary hover:text-darklock-text-primary text-sm">
            Alerts
          </button>
        </div>
        <div class="flex-1"></div>
        <div class="relative">
          <input 
            type="text" 
            placeholder="Search events..." 
            class="input pl-10 w-64"
          />
          <span class="absolute left-3 top-1/2 -translate-y-1/2 text-darklock-text-muted">
            ${icon('search', 'w-4 h-4')}
          </span>
        </div>
      </div>
    `;
  }

  renderEventsTimeline(events) {
    return `
      <div class="card">
        <div class="px-6 py-4 border-b border-darklock-border">
          <h3 class="text-lg font-semibold">Recent Events</h3>
        </div>
        <div class="divide-y divide-darklock-border">
          ${events.map((event, index) => this.renderEventItem(event, index === events.length - 1)).join('')}
        </div>
        <div class="px-6 py-4 border-t border-darklock-border bg-darklock-bg-tertiary">
          <button class="w-full text-center text-sm text-darklock-text-secondary hover:text-darklock-accent transition-colors">
            Load More Events
          </button>
        </div>
      </div>
    `;
  }

  renderEventItem(event, isLast) {
    const severityConfig = {
      info: { icon: 'info', color: 'text-darklock-info', bg: 'bg-darklock-info-bg', line: 'bg-darklock-info' },
      success: { icon: 'check', color: 'text-darklock-success', bg: 'bg-darklock-success-bg', line: 'bg-darklock-success' },
      warning: { icon: 'alertTriangle', color: 'text-darklock-warning', bg: 'bg-darklock-warning-bg', line: 'bg-darklock-warning' },
      error: { icon: 'x', color: 'text-darklock-error', bg: 'bg-darklock-error-bg', line: 'bg-darklock-error' },
    };

    const config = severityConfig[event.severity] || severityConfig.info;

    return `
      <div class="px-6 py-4 hover:bg-darklock-bg-hover transition-colors">
        <div class="flex items-start gap-4">
          <!-- Timeline indicator -->
          <div class="relative flex flex-col items-center">
            <div class="w-10 h-10 rounded-lg ${config.bg} flex items-center justify-center z-10">
              ${icon(config.icon, `w-5 h-5 ${config.color}`)}
            </div>
            ${!isLast ? `<div class="absolute top-10 w-0.5 h-full ${config.line} opacity-30"></div>` : ''}
          </div>

          <!-- Content -->
          <div class="flex-1 min-w-0">
            <div class="flex items-center justify-between mb-1">
              <span class="font-medium text-darklock-text-primary">${this.formatEventType(event.type)}</span>
              <span class="text-sm text-darklock-text-muted" title="${formatDate(event.timestamp)}">
                ${timeAgo(event.timestamp)}
              </span>
            </div>
            <p class="text-sm text-darklock-text-secondary mb-2">${event.message}</p>
            <div class="flex items-center gap-4 text-xs">
              <span class="flex items-center gap-1 text-darklock-text-muted">
                ${icon('hash', 'w-3 h-3')}
                <span class="font-mono">${event.hash}</span>
              </span>
              <span class="text-darklock-text-muted">
                Event #${event.id}
              </span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  formatEventType(type) {
    const typeMap = {
      scan_complete: 'Scan Complete',
      file_modified: 'File Modified',
      file_added: 'File Added',
      file_deleted: 'File Deleted',
      path_added: 'Path Added',
      path_removed: 'Path Removed',
      baseline_created: 'Baseline Created',
      integrity_alert: 'Integrity Alert',
    };
    return typeMap[type] || type;
  }
}
