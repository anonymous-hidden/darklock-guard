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
}
