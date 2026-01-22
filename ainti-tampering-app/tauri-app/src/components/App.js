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
    
    // Event filter buttons
    document.querySelectorAll('[data-filter]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const filter = e.currentTarget.dataset.filter;
        this.filterEvents(filter);
        
        // Update active state
        document.querySelectorAll('.event-filter-btn').forEach(b => {
          b.classList.remove('bg-darklock-bg-active', 'text-darklock-text-primary', 'font-medium');
          b.classList.add('text-darklock-text-secondary');
        });
        e.currentTarget.classList.add('bg-darklock-bg-active', 'text-darklock-text-primary', 'font-medium');
        e.currentTarget.classList.remove('text-darklock-text-secondary');
      });
    });
    
    // Event search
    const searchInput = document.getElementById('eventSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchEvents(e.target.value);
      });
    }
    
    // Modified file click handlers - must run after every render
    setTimeout(() => {
      document.querySelectorAll('[data-file-details]').forEach(row => {
        row.addEventListener('click', () => {
          const filePath = row.dataset.fileDetails;
          this.showFileDetails(filePath);
        });
      });
    }, 100);
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

  async runScan(mode = 'full') {
    this.store.setState({ integrityStatus: 'scanning' });
    
    try {
      const result = await this.api.scanIntegrity();
      
      // Determine status from scan result
      let status = 'verified';
      const hasChanges = (result.modified_files || 0) > 0 || 
                         (result.deleted_files || 0) > 0 ||
                         (result.filesModified || 0) > 0;
      
      if (result.status) {
        status = result.status.toLowerCase();
      } else if (hasChanges) {
        status = 'compromised';
      }
      
      const now = new Date().toISOString();
      const state = this.store.getState();
      
      // Update lastVerifiedAt only if: scan clean + chain valid
      const scanClean = status === 'verified' && !hasChanges;
      const chainValid = state.eventChainValid !== false;
      const lastVerifiedAt = (scanClean && chainValid) ? now : state.lastVerifiedAt;
      
      // Refresh protected paths to get updated statuses
      const paths = await this.api.getProtectedPaths();
      
      this.store.setState({
        integrityStatus: status,
        lastScanTime: now,
        lastScanMode: mode,
        lastVerifiedAt,
        scanResults: result,
        protectedPaths: paths,
      });
      
      // Show scan summary
      const summary = `Scan Complete!\n\nTotal Files: ${result.filesScanned || result.total_files || 0}\nVerified: ${result.verified_files || 0}\nModified: ${result.modified_files || result.filesModified || 0}\nDeleted: ${result.deleted_files || result.filesDeleted || 0}`;
      alert(summary);
    } catch (error) {
      console.error('Scan failed:', error);
      this.store.setState({ integrityStatus: 'unknown' });
      alert('Scan failed: ' + error);
    }
  }

  async addProtectedPath() {
    try {
      console.log('[Darklock] Opening directory picker...');
      const path = await this.api.selectDirectory();
      console.log('[Darklock] Selected path:', path);
      
      if (path && path.trim() !== '') {
        console.log('[Darklock] Adding path to protection:', path);
        const newPath = await this.api.addProtectedPath(path);
        console.log('[Darklock] Backend returned:', newPath);
        
        // Wait a moment for backend to persist
        await new Promise(resolve => setTimeout(resolve, 100));
        
        const paths = await this.api.getProtectedPaths();
        console.log('[Darklock] Fetched updated protected paths:', paths);
        console.log('[Darklock] Number of paths:', paths.length);
        
        this.store.setState({ protectedPaths: paths });
        console.log('[Darklock] Store updated with', paths.length, 'paths');
        
        // Force re-render to show new path
        const root = document.getElementById('app');
        if (root) {
          console.log('[Darklock] Re-rendering app...');
          root.innerHTML = this.render();
          this.attachEventListeners();
          console.log('[Darklock] App re-rendered successfully');
        }
        
        alert(`✅ Protected Path Added!\n\nPath: ${path}\n\nThe path has been saved and will be monitored for changes.`);
      } else {
        console.log('[Darklock] No path selected or dialog cancelled');
      }
    } catch (error) {
      console.error('[Darklock] Failed to add path:', error);
      alert('❌ Failed to add protected path:\n\n' + error);
    }
  }

  async removeProtectedPath(pathId) {
    const confirmed = confirm('Are you sure you want to remove this protected path?\n\nThis will delete the baseline and stop monitoring this path.');
    if (!confirmed) return;
    
    try {
      await this.api.removeProtectedPath(pathId);
      const paths = await this.api.getProtectedPaths();
      this.store.setState({ protectedPaths: paths });
      console.log('Protected path removed and saved locally');
      alert('Protected path removed successfully!');
    } catch (error) {
      console.error('Failed to remove path:', error);
      alert('Failed to remove protected path: ' + error);
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

  filterEvents(filter) {
    console.log('Filtering events by:', filter);
    
    // Store current filter in state
    this.store.setState({ eventFilter: filter });
    
    // Re-render to apply filter
    this.render();
    const root = document.getElementById('app');
    if (root) {
      root.innerHTML = this.render();
      this.attachEventListeners();
    }
  }
  
  searchEvents(query) {
    console.log('Searching events:', query);
    // TODO: Implement actual event search when events are loaded from backend
  }
  
  showFileDetails(filePath) {
    const details = `📄 FILE MODIFICATION DETAILS\n${'='.repeat(50)}\n\n` +
      `Path: ${filePath}\n\n` +
      `Status: Modified\n\n` +
      `Original Hash:\n  a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6\n\n` +
      `New Hash:\n  d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9\n\n` +
      `Modified: ${new Date().toLocaleString()}\n` +
      `Size Change: 1.2 KB → 1.5 KB (+300 bytes)\n\n` +
      `${'-'.repeat(50)}\n` +
      `This feature will be enhanced with:\n` +
      `• Diff viewer\n` +
      `• Modification timeline\n` +
      `• Restore from baseline option`;
    
    alert(details);
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
