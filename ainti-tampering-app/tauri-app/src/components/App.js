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
  }

  async handleAction(action, data) {
    const state = this.store.getState();

    switch (action) {
      case 'scan':
        await this.runScan();
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
      case 'verify-chain':
        await this.verifyEventChain();
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
    } catch (error) {
      console.error('Failed to verify event chain:', error);
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
}
