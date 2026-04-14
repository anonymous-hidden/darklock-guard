/**
 * Nova Browser Bridge — Background Service Worker
 * =================================================
 * Maintains a persistent WebSocket connection to the Jarvis backend.
 * Routes commands to the active tab's content script and relays results back.
 */

const JARVIS_WS_URL = "ws://localhost:8950/browser-bridge";
const RECONNECT_DELAY = 3000;
const HEARTBEAT_INTERVAL = 15000;

let ws = null;
let heartbeatTimer = null;
let connected = false;

// ── WebSocket connection ─────────────────────────────

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  ws = new WebSocket(JARVIS_WS_URL);

  ws.onopen = () => {
    connected = true;
    console.log("[Nova Bridge] Connected to Jarvis backend");
    updateBadge("ON", "#4CAF50");

    // Start heartbeat
    heartbeatTimer = setInterval(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "heartbeat" }));
      }
    }, HEARTBEAT_INTERVAL);

    // Send initial tab info
    sendActiveTabInfo();
  };

  ws.onmessage = async (event) => {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch {
      return;
    }

    if (msg.type === "command") {
      const result = await handleCommand(msg);
      ws.send(JSON.stringify({
        type: "command_result",
        id: msg.id,
        result,
      }));
    }
  };

  ws.onclose = () => {
    connected = false;
    clearInterval(heartbeatTimer);
    updateBadge("OFF", "#F44336");
    console.log("[Nova Bridge] Disconnected. Reconnecting...");
    setTimeout(connect, RECONNECT_DELAY);
  };

  ws.onerror = (err) => {
    console.error("[Nova Bridge] WebSocket error:", err);
    ws.close();
  };
}

// ── Command handler ──────────────────────────────────

async function handleCommand(msg) {
  const { action, args } = msg;

  try {
    switch (action) {
      case "get_page_content":
        return await sendToContentScript("get_page_content", args);

      case "get_page_text":
        return await sendToContentScript("get_page_text", args);

      case "get_selected_text":
        return await sendToContentScript("get_selected_text", args);

      case "get_input_values":
        return await sendToContentScript("get_input_values", args);

      case "type_text":
        return await sendToContentScript("type_text", args);

      case "click_element":
        return await sendToContentScript("click_element", args);

      case "scroll_page":
        return await sendToContentScript("scroll_page", args);

      case "fill_form":
        return await sendToContentScript("fill_form", args);

      case "get_links":
        return await sendToContentScript("get_links", args);

      case "get_tabs":
        return await getTabsList();

      case "switch_tab":
        return await switchTab(args.tabId || args.index);

      case "new_tab":
        return await openNewTab(args.url);

      case "close_tab":
        return await closeTab(args.tabId);

      case "navigate":
        return await navigateTo(args.url);

      case "back":
        return await sendToContentScript("go_back", args);

      case "forward":
        return await sendToContentScript("go_forward", args);

      case "screenshot":
        return await takeScreenshot();

      case "execute_js":
        return await executeScript(args.code);

      case "get_active_tab":
        return await getActiveTabInfo();

      case "press_key":
        return await sendToContentScript("press_key", args);

      case "focus_element":
        return await sendToContentScript("focus_element", args);

      case "wait_for_element":
        return await sendToContentScript("wait_for_element", args);

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ── Content script communication ─────────────────────

async function sendToContentScript(action, args = {}) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { success: false, error: "No active tab" };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, { action, args });
    return response || { success: true };
  } catch (err) {
    // Content script might not be injected yet — inject it
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"],
      });
      const response = await chrome.tabs.sendMessage(tab.id, { action, args });
      return response || { success: true };
    } catch (injectErr) {
      return { success: false, error: `Cannot access this page: ${injectErr.message}` };
    }
  }
}

// ── Tab management ───────────────────────────────────

async function getTabsList() {
  const tabs = await chrome.tabs.query({});
  return {
    success: true,
    tabs: tabs.map((t) => ({
      id: t.id,
      title: t.title,
      url: t.url,
      active: t.active,
      index: t.index,
    })),
  };
}

async function switchTab(tabIdOrIndex) {
  if (typeof tabIdOrIndex === "number" && tabIdOrIndex < 100) {
    // Treat as index
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const tab = tabs[tabIdOrIndex];
    if (!tab) return { success: false, error: `No tab at index ${tabIdOrIndex}` };
    await chrome.tabs.update(tab.id, { active: true });
    return { success: true, tab: { id: tab.id, title: tab.title, url: tab.url } };
  }
  await chrome.tabs.update(tabIdOrIndex, { active: true });
  const tab = await chrome.tabs.get(tabIdOrIndex);
  return { success: true, tab: { id: tab.id, title: tab.title, url: tab.url } };
}

async function openNewTab(url) {
  const tab = await chrome.tabs.create({ url: url || "about:blank" });
  return { success: true, tab: { id: tab.id, title: tab.title, url: tab.url } };
}

async function closeTab(tabId) {
  if (tabId) {
    await chrome.tabs.remove(tabId);
  } else {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await chrome.tabs.remove(tab.id);
  }
  return { success: true };
}

async function navigateTo(url) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { success: false, error: "No active tab" };
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    url = "https://" + url;
  }
  await chrome.tabs.update(tab.id, { url });
  return { success: true, url };
}

async function takeScreenshot() {
  const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
  return { success: true, screenshot: dataUrl };
}

async function executeScript(code) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { success: false, error: "No active tab" };

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (c) => {
      try { return { success: true, result: eval(c) }; }
      catch (e) { return { success: false, error: e.message }; }
    },
    args: [code],
  });
  return results[0]?.result || { success: false, error: "Script execution failed" };
}

async function getActiveTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { success: false, error: "No active tab" };
  return {
    success: true,
    tab: {
      id: tab.id,
      title: tab.title,
      url: tab.url,
      index: tab.index,
    },
  };
}

// ── Active tab tracker ───────────────────────────────

function sendActiveTabInfo() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: "tab_update",
        tab: {
          id: tabs[0].id,
          title: tabs[0].title,
          url: tabs[0].url,
        },
      }));
    }
  });
}

// Track tab changes
chrome.tabs.onActivated.addListener(() => {
  if (connected) sendActiveTabInfo();
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete" && connected) sendActiveTabInfo();
});

// ── Badge helper ─────────────────────────────────────

function updateBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ── Message handler from popup ───────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === "reconnect") {
    // Close existing socket and reconnect
    if (ws) {
      try { ws.close(); } catch {}
    }
    ws = null;
    connected = false;
    connect();
    sendResponse({ ok: true });
  } else if (msg.action === "settings_updated") {
    // Settings updated from popup — store for reference
    chrome.storage.local.set({ nova_bridge_settings: msg.settings });
    sendResponse({ ok: true });
  }
  return false;
});

// ── Start ────────────────────────────────────────────
connect();
