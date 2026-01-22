// Settings View Component

import { icon } from '../../lib/icons.js';

export class SettingsView {
  constructor({ store, api }) {
    this.store = store;
    this.api = api;
  }

  render() {
    const state = this.store.getState();
    const settings = state.settings;

    return `
      <div class="space-y-6">
        <!-- Header -->
        <div>
          <h2 class="text-2xl font-bold text-darklock-text-primary">Settings</h2>
          <p class="text-darklock-text-secondary mt-1">Configure Darklock Guard preferences</p>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <!-- Main Settings -->
          <div class="lg:col-span-2 space-y-6">
            ${this.renderScanSettings(settings)}
            ${this.renderSecuritySettings(settings)}
            ${this.renderNotificationSettings(settings)}
          </div>

          <!-- Sidebar Info -->
          <div class="space-y-6">
            ${this.renderAboutCard()}
            ${this.renderDangerZone()}
          </div>
        </div>
      </div>
    `;
  }

  renderScanSettings(settings) {
    return `
      <div class="card">
        <div class="px-6 py-4 border-b border-darklock-border">
          <div class="flex items-center gap-3">
            ${icon('refresh', 'w-5 h-5 text-darklock-accent')}
            <h3 class="text-lg font-semibold">Scan Settings</h3>
          </div>
        </div>
        <div class="p-6 space-y-6">
          <!-- Auto Scan Toggle -->
          <div class="flex items-center justify-between">
            <div>
              <h4 class="font-medium text-darklock-text-primary">Automatic Scanning</h4>
              <p class="text-sm text-darklock-text-secondary">
                Automatically scan protected paths on a schedule
              </p>
            </div>
            <button 
              data-toggle="autoScan"
              class="toggle ${settings.autoScan ? 'active' : ''}"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <!-- Scan Interval -->
          <div>
            <label class="block font-medium text-darklock-text-primary mb-2">
              Scan Interval
            </label>
            <select class="input">
              <option value="900" ${settings.scanInterval === 900 ? 'selected' : ''}>Every 15 minutes</option>
              <option value="1800" ${settings.scanInterval === 1800 ? 'selected' : ''}>Every 30 minutes</option>
              <option value="3600" ${settings.scanInterval === 3600 ? 'selected' : ''}>Every hour</option>
              <option value="21600" ${settings.scanInterval === 21600 ? 'selected' : ''}>Every 6 hours</option>
              <option value="86400" ${settings.scanInterval === 86400 ? 'selected' : ''}>Daily</option>
            </select>
          </div>

          <!-- Hash Algorithm (Read-only) -->
          <div>
            <label class="block font-medium text-darklock-text-primary mb-2">
              Hash Algorithm
            </label>
            <div class="input bg-darklock-bg-hover cursor-not-allowed flex items-center justify-between">
              <span>SHA-256</span>
              <span class="badge badge-info">FIPS 180-4</span>
            </div>
            <p class="text-xs text-darklock-text-muted mt-1">
              Hash algorithm cannot be changed to maintain baseline compatibility
            </p>
          </div>
        </div>
      </div>
    `;
  }

