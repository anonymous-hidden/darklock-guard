// Tauri API Wrapper
// This module provides a clean interface to Rust backend commands
// ALL privileged operations MUST go through this layer

const { invoke } = window.__TAURI__?.core || {};

/**
 * TauriAPI - Secure interface to Rust backend
 * 
 * SECURITY NOTES:
 * - Never trust frontend data without backend validation
 * - All file operations are validated in Rust
 * - Secrets are never exposed to JavaScript
 */
export class TauriAPI {
  constructor() {
    this.ready = typeof invoke === 'function';
    
    if (!this.ready) {
      console.warn('[TauriAPI] Tauri invoke not available - running in dev mode?');
    }
  }

  /**
   * Safe invoke wrapper with error handling
   */
  async _invoke(cmd, args = {}) {
    if (!this.ready) {
      console.warn(`[TauriAPI] Mock call: ${cmd}`, args);
      return this._mockResponse(cmd, args);
    }

    try {
      return await invoke(cmd, args);
    } catch (error) {
      console.error(`[TauriAPI] Command failed: ${cmd}`, error);
      throw error;
    }
  }

  /**
   * Mock responses for development without Tauri
   */
  _mockResponse(cmd, args) {
    const mocks = {
      'initialize': {
        protectedPaths: [
          { path: 'C:\\Projects\\MyApp', fileCount: 156, status: 'verified' },
          { path: 'C:\\Config\\Sensitive', fileCount: 23, status: 'verified' },
        ],
        integrityStatus: 'verified',
        lastScanTime: new Date().toISOString(),
        settings: { autoScan: true, scanInterval: 3600 },
      },
      'get_protected_paths': [
        { id: '1', path: 'C:\\Projects\\MyApp', fileCount: 156, status: 'verified', lastScan: new Date().toISOString() },
        { id: '2', path: 'C:\\Config\\Sensitive', fileCount: 23, status: 'verified', lastScan: new Date().toISOString() },
      ],
      'scan_integrity': {
        status: 'verified',
        filesScanned: 179,
        filesModified: 0,
        filesDeleted: 0,
        filesAdded: 0,
        duration: 2.4,
      },
      'get_events': [
        { id: '1', timestamp: new Date().toISOString(), type: 'scan_complete', message: 'Integrity scan completed', severity: 'info' },
        { id: '2', timestamp: new Date(Date.now() - 3600000).toISOString(), type: 'path_added', message: 'Protected path added: C:\\Projects\\MyApp', severity: 'info' },
      ],
      'get_file_tree': {
        name: 'MyApp',
        type: 'directory',
        children: [
          { name: 'src', type: 'directory', children: [
            { name: 'main.rs', type: 'file', hash: 'a1b2c3...', status: 'verified' },
            { name: 'lib.rs', type: 'file', hash: 'd4e5f6...', status: 'verified' },
          ]},
          { name: 'Cargo.toml', type: 'file', hash: 'g7h8i9...', status: 'verified' },
        ],
      },
      // Protection system mocks
      'protection_get_status': 'verified',
      'protection_scan_all': [
        {
          scanId: 'mock-scan-1',
          pathId: '1',
          status: 'verified',
          totals: { totalFiles: 156, verifiedFiles: 156, modifiedFiles: 0, deletedFiles: 0, newFiles: 0, durationMs: 1200 },
          durationMs: 1200,
        },
      ],
      'protection_get_paths': [
        { id: '1', path: 'C:\\Projects\\MyApp', displayName: 'My App', fileCount: 156, status: 'verified' },
        { id: '2', path: 'C:\\Config\\Sensitive', displayName: 'Sensitive Config', fileCount: 23, status: 'verified' },
      ],
      'protection_is_chain_valid': true,
    };

    return Promise.resolve(mocks[cmd] || null);
  }

  // ========== Initialization ==========

  /**
   * Initialize application and get initial state
   */
  async initialize() {
    return this._invoke('initialize');
  }

  // ========== Protected Paths ==========

  /**
   * Get all protected paths
   */
  async getProtectedPaths() {
    return this._invoke('get_protected_paths');
  }

  /**
   * Add a new protected path
   */
  async addProtectedPath(path) {
    return this._invoke('add_protected_path', { path });
  }

  /**
   * Remove a protected path
   */
  async removeProtectedPath(pathId) {
    return this._invoke('remove_protected_path', { pathId });
  }

  // ========== Integrity Scanning ==========

  /**
   * Run full integrity scan
   */
  async scanIntegrity() {
    return this._invoke('scan_integrity');
  }

  /**
   * Scan specific path
   */
  async scanPath(path) {
    return this._invoke('scan_path', { path });
  }

  /**
   * Get file tree for a protected path
   */
  async getFileTree(pathId) {
    return this._invoke('get_file_tree', { pathId });
  }

