const url = document.getElementById('url');
const save = document.getElementById('save');
const copy = document.getElementById('copy');
const refreshBtn = document.getElementById('refresh');
const openYoutube = document.getElementById('openYoutube');
const status = document.getElementById('status');
const badge = document.getElementById('badge');
const badgeText = document.getElementById('badgeText');
const tabTitle = document.getElementById('tabTitle');
const tabUrl = document.getElementById('tabUrl');

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function refresh() {
  const cfg = await chrome.storage.local.get(['bridgeUrl', 'connected', 'lastError', 'updatedAt']);
  const tab = await activeTab();
  url.value = cfg.bridgeUrl || 'ws://localhost:8950/browser-bridge';
  badge.classList.toggle('ok', !!cfg.connected);
  badgeText.textContent = cfg.connected ? 'Connected' : 'Offline';
  tabTitle.textContent = tab?.title || 'Unknown tab';
  tabUrl.textContent = tab?.url || 'No URL';
  const age = cfg.updatedAt ? `${Math.max(0, Math.round((Date.now() - cfg.updatedAt) / 1000))}s ago` : 'never';
  status.textContent = cfg.connected
    ? `Ready. Last bridge update ${age}.`
    : (cfg.lastError || 'Not connected. Check the bridge URL and click reconnect.');
}

save.addEventListener('click', async () => {
  await chrome.storage.local.set({ bridgeUrl: url.value.trim() });
  chrome.runtime.sendMessage({ type: 'reconnect' });
  status.textContent = 'Reconnecting...';
  setTimeout(refresh, 350);
});

copy.addEventListener('click', async () => {
  await navigator.clipboard.writeText(url.value.trim());
  status.textContent = 'Bridge URL copied.';
});

refreshBtn.addEventListener('click', refresh);

openYoutube.addEventListener('click', async () => {
  const tab = await activeTab();
  if (tab?.id) await chrome.tabs.update(tab.id, { url: 'https://www.youtube.com/' });
  setTimeout(refresh, 500);
});

refresh();
setInterval(refresh, 1000);
