/* ──────────────────────────────────────────────────────────
 *  PWA Platform Adapter
 *  Provides window.electronAPI-compatible shims using
 *  standard Web APIs so the same React app can run as a
 *  Progressive Web App in Safari / mobile browsers.
 * ────────────────────────────────────────────────────────── */

import './mobile.css';
import { useAuthStore } from '../../dl-secure-channel/src/stores/authStore';
import { useChatStore } from '../../dl-secure-channel/src/stores/chatStore';
import { useFriendStore } from '../../dl-secure-channel/src/stores/friendStore';

const VAULT_PREFIX = 'darklock_vault_';
const BASE_URL = import.meta.env.BASE_URL || '/app/secure-channel/';
const SW_VERSION = '20260519b';

const electronAPI: Record<string, any> = {
  /* ── App ── */
  getDataPath: async () => 'pwa://data',
  getVersion: async () => '1.2.2',
  platform: 'web',

  /* ── Vault (localStorage-backed file storage) ── */
  vaultWrite: async (filename: string, data: string) => {
    localStorage.setItem(VAULT_PREFIX + filename, data);
  },

  vaultRead: async (filename: string): Promise<string | null> => {
    return localStorage.getItem(VAULT_PREFIX + filename);
  },

  vaultExists: async (filename: string): Promise<boolean> => {
    return localStorage.getItem(VAULT_PREFIX + filename) !== null;
  },

  vaultDelete: async (filename: string) => {
    localStorage.removeItem(VAULT_PREFIX + filename);
  },

  /* ── Security ── */
  setContentProtection: async (_enabled: boolean) => {
    // No native screenshot protection in browsers
  },

  setSkipTaskbar: async (_skip: boolean) => {
    // N/A in browser
  },

  setIncognitoKeyboard: async (_enabled: boolean) => {
    // Can't control keyboard behavior in browsers
  },

  clipboardClear: async (seconds: number) => {
    setTimeout(async () => {
      try {
        await navigator.clipboard.writeText('');
      } catch { /* clipboard API may be denied */ }
    }, seconds * 1000);
  },

  clipboardClearNow: async () => {
    try {
      await navigator.clipboard.writeText('');
    } catch { /* ignore */ }
  },

  /* ── Notifications ── */
  showNotification: (title: string, body: string) => {
    if ('Notification' in window && Notification.permission === 'granted') {
      const n = new Notification(title, { body, icon: `${BASE_URL}icons/icon-192.png` });
      setTimeout(() => n.close(), 5000);
    }
  },

  /* ── Updates — poll version API; installUpdate reloads for new SW ── */
  checkForUpdates: async () => {
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);
      const resp = await fetch('https://admin.darklock.net/platform/api/secure-channel/version', { signal: controller.signal });
      window.clearTimeout(timeout);
      if (!resp.ok) return null;
      const json = await resp.json();
      const current = '1.2.2';
      const pa = json.version.split('.').map(Number);
      const pb = current.split('.').map(Number);
      for (let i = 0; i < 3; i++) {
        if ((pa[i] || 0) > (pb[i] || 0)) return json;
        if ((pa[i] || 0) < (pb[i] || 0)) return null;
      }
      return null;
    } catch { return null; }
  },
  installUpdate: async () => {
    // Reload to pick up new SW cache
    window.location.reload();
  },
  onUpdateAvailable: (callback: (info: any) => void) => {
    // Listen for new service worker activation
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then(reg => {
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'activated' && navigator.serviceWorker.controller) {
              callback({ version: 'new', releaseDate: new Date().toISOString(), downloadUrl: '', changelog: ['App updated — reload to apply.'] });
            }
          });
        });
      });
    }
    return () => {};
  },

  /* ── OAuth (not available in PWA — checked with ?. in app) ── */
  // googleSignIn and discordSignIn intentionally omitted

  /* ── Lock / Focus signals ── */
  onLockSignal: (callback: () => void) => {
    const handler = () => {
      if (document.visibilityState === 'hidden') callback();
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  },

  onWindowBlur: (callback: () => void) => {
    window.addEventListener('blur', callback);
    return () => window.removeEventListener('blur', callback);
  },

  onWindowFocus: (callback: () => void) => {
    window.addEventListener('focus', callback);
    return () => window.removeEventListener('focus', callback);
  },

  onContentProtectionChanged: (_callback: (enabled: boolean) => void) => {
    return () => {};
  },
};

(window as any).electronAPI = electronAPI;

// Register service worker for offline support
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register(`${BASE_URL}sw.js?v=${SW_VERSION}`)
      .then((reg) => {
        // Force an update check on launch so stale mobile caches are replaced quickly.
        reg.update().catch(() => {});
      })
      .catch(() => {});
  });
}

