// Dashboard Pro JS - Commercial Grade
(function() {
  'use strict';

  // --- Locale Loader (Queue UI) ---
  window.GUILD_LANG = window.GUILD_LANG || 'en';
  window.i18n = window.i18n || {};
  window.__i18nBase = {};
  function loadFrontendLocale(lang) {
    return fetch(`/locale/${lang}.json`, { credentials: 'include' }).then(r => r.ok ? r.json() : {}).catch(() => ({}));
  }
  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{{2}(\w+)\}{2}/g, (_, k) => k in vars ? String(vars[k]) : `{{${k}}}`);
  }
  function t(key, vars) {
    const val = window.i18n[key] || window.__i18nBase[key];
    if (!val) return key;
    return interpolate(val, vars);
  }
  window.t = t;
  async function initLocale() {
    // Load saved language from localStorage
    const savedLang = localStorage.getItem('dashboardLanguage') || 'en';
    window.GUILD_LANG = savedLang;
    
    window.__i18nBase = await loadFrontendLocale('en');
    if (window.GUILD_LANG && window.GUILD_LANG !== 'en') {
      const over = await loadFrontendLocale(window.GUILD_LANG);
      window.i18n = { ...window.__i18nBase, ...over };
    } else {
      window.i18n = window.__i18nBase;
    }
    // Replace all data-i18n text nodes
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      el.textContent = t(key);
    });
    // Handle placeholders
    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
  }
  document.addEventListener('DOMContentLoaded', initLocale);

  // Prevent other scripts from injecting blocking update modals.
  // Dashboard-pro will manage update notifications itself.
  try { window.__disableUpdateNotifier = true; } catch (e) {}

  // State Management
  const state = {
    authToken: null,
    user: null,
    guildId: null,
    currentView: 'overview',
    lastSettingChanged: null,
    serverInfo: null,
    currentConfig: {},
    subscription: {
      plan: 'free',
      status: 'inactive',
      active: false,
      current_period_end: null,
      stripe_customer_id: null,
      stripe_subscription_id: null
    },
    lastSubscriptionStatus: null,
    securityStats: null,
    tickets: [],
    roles: [],
    commands: [],
    commandPermissions: {},
    analytics: {
      messages24h: 0,
      commands24h: 0,
      joins24h: 0,
      leaves24h: 0
    },
    loading: {
      serverInfo: false,
      securityStats: false,
      tickets: false
    },
    refreshing: false,
    lastRefresh: 0
  };

  // Notification System (action-specific)
  function showActionNotification(action) {
    const template = $('#action-notification-template');
    if (!template) return;

    const notification = template.content.cloneNode(true).querySelector('.action-notification');
  
    const iconMap = {
      timeout: '⏱️', ban: '🔨', kick: '👢', warn: '⚠️',
      undo_timeout: '↩️', undo_ban: '↩️',
      lockdown: '🚨', unlockdown: '✅', lock: '🔒', unlock: '🔓'
    };
  
    const icon = notification.querySelector('.notification-icon');
    icon.textContent = iconMap[action.type] || '📝';
    icon.style.background = action.canUndo ? 'var(--color-warning)' : 'var(--color-primary)';

    const title = notification.querySelector('.notification-title');
    const message = notification.querySelector('.notification-message');
    const time = notification.querySelector('.notification-time');
    const moderator = notification.querySelector('.notification-moderator');

    title.textContent = action.type.charAt(0).toUpperCase() + action.type.slice(1).replace('_', ' ');
    message.textContent = `${action.target.tag} - ${action.reason}`;
    time.textContent = new Date(action.timestamp).toLocaleTimeString();
    moderator.textContent = `By ${action.moderator.tag}`;

    const undoBtn = notification.querySelector('.btn-undo');
    const dismissBtn = notification.querySelector('.btn-dismiss');

    if (!action.canUndo) {
      undoBtn.disabled = true;
      undoBtn.style.display = 'none';
    }

    undoBtn.addEventListener('click', async () => {
      try {
        undoBtn.disabled = true;
        undoBtn.textContent = 'Undoing...';
      
        const response = await apiFetch(`/api/actions/${action.id}/undo`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'Undone from notification' })
        });

        if (response.success) {
          notification.classList.add('undone');
          undoBtn.textContent = 'Undone ✓';
          showNotification('Action undone successfully', 'success');
          if (state.currentView === 'security') loadActionLogs();
          setTimeout(() => {
            notification.style.animation = 'slideOutRight 0.3s ease-in';
            setTimeout(() => notification.remove(), 300);
          }, 2000);
        } else {
          showNotification(response.error || 'Failed to undo action', 'error');
          undoBtn.disabled = false;
          undoBtn.textContent = 'Undo';
        }
      } catch (error) {
        showNotification('Failed to undo action', 'error');
        undoBtn.disabled = false;
        undoBtn.textContent = 'Undo';
      }
    });

    dismissBtn.addEventListener('click', () => {
      notification.style.animation = 'slideOutRight 0.3s ease-in';
      setTimeout(() => notification.remove(), 300);
    });

    if (!action.canUndo) {
      setTimeout(() => {
        if (notification.parentNode) {
          notification.style.animation = 'slideOutRight 0.3s ease-in';
          setTimeout(() => notification.remove(), 300);
        }
      }, 30000);
    }

    const container = $('#notification-container');
    if (container) container.appendChild(notification);
  }

  // Action Log Management
  async function loadActionLogs(filter = 'all') {
    if (!state.guildId) return;

    try {
      const params = new URLSearchParams({ guildId: state.guildId, limit: 50 });
      if (filter !== 'all' && filter !== 'undone') {
        params.set('category', filter);
      }

      const response = await apiFetch(`/api/actions?${params}`);
      if (!response.success) throw new Error(response.error);

      let actions = response.actions || [];
      if (filter === 'undone') {
        actions = actions.filter(a => a.undone);
      }

      displayActionLogs(actions);
    } catch (error) {
      console.error('Load actions error:', error);
    }
  }

  function displayActionLogs(actions) {
    const container = $('#action-log-list');
    if (!container) return;

    // Preserve existing spam alert items before clearing
    const existingSpamAlerts = Array.from(container.querySelectorAll('.spam-alert-item'));

    if (actions.length === 0 && existingSpamAlerts.length === 0) {
      container.innerHTML = '<div class="empty-state"><div class="empty-icon">📝</div><div class="empty-title">No Actions Yet</div></div>';
      return;
    }

    const iconMap = { timeout: '⏱️', ban: '🔨', kick: '👢', warn: '⚠️', undo_timeout: '↩️', undo_ban: '↩️', lockdown: '🚨', unlockdown: '✅', lock: '🔒', unlock: '🔓' };
  
    container.innerHTML = actions.map(action => {
      const icon = iconMap[action.action_type] || '📝';
      const timeAgo = getTimeAgo(new Date(action.created_at));
      const undoneClass = action.undone ? 'undone' : '';

        return `<div class="action-log-item ${undoneClass}">
          <div class="action-icon ${action.action_type}">${icon}</div>
          <div class="action-details">
            <div class="action-header">
              <span class="action-type">${action.action_type.replace('_', ' ')}</span>
              <span class="action-time">${timeAgo}</span>
            </div>
            <div class="action-target">Target: ${action.target_username || action.target_user_id}</div>
            <div class="action-reason">"${action.reason}"</div>
            <div class="action-meta">
              <span class="action-meta-item">👮 ${action.moderator_username || 'Unknown'}</span>
              ${action.duration ? `<span class="action-meta-item">⏱️ ${action.duration}</span>` : ''}
              ${action.undone ? `<span class="action-meta-item">↩️ Undone by ${action.undone_by}</span>` : ''}
            </div>
            ${action.can_undo && !action.undone ? `<button class="action-undo-btn" data-action-id="${action.id}">Undo This Action</button>` : ''}
          </div>
        </div>`;
      }).join('');

      // Restore spam alerts at the top
      existingSpamAlerts.forEach(alert => {
        container.insertBefore(alert, container.firstChild);
      });

      $$('.action-undo-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
          const actionId = e.target.dataset.actionId;
          const reason = prompt('Reason for undoing this action (optional):');
          if (reason === null) return;

          try {
            btn.disabled = true;
            btn.textContent = 'Undoing...';
          
            const response = await apiFetch(`/api/actions/${actionId}/undo`, {
              method: 'POST',
              body: JSON.stringify({ reason: reason || 'Undone from dashboard' })
            });

            if (response.success) {
              showNotification('Action undone successfully', 'success');
              loadActionLogs();
            } else {
              showNotification(response.error || 'Failed to undo action', 'error');
              btn.disabled = false;
              btn.textContent = 'Undo This Action';
            }
          } catch (error) {
            showNotification('Failed to undo action', 'error');
            btn.disabled = false;
            btn.textContent = 'Undo This Action';
          }
        });
      });
    }

    // Load recent security events
    async function loadSecurityEvents() {
      if (!state.guildId) return;

      try {
        const response = await apiFetch(`/api/security/recent?guildId=${encodeURIComponent(state.guildId)}&limit=20`);
        if (!response.success) throw new Error(response.error);

        const events = response.events || [];
        displaySecurityEvents(events);
      } catch (error) {
        console.error('Load security events error:', error);
      }
    }

    function displaySecurityEvents(events) {
      const container = $('#security-events-list');
      if (!container) return;

      if (events.length === 0) {
        container.innerHTML = '<div class="empty-state"><div class="empty-icon">🛡️</div><div class="empty-title">No Security Events</div></div>';
        return;
      }

      const severityIcons = { HIGH: '🔴', MEDIUM: '🟡', LOW: '🟢', CRITICAL: '⚠️' };

      container.innerHTML = events.map(event => {
        const icon = severityIcons[event.severity] || '🔵';
        const timeAgo = getTimeAgo(new Date(event.created_at));
        const sourceLabel = event.source === 'raid' ? 'RAID' : event.source === 'incident' ? 'INCIDENT' : 'LOG';

        return `
          <div class="security-event-item severity-${event.severity?.toLowerCase() || 'low'}">
            <div class="event-icon">${icon}</div>
            <div class="event-details">
              <div class="event-header">
                <span class="event-type">${event.type}</span>
                <span class="event-source badge">${sourceLabel}</span>
                <span class="event-time">${timeAgo}</span>
              </div>
              <div class="event-description">${event.description || 'No details available'}</div>
            </div>
          </div>
        `;
      }).join('');
    }

    function getTimeAgo(date) {
      const seconds = Math.floor((new Date() - date) / 1000);
      const intervals = { year: 31536000, month: 2592000, week: 604800, day: 86400, hour: 3600, minute: 60 };

      for (const [unit, secondsInUnit] of Object.entries(intervals)) {
        const interval = Math.floor(seconds / secondsInUnit);
        if (interval >= 1) return `${interval} ${unit}${interval > 1 ? 's' : ''} ago`;
      }
      return 'just now';
    }

    // WebSocket for Real-time Updates
    let ws = null;

    function connectWebSocket() {
    // Provide global renderer if not already defined (for integrated console view)
    if (!window.addConsoleMessage) {
      window.addConsoleMessage = function(msg) {
        const out = document.getElementById('console-output');
        if (!out) return;
        const level = msg.level || (msg.eventType ? 'event' : 'info');
        const time = new Date(msg.timestamp || Date.now()).toLocaleTimeString();
        const line = document.createElement('div');
        line.className = 'console-line level-' + level;
        line.style.color = level === 'error' ? '#ff6b6b' : level === 'warn' ? '#ffd166' : level === 'event' ? '#00ff41' : '#d6e4ff';
        line.textContent = `[${time}] ${msg.message || msg.eventType || '(no message)'}${msg.guildId ? ' ['+msg.guildId+']' : ''}`;
        out.appendChild(line);
        while (out.childElementCount > 5000) out.removeChild(out.firstChild);
        if (!window.consolePaused) out.scrollTop = out.scrollHeight;
      };
    }
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const guildParam = state.guildId ? `?guildId=${encodeURIComponent(state.guildId)}` : '';
      const wsUrl = `${protocol}//${window.location.host}/ws${guildParam}`;

      console.log('Connecting to WebSocket:', wsUrl);
      
      try {
        // Pass JWT via Sec-WebSocket-Protocol instead of query params
        const token = state.authToken || '';
        ws = token ? new WebSocket(wsUrl, token) : new WebSocket(wsUrl);
        ws.onopen = () => {
          console.log('✅ WebSocket connected successfully');
          // Real-time connection notification disabled (console-only)
        };
        ws.onmessage = (event) => {
          try {
            handleWebSocketMessage(JSON.parse(event.data));
          } catch (error) {
            console.error('WebSocket message parse error:', error, 'Raw:', event.data);
          }
        };
        ws.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
        };
        ws.onclose = () => {
          console.log('🔌 WebSocket disconnected, reconnecting in 5s...');
          setTimeout(connectWebSocket, 5000);
        };
      } catch (error) {
        console.error('WebSocket connection error:', error);
        setTimeout(connectWebSocket, 5000);
      }
    }

    function handleWebSocketMessage(data) {
      console.log('WebSocket message received:', data);
      
      if (data.guildId && data.guildId !== state.guildId) {
        console.log('Ignoring message for different guild:', data.guildId, 'vs', state.guildId);
        return;
      }

      // Handle keepalive ping
      if (data.type === 'ping') {
        try {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now(), guildId: state.guildId }));
          }
        } catch (e) {
          console.error('Failed to send pong:', e);
        }
        return; // Do not process further
      }

      // Re-subscribe to updates after reconnection
      if (data.type === 'server_ready' || data.type === 'reconnect') {
        try {
          if (ws && ws.readyState === WebSocket.OPEN && state.guildId) {
            ws.send(JSON.stringify({ type: 'subscribe', guildId: state.guildId }));
          }
        } catch (e) { console.error('Failed to subscribe:', e); }
        return;
      }

      switch (data.type) {
        case 'botConsole':
          try {
            if (window.addConsoleMessage) {
              window.addConsoleMessage(data);
            } else {
              // Fallback: queue until console view initializes
              window.__pendingConsole = window.__pendingConsole || [];
              window.__pendingConsole.push(data);
            }
          } catch (e) { console.warn('botConsole render failed:', e); }
          return;
        case 'botConsole':
          try {
            if (window.addConsoleMessage) {
              window.addConsoleMessage(data);
            } else {
              // Fallback: log to browser console so we still see activity
              console.log('[botConsole]', data.message || data.eventType || data.level || '');
            }
          } catch (e) {
            console.warn('Failed to handle botConsole message:', e);
          }
          return;
        case 'action':
          console.log('Showing action notification:', data.action);
          showActionNotification(data.action);
          if (state.currentView === 'security') {
            console.log('Reloading action logs (security view active)');
            loadActionLogs();
          }
          break;
        case 'action_undone':
          showNotification('Action was undone', 'info');
          if (state.currentView === 'security') loadActionLogs();
          break;
        case 'notification':
          showNotification(data.message, data.level || 'info');
          break;
        case 'security_update':
          console.log('Security update received, refreshing data');
          if (state.currentView === 'security') refreshAll();
          break;
        case 'settings_updated':
          console.log('Settings updated:', data.settings);
          if (data.settings && data.settings.antiNuke) {
            showNotification('Anti-Nuke settings updated', 'success');
            // Refresh security view if currently displayed
            if (state.currentView === 'security') {
              setTimeout(() => refreshAll(), 500);
            }
          }
          break;
        case 'setting_confirmation':
          console.log('Setting confirmation received:', data.message);
          if (data.message) {
            showNotification(data.message, 'success');
          }
          break;
        case 'verification_update':
          console.log('Verification update received:', data.data);
          showNotification('Verification queue updated', 'info');
          try { loadVerificationQueue(); } catch (e) { console.warn('Failed to refresh verification queue:', e); }
          break;
        case 'dashboardEvent':
          // Handle all verification/moderation/security/system events
          console.log('Dashboard event received:', data.event, data);
          if (data.group === 'verification' && state.currentView === 'verification-queue') {
            handleVerificationEvent(data);
          }
          // Add to console if available
          if (window.addConsoleMessage) {
            window.addConsoleMessage({
              type: 'botConsole',
              level: 'event',
              message: data.message || data.event || 'Event',
              timestamp: data.timestamp || Date.now(),
              ...data
            });
          }
          break;
        case 'ticket_update':
          console.log('Ticket update received:', data.data);
          showNotification('Ticket updated', 'info');
          try { loadTickets(); } catch (e) { console.warn('Failed to refresh tickets:', e); }
          break;
        case 'analytics_update':
          // Handle live analytics updates for charts
          try {
            const analyticsData = data.data || data;
            const m = analyticsData.metrics || analyticsData;
            
            // Update state counters
            if (m.messages24h !== undefined) state.analytics.messages24h = m.messages24h;
            if (m.commands24h !== undefined) state.analytics.commands24h = m.commands24h;
            if (m.joins24h !== undefined) state.analytics.joins24h = m.joins24h;
            if (m.leaves24h !== undefined) state.analytics.leaves24h = m.leaves24h;
            
            // Handle incremental updates
            if (analyticsData.incrementType) {
              const incType = analyticsData.incrementType;
              if (incType === 'messages') state.analytics.messages24h = (state.analytics.messages24h || 0) + 1;
              if (incType === 'joins') state.analytics.joins24h = (state.analytics.joins24h || 0) + 1;
              if (incType === 'leaves') state.analytics.leaves24h = (state.analytics.leaves24h || 0) + 1;
            }
            
            scheduleAnalyticsRender();
            
            // Dispatch event for ChartManager (new system) - always dispatch
            window.dispatchEvent(new CustomEvent('analytics_update', { 
              detail: analyticsData
            }));
            
            // NOTE: Do NOT call initializeCharts() here - ChartManager handles updates
            // Calling initializeCharts would cause chart recreation instead of updates
            console.log('[WS] Analytics update dispatched to ChartManager');
          } catch (e) { console.warn('Failed to apply analytics update:', e); }
          break;
        case 'command_used':
          try {
            state.analytics.commands24h = (state.analytics.commands24h || 0) + 1;
            scheduleAnalyticsRender();
          } catch (e) {}
          break;
        case 'member_join':
          try {
            state.analytics.joins24h = (state.analytics.joins24h || 0) + 1;
            scheduleAnalyticsRender();
            // Dispatch for ChartManager - unified event
            window.dispatchEvent(new CustomEvent('analytics_update', { 
              detail: { 
                incrementType: 'joins',
                metrics: { joins24h: state.analytics.joins24h }
              }
            }));
          } catch (e) {}
          break;
        case 'member_leave':
          try {
            state.analytics.leaves24h = (state.analytics.leaves24h || 0) + 1;
            scheduleAnalyticsRender();
            // Dispatch for ChartManager - unified event
            window.dispatchEvent(new CustomEvent('analytics_update', { 
              detail: { 
                incrementType: 'leaves',
                metrics: { leaves24h: state.analytics.leaves24h }
              }
            }));
          } catch (e) {}
          break;
        case 'setting_change':
          try {
            // Setting was changed by bot command or another dashboard session
            console.log('[WS] Setting changed:', data.data);
            // Optionally reload settings view if currently visible
            if (state.currentView === 'settings') {
              // Debounce reload to avoid spamming
              clearTimeout(window.__settingChangeReloadTimer);
              window.__settingChangeReloadTimer = setTimeout(() => {
                loadSettings();
              }, 1000);
            }
          } catch (e) {}
          break;
        case 'settingChanged':
          try {
            // Same as setting_change - handle both variants
            console.log('[WS] Setting changed:', data.data);
            if (state.currentView === 'settings') {
              clearTimeout(window.__settingChangeReloadTimer);
              window.__settingChangeReloadTimer = setTimeout(() => {
                loadSettings();
              }, 1000);
            }
          } catch (e) {}
          break;
        case 'log':
          try {
            // New log entry from Logger system
            console.log('[WS] Log entry:', data.data);
            // Refresh logs view if currently visible
            if (state.currentView === 'logs') {
              clearTimeout(window.__logRefreshTimer);
              window.__logRefreshTimer = setTimeout(() => {
                if (typeof loadLogs === 'function') loadLogs();
              }, 500);
            }
          } catch (e) {}
          break;
        case 'timeout_alert':
          try {
            // User timeout notification
            console.log('[WS] Timeout alert:', data.data);
            showNotification('User Timeout', `${data.data?.userTag || 'User'} was timed out`, 'warning');
            // Refresh security events and metrics
            if (typeof loadSecurityEvents === 'function') loadSecurityEvents();
            if (typeof updateMetrics === 'function') updateMetrics();
          } catch (e) {}
          break;
        case 'spam_alert':
          try {
            // Spam detection notification
            console.log('[WS] Spam alert received:', data.data);
            showNotification('Spam Detected', `Spam detected from ${data.data?.userTag || 'a user'}`, 'danger');
            // Refresh security events and metrics
            if (typeof loadSecurityEvents === 'function') loadSecurityEvents();
            if (typeof updateMetrics === 'function') updateMetrics();

            // Also append to Recent Moderation Actions with admin controls
            try {
              const payload = data.data || {};
              const actionItem = {
                action_type: 'spam',
                created_at: payload.timestamp || Date.now(),
                target_username: payload.userTag || payload.username || 'Unknown User',
                target_user_id: payload.userId || payload.user_id || 'unknown',
                moderator_username: 'Auto-Mod System',
                reason: payload.reason || (payload.violationType ? `${payload.violationType.replace(/_/g, ' ')}` : 'Spam Detection'),
                duration: payload.duration || '25 minutes',
                can_undo: false,
                warning_count: payload.warningCount || payload.warning_count || 0,
                account_age: payload.accountAge || payload.account_age || 'Unknown'
              };
              console.log('[SPAM] Appending action to log:', actionItem);
              appendActionLogItem(actionItem, payload);
            } catch (e) { console.error('[SPAM] Failed to append spam action to log:', e); }
          } catch (e) { console.error('[SPAM] Error handling spam_alert:', e); }
          break;
        default:
          console.log('Unknown WebSocket message type:', data.type);
      }
    }

  // DOM Helpers
  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));

  // Minimal dashboard version badge updater (replaces removed What's New system)
  (function initVersionBadge() {
    function applyVersion(v) {
      const el = document.getElementById('dashboard-version');
      if (el && v) el.textContent = 'v' + v;
    }
    function fetchVersion() {
      fetch('/version.json', { cache: 'no-cache', credentials: 'include' })
        .then(r => r.ok ? r.json() : null)
        .then(d => applyVersion(d && d.version))
        .catch(() => {});
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fetchVersion);
    } else {
      fetchVersion();
    }
  })();

  // Append a single action to Recent Moderation Actions with inline admin buttons
  function appendActionLogItem(action, payload = {}) {
    const container = document.getElementById('action-log-list');
    if (!container) {
      console.warn('[SPAM] action-log-list container not found');
      return;
    }

    console.log('[SPAM] Appending item to action log, container found');

    // Remove empty state if present
    const empty = container.querySelector('.empty-state');
    if (empty) {
      empty.remove();
      console.log('[SPAM] Removed empty state');
    }

    const iconMap = { spam: '🚨', timeout: '⏱️', ban: '🔨', kick: '👢', warn: '⚠️' };
    const icon = iconMap[action.action_type] || '📝';
    const timeAgo = getTimeAgo(new Date(action.created_at));
    const channel = payload.channelName || payload.channel || '';
    const sample = payload.sample || payload.messageSample || '';
    const violationType = payload.violationType ? payload.violationType.replace(/_/g, ' ') : 'SPAM';

    const item = document.createElement('div');
    item.className = 'action-log-item spam-alert-item';
    item.style.cssText = 'border-left: 4px solid #ef4444; background: rgba(239, 68, 68, 0.05);';
    item.innerHTML = `
      <div class="action-icon" style="font-size: 2rem; width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; background: rgba(239, 68, 68, 0.15); border-radius: 12px;">${icon}</div>
      <div class="action-details" style="flex: 1;">
        <div class="action-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="action-type" style="font-weight: 700; font-size: 1rem; color: #ef4444;">🚨 Anti-Spam Action Taken</span>
            <span style="padding: 0.25rem 0.5rem; background: rgba(239, 68, 68, 0.2); color: #ef4444; border-radius: 6px; font-size: 0.75rem; font-weight: 600;">${violationType}</span>
          </div>
          <span class="action-time" style="font-size: 0.875rem; color: var(--color-muted);">${timeAgo}</span>
        </div>
        <div style="display: grid; gap: 0.5rem; margin-bottom: 0.75rem; font-size: 0.875rem;">
          <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
            <div><strong style="color: var(--color-text);">👤 User:</strong> <span style="color: var(--color-muted);">${escapeHtml(action.target_username)}</span> <code style="font-size: 0.75rem; background: rgba(255,255,255,0.05); padding: 2px 6px; border-radius: 4px;">${action.target_user_id}</code></div>
            ${channel ? `<div><strong style="color: var(--color-text);"># Channel:</strong> <span style="color: var(--color-muted);">${escapeHtml(channel)}</span></div>` : ''}
          </div>
          <div style="display: flex; gap: 1.5rem; flex-wrap: wrap;">
            ${action.warning_count > 0 ? `<div><strong style="color: var(--color-text);">⚠️ Warning Count:</strong> <span style="color: #fbbf24; font-weight: 600;">${action.warning_count}/5</span></div>` : ''}
            <div><strong style="color: var(--color-text);">⏱️ Action Taken:</strong> <span style="color: #3b82f6;">Timed out for ${action.duration}</span></div>
            ${action.account_age ? `<div><strong style="color: var(--color-text);">📅 Account Age:</strong> <span style="color: var(--color-muted);">${action.account_age}</span></div>` : ''}
          </div>
        </div>
        <div class="action-reason" style="padding: 0.75rem; background: rgba(59, 130, 246, 0.1); border-left: 3px solid #3b82f6; border-radius: 6px; margin-bottom: 0.75rem; font-size: 0.875rem;">
          <strong style="color: #3b82f6;">📋 Reason:</strong> <span style="color: var(--color-muted);">${escapeHtml(action.reason || 'Auto-Moderation')}</span>
        </div>
        ${sample ? `<div class="action-sample" style="margin-bottom: 0.75rem;">
          <div style="font-size: 0.75rem; font-weight: 600; color: var(--color-muted); margin-bottom: 0.25rem;">📝 Message Sample:</div>
          <code style="display:block; padding: 0.75rem; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; font-size: 0.875rem; color: #d6e4ff; font-family: 'Courier New', monospace; overflow-x: auto; white-space: pre-wrap; word-break: break-word;">${escapeHtml(sample)}</code>
        </div>` : ''}
        <div class="action-admin" style="display: flex; gap: 0.75rem; flex-wrap: wrap; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.1);">
          <button class="btn-secondary" data-act="remove-timeout" data-user-id="${action.target_user_id}" style="padding: 0.625rem 1.25rem; font-size: 0.875rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; background: linear-gradient(135deg,#15803d,#16a34a); color:#e9ffe9; border:1px solid rgba(22,163,74,0.45); box-shadow:0 2px 6px rgba(0,0,0,0.35);">
            <span>✅</span> Remove Timeout
          </button>
          <button class="btn-primary" data-act="warn" data-user-id="${action.target_user_id}" style="padding: 0.625rem 1.25rem; font-size: 0.875rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; background: linear-gradient(135deg, #f59e0b, #d97706);">
            <span>⚠️</span> Add Warning
          </button>
          <button class="btn-danger" data-act="kick" data-user-id="${action.target_user_id}" style="padding: 0.625rem 1.25rem; font-size: 0.875rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem;">
            <span>👢</span> Kick User
          </button>
          <button class="btn-danger" data-act="ban" data-user-id="${action.target_user_id}" style="padding: 0.625rem 1.25rem; font-size: 0.875rem; font-weight: 600; display: flex; align-items: center; gap: 0.5rem; background: linear-gradient(135deg, #dc2626, #991b1b);">
            <span>🔨</span> Ban User
          </button>
        </div>
      </div>
    `;

    // Prepend to the top
    container.insertBefore(item, container.firstChild);
    console.log('[SPAM] Item appended successfully');

    // Wire admin buttons to backend APIs
    const handler = async (btn, type) => {
      const userId = btn.getAttribute('data-user-id');
      const guildId = state.guildId;
      
      if (!userId || userId === 'unknown') {
        showNotification('❌ Cannot perform action: Invalid user ID', 'error');
        return;
      }

      if (!guildId) {
        showNotification('❌ Cannot perform action: No server selected', 'error');
        return;
      }

      try {
        btn.disabled = true;
        btn.style.opacity = '0.6';
        const originalText = btn.innerHTML;
        btn.innerHTML = '<span>⏳</span> Processing...';

        let endpoint = '';
        let body = { userId, reason: `Dashboard moderation action` };
        let actionName = '';

        switch (type) {
          case 'remove-timeout':
            endpoint = `/api/moderation/${guildId}/timeout/remove`;
            actionName = 'Remove Timeout';
            break;
          case 'warn':
            const warnReason = prompt('Enter reason for warning:', 'Spam/Flood violation');
            if (!warnReason) {
              btn.disabled = false;
              btn.style.opacity = '1';
              btn.innerHTML = originalText;
              return;
            }
            endpoint = `/api/moderation/${guildId}/warn`;
            body.reason = warnReason;
            actionName = 'Warning';
            break;
          case 'kick':
            const kickReason = prompt('Enter reason for kick:', 'Spam/Flood violation');
            if (!kickReason) {
              btn.disabled = false;
              btn.style.opacity = '1';
              btn.innerHTML = originalText;
              return;
            }
            if (!confirm(`Are you sure you want to kick ${action.target_username}?`)) {
              btn.disabled = false;
              btn.style.opacity = '1';
              btn.innerHTML = originalText;
              return;
            }
            endpoint = `/api/moderation/${guildId}/kick`;
            body.reason = kickReason;
            actionName = 'Kick';
            break;
          case 'ban':
            const banReason = prompt('Enter reason for ban:', 'Severe spam/flood violation');
            if (!banReason) {
              btn.disabled = false;
              btn.style.opacity = '1';
              btn.innerHTML = originalText;
              return;
            }
            if (!confirm(`⚠️ Are you sure you want to BAN ${action.target_username}? This is permanent unless manually unbanned.`)) {
              btn.disabled = false;
              btn.style.opacity = '1';
              btn.innerHTML = originalText;
              return;
            }
            endpoint = `/api/moderation/${guildId}/ban`;
            body.reason = banReason;
            body.deleteDays = 1;
            actionName = 'Ban';
            break;
        }

        if (!endpoint) {
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.innerHTML = originalText;
          return;
        }

        console.log(`[SPAM] Executing ${actionName} for user ${userId}`);
        const resp = await apiFetch(endpoint, { method: 'POST', body: JSON.stringify(body) });
        
        if (resp && resp.success) {
          showNotification(`✅ ${actionName} executed successfully for ${action.target_username}`, 'success');
          btn.innerHTML = '<span>✅</span> Done';
          btn.style.background = '#22c55e';
          setTimeout(() => {
            if (typeof loadActionLogs === 'function') loadActionLogs();
          }, 1000);
        } else {
          throw new Error(resp?.error || `Failed to execute ${actionName}`);
        }
      } catch (e) {
        console.error(`[SPAM] Action failed:`, e);
        showNotification(`❌ Failed to ${type}: ${e?.message || e}`, 'error');
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.innerHTML = btn.getAttribute('data-original-text') || 'Retry';
      }
    };

    item.querySelectorAll('.action-admin button').forEach(btn => {
      btn.setAttribute('data-original-text', btn.innerHTML);
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const act = e.currentTarget.getAttribute('data-act');
        handler(e.currentTarget, act);
      });
    });
  }

  // NOTE: Legacy update modal system removed – functions ensureModalExists/openUpdateModal/etc. intentionally retired.

  // JWT Decoder
  function decodeJWT(token) {
    try {
      const base = token.split('.')[1];
      const json = JSON.parse(atob(base.replace(/-/g, '+').replace(/_/g, '/')));
      return json;
    } catch(e) {
      console.error('JWT decode failed:', e);
      return null;
    }
  }

  // Auth Initialization with Token Validation
  async function initAuth() {
    console.log('[dashboard-pro.js] ===== STARTING AUTH CHECK =====');
    try {
      // With HttpOnly cookies, we can't read the token directly via JavaScript
      // Instead, call /api/me to verify authentication
      console.log('[dashboard-pro.js] Calling /api/me...');
      const response = await fetch('/api/me', {
        method: 'GET',
        credentials: 'include'
      });

      console.log('[dashboard-pro.js] Response status:', response.status);

      if (response.ok) {
        const data = await response.json();
        const payload = data.user;
        
        console.log('[dashboard-pro.js] Response data:', data);
        
        if (payload) {
          state.user = payload;
          // Set authToken to a placeholder since we can't access the real token
          state.authToken = 'httponly-cookie';
          updateUserUI(payload);
          
          try {
            const userId = payload.id || payload.userId || payload.discordId;
            if (userId) {
              window.CURRENT_USER_ID = userId;
              localStorage.setItem('currentUserId', userId);
              state.userId = userId;
            }
            const email = payload.email || payload.user?.email || null;
            if (email) state.userEmail = email;
          } catch (e) { /* ignore */ }
          
          console.log('[dashboard-pro.js] ✅ AUTH SUCCESS! User:', payload.username);
          try { loadSubscriptionStatus(); } catch (e) { console.warn('Subscription load after auth failed:', e); }
        } else {
          console.error('[dashboard-pro.js] ❌ Invalid user data from /api/me');
          redirectToLogin();
        }
      } else {
        // Not authenticated
        console.error('[dashboard-pro.js] ❌ NOT AUTHENTICATED - Status:', response.status);
        redirectToLogin();
      }
    } catch(e) {
      console.error('[dashboard-pro.js] ❌ AUTH EXCEPTION:', e);
      redirectToLogin();
    }
  }

  // Redirect to Login
  function redirectToLogin() {
    const currentPath = window.location.pathname;
    if (currentPath !== '/login' && currentPath !== '/') {
      window.location.href = '/login';
    }
  }

  // Logout Function - SERVER ONLY (no client-side cookie/localStorage manipulation)
  function logout() {
    // POST to server - server handles ALL cleanup (session destroy, cookie clearing)
    fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include'
    }).then(() => {
      window.location.href = '/login.html?logout=true';
    }).catch(err => {
      console.error('Logout error:', err);
      // Redirect anyway on error
      window.location.href = '/login.html?logout=true';
    });
  }

  // Update User UI
  function updateUserUI(user) {
    const nameEl = $('#user-name');
    const avatarEl = $('#user-avatar');
    const statusEl = $('#user-status');

    if (nameEl) {
      // Use global_name (display name) if available, fallback to username
      const displayName = user.globalName || user.username || 'User';
      nameEl.textContent = displayName;
    }

    if (avatarEl) {
      const userId = user.userId || user.discordId || user.id;
      if (user.avatar && userId) {
        const url = `https://cdn.discordapp.com/avatars/${userId}/${user.avatar}.png?size=96`;
        // Create or update img element
        let imgEl = avatarEl.querySelector('img');
        if (!imgEl) {
          imgEl = document.createElement('img');
          imgEl.style.width = '100%';
          imgEl.style.height = '100%';
          imgEl.style.borderRadius = '50%';
          imgEl.style.objectFit = 'cover';
          avatarEl.innerHTML = '';
          avatarEl.appendChild(imgEl);
        }
        imgEl.src = url;
        imgEl.alt = user.globalName || user.username || 'User';
      } else {
        // Use first letter of display name or username
        const fallbackName = user.globalName || user.username || 'U';
        avatarEl.innerHTML = fallbackName.charAt(0).toUpperCase();
      }
    }

    if (statusEl) {
      // Show username (handle) instead of "Online"
      const handle = user.discriminator && user.discriminator !== '0' 
        ? `${user.username}#${user.discriminator}` 
        : `@${user.username}`;
      statusEl.textContent = handle;
    }
  }

  // API Fetch Wrapper - Production Ready with Token Validation
  async function apiFetch(path, opts = {}) {
    // No need to check token since it's in HttpOnly cookie
    // The browser will send it automatically with credentials: 'include'

    const headers = Object.assign({}, opts.headers || {}, {
      'Content-Type': 'application/json'
      // Don't send Authorization header - token is in HttpOnly cookie
    });

    // Include selected guild/server id for multi-server accuracy
    if (state.guildId) {
      headers['X-Server-Id'] = state.guildId;
    }

    let res;
    try {
      res = await fetch(path, { ...opts, headers, credentials: 'include' });
    } catch (networkError) {
      console.error('[API] Network error:', networkError);
      showNotification('Network error - please check your connection', 'error');
      throw networkError;
    }

    // Handle authentication errors
    if (res.status === 401) {
      console.error('[AUTH] 401 Unauthorized - session expired or invalid');
      showNotification('Session expired - please log in again', 'error');
      setTimeout(() => logout(), 1500);
      throw new Error('Authentication required');
    }

    if (res.status === 403) {
      console.error('[AUTH] 403 Forbidden - insufficient permissions');
      const errorText = await res.text().catch(() => 'Token validation failed');
      console.error('[AUTH] Error details:', errorText);
      showNotification('Access denied - insufficient permissions', 'error');
      throw new Error('Insufficient permissions');
    }

    // Handle other errors
    if (!res.ok) {
      const text = await res.text().catch(() => 'Unknown error');
      console.error(`[API] Request failed ${res.status}:`, text);
      
      if (res.status === 500) {
        showNotification('Server error - please try again', 'error');
      } else if (res.status === 404) {
        showNotification('Resource not found', 'error');
      }
      
      throw new Error(`Request failed ${res.status}: ${text.slice(0, 120)}`);
    }

    // Parse response
    const ct = res.headers.get('Content-Type') || '';
    if (ct.includes('application/json')) {
      return await res.json();
    }
    return await res.text();
  }

  // Set Metric Value
  function setMetric(id, value, trend = null) {
    const valueEl = $(`#metric-${id}`);
    const trendEl = $(`#trend-${id}`);

    if (valueEl) {
      const displayValue = value == null ? '--' : value;
      valueEl.textContent = displayValue;
      console.log(`Set metric ${id}: ${displayValue}`);
    } else {
      console.warn(`Metric element not found: #metric-${id}`);
    }

    if (trendEl && trend) {
      trendEl.textContent = trend;
      trendEl.className = 'trend ' + (trend.startsWith('+') ? 'up' : trend.startsWith('-') ? 'down' : 'neutral');
    }
  }

  // Toggle Loading State
  function setLoading(section, isLoading) {
    state.loading[section] = isLoading;
    const container = $(`[data-section="${section}"]`);
    if (!container) return;

    if (isLoading) {
      container.classList.add('loading');
    } else {
      container.classList.remove('loading');
    }
  }

  function formatPeriodEnd(ts) {
    if (!ts) return null;
    const date = new Date(ts * 1000);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleString();
  }

  function getPlanBadge() {
    const sub = state.subscription || {};
    const plan = (sub.plan || 'free').toLowerCase();
    if (sub.active && plan === 'enterprise') return 'Enterprise ⭐';
    if (sub.active && plan === 'pro') return 'Pro ⭐';
    if (!sub.active && plan !== 'free') return `${plan.charAt(0).toUpperCase() + plan.slice(1)} (inactive)`;
    return 'Free';
  }

  function applySubscriptionUI() {
    const planBadge = getPlanBadge();
    const serverNameEl = $('#server-name');
    if (serverNameEl) {
      const baseName = serverNameEl.dataset.baseName || state.serverInfo?.name || serverNameEl.textContent || 'Server';
      serverNameEl.dataset.baseName = baseName;
      serverNameEl.textContent = `${baseName} • ${planBadge}`;
    }

    const settingsNote = document.querySelector('[data-tab="settings"] .card-pro');
    if (settingsNote) {
      const titleEl = settingsNote.querySelector('div > div:nth-child(2) > div:first-child');
      const subtitleEl = settingsNote.querySelector('div > div:nth-child(2) > div:nth-child(2)');
      if (titleEl) titleEl.textContent = `Plan: ${planBadge}`;
      if (subtitleEl) {
        const expiry = formatPeriodEnd(state.subscription?.current_period_end);
        const status = (state.subscription?.status || 'inactive').replace('_', ' ');
        const baseText = 'Changes apply instantly and sync with Discord.';
        const expiryText = expiry ? ` Renews/ends: ${expiry}.` : '';
        const statusPrefix = state.subscription?.active ? '' : '⚠️ ';
        subtitleEl.textContent = `${baseText} ${statusPrefix}Status: ${status}.${expiryText}`;
      }
    }

    const warnStatus = state.subscription?.status;
    if (warnStatus && warnStatus !== state.lastSubscriptionStatus) {
      if (['past_due', 'canceled', 'inactive'].includes(warnStatus) && (state.subscription?.plan || 'free') !== 'free') {
        showNotification('⚠️ Your subscription is not active. Please update billing to restore premium features.', 'warning');
      } else if (state.subscription?.active && (state.subscription?.plan === 'pro' || state.subscription?.plan === 'enterprise')) {
        showNotification(`⭐ ${planBadge} enabled for this server.`, 'success');
      }
      state.lastSubscriptionStatus = warnStatus;
    }

    const requiresPro = false; // Removed paywall requirement
    const antinukeToggle = $('#toggle-antinuke');
    if (antinukeToggle) {
      antinukeToggle.disabled = false; // Ensure toggle is always enabled
      const desc = antinukeToggle.closest('.toggle-row')?.querySelector('.toggle-desc');
      if (desc) {
        if (!desc.dataset.defaultText) {
          desc.dataset.defaultText = desc.textContent;
        }
        desc.textContent = desc.dataset.defaultText; // Restore default description
      }
    }

    // Hide Upgrade tab if user is already Pro/Enterprise and active
    try {
      const isPremium = Boolean(state.subscription?.active) && ['pro','enterprise'].includes((state.subscription?.plan || 'free').toLowerCase());
      const upBtn = document.getElementById('nav-upgrade');
      const custBtn = document.getElementById('nav-customize');
      if (upBtn) {
        upBtn.style.display = isPremium ? 'none' : '';
      }
      if (custBtn) {
        custBtn.style.display = isPremium ? '' : 'none';
      }
      // If currently on upgrade view and user becomes premium, jump to customize
      const upgradeContent = document.querySelector('.tab-content[data-tab="upgrade"]');
      if (upgradeContent && isPremium && state.currentView === 'upgrade') {
        switchView('customize');
      }
      // Apply UI locks/unlocks according to plan
      enforceUILocks(isPremium);
    } catch (_) {}
  }

  // Pro-only UI lock cues
  function enforceUILocks(isPremium) {
    // Generic Pro-only gating via data attributes
    const proOnlyElements = document.querySelectorAll('[data-pro-only]');
    proOnlyElements.forEach(el => {
      const reason = el.getAttribute('data-pro-only') || 'pro';
      if (!isPremium) {
        el.classList.add('pro-locked');
        el.setAttribute('aria-disabled', 'true');
        el.setAttribute('tabindex', '-1');
        el.title = `Requires Guardian Pro (${reason.replace(/-/g, ' ')})`;
        if ('disabled' in el) el.disabled = true;
      } else {
        el.classList.remove('pro-locked');
        el.removeAttribute('aria-disabled');
        el.removeAttribute('tabindex');
        el.removeAttribute('title');
        if ('disabled' in el) el.disabled = false;
      }
    });

    // Lock messaging in views (Analytics, Shared Access, Console)
    const banners = [
      { tab: 'analytics', msg: '🔒 Analytics are a Guardian Pro feature.' },
      { tab: 'shared-access', msg: '🔒 Shared Access is a Guardian Pro feature.' },
      { tab: 'console', msg: '🔒 Live Bot Console is a Guardian Pro feature.' }
    ];
    banners.forEach(({ tab, msg }) => {
      const view = document.querySelector(`.tab-content[data-tab="${tab}"]`);
      if (!view) return;
      let lockBanner = view.querySelector('.pro-lock-banner');
      if (!isPremium) {
        if (!lockBanner) {
          lockBanner = document.createElement('div');
          lockBanner.className = 'pro-lock-banner';
          lockBanner.style.cssText = 'margin:12px 0;padding:12px;border:1px solid #28406a;border-radius:10px;background:#0e1a32;color:#8fb9ff;display:flex;align-items:center;gap:10px;';
          lockBanner.innerHTML = `${msg} <a href="/payment" class="btn-secondary" style="margin-left:auto">Upgrade</a>`;
          view.insertBefore(lockBanner, view.firstChild);
        }
      } else if (lockBanner) {
        lockBanner.remove();
      }
    });
  }

  async function loadSubscriptionStatus() {
    // User-level subscription; independent of guild selection
    const userId = state.userId || window.CURRENT_USER_ID || localStorage.getItem('currentUserId');
    if (!userId) {
      console.warn('[SUBSCRIPTION] Missing userId; cannot load subscription');
      return;
    }
    try {
      const data = await apiFetch(`/api/subscription?userId=${encodeURIComponent(userId)}`);
      if (data && data.subscription) {
        state.subscription = data.subscription;
        applySubscriptionUI();
      } else if (data && (data.plan || data.active !== undefined)) {
        // Backwards compatibility if old endpoint structure accidentally hits here
        state.subscription = {
          plan: (data.plan || 'free').toLowerCase(),
          status: data.status || (data.active ? 'active' : 'inactive'),
          active: Boolean(data.active),
        };
        applySubscriptionUI();
      } else {
        console.warn('[SUBSCRIPTION] Unexpected response format', data);
      }
    } catch (error) {
      console.error('[SUBSCRIPTION] Failed to load subscription status:', error);
      // Do not overwrite existing premium state on transient failure
      if (!(state.subscription && state.subscription.active)) {
        enforceUILocks(false);
      }
    }
  }

  // Load Server Info
  async function loadServerInfo() {
    if (!state.guildId) return;
    setLoading('serverInfo', true);

    try {
      const data = await apiFetch(`/api/server-info?guildId=${encodeURIComponent(state.guildId)}`);
      state.serverInfo = data;

      setMetric('members', data.memberCount);
      setMetric('bots', data.botCount);
      setMetric('channels', data.channelCount);
      setMetric('roles', data.roleCount);
      setMetric('emojis', data.emojiCount);

      // Update server name in header
      const serverNameEl = $('#server-name');
      if (serverNameEl && data.name) {
        serverNameEl.textContent = data.name;
        serverNameEl.dataset.baseName = data.name;
      }

      applySubscriptionUI();
    } catch(e) {
      console.error('Failed to load server info:', e);
    } finally {
      setLoading('serverInfo', false);
    }
  }

  // Load Security Stats
  async function loadSecurityStats() {
    if (!state.guildId) {
      console.warn('Cannot load security stats: No guild ID');
      return;
    }
    setLoading('securityStats', true);

    try {
      const data = await apiFetch(`/api/security-stats?guildId=${encodeURIComponent(state.guildId)}`);
      console.log('Security stats loaded:', data);
      state.securityStats = data;

      setMetric('warnings', data.warnings || 0);
      setMetric('bans', data.bans || 0);
      setMetric('kicks', data.kicks || 0);
      setMetric('timeouts', data.timeouts || 0);
      setMetric('raids', data.raidsBlocked || 0);
    } catch(e) {
      console.error('Failed to load security stats:', e);
      // Set default values on error
      setMetric('warnings', 0);
      setMetric('bans', 0);
      setMetric('kicks', 0);
      setMetric('timeouts', 0);
      setMetric('raids', 0);
    } finally {
      setLoading('securityStats', false);
    }
  }

  // Load Tickets
  async function loadTickets() {
    if (!state.guildId) return;
    setLoading('tickets', true);

    try {
      const data = await apiFetch(`/api/tickets?guildId=${encodeURIComponent(state.guildId)}`);
      state.tickets = Array.isArray(data) ? data.slice(0, 10) : [];
      renderTickets();
    } catch(e) {
      console.error('Failed to load tickets:', e);
      renderTickets();
    } finally {
      setLoading('tickets', false);
    }
  }

  // Render Tickets
  function renderTickets() {
    const list = $('#ticket-list');
    if (!list) return;

    list.innerHTML = '';

    if (!state.tickets.length) {
      list.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🎫</div>
          <div class="empty-title">No Tickets Found</div>
          <div class="empty-desc">There are no tickets to display at the moment.</div>
        </div>
      `;
      return;
    }

    state.tickets.forEach(ticket => {
      const div = document.createElement('div');
      div.className = 'ticket-item';
      const ticketId = ticket.id || ticket.ticket_id || '';

      const statusClass = ticket.status === 'open' ? '' : 
                         ticket.status === 'pending' ? 'pending' : 'closed';

      const claimedBy = ticket.staff_id || ticket.claimed_by || null;

      div.innerHTML = `
        <div class="ticket-head">
          <div class="ticket-title">${escapeHtml(ticket.subject || 'Support Ticket')}</div>
          <div class="ticket-status ${statusClass}">${escapeHtml(ticket.status || 'open')}</div>
        </div>
        <div class="ticket-desc">${escapeHtml((ticket.description || 'No description provided').slice(0, 150))}</div>
        <div class="ticket-meta">
          <span>👤 ${escapeHtml(ticket.user || 'Unknown')}</span>
          <span>📅 ${escapeHtml(ticket.created || 'Recently')}</span>
        </div>
        <div class="ticket-actions">
          ${claimedBy ? `<span class="ticket-claimed">Claimed by <strong>${escapeHtml(claimedBy)}</strong></span>` : `<button class="btn ticket-claim-btn" data-ticket-id="${ticketId}">Claim</button>`}
          <button class="btn ticket-view-btn" data-ticket-id="${ticketId}">View</button>
        </div>
      `;

      list.appendChild(div);
    });

    // Attach ticket action handlers
    $$('.ticket-claim-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = btn.getAttribute('data-ticket-id');
        if (!id) return;
        const staffId = state.user?.discordId || state.user?.userId || state.user?.userId || null;
        if (!staffId) {
          showNotification('Cannot claim ticket: missing your ID', 'error');
          return;
        }
        try {
          btn.disabled = true;
          btn.textContent = 'Claiming...';
          const response = await apiFetch(`/api/guilds/${encodeURIComponent(state.guildId)}/tickets/${encodeURIComponent(id)}/claim`, {
            method: 'POST',
            body: JSON.stringify({ staffId })
          });
          if (response && (response.ok || response.success)) {
            showNotification('Ticket claimed', 'success');
            loadTickets();
          } else {
            showNotification(response.error || 'Failed to claim ticket', 'error');
            btn.disabled = false;
            btn.textContent = 'Claim';
          }
        } catch (err) {
          console.error('Claim ticket error:', err);
          showNotification('Failed to claim ticket', 'error');
          btn.disabled = false;
          btn.textContent = 'Claim';
        }
      });
    });
  }

  // ========================
  // ACTIVITY LOGS
  // ========================

  state.auditLogs = {
    items: [],
    page: 1,
    pageSize: 20,
    total: 0,
    filters: {
      type: '',
      user: '',
      range: 'all'
    }
  };

  async function loadAuditLogs(page = 1) {
    if (!state.guildId) return;
    setLoading('activity-logs', true);

    try {
      const params = new URLSearchParams({
        guildId: state.guildId,
        page,
        pageSize: state.auditLogs.pageSize,
        ...(state.auditLogs.filters.type && { eventType: state.auditLogs.filters.type }),
        ...(state.auditLogs.filters.user && { executor: state.auditLogs.filters.user }),
        ...(state.auditLogs.filters.range !== 'all' && { timeRange: state.auditLogs.filters.range })
      });

      const response = await apiFetch(`/api/audit-logs?${params}`);
      state.auditLogs.items = response.logs || [];
      state.auditLogs.page = page;
      state.auditLogs.total = response.total || 0;
      renderAuditLogs();
    } catch(e) {
      console.error('Failed to load audit logs:', e);
      showNotification('Failed to load audit logs', 'error');
      state.auditLogs.items = [];
      renderAuditLogs();
    } finally {
      setLoading('activity-logs', false);
    }
  }

  function renderAuditLogs() {
    const list = $('#audit-log-list');
    if (!list) return;

    list.innerHTML = '';

    if (!state.auditLogs.items.length) {
      list.innerHTML = `
        <div style="text-align: center; color: rgba(255,255,255,0.5); padding: 40px;">
          <div style="font-size: 32px; margin-bottom: 10px;">📭</div>
          <div>No activity logs found</div>
        </div>
      `;
      updateAuditPagination();
      return;
    }

    state.auditLogs.items.forEach((log, idx) => {
      const div = document.createElement('div');
      div.className = 'audit-log-item';
      div.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 15px;">
          <div style="flex-shrink: 0; width: 40px; height: 40px; background: rgba(16, 185, 129, 0.2); border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #10b981;">
            ⚙️
          </div>
          <div style="flex: 1;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
              <div>
                <div style="color: #fff; font-weight: 600; margin-bottom: 3px;">${escapeHtml(log.event_type || 'Unknown Event')}</div>
                <div style="color: rgba(255,255,255,0.6); font-size: 13px;">by <strong>${escapeHtml(log.executor || 'Unknown')}</strong></div>
              </div>
              <div style="color: rgba(255,255,255,0.4); font-size: 12px;">${new Date(log.timestamp).toLocaleString()}</div>
            </div>
            <div style="background: rgba(255,255,255,0.05); border-radius: 6px; padding: 12px; margin-bottom: 10px; max-height: 0; overflow: hidden; transition: max-height 0.3s ease;" class="audit-details" data-log-index="${idx}">
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; font-size: 13px;">
                <div>
                  <div style="color: rgba(255,255,255,0.4); margin-bottom: 4px;">Target</div>
                  <div style="color: #fff;">${escapeHtml(log.target || 'N/A')}</div>
                </div>
                <div>
                  <div style="color: rgba(255,255,255,0.4); margin-bottom: 4px;">Guild</div>
                  <div style="color: #fff;">${escapeHtml(log.guild_id || 'N/A')}</div>
                </div>
              </div>
              ${log.changes ? `
              <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.1);">
                <div style="color: rgba(255,255,255,0.4); margin-bottom: 8px; font-weight: 600;">Changes</div>
                <div style="background: rgba(0,0,0,0.3); padding: 8px; border-radius: 4px; font-family: monospace; font-size: 12px; max-height: 200px; overflow-y: auto; color: #aaa; white-space: pre-wrap; word-break: break-word;">
                  ${log.changes instanceof Object ? JSON.stringify(log.changes, null, 2) : escapeHtml(log.changes)}
                </div>
              </div>
              ` : ''}
            </div>
            <button class="audit-expand-btn" data-log-index="${idx}" style="padding: 6px 12px; background: rgba(255,255,255,0.1); color: #0096ff; border: 1px solid rgba(0, 150, 255, 0.3); border-radius: 4px; font-size: 12px; cursor: pointer; transition: all 0.2s ease;">
              Show Details
            </button>
          </div>
        </div>
      `;
      list.appendChild(div);
    });

    // Attach expand button handlers
    $$('.audit-expand-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = btn.getAttribute('data-log-index');
        const details = $(`[class="audit-details"][data-log-index="${idx}"]`);
        if (!details) return;

        const isExpanded = details.style.maxHeight !== '0px' && details.style.maxHeight !== '';
        if (isExpanded) {
          details.style.maxHeight = '0';
          btn.textContent = 'Show Details';
        } else {
          details.style.maxHeight = details.scrollHeight + 'px';
          btn.textContent = 'Hide Details';
        }
      });
    });

    updateAuditPagination();
  }

  function updateAuditPagination() {
    const totalPages = Math.ceil(state.auditLogs.total / state.auditLogs.pageSize);
    const pageInfo = $('#audit-page-info');
    const prevBtn = $('#audit-prev');
    const nextBtn = $('#audit-next');

    if (pageInfo) {
      pageInfo.textContent = `Page ${state.auditLogs.page} of ${totalPages || 1}`;
    }
    if (prevBtn) {
      prevBtn.disabled = state.auditLogs.page <= 1;
      // Remove old listeners by cloning
      const newPrevBtn = prevBtn.cloneNode(true);
      prevBtn.parentNode.replaceChild(newPrevBtn, prevBtn);
      newPrevBtn.addEventListener('click', () => {
        if (state.auditLogs.page > 1) loadAuditLogs(state.auditLogs.page - 1);
      });
    }
    if (nextBtn) {
      nextBtn.disabled = state.auditLogs.page >= totalPages;
      // Remove old listeners by cloning
      const newNextBtn = nextBtn.cloneNode(true);
      nextBtn.parentNode.replaceChild(newNextBtn, nextBtn);
      newNextBtn.addEventListener('click', () => {
        if (state.auditLogs.page < totalPages) loadAuditLogs(state.auditLogs.page + 1);
      });
    }
  }

  // Attach filter handlers
  function setupAuditLogFilters() {
    const filterBtn = $('#audit-filter-btn');
    const typeFilter = $('#audit-filter-type');
    const userFilter = $('#audit-filter-user');
    const rangeFilter = $('#audit-filter-range');

    if (filterBtn) {
      filterBtn.addEventListener('click', () => {
        if (typeFilter) state.auditLogs.filters.type = typeFilter.value;
        if (userFilter) state.auditLogs.filters.user = userFilter.value;
        if (rangeFilter) state.auditLogs.filters.range = rangeFilter.value;
        loadAuditLogs(1);
      });
    }
  }

  // --- Analytics Widgets ---
  function initAnalyticsWidgets() {
    // Ensure container elements exist; create simple live widget if not
    const container = $('#analytics-live');
    if (!container) return;

    container.innerHTML = `
      <div class="analytics-grid">
        <div class="analytics-card">
          <div class="analytics-label">Messages (24h)</div>
          <div id="metric-messages" class="analytics-value">--</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Commands (24h)</div>
          <div id="metric-commands" class="analytics-value">--</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Joins (24h)</div>
          <div id="metric-joins" class="analytics-value">--</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Leaves (24h)</div>
          <div id="metric-leaves" class="analytics-value">--</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Members</div>
          <div id="metric-members" class="analytics-value">--</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Channels</div>
          <div id="metric-channels" class="analytics-value">--</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Roles</div>
          <div id="metric-roles" class="analytics-value">--</div>
        </div>
        <div class="analytics-card">
          <div class="analytics-label">Actions (Today)</div>
          <div id="metric-actions-today" class="analytics-value">--</div>
        </div>
      </div>
      <div id="analytics-empty" class="analytics-empty" style="display:none;margin-top:10px;color:#999;font-style:italic">No analytics data yet</div>`;

    // Initial render from state
    renderAnalyticsWidgets();
  }

  // Debounced renderer to avoid UI thrashing on high-frequency WS events
  let __analyticsRenderTimer = null;
  const __ANALYTICS_RENDER_DEBOUNCE = 300; // ms

  function scheduleAnalyticsRender() {
    if (__analyticsRenderTimer) return;
    __analyticsRenderTimer = setTimeout(() => {
      __analyticsRenderTimer = null;
      renderAnalyticsWidgets();
    }, __ANALYTICS_RENDER_DEBOUNCE);
  }

  function renderAnalyticsWidgets() {
    try {
      const m = state.analytics || {};
      const mm = $('#metric-messages'); if (mm) mm.textContent = (m.messages24h != null ? m.messages24h : '--');
      const mc = $('#metric-commands'); if (mc) mc.textContent = (m.commands24h != null ? m.commands24h : '--');
      const mj = $('#metric-joins'); if (mj) mj.textContent = (m.joins24h != null ? m.joins24h : '--');
      const ml = $('#metric-leaves'); if (ml) ml.textContent = (m.leaves24h != null ? m.leaves24h : '--');
      const mmb = $('#metric-members'); if (mmb) mmb.textContent = (m.members != null ? m.members : '--');
      const mch = $('#metric-channels'); if (mch) mch.textContent = (m.channels != null ? m.channels : '--');
      const mrl = $('#metric-roles'); if (mrl) mrl.textContent = (m.roles != null ? m.roles : '--');
      const mat = $('#metric-actions-today'); if (mat) mat.textContent = (m.actionsToday != null ? m.actionsToday : '--');

      // No-data UX: show message when all metrics are null/undefined or zero
      const emptyEl = $('#analytics-empty');
      const anyMetric = [m.messages24h, m.commands24h, m.joins24h, m.leaves24h, m.members, m.channels, m.roles, m.actionsToday].some(v => v != null && v !== 0);
      if (emptyEl) {
        if (!anyMetric) {
          emptyEl.style.display = 'block';
        } else {
          emptyEl.style.display = 'none';
        }
      }
    } catch (e) { console.warn('renderAnalyticsWidgets error', e); }
  }

  // Overview stats loader
  async function loadOverviewStats() {
    if (!state.guildId) return;
    try {
      const res = await apiFetch(`/api/overview-stats?guildId=${encodeURIComponent(state.guildId)}`);
      if (res && res.success && res.stats) {
        state.analytics = Object.assign({}, state.analytics, {
          members: res.stats.members,
          channels: res.stats.channels,
          roles: res.stats.roles,
          actionsToday: res.stats.actionsToday
        });
        scheduleAnalyticsRender();
      }
    } catch (e) {
      console.warn('Failed to load overview stats:', e);
    }
  }

  // Verification Queue: load and render
  async function loadVerificationQueue() {
    if (!state.guildId) return;
    try {
      const res = await apiFetch(`/api/guilds/${encodeURIComponent(state.guildId)}/verification`);
      if (res && (res.ok || res.success) && Array.isArray(res.queue)) {
        state.verificationQueue = res.queue;
      } else {
        state.verificationQueue = res.queue || [];
      }
      renderVerificationQueue();
    } catch (err) {
      console.error('Failed to load verification queue:', err);
      state.verificationQueue = [];
      renderVerificationQueue();
    }
  }

  function renderVerificationQueue() {
    const container = $('#verification-queue');
    if (!container) return;

    const rows = Array.isArray(state.verificationQueue) ? state.verificationQueue : [];
    if (rows.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="empty-icon">✅</div><div class="empty-title">No pending verifications</div></div>`;
      return;
    }

    container.innerHTML = rows.map(row => {
      const id = row.id;
      const uid = row.user_id || row.userId || '';
      const type = row.verification_type || row.type || 'unknown';
      const created = new Date(row.created_at || row.createdAt || Date.now()).toLocaleString();
      return `
        <div class="verification-item" data-verification-id="${id}">
          <div class="verification-main">
            <div class="verification-user">User: <strong>${escapeHtml(uid)}</strong></div>
            <div class="verification-type">Type: ${escapeHtml(type)}</div>
            <div class="verification-time">Queued: ${escapeHtml(created)}</div>
          </div>
          <div class="verification-actions">
            <button class="btn verify-approve" data-id="${id}">Approve</button>
            <button class="btn verify-deny" data-id="${id}">Deny</button>
          </div>
        </div>`;
    }).join('');

    // Wire up buttons
    $$('.verify-approve').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        try {
          btn.disabled = true;
          btn.textContent = 'Approving...';
          const res = await apiFetch(`/api/guilds/${encodeURIComponent(state.guildId)}/verification/${encodeURIComponent(id)}/approve`, { method: 'POST' });
          if (res && (res.ok || res.success)) {
            showNotification('Verification approved', 'success');
            loadVerificationQueue();
          } else {
            showNotification(res.error || 'Failed to approve', 'error');
            btn.disabled = false;
            btn.textContent = 'Approve';
          }
        } catch (err) {
          console.error('Approve verification error:', err);
          showNotification('Failed to approve verification', 'error');
          btn.disabled = false;
          btn.textContent = 'Approve';
        }
      });
    });

    $$('.verify-deny').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = btn.getAttribute('data-id');
        if (!id) return;
        try {
          const action = prompt('Deny action (leave blank for none, "kick" or "ban"):', '');
          if (action === null) return; // cancelled
          btn.disabled = true;
          btn.textContent = 'Denying...';
          const body = action ? { action: action } : {};
          const res = await apiFetch(`/api/guilds/${encodeURIComponent(state.guildId)}/verification/${encodeURIComponent(id)}/deny`, { method: 'POST', body: JSON.stringify(body) });
          if (res && (res.ok || res.success)) {
            showNotification('Verification denied', 'success');
            loadVerificationQueue();
          } else {
            showNotification(res.error || 'Failed to deny', 'error');
            btn.disabled = false;
            btn.textContent = 'Deny';
          }
        } catch (err) {
          console.error('Deny verification error:', err);
          showNotification('Failed to deny verification', 'error');
          btn.disabled = false;
          btn.textContent = 'Deny';
        }
      });
    });
  }

  // Escape HTML
  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, s => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[s]));
  }

  // Quick Actions
  async function executeAction(path, label, method = 'POST', body = null) {
    if (!state.guildId) {
      console.warn('No guild ID available');
      return;
    }

    try {
      const options = { method };
      if (body) {
        options.headers = { 'Content-Type': 'application/json' };
        options.body = JSON.stringify(body);
      }
      await apiFetch(`${path}?guildId=${encodeURIComponent(state.guildId)}`, options);
      console.log(`${label} executed successfully`);
      showNotification(`${label} completed`, 'success');
      refreshAll();
    } catch(e) {
      console.error(`${label} failed:`, e);
      showNotification(`${label} failed`, 'error');
    }
  }

  // Show Notification (generic toast)
  function showNotification(message, type = 'info') {
    try {
      let container = document.getElementById('toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.style.position = 'fixed';
        container.style.top = '1rem';
        container.style.right = '1rem';
        container.style.zIndex = '1000';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '0.5rem';
        document.body.appendChild(container);
      }

      const toast = document.createElement('div');
      toast.className = 'toast-msg';
      toast.setAttribute('role', 'status');
      toast.style.padding = '0.6rem 0.9rem';
      toast.style.borderRadius = '6px';
      toast.style.fontSize = '0.85rem';
      toast.style.fontWeight = '600';
      toast.style.letterSpacing = '0.5px';
      toast.style.background = type === 'error' ? 'rgba(239,68,68,0.15)' : type === 'success' ? 'rgba(16,185,129,0.18)' : 'rgba(107,114,128,0.18)';
      toast.style.border = '1px solid ' + (type === 'error' ? 'rgba(239,68,68,0.4)' : type === 'success' ? 'rgba(16,185,129,0.4)' : 'rgba(107,114,128,0.4)');
      toast.style.color = 'var(--color-text)';
      toast.style.backdropFilter = 'blur(6px)';
      toast.style.boxShadow = '0 4px 12px rgba(0,0,0,0.25)';
      toast.style.animation = 'fadeIn 0.25s ease-out';
      toast.textContent = message;

      const close = document.createElement('span');
      close.textContent = '✕';
      close.style.marginLeft = '0.75rem';
      close.style.cursor = 'pointer';
      close.style.fontWeight = '700';
      close.addEventListener('click', () => {
        toast.style.animation = 'fadeOut 0.25s ease-in';
        setTimeout(() => toast.remove(), 200);
      });
      toast.appendChild(close);

      container.appendChild(toast);

      setTimeout(() => {
        if (!toast.isConnected) return;
        toast.style.animation = 'fadeOut 0.25s ease-in';
        setTimeout(() => toast.remove(), 200);
      }, 5000);
    } catch (err) {
      console.log(`[${type.toUpperCase()}] ${message}`);
    }
  }

  // Action Handlers
  window.dashboardActions = {
    // Always enable lockdown for now (could be enhanced to toggle based on status)
    lockdown: () => executeAction('/api/lockdown', 'Lockdown', 'POST', { action: 'enable', reason: 'Dashboard quick action' }),
    // Pause invites (backend accepts generic action string)
    pauseInvites: () => executeAction('/api/invites', 'Pause Invites', 'POST', { action: 'pause' }),
    // Clear raid flags uses DELETE
    clearRaidFlags: () => executeAction('/api/raid-flags', 'Clear Raid Flags', 'DELETE'),
    // Theme preview
    'preview-theme': () => {
      showNotification('👁️ Preview mode activated - changes are temporary', 'info');
      applyThemePreview();
    },
    // Save customization
    'save-customization': () => {
      saveThemeCustomization();
    },
    // Reset theme
    'reset-theme': () => {
      if (confirm('Are you sure you want to reset all theme settings to default?')) {
        // Reset all theme inputs to default values
        const defaults = {
          'theme-primary-color': '#10b981',
          'theme-accent-color': '#3b82f6',
          'theme-bg-color': '#0a1628',
          'theme-sidebar-color': '#0e1a32',
          'theme-font-family': 'inter',
          'theme-font-size': 'medium',
          'theme-density': 'normal',
          'theme-sidebar-position': 'left',
          'theme-click-sound': 'click',
          'theme-hover-effect': 'scale',
          'theme-click-animation': 'ripple',
          'theme-sound-volume': '50',
          'theme-border-radius': 'medium',
          'theme-shadow': 'medium',
          'theme-bg-pattern': 'none'
        };
        
        Object.entries(defaults).forEach(([id, value]) => {
          const el = $(`#${id}`);
          if (el) el.value = value;
        });
        
        // Reset checkboxes
        const checkDefaults = {
          'theme-animations-enabled': true,
          'theme-blur-enabled': false,
          'theme-smooth-scroll': true,
          'theme-reduce-motion': false,
          'theme-high-contrast': false,
          'theme-show-tooltips': true
        };
        
        Object.entries(checkDefaults).forEach(([id, value]) => {
          const el = $(`#${id}`);
          if (el) el.checked = value;
        });
        
        // Clear text inputs
        ['theme-title', 'theme-icon-url', 'theme-banner-url', 'theme-footer-text'].forEach(id => {
          const el = $(`#${id}`);
          if (el) el.value = '';
        });
        
        applyThemePreview();
        showNotification('✅ Theme reset to default', 'success');
      }
    }
  };

  // View Switching (legacy support)
  function switchView(viewName) {
    console.log('[VIEW] switchView ENTER:', viewName);
    
    // Stop chart auto-refresh when leaving analytics view
    if (state.currentView === 'analytics' && viewName !== 'analytics') {
      if (window.stopChartAutoRefresh) {
        window.stopChartAutoRefresh();
      }
    }
    
    state.currentView = viewName;

    // Update nav items (sidebar)
    $$('.nav-item').forEach(link => {
      const view = link.dataset.view;
      if (view === viewName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Update page title - mapping for all views
    const titles = {
      overview: 'Server Overview',
      tickets: 'Support Tickets',
      analytics: 'Analytics & Insights',
      logs: 'Logs & Audit',
      'security-antiraid': 'Anti-Raid Settings',
      'security-antispam': 'Anti-Spam Settings',
      'security-antinuke': 'Anti-Nuke Settings',
      'security-antiphishing': 'Anti-Phishing Settings',
      'security-moderation': 'Moderation Settings',
      'config-tickets': 'Ticket Configuration',
      'config-welcome': 'Welcome Message Settings',
      'config-goodbye': 'Goodbye Message Settings',
      'config-verification': 'Verification Settings',
      'config-autorole': 'Auto-Role Configuration',
      'bot-console': 'Bot Console',
      'access-generation': 'Access Code Generation',
      'access-share': 'Shared Access Management',
      'shared-access': 'Access Control',
      settings: 'Bot Settings',
      upgrade: 'Upgrade to Pro',
      help: 'Help & Documentation'
    };
    const titleEl = $('#page-title');
    if (titleEl) titleEl.textContent = titles[viewName] || 'Dashboard';

    switchTab(viewName);
    // Persist last selected view for future loads
    try { localStorage.setItem('dashboard:lastView', viewName); } catch (_) {}
    
    // Load data for specific views
    if (viewName === 'tickets') {
      loadTickets();
    } else if (viewName === 'analytics') {
      loadAnalytics();
    } else if (viewName === 'logs') {
      loadLogs();
    } else if (viewName.startsWith('security-')) {
      initSaveHandlers();
      const module = viewName.replace('security-', '');
      loadSecurityModuleSettings(module);
    } else if (viewName === 'config-tickets') {
      initSaveHandlers();
      loadTicketSettings();
    } else if (viewName === 'config-welcome') {
      initSaveHandlers();
      loadWelcomeSettings();
    } else if (viewName === 'config-goodbye') {
      initSaveHandlers();
      loadGoodbyeSettings();
    } else if (viewName === 'config-verification') {
      initSaveHandlers();
      loadVerificationSettings();
    } else if (viewName === 'config-autorole') {
      initSaveHandlers();
      loadAutoRoleSettings();
    } else if (viewName === 'bot-console') {
      initConsoleView();
    } else if (viewName === 'access-generation') {
      loadAccessGeneration();
    } else if (viewName === 'access-share') {
      loadAccessShare();
    } else if (viewName === 'shared-access') {
      loadSharedAccessView();
    } else if (viewName === 'upgrade') {
      bindUpgradeView();
    } else if (viewName === 'help') {
      // Help page loads automatically
    }
  }

  // Expose a minimal test hook to force loading the shared access view from console
  try {
    window.__testSharedAccess = function() {
      console.log('[TEST] Forcing shared-access view via __testSharedAccess');
      switchView('shared-access');
    };
    // Explicitly expose switchView for manual invocation / debugging
    window.switchView = switchView;
  } catch (e) { /* ignore */ }

  // Settings Tab Functions - ENHANCED WITH ADVANCED SETTINGS
  async function loadSettings() {
    if (!state.guildId) {
      console.warn('[SETTINGS] Cannot load settings: No guild ID');
      return;
    }

    try {
      console.log(`[SETTINGS] Loading settings for guild: ${state.guildId}`);
      
      const response = await apiFetch(`/api/dashboard-data?guildId=${encodeURIComponent(state.guildId)}`);
      const config = response.config || {};
      
      // Store in state.currentConfig for advanced settings modals
      state.currentConfig = config;
      
      console.log(`[SETTINGS] Received config for ${state.guildId}:`, config);

      // Load security toggles
      const toggles = [
        ['toggle-antiraid', 'anti_raid_enabled'],
        ['toggle-antispam', 'anti_spam_enabled'], 
        ['toggle-antiphishing', 'anti_phishing_enabled'],
        ['toggle-antinuke', 'antinuke_enabled'],
        ['toggle-welcome', 'welcome_enabled'],
        ['toggle-verification', 'verification_enabled'],
        ['toggle-tickets', 'tickets_enabled'],
        ['toggle-ai', 'ai_enabled'],
        ['toggle-automod', 'auto_mod_enabled'],
        ['toggle-autorole', 'autorole_enabled'],
        ['toggle-xp', 'xp_enabled']
      ];

      toggles.forEach(([elementId, configKey]) => {
        const element = document.getElementById(elementId);
        if (element) {
          const value = config[configKey];
          element.checked = Boolean(value);
          console.log(`[SETTINGS] ${elementId} = ${element.checked} (${configKey}: ${value})`);
        }
      });
      
      // Load advanced settings
      const advancedSettings = [
        ['raid-threshold', 'raid_threshold'],
        ['raid-timeout', 'raid_timeout_minutes'],
        ['raid-action', 'raid_action'],
        ['spam-threshold', 'spam_threshold'],
        ['spam-timeout', 'spam_timeout_seconds'],
        ['spam-mute-duration', 'spam_mute_duration'],
        ['verification-level', 'verification_level'],
        ['verification-age', 'verification_age_hours'],
        ['welcome-delete-after', 'welcome_delete_after'],
        ['ticket-max-open', 'ticket_max_open'],
        ['ticket-auto-close', 'ticket_auto_close_hours'],
        ['automod-toxicity', 'automod_toxicity_threshold'],
        ['automod-caps', 'automod_caps_percentage'],
        ['automod-emoji-limit', 'automod_emoji_limit'],
        ['automod-mention-limit', 'automod_mention_limit']
      ];
      
      advancedSettings.forEach(([elementId, configKey]) => {
        const element = document.getElementById(elementId);
        if (element && config[configKey] !== undefined) {
          element.value = config[configKey];
        }
      });
      
      // Load advanced toggles
      const advancedToggles = [
        ['raid-dm-notify', 'raid_dm_notify'],
        ['spam-delete-messages', 'spam_delete_messages'],
        ['antilinks-warn-user', 'antilinks_warn_user'],
        ['antilinks-log-attempts', 'antilinks_log_attempts'],
        ['verification-welcome-dm', 'verification_welcome_dm'],
        ['welcome-embed-enabled', 'welcome_embed_enabled'],
        ['welcome-ping-user', 'welcome_ping_user'],
        ['ticket-transcript-enabled', 'ticket_transcript_enabled'],
        ['ticket-rating-enabled', 'ticket_rating_enabled']
      ];
      
      advancedToggles.forEach(([elementId, configKey]) => {
        const element = document.getElementById(elementId);
        if (element) {
          element.checked = Boolean(config[configKey]);
        }
      });

      // IMPORTANT: Always reload channels/roles for current guild
      await loadChannelsAndRoles();
      
      // Set bot configuration dropdowns (server-specific)
      const dropdowns = [
        ['log-channel', 'log_channel_id'],
        ['alert-channel', 'log_channel_id'], 
        ['mod-role', 'mod_role_id'],
        ['admin-role', 'admin_role_id'],
        ['welcome-channel', 'welcome_channel_id'],
        ['verification-channel', 'verification_channel_id'],
        ['verification-role', 'verified_role_id'],
        ['ticket-category', 'ticket_category'],
        ['mute-role', 'mute_role_id'],
        ['autorole', 'autorole_id']
      ];
      
      dropdowns.forEach(([elementId, configKey]) => {
        const element = document.getElementById(elementId);
        if (element && config[configKey]) {
          element.value = config[configKey];
          console.log(`[SETTINGS] ${elementId} = ${config[configKey]}`);
        } else if (element) {
          element.value = ''; // Clear if no value
        }
      });
      
      // Load text fields
      const textFields = [
        ['welcome-message', 'welcome_message'],
        ['antilinks-whitelist', 'antilinks_whitelist'],
        ['verification-dm-message', 'verification_dm_message']
      ];
      
      textFields.forEach(([elementId, configKey]) => {
        const element = document.getElementById(elementId);
        if (element && config[configKey]) {
          element.value = config[configKey];
        }
      });
      
      // Load verification number inputs
      const verificationNumbers = [
        ['verification-expiration', 'verification_expiration', 10],
        ['verification-max-attempts', 'verification_max_attempts', 3],
        ['verification-cooldown', 'verification_cooldown', 30]
      ];
      
      verificationNumbers.forEach(([elementId, configKey, defaultVal]) => {
        const element = document.getElementById(elementId);
        if (element) {
          element.value = config[configKey] !== undefined ? config[configKey] : defaultVal;
        }
      });
      
      // Load verification select
      const verificationFailAction = document.getElementById('verification-fail-action');
      if (verificationFailAction) {
        verificationFailAction.value = config.verification_fail_action || 'nothing';
      }
      
      // Load verification toggles
      const verificationToggles = [
        ['verification-require-captcha', 'verification_require_captcha'],
        ['verification-log-attempts', 'verification_log_attempts']
      ];
      
      verificationToggles.forEach(([elementId, configKey]) => {
        const element = document.getElementById(elementId);
        if (element) {
          element.checked = Boolean(config[configKey]);
        }
      });
      
      // Load XP settings
      try {
        const xpResponse = await apiFetch(`/api/settings/xp?guildId=${encodeURIComponent(state.guildId)}`);
        if (xpResponse) {
          const msgXp = document.getElementById('xp-message-amount');
          const voiceXp = document.getElementById('xp-voice-amount');
          const cooldown = document.getElementById('xp-cooldown');
          const channel = document.getElementById('xp-levelup-channel');
          
          if (msgXp) {
            msgXp.value = xpResponse.xp_message || 20;
            const display = document.getElementById('xp-message-display');
            if (display) display.textContent = msgXp.value;
          }
          
          if (voiceXp) {
            voiceXp.value = xpResponse.xp_voice || 10;
            const display = document.getElementById('xp-voice-display');
            if (display) display.textContent = voiceXp.value;
          }
          
          if (cooldown) cooldown.value = xpResponse.xp_cooldown || 60;
          
          if (channel && xpResponse.xp_levelup_channel) {
            channel.value = xpResponse.xp_levelup_channel;
          }
          
          console.log('[XP] Loaded XP settings:', xpResponse);
        }
      } catch (error) {
        console.warn('[XP] Failed to load XP settings:', error);
      }
      
      applySubscriptionUI();
      console.log(`[SETTINGS] Settings loaded successfully for guild ${state.guildId}`);
      
    } catch (error) {
      console.error('[SETTINGS] Failed to load settings:', error);
      showNotification('Failed to load settings', 'error');
    }
  }

  async function loadChannelsAndRoles() {
    if (!state.guildId) {
      console.warn('Cannot load channels/roles: No guild ID');
      return;
    }

    console.log('Loading channels and roles for guild:', state.guildId);
    
    // Clear existing options first
    const channelSelects = ['#log-channel', '#alert-channel', '#welcome-channel', '#verification-channel', '#xp-levelup-channel'];
    const roleSelects = ['#mod-role', '#admin-role', '#verification-role'];
    const categorySelect = '#ticket-category';
    
    [...channelSelects, ...roleSelects, categorySelect].forEach(sel => {
      const el = $(sel);
      if (el) el.innerHTML = '<option value="">Loading...</option>';
    });

    try {
      // Load channels
      const channelsRes = await apiFetch(`/api/channels?guildId=${encodeURIComponent(state.guildId)}`);
      const channels = channelsRes.channels || [];
      
      console.log(`Loaded ${channels.length} channels for guild ${state.guildId}`);
      
      const channelSelects = ['#log-channel', '#alert-channel', '#welcome-channel', '#verification-channel', '#xp-levelup-channel'];
      channelSelects.forEach(sel => {
        const el = $(sel);
        if (el) {
          el.innerHTML = '<option value="">Select a channel...</option>';
          channels.forEach(ch => {
            const opt = document.createElement('option');
            opt.value = ch.id;
            opt.textContent = `# ${ch.name}`;
            el.appendChild(opt);
          });
        }
      });

      // Load categories for ticket category
      const categories = channels.filter(ch => ch.type === 4);
      const categoryEl = $('#ticket-category');
      if (categoryEl) {
        categoryEl.innerHTML = '<option value="">Select a category...</option>';
        categories.forEach(cat => {
          const opt = document.createElement('option');
          opt.value = cat.id;
          opt.textContent = cat.name;
          categoryEl.appendChild(opt);
        });
      }

      // Load roles
      const rolesRes = await apiFetch(`/api/roles?guildId=${encodeURIComponent(state.guildId)}`);
      const roles = rolesRes.roles || [];
      
      console.log(`Loaded ${roles.length} roles for guild ${state.guildId}`);
      
      const roleSelects = ['#mod-role', '#admin-role', '#verification-role'];
      roleSelects.forEach(sel => {
        const el = $(sel);
        if (el) {
          el.innerHTML = '<option value="">Select a role...</option>';
          roles.forEach(role => {
            if (role.name !== '@everyone') {
              const opt = document.createElement('option');
              opt.value = role.id;
              opt.textContent = role.name;
              el.appendChild(opt);
            }
          });
        }
      });
      
      console.log('Channels and roles loaded successfully');
    } catch(e) {
      console.error('Failed to load channels/roles:', e);
      showNotification('Failed to load channels and roles', 'error');
      
      // Reset to error state
      const allSelects = ['#log-channel', '#alert-channel', '#welcome-channel', '#verification-channel', '#xp-levelup-channel', '#mod-role', '#admin-role', '#verification-role', '#ticket-category'];
      allSelects.forEach(sel => {
        const el = $(sel);
        if (el) el.innerHTML = '<option value="">Error loading options</option>';
      });
    }
  }

  async function saveQuickSettings() {
    if (!state.guildId) {
      showNotification('No server selected', 'error');
      return;
    }

    const statusEl = $('#quick-settings-status');
    if (statusEl) statusEl.textContent = 'Saving...';

    try {
      console.log(`[SETTINGS] Saving quick settings for guild: ${state.guildId}`);
      
      // Only build settings object if elements exist (settings page loaded)
      const getToggleValue = (id) => {
        const el = $(id);
        return el ? (el.checked ? true : false) : null; // null = not loaded yet
      };

      const settings = {
        anti_raid_enabled: getToggleValue('#toggle-antiraid'),
        anti_spam_enabled: getToggleValue('#toggle-antispam'),
        anti_phishing_enabled: getToggleValue('#toggle-antiphishing'),
        antinuke_enabled: getToggleValue('#toggle-antinuke'),
        welcome_enabled: getToggleValue('#toggle-welcome'),
        verification_enabled: getToggleValue('#toggle-verification'),
        tickets_enabled: getToggleValue('#toggle-tickets'),
        ai_enabled: getToggleValue('#toggle-ai'),
        auto_mod_enabled: getToggleValue('#toggle-automod'),
        autorole_enabled: getToggleValue('#toggle-autorole'),
        xp_enabled: getToggleValue('#toggle-xp')
      };

      // Remove null values (toggles that don't exist on page)
      Object.keys(settings).forEach(key => {
        if (settings[key] === null) delete settings[key];
      });

      // If no valid settings, abort (page not loaded yet)
      if (Object.keys(settings).length === 0) {
        console.warn('[SETTINGS] No toggle elements found, skipping save');
        if (statusEl) statusEl.textContent = '';
        return;
      }

      // Allow both welcome and verification to be ON concurrently (no client-side exclusivity)

      console.log('[SETTINGS] Saving settings:', settings);

      // Include guildId so backend updates the correct guild row
      const payload = { guildId: state.guildId, setting: state.lastSettingChanged || null, ...settings };

      const response = await apiFetch(`/api/settings/update`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      if (response.success) {
        if (statusEl) {
          statusEl.textContent = '✅ Saved successfully';
          statusEl.style.color = 'var(--color-success)';
        }
        showNotification('Settings saved successfully', 'success');
        console.log('[SETTINGS] Quick settings saved successfully');
      } else {
        throw new Error(response.error || 'Save failed');
      }
    } catch (error) {
      console.error('[SETTINGS] Failed to save quick settings:', error);
      if (statusEl) {
        statusEl.textContent = '❌ Failed to save';
        statusEl.style.color = 'var(--color-danger)';
      }
      showNotification('Failed to save settings', 'error');
    }

    setTimeout(() => {
      if (statusEl) statusEl.textContent = '';
    }, 3000);
  }

  async function saveBotConfig() {
    if (!state.guildId) {
      showNotification('No server selected', 'error');
      return;
    }

    const statusEl = $('#bot-config-status');
    if (statusEl) statusEl.textContent = 'Saving...';

    try {
      console.log(`[SETTINGS] Saving bot config for guild: ${state.guildId}`);
      
      const settings = {
        log_channel_id: $('#log-channel')?.value || '',
        alert_channel: $('#alert-channel')?.value || '',
        mod_role_id: $('#mod-role')?.value || '',
        admin_role_id: $('#admin-role')?.value || '',
        welcome_channel: $('#welcome-channel')?.value || '',
        welcome_message: $('#welcome-message')?.value || '',
        verification_channel_id: $('#verification-channel')?.value || '',
        verification_role_id: $('#verification-role')?.value || '',
        ticket_category: $('#ticket-category')?.value || '',
        // Advanced Verification Settings
        verification_dm_message: $('#verification-dm-message')?.value || '',
        verification_expiration: parseInt($('#verification-expiration')?.value) || 10,
        verification_max_attempts: parseInt($('#verification-max-attempts')?.value) || 3,
        verification_cooldown: parseInt($('#verification-cooldown')?.value) || 30,
        verification_fail_action: $('#verification-fail-action')?.value || 'nothing',
        verification_require_captcha: $('#verification-require-captcha')?.checked || false,
        verification_log_attempts: $('#verification-log-attempts')?.checked || false
      };

      console.log('[SETTINGS] Saving bot config:', settings);
      
      const response = await apiFetch(`/api/bot-settings?guildId=${encodeURIComponent(state.guildId)}`, {
        method: 'POST',
        body: JSON.stringify(settings)
      });

      if (response.success) {
        if (statusEl) {
          statusEl.textContent = '✅ Saved successfully';
          statusEl.style.color = 'var(--color-success)';
        }
        showNotification('Bot configuration saved successfully', 'success');
        console.log('[SETTINGS] Bot config saved successfully');
      } else {
        throw new Error(response.error || 'Save failed');
      }
    } catch (error) {
      console.error('[SETTINGS] Failed to save bot config:', error);
      if (statusEl) {
        statusEl.textContent = '❌ Failed to save';
        statusEl.style.color = 'var(--color-danger)';
      }
      showNotification('Failed to save bot configuration', 'error');
    }

    setTimeout(() => {
      if (statusEl) statusEl.textContent = '';
    }, 3000);
  }
  
  async function saveAdvancedSettings() {
    if (!state.guildId) {
      showNotification('No server selected', 'error');
      return;
    }

    const statusEl = $('#advanced-settings-status');
    if (statusEl) statusEl.textContent = 'Saving...';

    try {
      console.log(`[SETTINGS] Saving advanced settings for guild: ${state.guildId}`);
      
      const settings = {
        // Anti-Raid Advanced Settings
        raid_threshold: parseInt($('#raid-threshold')?.value) || 5,
        raid_timeout_minutes: parseInt($('#raid-timeout')?.value) || 10,
        raid_action: $('#raid-action')?.value || 'kick',
        raid_dm_notify: $('#raid-dm-notify')?.checked || false,
        
        // Anti-Spam Advanced Settings  
        spam_threshold: parseInt($('#spam-threshold')?.value) || 3,
        spam_timeout_seconds: parseInt($('#spam-timeout')?.value) || 30,
        spam_delete_messages: $('#spam-delete-messages')?.checked || true,
        spam_mute_duration: parseInt($('#spam-mute-duration')?.value) || 300,
        
        // Verification Advanced Settings
        verification_level: parseInt($('#verification-level')?.value) || 1,
        verification_age_hours: parseInt($('#verification-age')?.value) || 24,
        verification_role_id: $('#verification-role')?.value || null,
        verification_welcome_dm: $('#verification-welcome-dm')?.checked || true,
        
        // Welcome Advanced Settings
        welcome_embed_enabled: $('#welcome-embed-enabled')?.checked || true,
        welcome_ping_user: $('#welcome-ping-user')?.checked || false,
        welcome_delete_after: parseInt($('#welcome-delete-after')?.value) || 0,
        
        // Ticket Advanced Settings
        ticket_max_open: parseInt($('#ticket-max-open')?.value) || 3,
        ticket_auto_close_hours: parseInt($('#ticket-auto-close')?.value) || 72,
        ticket_transcript_enabled: $('#ticket-transcript-enabled')?.checked || true,
        ticket_rating_enabled: $('#ticket-rating-enabled')?.checked || true,
        
        // AutoMod Advanced Settings
        automod_toxicity_threshold: parseFloat($('#automod-toxicity')?.value) || 0.8,
        automod_caps_percentage: parseInt($('#automod-caps')?.value) || 70,
        automod_emoji_limit: parseInt($('#automod-emoji-limit')?.value) || 10,
        automod_mention_limit: parseInt($('#automod-mention-limit')?.value) || 5
      };

      console.log('[SETTINGS] Saving advanced settings:', settings);
      
      const response = await apiFetch(`/api/advanced-settings?guildId=${encodeURIComponent(state.guildId)}`, {
        method: 'POST',
        body: JSON.stringify(settings)
      });

      if (response.success) {
        if (statusEl) {
          statusEl.textContent = '✅ Advanced settings saved';
          statusEl.style.color = 'var(--color-success)';
        }
        showNotification('Advanced settings saved successfully', 'success');
        console.log('[SETTINGS] Advanced settings saved successfully');
      } else {
        throw new Error(response.error || 'Save failed');
      }
    } catch (error) {
      console.error('[SETTINGS] Failed to save advanced settings:', error);
      if (statusEl) {
        statusEl.textContent = '❌ Failed to save';
        statusEl.style.color = 'var(--color-danger)';
      }
      showNotification('Failed to save advanced settings', 'error');
    }

    setTimeout(() => {
      if (statusEl) statusEl.textContent = '';
    }, 3000);
  }

  async function resetSettings() {
    if (!confirm('⚠️ Are you sure you want to reset ALL settings to default? This cannot be undone!')) {
      return;
    }

    if (!state.guildId) return;

    try {
      const response = await apiFetch(`/api/reset-settings?guildId=${encodeURIComponent(state.guildId)}`, {
        method: 'POST'
      });
      
      if (response.success) {
        showNotification('All settings have been reset to default values', 'success');
        // Reload settings after reset
        setTimeout(() => {
          loadSettings();
        }, 1000);
      } else {
        showNotification(response.error || 'Failed to reset settings', 'error');
      }
    } catch(e) {
      console.error('Failed to reset settings:', e);
      showNotification('Failed to reset settings', 'error');
    }
  }

  async function clearLogs() {
    if (!confirm('⚠️ Are you sure you want to clear ALL logs? This cannot be undone!')) {
      return;
    }

    if (!state.guildId) return;

    try {
      await apiFetch(`/api/logs?guildId=${encodeURIComponent(state.guildId)}`, {
        method: 'DELETE'
      });
      showNotification('Logs cleared successfully', 'success');
    } catch(e) {
      console.error('Failed to clear logs:', e);
      showNotification('Failed to clear logs', 'error');
    }
  }

  // View Switching (legacy support) - REMOVED DUPLICATE
  function switchViewLegacy(viewName) {
    if (viewName === 'console') {
      initConsoleView();
    }
    if (viewName === 'analytics') {
      const hasPremium = state.subscription?.active && (state.subscription?.plan === 'pro' || state.subscription?.plan === 'enterprise');
      if (!hasPremium) {
        showNotification('❌ This feature requires the **Pro plan**.', 'error');
        return;
      }
    }
    state.currentView = viewName;
    $$('.nav-link').forEach(link => {
      const view = link.getAttribute('data-view');
      if (view === viewName) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });

    // Switch tabs
    switchTab(viewName);

    // Update page title
    const titles = {
      overview: 'Server Overview',
      security: 'Security Dashboard',
      tickets: 'Ticket Management',
      permissions: 'Command Permissions',
      analytics: 'Analytics & Insights',
      settings: 'Server Settings'
    };

    const titleEl = $('#page-title');
    if (titleEl) {
      titleEl.textContent = titles[viewName] || 'Dashboard';
    }
  }

  // Tab Switching
  function switchTab(tabName) {
    if (tabName === 'console') initConsoleView();
    if (tabName === 'console') {
      initConsoleView();
    }
    // Load activity logs when switching to activity-logs tab
    if (tabName === 'activity-logs') {
      try {
        setupAuditLogFilters();
        loadAuditLogs(1);
      } catch (e) {
        console.warn('Failed to load activity logs:', e);
      }
    }
    // Update tab buttons
    $$('.tab-btn').forEach(btn => {
      const tab = btn.getAttribute('data-tab');
      if (tab === tabName) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });

    // Update tab content
    $$('.tab-content').forEach(content => {
      const tab = content.getAttribute('data-tab');
      if (tab === tabName) {
        content.classList.add('active');
      } else {
        content.classList.remove('active');
      }
    });
  }

  // Helper: ensure Upgrade view button is bound (top-level so switchView can call it)
  function bindUpgradeView() {
    try {
      const btn = document.getElementById('btn-activate');
      if (!btn || btn.__bound) return;
      btn.__bound = true;
      btn.addEventListener('click', async () => {
        try {
          const codeInput = document.getElementById('activation-code');
          const resultEl = document.getElementById('activate-result');
          const code = (codeInput?.value || '').trim();
          if (!code) {
            showNotification('Please enter your activation code', 'warning');
            return;
          }
          const uid = state.userId || window.CURRENT_USER_ID || localStorage.getItem('currentUserId');
          if (!uid) {
            showNotification('Missing user ID. Please re-login.', 'error');
            return;
          }
          btn.disabled = true; btn.textContent = 'Verifying...';
          if (resultEl) { resultEl.style.color = '#8fb9ff'; resultEl.textContent = 'Checking code...'; }

          const payload = { code, userId: uid, email: state.userEmail || null };
          const r = await apiFetch('/api/activate-code', { method: 'POST', body: JSON.stringify(payload) });
          if (r && r.success) {
            if (resultEl) { resultEl.style.color = '#10b981'; resultEl.textContent = '✅ Pro unlocked!'; }
            // Mark as premium client-side immediately and refresh UI locks
            state.subscription = { plan: 'pro', status: 'active', active: true };
            try { applySubscriptionUI(); } catch(_) {}
            try { enforceUILocks(true); } catch(_) {}
            try { launchConfetti({ count: 120, waves: 3, interval: 250 }); } catch(_) {}
            try { playSuccessChime(); } catch(_) {}
            btn.textContent = 'Unlocked ✓';
          } else {
            const msg = (r && r.error) ? r.error : 'Failed to activate code';
            showNotification(msg, 'error');
            if (resultEl) { resultEl.style.color = '#ff9aa2'; resultEl.textContent = `❌ ${msg}`; }
            btn.disabled = false; btn.textContent = 'Unlock Pro';
          }
        } catch (e) {
          showNotification('Activation failed', 'error');
          const res = document.getElementById('activate-result');
          if (res) { res.style.color = '#ff9aa2'; res.textContent = '❌ Activation failed'; }
          btn.disabled = false; btn.textContent = 'Unlock Pro';
        }
      });
    } catch(e) { console.warn('bindUpgradeView failed:', e); }
  }

  // Bind Event Listeners
  function bindEvents() {
    // Ensure console view initialization function exists
    window.initConsoleView = function() {
      try {
        if (!state.guildId) return;
        // Subscribe explicitly (handles guild changes)
        if (ws && ws.readyState === WebSocket.OPEN) {
          try { ws.send(JSON.stringify({ type: 'subscribe', guildId: state.guildId })); } catch (_) {}
        }
        // Backfill
        fetch(`/api/logs/${encodeURIComponent(state.guildId)}`, { credentials: 'include' }).then(r => r.json()).then(list => {
          if (Array.isArray(list)) {
            list.forEach(entry => window.addConsoleMessage && window.addConsoleMessage(entry));
          }
          // Flush any pending messages queued before renderer existed
          if (window.__pendingConsole && window.__pendingConsole.length) {
            window.__pendingConsole.forEach(m => window.addConsoleMessage(m));
            window.__pendingConsole = [];
          }
        }).catch(() => {});
      } catch (e) { console.warn('initConsoleView failed:', e); }
    };
    // Console controls (defer binding until present)
    const pauseBtn = document.getElementById('console-pause-btn');
    const clearBtn = document.getElementById('console-clear-btn');
    const downloadBtn = document.getElementById('console-download-btn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        window.consolePaused = !window.consolePaused;
        pauseBtn.textContent = window.consolePaused ? '▶ Resume' : '⏸️ Pause';
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        const out = document.getElementById('console-output');
        if (out) out.innerHTML = '';
        if (state.guildId) {
          try { await apiFetch(`/api/logs/${encodeURIComponent(state.guildId)}/clear`, { method: 'POST' }); } catch (_) {}
        }
      });
    }
    if (downloadBtn) {
      downloadBtn.addEventListener('click', () => {
        const out = document.getElementById('console-output');
        if (!out) return;
        const lines = Array.from(out.children).map(n => n.textContent).join('\n');
        const blob = new Blob([lines], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `bot-console-${Date.now()}.log`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      });
    }
    // Nav links (sidebar)
    const navLinks = $$('.nav-link');
    console.log('[BIND] Found', navLinks.length, 'nav links to bind');
    navLinks.forEach(link => {
      const view = link.getAttribute('data-view');
      console.log('[BIND] Binding nav link for view:', view);
      
      // Remove any existing listeners first
      const newLink = link.cloneNode(true);
      link.parentNode.replaceChild(newLink, link);
      
      newLink.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('[NAV] Clicked nav link, switching to view:', view);
        switchView(view);
      });
    });

    // Tab buttons
    $$('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.getAttribute('data-tab');
      if (tab) {
        switchTab(tab);
        state.currentView = tab;
        
        // Load settings when switching to settings tab
        if (tab === 'settings') {
          loadSettings();
        }
        
        // Load security data when switching to security tab
        if (tab === 'security') {
          loadSecurityStats();
          loadActionLogs();
        }
        if (tab === 'permissions') {
          loadCommandPermissions();
        }
        
        // Load shared access data when switching to shared access tab
        if (tab === 'shared-access') {
          console.log('[TAB-BTN] Shared Access tab clicked, calling loadSharedAccessView()...');
          loadSharedAccessView();
        }
        
        // Load levels data when switching to levels tab
        if (tab === 'levels') {
          loadLevelsView();
        }
        if (tab === 'console') {
          initConsoleView();
        }
        if (tab === 'customize') {
          initCustomizeView();
        }
        if (tab === 'upgrade') {
          bindUpgradeView();
        }
          
          // Sync sidebar nav
          $$('.nav-link').forEach(link => {
            if (link.getAttribute('data-view') === tab) {
              link.classList.add('active');
            } else {
              link.classList.remove('active');
            }
          });
        }
      });
    });

  // Theme preset definitions
  const themePresets = {
    emerald: { primary: '#10b981', accent: '#3b82f6', bg: '#0a1628', sidebar: '#0e1a32' },
    ocean: { primary: '#3b82f6', accent: '#06b6d4', bg: '#0c1e3a', sidebar: '#1e3a8a' },
    sunset: { primary: '#f59e0b', accent: '#ef4444', bg: '#1a0f0a', sidebar: '#991b1b' },
    amethyst: { primary: '#a855f7', accent: '#ec4899', bg: '#1a0a2e', sidebar: '#581c87' },
    midnight: { primary: '#64748b', accent: '#94a3b8', bg: '#0f172a', sidebar: '#1e293b' },
    rose: { primary: '#fb7185', accent: '#f43f5e', bg: '#1a0a12', sidebar: '#9f1239' }
  };

  // Play click sound
  function playClickSound(sound, volume) {
    try {
      if (sound === 'none') return;
      
      const sounds = {
        click: [1000, 0.05],
        pop: [1200, 0.08],
        beep: [800, 0.1],
        swoosh: [600, 0.12],
        tap: [1400, 0.06]
      };
      
      if (!sounds[sound]) return;
      
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      oscillator.frequency.value = sounds[sound][0];
      oscillator.type = 'sine';
      
      gainNode.gain.setValueAtTime(volume * sounds[sound][1], audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.1);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.1);
    } catch (err) {
      console.warn('[Sound] Failed to play:', err);
    }
  }

  // Apply theme preview (temporary visual changes)
  function applyThemePreview() {
    try {
      const primaryColor = $('#theme-primary-color')?.value || '#10b981';
      const accentColor = $('#theme-accent-color')?.value || '#3b82f6';
      const bgColor = $('#theme-bg-color')?.value || '#0a1628';
      const sidebarColor = $('#theme-sidebar-color')?.value || '#0e1a32';

      // Apply CSS variables temporarily
      document.documentElement.style.setProperty('--color-primary', primaryColor);
      document.documentElement.style.setProperty('--color-accent', accentColor);
      document.documentElement.style.setProperty('--color-bg', bgColor);
      document.documentElement.style.setProperty('--color-sidebar', sidebarColor);

      // Visual feedback
      showNotification('Preview applied! Click "Save Theme" to make it permanent.', 'success');
    } catch (err) {
      console.error('[Theme] Preview error:', err);
      showNotification('Failed to apply preview', 'error');
    }
  }

  // Save theme customization
  async function saveThemeCustomization() {
    try {
      if (!state.guildId) {
        showNotification('No server selected', 'error');
        return;
      }

      // Collect theme settings
      const themeData = {
        primaryColor: $('#theme-primary-color')?.value || '#10b981',
        accentColor: $('#theme-accent-color')?.value || '#3b82f6',
        bgColor: $('#theme-bg-color')?.value || '#0a1628',
        sidebarColor: $('#theme-sidebar-color')?.value || '#0e1a32',
        fontFamily: $('#theme-font-family')?.value || 'Inter',
        fontSize: $('#theme-font-size')?.value || 'medium',
        density: $('#theme-density')?.value || 'comfortable',
        sidebarPosition: $('#theme-sidebar-position')?.value || 'left',
        clickSound: $('#theme-click-sound')?.value || 'none',
        hoverEffect: $('#theme-hover-effect')?.value || 'subtle',
        clickAnimation: $('#theme-click-animation')?.value || 'ripple',
        animationsEnabled: $('#theme-animations-enabled')?.checked !== false,
        soundVolume: $('#theme-sound-volume')?.value || '50',
        customTitle: $('#theme-title')?.value || '',
        customIcon: $('#theme-icon-url')?.value || '',
        customBanner: $('#theme-banner-url')?.value || '',
        customFooter: $('#theme-footer-text')?.value || '',
        borderRadius: $('#theme-border-radius')?.value || 'medium',
        shadowIntensity: $('#theme-shadow')?.value || 'medium',
        bgPattern: $('#theme-bg-pattern')?.value || 'none',
        blurEnabled: $('#theme-blur-enabled')?.checked || false,
        smoothScroll: $('#theme-smooth-scroll')?.checked !== false,
        reduceMotion: $('#theme-reduce-motion')?.checked || false,
        highContrast: $('#theme-high-contrast')?.checked || false,
        showTooltips: $('#theme-show-tooltips')?.checked !== false
      };

      showNotification('💾 Saving theme...', 'info');

      const response = await apiFetch('/api/settings/theme', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          theme: themeData
        })
      });

      if (response && response.success) {
        showNotification('✅ Theme saved successfully!', 'success');
        // Apply the saved theme globally and persist to localStorage
        try {
          localStorage.setItem('dashboardTheme', JSON.stringify(themeData));
        } catch(e) {}
        applyThemePreview();
      } else {
        throw new Error(response?.error || 'Save failed');
      }
    } catch (err) {
      console.error('[Theme] Save error:', err);
      showNotification('Failed to save theme: ' + (err.message || 'Unknown error'), 'error');
    }
  }

  // Apply theme preview to current page
  function applyThemePreview() {
    try {
      const root = document.documentElement;
      
      // Color palette
      const primary = $('#theme-primary-color')?.value || '#10b981';
      const accent = $('#theme-accent-color')?.value || '#3b82f6';
      const bg = $('#theme-bg-color')?.value || '#0a1628';
      const sidebar = $('#theme-sidebar-color')?.value || '#0e1a32';
      
      root.style.setProperty('--color-primary', primary);
      root.style.setProperty('--color-accent', accent);
      root.style.setProperty('--color-bg', bg);
      root.style.setProperty('--color-sidebar', sidebar);
      
      // Typography
      const fontFamily = $('#theme-font-family')?.value || 'system';
      const fontSize = $('#theme-font-size')?.value || 'medium';
      
      const fontMap = {
        system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        inter: '"Inter", sans-serif',
        roboto: '"Roboto", sans-serif',
        poppins: '"Poppins", sans-serif',
        jetbrains: '"JetBrains Mono", monospace',
        georgia: 'Georgia, serif'
      };
      
      const sizeMap = {
        small: '14px',
        medium: '16px',
        large: '18px',
        xlarge: '20px'
      };
      
      if (fontMap[fontFamily]) {
        root.style.setProperty('--font-family', fontMap[fontFamily]);
      }
      
      if (sizeMap[fontSize]) {
        root.style.setProperty('--font-size-base', sizeMap[fontSize]);
      }
      
      // Border radius
      const borderRadius = $('#theme-border-radius')?.value || 'medium';
      const radiusMap = {
        none: '0px',
        small: '4px',
        medium: '8px',
        large: '12px',
        xlarge: '16px',
        pill: '999px'
      };
      
      if (radiusMap[borderRadius]) {
        root.style.setProperty('--border-radius', radiusMap[borderRadius]);
      }
      
      // Shadow intensity
      const shadow = $('#theme-shadow')?.value || 'medium';
      const shadowMap = {
        none: 'none',
        subtle: '0 1px 3px rgba(0,0,0,0.12)',
        medium: '0 4px 6px rgba(0,0,0,0.1)',
        strong: '0 10px 15px rgba(0,0,0,0.2)',
        dramatic: '0 20px 25px rgba(0,0,0,0.3)'
      };
      
      if (shadowMap[shadow]) {
        root.style.setProperty('--shadow', shadowMap[shadow]);
      }
      
      // Blur effects
      const blurEnabled = $('#theme-blur-enabled')?.checked || false;
      root.style.setProperty('--backdrop-blur', blurEnabled ? 'blur(10px)' : 'none');
      
      // Smooth scroll
      const smoothScroll = $('#theme-smooth-scroll')?.checked !== false;
      document.documentElement.style.scrollBehavior = smoothScroll ? 'smooth' : 'auto';
      
      // Reduce motion
      const reduceMotion = $('#theme-reduce-motion')?.checked || false;
      if (reduceMotion) {
        root.classList.add('reduce-motion');
      } else {
        root.classList.remove('reduce-motion');
      }
      
      // High contrast
      const highContrast = $('#theme-high-contrast')?.checked || false;
      if (highContrast) {
        root.classList.add('high-contrast');
      } else {
        root.classList.remove('high-contrast');
      }
      
      console.log('[Theme] Preview applied successfully');
    } catch (err) {
      console.error('[Theme] Preview error:', err);
    }
  }

  // Expose for global handlers
  try { 
    window.saveThemeCustomization = saveThemeCustomization; 
    window.applyThemePreview = applyThemePreview;
  } catch(e) {}

  // On load: fetch saved theme and set form controls accurately (including clickSound)
  async function initThemeFromServer() {
    try {
      if (!state.guildId) return;
      const res = await apiFetch(`/api/settings/theme?guildId=${encodeURIComponent(state.guildId)}`);
      const theme = res?.theme || null;
      const saved = theme || (() => { try { return JSON.parse(localStorage.getItem('dashboardTheme')||'null'); } catch(e){ return null; } })();
      if (!saved) return;
      const setVal = (sel, val) => { 
        if (val === undefined || val === null) return; 
        const el = $(sel); 
        if (el) { 
          if (el.tagName === 'INPUT' && el.type === 'checkbox') el.checked = !!val; 
          else el.value = val; 
        } 
      };
      setVal('#theme-primary-color', saved.primaryColor);
      setVal('#theme-accent-color', saved.accentColor);
      setVal('#theme-bg-color', saved.bgColor);
      setVal('#theme-sidebar-color', saved.sidebarColor);
      setVal('#theme-font-family', saved.fontFamily);
      setVal('#theme-font-size', saved.fontSize);
      setVal('#theme-density', saved.density);
      setVal('#theme-sidebar-position', saved.sidebarPosition);
      setVal('#theme-click-sound', saved.clickSound);
      setVal('#theme-hover-effect', saved.hoverEffect);
      setVal('#theme-click-animation', saved.clickAnimation);
      setVal('#theme-animations-enabled', saved.animationsEnabled);
      setVal('#theme-sound-volume', saved.soundVolume);
      setVal('#theme-title', saved.customTitle);
      setVal('#theme-icon-url', saved.customIcon);
      setVal('#theme-banner-url', saved.customBanner);
      setVal('#theme-footer-text', saved.customFooter);
      setVal('#theme-border-radius', saved.borderRadius);
      setVal('#theme-shadow', saved.shadowIntensity);
      setVal('#theme-bg-pattern', saved.bgPattern);
      setVal('#theme-blur-enabled', saved.blurEnabled);
      setVal('#theme-smooth-scroll', saved.smoothScroll);
      setVal('#theme-reduce-motion', saved.reduceMotion);
      setVal('#theme-high-contrast', saved.highContrast);
      setVal('#theme-show-tooltips', saved.showTooltips);
      // Update volume display
      const volumeDisplay = $('#volume-display');
      if (volumeDisplay && saved.soundVolume) volumeDisplay.textContent = saved.soundVolume + '%';
      // Sync color pickers with hex inputs
      const primaryHex = $('#theme-primary-hex');
      if (primaryHex && saved.primaryColor) primaryHex.value = saved.primaryColor;
      const accentHex = $('#theme-accent-hex');
      if (accentHex && saved.accentColor) accentHex.value = saved.accentColor;
      const bgHex = $('#theme-bg-hex');
      if (bgHex && saved.bgColor) bgHex.value = saved.bgColor;
      const sidebarHex = $('#theme-sidebar-hex');
      if (sidebarHex && saved.sidebarColor) sidebarHex.value = saved.sidebarColor;
      applyThemePreview();
    } catch (e) {
      console.warn('[Theme] init failed:', e);
    }
  }

  // Initialize theme settings when Customize tab initializes
  try { initThemeFromServer(); } catch(e) {}

  // Customize view initializer (placeholder wiring)
  // Customize view initializer (expanded)
  function initCustomizeView() {
    try {
      const status = document.getElementById('customize-status');
      const applyBtn = document.querySelector('[data-action="apply-customization"]');
      if (applyBtn && !applyBtn.__bound) {
        applyBtn.__bound = true;
        applyBtn.addEventListener('click', async (e) => {
          e.preventDefault();
          if (status) { status.style.color = '#8fb9ff'; status.textContent = 'Saving customization...'; }
          try {
            // Collect all expanded values
            const payload = {
              tickets: {
                categories: !!$('#custom-tickets-categories')?.checked,
                autoclose: !!$('#custom-tickets-autoclose')?.checked,
                autocloseHours: parseInt($('#custom-tickets-autoclose-hours')?.value || '48'),
                footer: $('#custom-tickets-footer')?.value || '',
                priority: $('#custom-tickets-priority')?.value || 'normal',
                maxPerUser: parseInt($('#custom-tickets-max-per-user')?.value || '3'),
                ratings: !!$('#custom-tickets-ratings')?.checked
              },
              welcome: {
                title: $('#custom-welcome-title')?.value || '',
                message: $('#custom-welcome-message')?.value || '',
                color: $('#custom-welcome-color')?.value || '#10b981',
                rules: !!$('#custom-welcome-rules')?.checked,
                dm: !!$('#custom-welcome-dm')?.checked
              },
              moderation: {
                severity: $('#custom-mod-severity')?.value || 'moderate',
                warnThreshold: parseInt($('#custom-mod-warn-threshold')?.value || '3'),
                muteDuration: parseInt($('#custom-mod-mute-duration')?.value || '10'),
                warnExpiry: parseInt($('#custom-mod-warn-expiry')?.value || '30'),
                logging: !!$('#custom-mod-logging')?.checked,
                requireReason: !!$('#custom-mod-require-reason')?.checked
              },
              verification: {
                message: $('#custom-verify-message')?.value || '',
                button: $('#custom-verify-button')?.value || '',
                color: $('#custom-verify-color')?.value || '#10b981',
                success: $('#custom-verify-success')?.value || '',
                kickHours: parseInt($('#custom-verify-kick-hours')?.value || '24')
              },
              logging: {
                edits: !!$('#custom-log-edits')?.checked,
                deletes: !!$('#custom-log-deletes')?.checked,
                members: !!$('#custom-log-members')?.checked,
                roles: !!$('#custom-log-roles')?.checked,
                channels: !!$('#custom-log-channels')?.checked,
                compact: !!$('#custom-log-compact')?.checked
              },
              branding: {
                name: $('#custom-brand-name')?.value || '',
                footer: $('#custom-brand-footer')?.value || '',
                icon: $('#custom-brand-icon')?.value || '',
                timestamp: !!$('#custom-brand-timestamp')?.checked
              },
              website: {
                primary: $('#custom-site-primary')?.value || '#10b981',
                accent: $('#custom-site-accent')?.value || '#60a5fa',
                tagline: $('#custom-site-tagline')?.value || '',
                copyright: $('#custom-site-copyright')?.value || '',
                stats: !!$('#custom-site-stats')?.checked
              },
              theme: {
                name: $('#custom-theme')?.value || 'emerald',
                sidebar: $('#custom-layout-sidebar')?.value || 'left',
                compact: !!$('#custom-layout-compact')?.checked,
                animations: !!$('#custom-layout-animations')?.checked,
                fontsize: $('#custom-layout-fontsize')?.value || 'medium'
              }
            };
            // Persist per-guild customization
            const body = { guildId: state.guildId, userId: state.userId || window.CURRENT_USER_ID, payload };
            const resp = await apiFetch('/api/customization/save', { method: 'POST', body: JSON.stringify(body) });
            if (resp && resp.success) {
              if (status) { status.style.color = '#10b981'; status.textContent = '✅ Customization saved'; }
              showNotification('Customization saved', 'success');
            } else {
              throw new Error(resp?.error || 'Save failed');
            }
          } catch (err) {
            console.error('[Customize] Save error:', err);
            if (status) { status.style.color = '#ff9aa2'; status.textContent = '❌ Failed to save customization'; }
            showNotification('Failed to save customization', 'error');
          }
        });
      }

      // Theme preset card click handlers
      $$('.theme-card').forEach(card => {
        if (!card.__themebound) {
          card.__themebound = true;
          card.addEventListener('click', function() {
            const themeName = this.getAttribute('data-theme');
            if (themeName && themePresets[themeName]) {
              // Remove active state from all cards
              $$('.theme-card').forEach(c => c.style.border = '2px solid transparent');
              // Mark this card as active
              this.style.border = '2px solid #10b981';
              
              // Apply preset colors to form inputs
              const preset = themePresets[themeName];
              const primaryColorInput = $('#theme-primary-color');
              const primaryHexInput = $('#theme-primary-hex');
              const accentColorInput = $('#theme-accent-color');
              const accentHexInput = $('#theme-accent-hex');
              const bgColorInput = $('#theme-bg-color');
              const bgHexInput = $('#theme-bg-hex');
              const sidebarColorInput = $('#theme-sidebar-color');
              const sidebarHexInput = $('#theme-sidebar-hex');

              if (primaryColorInput) primaryColorInput.value = preset.primary;
              if (primaryHexInput) primaryHexInput.value = preset.primary;
              if (accentColorInput) accentColorInput.value = preset.accent;
              if (accentHexInput) accentHexInput.value = preset.accent;
              if (bgColorInput) bgColorInput.value = preset.bg;
              if (bgHexInput) bgHexInput.value = preset.bg;
              if (sidebarColorInput) sidebarColorInput.value = preset.sidebar;
              if (sidebarHexInput) sidebarHexInput.value = preset.sidebar;

              // Apply theme immediately
              applyThemePreview();
              showNotification(`🎨 ${themeName.charAt(0).toUpperCase() + themeName.slice(1)} theme selected!`, 'success');
            }
          });
        }
      });

      // Color picker sync - keep hex input and color picker in sync
      const colorInputs = [
        { picker: '#theme-primary-color', hex: '#theme-primary-hex' },
        { picker: '#theme-accent-color', hex: '#theme-accent-hex' },
        { picker: '#theme-bg-color', hex: '#theme-bg-hex' },
        { picker: '#theme-sidebar-color', hex: '#theme-sidebar-hex' }
      ];

      colorInputs.forEach(({ picker, hex }) => {
        const pickerEl = $(picker);
        const hexEl = $(hex);
        if (pickerEl && hexEl) {
          pickerEl.addEventListener('input', (e) => {
            hexEl.value = e.target.value;
            // Apply theme preview in real-time
            applyThemePreview();
          });
          hexEl.addEventListener('input', (e) => {
            const val = e.target.value;
            if (/^#[0-9A-Fa-f]{6}$/.test(val)) {
              pickerEl.value = val;
              // Apply theme preview in real-time
              applyThemePreview();
            }
          });
        }
      });

      // Prefill from backend (expanded)
      const userId = state.userId || window.CURRENT_USER_ID || localStorage.getItem('currentUserId');
      if (state.guildId && userId) {
        apiFetch(`/api/customization/load?guildId=${encodeURIComponent(state.guildId)}&userId=${encodeURIComponent(userId)}`).then(data => {
          const cs = data?.customization || {};
          // Tickets
          try { $('#custom-tickets-categories').checked = !!cs.tickets_categories; } catch(_){}
          try { $('#custom-tickets-autoclose').checked = !!cs.tickets_autoclose; } catch(_){}
          try { $('#custom-tickets-autoclose-hours').value = cs.tickets_autoclose_hours || 48; } catch(_){}
          try { $('#custom-tickets-footer').value = cs.tickets_footer || ''; } catch(_){}
          try { $('#custom-tickets-priority').value = cs.tickets_priority || 'normal'; } catch(_){}
          try { $('#custom-tickets-max-per-user').value = cs.tickets_max_per_user || 3; } catch(_){}
          try { $('#custom-tickets-ratings').checked = !!cs.tickets_ratings; } catch(_){}
          // Welcome
          try { $('#custom-welcome-title').value = cs.welcome_title || ''; } catch(_){}
          try { $('#custom-welcome-message').value = cs.welcome_message || ''; } catch(_){}
          try { $('#custom-welcome-color').value = cs.welcome_color || '#10b981'; } catch(_){}
          try { $('#custom-welcome-rules').checked = !!cs.welcome_rules; } catch(_){}
          try { $('#custom-welcome-dm').checked = !!cs.welcome_dm; } catch(_){}
          // Moderation
          try { $('#custom-mod-severity').value = cs.mod_severity || 'moderate'; } catch(_){}
          try { $('#custom-mod-warn-threshold').value = cs.mod_warn_threshold || 3; } catch(_){}
          try { $('#custom-mod-mute-duration').value = cs.mod_mute_duration || 10; } catch(_){}
          try { $('#custom-mod-warn-expiry').value = cs.mod_warn_expiry || 30; } catch(_){}
          try { $('#custom-mod-logging').checked = !!cs.mod_logging; } catch(_){}
          try { $('#custom-mod-require-reason').checked = !!cs.mod_require_reason; } catch(_){}
          // Verification
          try { $('#custom-verify-message').value = cs.verify_message || ''; } catch(_){}
          try { $('#custom-verify-button').value = cs.verify_button || ''; } catch(_){}
          try { $('#custom-verify-color').value = cs.verify_color || '#10b981'; } catch(_){}
          try { $('#custom-verify-success').value = cs.verify_success || ''; } catch(_){}
          try { $('#custom-verify-kick-hours').value = cs.verify_kick_hours || 24; } catch(_){}
          // Logging
          try { $('#custom-log-edits').checked = !!cs.log_edits; } catch(_){}
          try { $('#custom-log-deletes').checked = !!cs.log_deletes; } catch(_){}
          try { $('#custom-log-members').checked = !!cs.log_members; } catch(_){}
          try { $('#custom-log-roles').checked = !!cs.log_roles; } catch(_){}
          try { $('#custom-log-channels').checked = !!cs.log_channels; } catch(_){}
          try { $('#custom-log-compact').checked = !!cs.log_compact; } catch(_){}
          // Branding
          try { $('#custom-brand-name').value = cs.brand_name || ''; } catch(_){}
          try { $('#custom-brand-footer').value = cs.brand_footer || ''; } catch(_){}
          try { $('#custom-brand-icon').value = cs.brand_icon || ''; } catch(_){}
          try { $('#custom-brand-timestamp').checked = !!cs.brand_timestamp; } catch(_){}
          // Website
          try { $('#custom-site-primary').value = cs.site_primary || '#10b981'; } catch(_){}
          try { $('#custom-site-accent').value = cs.site_accent || '#60a5fa'; } catch(_){}
          try { $('#custom-site-tagline').value = cs.site_tagline || ''; } catch(_){}
          try { $('#custom-site-copyright').value = cs.site_copyright || ''; } catch(_){}
          try { $('#custom-site-stats').checked = !!cs.site_stats; } catch(_){}
          // Theme
          try { $('#custom-theme').value = cs.theme_name || 'emerald'; } catch(_){}
          try { $('#custom-layout-sidebar').value = cs.layout_sidebar || 'left'; } catch(_){}
          try { $('#custom-layout-compact').checked = !!cs.layout_compact; } catch(_){}
          try { $('#custom-layout-animations').checked = !!cs.layout_animations; } catch(_){}
          try { $('#custom-layout-fontsize').value = cs.layout_fontsize || 'medium'; } catch(_){}
        }).catch(err => console.warn('[Customize] Load failed:', err));
      }
    } catch (e) { console.warn('initCustomizeView failed:', e); }
  }

    // Action buttons
    $$('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        if (actionHandlers[action]) {
          actionHandlers[action]();
        }
      });
    });
    
    // Color picker sync with hex input
    ['primary', 'accent', 'bg', 'sidebar'].forEach(colorType => {
      const picker = $(`#theme-${colorType}-color`);
      const hexInput = $(`#theme-${colorType}-hex`);
      
      if (picker && hexInput) {
        picker.addEventListener('input', (e) => {
          hexInput.value = e.target.value;
        });
        
        hexInput.addEventListener('input', (e) => {
          const value = e.target.value;
          if (/^#[0-9A-F]{6}$/i.test(value)) {
            picker.value = value;
          }
        });
      }
    });
    
    // Sound volume display
    const volumeSlider = $('#theme-sound-volume');
    const volumeDisplay = $('#volume-display');
    if (volumeSlider && volumeDisplay) {
      volumeSlider.addEventListener('input', (e) => {
        volumeDisplay.textContent = `${e.target.value}%`;
      });
    }
    
    // Test click sound button
    const testSoundBtn = $('#test-click-sound');
    if (testSoundBtn) {
      testSoundBtn.addEventListener('click', () => {
        const sound = $('#theme-click-sound')?.value || 'click';
        const volume = parseInt($('#theme-sound-volume')?.value || '50') / 100;
        playClickSound(sound, volume);
        showNotification('🎵 Playing sound: ' + sound, 'info');
      });
    }

    // Action buttons
    $$('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.getAttribute('data-action');
        if (action && window.dashboardActions[action]) {
          window.dashboardActions[action]();
        }
      });
    });

    // Logout button
    const logoutBtn = $('#logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', logout);
        // Action filter buttons
        $$('.filter-btn').forEach(btn => {
          btn.addEventListener('click', () => {
            $$('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const filter = btn.getAttribute('data-filter');
            loadActionLogs(filter);
          });
        });

    }

    // Language selector
    const langSelectorBtn = $('#language-selector-btn');
    const langModal = $('#language-selector-modal');
    const closeLangModal = $('#close-language-selector');
    const langOptions = $$('.language-option');
    
    if (langSelectorBtn && langModal) {
      langSelectorBtn.addEventListener('click', () => {
        langModal.style.display = 'flex';
      });
      
      closeLangModal.addEventListener('click', () => {
        langModal.style.display = 'none';
      });
      
      langModal.addEventListener('click', (e) => {
        if (e.target === langModal) {
          langModal.style.display = 'none';
        }
      });
      
      langOptions.forEach(btn => {
        btn.addEventListener('click', async () => {
          const lang = btn.getAttribute('data-lang');
          window.GUILD_LANG = lang;
          localStorage.setItem('dashboardLanguage', lang);
          
          // Reload locale
          window.__i18nBase = await loadFrontendLocale('en');
          if (lang && lang !== 'en') {
            const over = await loadFrontendLocale(lang);
            window.i18n = { ...window.__i18nBase, ...over };
          } else {
            window.i18n = window.__i18nBase;
          }
          
          // Update data-i18n elements
          document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (!key) return;
            el.textContent = t(key);
          });
          
          // Update placeholders
          document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) el.setAttribute('placeholder', t(key));
          });
          
          langModal.style.display = 'none';
          showNotification(`Language changed to ${lang.toUpperCase()}`, 'success');
        });
      });
    }

    // Refresh button
    const refreshBtn = $('#refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', refreshAll);
    }

    // Settings buttons
    const saveQuickBtn = $('#save-quick-settings');
    if (saveQuickBtn) {
      saveQuickBtn.addEventListener('click', saveQuickSettings);
    }

    const saveBotBtn = $('#save-bot-config');
    if (saveBotBtn) {
      saveBotBtn.addEventListener('click', saveBotConfig);
    }
    
    const saveAdvancedBtn = $('#save-advanced-settings');
    if (saveAdvancedBtn) {
      saveAdvancedBtn.addEventListener('click', saveAdvancedSettings);
    }

    const resetBtn = $('#reset-settings-btn');
    if (resetBtn) {
      resetBtn.addEventListener('click', resetSettings);
    }

    const clearLogsBtn = $('#clear-logs-btn');
    if (clearLogsBtn) {
      clearLogsBtn.addEventListener('click', clearLogs);
    }

    const savePermsBtn = $('#save-permissions');
    if (savePermsBtn) {
      savePermsBtn.addEventListener('click', saveCommandPermissions);
    }
    const refreshPermsBtn = $('#refresh-permissions');
    if (refreshPermsBtn) {
      refreshPermsBtn.addEventListener('click', loadCommandPermissions);
    }

    // Auto-save security toggles on change
    const securityToggles = [
      'toggle-antiraid', 'toggle-antispam', 'toggle-antiphishing',
      'toggle-antinuke', 'toggle-welcome', 'toggle-tickets',
      'toggle-automod', 'toggle-autorole', 'toggle-xp'
    ];
    
    securityToggles.forEach(toggleId => {
      const toggle = document.getElementById(toggleId);
      if (toggle) {
        toggle.addEventListener('change', () => {
          console.log(`[SETTINGS] Toggle ${toggleId} changed to ${toggle.checked}`);
          saveQuickSettings();
        });
      }
    });

    // Debounced AI toggle handler (300ms debounce)
    let aiToggleTimeout = null;
    const aiToggle = document.getElementById('toggle-ai');
    const aiSaveStatus = document.getElementById('ai-save-status');
    
    if (aiToggle && aiSaveStatus) {
      aiToggle.addEventListener('change', () => {
        console.log(`[SETTINGS] AI toggle changed to ${aiToggle.checked}`);
        // Just trigger the same quick settings save as other toggles
        saveQuickSettings();
      });
    }

    // Auto-save bot config dropdowns on change
    const configSelects = [
      'log-channel', 'alert-channel', 'mod-role', 'admin-role',
      'welcome-channel', 'ticket-category'
    ];
    
    configSelects.forEach(selectId => {
      const select = document.getElementById(selectId);
      if (select) {
        select.addEventListener('change', () => {
          console.log(`[SETTINGS] Dropdown ${selectId} changed to ${select.value}`);
          saveBotConfig();
        });
      }
    });

    // Allow independent toggles for welcome and verification (no auto-unchecking)
    const welcomeToggle = $('#toggle-welcome');
    const verifyToggle = $('#toggle-verification');
    if (welcomeToggle) {
      welcomeToggle.addEventListener('change', () => {
        state.lastSettingChanged = 'welcome_enabled';
        saveQuickSettings();
      });
    }
    if (verifyToggle) {
      verifyToggle.addEventListener('change', () => {
        state.lastSettingChanged = 'verification_enabled';
        saveQuickSettings();
      });
    }
  }

  // Simple confetti celebration with optional waves
  function launchConfetti(opts = {}) {
    const { count = 60, waves = 1, interval = 250 } = opts || {};
    try {
      const container = document.body;
      const colors = ['#10b981', '#60a5fa', '#f59e0b', '#ef4444', '#a78bfa', '#34d399'];
      const emojis = ['🎉','✨','⭐','🎊','💫'];
      const spawn = (n) => {
        for (let i = 0; i < n; i++) {
          const el = document.createElement('div');
          el.textContent = Math.random() < 0.5 ? emojis[(Math.random()*emojis.length)|0] : '▮';
          el.style.position = 'fixed';
          el.style.left = (Math.random()*100) + 'vw';
          el.style.top = '-5vh';
          el.style.fontSize = (12 + Math.random()*18) + 'px';
          el.style.zIndex = 99999;
          el.style.pointerEvents = 'none';
          el.style.color = colors[(Math.random()*colors.length)|0];
          const duration = 2200 + Math.random()*2200;
          const translateX = (Math.random()*40 - 20) + 'vw';
          el.animate([
            { transform: 'translate(0, 0)', opacity: 1 },
            { transform: `translate(${translateX}, 110vh) rotate(${Math.random()*720-360}deg)`, opacity: 0.9 }
          ], { duration, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' });
          container.appendChild(el);
          setTimeout(() => el.remove(), duration + 250);
        }
      };
      const perWave = Math.max(1, Math.round(count / Math.max(1, waves)));
      for (let w = 0; w < Math.max(1, waves); w++) {
        setTimeout(() => spawn(perWave), w * interval);
      }
    } catch (_) {}
  }

  // Small success chime using Web Audio API
  function playSuccessChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const notes = [
        { f: 880, t: 0.00, d: 0.12 }, // A5
        { f: 1174.66, t: 0.12, d: 0.12 }, // D6
        { f: 1760, t: 0.24, d: 0.18 } // A6
      ];
      notes.forEach(({ f, t, d }) => {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.type = 'sine';
        o.frequency.setValueAtTime(f, ctx.currentTime + t);
        g.gain.setValueAtTime(0.001, ctx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + d);
        o.connect(g).connect(ctx.destination);
        o.start(ctx.currentTime + t);
        o.stop(ctx.currentTime + t + d + 0.02);
      });
      // Auto-close context shortly after
      setTimeout(() => { try { ctx.close(); } catch (_) {} }, 800);
    } catch (_) {}
  }

  // Command Permissions (Phase 1)
  async function loadCommandPermissions() {
    if (!state.guildId) return;
    const statusEl = $('#permissions-status');
    if (statusEl) {
      statusEl.textContent = 'Loading permissions...';
      statusEl.style.color = 'var(--color-muted)';
    }
    try {
      const [rolesRes, commandsRes, permsRes] = await Promise.all([
        apiFetch(`/api/roles?guildId=${encodeURIComponent(state.guildId)}`),
        apiFetch(`/api/guilds/${encodeURIComponent(state.guildId)}/commands`),
        apiFetch(`/api/guilds/${encodeURIComponent(state.guildId)}/permissions`)
      ]);
      state.roles = rolesRes.roles || [];
      state.commands = commandsRes.commands || [];
      const map = {};
      (permsRes.entries || []).forEach(entry => {
        const key = `${entry.scope}:${entry.name}`;
        map[key] = entry.roles || entry.roleIds || [];
      });
      state.commandPermissions = map;
      renderCommandPermissions();
      if (statusEl) {
        statusEl.textContent = 'Permissions loaded.';
        statusEl.style.color = 'var(--color-success)';
      }
    } catch (err) {
      console.error('[PERMISSIONS] Failed to load:', err);
      showNotification('Failed to load command permissions', 'error');
      if (statusEl) {
        statusEl.textContent = 'Failed to load permissions.';
        statusEl.style.color = 'var(--color-danger)';
      }
    }
  }

  function renderCommandPermissions() {
    const tbody = $('#permissions-table')?.querySelector('tbody') || $('#permissions-table');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (!state.commands?.length) {
      tbody.innerHTML = `<tr><td colspan="3" style="padding:12px;">No commands found.</td></tr>`;
      return;
    }
    state.commands.forEach(cmd => {
      const key = `command:${cmd.name}`;
      const allowed = state.commandPermissions[key] || [];
      const roleChecks = (state.roles || []).map(role => {
        const checked = allowed.includes(role.id) ? 'checked' : '';
        return `<label class="role-check" style="display:inline-block;margin:0 8px 6px 0;"><input type="checkbox" data-cmd="${cmd.name}" value="${role.id}" ${checked}> ${role.name}</label>`;
      }).join('') || '<span style="color:var(--color-muted);">No roles available.</span>';

      const row = document.createElement('tr');
      row.innerHTML = `
        <td style="padding:10px; border-bottom:1px solid var(--color-border); font-weight:600;">${cmd.name}</td>
        <td style="padding:10px; border-bottom:1px solid var(--color-border); color:var(--color-muted);">${cmd.description || ''}</td>
        <td style="padding:10px; border-bottom:1px solid var(--color-border);">${roleChecks}</td>
      `;
      tbody.appendChild(row);
    });
  }

  async function saveCommandPermissions() {
    if (!state.guildId) {
      showNotification('No server selected', 'error');
      return;
    }
    const statusEl = $('#permissions-status');
    if (statusEl) {
      statusEl.textContent = 'Saving...';
      statusEl.style.color = 'var(--color-muted)';
    }
    try {
      for (const cmd of state.commands || []) {
        const checks = Array.from(document.querySelectorAll(`input[data-cmd="${cmd.name}"]`))
          .filter(c => c.checked)
          .map(c => c.value);
        await apiFetch(`/api/guilds/${encodeURIComponent(state.guildId)}/permissions`, {
          method: 'POST',
          body: JSON.stringify({
            scope: 'command',
            name: cmd.name,
            roleIds: checks,
            changedBy: state.user?.username || 'dashboard'
          })
        });
      }
      showNotification('Command permissions saved', 'success');
      if (statusEl) {
        statusEl.textContent = 'Saved.';
        statusEl.style.color = 'var(--color-success)';
      }
    } catch (err) {
      console.error('[PERMISSIONS] Save failed:', err);
      showNotification('Failed to save permissions', 'error');
      if (statusEl) {
        statusEl.textContent = 'Save failed.';
        statusEl.style.color = 'var(--color-danger)';
      }
    }
  }

  // Refresh All Data
  function refreshAll() {
    // Prevent multiple simultaneous refreshes
    if (state.refreshing) {
      console.log('Refresh already in progress, skipping...');
      return;
    }

    // Enforce 2-second cooldown between refreshes
    const now = Date.now();
    const timeSinceLastRefresh = now - state.lastRefresh;
    if (timeSinceLastRefresh < 2000) {
      console.log(`Refresh cooldown active (${Math.ceil((2000 - timeSinceLastRefresh) / 1000)}s remaining)`);
      showNotification('Please wait before refreshing again', 'info');
      return;
    }

    console.log('Refreshing all data...');
    state.refreshing = true;
    state.lastRefresh = now;

    // Visual feedback
    const refreshBtn = $('#refresh-btn');
    if (refreshBtn) {
      refreshBtn.disabled = true;
      const originalText = refreshBtn.innerHTML;
      refreshBtn.innerHTML = '<span>⌛</span><span>Refreshing...</span>';
      
      setTimeout(() => {
        refreshBtn.disabled = false;
        refreshBtn.innerHTML = originalText;
      }, 2000);
    }

    // Load core data
    Promise.all([
      loadSubscriptionStatus(),
      loadServerInfo(),
      loadSecurityStats(),
      loadTickets()
    ]).then(() => {
      // Load view-specific data
      if (state.currentView === 'settings') {
        return loadSettings();
      } else if (state.currentView === 'security') {
        return Promise.all([
          loadActionLogs(),
          loadSecurityEvents()
        ]);
      }
    }).finally(() => {
      state.refreshing = false;
      // Note: Charts have their own auto-refresh, don't manually trigger
    });
      // Also refresh verification queue as part of a full refresh
      try { loadVerificationQueue(); } catch (e) { /* ignore */ }
  }

  // Store servers globally for dropdown access
  let cachedServers = [];

  // Load Available Servers
  async function loadServers() {
    try {
      const data = await apiFetch('/api/servers/list');
      const servers = data.servers || [];
      cachedServers = servers;
      
      // Match actual HTML element IDs from index-modern.html
      const dropdown = $('#serverDropdown');
      const optionsContainer = $('#serverList');
      const selectedIcon = $('#currentServerIcon');
      const selectedName = $('#currentServerName');
      const selectedMembers = $('#currentServerMembers');
      const hiddenSelector = $('#server-selector');
      
      if (!dropdown || !optionsContainer) {
        console.error('Server dropdown elements not found (serverDropdown or serverList missing)');
        return;
      }

      // Clear options container
      optionsContainer.innerHTML = '';
      
      if (servers.length === 0) {
        selectedName.textContent = 'No servers available';
        if (selectedIcon) selectedIcon.style.display = 'none';
        if (selectedMembers) selectedMembers.textContent = '-- members';
        showNoServersScreen();
        return;
      }

      // Hide no servers screen and show normal dashboard
      hideNoServersScreen();

      // Build dropdown options - match class names from index-modern.html
      servers.forEach(server => {
        const isActive = server.id === state.guildId;
        const iconUrl = server.icon || 'https://cdn.discordapp.com/embed/avatars/0.png';
        
        const option = document.createElement('div');
        option.className = `server-dropdown-item ${isActive ? 'active' : ''}`;
        option.dataset.serverId = server.id;
        
        option.innerHTML = `
          <img src="${iconUrl}" alt="${escapeHtml(server.name)}" class="server-dropdown-icon" onerror="this.src='https://cdn.discordapp.com/embed/avatars/0.png'">
          <div class="server-dropdown-info">
            <div class="server-dropdown-name">${escapeHtml(server.name)}</div>
            <div class="server-dropdown-members">${(server.memberCount || 0).toLocaleString()} members</div>
          </div>
          ${isActive ? '<i class="fas fa-check server-dropdown-check"></i>' : ''}
        `;
        
        option.addEventListener('click', () => selectServer(server));
        optionsContainer.appendChild(option);
      });

      // Update hidden select for compatibility
      if (hiddenSelector) {
        hiddenSelector.innerHTML = '';
        servers.forEach(server => {
          const opt = document.createElement('option');
          opt.value = server.id;
          opt.textContent = server.name;
          hiddenSelector.appendChild(opt);
        });
      }

      // Set selected server
      let selectedServer = null;
      if (state.guildId && servers.find(s => s.id === state.guildId)) {
        selectedServer = servers.find(s => s.id === state.guildId);
      } else if (servers.length > 0) {
        selectedServer = servers[0];
        state.guildId = selectedServer.id;
        try {
          localStorage.setItem('selectedGuildId', state.guildId);
        } catch(e) {}
      }
      
      if (selectedServer) {
        updateSelectedServerDisplay(selectedServer);
        if (hiddenSelector) hiddenSelector.value = selectedServer.id;
      }
      
      try { window.CURRENT_GUILD_ID = state.guildId; } catch (e) {}

      // Setup dropdown toggle - events are already bound in index-modern.html via onclick="toggleServerDropdown()"

    } catch(e) {
      console.error('Failed to load servers:', e);
      const selectedName = $('#currentServerName');
      if (selectedName) selectedName.textContent = 'Failed to load servers';
    }
  }

  // Helper to update the selected server display - matches index-modern.html element IDs
  function updateSelectedServerDisplay(server) {
    const selectedIcon = $('#currentServerIcon');
    const selectedName = $('#currentServerName');
    const selectedMembers = $('#currentServerMembers');
    
    if (selectedIcon) {
      const iconUrl = server.icon || 'https://cdn.discordapp.com/embed/avatars/0.png';
      selectedIcon.src = iconUrl;
      selectedIcon.style.display = 'block';
    }
    if (selectedName) {
      selectedName.textContent = server.name;
    }
    if (selectedMembers) {
      selectedMembers.textContent = `${(server.memberCount || 0).toLocaleString()} members`;
    }
    
    // Update selected state in options
    document.querySelectorAll('.server-dropdown-item').forEach(opt => {
      const isSelected = opt.dataset.serverId === server.id;
      opt.classList.toggle('active', isSelected);
      // Add/remove checkmark
      const existingCheck = opt.querySelector('.server-dropdown-check');
      if (isSelected && !existingCheck) {
        opt.insertAdjacentHTML('beforeend', '<i class="fas fa-check server-dropdown-check"></i>');
      } else if (!isSelected && existingCheck) {
        existingCheck.remove();
      }
    });
  }

  // Setup dropdown events - NOTE: index-modern.html already has toggleServerDropdown() bound via onclick
  // This function is kept for backward compatibility but may not be needed
  let dropdownEventsSetup = false;
  function setupServerDropdownEvents() {
    if (dropdownEventsSetup) return;
    dropdownEventsSetup = true;
    
    const dropdown = $('#serverDropdown');
    const selectedArea = $('#serverSelector');
    
    if (!selectedArea) return;
    
    // Toggle dropdown on click (backup if onclick not bound in HTML)
    selectedArea.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = dropdown.classList.contains('open');
      if (isOpen) {
        closeServerDropdown();
      } else {
        openServerDropdown();
      }
    });
    
    // Close dropdown when clicking outside
    document.addEventListener('click', (e) => {
      if (!dropdown.contains(e.target)) {
        closeServerDropdown();
      }
    });
  }

  function openServerDropdown() {
    const dropdown = $('#serverDropdown');
    if (dropdown) {
      dropdown.classList.add('open');
    }
  }

  function closeServerDropdown() {
    const dropdown = $('#serverDropdown');
    if (dropdown) {
      dropdown.classList.remove('open');
    }
  }

  // Select a server from dropdown
  async function selectServer(server) {
    const oldGuildId = state.guildId;
    const newGuildId = server.id;
    
    closeServerDropdown();
    
    if (oldGuildId === newGuildId) return;
    
    // Auto-save current settings before switching if we're on settings tab
    if (state.currentView === 'settings' && oldGuildId) {
      console.log('Auto-saving settings before server switch...');
      try {
        const updates = {
          anti_raid_enabled: $('#toggle-antiraid')?.checked || false,
          anti_spam_enabled: $('#toggle-antispam')?.checked || false,
          anti_phishing_enabled: $('#toggle-antiphishing')?.checked || false,
          antinuke_enabled: $('#toggle-antinuke')?.checked || false,
          welcome_enabled: $('#toggle-welcome')?.checked || false,
          tickets_enabled: $('#toggle-tickets')?.checked || false,
          auto_mod_enabled: $('#toggle-automod')?.checked || false,
          autorole_enabled: $('#toggle-autorole')?.checked || false,
          xp_enabled: $('#toggle-xp')?.checked || false
        };
        
        await apiFetch(`/api/security-settings?guildId=${encodeURIComponent(oldGuildId)}`, {
          method: 'POST',
          body: JSON.stringify(updates)
        });
        console.log('✅ Auto-save completed before server switch');
      } catch (error) {
        console.warn('Auto-save failed:', error);
      }
    }
    
    state.guildId = newGuildId;
    try {
      localStorage.setItem('selectedGuildId', state.guildId);
    } catch(ex) {}
    try { window.CURRENT_GUILD_ID = state.guildId; } catch (e) {}
    
    // Update display
    updateSelectedServerDisplay(server);
    
    // Update hidden selector
    const hiddenSelector = $('#server-selector');
    if (hiddenSelector) hiddenSelector.value = newGuildId;
    
    // Clear existing channel/role selections to prevent stale data
    const channelSelects = ['#log-channel', '#alert-channel', '#welcome-channel', '#verification-channel', '#ticket-category'];
    const roleSelects = ['#mod-role', '#admin-role', '#verification-role'];
    
    channelSelects.forEach(sel => {
      const el = $(sel);
      if (el) el.innerHTML = '<option value="">Loading...</option>';
    });
    
    roleSelects.forEach(sel => {
      const el = $(sel);
      if (el) el.innerHTML = '<option value="">Loading...</option>';
    });
    
    // Clear welcome message textarea
    const welcomeMsg = $('#welcome-message');
    if (welcomeMsg) welcomeMsg.value = '';
    
    refreshAll();

    // If currently viewing Shared Access tab, refresh its data immediately
    if (state.currentView === 'shared-access') {
      if (typeof refreshSharedAccessData === 'function') {
        refreshSharedAccessData();
      }
    }
  }

  // Escape HTML helper
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // Initialize Guild ID
  function initGuild() {
    const params = new URLSearchParams(window.location.search);
    const qGuildId = params.get('guildId');

    if (qGuildId) {
      state.guildId = qGuildId;
      try {
        localStorage.setItem('selectedGuildId', qGuildId);
      } catch(e) {}
    } else {
      try {
        state.guildId = localStorage.getItem('selectedGuildId');
      } catch(e) {}
    }

    try {
      if (state.guildId) {
        window.CURRENT_GUILD_ID = state.guildId;
      }
    } catch (e) { /* ignore */ }
  }

  // Initialize App
  // =========================================
  // NO SERVERS SCREEN FUNCTIONS
  // =========================================

  function showNoServersScreen() {
    const noServersScreen = $('#no-servers-screen');
    const dashboardContent = $('#dashboard-content');
    
    if (noServersScreen) noServersScreen.style.display = 'block';
    if (dashboardContent) dashboardContent.style.display = 'none';
    
    // Setup event listeners for no servers screen
    setupNoServersHandlers();
  }

  function hideNoServersScreen() {
    const noServersScreen = $('#no-servers-screen');
    const dashboardContent = $('#dashboard-content');
    
    if (noServersScreen) noServersScreen.style.display = 'none';
    if (dashboardContent) dashboardContent.style.display = 'block';
  }

  function setupNoServersHandlers() {
    // Redeem code button
    const redeemBtn = $('#no-servers-redeem-btn');
    const codeInput = $('#no-servers-code-input');
    
    if (redeemBtn && codeInput) {
      redeemBtn.onclick = async () => {
        const code = codeInput.value.trim().toUpperCase();
        if (!code) {
          updateNoServersStatus('❌ Please enter an access code', 'error');
          return;
        }

        updateNoServersStatus('🔄 Redeeming code...', 'loading');
        redeemBtn.disabled = true;

        try {
          // Note: We need to pass a dummy guildId since the endpoint expects it
          // The backend will get the actual guildId from the code
          const response = await apiFetch(`/api/dashboard/0/shared-access/redeem-code`, {
            method: 'POST',
            body: JSON.stringify({ code })
          });

          if (response.success) {
            updateNoServersStatus('✅ Access granted! Loading server...', 'success');
            codeInput.value = '';
            
            // Reload servers
            setTimeout(async () => {
              await loadServers();
              if (state.guildId) {
                window.location.reload();
              }
            }, 1000);
          } else {
            updateNoServersStatus('❌ ' + (response.error || 'Invalid or expired code'), 'error');
            redeemBtn.disabled = false;
          }
        } catch (error) {
          updateNoServersStatus('❌ Error: ' + error.message, 'error');
          redeemBtn.disabled = false;
        }
      };

      // Allow Enter key to redeem
      codeInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          redeemBtn.click();
        }
      });
    }

    // Refresh/Check Again button
    const refreshBtn = $('#no-servers-refresh-btn');
    if (refreshBtn) {
      refreshBtn.onclick = async () => {
        updateNoServersStatus('🔄 Checking for new access...', 'loading');
        refreshBtn.disabled = true;

        try {
          const response = await apiFetch('/api/access/recheck', {
            method: 'POST'
          });

          if (response.success) {
            if (response.newAccessGranted > 0) {
              updateNoServersStatus(`✅ ${response.message}`, 'success');
              
              // Reload servers after a moment
              setTimeout(async () => {
                await loadServers();
                if (state.guildId) {
                  window.location.reload();
                }
              }, 1000);
            } else {
              updateNoServersStatus('ℹ️ ' + response.message, 'info');
              refreshBtn.disabled = false;
            }
          } else {
            updateNoServersStatus('❌ ' + (response.error || 'Failed to check access'), 'error');
            refreshBtn.disabled = false;
          }
        } catch (error) {
          updateNoServersStatus('❌ Error: ' + error.message, 'error');
          refreshBtn.disabled = false;
        }
      };
    }

    // Auto-check every 10 seconds for role-based access
    let autoCheckInterval = setInterval(async () => {
      if ($('#no-servers-screen')?.style.display === 'none') {
        clearInterval(autoCheckInterval);
        return;
      }

      try {
        const response = await apiFetch('/api/access/recheck', { method: 'POST' });
        if (response.success && response.newAccessGranted > 0) {
          clearInterval(autoCheckInterval);
          updateNoServersStatus('🎉 New access detected! Refreshing...', 'success');
          setTimeout(() => window.location.reload(), 1500);
        }
      } catch (e) {
        // Silent fail for auto-check
      }
    }, 10000);
  }

  function updateNoServersStatus(message, type = 'info') {
    const statusEl = $('#no-servers-status');
    if (!statusEl) return;

    const colors = {
      success: '#22c55e',
      error: '#ef4444',
      loading: '#3b82f6',
      info: '#a0a0a0'
    };

    statusEl.textContent = message;
    statusEl.style.color = colors[type] || colors.info;
  }

  // =========================================
  // ADD SERVER MODAL (for code redemption)
  // =========================================
  
  let addServerModalActive = false;
  let prevBodyPointerEvents = '';

  function showAddServerModal() {
    // Prevent multiple modals
    if (addServerModalActive) {
      console.log('[ADD SERVER] Modal already active, ignoring request');
      return;
    }
    console.log('[ADD SERVER] Opening modal...');
    addServerModalActive = true;
    // Save previous pointer events and disable all except modal
    prevBodyPointerEvents = document.body.style.pointerEvents;
    document.body.style.pointerEvents = 'none';
    document.documentElement.style.pointerEvents = 'none';
    // Remove existing modal if any
    const existingModal = $('#add-server-modal');
    if (existingModal) {
      console.log('[ADD SERVER] Removing existing modal');
      existingModal.remove();
    }

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'add-server-modal';
    modal.className = 'modal-overlay';
    modal.style.cssText = `
      display: flex !important;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.8);
      backdrop-filter: blur(8px);
      z-index: 10000;
      align-items: center;
      justify-content: center;
      pointer-events: auto !important;
    `;
    // Ensure modal is always interactive
    modal.tabIndex = 0;
    modal.focus();

    modal.innerHTML = `
      <div class="modal-content" style="background: var(--bg-card); border-radius: 16px; padding: 2.5rem; max-width: 600px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.5); position: relative;">
        <div style="text-align: center; margin-bottom: 2rem;">
          <div style="font-size: 3.5rem; margin-bottom: 1rem;">🔑</div>
          <h2 style="font-size: 1.75rem; margin-bottom: 0.5rem; font-weight: 600;">Add New Server</h2>
          <p style="color: var(--color-muted); font-size: 1rem;">Enter an access code to gain dashboard access</p>
        </div>

        <div style="background: rgba(59, 130, 246, 0.1); border: 1px solid rgba(59, 130, 246, 0.3); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem;">
          <p style="margin-bottom: 1.25rem; font-size: 0.95rem; line-height: 1.6; color: var(--color-muted);">
            If you were given an access code by a server owner,<br>enter it below to unlock that server's dashboard.
          </p>
          <input 
            type="text" 
            id="add-server-code-input" 
            placeholder="XXXX-XXXX-XXXX-XXXX" 
            style="width: 100%; padding: 1rem; background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; color: #fff; font-size: 1.125rem; font-family: monospace; text-transform: uppercase; text-align: center; margin-bottom: 0.75rem;"
            maxlength="19"
          >
          <div id="add-server-status" style="min-height: 1.5rem; font-size: 0.9rem; text-align: center;"></div>
        </div>

        <div style="background: rgba(255, 255, 255, 0.02); border-radius: 12px; padding: 1.5rem; margin-bottom: 2rem; text-align: left;">
          <h3 style="font-size: 1rem; margin-bottom: 1rem; font-weight: 600;">Don't have a code?</h3>
          <p style="color: var(--color-muted); margin-bottom: 0.75rem; font-size: 0.9rem;">Ask a server admin to:</p>
          <ul style="color: var(--color-muted); line-height: 1.8; list-style-position: inside; font-size: 0.9rem;">
            <li>✅ Grant you access directly by user ID</li>
            <li>✅ Grant access to one of your Discord roles</li>
            <li>✅ Generate a one-time access code for you</li>
          </ul>
        </div>

        <div style="display: flex; gap: 1rem;">
          <button id="add-server-cancel-btn" class="btn-secondary" style="flex: 1; padding: 0.875rem; font-size: 1rem;">
            Cancel
          </button>
          <button id="add-server-redeem-btn" class="btn-primary" style="flex: 1; padding: 0.875rem; font-size: 1rem;">
            🎟️ Redeem Code
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);
    console.log('[ADD SERVER] Modal appended to body');
    // Immediately make visible to avoid any race with CSS
    try {
      modal.classList.add('show');
      modal.style.opacity = '1';
      console.log('[ADD SERVER] Modal show class added (immediate)');
    } catch(_) {}
    // Also schedule as a fallback on next frame
    requestAnimationFrame(() => {
      try { modal.classList.add('show'); modal.style.opacity = '1'; } catch(_) {}
      console.log('[ADD SERVER] Modal show class ensured via RAF');
    });

    // Setup handlers
    const closeBtn = modal.querySelector('#add-server-cancel-btn');
    const redeemBtn = modal.querySelector('#add-server-redeem-btn');
    const codeInput = modal.querySelector('#add-server-code-input');
    const statusEl = modal.querySelector('#add-server-status');
    const modalContent = modal.querySelector('.modal-content');

    let closeModal = (reason = 'unknown') => {
      try {
        console.log('[ADD SERVER] Closing modal. reason=', reason);
        console.log('[ADD SERVER] Close stack:', new Error('closeModal trace').stack);
      } catch (_) {}
      addServerModalActive = false;
      // Restore pointer events for both body and html
      document.body.style.pointerEvents = prevBodyPointerEvents || '';
      document.documentElement.style.pointerEvents = '';
      // Remove escape key listener
      document.removeEventListener('keydown', escapeHandler);
      // Remove debug handlers
      document.removeEventListener('click', window.__modalDebugHandler, true);
      document.removeEventListener('blur', window.__modalDebugHandler, true);
      // Use CSS transition: remove `.show` then remove element after transition
      try { modal.classList.remove('show'); } catch (_) {}
      const removeNow = () => {
        if (modal.parentNode) {
          modal.remove();
          console.log('[ADD SERVER] Modal removed');
        }
      };
      let removed = false;
      const onTransitionEnd = (ev) => {
        if (removed) return;
        removed = true;
        modal.removeEventListener('transitionend', onTransitionEnd);
        removeNow();
      };
      modal.addEventListener('transitionend', onTransitionEnd);
      // Fallback in case transitionend doesn't fire
      setTimeout(() => { if (!removed) { onTransitionEnd(); } }, 300);
    };
    // DEBUG: Global click/blur logger
    window.__modalDebugHandler = function(e) {
      console.log('[MODAL DEBUG] Event:', e.type, 'Target:', e.target);
    };
    document.addEventListener('click', window.__modalDebugHandler, true);
    document.addEventListener('blur', window.__modalDebugHandler, true);
    // Remove debug handler on close
    const oldCloseModal = closeModal;
    closeModal = function(reason = 'wrapper') {
      document.removeEventListener('click', window.__modalDebugHandler, true);
      document.removeEventListener('blur', window.__modalDebugHandler, true);
      oldCloseModal(reason + ' | wrapper cleanup');
    };

    // Cancel button
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      console.log('[ADD SERVER] Cancel clicked');
      closeModal('cancel button');
    });
    
    // Prevent clicks inside modal content from closing modal
    modalContent.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Close on Escape key only
    const escapeHandler = (e) => {
      if (e.key === 'Escape') {
        console.log('[ADD SERVER] Escape pressed');
        closeModal('escape key');
      }
    };
    document.addEventListener('keydown', escapeHandler);

    // Format code input with dashes
    codeInput.addEventListener('input', (e) => {
      let value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (value.length > 4) {
        value = value.slice(0, 4) + '-' + value.slice(4);
      }
      if (value.length > 9) {
        value = value.slice(0, 9) + '-' + value.slice(9);
      }
      if (value.length > 14) {
        value = value.slice(0, 14) + '-' + value.slice(14);
      }
      if (value.length > 19) {
        value = value.slice(0, 19);
      }
      e.target.value = value;
    });

    // Redeem code
    const redeemCode = async () => {
      const code = codeInput.value.trim().toUpperCase();
      if (!code) {
        statusEl.textContent = '❌ Please enter an access code';
        statusEl.style.color = '#ef4444';
        return;
      }

      console.log('[ADD SERVER] Redeeming code:', code);
      statusEl.textContent = '🔄 Redeeming code...';
      statusEl.style.color = '#3b82f6';
      redeemBtn.disabled = true;
      codeInput.disabled = true;

      try {
        const response = await apiFetch(`/api/dashboard/0/shared-access/redeem-code`, {
          method: 'POST',
          body: JSON.stringify({ code })
        });

        if (response.success) {
          console.log('[ADD SERVER] Code redeemed successfully');
          statusEl.textContent = '✅ Access granted! Loading server...';
          statusEl.style.color = '#22c55e';
          
          // Reload servers and switch to new server
          setTimeout(async () => {
            await loadServers();
            if (state.guildId) {
              closeModal('redeem success');
              window.location.reload();
            }
          }, 1000);
        } else {
          console.log('[ADD SERVER] Redemption failed:', response.error);
          statusEl.textContent = '❌ ' + (response.error || 'Invalid or expired code');
          statusEl.style.color = '#ef4444';
          redeemBtn.disabled = false;
          codeInput.disabled = false;
          codeInput.focus();
        }
      } catch (error) {
        console.error('[ADD SERVER] Redemption error:', error);
        statusEl.textContent = '❌ Error: ' + error.message;
        statusEl.style.color = '#ef4444';
        redeemBtn.disabled = false;
        codeInput.disabled = false;
        codeInput.focus();
      }
    };

    redeemBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      redeemCode();
    });
    
    // Allow Enter key to redeem
    codeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        redeemCode();
      }
    });

    // Auto-focus the input
    setTimeout(() => {
      codeInput.focus();
      console.log('[ADD SERVER] Input focused');
    }, 100);
    
    console.log('[ADD SERVER] Modal setup complete');
  }

  // =========================================
  // LEVELS / XP VIEW
  // =========================================

  async function loadLevelsView() {
    if (!state.guildId) return;

    try {
      const wrapper = $('#levels-wrapper');
      if (!wrapper) return;

      wrapper.innerHTML = '<div style="padding: 2rem; text-align: center;"><div style="display: inline-block; animation: spin 1s linear infinite;"><i style="font-size: 2rem;">⚙️</i></div><p style="margin-top: 1rem;">Loading leaderboard...</p></div>';

      // Fetch leaderboard data
      const response = await apiFetch(`/api/levels/leaderboard?guildId=${encodeURIComponent(state.guildId)}`);

      if (!response || !response.leaderboard) {
        wrapper.innerHTML = '<div class="card"><p style="color: #ef4444;">❌ Failed to load leaderboard</p></div>';
        return;
      }

      let html = '<div style="display: grid; gap: 1.5rem;">';

      // Leaderboard section
      html += '<div class="card-pro">';
      html += '<div class="card-header" style="margin-bottom: 1.5rem;"><div class="card-title">🏆 Top Members</div><div class="card-icon">📊</div></div>';
      
      if (response.leaderboard.length === 0) {
        html += '<p style="color: #888; text-align: center;">No members have earned XP yet</p>';
      } else {
        html += '<div style="display: grid; gap: 0.75rem;">';
        
        const medals = ['🥇', '🥈', '🥉'];
        response.leaderboard.forEach((user, index) => {
          const medal = medals[index] || `${index + 1}.`;
          const level = Math.floor(Math.pow(user.xp / 100, 0.5));
          
          html += `
            <div style="display: flex; align-items: center; gap: 1rem; padding: 1rem; background: rgba(0, 212, 255, 0.05); border-radius: 8px; border-left: 3px solid #00d4ff;">
              <div style="font-size: 1.5rem; min-width: 40px;">${medal}</div>
              <div style="flex: 1;">
                <div style="font-weight: 600; font-size: 0.95rem;">${user.username || `User ${user.user_id.slice(0, 8)}`}</div>
                <div style="font-size: 0.85rem; color: #888;">Level ${level} • ${user.xp.toLocaleString()} XP</div>
              </div>
              <div style="text-align: right;">
                <div style="font-weight: 600; color: #00d4ff;">#${index + 1}</div>
                <div style="font-size: 0.75rem; color: #888;">${user.total_messages || 0} msgs</div>
              </div>
            </div>
          `;
        });
        
        html += '</div>';
      }
      
      html += '</div>';

      // Admin controls
      if (state.permissions && state.permissions.admin) {
        html += '<div class="card-pro">';
        html += '<div class="card-header" style="margin-bottom: 1.5rem;"><div class="card-title">⚙️ Admin Controls</div></div>';
        html += '<div style="display: grid; gap: 1rem;">';
        html += `<button class="btn-secondary" style="padding: 0.75rem 1.5rem;" onclick="resetGuildLevels()">🗑️ Reset All XP</button>`;
        html += '</div>';
        html += '</div>';
      }

      html += '</div>';
      wrapper.innerHTML = html;

    } catch (error) {
      console.error('Error loading levels view:', error);
      const wrapper = $('#levels-wrapper');
      if (wrapper) {
        wrapper.innerHTML = '<div class="card"><p style="color: #ef4444;">❌ Error loading leaderboard: ' + error.message + '</p></div>';
      }
    }
  }

  // Admin function to reset guild XP
  async function resetGuildLevels() {
    if (!confirm('Are you sure you want to reset all XP for this server? This cannot be undone.')) {
      return;
    }

    try {
      const response = await apiFetch('/api/levels/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId: state.guildId })
      });

      if (response.success) {
        showNotification('✅ All XP has been reset.', 'success');
        await loadLevelsView();
      } else {
        showNotification('❌ ' + (response.error || 'Failed to reset XP'), 'error');
      }
    } catch (error) {
      showNotification('❌ Error: ' + error.message, 'error');
    }
  }

  // =========================================
  // SHARED ACCESS CODE MANAGEMENT
  // =========================================

  async function loadSharedAccessView() {
    console.log('[SHARED ACCESS] Loading shared access view...');
    
    // Setup sub-tab switching
    $$('.access-subtab-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        const tabName = this.dataset.accessTab;
        
        // Update button states
        $$('.access-subtab-btn').forEach(b => {
          b.classList.remove('active');
          b.style.background = 'rgba(255,255,255,0.05)';
          b.style.borderColor = 'rgba(255,255,255,0.1)';
          b.style.color = 'var(--color-muted)';
        });
        this.classList.add('active');
        this.style.background = 'rgba(16,185,129,0.15)';
        this.style.borderColor = 'rgba(16,185,129,0.3)';
        this.style.color = '#10b981';
        
        // Show/hide content
        $$('.access-subtab-content').forEach(content => {
          content.style.display = 'none';
        });
        const targetContent = document.querySelector(`.access-subtab-content[data-access-tab-content="${tabName}"]`);
        if (targetContent) {
          targetContent.style.display = 'block';
        }
      });
    });

    // Bind generate code button
    const generateBtn = $('#generate-access-code-btn');
    if (generateBtn) {
      generateBtn.onclick = async function() {
        const type = $('#access-code-type')?.value || 'single';
        const permission = $('#access-permission-level')?.value || 'viewer';
        const expiry = $('#access-code-expiry')?.value || '7d';
        const note = $('#access-code-note')?.value || '';

        if (!state.guildId) {
          showNotification('❌ No server selected', 'error');
          return;
        }

        try {
          generateBtn.disabled = true;
          generateBtn.textContent = 'Generating...';

          const response = await apiFetch('/api/access-codes/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              guildId: state.guildId,
              type,
              permission,
              expiry,
              note
            })
          });

          if (response.success && response.code) {
            const display = $('#generated-code-display');
            const codeValue = $('#generated-code-value');
            if (display && codeValue) {
              codeValue.textContent = response.code;
              display.style.display = 'block';
            }
            showNotification('✅ Access code generated successfully!', 'success');
            
            // Refresh the active codes list
            await loadAccessCodes();
          } else {
            showNotification('❌ ' + (response.error || 'Failed to generate code'), 'error');
          }
        } catch (error) {
          console.error('Generate code error:', error);
          showNotification('❌ Error generating code: ' + error.message, 'error');
        } finally {
          generateBtn.disabled = false;
          generateBtn.textContent = '🔑 Generate Access Code';
        }
      };
    }

    // Bind copy code button
    const copyBtn = $('#copy-code-btn');
    if (copyBtn) {
      copyBtn.onclick = function() {
        const codeValue = $('#generated-code-value');
        if (codeValue) {
          navigator.clipboard.writeText(codeValue.textContent).then(() => {
            showNotification('📋 Code copied to clipboard!', 'success');
          }).catch(err => {
            showNotification('❌ Failed to copy code', 'error');
          });
        }
      };
    }

    // Bind share code button
    const shareBtn = $('#share-code-btn');
    if (shareBtn) {
      shareBtn.onclick = function() {
        const codeValue = $('#generated-code-value');
        if (codeValue) {
          const shareUrl = `${window.location.origin}/dashboard?code=${codeValue.textContent}`;
          navigator.clipboard.writeText(shareUrl).then(() => {
            showNotification('🔗 Share link copied to clipboard!', 'success');
          }).catch(err => {
            showNotification('❌ Failed to copy link', 'error');
          });
        }
      };
    }

    // Bind redeem code button
    const redeemBtn = $('#redeem-code-btn');
    if (redeemBtn) {
      redeemBtn.onclick = async function() {
        const input = $('#redeem-code-input');
        const statusEl = $('#redeem-code-status');
        
        if (!input || !statusEl) return;
        
        const code = input.value.trim().toUpperCase();
        if (!code) {
          statusEl.style.display = 'block';
          statusEl.style.background = 'rgba(239,68,68,0.1)';
          statusEl.style.border = '1px solid rgba(239,68,68,0.3)';
          statusEl.style.color = '#ef4444';
          statusEl.textContent = '⚠️ Please enter a code';
          return;
        }

        try {
          redeemBtn.disabled = true;
          redeemBtn.textContent = 'Redeeming...';
          statusEl.style.display = 'none';

          const response = await apiFetch('/api/access-codes/redeem', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code })
          });

          if (response.success) {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(16,185,129,0.1)';
            statusEl.style.border = '1px solid rgba(16,185,129,0.3)';
            statusEl.style.color = '#10b981';
            statusEl.innerHTML = `
              <div style="text-align: center;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">✅</div>
                <div style="font-weight: 600; margin-bottom: 0.5rem;">Access Granted!</div>
                <div style="font-size: 0.9rem; opacity: 0.8;">You now have access to ${response.serverName || 'the server'}</div>
              </div>
            `;
            showNotification('✅ Code redeemed! Refreshing...', 'success');
            
            // Refresh servers list
            setTimeout(async () => {
              await loadServers();
              window.location.reload();
            }, 2000);
          } else {
            statusEl.style.display = 'block';
            statusEl.style.background = 'rgba(239,68,68,0.1)';
            statusEl.style.border = '1px solid rgba(239,68,68,0.3)';
            statusEl.style.color = '#ef4444';
            statusEl.textContent = '❌ ' + (response.error || 'Invalid or expired code');
          }
        } catch (error) {
          console.error('Redeem code error:', error);
          statusEl.style.display = 'block';
          statusEl.style.background = 'rgba(239,68,68,0.1)';
          statusEl.style.border = '1px solid rgba(239,68,68,0.3)';
          statusEl.style.color = '#ef4444';
          statusEl.textContent = '❌ Error: ' + error.message;
        } finally {
          redeemBtn.disabled = false;
          redeemBtn.textContent = '🎟️ Redeem Access Code';
        }
      };
    }

    // Bind refresh codes button
    const refreshBtn = $('#refresh-codes-btn');
    if (refreshBtn) {
      refreshBtn.onclick = () => loadAccessCodes();
    }

    // Bind filter
    const filterSelect = $('#filter-code-status');
    if (filterSelect) {
      filterSelect.onchange = () => loadAccessCodes();
    }

    // Load active codes
    await loadAccessCodes();
  }

  async function loadAccessCodes() {
    if (!state.guildId) return;

    const listEl = $('#access-codes-list');
    if (!listEl) return;

    try {
      listEl.innerHTML = '<div style="text-align: center; padding: 2rem;"><div style="font-size: 2rem;">⏳</div><div>Loading codes...</div></div>';

      const filter = $('#filter-code-status')?.value || 'all';
      const response = await apiFetch(`/api/access-codes/list?guildId=${encodeURIComponent(state.guildId)}&filter=${filter}`);

      if (!response.success || !response.codes || response.codes.length === 0) {
        listEl.innerHTML = `
          <div style="text-align: center; color: rgba(255,255,255,0.5); padding: 2rem;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">🔐</div>
            <div style="font-size: 1.1rem; font-weight: 600; margin-bottom: 0.5rem;">No Active Codes</div>
            <div style="font-size: 0.9rem;">Generate a code to get started</div>
          </div>
        `;
        return;
      }

      let html = '';
      response.codes.forEach(code => {
        const isExpired = code.expires_at && new Date(code.expires_at) < new Date();
        const isDisabled = !code.is_active;
        const statusColor = isDisabled ? '#ef4444' : isExpired ? '#f59e0b' : '#10b981';
        const statusText = isDisabled ? 'Disabled' : isExpired ? 'Expired' : 'Active';
        const expiryText = code.expires_at ? new Date(code.expires_at).toLocaleDateString() : 'Never';
        
        html += `
          <div style="padding: 1rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-left: 3px solid ${statusColor}; border-radius: 8px;">
            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.75rem;">
              <div style="flex: 1;">
                <div style="font-family: monospace; font-size: 1.1rem; font-weight: 600; letter-spacing: 1px; margin-bottom: 0.5rem;">${code.code}</div>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap; font-size: 0.85rem; color: rgba(255,255,255,0.6);">
                  <span>👤 ${code.permission_level}</span>
                  <span>🎫 ${code.type}</span>
                  <span>🔢 Uses: ${code.used_count}/${code.max_uses || '∞'}</span>
                  <span>📅 Expires: ${expiryText}</span>
                </div>
                ${code.note ? `<div style="margin-top: 0.5rem; font-size: 0.85rem; color: rgba(255,255,255,0.5);">📝 ${code.note}</div>` : ''}
              </div>
              <div style="display: flex; gap: 0.5rem; flex-direction: column; align-items: end;">
                <span style="padding: 0.25rem 0.75rem; background: rgba(${statusColor === '#10b981' ? '16,185,129' : statusColor === '#f59e0b' ? '245,158,11' : '239,68,68'},0.15); border: 1px solid rgba(${statusColor === '#10b981' ? '16,185,129' : statusColor === '#f59e0b' ? '245,158,11' : '239,68,68'},0.3); border-radius: 12px; font-size: 0.75rem; font-weight: 600; color: ${statusColor};">${statusText}</span>
                ${!isDisabled && !isExpired ? `<button onclick="disableAccessCode('${code.code}')" style="padding: 0.25rem 0.75rem; background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.3); border-radius: 6px; color: #ef4444; font-size: 0.75rem; cursor: pointer;">🚫 Disable</button>` : ''}
                ${isDisabled ? `<button onclick="enableAccessCode('${code.code}')" style="padding: 0.25rem 0.75rem; background: rgba(16,185,129,0.15); border: 1px solid rgba(16,185,129,0.3); border-radius: 6px; color: #10b981; font-size: 0.75rem; cursor: pointer;">✅ Enable</button>` : ''}
                <button onclick="deleteAccessCode('${code.code}')" style="padding: 0.25rem 0.75rem; background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.2); border-radius: 6px; color: #ef4444; font-size: 0.75rem; cursor: pointer;">🗑️ Delete</button>
              </div>
            </div>
          </div>
        `;
      });

      listEl.innerHTML = html;
    } catch (error) {
      console.error('Load access codes error:', error);
      listEl.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: #ef4444;">
          <div style="font-size: 2rem; margin-bottom: 1rem;">❌</div>
          <div>Error loading codes: ${error.message}</div>
        </div>
      `;
    }
  }

  // Global functions for code management
  window.disableAccessCode = async function(code) {
    if (!confirm('Disable this access code? Users won\'t be able to use it anymore.')) return;
    
    try {
      const response = await apiFetch('/api/access-codes/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, guildId: state.guildId })
      });

      if (response.success) {
        showNotification('✅ Code disabled', 'success');
        await loadAccessCodes();
      } else {
        showNotification('❌ ' + (response.error || 'Failed to disable code'), 'error');
      }
    } catch (error) {
      showNotification('❌ Error: ' + error.message, 'error');
    }
  };

  window.enableAccessCode = async function(code) {
    try {
      const response = await apiFetch('/api/access-codes/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, guildId: state.guildId })
      });

      if (response.success) {
        showNotification('✅ Code enabled', 'success');
        await loadAccessCodes();
      } else {
        showNotification('❌ ' + (response.error || 'Failed to enable code'), 'error');
      }
    } catch (error) {
      showNotification('❌ Error: ' + error.message, 'error');
    }
  };

  window.deleteAccessCode = async function(code) {
    if (!confirm('Permanently delete this access code? This cannot be undone.')) return;
    
    try {
      const response = await apiFetch('/api/access-codes/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, guildId: state.guildId })
      });

      if (response.success) {
        showNotification('✅ Code deleted', 'success');
        await loadAccessCodes();
      } else {
        showNotification('❌ ' + (response.error || 'Failed to delete code'), 'error');
      }
    } catch (error) {
      showNotification('❌ Error: ' + error.message, 'error');
    }
  };

  // =========================================
  // MODULE LOADERS - MANAGEMENT
  // =========================================

  async function loadTickets() {
    console.log('[TICKETS] Loading tickets...');
    try {
      const data = await apiFetch('/api/tickets/list');
      console.log('[TICKETS] Data:', data);
      // Tickets UI already in HTML, just fetch and populate
    } catch (error) {
      console.error('[TICKETS] Error:', error);
      showNotification('❌ Failed to load tickets: ' + error.message, 'error');
    }
  }

  async function loadAnalytics() {
    console.log('[ANALYTICS] Loading analytics...');
    try {
      // Initialize analytics widgets first
      initAnalyticsWidgets();
      
      // Initialize charts (fetches live data and starts auto-refresh)
      if (window.initializeCharts) {
        await window.initializeCharts();
      }
      
      // Start auto-refresh for charts (every 5 seconds)
      if (window.startChartAutoRefresh) {
        window.startChartAutoRefresh();
      }
      
      // Load overview stats for analytics widgets
      await loadOverviewStats();
    } catch (error) {
      console.error('[ANALYTICS] Error:', error);
      showNotification('❌ Failed to load analytics: ' + error.message, 'error');
    }
  }

  async function loadLogs() {
    console.log('[LOGS] Loading logs...');
    try {
      const data = await apiFetch('/api/logs?limit=100');
      console.log('[LOGS] Data:', data);
      // Populate log table with fetched data
    } catch (error) {
      console.error('[LOGS] Error:', error);
      showNotification('❌ Failed to load logs: ' + error.message, 'error');
    }
  }

  // =========================================
  // MODULE LOADERS - SECURITY
  // =========================================

  async function loadSecurityModuleSettings(module) {
    console.log(`[SECURITY] Loading ${module} settings...`);
    try {
      const data = await apiFetch(`/api/security/${module}/settings`);
      console.log(`[SECURITY] ${module} settings:`, data);
      
      // Populate form fields with settings data
      populateSecurityForm(module, data);
    } catch (error) {
      console.error(`[SECURITY] Error loading ${module}:`, error);
      showNotification(`❌ Failed to load ${module} settings: ${error.message}`, 'error');
    }
  }

  function populateSecurityForm(module, data) {
    const tab = document.querySelector(`[data-tab="security-${module}"]`);
    if (!tab) return;
    
    console.log(`[SECURITY] Populating ${module} form with:`, data);
    // Toggle states
    const checkboxes = tab.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(cb => {
      const key = cb.id || cb.name;
      if (key && data[key] !== undefined) cb.checked = data[key];
    });
    
    // Input values
    const inputs = tab.querySelectorAll('input[type="number"], input[type="text"]');
    inputs.forEach(inp => {
      const key = inp.id || inp.name;
      if (key && data[key] !== undefined) inp.value = data[key];
    });
    
    // Select values
    const selects = tab.querySelectorAll('select');
    selects.forEach(sel => {
      const key = sel.id || sel.name;
      if (key && data[key] !== undefined) sel.value = data[key];
    });
  }

  // =========================================
  // MODULE LOADERS - CONFIGURATION
  // =========================================

  async function loadTicketSettings() {
    console.log('[CONFIG] Loading ticket settings...');
    try {
      // Get the guild ID from the current dashboard context
      const guildId = window.CURRENT_GUILD_ID || localStorage.getItem('selectedGuildId');
      if (!guildId) {
        console.warn('[CONFIG] No guild ID available for ticket settings');
        return;
      }

      const response = await fetch(`/api/guild/${guildId}/settings`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch ticket settings');
      const data = await response.json();
      console.log('[CONFIG] Ticket settings:', data);
      
      // Populate ticket configuration form
      const tab = document.querySelector('[data-tab="config-tickets"]');
      if (tab) {
        const ticketChannelSelect = tab.querySelector('#ticket-panel-channel');
        const ticketCategorySelect = tab.querySelector('#ticket-category');
        const transcriptChannelSelect = tab.querySelector('#ticket-transcript-channel');
        const welcomeMessageTextarea = tab.querySelector('textarea');
        const ticketToggle = tab.querySelector('input[type="checkbox"]');
        
        if (ticketChannelSelect && data.ticket_panel_channel) {
          ticketChannelSelect.value = data.ticket_panel_channel;
        }
        if (ticketCategorySelect && data.ticket_category) {
          ticketCategorySelect.value = data.ticket_category;
        }
        if (transcriptChannelSelect && data.ticket_transcript_channel) {
          transcriptChannelSelect.value = data.ticket_transcript_channel;
        }
        if (welcomeMessageTextarea && data.ticket_welcome_message) {
          welcomeMessageTextarea.value = data.ticket_welcome_message;
        }
        if (ticketToggle && data.tickets_enabled !== undefined) {
          ticketToggle.checked = data.tickets_enabled;
        }
      }
    } catch (error) {
      console.error('[CONFIG] Error loading ticket settings:', error);
      // Don't show error as settings may not exist yet
    }
  }

  async function loadWelcomeSettings() {
    console.log('[CONFIG] Loading welcome settings...');
    try {
      const guildId = window.CURRENT_GUILD_ID || localStorage.getItem('selectedGuildId');
      if (!guildId) {
        console.warn('[CONFIG] No guild ID available for welcome settings');
        return;
      }

      // Populate channel select
      const channelSelect = document.getElementById('welcome-channel');
      if (channelSelect && window.guildChannels) {
        channelSelect.innerHTML = '<option value="">Select Channel...</option>';
        window.guildChannels.filter(ch => ch.type === 0).forEach(ch => {
          const opt = document.createElement('option');
          opt.value = ch.id;
          opt.textContent = '#' + ch.name;
          channelSelect.appendChild(opt);
        });
      }

      const response = await fetch(`/api/guild/${guildId}/settings`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch welcome settings');
      const data = await response.json();
      console.log('[CONFIG] Welcome settings:', data);
      
      // Set welcome values
      const welcomeEnabled = document.getElementById('welcome-enabled');
      const welcomeChannel = document.getElementById('welcome-channel');
      const welcomeMessage = document.getElementById('welcome-message');
      const welcomePingUser = document.getElementById('welcome-ping-user');
      const welcomeEmbedEnabled = document.getElementById('welcome-embed-enabled');
      const welcomeDeleteAfter = document.getElementById('welcome-delete-after');
      
      if (welcomeEnabled) welcomeEnabled.checked = data.welcome_enabled || false;
      if (welcomeChannel) welcomeChannel.value = data.welcome_channel_id || '';
      if (welcomeMessage) welcomeMessage.value = data.welcome_message || '';
      if (welcomePingUser) welcomePingUser.checked = data.welcome_ping_user || false;
      if (welcomeEmbedEnabled) welcomeEmbedEnabled.checked = data.welcome_embed_enabled || false;
      if (welcomeDeleteAfter) welcomeDeleteAfter.value = data.welcome_delete_after || 0;

    } catch (error) {
      console.error('[CONFIG] Error loading welcome settings:', error);
    }
  }

  async function loadGoodbyeSettings() {
    console.log('[CONFIG] Loading goodbye settings...');
    try {
      const guildId = window.CURRENT_GUILD_ID || localStorage.getItem('selectedGuildId');
      if (!guildId) {
        console.warn('[CONFIG] No guild ID available for goodbye settings');
        return;
      }

      // Populate channel select
      const channelSelect = document.getElementById('goodbye-channel');
      if (channelSelect && window.guildChannels) {
        channelSelect.innerHTML = '<option value="">Select Channel...</option>';
        window.guildChannels.filter(ch => ch.type === 0).forEach(ch => {
          const opt = document.createElement('option');
          opt.value = ch.id;
          opt.textContent = '#' + ch.name;
          channelSelect.appendChild(opt);
        });
      }

      const response = await fetch(`/api/guild/${guildId}/settings`, {
        credentials: 'include'
      });
      if (!response.ok) throw new Error('Failed to fetch goodbye settings');
      const data = await response.json();
      console.log('[CONFIG] Goodbye settings:', data);
      
      // Set goodbye values
      const goodbyeEnabled = document.getElementById('goodbye-enabled');
      const goodbyeChannel = document.getElementById('goodbye-channel');
      const goodbyeMessage = document.getElementById('goodbye-message');
      const goodbyeEmbedEnabled = document.getElementById('goodbye-embed-enabled');
      const goodbyeDeleteAfter = document.getElementById('goodbye-delete-after');
      
      if (goodbyeEnabled) goodbyeEnabled.checked = data.goodbye_enabled || false;
      if (goodbyeChannel) goodbyeChannel.value = data.goodbye_channel_id || '';
      if (goodbyeMessage) goodbyeMessage.value = data.goodbye_message || '';
      if (goodbyeEmbedEnabled) goodbyeEmbedEnabled.checked = data.goodbye_embed_enabled || false;
      if (goodbyeDeleteAfter) goodbyeDeleteAfter.value = data.goodbye_delete_after || 0;

    } catch (error) {
      console.error('[CONFIG] Error loading goodbye settings:', error);
    }
  }

  async function loadVerificationSettings() {
    console.log('[CONFIG] Loading verification settings...');
    try {
      const data = await apiFetch('/api/verification/settings');
      console.log('[CONFIG] Verification settings:', data);
      
      // Populate verification configuration form
      const tab = document.querySelector('[data-tab="config-verification"]');
      if (tab) populateSecurityForm('verification', data);
    } catch (error) {
      console.error('[CONFIG] Error loading verification settings:', error);
    }
  }

  async function loadAutoRoleSettings() {
    console.log('[CONFIG] Loading auto-role settings...');
    try {
      const data = await apiFetch('/api/autorole/settings');
      console.log('[CONFIG] Auto-role settings:', data);
      
      // Populate auto-role configuration form
      const tab = document.querySelector('[data-tab="config-autorole"]');
      if (tab) {
        const enable = tab.querySelector('input[type="checkbox"]');
        if (enable && data.enabled !== undefined) enable.checked = data.enabled;
        
        // Auto-role list would be populated from data.roles array
        if (data.roles && Array.isArray(data.roles)) {
          // TODO: Dynamically create role list items
        }
      }
    } catch (error) {
      console.error('[CONFIG] Error loading auto-role settings:', error);
    }
  }

  // =========================================
  // MODULE LOADERS - TOOLS
  // =========================================

  async function loadAccessGeneration() {
    console.log('[TOOLS] Loading access generation...');
    // This is the shared access admin view - already handled by loadSharedAccessView()
    await loadSharedAccessView();
  }

  async function loadAccessShare() {
    console.log('[TOOLS] Loading access share...');
    // This is for sharing/redeeming codes - already handled by loadSharedAccessView()
    await loadSharedAccessView();
  }

  // =========================================
  // SAVE HANDLERS FOR ALL MODULES
  // =========================================

  async function saveSecuritySettings(module) {
    console.log(`[SECURITY] Saving ${module} settings...`);
    const tab = document.querySelector(`[data-tab="security-${module}"]`);
    if (!tab) return;
    
    const data = {};
    
    // Collect checkbox values
    tab.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      const key = cb.id || cb.name;
      if (key) data[key] = cb.checked;
    });
    
    // Collect input values
    tab.querySelectorAll('input[type="number"], input[type="text"]').forEach(inp => {
      const key = inp.id || inp.name;
      if (key) data[key] = inp.value;
    });
    
    // Collect select values
    tab.querySelectorAll('select').forEach(sel => {
      const key = sel.id || sel.name;
      if (key) data[key] = sel.value;
    });
    
    try {
      const result = await apiFetch(`/api/security/${module}/update`, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      showNotification(`✅ ${module} settings saved`, 'success');
    } catch (error) {
      console.error(`[SECURITY] Error saving ${module}:`, error);
      showNotification(`❌ Failed to save ${module} settings: ${error.message}`, 'error');
    }
  }

  async function saveWelcomeSettings() {
    console.log('[CONFIG] Saving welcome settings...');
    try {
      const guildId = window.CURRENT_GUILD_ID || localStorage.getItem('selectedGuildId');
      if (!guildId) {
        showNotification('❌ No guild selected', 'error');
        return;
      }

      const welcomeEnabled = document.getElementById('welcome-enabled')?.checked || false;
      const welcomeChannel = document.getElementById('welcome-channel')?.value || '';
      const welcomeMessage = document.getElementById('welcome-message')?.value || '';
      const welcomePingUser = document.getElementById('welcome-ping-user')?.checked || false;
      const welcomeEmbedEnabled = document.getElementById('welcome-embed-enabled')?.checked || false;
      const welcomeDeleteAfter = document.getElementById('welcome-delete-after')?.value || 0;

      const response = await fetch(`/api/guild/${guildId}/settings`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          welcome_enabled: welcomeEnabled,
          welcome_channel_id: welcomeChannel,
          welcome_message: welcomeMessage,
          welcome_ping_user: welcomePingUser,
          welcome_embed_enabled: welcomeEmbedEnabled,
          welcome_delete_after: parseInt(welcomeDeleteAfter) || 0
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to save');
      }

      showNotification('✅ Welcome settings saved successfully', 'success');
    } catch (error) {
      console.error('[CONFIG] Error saving welcome settings:', error);
      showNotification('❌ Failed to save settings: ' + error.message, 'error');
    }
  }

  async function saveGoodbyeSettings() {
    console.log('[CONFIG] Saving goodbye settings...');
    try {
      const guildId = window.CURRENT_GUILD_ID || localStorage.getItem('selectedGuildId');
      if (!guildId) {
        showNotification('❌ No guild selected', 'error');
        return;
      }

      const goodbyeEnabled = document.getElementById('goodbye-enabled')?.checked || false;
      const goodbyeChannel = document.getElementById('goodbye-channel')?.value || '';
      const goodbyeMessage = document.getElementById('goodbye-message')?.value || '';
      const goodbyeEmbedEnabled = document.getElementById('goodbye-embed-enabled')?.checked || false;
      const goodbyeDeleteAfter = document.getElementById('goodbye-delete-after')?.value || 0;

      const response = await fetch(`/api/guild/${guildId}/settings`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          goodbye_enabled: goodbyeEnabled,
          goodbye_channel_id: goodbyeChannel,
          goodbye_message: goodbyeMessage,
          goodbye_embed_enabled: goodbyeEmbedEnabled,
          goodbye_delete_after: parseInt(goodbyeDeleteAfter) || 0
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        throw new Error(errorData.error || 'Failed to save');
      }

      showNotification('✅ Goodbye settings saved successfully', 'success');
    } catch (error) {
      console.error('[CONFIG] Error saving goodbye settings:', error);
      showNotification('❌ Failed to save settings: ' + error.message, 'error');
    }
  }

  async function saveTicketSettings() {
    console.log('[CONFIG] Saving ticket settings...');
    const tab = document.querySelector('[data-tab="config-tickets"]');
    const selects = tab.querySelectorAll('select');
    const textarea = tab.querySelector('textarea');
    
    try {
      await apiFetch('/api/tickets/update', {
        method: 'POST',
        body: JSON.stringify({
          category: selects[0]?.value || '',
          supportRole: selects[1]?.value || '',
          customMessage: textarea?.value || ''
        })
      });
      
      showNotification('ƒo. Ticket settings saved', 'success');
      showNotification('✅ Ticket settings saved', 'success');
    } catch (error) {
      console.error('[CONFIG] Error saving ticket settings:', error);
      showNotification('❌ Failed to save ticket settings: ' + error.message, 'error');
    }
  }

  // =========================================
  // INITIALIZATION
  // =========================================

  // Setup save button event listeners for configuration forms
  function initSaveHandlers() {
    // Security module save buttons
    const securityModules = ['antiraid', 'antispam', 'antinuke', 'antiphishing', 'moderation'];
    securityModules.forEach(module => {
      const tab = document.querySelector(`[data-tab="security-${module}"]`);
      if (tab) {
        const btn = tab.querySelector('button[style*="10b981"]');
        if (btn && !btn.hasListener) {
          btn.addEventListener('click', () => saveSecuritySettings(module));
          btn.hasListener = true;
        }
      }
    });

    // Ticket settings save button
    const ticketTab = document.querySelector('[data-tab="config-tickets"]');
    if (ticketTab) {
      const btn = ticketTab.querySelector('button[style*="10b981"]');
      if (btn && !btn.hasListener) {
        btn.addEventListener('click', saveTicketSettings);
        btn.hasListener = true;
      }
    }

    // Welcome settings save button
    const welcomeTab = document.querySelector('[data-tab="config-welcome"]');
    if (welcomeTab) {
      const btn = welcomeTab.querySelector('#save-welcome-btn');
      if (btn && !btn.hasListener) {
        btn.addEventListener('click', saveWelcomeSettings);
        btn.hasListener = true;
      }
    }

    // Goodbye settings save button
    const goodbyeTab = document.querySelector('[data-tab="config-goodbye"]');
    if (goodbyeTab) {
      const btn = goodbyeTab.querySelector('#save-goodbye-btn');
      if (btn && !btn.hasListener) {
        btn.addEventListener('click', saveGoodbyeSettings);
        btn.hasListener = true;
      }
    }

    // Verification settings save button
    const verifyTab = document.querySelector('[data-tab="config-verification"]');
    if (verifyTab) {
      const btn = verifyTab.querySelector('button[style*="10b981"]');
      if (btn && !btn.hasListener) {
        btn.addEventListener('click', () => saveSecuritySettings('verification'));
        btn.hasListener = true;
      }
    }

    // Auto-role settings save button
    const autoroleTab = document.querySelector('[data-tab="config-autorole"]');
    if (autoroleTab) {
      const btn = autoroleTab.querySelector('button[style*="10b981"]');
      if (btn && !btn.hasListener) {
        btn.addEventListener('click', () => saveSecuritySettings('autorole'));
        btn.hasListener = true;
      }
    }
  }

  // =========================================
  // SIDEBAR NAVIGATION INITIALIZATION
  // =========================================

  function initSidebarNavigation() {
    // Setup category toggles
    $$('.nav-category-toggle').forEach(btn => {
      btn.addEventListener('click', function(e) {
        e.preventDefault();
        const category = this.dataset.category;
        const categoryEl = this.closest('.nav-category');
        
        if (categoryEl.classList.contains('expanded')) {
          categoryEl.classList.remove('expanded');
          localStorage.setItem(`nav-category-${category}`, 'collapsed');
        } else {
          categoryEl.classList.add('expanded');
          localStorage.setItem(`nav-category-${category}`, 'expanded');
        }
      });
    });

    // Restore category states from localStorage
    ['management', 'security', 'configuration', 'tools'].forEach(category => {
      const state = localStorage.getItem(`nav-category-${category}`) || 'expanded';
      const categoryEl = document.querySelector(`.nav-category [data-category="${category}"]`)?.closest('.nav-category');
      if (categoryEl && state === 'expanded') {
        categoryEl.classList.add('expanded');
      } else if (categoryEl) {
        categoryEl.classList.remove('expanded');
      }
    });

    // Setup nav item click handlers
    $$('.nav-item').forEach(item => {
      item.addEventListener('click', function(e) {
        e.preventDefault();
        const view = this.dataset.view;
        if (view) {
          switchView(view);
          
          // Update active state
          $$('.nav-item').forEach(i => i.classList.remove('active'));
          this.classList.add('active');
        }
      });
    });
  }

  async function init() {
    console.log('Initializing Dashboard Pro...');
    
    // Initialize sidebar navigation early
    initSidebarNavigation();
    
    // CRITICAL: Wait for auth to complete before initializing rest of dashboard
    await initAuth();
    
    initGuild();
    bindEvents();
    // initUpdateModal removed with legacy update system; keep a no-op stub to avoid errors
    if (typeof initUpdateModal === 'function') {
      try { initUpdateModal(); } catch(e) { /* ignore */ }
    }
    // Access code redemption UI may be disabled; guard the call
    if (typeof setupAccessCodeRedemption === 'function') {
      try { setupAccessCodeRedemption(); } catch(e) { console.warn('setupAccessCodeRedemption failed:', e); }
    }
    // Initial view selection: ?view=..., hash #/..., or last saved
    try {
      const url = new URL(window.location.href);
      const paramView = url.searchParams.get('view');
      const hashViewRaw = window.location.hash || '';
      const hashView = hashViewRaw ? hashViewRaw.replace(/^#\/?/, '') : null;
      const lastView = localStorage.getItem('dashboard:lastView');
      const requestedView = paramView || hashView || lastView || 'overview';
      const validViews = new Set(['overview','security','tickets','activity-logs','permissions','settings','verification-queue','shared-access','console','levels','help','config-tickets','config-welcome','config-goodbye','config-verification','config-autorole','security-antiraid','security-antispam','security-antinuke','security-antiphishing','security-moderation','analytics','customize','upgrade']);
      const initialView = validViews.has(requestedView) ? requestedView : 'overview';
      switchView(initialView);
    } catch (e) {
      console.warn('Initial view selection failed, defaulting to overview:', e);
      switchView('overview');
    }
    
    // Load servers first, then data
    try {
      await loadServers();
      
      if (state.guildId) {
        // Load initial data
        await Promise.allSettled([
          loadSubscriptionStatus(),
          loadServerInfo(),
          loadSecurityStats(),
          loadTickets(),
          loadVerificationQueue()
        ]);
        console.log('[INIT] Initial data loaded successfully');
        
        // Initialize verification queue handlers
        initVerificationQueue();
        
        // Check access code redemption visibility
        checkAccessCodeRedemptionVisibility();
      } else {
        console.warn('[INIT] No guild ID available after loading servers');
      }
    } catch (error) {
      console.error('[INIT] Failed to load initial data:', error);
      // Continue anyway - user can retry
    }
    
    // Initialize analytics widgets and fetch initial metrics
    try {
      initAnalyticsWidgets();
      (async () => {
        try {
          const a = await apiFetch(`/api/analytics/overview?guildId=${encodeURIComponent(state.guildId)}`);
          if (a && a.metrics) {
            state.analytics = Object.assign({}, state.analytics, a.metrics);
          }
        } catch (e) { console.warn('Failed to load initial analytics overview:', e); }
        await loadOverviewStats();
        renderAnalyticsWidgets();
        // Initialize charts after analytics data is loaded
        try {
          initializeCharts();
        } catch (e) { console.warn('Chart initialization failed:', e); }
      })();
    } catch (e) { console.warn('Analytics init failed:', e); }

    // Connect WebSocket after everything is initialized
    connectWebSocket();

    // Ensure we're subscribed to the current guild on connection
    setTimeout(() => {
      try {
        if (ws && ws.readyState === WebSocket.OPEN && state.guildId) {
          ws.send(JSON.stringify({ type: 'subscribe', guildId: state.guildId }));
        }
      } catch (e) { console.error('Initial subscribe failed:', e); }
    }, 500);

    // Poll security stats/events every 30s as a fallback if events aren't pushed
    setInterval(() => {
      loadSecurityEvents();
      loadSecurityStats();
      loadActionLogs(state.actionFilter || 'all');
      loadServerInfo();
      loadOverviewStats();
      // Refresh charts every 30s - but now updates existing instances instead of recreating
      try {
        initializeCharts();
      } catch (e) { /* silent fail - charts may not be ready */ }
    }, 30000);

    // Refresh button: force-reload all data for current selected server
    const refreshBtn = $('#refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async (e) => {
        e.preventDefault();
        // Clear transient UI state and refetch everything
        try {
          setLoading('serverInfo', true);
          setLoading('securityStats', true);
          const container = $('#action-log-list');
          if (container) {
            container.innerHTML = '';
          }
          // Refetch for the selected server
          await loadServerInfo();
          await loadOverviewStats();
          await loadSecurityStats();
          await loadSecurityEvents();
          await loadActionLogs('all');
          renderAnalyticsWidgets();
          // Refresh charts as well
          try {
            initializeCharts();
          } catch (e) { console.warn('Chart refresh failed:', e); }
          showNotification('Refreshed data for current server', 'success');
        } catch (err) {
          console.error('Refresh failed:', err);
          showNotification('Failed to refresh data', 'error');
        } finally {
          setLoading('serverInfo', false);
          setLoading('securityStats', false);
        }
      });
    }
    
    // Add advanced button event handlers after settings are loaded
    function setupAdvancedButtons() {
      $$('.btn-advanced').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          const feature = btn.getAttribute('data-feature');
          console.log(`[ADVANCED] Opening advanced settings for: ${feature}`);
          
          // Show the advanced settings modal
          showAdvancedModal(feature);
        });
      });
    }
    
    // Call after initial load
    setTimeout(setupAdvancedButtons, 1000);
  }
  
  // Advanced Settings Configuration
  function getAdvancedFeatureConfig(feature) {
    const configs = {
      raid: {
        title: 'Anti-Raid Protection',
        icon: 'fas fa-shield-alt',
        settings: [
          { key: 'raid_threshold', label: 'User Join Threshold', type: 'number', min: 3, max: 20, value: 5, description: 'Number of users joining within timeframe to trigger protection' },
          { key: 'raid_timeout_minutes', label: 'Detection Window (minutes)', type: 'number', min: 1, max: 60, value: 10, description: 'Time window for detecting rapid joins' },
          { key: 'raid_action', label: 'Default Action', type: 'select', options: [
            { value: 'kick', text: 'Kick Users' },
            { value: 'ban', text: 'Ban Users' },
            { value: 'timeout', text: 'Timeout Users' }
          ], value: 'kick', description: 'Action to take against suspected raid members' },
          { key: 'raid_dm_notify', label: 'DM Notifications', type: 'checkbox', value: true, description: 'Send DM to affected users explaining the action' }
        ]
      },
      spam: {
        title: 'Anti-Spam Protection', 
        icon: 'fas fa-comment-slash',
        settings: [
          { key: 'spam_threshold', label: 'Message Threshold', type: 'number', min: 2, max: 10, value: 3, description: 'Number of similar messages to trigger spam detection' },
          { key: 'spam_timeout_seconds', label: 'Detection Window (seconds)', type: 'number', min: 10, max: 120, value: 30, description: 'Time window for spam detection' },
          { key: 'spam_delete_messages', label: 'Delete Spam Messages', type: 'checkbox', value: true, description: 'Automatically delete detected spam messages' },
          { key: 'spam_mute_duration', label: 'Mute Duration (seconds)', type: 'number', min: 60, max: 3600, value: 300, description: 'How long to mute detected spammers' }
        ]
      },
      phishing: {
        title: 'Anti-Phishing Protection',
        icon: 'fas fa-fishing-net', 
        settings: [
          { key: 'phishing_check_links', label: 'Check All Links', type: 'checkbox', value: true, description: 'Scan all posted links for phishing attempts' },
          { key: 'phishing_delete_messages', label: 'Delete Phishing Messages', type: 'checkbox', value: true, description: 'Automatically delete messages containing phishing links' },
          { key: 'phishing_ban_user', label: 'Ban Phishing Posters', type: 'checkbox', value: false, description: 'Automatically ban users posting phishing links' }
        ]
      },
      antinuke: {
        title: 'Anti-Nuke Protection',
        icon: 'fas fa-bomb',
        settings: [
          { key: 'antinuke_role_limit', label: 'Role Action Limit', type: 'number', min: 1, max: 10, value: 3, description: 'Max roles created/deleted within 10 seconds before triggering protection' },
          { key: 'antinuke_channel_limit', label: 'Channel Action Limit', type: 'number', min: 1, max: 10, value: 3, description: 'Max channels created/deleted within 10 seconds before triggering protection' },
          { key: 'antinuke_ban_limit', label: 'Ban/Kick Limit', type: 'number', min: 1, max: 10, value: 3, description: 'Max bans/kicks within 10 seconds before triggering protection' },
          { key: 'antinuke_auto_ban', label: 'Auto-Ban Violators', type: 'checkbox', value: true, description: 'Automatically ban users who trigger anti-nuke protection' },
          { key: 'antinuke_reverse_actions', label: 'Reverse Malicious Actions', type: 'checkbox', value: true, description: 'Attempt to undo malicious changes (delete created roles/channels, unban victims)' }
        ]
      },
      verification: {
        title: 'User Verification',
        icon: 'fas fa-user-check',
        settings: [
          { key: 'verification_profile', label: 'Verification Profile', type: 'select', options: [
            { value: 'standard', text: 'Standard - Button Click Only' },
            { value: 'high', text: 'High Security - Age Check + Captcha' },
            { value: 'ultra', text: 'Ultra - Staff Approval Required' }
          ], value: 'standard', description: 'Security level for new member verification' },
          { key: 'verification_timeout_minutes', label: 'Verification Timeout (minutes)', type: 'number', min: 5, max: 1440, value: 30, description: 'Time before pending verification expires' },
          { key: 'auto_kick_unverified', label: 'Auto-Kick on Timeout', type: 'checkbox', value: false, description: 'Automatically kick users who fail to verify in time' },
          { key: 'verification_min_account_age_days', label: 'Min Account Age (days)', type: 'number', min: 0, max: 365, value: 7, description: 'Minimum Discord account age (0 = disabled)' },
          { key: 'enable_ai_scan', label: 'Enable AI Risk Scan', type: 'checkbox', value: true, description: 'Scan new users for suspicious patterns' },
          { key: 'enable_dashboard_buttons', label: 'Dashboard Actions', type: 'checkbox', value: true, description: 'Allow verification actions from dashboard' },
          { key: 'enable_staff_dm', label: 'Staff DM Alerts', type: 'checkbox', value: true, description: 'Send DM to staff when verification pending (Ultra mode)' },
          { key: 'verification_language', label: 'Verification Language', type: 'select', options: [
            { value: 'en', text: 'English' },
            { value: 'es', text: 'Spanish' },
            { value: 'de', text: 'German' },
            { value: 'fr', text: 'French' },
            { value: 'pt', text: 'Portuguese' }
          ], value: 'en', description: 'Language for verification messages' }
        ]
      },
      welcome: {
        title: 'Welcome System',
        icon: 'fas fa-hand-wave',
        settings: [
          { key: 'welcome_embed_enabled', label: 'Use Embed Messages', type: 'checkbox', value: true, description: 'Send welcome messages as rich embeds' },
          { key: 'welcome_ping_user', label: 'Ping New Users', type: 'checkbox', value: false, description: 'Mention the user in welcome messages' },
          { key: 'welcome_delete_after', label: 'Auto-delete After (minutes)', type: 'number', min: 0, max: 1440, value: 0, description: 'Auto-delete welcome messages (0 = never)' }
        ]
      },
      tickets: {
        title: 'Ticket System',
        icon: 'fas fa-ticket-alt',
        settings: [
          { key: 'ticket_max_open', label: 'Max Open Tickets per User', type: 'number', min: 1, max: 10, value: 3, description: 'Maximum tickets a user can have open' },
          { key: 'ticket_auto_close_hours', label: 'Auto-close After (hours)', type: 'number', min: 1, max: 168, value: 72, description: 'Auto-close inactive tickets after this time' },
          { key: 'ticket_transcript_enabled', label: 'Save Transcripts', type: 'checkbox', value: true, description: 'Save ticket conversation transcripts' },
          { key: 'ticket_rating_enabled', label: 'Enable Ratings', type: 'checkbox', value: true, description: 'Allow users to rate support experience' }
        ]
      },
      automod: {
        title: 'Auto-Moderation',
        icon: 'fas fa-robot',
        settings: [
          { key: 'automod_toxicity_threshold', label: 'Toxicity Threshold', type: 'range', min: 0.1, max: 1.0, step: 0.1, value: 0.8, description: 'AI toxicity detection sensitivity (higher = stricter)' },
          { key: 'automod_caps_percentage', label: 'Max Caps Percentage', type: 'number', min: 10, max: 100, value: 70, description: 'Maximum percentage of caps in a message' },
          { key: 'automod_emoji_limit', label: 'Max Emojis per Message', type: 'number', min: 1, max: 50, value: 10, description: 'Maximum emojis allowed in a single message' },
          { key: 'automod_mention_limit', label: 'Max Mentions per Message', type: 'number', min: 1, max: 20, value: 5, description: 'Maximum mentions allowed in a single message' }
        ]
      },
      autorole: {
        title: 'Auto-Role Assignment',
        icon: 'fas fa-user-tag',
        settings: [
          { key: 'autorole_delay_seconds', label: 'Assignment Delay (seconds)', type: 'number', min: 0, max: 300, value: 5, description: 'Delay before assigning roles to new members' },
          { key: 'autorole_remove_on_leave', label: 'Remove on Leave', type: 'checkbox', value: true, description: 'Remove auto-assigned roles when user leaves' },
          { key: 'autorole_bypass_bots', label: 'Bypass for Bots', type: 'checkbox', value: true, description: 'Skip auto-role assignment for bot accounts' }
        ]
      },
      'xp-system': {
        title: 'XP & Leveling System',
        icon: 'fas fa-star',
        settings: [
          { key: 'xp_message', label: 'XP per Message', type: 'number', min: 1, max: 100, value: 20, description: 'Amount of XP earned per message sent' },
          { key: 'xp_voice', label: 'XP per Voice Minute', type: 'number', min: 1, max: 50, value: 10, description: 'Amount of XP earned per minute in voice chat' },
          { key: 'xp_cooldown', label: 'XP Cooldown (seconds)', type: 'number', min: 10, max: 300, value: 60, description: 'Minimum time between earning message XP' },
          { key: 'xp_levelup_show_xp', label: 'Show XP in Level Up', type: 'checkbox', value: true, description: 'Display XP progress in level up messages' },
          { key: 'xp_levelup_show_messages', label: 'Show Level Up Messages', type: 'checkbox', value: true, description: 'Send messages when users level up' }
        ]
      }
    };
    
    return configs[feature] || null;
  }
  
  // Show Advanced Settings Modal
  function showAdvancedModal(feature) {
    const config = getAdvancedFeatureConfig(feature);
    if (!config) {
      showNotification(`Advanced settings for ${feature} not available`, 'info');
      return;
    }
    
    // Remove existing modal if any
    const existingModal = $('#advanced-modal');
    if (existingModal) existingModal.remove();
    
    // Create modal
    const modal = document.createElement('div');
    modal.id = 'advanced-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class=\"modal-content advanced-modal\">
        <div class=\"modal-header\">
          <h3><i class=\"${config.icon}\"></i> ${config.title} - Advanced Settings</h3>
          <button class=\"modal-close\" onclick=\"closeAdvancedModal()\">\n            <i class=\"fas fa-times\"></i>\n          </button>
        </div>
        <div class=\"modal-body\">
          <div class=\"advanced-settings-form\">
            ${generateAdvancedSettingsHTML(config)}
          </div>
        </div>
        <div class=\"modal-footer\">
          <button class=\"btn-secondary\" onclick=\"closeAdvancedModal()\">Cancel</button>
          <button class=\"btn-primary\" onclick=\"saveAdvancedSettings('${feature}')\">Save Settings</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(modal);
    
    // Show modal with animation
    setTimeout(() => modal.classList.add('show'), 10);
    
    // Load current values
    loadAdvancedValues(feature, config);
  }
  
  function generateAdvancedSettingsHTML(config) {
    return config.settings.map(setting => {
      switch(setting.type) {
        case 'number':
          {
            const min = Number(setting.min ?? 0);
            const max = Number(setting.max ?? 10);
            const step = Number(setting.step ?? 1);
            const current = Number(setting.value ?? min);
            const opts = [];
            for (let v = min; v <= max; v += step) {
              const selected = v === current ? 'selected' : '';
              opts.push(`<option value=\"${v}\" ${selected}>${v}</option>`);
            }
            return `
              <div class=\"form-group\">
                <label for=\"${setting.key}\">${setting.label}</label>
                <select id=\"${setting.key}\" name=\"${setting.key}\" class=\"form-select\">${opts.join('')}</select>
                <small>${setting.description}</small>
              </div>
            `;
          }
        case 'checkbox':
          return `
            <div class=\"form-group\">
              <label class=\"checkbox-label\">
                <input type=\"checkbox\" id=\"${setting.key}\" name=\"${setting.key}\" 
                       ${setting.value ? 'checked' : ''}>
                ${setting.label}
              </label>
              <small>${setting.description}</small>
            </div>
          `;
        case 'select':
          const options = setting.options.map(opt => 
            `<option value=\"${opt.value}\" ${opt.value == setting.value ? 'selected' : ''}>${opt.text}</option>`
          ).join('');
          return `
            <div class=\"form-group\">
              <label for=\"${setting.key}\">${setting.label}</label>
              <select id=\"${setting.key}\" name=\"${setting.key}\">${options}</select>
              <small>${setting.description}</small>
            </div>
          `;
        case 'range':
          return `
            <div class=\"form-group\">
              <label for=\"${setting.key}\">${setting.label}</label>
              <input type=\"range\" id=\"${setting.key}\" name=\"${setting.key}\" 
                     min=\"${setting.min}\" max=\"${setting.max}\" step=\"${setting.step}\" 
                     value=\"${setting.value}\" oninput=\"updateRangeValue('${setting.key}')\">
              <span id=\"${setting.key}-value\">${setting.value}</span>
              <small>${setting.description}</small>
            </div>
          `;
        default:
          return '';
      }
    }).join('');
  }
  
  // Global functions for modal interaction
  window.closeAdvancedModal = function() {
    const modal = $('#advanced-modal');
    if (modal) {
      modal.classList.remove('show');
      setTimeout(() => modal.remove(), 300);
    }
  };
  
  window.updateRangeValue = function(key) {
    const range = $(`#${key}`);
    const valueSpan = $(`#${key}-value`);
    if (range && valueSpan) {
      valueSpan.textContent = range.value;
    }
  };
  
  function loadAdvancedValues(feature, config) {
    // Load current values from state.currentConfig if available
    config.settings.forEach(setting => {
      const element = $(`#${setting.key}`);
      if (element && state.currentConfig) {
        const value = state.currentConfig[setting.key];
        if (value !== undefined) {
          if (setting.type === 'checkbox') {
            element.checked = Boolean(value);
          } else {
            element.value = value;
            if (setting.type === 'range') {
              const valueSpan = $(`#${setting.key}-value`);
              if (valueSpan) valueSpan.textContent = value;
            }
          }
        }
      }
    });
  }
  
  window.saveAdvancedSettings = async function(feature) {
    try {
      const formData = {};
      const config = getAdvancedFeatureConfig(feature);
      
      // Collect all form values
      config.settings.forEach(setting => {
        const element = $(`#${setting.key}`);
        if (element) {
          if (setting.type === 'checkbox') {
            formData[setting.key] = element.checked;
          } else if (setting.type === 'number' || setting.type === 'range') {
            formData[setting.key] = parseFloat(element.value) || setting.value;
          } else if (setting.type === 'select') {
            // Keep value as is, but if original was numeric, coerce to number
            const raw = element.value;
            const num = Number(raw);
            formData[setting.key] = Number.isNaN(num) ? raw : num;
          } else {
            formData[setting.key] = element.value || setting.value;
          }
        }
      });
      
      console.log(`[ADVANCED] Saving ${feature} settings:`, formData);
      
      const response = await apiFetch('/api/update-advanced-settings', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          feature: feature,
          settings: formData
        })
      });
      
      if (response.success) {
        showNotification(`${feature} advanced settings saved successfully`, 'success');
        closeAdvancedModal();
        // Update local config
        if (!state.currentConfig || typeof state.currentConfig !== 'object') {
          state.currentConfig = {};
        }
        Object.assign(state.currentConfig, formData);
        // Reload settings to reflect changes
        setTimeout(loadSettings, 500);
      } else {
        showNotification(response.error || 'Failed to save advanced settings', 'error');
      }
    } catch (error) {
      console.error('Save advanced settings error:', error);
      showNotification('Failed to save advanced settings', 'error');
    }
  };

  // ========================================
  // VERIFICATION QUEUE MODULE
  // ========================================
  
  const verificationQueue = {
    currentPage: 0,
    pageSize: 50,
    totalCount: 0,
    filters: {
      search: '',
      status: 'all',
      risk: 'all'
    },
    selectedUsers: new Set(),
    data: []
  };

  async function loadVerificationQueue() {
    if (!state.guildId) return;

    try {
      const params = new URLSearchParams({
        guildId: state.guildId,
        limit: verificationQueue.pageSize,
        offset: verificationQueue.currentPage * verificationQueue.pageSize
      });

      const response = await apiFetch(`/api/verify/queue?${params}`);
      if (!response.success) throw new Error(response.error || 'Failed to load queue');

      verificationQueue.data = response.data || [];
      verificationQueue.totalCount = response.total_count || 0;

      renderVerificationQueue();
      updateQueueUI();
    } catch (error) {
      console.error('Load verification queue error:', error);
      showNotification('Failed to load verification queue', 'error');
    }

    // Bind Advanced Security Settings
    try {
      bindAdvancedSettings();
    } catch (e) {
      console.warn('Advanced settings bind failed:', e);
    }

    // Bind XP Settings
    try {
      bindXPSettings();
    } catch (e) {
      console.warn('XP settings bind failed:', e);
    }
  }
  function bindAdvancedSettings() {
    const refreshBtn = document.getElementById('btn-advanced-settings-refresh');
    const saveBtn = document.getElementById('btn-advanced-settings-save');
    const statusEl = document.getElementById('advanced-settings-status');

    const inputs = {
      perActorChannels: document.getElementById('set-antinuke-peractor-channels'),
      perActorRoles: document.getElementById('set-antinuke-peractor-roles'),
      perActorBans: document.getElementById('set-antinuke-peractor-bans'),
      globalChannels: document.getElementById('set-antinuke-global-channels'),
      globalRoles: document.getElementById('set-antinuke-global-roles'),
      globalBans: document.getElementById('set-antinuke-global-bans'),
      lockdownMode: document.getElementById('set-lockdown-mode'),
      quarantineBots: document.getElementById('set-quarantine-bots'),
    };

    async function loadAdvanced() {
      if (!state.guildId) return;
      if (statusEl) statusEl.textContent = 'Loading advanced settings...';
      const resp = await apiFetch(`/api/settings/security?guildId=${encodeURIComponent(state.guildId)}`, { method: 'GET' });
      if (!resp || !resp.success) { if (statusEl) statusEl.textContent = 'Failed to load settings'; return; }
      const s = resp.data || {};
      if (inputs.perActorChannels) inputs.perActorChannels.value = String(s.antiNuke?.perActor?.channels ?? 3);
      if (inputs.perActorRoles) inputs.perActorRoles.value = String(s.antiNuke?.perActor?.roles ?? 3);
      if (inputs.perActorBans) inputs.perActorBans.value = String(s.antiNuke?.perActor?.bans ?? 3);
      if (inputs.globalChannels) inputs.globalChannels.value = String(s.antiNuke?.global?.channels ?? 10);
      if (inputs.globalRoles) inputs.globalRoles.value = String(s.antiNuke?.global?.roles ?? 10);
      if (inputs.globalBans) inputs.globalBans.value = String(s.antiNuke?.global?.bans ?? 10);
      if (inputs.lockdownMode) inputs.lockdownMode.value = String(s.lockdown?.mode ?? 'auto');
      if (inputs.quarantineBots) inputs.quarantineBots.value = String(s.lockdown?.quarantineBots ?? true);
      if (statusEl) statusEl.textContent = 'Advanced settings loaded';
    }

    async function saveAdvanced() {
      if (!state.guildId) return;
      if (statusEl) statusEl.textContent = 'Saving...';
      const payload = {
        antiNuke: {
          perActor: {
            channels: Number(inputs.perActorChannels?.value ?? 3),
            roles: Number(inputs.perActorRoles?.value ?? 3),
            bans: Number(inputs.perActorBans?.value ?? 3),
          },
          global: {
            channels: Number(inputs.globalChannels?.value ?? 10),
            roles: Number(inputs.globalRoles?.value ?? 10),
            bans: Number(inputs.globalBans?.value ?? 10),
          }
        },
        lockdown: {
          mode: String(inputs.lockdownMode?.value ?? 'auto'),
          quarantineBots: (inputs.quarantineBots?.value ?? 'true') === 'true'
        }
      };
      const resp = await apiFetch(`/api/settings/security?guildId=${encodeURIComponent(state.guildId)}`, { method: 'POST', body: JSON.stringify(payload) });
      if (resp && resp.success) {
        if (statusEl) statusEl.textContent = 'Saved successfully';
        showNotification('✅ Advanced settings saved', 'success');
      } else {
        if (statusEl) statusEl.textContent = 'Save failed';
        showNotification('❌ Failed to save settings', 'error');
      }
    }

    if (refreshBtn) refreshBtn.addEventListener('click', loadAdvanced);
    if (saveBtn) saveBtn.addEventListener('click', saveAdvanced);
    // Auto-load when switching to settings view
    document.querySelectorAll('.nav-link[data-view="settings"]').forEach(link => {
      link.addEventListener('click', () => setTimeout(loadAdvanced, 150));
    });
  }

  function bindXPSettings() {
    const saveBtn = document.getElementById('save-xp-settings');
    const statusEl = document.getElementById('xp-settings-status');

    if (!saveBtn) return; // XP settings not available

    const inputs = {
      messageXp: document.getElementById('xp-message-amount'),
      voiceXp: document.getElementById('xp-voice-amount'),
      cooldown: document.getElementById('xp-cooldown'),
      levelupChannel: document.getElementById('xp-levelup-channel')
    };

    // Add range input listeners to update display values
    if (inputs.messageXp) {
      inputs.messageXp.addEventListener('input', (e) => {
        const display = document.getElementById('xp-message-display');
        if (display) display.textContent = e.target.value;
      });
    }

    if (inputs.voiceXp) {
      inputs.voiceXp.addEventListener('input', (e) => {
        const display = document.getElementById('xp-voice-display');
        if (display) display.textContent = e.target.value;
      });
    }

    async function saveXPSettings() {
      if (!state.guildId) {
        showNotification('No server selected', 'error');
        return;
      }

      if (statusEl) statusEl.textContent = 'Saving XP settings...';

      try {
        const payload = {
          xp_message: parseInt(inputs.messageXp?.value || 20),
          xp_voice: parseInt(inputs.voiceXp?.value || 10),
          xp_cooldown: parseInt(inputs.cooldown?.value || 60),
          xp_levelup_channel: inputs.levelupChannel?.value || ''
        };

        console.log('[XP] Saving XP settings:', payload);

        const response = await apiFetch(`/api/settings/xp?guildId=${encodeURIComponent(state.guildId)}`, {
          method: 'POST',
          body: JSON.stringify(payload)
        });

        if (response && response.success) {
          if (statusEl) {
            statusEl.textContent = '✅ XP settings saved';
            statusEl.style.color = 'var(--color-success)';
          }
          showNotification('XP settings saved successfully', 'success');
          console.log('[XP] Settings saved successfully');
        } else {
          throw new Error(response?.error || 'Save failed');
        }
      } catch (error) {
        console.error('[XP] Failed to save settings:', error);
        if (statusEl) {
          statusEl.textContent = '❌ Failed to save';
          statusEl.style.color = 'var(--color-danger)';
        }
        showNotification('Failed to save XP settings', 'error');
      }

      setTimeout(() => {
        if (statusEl) statusEl.textContent = '';
      }, 3000);
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', saveXPSettings);
    }
  }

  function renderVerificationQueue() {
    const tbody = $('#queue-tbody');
    const emptyState = $('#queue-empty');
    const disabledState = $('#queue-disabled');
    const tableWrapper = $('.queue-table-wrapper');
    const setupWarning = $('#setup-warning');

    if (!tbody) return;

    // Check if verification is enabled
    const verificationEnabled = state.serverInfo?.config?.verification_enabled;
    if (!verificationEnabled) {
      if (disabledState) disabledState.style.display = 'block';
      if (tableWrapper) tableWrapper.style.display = 'none';
      if (emptyState) emptyState.style.display = 'none';
      if (setupWarning) setupWarning.style.display = 'none';
      return;
    }

    if (disabledState) disabledState.style.display = 'none';

    // Check setup completeness
    const config = state.serverInfo?.config || {};
    const issues = [];
    if (!config.unverified_role_id) issues.push(typeof t === 'function' ? t('queue.setup.issue_unverified_role') : 'Unverified role not configured');
    if (!config.verified_role_id) issues.push(typeof t === 'function' ? t('queue.setup.issue_verified_role') : 'Verified role not configured');
    if (!config.logs_channel_id && !config.log_channel_id) issues.push(typeof t === 'function' ? t('queue.setup.issue_log_channel') : 'Log channel not configured');

    if (setupWarning) {
      if (issues.length > 0) {
        setupWarning.style.display = 'flex';
        const issuesList = $('#setup-issues-list');
        if (issuesList) {
          issuesList.innerHTML = issues.map(i => `<li>${i}</li>`).join('');
        }
      } else {
        setupWarning.style.display = 'none';
      }
    }

    // Apply filters
    let filtered = verificationQueue.data.filter(item => {
      if (verificationQueue.filters.search) {
        const search = verificationQueue.filters.search.toLowerCase();
        if (!item.username?.toLowerCase().includes(search)) return false;
      }
      if (verificationQueue.filters.status !== 'all' && item.status !== verificationQueue.filters.status) {
        return false;
      }
      if (verificationQueue.filters.risk !== 'all' && item.verificationSummary?.riskLevel !== verificationQueue.filters.risk) {
        return false;
      }
      return true;
    });

    tbody.innerHTML = '';

    if (filtered.length === 0) {
      if (tableWrapper) tableWrapper.style.display = 'none';
      if (emptyState) emptyState.style.display = 'block';
      return;
    }

    if (tableWrapper) tableWrapper.style.display = 'block';
    if (emptyState) emptyState.style.display = 'none';

    const template = $('#queue-row-template');
    if (!template) return;

    filtered.forEach(item => {
      const row = template.content.cloneNode(true).querySelector('.queue-row');
      
      // Checkbox
      const checkbox = row.querySelector('.queue-checkbox');
      checkbox.dataset.userId = item.userId;
      checkbox.checked = verificationQueue.selectedUsers.has(item.userId);
      checkbox.addEventListener('change', (e) => {
        if (e.target.checked) {
          verificationQueue.selectedUsers.add(item.userId);
        } else {
          verificationQueue.selectedUsers.delete(item.userId);
        }
        updateBatchButtons();
      });

      // User info
      const avatar = row.querySelector('.user-avatar');
      avatar.src = item.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
      avatar.alt = item.username || 'User';

      const userName = row.querySelector('.user-name');
      userName.textContent = item.username || 'Unknown User';

      const userId = row.querySelector('.user-id');
      userId.textContent = `ID: ${item.userId}`;

      // Flags
      const flagsContainer = row.querySelector('.user-flags');
      (item.flags || []).forEach(flag => {
        const badge = document.createElement('span');
        badge.className = 'flag-badge';
        badge.textContent = flag.replace('_', ' ');
        flagsContainer.appendChild(badge);
      });

      // Account age
      const accountAge = row.querySelector('.account-age');
      if (item.accountCreatedAt) {
        const created = new Date(item.accountCreatedAt);
        const days = Math.floor((Date.now() - created.getTime()) / (1000*60*60*24));
        accountAge.textContent = (typeof t === 'function' ? t('time.days_old', { count: days }) : `${days}d old`);
      } else {
        accountAge.textContent = (typeof t === 'function' ? t('time.unknown') : 'Unknown');
      }

      // Join time
      const joinTime = row.querySelector('.join-time');
      if (item.joinedAt) {
        const joined = new Date(item.joinedAt);
        const ago = formatTimeAgo(joined);
        joinTime.textContent = ago;
      } else {
        joinTime.textContent = (typeof t === 'function' ? t('time.unknown') : 'Unknown');
      }

      // Risk
      const riskScore = row.querySelector('.risk-score');
      const riskLevel = row.querySelector('.risk-level');
      const riskBadge = row.querySelector('.risk-badge');
      const level = item.verificationSummary?.riskLevel || 'low';
      const score = item.riskScore || 0;
      
      riskScore.textContent = score;
      riskLevel.textContent = (typeof t === 'function' ? t(`queue.risk.${level}`) : level) || level;
      riskBadge.classList.add(`risk-${level}`);

      // Status
      const statusBadge = row.querySelector('.status-badge');
      const statusKey = `verification.status.${item.status}`;
      statusBadge.textContent = (typeof t === 'function' ? t(statusKey) : item.status) || item.status;
      statusBadge.classList.add(`status-${item.status}`);

      // Notes button
      const notesBtn = row.querySelector('.note-btn');
      if (notesBtn) {
        const hasNotes = !!(item.notes && item.notes.trim().length);
        notesBtn.textContent = hasNotes ? (typeof t === 'function' ? t('queue.notes.btn_has_notes') : '📝 Notes') : (typeof t === 'function' ? t('queue.notes.btn_add') : 'Add Note');
        if (hasNotes) notesBtn.classList.add('has-notes'); else notesBtn.classList.remove('has-notes');
        notesBtn.addEventListener('click', () => openNoteModal(item));
      }

      // Actions
      const verifyBtn = row.querySelector('[data-action="verify"]');
      const skipBtn = row.querySelector('[data-action="skip"]');
      const kickBtn = row.querySelector('[data-action="kick"]');
      const approveBtn = row.querySelector('[data-action="approve"]');
      const rejectBtn = row.querySelector('[data-action="reject"]');

      // Show approve/reject for awaiting_approval; captcha handling
      if (item.status === 'awaiting_approval') {
        approveBtn.style.display = 'inline-block';
        rejectBtn.style.display = 'inline-block';
        verifyBtn.style.display = 'none';
      } else if (item.status === 'captcha_required') {
        verifyBtn.textContent = 'Start Captcha';
        verifyBtn.classList.remove('action-verify');
        verifyBtn.classList.add('action-captcha');
        verifyBtn.dataset.action = 'captcha_start';
      }

      [verifyBtn, skipBtn, kickBtn, approveBtn, rejectBtn].forEach(btn => {
        if (!btn) return;
        btn.addEventListener('click', async () => {
          const act = btn.dataset.action;
          if (act === 'captcha_start') {
            await startCaptchaFlow(item.userId);
          } else {
            await performQueueAction(item.userId, act);
          }
        });
      });

      tbody.appendChild(row);
    });
  }

  async function performQueueAction(userId, action) {
    try {
      const response = await apiFetch('/api/verify/action', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          userId,
          action
        })
      });

      if (response.success) {
        showNotification((typeof t === 'function' ? t('queue.toast.success') : 'Action successful'), 'success');
        verificationQueue.selectedUsers.delete(userId);
        await loadVerificationQueue();
      } else {
        showNotification(response.error || (typeof t === 'function' ? t('queue.toast.error') : 'Action failed'), 'error');
      }
    } catch (error) {
      console.error(`Queue action ${action} error:`, error);
      showNotification((typeof t === 'function' ? t('queue.toast.error') : 'Action failed'), 'error');
    }
  }

  async function performBatchAction(action) {
    if (verificationQueue.selectedUsers.size === 0) {
      showNotification((typeof t === 'function' ? t('queue.toast.no_selection') : 'No users selected'), 'warning');
      return;
    }

    const userIds = Array.from(verificationQueue.selectedUsers);
    
    try {
      const response = await apiFetch('/api/verify/queue/batch', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          action,
          userIds
        })
      });

      if (response.success) {
        const results = response.results || [];
        const success = results.filter(r => r.result === 'success').length;
        const already = results.filter(r => r.result === 'noop').length;
        const failed = results.filter(r => r.result === 'error').length;
        let message = (typeof t === 'function' ? t('queue.batch.summary_base', { action, success }) : `Batch ${action}: ${success} succeeded`);
        if (already > 0) message += (typeof t === 'function' ? t('queue.batch.summary_already', { already }) : `, ${already} already processed`);
        if (failed > 0) message += (typeof t === 'function' ? t('queue.batch.summary_failed', { failed }) : `, ${failed} failed`);
        showNotification(message, failed > 0 ? 'warning' : 'success');
        verificationQueue.selectedUsers.clear();
        await loadVerificationQueue();
      } else {
        showNotification(response.error || (typeof t === 'function' ? t('queue.toast.error') : 'Action failed'), 'error');
      }
    } catch (error) {
      console.error(`Batch ${action} error:`, error);
      showNotification((typeof t === 'function' ? t('queue.toast.error') : 'Action failed'), 'error');
    }
  }

  // Captcha flow (localized)
  async function startCaptchaFlow(userId) {
    try {
      const startResp = await apiFetch('/api/verify/captcha/start', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId, userId })
      });
      if (!startResp.success) {
        showNotification(startResp.error || (typeof t === 'function' ? t('captcha.start_failed') : 'Failed to start captcha'), 'error');
        return;
      }
      const providedCode = startResp.code || startResp.captchaCode || startResp.challenge;
      const promptText = (typeof t === 'function' ? t('captcha.prompt') : 'Enter captcha code');
      const entered = prompt(`${promptText} (demo): ` + (providedCode || '[code hidden]'));
      if (!entered) {
        showNotification((typeof t === 'function' ? t('captcha.entry_cancelled') : 'Captcha entry cancelled'), 'info');
        return;
      }
      const submitResp = await apiFetch('/api/verify/captcha/submit', {
        method: 'POST',
        body: JSON.stringify({ guildId: state.guildId, userId, code: entered })
      });
      if (submitResp.success) {
        showNotification((typeof t === 'function' ? t('captcha.passed') : 'Captcha passed'), 'success');
        await loadVerificationQueue();
      } else {
        showNotification(submitResp.error || (typeof t === 'function' ? t('captcha.failed') : 'Captcha failed'), 'error');
      }
    } catch (err) {
      console.error('Captcha flow error', err);
      showNotification((typeof t === 'function' ? t('captcha.flow_error') : 'Captcha flow error'), 'error');
    }
  }

  // Notes Modal Logic
  let currentNoteTarget = null;
  function openNoteModal(item) {
    currentNoteTarget = item;
    const modal = document.getElementById('note-modal');
    if (!modal) return;
    modal.style.display = 'block';
    const avatarEl = document.getElementById('note-user-avatar');
    const userNameEl = document.getElementById('note-username');
    const userIdEl = document.getElementById('note-user-id');
    const existingEl = document.getElementById('existing-notes');
    const ultraHint = document.getElementById('ultra-note-hint');
    if (avatarEl) avatarEl.src = item.avatarUrl || 'https://cdn.discordapp.com/embed/avatars/0.png';
    if (userNameEl) userNameEl.textContent = item.username || 'Unknown User';
    if (userIdEl) userIdEl.textContent = `ID: ${item.userId}`;
    if (existingEl) existingEl.textContent = item.notes || (typeof t === 'function' ? t('queue.modal.notes.no_notes') : '— No notes —');
    if (ultraHint) {
      const profileMode = item.verificationSummary?.profileMode;
      ultraHint.style.display = (profileMode === 'ultra' && item.status === 'awaiting_approval') ? 'block' : 'none';
    }
    const input = document.getElementById('note-input');
    if (input) input.value = '';
  }

  function closeNoteModal() {
    const modal = document.getElementById('note-modal');
    if (modal) modal.style.display = 'none';
    currentNoteTarget = null;
  }

  async function submitNote(mode) {
    if (!currentNoteTarget) return;
    const input = document.getElementById('note-input');
    const text = input?.value || '';
    if (!text.trim()) {
      showNotification((typeof t === 'function' ? t('queue.toast.note_empty') : 'Note is empty'), 'warning');
      return;
    }
    try {
      const resp = await apiFetch('/api/verify/note', {
        method: 'POST',
        body: JSON.stringify({
          guildId: state.guildId,
          userId: currentNoteTarget.userId,
          noteText: text,
          mode: mode === 'update' ? 'update' : 'append'
        })
      });
      if (!resp.success) {
        showNotification(resp.error || (typeof t === 'function' ? t('queue.toast.note_save_failed') : 'Failed to save note'), 'error');
        return;
      }
      currentNoteTarget.notes = resp.notes;
      showNotification((typeof t === 'function' ? t('queue.toast.note_saved') : 'Note saved'), 'success');
      closeNoteModal();
      await loadVerificationQueue();
    } catch (e) {
      console.error('Save note error', e);
      showNotification((typeof t === 'function' ? t('queue.toast.note_save_failed') : 'Failed to save note'), 'error');
    }
  }

  // Wire modal buttons
  document.addEventListener('DOMContentLoaded', () => {
    const closeBtn = document.querySelector('#note-modal .close-note-modal');
    if (closeBtn) closeBtn.addEventListener('click', closeNoteModal);
    const appendBtn = document.getElementById('append-note-btn');
    const replaceBtn = document.getElementById('replace-note-btn');
    if (appendBtn) appendBtn.addEventListener('click', () => submitNote('append'));
    if (replaceBtn) replaceBtn.addEventListener('click', () => submitNote('update'));
    // Close on outside click
    const modal = document.getElementById('note-modal');
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeNoteModal();
      });
    }
  });

  function updateQueueUI() {
    const countBadge = $('#queue-count');
    if (countBadge) {
      countBadge.textContent = (typeof t === 'function' ? t('queue.count.pending', { count: verificationQueue.totalCount }) : `${verificationQueue.totalCount} pending`);
    }

    const pageInfo = $('#page-info');
    if (pageInfo) {
      const totalPages = Math.ceil(verificationQueue.totalCount / verificationQueue.pageSize);
      pageInfo.textContent = (typeof t === 'function' ? t('queue.pagination.page_of', { current: verificationQueue.currentPage + 1, total: totalPages || 1 }) : `Page ${verificationQueue.currentPage + 1} of ${totalPages || 1}`);
    }

    const prevBtn = $('#prev-page');
    const nextBtn = $('#next-page');
    if (prevBtn) prevBtn.disabled = verificationQueue.currentPage === 0;
    if (nextBtn) {
      const totalPages = Math.ceil(verificationQueue.totalCount / verificationQueue.pageSize);
      nextBtn.disabled = verificationQueue.currentPage >= totalPages - 1 || verificationQueue.totalCount === 0;
    }

    updateBatchButtons();
  }

  function updateBatchButtons() {
    const hasSelection = verificationQueue.selectedUsers.size > 0;
    const buttons = ['#batch-verify-selected', '#batch-skip-selected', '#batch-kick-selected'];
    buttons.forEach(sel => {
      const btn = $(sel);
      if (btn) btn.disabled = !hasSelection;
    });
  }

  function formatTimeAgo(date) {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 60) return (typeof t === 'function' ? t('time.seconds_ago', { count: seconds }) : `${seconds}s ago`);
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return (typeof t === 'function' ? t('time.minutes_ago', { count: minutes }) : `${minutes}m ago`);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return (typeof t === 'function' ? t('time.hours_ago', { count: hours }) : `${hours}h ago`);
    const days = Math.floor(hours / 24);
    return (typeof t === 'function' ? t('time.days_ago', { count: days }) : `${days}d ago`);
  }

  function initVerificationQueue() {
    const refreshBtn = $('#refresh-queue');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', loadVerificationQueue);
    }

    const selectAllCheckbox = $('#select-all-queue');
    if (selectAllCheckbox) {
      selectAllCheckbox.addEventListener('change', (e) => {
        const checkboxes = $$('.queue-checkbox');
        checkboxes.forEach(cb => {
          cb.checked = e.target.checked;
          const userId = cb.dataset.userId;
          if (e.target.checked) {
            verificationQueue.selectedUsers.add(userId);
          } else {
            verificationQueue.selectedUsers.delete(userId);
          }
        });
        updateBatchButtons();
      });
    }

    // Batch action buttons
    const batchVerifyBtn = $('#batch-verify-selected');
    const batchSkipBtn = $('#batch-skip-selected');
    const batchKickBtn = $('#batch-kick-selected');

    if (batchVerifyBtn) batchVerifyBtn.addEventListener('click', () => performBatchAction('verify'));
    if (batchSkipBtn) batchSkipBtn.addEventListener('click', () => performBatchAction('skip'));
    if (batchKickBtn) batchKickBtn.addEventListener('click', () => performBatchAction('kick'));

    // Filters
    const searchInput = $('#search-username');
    const statusFilter = $('#filter-status');
    const riskFilter = $('#filter-risk');
    const clearFiltersBtn = $('#clear-filters');

    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        verificationQueue.filters.search = e.target.value;
        renderVerificationQueue();
      });
    }

    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        verificationQueue.filters.status = e.target.value;
        renderVerificationQueue();
      });
    }

    if (riskFilter) {
      riskFilter.addEventListener('change', (e) => {
        verificationQueue.filters.risk = e.target.value;
        renderVerificationQueue();
      });
    }

    if (clearFiltersBtn) {
      clearFiltersBtn.addEventListener('click', () => {
        verificationQueue.filters = { search: '', status: 'all', risk: 'all' };
        if (searchInput) searchInput.value = '';
        if (statusFilter) statusFilter.value = 'all';
        if (riskFilter) riskFilter.value = 'all';
        renderVerificationQueue();
      });
    }

    // Pagination
    const prevBtn = $('#prev-page');
    const nextBtn = $('#next-page');

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        if (verificationQueue.currentPage > 0) {
          verificationQueue.currentPage--;
          loadVerificationQueue();
        }
      });
    }

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        const totalPages = Math.ceil(verificationQueue.totalCount / verificationQueue.pageSize);
        if (verificationQueue.currentPage < totalPages - 1) {
          verificationQueue.currentPage++;
          loadVerificationQueue();
        }
      });
    }
  }

  // Listen for verification events via WebSocket
  function handleVerificationEvent(data) {
    if (state.currentView === 'verification-queue') {
      // Auto-refresh queue on verification events
      loadVerificationQueue();
    }
  }

  // =========================================
  // SHARED ACCESS MANAGEMENT FUNCTIONS
  // =========================================

  async function loadSharedAccessView() {
    console.log('[SharedAccess] loadSharedAccessView ENTRY - guildId:', state.guildId, 'authToken:', !!state.authToken);
    // Ensure a guild is selected before attempting to load data
    if (!state.guildId) {
      // Show placeholder message instead of perpetual "Loading..."
      const usersTableBody = $('#shared-access-users-table tbody');
      if (usersTableBody) {
        usersTableBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align:center; color: var(--color-muted);">Select a server first...</td></tr>';
      }
      const codesTableBody = $('#shared-access-codes-table tbody');
      if (codesTableBody) {
        codesTableBody.innerHTML = '<tr><td colspan="6" style="padding: 2rem; text-align:center; color: var(--color-muted);">Select a server first...</td></tr>';
      }
      console.warn('[SharedAccess] No guild selected; waiting for user to pick a server');
      return;
    }

    try {
      console.log('[SharedAccess] Loading role dropdown...');
      try {
        await Promise.race([
          loadRoleDropdown(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('loadRoleDropdown timeout')), 5000))
        ]);
      } catch (e) {
        console.warn('[SharedAccess] loadRoleDropdown failed:', e.message);
      }
      
      try {
        await Promise.race([
          populateStaffRoleSelects(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('populateStaffRoleSelects timeout')), 5000))
        ]);
      } catch (e) {
        console.warn('[SharedAccess] populateStaffRoleSelects failed:', e.message);
      }
      
      console.log('[SharedAccess] Setting up event listeners...');
      setupSharedAccessEventListeners();
      
      console.log('[SharedAccess] Refreshing shared access data...');
      try {
        await Promise.race([
          refreshSharedAccessData(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('refreshSharedAccessData timeout')), 10000))
        ]);
      } catch (e) {
        console.error('[SharedAccess] refreshSharedAccessData failed:', e.message);
        // Show error in tables
        const usersTableBody = $('#shared-access-users-table tbody');
        if (usersTableBody) {
          usersTableBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: #ef4444;">Failed to load: ' + e.message + '</td></tr>';
        }
        const codesTableBody = $('#shared-access-codes-table tbody');
        if (codesTableBody) {
          codesTableBody.innerHTML = '<tr><td colspan="6" style="padding: 2rem; text-align: center; color: #ef4444;">Failed to load: ' + e.message + '</td></tr>';
        }
      }
      
      try {
        await Promise.race([
          loadStaffRoles(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('loadStaffRoles timeout')), 3000))
        ]);
      } catch (e) {
        console.warn('[SharedAccess] loadStaffRoles failed:', e.message);
      }
      
      try {
        await Promise.race([
          loadAdvancedPermissions(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('loadAdvancedPermissions timeout')), 3000))
        ]);
      } catch (e) {
        console.warn('[SharedAccess] loadAdvancedPermissions failed:', e.message);
      }
      
      console.log('[SharedAccess] loadSharedAccessView COMPLETE');
    } catch (e) {
      console.error('[SharedAccess] Error during load:', e.message || e);
    }
  }

  // Load server roles into dropdown
  async function loadRoleDropdown() {
    try {
      if (!state.roles || state.roles.length === 0) {
        // Fetch roles if not already loaded
        const dashboardData = await apiFetch(`/api/dashboard-data?guildId=${encodeURIComponent(state.guildId)}`);
        if (dashboardData && dashboardData.roles) {
          state.roles = dashboardData.roles;
        }
      }

      const roleDropdown = $('#grant-role-dropdown');
      if (roleDropdown && state.roles) {
        // Filter out @everyone and sort by position
        const selectableRoles = state.roles
          .filter(role => role.name !== '@everyone')
          .sort((a, b) => b.position - a.position);

        roleDropdown.innerHTML = '<option value="">Select a role...</option>' +
          selectableRoles.map(role => 
            `<option value="${role.id}">${escapeHtml(role.name)}</option>`
          ).join('');
      }
    } catch (error) {
      console.error('Error loading role dropdown:', error);
      const roleDropdown = $('#grant-role-dropdown');
      if (roleDropdown) {
        roleDropdown.innerHTML = '<option value="">Failed to load roles</option>';
      }
    }
  }

  // Populate Mod/Admin role selects from cached roles
  async function populateStaffRoleSelects() {
    try {
      if (!state.roles || state.roles.length === 0) return; // Skip if no roles loaded

      const selectableRoles = (state.roles || [])
        .filter(role => role.name !== '@everyone')
        .sort((a, b) => b.position - a.position);

      const modSel = document.getElementById('mod-role-select');
      const adminSel = document.getElementById('admin-role-select');
      const optionsHtml = '<option value="" style="background: #1a1a1a; color: #fff;">Select a role...</option>' + selectableRoles.map(r => `<option value="${r.id}" style="background: #1a1a1a; color: #fff;">${escapeHtml(r.name)}</option>`).join('');
      if (modSel) modSel.innerHTML = optionsHtml;
      if (adminSel) adminSel.innerHTML = optionsHtml;
    } catch (e) {
      console.error('[SharedAccess] populateStaffRoleSelects error:', e);
    }
  }

  // Load saved staff roles
  async function loadStaffRoles() {
    try {
      const res = await apiFetch(`/api/dashboard/${state.guildId}/staff-roles`);
      if (res && res.success && res.data) {
        const { modRoleId, adminRoleId } = res.data;
        const modSel = document.getElementById('mod-role-select');
        const adminSel = document.getElementById('admin-role-select');
        if (modSel && modRoleId) modSel.value = modRoleId;
        if (adminSel && adminRoleId) adminSel.value = adminRoleId;
      }
    } catch (e) {
      console.warn('[SharedAccess] loadStaffRoles failed:', e);
    }
  }

  // Save staff roles
  async function saveStaffRoles() {
    const modSel = document.getElementById('mod-role-select');
    const adminSel = document.getElementById('admin-role-select');
    const payload = {
      modRoleId: modSel ? modSel.value || null : null,
      adminRoleId: adminSel ? adminSel.value || null : null,
    };
    try {
      const res = await apiFetch(`/api/dashboard/${state.guildId}/staff-roles`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res && res.success) {
        alert('✅ Staff roles saved');
      } else {
        alert('❌ Failed to save roles: ' + (res && res.error || 'Unknown error'));
      }
    } catch (e) {
      alert('❌ Error: ' + e.message);
    }
  }

  // Populate Admin/Mod role dropdowns for Advanced Permissions


  // Load advanced permissions (moderator)
  async function loadAdvancedPermissions() {
    try {
      const res = await apiFetch(`/api/dashboard/${state.guildId}/advanced-permissions`);
      if (res && res.success && res.data) {
        // Store permissions data in state
        state.advancedPermissions = res.data;
        
        // Set up role type dropdown change listener
        const roleTypeSelect = document.getElementById('role-type-select');
        if (roleTypeSelect) {
          // Remove old listener if any
          roleTypeSelect.onchange = null;
          // Add new listener
          roleTypeSelect.onchange = function() {
            updatePermissionCheckboxes(roleTypeSelect.value);
          };
          // Default to moderator if set, otherwise admin
          if (res.data.modRoleId) {
            roleTypeSelect.value = 'moderator';
            updatePermissionCheckboxes('moderator');
          } else if (res.data.adminRoleId) {
            roleTypeSelect.value = 'admin';
            updatePermissionCheckboxes('admin');
          }
        }
      }
    } catch (e) {
      console.warn('[SharedAccess] loadAdvancedPermissions failed:', e);
    }
  }

  function updatePermissionCheckboxes(roleType) {
    if (!state.advancedPermissions) return;
    const perms = roleType === 'admin' ? state.advancedPermissions.admin : state.advancedPermissions.mod;
    if (perms) {
      setCheckbox('perm-tickets', !!perms.tickets);
      setCheckbox('perm-analytics', !!perms.analytics);
      setCheckbox('perm-security', !!perms.security);
      setCheckbox('perm-overview', !!perms.overview);
      setCheckbox('perm-customize', !!perms.customize);
    }
  }

  function setCheckbox(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = !!val;
  }

  async function saveAdvancedPermissions() {
    const roleTypeSelect = document.getElementById('role-type-select');
    const roleType = roleTypeSelect ? roleTypeSelect.value : '';
    
    if (!roleType) {
      alert('⚠️ Please select a role type (Admin or Moderator)');
      return;
    }
    
    const payload = {
      roleType: roleType,
      tickets: !!document.getElementById('perm-tickets')?.checked,
      analytics: !!document.getElementById('perm-analytics')?.checked,
      security: !!document.getElementById('perm-security')?.checked,
      overview: !!document.getElementById('perm-overview')?.checked,
      customize: !!document.getElementById('perm-customize')?.checked,
    };
    try {
      const res = await apiFetch(`/api/dashboard/${state.guildId}/advanced-permissions`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      if (res && res.success) {
        alert('✅ Permissions saved');
        applyLockOverlays(payload);
      } else {
        alert('❌ Failed to save permissions: ' + (res && res.error || 'Unknown error'));
      }
    } catch (e) {
      alert('❌ Error: ' + e.message);
    }
  }

  // Apply lock overlays for moderators (client-side hint; server should enforce)
  function applyLockOverlays(perms) {
    // Determine if current user is admin; if not, enforce mod perms
    const isAdmin = !!state.userRoles && !!state.staffRoles && state.userRoles.includes(state.staffRoles?.adminRoleId);
    if (isAdmin) return; // Admins full access

    const areas = [
      { tab: 'tickets', allowed: !!perms.tickets },
      { tab: 'analytics', allowed: !!perms.analytics },
      { tab: 'security', allowed: !!perms.security },
      { tab: 'overview', allowed: !!perms.overview },
      { tab: 'customize', allowed: !!perms.customize },
    ];

    areas.forEach(a => {
      const tabBtn = document.querySelector(`.tab-btn[data-tab="${a.tab}"]`);
      const tabView = document.querySelector(`.tab-content[data-tab="${a.tab}"]`);
      if (!tabBtn || !tabView) return;
      if (a.allowed) {
        tabBtn.classList.remove('locked');
        const overlay = tabView.querySelector('.lock-overlay');
        if (overlay) overlay.remove();
      } else {
        tabBtn.classList.add('locked');
        if (!tabView.querySelector('.lock-overlay')) {
          const ov = document.createElement('div');
          ov.className = 'lock-overlay';
          ov.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;border:1px solid rgba(255,255,255,0.1);backdrop-filter: blur(2px);z-index:5;';
          ov.innerHTML = '<div style="text-align:center;color:#fff;"><div style="font-size:2rem;">🔒</div><div style="margin-top:0.5rem;opacity:0.8;">Access restricted by Admin</div></div>';
          tabView.style.position = 'relative';
          tabView.appendChild(ov);
        }
      }
    });
  }

  async function refreshSharedAccessData() {
    if (!state.authToken || !state.guildId) {
      console.warn('[SharedAccess] Missing authToken or guildId');
      // Show error immediately
      const usersTableBody = $('#shared-access-users-table tbody');
      if (usersTableBody) {
        usersTableBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: #ef4444;">Missing authentication or guild ID</td></tr>';
      }
      const codesTableBody = $('#shared-access-codes-table tbody');
      if (codesTableBody) {
        codesTableBody.innerHTML = '<tr><td colspan="6" style="padding: 2rem; text-align: center; color: #ef4444;">Missing authentication or guild ID</td></tr>';
      }
      return;
    }

    try {
      console.log('[SharedAccess] Fetching data for guild:', state.guildId);
      const response = await apiFetch(`/api/dashboard/${state.guildId}/shared-access`);
      console.log('[SharedAccess] Response:', response);
      // Diagnostic banner
      const diag = document.getElementById('shared-access-diagnostics');
      if (diag) {
        diag.textContent = `Resp: ${response && response.success} users:${response?.data?.users?.length||0} roles:${response?.data?.roles?.length||0} codes:${response?.data?.codes?.length||0}`;
      }
      
      if (!response || !response.success) {
        console.error('[SharedAccess] Failed to load shared access data:', response?.error || 'No response');
        if (diag) diag.textContent = `Error: ${response?.error || 'Unknown'}`;
        
        // Show error in tables
        const usersTableBody = $('#shared-access-users-table tbody');
        if (usersTableBody) {
          usersTableBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: #ef4444;">Error loading data: ' + (response?.error || 'Unknown error') + '</td></tr>';
        }
        const rolesTableBody = $('#shared-access-roles-table tbody');
        if (rolesTableBody) {
          rolesTableBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: #ef4444;">Error loading data</td></tr>';
        }
        const codesTableBody = $('#shared-access-codes-table tbody');
        if (codesTableBody) {
          codesTableBody.innerHTML = '<tr><td colspan="6" style="padding: 2rem; text-align: center; color: #ef4444;">Error loading data</td></tr>';
        }
        return;
      }

      const data = response.data;
      console.log('[SharedAccess] Data:', data);

      // Safety check - ensure data exists
      if (!data) {
        console.error('[SharedAccess] No data in response');
        const usersTableBody = $('#shared-access-users-table tbody');
        if (usersTableBody) {
          usersTableBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: #ef4444;">No data returned from server</td></tr>';
        }
        const codesTableBody = $('#shared-access-codes-table tbody');
        if (codesTableBody) {
          codesTableBody.innerHTML = '<tr><td colspan="6" style="padding: 2rem; text-align: center; color: #ef4444;">No data returned from server</td></tr>';
        }
        return;
      }

      // Render users table
      const usersTableBody = $('#shared-access-users-table tbody');
      if (usersTableBody) {
        if (!data.users || data.users.length === 0) {
          usersTableBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: var(--color-muted);">No users granted access</td></tr>';
        } else {
          usersTableBody.innerHTML = data.users.map(u => `
            <tr>
              <td style="padding: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <div style="font-weight: 600;">${escapeHtml(u.username || 'Unknown User')}</div>
                  <div style="font-size: 0.75rem; color: var(--color-muted);">${u.user_id}</div>
                </div>
              </td>
              <td style="padding: 0.75rem;">
                <div>${escapeHtml(u.granted_by_username || 'Unknown')}</div>
                <div style="font-size: 0.75rem; color: var(--color-muted);">${u.granted_by}</div>
              </td>
              <td style="padding: 0.75rem;">${new Date(u.created_at).toLocaleDateString()}</td>
              <td style="padding: 0.75rem; text-align: center;">
                <button class="btn-danger" onclick="revokeUserAccess('${u.user_id}')" style="padding: 0.5rem 1rem; font-size: 0.875rem;">Revoke</button>
              </td>
            </tr>
          `).join('');
        }
      }

      // Render roles table
      const rolesTableBody = $('#shared-access-roles-table tbody');
      if (rolesTableBody) {
        if (!data.roles || data.roles.length === 0) {
          rolesTableBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: var(--color-muted);">No roles granted access</td></tr>';
        } else {
          rolesTableBody.innerHTML = data.roles.map(r => `
            <tr>
              <td style="padding: 0.75rem;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <div style="font-weight: 600;">${escapeHtml(r.role_name || 'Unknown Role')}</div>
                  <div style="font-size: 0.75rem; color: var(--color-muted);">${r.role_id}</div>
                </div>
              </td>
              <td style="padding: 0.75rem;">
                <div>${escapeHtml(r.granted_by_username || 'Unknown')}</div>
                <div style="font-size: 0.75rem; color: var(--color-muted);">${r.granted_by}</div>
              </td>
              <td style="padding: 0.75rem;">${new Date(r.created_at).toLocaleDateString()}</td>
              <td style="padding: 0.75rem; text-align: center;">
                <button class="btn-danger" onclick="revokeRoleAccess('${r.role_id}')" style="padding: 0.5rem 1rem; font-size: 0.875rem;">Revoke</button>
              </td>
            </tr>
          `).join('');
        }
      }

      // Render access codes table
      const codesTableBody = $('#shared-access-codes-table tbody');
      if (codesTableBody) {
        if (!data.codes || data.codes.length === 0) {
          codesTableBody.innerHTML = '<tr><td colspan="6" style="padding: 2rem; text-align: center; color: var(--color-muted);">No active access codes</td></tr>';
        } else {
          codesTableBody.innerHTML = data.codes.map(c => {
            const isExpired = new Date(c.expires_at) < new Date();
            // Support multi-use codes: redeemed_users array OR single redeemed_by
            const redeemedUsers = Array.isArray(c.redeemed_users) ? c.redeemed_users : (c.redeemed_by ? [{ username: c.redeemed_by_username, user_id: c.redeemed_by }] : []);
            const isRedeemed = redeemedUsers.length > 0;
            let statusBadge = '<span style="padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; background: rgba(34, 197, 94, 0.2); color: #22c55e;">Active</span>';
            if (isRedeemed) {
              statusBadge = '<span style="padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; background: rgba(59, 130, 246, 0.2); color: #3b82f6;">Redeemed</span>';
            } else if (isExpired) {
              statusBadge = '<span style="padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.75rem; background: rgba(239, 68, 68, 0.2); color: #ef4444;">Expired</span>';
            }

            const redeemedHtml = isRedeemed ? redeemedUsers.map(u => `
              <div style="display:flex;align-items:center;gap:0.25rem;">
                <span style="font-weight:600;">${escapeHtml(u.username || 'Unknown')}</span>
                <span style="font-size:0.65rem;color:var(--color-muted);">${u.user_id}</span>
              </div>
            `).join('') : '<span style="font-size:0.75rem;color:var(--color-muted);">-</span>';

            return `
              <tr>
                <td style="padding: 0.75rem;">
                  <code style="background: rgba(255, 255, 255, 0.1); padding: 0.25rem 0.5rem; border-radius: 4px; font-family: monospace;">${c.code}</code>
                </td>
                <td style="padding: 0.75rem;">${new Date(c.expires_at).toLocaleString()}</td>
                <td style="padding: 0.75rem;">
                  <div>${escapeHtml(c.created_by_username || 'Unknown')}</div>
                  <div style="font-size: 0.75rem; color: var(--color-muted);">${c.created_by}</div>
                </td>
                <td style="padding: 0.75rem;">${statusBadge}</td>
                <td style="padding: 0.75rem;">${redeemedHtml}</td>
                <td style="padding: 0.75rem; text-align: center;">
                  ${!isRedeemed && !isExpired ? `<button class="btn-danger" onclick="deleteAccessCode('${c.code}')" style="padding: 0.5rem 1rem; font-size: 0.875rem;">Delete</button>` : '-'}
                </td>
              </tr>
            `;
          }).join('');
        }
      }

    } catch (error) {
      console.error('[SharedAccess] Error refreshing shared access data:', error);
      
      // Show error in tables
      const usersTableBody = $('#shared-access-users-table tbody');
      if (usersTableBody) {
        usersTableBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: #ef4444;">Error: ' + error.message + '</td></tr>';
      }
      const rolesTableBody = $('#shared-access-roles-table tbody');
      if (rolesTableBody) {
        rolesTableBody.innerHTML = '<tr><td colspan="4" style="padding: 2rem; text-align: center; color: #ef4444;">Error loading</td></tr>';
      }
      const codesTableBody = $('#shared-access-codes-table tbody');
      if (codesTableBody) {
        codesTableBody.innerHTML = '<tr><td colspan="6" style="padding: 2rem; text-align: center; color: #ef4444;">Error loading</td></tr>';
      }
    }
  }

  function setupSharedAccessEventListeners() {
    // Grant user access
    const grantUserBtn = $('#btn-grant-user-access');
    if (grantUserBtn) {
      grantUserBtn.onclick = async () => {
        const userIdInput = $('#grant-user-id');
        if (!userIdInput) return;

        const userId = userIdInput.value.trim();
        if (!userId) {
          alert('Please enter a Discord User ID');
          return;
        }

        try {
          const response = await apiFetch(`/api/dashboard/${state.guildId}/shared-access/grant-user`, {
            method: 'POST',
            body: JSON.stringify({ userId })
          });

          if (response.success) {
            userIdInput.value = '';
            refreshSharedAccessData();
            alert('✅ User access granted successfully!');
          } else {
            alert('❌ Failed to grant access: ' + (response.error || 'Unknown error'));
          }
        } catch (error) {
          alert('❌ Error: ' + error.message);
        }
      };
    }

    // Save staff roles
    const saveRolesBtn = document.getElementById('btn-save-staff-roles');
    if (saveRolesBtn) {
      saveRolesBtn.onclick = saveStaffRoles;
    }

    // Generate access code
    const generateCodeBtn = $('#btn-generate-access-code');
    if (generateCodeBtn) {
      generateCodeBtn.onclick = async () => {
        const hoursInput = $('#access-code-hours');
        if (!hoursInput) return;

        const hours = parseInt(hoursInput.value) || 24;
        if (hours < 1 || hours > 168) {
          alert('Expiration must be between 1 and 168 hours (1 week)');
          return;
        }

        try {
          const response = await apiFetch(`/api/dashboard/${state.guildId}/shared-access/generate-code`, {
            method: 'POST',
            body: JSON.stringify({ expiresInHours: hours })
          });

          if (response.success) {
            refreshSharedAccessData();
            alert(`✅ Access code generated!\n\nCode: ${response.code}\n\nThis code will expire in ${hours} hours.`);
          } else {
            alert('❌ Failed to generate code: ' + (response.error || 'Unknown error'));
          }
        } catch (error) {
          alert('❌ Error: ' + error.message);
        }
      };
    }
  }

  // Global functions for onclick handlers
  // Also expose friendly function names requested
  window.grantUserAccess = async function() {
    const btn = document.getElementById('btn-grant-user-access');
    if (btn) btn.click();
  };
  window.grantRoleAccess = async function() {
    const btn = document.getElementById('btn-grant-role-access');
    if (btn) btn.click();
  };
  window.generateAccessCode = async function() {
    const btn = document.getElementById('btn-generate-access-code');
    if (btn) btn.click();
  };
  window.revokeUserAccess = async function(userId) {
    if (!confirm('Are you sure you want to revoke access for this user?')) return;

    try {
      const response = await apiFetch(`/api/dashboard/${state.guildId}/shared-access/revoke-user`, {
        method: 'POST',
        body: JSON.stringify({ userId })
      });

      if (response.success) {
        refreshSharedAccessData();
        alert('✅ User access revoked successfully!');
      } else {
        alert('❌ Failed to revoke access: ' + (response.error || 'Unknown error'));
      }
    } catch (error) {
      alert('❌ Error: ' + error.message);
    }
  };

  window.revokeRoleAccess = async function(roleId) {
    if (!confirm('Are you sure you want to revoke access for this role?')) return;

    try {
      const response = await apiFetch(`/api/dashboard/${state.guildId}/shared-access/revoke-role`, {
        method: 'POST',
        body: JSON.stringify({ roleId })
      });

      if (response.success) {
        refreshSharedAccessData();
        alert('✅ Role access revoked successfully!');
      } else {
        alert('❌ Failed to revoke access: ' + (response.error || 'Unknown error'));
      }
    } catch (error) {
      alert('❌ Error: ' + error.message);
    }
  };

  window.deleteAccessCode = async function(code) {
    if (!confirm('Are you sure you want to delete this access code?')) return;

    try {
      const response = await apiFetch(`/api/dashboard/${state.guildId}/shared-access/delete-code`, {
        method: 'POST',
        body: JSON.stringify({ code })
      });

      if (response.success) {
        refreshSharedAccessData();
        alert('✅ Access code deleted successfully!');
      } else {
        alert('❌ Failed to delete code: ' + (response.error || 'Unknown error'));
      }
    } catch (error) {
      alert('❌ Error: ' + error.message);
    }
  };

  // Code Redemption functionality
  window.redeemAccessCode = async function() {
    const codeInput = document.getElementById('redeem-access-code');
    const statusEl = document.getElementById('redeem-code-status');
    
    if (!codeInput) return;
    
    const code = codeInput.value.trim().toUpperCase();
    if (!code) {
      if (statusEl) statusEl.innerHTML = '<span style="color: var(--color-warning);">⚠️ Please enter an access code</span>';
      return;
    }
    
    if (statusEl) statusEl.innerHTML = '<span style="color: var(--color-muted);">🔄 Redeeming code...</span>';
    
    try {
      const response = await apiFetch('/api/redeem-access-code', {
        method: 'POST',
        body: JSON.stringify({ code })
      });
      
      if (response.success) {
        if (statusEl) statusEl.innerHTML = `<span style="color: var(--color-success);">✅ Code redeemed! You now have access to ${response.guildName || 'the server'}</span>`;
        codeInput.value = '';
        
        // Reload servers list to show the new server
        setTimeout(() => {
          loadServers();
        }, 1500);
      } else {
        if (statusEl) statusEl.innerHTML = `<span style="color: var(--color-danger);">❌ ${response.error || 'Invalid or expired code'}</span>`;
      }
    } catch (error) {
      if (statusEl) statusEl.innerHTML = `<span style="color: var(--color-danger);">❌ Error: ${error.message}</span>`;
    }
  };

  // Setup code redemption button
  (function setupCodeRedemption() {
    const btn = document.getElementById('btn-redeem-access-code');
    if (btn) {
      btn.onclick = window.redeemAccessCode;
    }
    
    // Allow Enter key to submit
    const input = document.getElementById('redeem-access-code');
    if (input) {
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          window.redeemAccessCode();
        }
      });
    }
  })();

  // Advanced permissions save button
  (function setupAdvancedPermsButton(){
    const btn = document.getElementById('btn-save-advanced-perms');
    if (btn) btn.onclick = saveAdvancedPermissions;
  })();

  // Check if user needs access code redemption option
  function checkAccessCodeRedemptionVisibility() {
    // Show redemption card if user doesn't have owner/admin access
    // This would be set by backend when loading dashboard data
    const redemptionCard = $('#access-code-redemption-card');
    if (redemptionCard && state.serverInfo) {
      // Show if user is not owner and doesn't have administrator permissions
      const isOwner = state.serverInfo.isOwner;
      const hasAdminPerms = state.serverInfo.hasAdministrator;
      
      if (!isOwner && !hasAdminPerms) {
        redemptionCard.style.display = 'block';
      } else {
        redemptionCard.style.display = 'none';
      }
    }
  }

  // Expose apiFetch globally for use by other modules (e.g., chart-fix.js)
  window.apiFetch = apiFetch;
  window.loadVerificationQueue = loadVerificationQueue;
  window.loadSharedAccessView = loadSharedAccessView;
  
  // Debug helper
  window.debugState = function() {
    console.log('State:', {
      guildId: state.guildId,
      authToken: !!state.authToken,
      currentView: state.currentView,
      roles: state.roles?.length || 0
    });
    return state;
  };
  
  // ========================
  // CHART FUNCTIONS
  // ========================
  
  // ============================================
  // LIVE ANALYTICS CHART SYSTEM
  // Uses /api/analytics/live for real-time data only
  // Now integrated with ChartManager for proper live updates
  // ============================================
  
  // Chart instances storage (legacy - now managed by ChartManager if available)
  const chartInstances = {
    messages: null,
    joinLeave: null,
    moderation: null,
    spam: null,
    system: null
  };
  
  // Auto-refresh interval ID
  let chartRefreshInterval = null;
  
  /**
   * Destroy a chart instance safely
   */
  function destroyChart(name) {
    // Use ChartManager if available
    if (window.ChartRegistry && window.ChartRegistry.has(name)) {
      window.ChartRegistry.destroy(name);
      return;
    }
    // Fallback to local instances
    if (chartInstances[name]) {
      try { chartInstances[name].destroy(); } catch(e) {}
      chartInstances[name] = null;
    }
  }
  
  /**
   * Get or create a chart instance - uses ChartManager pattern
   * Returns existing instance for updates, or null for new creation
   */
  function getChartInstance(name) {
    // Check ChartManager first
    if (window.ChartRegistry && window.ChartRegistry.has(name)) {
      return window.ChartRegistry.get(name);
    }
    // Fallback to local instances
    return chartInstances[name];
  }
  
  /**
   * Store chart instance
   */
  function setChartInstance(name, instance) {
    // Use ChartManager if available
    if (window.ChartRegistry) {
      window.ChartRegistry.set(name, instance);
    }
    // Also store locally for compatibility
    chartInstances[name] = instance;
  }
  
  /**
   * Show/hide chart container based on data availability
   */
  function toggleChartContainer(containerId, hasData) {
    const container = document.getElementById(containerId);
    if (!container) return;
    
    const noDataMsg = container.querySelector('.no-data-message');
    
    if (hasData) {
      container.style.display = 'block';
      container.classList.remove('no-data');
      if (noDataMsg) noDataMsg.style.display = 'none';
    } else {
      container.style.display = 'none';
      container.classList.add('no-data');
      if (noDataMsg) noDataMsg.style.display = 'block';
    }
  }
  
  /**
   * Format timestamp to readable label
   */
  function formatChartLabel(isoTimestamp) {
    const date = new Date(isoTimestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  /**
   * Load Message Activity Chart - UPDATE existing or CREATE new
   */
  async function loadMessageChart(data) {
    const ctx = document.getElementById('messageChart') || document.getElementById('threatChart');
    if (!ctx || !window.Chart) return;
    
    const hasData = data.messages && data.messages.length > 0;
    toggleChartContainer('messageChartContainer', hasData);
    if (!hasData) return;
    
    const labels = data.messages.map(d => formatChartLabel(d.timestamp));
    const values = data.messages.map(d => d.count);
    
    // Check for existing chart instance
    let existingChart = getChartInstance('messages');
    
    if (existingChart) {
      // UPDATE existing chart (no destroy/recreate)
      existingChart.data.labels = labels;
      existingChart.data.datasets[0].data = values;
      existingChart.update('none'); // 'none' = no animation for live updates
      return;
    }
    
    // CREATE new chart only if none exists
    const newChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Messages',
          data: values,
          borderColor: '#3b82f6',
          backgroundColor: 'rgba(59, 130, 246, 0.1)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: '#3b82f6'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 300 },
        plugins: {
          legend: { display: true },
          title: { display: true, text: 'Message Activity (Last 24h)' }
        },
        scales: {
          x: { title: { display: true, text: 'Time' } },
          y: { beginAtZero: true, title: { display: true, text: 'Messages' } }
        }
      }
    });
    
    setChartInstance('messages', newChart);
  }
  
  /**
   * Load Join/Leave Chart - UPDATE existing or CREATE new
   */
  async function loadJoinLeaveChart(data) {
    const ctx = document.getElementById('joinLeaveChart') || document.getElementById('joinChart');
    if (!ctx || !window.Chart) return;
    
    const hasData = (data.joins && data.joins.length > 0) || (data.leaves && data.leaves.length > 0);
    toggleChartContainer('joinLeaveChartContainer', hasData);
    if (!hasData) return;
    
    // Merge join and leave timestamps
    const allTimestamps = new Set([
      ...(data.joins || []).map(d => d.timestamp),
      ...(data.leaves || []).map(d => d.timestamp)
    ]);
    const sortedTimestamps = Array.from(allTimestamps).sort();
    
    const labels = sortedTimestamps.map(t => formatChartLabel(t));
    const joinValues = sortedTimestamps.map(t => {
      const match = (data.joins || []).find(d => d.timestamp === t);
      return match ? match.count : 0;
    });
    const leaveValues = sortedTimestamps.map(t => {
      const match = (data.leaves || []).find(d => d.timestamp === t);
      return match ? match.count : 0;
    });
    
    // Check for existing chart instance
    let existingChart = getChartInstance('joinLeave');
    
    if (existingChart) {
      // UPDATE existing chart
      existingChart.data.labels = labels;
      existingChart.data.datasets[0].data = joinValues;
      existingChart.data.datasets[1].data = leaveValues;
      existingChart.update('none');
      return;
    }
    
    // CREATE new chart
    const newChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Joins',
            data: joinValues,
            backgroundColor: '#10b981'
          },
          {
            label: 'Leaves',
            data: leaveValues,
            backgroundColor: '#ef4444'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 300 },
        plugins: {
          legend: { display: true },
          title: { display: true, text: 'Member Activity (Last 24h)' }
        },
        scales: {
          x: { title: { display: true, text: 'Time' } },
          y: { beginAtZero: true, title: { display: true, text: 'Members' } }
        }
      }
    });
  }
  
  /**
   * Load Moderation Actions Chart - UPDATE existing or CREATE new
   */
  async function loadModerationActionsChart(data) {
    const ctx = document.getElementById('moderationChart') || document.getElementById('autoModChart');
    if (!ctx || !window.Chart) return;
    
    const modData = data.modActions || { timeout: [], ban: [], kick: [], warn: [] };
    const values = [
      (modData.timeout || []).reduce((s, d) => s + (d.count || 0), 0),
      (modData.ban || []).reduce((s, d) => s + (d.count || 0), 0),
      (modData.kick || []).reduce((s, d) => s + (d.count || 0), 0),
      (modData.warn || []).reduce((s, d) => s + (d.count || 0), 0)
    ];
    const totalActions = values.reduce((a, b) => a + b, 0);
    
    toggleChartContainer('moderationChartContainer', totalActions > 0);
    if (totalActions === 0) return;
    
    // Check for existing chart instance
    let existingChart = getChartInstance('moderation');
    
    if (existingChart) {
      // UPDATE existing chart
      existingChart.data.datasets[0].data = values;
      existingChart.update('none');
      return;
    }
    
    // CREATE new chart
    const newChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Timeouts', 'Bans', 'Kicks', 'Warns'],
        datasets: [{
          data: values,
          backgroundColor: ['#f59e0b', '#ef4444', '#8b5cf6', '#3b82f6']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 300 },
        plugins: {
          legend: { display: true, position: 'bottom' },
          title: { display: true, text: 'Moderation Actions (Last 24h)' }
        }
      }
    });
    
    setChartInstance('moderation', newChart);
  }
  
  /**
   * Load Spam Detection Chart - UPDATE existing or CREATE new
   */
  async function loadSpamChart(data) {
    const ctx = document.getElementById('spamChart');
    if (!ctx || !window.Chart) return;
    
    const hasData = data.spam && data.spam.length > 0;
    toggleChartContainer('spamChartContainer', hasData);
    if (!hasData) return;
    
    const labels = data.spam.map(d => formatChartLabel(d.timestamp));
    const values = data.spam.map(d => d.count);
    
    // Check for existing chart instance
    let existingChart = getChartInstance('spam');
    
    if (existingChart) {
      // UPDATE existing chart
      existingChart.data.labels = labels;
      existingChart.data.datasets[0].data = values;
      existingChart.update('none');
      return;
    }
    
    // CREATE new chart
    const newChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Spam Events',
          data: values,
          borderColor: '#ef4444',
          backgroundColor: 'rgba(239, 68, 68, 0.1)',
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: '#ef4444'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 300 },
        plugins: {
          legend: { display: true },
          title: { display: true, text: 'Spam Detection (Last 24h)' }
        },
        scales: {
          x: { title: { display: true, text: 'Time' } },
          y: { beginAtZero: true, title: { display: true, text: 'Events' } }
        }
      }
    });
    
    setChartInstance('spam', newChart);
  }
  
  /**
   * Load System Stats Chart - UPDATE existing or CREATE new
   */
  async function loadSystemChart(data) {
    const ctx = document.getElementById('systemChart');
    if (!ctx || !window.Chart) return;
    
    const system = data.system || {};
    const hasData = system.cpuUsage !== undefined || system.memoryUsage !== undefined;
    toggleChartContainer('systemChartContainer', hasData);
    if (!hasData) return;
    
    const values = [system.cpuUsage || 0, system.memoryUsage || 0];
    
    // Check for existing chart instance
    let existingChart = getChartInstance('system');
    
    if (existingChart) {
      // UPDATE existing chart
      existingChart.data.datasets[0].data = values;
      existingChart.update('none');
      return;
    }
    
    // CREATE new chart
    const newChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: ['CPU Usage', 'Memory Usage'],
        datasets: [{
          label: 'System (%)',
          data: values,
          backgroundColor: ['#3b82f6', '#10b981']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        animation: { duration: 300 },
        plugins: {
          legend: { display: false },
          title: { display: true, text: 'System Resources' }
        },
        scales: {
          y: { beginAtZero: true, max: 100 }
        }
      }
    });
    
    setChartInstance('system', newChart);
  }
  
  /**
   * Update summary stats on the page
   */
  function updateSummaryStats(summary) {
    if (!summary) return;
    
    const updateStat = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value || 0;
    };
    
    updateStat('totalMessages', summary.totalMessages);
    updateStat('totalJoins', summary.totalJoins);
    updateStat('totalLeaves', summary.totalLeaves);
    updateStat('totalTimeouts', summary.totalTimeouts);
    updateStat('totalBans', summary.totalBans);
    updateStat('totalKicks', summary.totalKicks);
    updateStat('totalSpamEvents', summary.totalSpamEvents);
  }
  
  // Prevent double-refresh with a loading flag
  let chartsLoading = false;
  
  /**
   * Hide all chart containers and destroy instances
   */
  function hideAllCharts() {
    const containerIds = [
      'messageChartContainer', 'threatChartContainer',
      'joinLeaveChartContainer', 'joinChartContainer',
      'moderationChartContainer', 'autoModChartContainer',
      'spamChartContainer',
      'systemChartContainer'
    ];
    
    containerIds.forEach(id => {
      const container = document.getElementById(id);
      if (container) {
        container.style.display = 'none';
        container.classList.add('no-data');
        
        // Add "No data" message if not already present
        let noDataMsg = container.querySelector('.no-data-message');
        if (!noDataMsg) {
          noDataMsg = document.createElement('div');
          noDataMsg.className = 'no-data-message';
          noDataMsg.style.cssText = 'padding:40px;text-align:center;color:#64748b;font-size:14px;font-style:italic;';
          noDataMsg.textContent = 'No analytics data available for the last 24 hours';
          container.appendChild(noDataMsg);
        }
        noDataMsg.style.display = 'block';
      }
    });
    
    // Destroy all chart instances
    Object.keys(chartInstances).forEach(name => destroyChart(name));
  }
  
  /**
   * Main chart initialization - fetches live data and renders all charts
   */
  window.initializeCharts = async function() {
    // Prevent double-refresh
    if (chartsLoading) {
      console.log('[CHARTS] Already loading, skipping...');
      return;
    }
    
    chartsLoading = true;
    
    // Show loading indicator
    const loadingIndicator = document.getElementById('charts-loading');
    if (loadingIndicator) loadingIndicator.style.display = 'block';
    
    try {
      if (!window.Chart) {
        console.warn('[CHARTS] Chart.js not loaded yet');
        return;
      }

      const guildId = state.guildId;
      if (!guildId) {
        console.warn('[CHARTS] No guild selected');
        hideAllCharts();
        return;
      }

      console.log('[CHARTS] Fetching live analytics for guild:', guildId);
      
      // Fetch live analytics data
      let response;
      try {
        response = await apiFetch(`/api/analytics/live?guildId=${encodeURIComponent(guildId)}`);
      } catch (fetchErr) {
        console.error('[CHARTS] Failed to fetch analytics:', fetchErr.message);
        hideAllCharts();
        return;
      }
      
      // Check global hasData flag first
      if (!response || !response.hasData) {
        console.log('[CHARTS] No analytics data available - hiding all charts');
        hideAllCharts();
        return;
      }

      console.log('[CHARTS] Live data received, rendering charts');
      
      // Load each chart with the live data - they internally check array lengths
      await Promise.all([
        loadMessageChart(response),
        loadJoinLeaveChart(response),
        loadModerationActionsChart(response),
        loadSpamChart(response),
        loadSystemChart(response)
      ]);
      
      // Update summary statistics
      updateSummaryStats(response.summary);
      
    } catch (e) {
      console.error('[CHARTS] Failed to initialize charts:', e.message);
      hideAllCharts();
    } finally {
      chartsLoading = false;
      // Hide loading indicator
      if (loadingIndicator) loadingIndicator.style.display = 'none';
    }
  };
  
  /**
   * Start auto-refresh for charts (every 5 seconds)
   */
  window.startChartAutoRefresh = function() {
    if (chartRefreshInterval) {
      clearInterval(chartRefreshInterval);
    }
    chartRefreshInterval = setInterval(() => {
      window.initializeCharts();
    }, 5000);
    console.log('[CHARTS] Auto-refresh started (5s interval)');
  };
  
  /**
   * Stop chart auto-refresh
   */
  window.stopChartAutoRefresh = function() {
    if (chartRefreshInterval) {
      clearInterval(chartRefreshInterval);
      chartRefreshInterval = null;
      console.log('[CHARTS] Auto-refresh stopped');
    }
  };
  
  /**
   * WebSocket listener for analytics_update events
   * Only refreshes if the update is for the current guild
   */
  window.handleAnalyticsUpdate = function(data) {
    if (data.type !== 'analytics_update') return;
    
    // Only process updates for the current guild
    if (data.guildId && data.guildId !== state.guildId) {
      console.log('[CHARTS] Ignoring update for different guild:', data.guildId);
      return;
    }
    
    console.log('[CHARTS] Received analytics_update via WebSocket for current guild');
    
    // Refresh charts immediately when we receive an update
    window.initializeCharts();
  };
  
  // Analytics WebSocket connection with reconnect logic
  let analyticsSocket = null;
  let analyticsReconnectTimeout = null;
  
  function connectAnalyticsSocket() {
    // Don't create duplicate connections
    if (analyticsSocket && analyticsSocket.readyState === WebSocket.OPEN) return;
    if (analyticsSocket && analyticsSocket.readyState === WebSocket.CONNECTING) return;
    
    try {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;
      
      analyticsSocket = new WebSocket(wsUrl);
      
      analyticsSocket.addEventListener('open', () => {
        console.log('[CHARTS] WebSocket connected');
        // Subscribe to current guild updates
        if (state.guildId) {
          analyticsSocket.send(JSON.stringify({
            type: 'subscribe',
            guildId: state.guildId
          }));
        }
      });
      
      analyticsSocket.addEventListener('message', (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'analytics_update') {
            window.handleAnalyticsUpdate(data);
          }
        } catch (e) {}
      });
      
      analyticsSocket.addEventListener('close', () => {
        console.log('[CHARTS] WebSocket closed, reconnecting in 5s...');
        if (analyticsReconnectTimeout) clearTimeout(analyticsReconnectTimeout);
        analyticsReconnectTimeout = setTimeout(connectAnalyticsSocket, 5000);
      });
      
      analyticsSocket.addEventListener('error', (err) => {
        console.error('[CHARTS] WebSocket error:', err);
        analyticsSocket.close();
      });
    } catch (e) {
      console.warn('[CHARTS] WebSocket init failed:', e.message);
    }
  }
  
  // Also register with existing dashboard WS if available
  if (window.dashboardWs) {
    const originalOnMessage = window.dashboardWs.onmessage;
    window.dashboardWs.onmessage = function(event) {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'analytics_update') {
          window.handleAnalyticsUpdate(data);
        }
      } catch (e) {}
      // Call original handler if exists
      if (originalOnMessage) originalOnMessage.call(this, event);
    };
  }
  
  // Export socket connect function
  window.connectAnalyticsSocket = connectAnalyticsSocket;
  
  // Expose chart functions globally
  window.loadMessageChart = loadMessageChart;
  window.loadJoinLeaveChart = loadJoinLeaveChart;
  window.loadModerationActionsChart = loadModerationActionsChart;
  window.loadSpamChart = loadSpamChart;
  window.loadSystemChart = loadSystemChart;
  
  // Force load shared access for testing
  window.forceLoadSharedAccess = function() {
    console.log('[FORCE] Manually triggering loadSharedAccessView...');
    if (typeof loadSharedAccessView === 'function') {
      loadSharedAccessView();
    } else {
      console.error('[FORCE] loadSharedAccessView is not a function!');
    }
  };

  // Wait for DOM and initialize
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();


