/**
 * Dashboard Update Notification System
 * Shows users a pop-up with new features, fixes, and version info when the dashboard updates
 * FAIL-SAFE VERSION - Will not block dashboard if update check fails
 */

class UpdateNotifier {
    constructor() {
        // Respect global override to disable automatic injection
        if (typeof window !== 'undefined' && window.__disableUpdateNotifier) {
            console.log('[UPDATE_NOTIFIER] Disabled by dashboard-pro via global flag');
            return;
        }
        this.currentVersion = null;
        this.lastSeenVersion = this.getLastSeenVersion();
        this.checkForUpdates();
    }

    /**
     * Get the last version the user saw from localStorage
     */
    getLastSeenVersion() {
        return localStorage.getItem('dashboardVersion') || '0.0.0';
    }

    /**
     * Set the current version as seen
     */
    setVersionSeen(version) {
        localStorage.setItem('dashboardVersion', version);
        this.lastSeenVersion = version;
    }

    /**
     * Check if there's a new version - FAIL-SAFE
     */
    async checkForUpdates() {
        try {
            const response = await fetch('/version.json', {
                method: 'GET',
                cache: 'no-cache',
                headers: {
                    'Accept': 'application/json'
                }
            });
            
            if (!response.ok) {
                console.warn(`[UPDATE] Failed to fetch version.json: ${response.status}`);
                return; // Silently fail - don't block dashboard
            }
            
            const versionData = await response.json();
            
            if (!versionData || !versionData.version) {
                console.warn('[UPDATE] Invalid version.json format');
                return; // Silently fail
            }
            
            this.currentVersion = versionData.version;
            try {
                const verEl = document.getElementById('dashboard-version');
                if (verEl) verEl.textContent = `v${this.currentVersion}`;
            } catch (e) {
                // non-critical
            }

            // Compare versions
            if (this.isNewerVersion(this.currentVersion, this.lastSeenVersion)) {
                this.showUpdateNotification(versionData);
            }
        } catch (error) {
            console.warn('[UPDATE] Failed to check for updates (non-critical):', error.message);
            // Silently fail - update notifications are not critical
        }
    }

    /**
     * Compare two semantic versions
     */
    isNewerVersion(current, last) {
        const currentParts = current.split('.').map(Number);
        const lastParts = last.split('.').map(Number);

        for (let i = 0; i < 3; i++) {
            if (currentParts[i] > lastParts[i]) return true;
            if (currentParts[i] < lastParts[i]) return false;
        }
        return false;
    }

    /**
     * Show the update notification modal - FAIL-SAFE
     */
    showUpdateNotification(versionData) {
        try {
            if (!versionData.updates || versionData.updates.length === 0) {
                console.warn('[UPDATE] No updates data available');
                return;
            }
            
            const latestUpdate = versionData.updates[0];

            // Create modal HTML
            const modalHTML = `
                <div id="updateModal" class="update-modal-overlay">
                    <div class="update-modal">
                        <div class="update-modal-header">
                            <div class="update-icon">🎉</div>
                            <h2>Dashboard Updated!</h2>
                            <div class="version-badge">v${versionData.version}</div>
                        </div>
                        
                        <div class="update-modal-body">
                            <div class="update-title">${latestUpdate.title}</div>
                            <div class="update-date">Released: ${this.formatDate(latestUpdate.date)}</div>

                            ${latestUpdate.features && latestUpdate.features.length > 0 ? `
                                <div class="update-section">
                                    <h3>✨ New Features</h3>
                                    <ul class="update-list">
                                        ${latestUpdate.features.map(feature => `<li>${feature}</li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}

                            ${latestUpdate.fixes && latestUpdate.fixes.length > 0 ? `
                                <div class="update-section">
                                    <h3>🐛 Fixes</h3>
                                    <ul class="update-list">
                                        ${latestUpdate.fixes.map(fix => `<li>${fix}</li>`).join('')}
                                </ul>
                                </div>
                            ` : ''}

                            ${latestUpdate.improvements && latestUpdate.improvements.length > 0 ? `
                                <div class="update-section">
                                    <h3>🚀 Improvements</h3>
                                    <ul class="update-list">
                                        ${latestUpdate.improvements.map(improvement => `<li>${improvement}</li>`).join('')}
                                    </ul>
                                </div>
                            ` : ''}
                        </div>

                        <div class="update-modal-footer">
                            <button id="updateModalOK" class="update-modal-btn">
                                OK, Got It!
                            </button>
                        </div>
                    </div>
                </div>
            `;

            // Inject modal into body
            document.body.insertAdjacentHTML('beforeend', modalHTML);

            // Add event listener to close button
            const okButton = document.getElementById('updateModalOK');
            if (okButton) {
                okButton.addEventListener('click', () => {
                    this.closeUpdateNotification();
                });
            }

            // Show modal with animation
            requestAnimationFrame(() => {
                const modal = document.getElementById('updateModal');
                if (modal) {
                    modal.classList.add('show');
                }
            });
        } catch (error) {
            console.error('[UPDATE] Failed to show update notification:', error);
            // Silently fail - don't block dashboard
        }
    }

    /**
     * Close and remove the update notification
     */
    closeUpdateNotification() {
        const modal = document.getElementById('updateModal');
        
        if (modal) {
            modal.classList.remove('show');
            
            // Remove from DOM after animation
            setTimeout(() => {
                modal.remove();
            }, 300);

            // Mark this version as seen
            this.setVersionSeen(this.currentVersion);
        }
    }

    /**
     * Format date string
     */
    formatDate(dateStr) {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }
}

// Initialize update notifier when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        window.updateNotifier = new UpdateNotifier();
    });
} else {
    window.updateNotifier = new UpdateNotifier();
}