// ── iOS keyboard viewport fix ─────────────────────────
// Safari shrinks the visual viewport when the keyboard opens.
// Keep the chat input visible by scrolling the focused input into view.
if (/iphone|ipad/i.test(navigator.userAgent)) {
  document.addEventListener('focusin', (e) => {
    const el = e.target as HTMLElement;
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      setTimeout(() => {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  });
}

// ── Prevent double-tap zoom on iOS ────────────────────
let lastTouchEnd = 0;
document.addEventListener('touchend', (e) => {
  const now = Date.now();
  if (now - lastTouchEnd <= 300) e.preventDefault();
  lastTouchEnd = now;
}, { passive: false });

// ── Theme color for mobile status bar ─────────────────
const meta = document.querySelector('meta[name="theme-color"]');
if (meta) {
  const observer = new MutationObserver(() => {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--dl-bg-secondary').trim();
    if (bg) meta.setAttribute('content', bg);
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
}

// ── Request notification permission (Discord-style) ───
if ('Notification' in window && Notification.permission === 'default') {
  // Delay to avoid blocking first paint
  setTimeout(() => Notification.requestPermission(), 3000);
}

// ── Haptic feedback helper ────────────────────────────
function vibrate(pattern: number | number[] = 10) {
  try { navigator.vibrate?.(pattern); } catch { /* ignore */ }
}

// Add haptic feedback to interactive elements
document.addEventListener('pointerdown', (e) => {
  const target = e.target as HTMLElement;
  if (
    target.closest?.('.sidebar-item') ||
    target.closest?.('.dl-nav-tab') ||
    target.closest?.('.chat-input__send') ||
    target.closest?.('.sidebar-new-btn')
  ) {
    vibrate(8);
  }
}, { passive: true });

// ── Notifications Panel ───────────────────────────────────
function hideNotifPanel() {
  const p = document.getElementById('dl-notif-panel');
  if (p) { p.classList.remove('dl-notif-panel--open'); setTimeout(() => p.remove(), 220); }
}

function buildRequestItem(req: { id: number; displayName: string }, list: HTMLElement, userId: string) {
  const item = document.createElement('div');
  item.className = 'dl-notif-item';
  const initial = (req.displayName?.[0] ?? '?').toUpperCase();
  item.innerHTML = `
    <div class="dl-notif-item__avatar">${initial}</div>
    <div class="dl-notif-item__body">
      <div class="dl-notif-item__name">${req.displayName}</div>
      <div class="dl-notif-item__sub">Sent you a friend request</div>
    </div>
    <div class="dl-notif-item__btns">
      <button class="dl-notif-accept" data-id="${req.id}">Accept</button>
      <button class="dl-notif-decline" data-id="${req.id}">Decline</button>
    </div>
  `;
  item.querySelector('.dl-notif-accept')?.addEventListener('click', async () => {
    await useFriendStore.getState().acceptRequest(req.id, userId);
    item.remove();
    if (list.children.length === 0) list.innerHTML = '<div class="dl-notif-empty">No new notifications</div>';
  });
  item.querySelector('.dl-notif-decline')?.addEventListener('click', async () => {
    await useFriendStore.getState().rejectRequest(req.id, userId);
    item.remove();
    if (list.children.length === 0) list.innerHTML = '<div class="dl-notif-empty">No new notifications</div>';
  });
  return item;
}

function showNotifPanel() {
  document.getElementById('dl-notif-panel')?.remove();
  const userId = useAuthStore.getState().userId ?? '';

  const panel = document.createElement('div');
  panel.id = 'dl-notif-panel';
  panel.innerHTML = `
    <div class="dl-notif-topbar">
      <button class="dl-notif-close" aria-label="Close">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="dl-notif-title">Notifications</span>
    </div>
    <div class="dl-notif-section-label">Friend Requests</div>
    <div class="dl-notif-list"><div class="dl-notif-empty">Loading…</div></div>
  `;

  panel.querySelector('.dl-notif-close')?.addEventListener('click', () => hideNotifPanel());
  document.body.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('dl-notif-panel--open'));

  const list = panel.querySelector('.dl-notif-list') as HTMLElement;

  if (userId) {
    useFriendStore.getState().fetchIncoming(userId).then(() => {
      const incoming = useFriendStore.getState().incoming;
      list.innerHTML = '';
      if (incoming.length === 0) {
        list.innerHTML = '<div class="dl-notif-empty">No new notifications</div>';
      } else {
        incoming.forEach(req => list.appendChild(buildRequestItem(req, list, userId)));
      }
    });
  } else {
    list.innerHTML = '<div class="dl-notif-empty">No new notifications</div>';
  }
}

// ── Discord-style Bottom Navigation (5 tabs per spec) ──
// DMs / Friends / Groups / Notifications / You
(function initMobileNav() {
  if (window.innerWidth > 768) return;

  const nav = document.createElement('nav');
  nav.id = 'dl-mobile-nav';
  nav.innerHTML = `
    <button class="dl-nav-tab dl-nav-tab--active" data-tab="dms" aria-label="Direct Messages">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
      <span>DMs</span>
    </button>
    <button class="dl-nav-tab" data-tab="friends" aria-label="Friends">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
      <span>Friends</span>
    </button>
    <button class="dl-nav-tab" data-tab="groups" aria-label="Groups">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>
      <span>Groups</span>
    </button>
    <button class="dl-nav-tab" data-tab="notifications" aria-label="Notifications">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
      <span>Alerts</span>
    </button>
    <button class="dl-nav-tab" data-tab="you" aria-label="Profile">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M20 21a8 8 0 0 0-16 0"/></svg>
      <span>You</span>
    </button>
  `;
  document.body.appendChild(nav);

  let activeTab = 'dms';

  // Navigate: exit to main screen if needed, then perform tab action
  function navigateTo(tab: string) {
    const inSettings = !!document.querySelector('.settings');
    const inMe = !!document.querySelector('.me-profile');
    if ((inSettings || inMe) && tab !== 'you') {
      useAuthStore.getState().setScreen('main');
      setTimeout(() => doTabAction(tab), 100);
      return;
    }
    doTabAction(tab);
  }

  function doTabAction(tab: string) {
    hideNotifPanel();
    const chat = useChatStore.getState();

    if (tab === 'dms') {
      // DM mode sidebar, no conversation
      if (chat.sidebarMode !== 'dm') chat.setSidebarMode('dm');
      chat.setActiveConversation(null);
      // Click "Direct" sidebar tab (index 1)
      setTimeout(() => (document.querySelectorAll('.sidebar-tab')[1] as HTMLElement)?.click(), 0);
    } else if (tab === 'friends') {
      if (chat.sidebarMode !== 'dm') chat.setSidebarMode('dm');
      chat.setActiveConversation(null);
      setTimeout(() => (document.querySelectorAll('.sidebar-tab')[0] as HTMLElement)?.click(), 0);
    } else if (tab === 'groups') {
      // Show group picker — flip to group sidebar if a group is already active,
      // otherwise tap the first guild icon.
      chat.setActiveConversation(null);
      const firstGuild = document.querySelector('.guild-sidebar__item') as HTMLElement | null;
      if (firstGuild) firstGuild.click();
    } else if (tab === 'notifications') {
      showNotifPanel();
    } else if (tab === 'you') {
      useAuthStore.getState().setScreen('me');
    }
  }

  nav.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('[data-tab]') as HTMLElement | null;
    if (!btn) return;
    const tab = btn.dataset.tab;
    if (!tab) return;

    vibrate(8);
    activeTab = tab;
    nav.querySelectorAll('.dl-nav-tab').forEach(b => b.classList.remove('dl-nav-tab--active'));
    btn.classList.add('dl-nav-tab--active');
    navigateTo(tab);
  });

  // Sync active-tab state to actual screen
  function syncActiveTab() {
    const onMe = !!document.querySelector('.me-profile');
    const onSettings = !!document.querySelector('.settings');
    const onNotif = !!document.getElementById('dl-notif-panel');
    const chatState = useChatStore.getState();
    const isGroup = chatState.sidebarMode === 'group';

    let expected = activeTab;
    if (onMe || onSettings) expected = 'you';
    else if (onNotif) expected = 'notifications';
    else if (isGroup) expected = 'groups';
    else if (activeTab === 'you' || activeTab === 'notifications') {
      // Left the You/Notif screen without tapping a tab — fall back to DMs
      expected = 'dms';
    }

    if (expected !== activeTab) {
      activeTab = expected;
      nav.querySelectorAll('.dl-nav-tab').forEach(b => b.classList.remove('dl-nav-tab--active'));
      nav.querySelector(`[data-tab="${expected}"]`)?.classList.add('dl-nav-tab--active');
    }
    requestAnimationFrame(syncActiveTab);
  }
  requestAnimationFrame(syncActiveTab);

  // Sync notification badge from Friends sidebar tab
  const syncBadge = () => {
    const friendsTab = document.querySelectorAll('.sidebar-tab')[0];
    const hasBadge = friendsTab?.querySelector('.sidebar-tab__badge');
    const notifBtn = nav.querySelector('[data-tab="notifications"]');
    const existing = notifBtn?.querySelector('.dl-nav-badge');
    if (hasBadge && !existing) {
      const dot = document.createElement('span');
      dot.className = 'dl-nav-badge';
      notifBtn?.appendChild(dot);
    } else if (!hasBadge && existing) {
      existing.remove();
    }
  };
  setInterval(syncBadge, 2000);
})();

// ── Shared Back Handler ───────────────────────────────────
// Called by swipe-back gesture AND Android hardware back button.
// Resolves in priority order:
//   1. open modal / sheet
//   2. open context menu
//   3. notifications panel
//   4. settings detail → settings list
//   5. me-profile → main
//   6. settings → main
//   7. open chat → sidebar (clear active conversation)
//   8. group mode → DM mode
// Returns true if handled, false if should fall through to OS default.
function goBack(): boolean {
  // 1. Any open modal / bottom sheet
  const modal = document.querySelector(
    '.dl-modal-overlay, .modal-overlay, .conv-personalize, .conv-security, ' +
    '.new-message-modal, .profile-popup, .group-management, .gs-overlay, .camera-capture'
  ) as HTMLElement | null;
  if (modal) {
    // Try to find a close button; otherwise remove the element
    const closer = modal.querySelector(
      '.dl-modal__close, .modal-close, [data-action="close"], [aria-label="Close"]'
    ) as HTMLElement | null;
    if (closer) closer.click();
    else {
      // Synthesize an Escape keypress — most modals listen for it
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }
    return true;
  }

  // 2. Context menus (chat, sidebar, etc.)
  const ctx = document.querySelector('.chat-context, .sidebar-ctx, .chat-input__attach-menu') as HTMLElement | null;
  if (ctx) {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    // Also synthesize a click outside in case the menu uses click-away
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    return true;
  }

  // 3. Notifications panel
  if (document.getElementById('dl-notif-panel')) {
    hideNotifPanel();
    return true;
  }

  // 4. Settings detail view open → back to settings list
  const settingsOpen = document.querySelector('.settings--mobile-open');
  if (settingsOpen) {
    const backBtn = settingsOpen.querySelector(
      '.settings-content__mobile-header button, .settings-content__mobile-back'
    ) as HTMLElement | null;
    if (backBtn) { backBtn.click(); return true; }
  }

  // 5. Me-profile → main
  if (document.querySelector('.me-profile')) {
    useAuthStore.getState().setScreen('main');
    return true;
  }

  // 6. Settings root → main
  if (document.querySelector('.settings')) {
    useAuthStore.getState().setScreen('main');
    return true;
  }

  // 7. Chat open on mobile → back to sidebar
  if (document.querySelector('.mobile-chat-open')) {
    useChatStore.getState().setActiveConversation(null);
    return true;
  }

  // 8. Group mode sidebar → back to DM mode
  if (useChatStore.getState().sidebarMode === 'group') {
    useChatStore.getState().setSidebarMode('dm');
    return true;
  }

  return false;
}

// Expose for mobileAdapter (Android hardware back button)
(window as any).__darklockGoBack = goBack;

// ── Pull-to-Refresh ───────────────────────────────────────
// Discord-style PTR on list scroll containers. Fires a custom
// 'darklock:refresh' event with { source } so stores can reload.
(function initPullToRefresh() {
  if (window.innerWidth > 768) return;

  // Selectors that support PTR. Data attribute identifies the source.
  const TARGETS: Array<{ selector: string; source: string }> = [
    { selector: '.sidebar-list',   source: 'dms' },
    { selector: '.friends-home',   source: 'friends' },
    { selector: '.dl-notif-list',  source: 'notifications' },
    { selector: '.chat-messages',  source: 'chat' },
  ];

  // Inject PTR indicator element (shared across targets)
  const indicator = document.createElement('div');
  indicator.id = 'dl-ptr';
  indicator.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.2-8.55"/><polyline points="21 3 21 9 15 9"/></svg>`;
  document.body.appendChild(indicator);

  const THRESHOLD = 70;   // px pull before release triggers refresh
  const MAX_PULL = 110;   // clamp visual pull

  let activeTarget: HTMLElement | null = null;
  let activeSource = '';
  let startY = 0;
  let currentPull = 0;
  let armed = false;

  function findTarget(touchTarget: EventTarget | null): { el: HTMLElement; source: string } | null {
    if (!(touchTarget instanceof Element)) return null;
    for (const { selector, source } of TARGETS) {
      const el = touchTarget.closest(selector) as HTMLElement | null;
      if (el) return { el, source };
    }
    return null;
  }

  document.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const found = findTarget(e.target);
    if (!found) return;
    // Only arm if the scroll container is already at the top
    if (found.el.scrollTop > 2) return;
    activeTarget = found.el;
    activeSource = found.source;
    startY = e.touches[0].clientY;
    currentPull = 0;
    armed = true;
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    if (!armed || !activeTarget) return;
    const dy = e.touches[0].clientY - startY;
    if (dy <= 0) {
      // User scrolled up — cancel PTR
      armed = false;
      indicator.style.transform = '';
      indicator.classList.remove('dl-ptr--visible', 'dl-ptr--armed');
      return;
    }
    // Rubber-band dampening
    currentPull = Math.min(MAX_PULL, dy * 0.5);
    indicator.style.transform = `translate(-50%, ${currentPull}px)`;
    indicator.classList.add('dl-ptr--visible');
    indicator.classList.toggle('dl-ptr--armed', currentPull >= THRESHOLD);
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!armed) return;
    armed = false;
    const shouldTrigger = currentPull >= THRESHOLD;
    if (shouldTrigger) {
      indicator.classList.add('dl-ptr--loading');
      vibrate(12);
      window.dispatchEvent(new CustomEvent('darklock:refresh', { detail: { source: activeSource } }));
      // Clear after a short delay — stores listen and do their own work
      setTimeout(() => {
        indicator.classList.remove('dl-ptr--visible', 'dl-ptr--armed', 'dl-ptr--loading');
        indicator.style.transform = '';
      }, 600);
    } else {
      indicator.classList.remove('dl-ptr--visible', 'dl-ptr--armed');
      indicator.style.transform = '';
    }
    activeTarget = null;
  }, { passive: true });
})();

