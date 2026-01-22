// Darklock Guard - Main Application Entry
// Frontend is UNTRUSTED - all privileged operations go through Tauri commands

import { App } from './components/App.js';
import { Router } from './lib/router.js';
import { Store } from './lib/store.js';
import { TauriAPI } from './lib/tauri-api.js';

// Initialize application store
const store = new Store({
  initialized: false,
  loading: true,
  currentView: 'dashboard',
  
  // Security state
  protectedPaths: [],
  integrityStatus: 'unknown', // 'verified' | 'compromised' | 'unknown'
  lastScanTime: null,
  lastScanMode: null, // 'quick' | 'full' | 'paranoid'
  lastVerifiedAt: null, // Only set when: scan clean + chain valid
  
  // Event chain state
  events: [],
  eventChainValid: true,
  eventFilter: 'all', // 'all' | 'scans' | 'modifications' | 'alerts'
  
  // Settings
  settings: {
    autoScan: true,
    scanInterval: 3600, // seconds
    notificationsEnabled: true,
    theme: 'dark',
  },
});

// Initialize Tauri API wrapper
const api = new TauriAPI();

// Initialize router
const router = new Router({
  routes: [
    { path: '/', view: 'dashboard' },
    { path: '/files', view: 'files' },
    { path: '/integrity', view: 'integrity' },
    { path: '/events', view: 'events' },
    { path: '/settings', view: 'settings' },
  ],
  defaultRoute: '/',
});

// Main initialization
async function init() {
  try {
    console.log('[Darklock Guard] Initializing...');
    
    // Get initial state from Rust backend
    const initData = await api.initialize();
    
    store.setState({
      initialized: true,
      loading: false,
      protectedPaths: initData.protectedPaths || [],
      integrityStatus: initData.integrityStatus || 'unknown',
      lastScanTime: initData.lastScanTime,
      settings: { ...store.state.settings, ...initData.settings },
    });
    
    console.log('[Darklock Guard] Initialized successfully');
    
    // Auto-refresh status on launch if we have protected paths
    if (initData.protectedPaths && initData.protectedPaths.length > 0) {
      console.log('[Darklock Guard] Running startup integrity check...');
      store.setState({ integrityStatus: 'scanning' });
      
      try {
        const statusResult = await api.refreshStatus();
        console.log('[Darklock Guard] Status refresh complete:', statusResult);
        
        store.setState({
          integrityStatus: statusResult.status || 'unknown',
          lastScanTime: statusResult.lastScanTime || store.state.lastScanTime,
        });
        
        console.log('[Darklock Guard] Status updated to:', statusResult.status);
      } catch (statusError) {
        console.warn('[Darklock Guard] Startup status check failed:', statusError);
        // Don't fail initialization, just keep unknown status
        store.setState({ integrityStatus: 'unknown' });
      }
    }
  } catch (error) {
    console.error('[Darklock Guard] Initialization failed:', error);
    store.setState({
      loading: false,
      initialized: false,
    });
  }
}

// Mount application
document.addEventListener('DOMContentLoaded', async () => {
  const appRoot = document.getElementById('app');
  
  if (!appRoot) {
    console.error('[Darklock Guard] App root element not found');
    return;
  }
  
  // Render app structure
  const app = new App({ store, router, api });
  appRoot.innerHTML = app.render();
  
  // Initialize app state
  await init();
  
  // Re-render with loaded state
  appRoot.innerHTML = app.render();
  
  // Setup navigation listeners
  app.attachEventListeners();
  
  // Listen for store changes
  store.subscribe(() => {
    appRoot.innerHTML = app.render();
    app.attachEventListeners();
  });
  
  // Handle route changes
  router.subscribe((view) => {
    store.setState({ currentView: view });
  });
  
  // Start router
  router.init();
});

// Export for debugging (development only)
if (import.meta.env.DEV) {
  window.__DARKLOCK__ = { store, router, api };
}
