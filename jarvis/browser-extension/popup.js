// Nova Browser Bridge — Popup Controller
// Manages main view, settings, quick actions, and persistent preferences.

const SETTINGS_KEY = "nova_bridge_settings";

const DEFAULT_SETTINGS = {
  backendUrl: "ws://localhost:8950",
  autoReconnect: true,
  pageRead: true,
  interact: true,
  tabs: true,
  screenshots: true,
  executeJs: true,
  notify: true,
};

let currentPanel = "main";

// ── Init ──────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  await loadSettings();
  await updateStatus();
  bindNavigation();
  bindQuickActions();
  bindSettings();
});

// ── Navigation ────────────────────────────────────

function bindNavigation() {
  const btnMain = document.getElementById("btnMain");
  const btnSettings = document.getElementById("btnSettings");

  btnMain.addEventListener("click", () => showPanel("main"));
  btnSettings.addEventListener("click", () => showPanel("settings"));
}

function showPanel(name) {
  currentPanel = name;
  document.getElementById("panelMain").classList.toggle("visible", name === "main");
  document.getElementById("panelSettings").classList.toggle("visible", name === "settings");
  document.getElementById("btnMain").classList.toggle("active", name === "main");
  document.getElementById("btnSettings").classList.toggle("active", name === "settings");
}

// ── Status ────────────────────────────────────────

async function updateStatus() {
  try {
    // Active tab info
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      document.getElementById("tabTitle").textContent = tab.title || "Untitled";
      document.getElementById("tabUrl").textContent = tab.url || "";
    }

    // Connection status from badge
    const badge = await chrome.action.getBadgeText({});
    const dot = document.getElementById("dot");
    const statusText = document.getElementById("statusText");
    const statusSub = document.getElementById("statusSub");

    if (badge === "ON") {
      dot.classList.add("connected");
      statusText.textContent = "Connected to Jarvis";
      statusSub.textContent = "Bridge active — ready for commands";
    } else {
      dot.classList.remove("connected");
      statusText.textContent = "Disconnected";
      statusSub.textContent = "Click Reconnect to retry";
    }
  } catch (e) {
    document.getElementById("statusText").textContent = "Error";
    document.getElementById("statusSub").textContent = e.message;
  }
}

// ── Reconnect ─────────────────────────────────────

document.getElementById("reconnect").addEventListener("click", () => {
  const btn = document.getElementById("reconnect");
  btn.textContent = "Connecting...";
  btn.disabled = true;
  chrome.runtime.sendMessage({ action: "reconnect" });
  setTimeout(async () => {
    await updateStatus();
    btn.textContent = "Reconnect";
    btn.disabled = false;
    showToast("Reconnect signal sent");
  }, 1500);
});

// ── Quick Actions ─────────────────────────────────

function bindQuickActions() {
  document.getElementById("actReadPage").addEventListener("click", async () => {
    await runQuickAction("get_page_text", {}, (r) => {
      const words = r.text ? r.text.split(/\s+/).length : 0;
      showToast(`Page read — ${words} words captured`);
    });
  });

  document.getElementById("actScreenshot").addEventListener("click", async () => {
    await runQuickAction("screenshot", {}, () => {
      showToast("Screenshot captured");
    });
  });

  document.getElementById("actGetLinks").addEventListener("click", async () => {
    await runQuickAction("get_links", {}, (r) => {
      const count = r.links ? r.links.length : 0;
      showToast(`Found ${count} links on page`);
    });
  });

  document.getElementById("actGetInputs").addEventListener("click", async () => {
    await runQuickAction("get_input_values", {}, (r) => {
      const count = r.inputs ? r.inputs.length : 0;
      showToast(`Found ${count} form inputs`);
    });
  });
}

async function runQuickAction(action, args, onSuccess) {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      showToast("No active tab");
      return;
    }

    let response;
    try {
      response = await chrome.tabs.sendMessage(tab.id, { action, args });
    } catch {
      // Inject content script first
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      response = await chrome.tabs.sendMessage(tab.id, { action, args });
    }

    if (response && response.success) {
      onSuccess(response);
    } else {
      showToast(response?.error || "Action failed");
    }
  } catch (err) {
    showToast("Cannot access this page");
  }
}

// ── Settings ──────────────────────────────────────

async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(SETTINGS_KEY);
    const settings = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
    applySettingsToUI(settings);
  } catch {
    applySettingsToUI(DEFAULT_SETTINGS);
  }
}

function applySettingsToUI(s) {
  document.getElementById("settingBackendUrl").value = s.backendUrl;
  document.getElementById("settingAutoReconnect").checked = s.autoReconnect;
  document.getElementById("settingPageRead").checked = s.pageRead;
  document.getElementById("settingInteract").checked = s.interact;
  document.getElementById("settingTabs").checked = s.tabs;
  document.getElementById("settingScreenshots").checked = s.screenshots;
  document.getElementById("settingExecuteJs").checked = s.executeJs;
  document.getElementById("settingNotify").checked = s.notify;
}

function gatherSettingsFromUI() {
  return {
    backendUrl: document.getElementById("settingBackendUrl").value.trim(),
    autoReconnect: document.getElementById("settingAutoReconnect").checked,
    pageRead: document.getElementById("settingPageRead").checked,
    interact: document.getElementById("settingInteract").checked,
    tabs: document.getElementById("settingTabs").checked,
    screenshots: document.getElementById("settingScreenshots").checked,
    executeJs: document.getElementById("settingExecuteJs").checked,
    notify: document.getElementById("settingNotify").checked,
  };
}

async function saveSettings() {
  const settings = gatherSettingsFromUI();
  try {
    await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
    // Notify background of settings change
    chrome.runtime.sendMessage({ action: "settings_updated", settings });
    showToast("Settings saved");
  } catch (err) {
    showToast("Failed to save settings");
  }
}

function bindSettings() {
  // Save on any toggle change
  const toggles = document.querySelectorAll('.toggle input[type="checkbox"]');
  toggles.forEach((toggle) => {
    toggle.addEventListener("change", () => saveSettings());
  });

  // Save backend URL on blur
  const urlInput = document.getElementById("settingBackendUrl");
  urlInput.addEventListener("change", () => saveSettings());
  urlInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      urlInput.blur();
      saveSettings();
    }
  });
}

// ── Toast ─────────────────────────────────────────

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2200);
}

// ── Show main panel by default ────────────────────
showPanel("main");