// Global refresh handler — wires standard Darklock stores to the PTR event.
window.addEventListener('darklock:refresh', (e: Event) => {
  const { source } = (e as CustomEvent).detail ?? {};
  const userId = useAuthStore.getState().userId;
  try {
    if (source === 'friends' || source === 'dms' || source === 'notifications') {
      if (userId) {
        useFriendStore.getState().fetchIncoming(userId).catch(() => {});
        useFriendStore.getState().fetchFriends?.(userId).catch(() => {});
      }
    }
    // Chat refresh — nothing to do; messages stream over WS
  } catch { /* swallow — PTR should never crash */ }
});

// ── Swipe Gestures ────────────────────────────────────────
// Back-edge swipe (left-edge → right) and tab-switch swipe
(function initSwipeGestures() {
  if (window.innerWidth > 768) return;

  let startX = 0;
  let startY = 0;
  let startTime = 0;

  document.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    startX = t.clientX;
    startY = t.clientY;
    startTime = Date.now();
  }, { passive: true });

  document.addEventListener('touchend', (e) => {
    const t = e.changedTouches[0];
    const dx = t.clientX - startX;
    const dy = t.clientY - startY;
    const dt = Date.now() - startTime;

    // Must be fast enough, long enough, and more horizontal than vertical
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) || dt > 500) return;

    const swipedRight = dx > 0;
    const swipedLeft  = dx < 0;
    const fromEdge    = swipedRight && startX < 40;

    // == Back gesture: swipe right from left edge ==
    if (fromEdge) {
      if (goBack()) { vibrate(10); return; }
      return;
    }

    // == Tab swipe: only on main screen, not inside an open chat ==
    if (document.querySelector('.mobile-chat-open')) return;
    if (document.querySelector('.settings, .me-profile')) return;
    if (document.getElementById('dl-notif-panel')) return;

    const nav = document.getElementById('dl-mobile-nav');
    if (!nav) return;

    const activeBtn = nav.querySelector('.dl-nav-tab--active') as HTMLElement | null;
    const tabs = Array.from(nav.querySelectorAll<HTMLElement>('[data-tab]'));
    const tabNames = tabs.map(t => t.dataset.tab!);
    const currentTab = activeBtn?.dataset.tab ?? tabNames[0];
    const currentIdx = tabNames.indexOf(currentTab);

    let nextIdx = -1;
    if (swipedLeft  && currentIdx < tabNames.length - 1) nextIdx = currentIdx + 1;
    if (swipedRight && currentIdx > 0)                   nextIdx = currentIdx - 1;
    if (nextIdx === -1) return;

    const nextBtn = nav.querySelector(`[data-tab="${tabNames[nextIdx]}"]`) as HTMLElement | null;
    nextBtn?.click();
  }, { passive: true });
})();