  renderSecuritySettings(settings) {
    return `
      <div class="card">
        <div class="px-6 py-4 border-b border-darklock-border">
          <div class="flex items-center gap-3">
            ${icon('shield', 'w-5 h-5 text-darklock-accent')}
            <h3 class="text-lg font-semibold">Security Settings</h3>
          </div>
        </div>
        <div class="p-6 space-y-6">
          <!-- Real-time Monitoring -->
          <div class="flex items-center justify-between">
            <div>
              <h4 class="font-medium text-darklock-text-primary">Real-time Monitoring</h4>
              <p class="text-sm text-darklock-text-secondary">
                Monitor file changes in real-time using filesystem events
              </p>
            </div>
            <button 
              data-toggle="realtimeMonitoring"
              class="toggle ${settings.realtimeMonitoring ? 'active' : ''}"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <!-- Strict Mode -->
          <div class="flex items-center justify-between">
            <div>
              <h4 class="font-medium text-darklock-text-primary">Strict Mode</h4>
              <p class="text-sm text-darklock-text-secondary">
                Alert on any file modification, including metadata changes
              </p>
            </div>
            <button 
              data-toggle="strictMode"
              class="toggle ${settings.strictMode ? 'active' : ''}"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <!-- Verify Event Chain on Startup -->
          <div class="flex items-center justify-between">
            <div>
              <h4 class="font-medium text-darklock-text-primary">Verify Chain on Startup</h4>
              <p class="text-sm text-darklock-text-secondary">
                Verify event chain integrity each time the application starts
              </p>
            </div>
            <button 
              data-toggle="verifyChainOnStartup"
              class="toggle ${settings.verifyChainOnStartup !== false ? 'active' : ''}"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderNotificationSettings(settings) {
    return `
      <div class="card">
        <div class="px-6 py-4 border-b border-darklock-border">
          <div class="flex items-center gap-3">
            ${icon('info', 'w-5 h-5 text-darklock-accent')}
            <h3 class="text-lg font-semibold">Notifications</h3>
          </div>
        </div>
        <div class="p-6 space-y-6">
          <!-- Enable Notifications -->
          <div class="flex items-center justify-between">
            <div>
              <h4 class="font-medium text-darklock-text-primary">Desktop Notifications</h4>
              <p class="text-sm text-darklock-text-secondary">
                Show system notifications for important events
              </p>
            </div>
            <button 
              data-toggle="notificationsEnabled"
              class="toggle ${settings.notificationsEnabled ? 'active' : ''}"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>

          <!-- Alert on Integrity Violation -->
          <div class="flex items-center justify-between">
            <div>
              <h4 class="font-medium text-darklock-text-primary">Alert on Integrity Violation</h4>
              <p class="text-sm text-darklock-text-secondary">
                Show urgent notification when file tampering is detected
              </p>
            </div>
            <button 
              data-toggle="alertOnViolation"
              class="toggle ${settings.alertOnViolation !== false ? 'active' : ''}"
            >
              <span class="toggle-knob"></span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  renderAboutCard() {
    return `
      <div class="card p-6">
        <div class="flex items-center gap-4 mb-4">
          <div class="w-14 h-14 rounded-xl bg-darklock-accent flex items-center justify-center">
            ${icon('shield', 'w-8 h-8 text-white')}
          </div>
          <div>
            <h3 class="text-lg font-bold text-darklock-text-primary">Darklock Guard</h3>
            <p class="text-sm text-darklock-text-muted">Version 1.0.0</p>
          </div>
        </div>
        <p class="text-sm text-darklock-text-secondary mb-4">
          Advanced file integrity monitoring and tamper detection for security-critical systems.
        </p>
        
        <!-- Update Check Button -->
        <button 
          id="checkUpdateBtn"
          class="btn btn-secondary w-full mb-4"
        >
          ${icon('refresh', 'w-4 h-4')}
          <span>Check for Updates</span>
        </button>
        
        <div class="space-y-2 text-sm">
          <div class="flex items-center justify-between py-2 border-t border-darklock-border">
            <span class="text-darklock-text-muted">Platform</span>
            <span class="text-darklock-text-primary">Tauri 2.0</span>
          </div>
          <div class="flex items-center justify-between py-2 border-t border-darklock-border">
            <span class="text-darklock-text-muted">Backend</span>
            <span class="text-darklock-text-primary">Rust</span>
          </div>
          <div class="flex items-center justify-between py-2 border-t border-darklock-border">
            <span class="text-darklock-text-muted">License</span>
            <span class="text-darklock-text-primary">MIT</span>
          </div>
        </div>
      </div>
    `;
  }

  renderDangerZone() {
    return `
      <div class="card border-darklock-error/30">
        <div class="px-6 py-4 border-b border-darklock-error/30 bg-darklock-error-bg">
          <h3 class="text-lg font-semibold text-darklock-error">Danger Zone</h3>
        </div>
        <div class="p-6 space-y-4">
          <div>
            <h4 class="font-medium text-darklock-text-primary mb-1">Reset Baseline</h4>
            <p class="text-sm text-darklock-text-secondary mb-3">
              Clear all file hashes and create a new baseline. This cannot be undone.
            </p>
            <button class="btn btn-danger w-full">
              Reset Baseline
            </button>
          </div>
          <div class="pt-4 border-t border-darklock-border">
            <h4 class="font-medium text-darklock-text-primary mb-1">Clear Event Chain</h4>
            <p class="text-sm text-darklock-text-secondary mb-3">
              Remove all events from the audit log. This cannot be undone.
            </p>
            <button class="btn btn-danger w-full">
              Clear Events
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
