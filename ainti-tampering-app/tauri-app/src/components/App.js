// Main App Component
// Darklock Guard - File Integrity Protection

import { Sidebar } from './Sidebar.js';
import { Dashboard } from './views/Dashboard.js';
import { FilesView } from './views/FilesView.js';
import { IntegrityView } from './views/IntegrityView.js';
import { EventsView } from './views/EventsView.js';
import { SettingsView } from './views/SettingsView.js';

export class App {
  constructor({ store, router, api }) {
    this.store = store;
    this.router = router;
    this.api = api;
  }

  render() {
    const state = this.store.getState();
    
    if (state.loading) {
      return this.renderLoading();
    }

    return `
      <div class="flex h-screen overflow-hidden">
        ${new Sidebar({ store: this.store, router: this.router }).render()}
        
        <main class="flex-1 overflow-y-auto bg-darklock-bg-primary">
          <div class="p-6 lg:p-8 max-w-7xl mx-auto">
            ${this.renderView(state.currentView)}
          </div>
        </main>
      </div>
    `;
  }

  renderLoading() {
    return `
      <div class="flex items-center justify-center h-screen bg-darklock-bg-primary">
        <div class="text-center">
          <div class="inline-block animate-spin rounded-full h-12 w-12 border-4 border-darklock-accent border-t-transparent"></div>
          <p class="mt-4 text-darklock-text-secondary">Initializing Darklock Guard...</p>
        </div>
      </div>
    `;
  }

  renderView(view) {
    const state = this.store.getState();
    const props = { store: this.store, api: this.api };

    switch (view) {
      case 'dashboard':
        return new Dashboard(props).render();
      case 'files':
        return new FilesView(props).render();
      case 'integrity':
        return new IntegrityView(props).render();
      case 'events':
        return new EventsView(props).render();
      case 'settings':
        return new SettingsView(props).render();
      default:
        return new Dashboard(props).render();
    }
  }

  attachEventListeners() {
    // Navigation links
    document.querySelectorAll('[data-navigate]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        const path = el.dataset.navigate;
        this.router.navigate(path);
      });
    });

    // Action buttons
    document.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.preventDefault();
        const action = el.dataset.action;
        await this.handleAction(action, el.dataset);
      });
    });

    // Toggle switches
    document.querySelectorAll('[data-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.dataset.toggle;
        this.handleToggle(key);
      });
    });
    
    // Update check button
    const updateBtn = document.getElementById('checkUpdateBtn');
    if (updateBtn) {
      updateBtn.addEventListener('click', () => this.checkForUpdates());
    }
  }

  async handleAction(action, data) {
    const state = this.store.getState();

    switch (action) {
      case 'scan':
        await this.runScan();
        break;
      case 'scan-path':
        await this.scanPath(data.pathId);
        break;
      case 'view-tree':
        await this.viewFileTree(data.pathId);
        break;
      case 'add-path':
        await this.addProtectedPath();
        break;
      case 'remove-path':
        await this.removeProtectedPath(data.pathId);
        break;
      case 'export-report':
        await this.exportReport();
        break;
      case 'export-events':
        await this.exportEvents();
        break;
      case 'verify-chain':
        await this.verifyEventChain();
        break;
      case 'logout':
        await this.logout();
        break;
      default:
        console.warn('Unknown action:', action);
    }
  }

  async runScan() {
    this.store.setState({ integrityStatus: 'scanning' });
    
    try {
      const result = await this.api.scanIntegrity();
      this.store.setState({
        integrityStatus: result.status,
        lastScanTime: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Scan failed:', error);
      this.store.setState({ integrityStatus: 'unknown' });
    }
  }

  async addProtectedPath() {
    try {
      const path = await this.api.selectDirectory();
      if (path) {
        await this.api.addProtectedPath(path);
        const paths = await this.api.getProtectedPaths();
        this.store.setState({ protectedPaths: paths });
      }
    } catch (error) {
      console.error('Failed to add path:', error);
    }
  }

  async removeProtectedPath(pathId) {
    try {
      await this.api.removeProtectedPath(pathId);
      const paths = await this.api.getProtectedPaths();
      this.store.setState({ protectedPaths: paths });
    } catch (error) {
      console.error('Failed to remove path:', error);
    }
  }

  async exportReport() {
    try {
      await this.api.exportReport('json');
    } catch (error) {
      console.error('Failed to export report:', error);
    }
  }

  async verifyEventChain() {
    try {
      const result = await this.api.verifyEventChain();
      this.store.setState({ eventChainValid: result.valid });
      
      if (result.valid) {
        alert('✓ Event chain integrity verified - All events are authentic');
      } else {
        alert('⚠ Event chain integrity check FAILED - Tampering detected!');
      }
    } catch (error) {
      console.error('Failed to verify event chain:', error);
      alert('Failed to verify event chain: ' + error);
    }
  }

  async scanPath(pathId) {
    if (!pathId) return;
    
    try {
      const result = await this.api.scanPath(pathId);
      const paths = await this.api.getProtectedPaths();
      this.store.setState({ protectedPaths: paths });
      
      alert(`Scan completed for path:\nVerified: ${result.verified}\nModified: ${result.modified}`);
    } catch (error) {
      console.error('Failed to scan path:', error);
      alert('Failed to scan path: ' + error);
    }
  }

  async viewFileTree(pathId) {
    if (!pathId) return;
    
    try {
      const tree = await this.api.getFileTree(pathId);
      console.log('File tree:', tree);
      // TODO: Show file tree in a modal or separate view
      alert('File tree view - Coming soon!\nCheck console for tree data.');
    } catch (error) {
      console.error('Failed to get file tree:', error);
      alert('Failed to load file tree: ' + error);
    }
  }

  async exportEvents() {
    try {
      await this.api.exportReport('json');
      alert('Events exported successfully!');
    } catch (error) {
      console.error('Failed to export events:', error);
      alert('Failed to export events: ' + error);
    }
  }

  async logout() {
    try {
      await this.api.logout();
      window.location.href = 'login.html';
    } catch (error) {
      console.error('Logout failed:', error);
      alert('Failed to logout: ' + error);
    }
  }

  handleToggle(key) {
    const state = this.store.getState();
    const settings = { ...state.settings };
    settings[key] = !settings[key];
    this.store.setState({ settings });
    
    // Persist to backend
    this.api.updateSettings(settings).catch(console.error);
  }

  async checkForUpdates() {
    const updateBtn = document.getElementById('checkUpdateBtn');
    if (!updateBtn) return;
    
    const originalHTML = updateBtn.innerHTML;
    updateBtn.disabled = true;
    updateBtn.innerHTML = '<span class="loading-spinner"></span><span>Checking...</span>';
    
    try {
      const { check } = await import('@tauri-apps/plugin-updater');
      const { relaunch } = await import('@tauri-apps/plugin-process');
      
      const update = await check();
      
      if (update?.available) {
        const yes = confirm(
          `Update available: ${update.version}\n\n${update.body}\n\nWould you like to download and install it now?`
        );
        
        if (yes) {
          updateBtn.innerHTML = '<span class="loading-spinner"></span><span>Downloading...</span>';
          await update.downloadAndInstall();
          await relaunch();
        }
      } else {
        alert('You are already using the latest version!');
      }
    } catch (error) {
      console.error('Update check failed:', error);
      alert(`Failed to check for updates: ${error.message || error}`);
    } finally {
      updateBtn.disabled = false;
      updateBtn.innerHTML = originalHTML;
    }
  }
}