  /**
   * Verify specific file
   */
  async verifyFile(filePath) {
    return this._invoke('verify_file', { filePath });
  }

  // ========== Event Chain ==========

  /**
   * Get recent events
   */
  async getEvents(limit = 50) {
    return this._invoke('get_events', { limit });
  }

  /**
   * Verify event chain integrity
   */
  async verifyEventChain() {
    return this._invoke('verify_event_chain');
  }

  // ========== Settings ==========

  /**
   * Get current settings
   */
  async getSettings() {
    return this._invoke('get_settings');
  }

  /**
   * Update settings
   */
  async updateSettings(settings) {
    return this._invoke('update_settings', { settings });
  }

  // ========== File Operations ==========

  /**
   * Open native file dialog to select directory
   */
  async selectDirectory() {
    return this._invoke('select_directory');
  }

  /**
   * Export integrity report
   */
  async exportReport(format = 'json') {
    return this._invoke('export_report', { format });
  }

  // ========== Authentication ==========

  /**
   * Logout user
   */
  async logout() {
    return this._invoke('logout');
  }

  // ========== Protection System (EDR-lite) ==========

  /**
   * Get overall protection status
   * Returns: 'secure' | 'compromised' | 'unknown' | 'scanning'
   */
  async getProtectionStatus() {
    return this._invoke('protection_get_status');
  }

  /**
   * Run quick scan on all protected paths to update status
   * @param {string} mode - 'quick' | 'full' | 'paranoid' (default: 'quick')
   */
  async quickScan(mode = 'quick') {
    return this._invoke('protection_scan_all', { mode });
  }

  /**
   * Get all protected paths from the new protection system
   */
  async getProtectionPaths() {
    return this._invoke('protection_get_paths');
  }

  /**
   * Check if the event chain is valid
   */
  async isChainValid() {
    return this._invoke('protection_is_chain_valid');
  }

  /**
   * Refresh status by running a quick scan on all paths
   * This is used on app launch to update the integrity status
   */
  async refreshStatus() {
    try {
      // First get current status
      const status = await this.getProtectionStatus();
      
      // If we have protected paths, run a quick scan to update status
      const paths = await this.getProtectedPaths();
      if (paths && paths.length > 0) {
        // Run quick scan to verify integrity
        const results = await this.scanIntegrity();
        return {
          status: results.status || status,
          lastScanTime: new Date().toISOString(),
          scanned: true,
          results
        };
      }
      
      return {
        status: status || 'unknown',
        lastScanTime: null,
        scanned: false
      };
    } catch (error) {
      console.warn('[TauriAPI] refreshStatus failed:', error);
      return {
        status: 'unknown',
        lastScanTime: null,
        scanned: false,
        error: error.message || error
      };
    }
  }

  // ========== Cloud Sync (App → Website) ==========

  /**
   * Sync device status to Darklock Platform website
   * 
   * ARCHITECTURE:
   * - This PUSHES status FROM the app TO the website
   * - The website cannot pull or request data
   * - The app is the source of truth for all security decisions
   * 
   * @param {Object} authToken - User's auth token from login
   * @param {Object} status - Current device status to sync
   */
  async syncToCloud(authToken, status) {
    if (!authToken) {
      console.warn('[TauriAPI] Cannot sync to cloud: no auth token');
      return { success: false, error: 'Not authenticated' };
    }

    const apiUrl = window.__DARKLOCK_API_URL__ || 'https://darklock.net';
    
    try {
      const response = await fetch(`${apiUrl}/platform/api/devices/sync`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          deviceId: status.deviceId || await this.getDeviceId(),
          deviceName: status.deviceName || 'Darklock Guard',
          status: status.globalStatus || 'unknown',
          paths: status.pathHealth || { verified: 0, changed: 0, error: 0 },
          totalFiles: status.totalFiles || 0,
          lastVerified: status.lastVerifiedAt,
          appVersion: '1.0.0',
          events: status.recentEvents || []
        })
      });

      if (response.ok) {
        console.log('[TauriAPI] Status synced to cloud');
        return { success: true };
      } else {
        const err = await response.text();
        console.warn('[TauriAPI] Cloud sync failed:', err);
        return { success: false, error: err };
      }
    } catch (error) {
      console.error('[TauriAPI] Cloud sync error:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get or generate a unique device ID
   */
  async getDeviceId() {
    try {
      return await this._invoke('get_device_id');
    } catch {
      // Fallback: use stored ID or generate new one
      let deviceId = localStorage.getItem('darklock_device_id');
      if (!deviceId) {
        deviceId = 'device_' + crypto.randomUUID();
        localStorage.setItem('darklock_device_id', deviceId);
      }
      return deviceId;
    }
  }
}
