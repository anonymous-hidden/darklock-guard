/**
 * Nova Browser Bridge v2.0 — Background Service Worker
 * =====================================================
 * Persistent WebSocket to Nova Terminal AI.
 * Normal pages: content script.  Google Docs: Chrome DevTools Protocol.
 */

// ═════════════════════════════════════════════════════════════════
//  CONFIG
// ═════════════════════════════════════════════════════════════════

const WS_URL = "ws://localhost:8950/browser-bridge";
const RECONNECT_MS = 3000;
const HEARTBEAT_MS = 15000;

let ws = null;
let heartbeat = null;
let connected = false;

// ═════════════════════════════════════════════════════════════════
//  WEBSOCKET
// ═════════════════════════════════════════════════════════════════

function connect() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  ws = new WebSocket(WS_URL);

  ws.onopen = () => {
    connected = true;
    console.log("[Nova v2] Connected to terminal");
    badge("ON", "#34d399");
    heartbeat = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "heartbeat" }));
    }, HEARTBEAT_MS);
    sendActiveTab();
    injectAllTabs();
  };

  ws.onmessage = async (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    if (msg.type !== "command") return;
    const result = await runCommand(msg.action, msg.args || {});
    ws.send(JSON.stringify({ type: "command_result", id: msg.id, result }));
  };

  ws.onclose = () => {
    connected = false;
    clearInterval(heartbeat);
    badge("OFF", "#f87171");
    setTimeout(connect, RECONNECT_MS);
  };

  ws.onerror = () => ws.close();
}

// ═════════════════════════════════════════════════════════════════
//  COMMAND ROUTER
// ═════════════════════════════════════════════════════════════════

async function runCommand(action, args) {
  try {
    const tab = await activeTab();

    switch (action) {
      // Read
      case "get_page_content":
        return isGDocs(tab) ? await gdocsRead(tab.id) : await toContent(action, args);
      case "get_page_text":
      case "get_selected_text":
      case "get_input_values":
      case "get_links":
        return await toContent(action, args);

      // Type / Click / Key
      case "type_text":
        return isGDocs(tab) ? await gdocsType(tab.id, args.text) : await toContent(action, args);
      case "click_element":
        if (isGDocs(tab) && args.selector?.includes("kix-appview-editor"))
          return await cdpClick(tab.id, 400, 400);
        return await toContent(action, args);
      case "press_key":
        return isGDocs(tab) ? await cdpKey(tab.id, args.key, args.modifiers) : await toContent(action, args);

      // Navigation
      case "navigate":       return await doNavigate(args.url);
      case "get_tabs":       return await listTabs();
      case "get_active_tab": return await activeTabInfo();
      case "switch_tab":     return await switchTab(args.tabId || args.index);
      case "new_tab":        return await newTab(args.url);
      case "close_tab":      return await closeTab(args.tabId);
      case "back":           return await toContent("go_back", args);
      case "forward":        return await toContent("go_forward", args);

      // Other
      case "scroll_page":
      case "fill_form":
      case "focus_element":
      case "wait_for_element":
        return await toContent(action, args);
      case "screenshot":     return await screenshot();
      case "execute_js":     return await execJS(args.code);

      default:
        return { success: false, error: `Unknown: ${action}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════
//  GOOGLE DOCS — CDP (Chrome DevTools Protocol)
//  Google Docs renders on <canvas>. No DOM text exists.
//  We use trusted browser events via the debugger API.
// ═════════════════════════════════════════════════════════════════

const _attached = new Set();

function isGDocs(tab) {
  return tab?.url?.includes("docs.google.com/document");
}

async function cdpAttach(tabId) {
  if (_attached.has(tabId)) return;
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    _attached.add(tabId);
  } catch (err) {
    if (err.message?.includes("Already attached")) _attached.add(tabId);
    else throw err;
  }
}

function cdp(tabId, method, params) {
  return chrome.debugger.sendCommand({ tabId }, method, params);
}

chrome.tabs.onRemoved.addListener((id) => {
  if (_attached.has(id)) { _attached.delete(id); chrome.debugger.detach({ tabId: id }).catch(() => {}); }
});
chrome.tabs.onUpdated.addListener((id, info) => {
  if (_attached.has(id) && info.url && !info.url.includes("docs.google.com/document")) {
    _attached.delete(id); chrome.debugger.detach({ tabId: id }).catch(() => {});
  }
});

async function gdocsRead(tabId) {
  try {
    await cdpAttach(tabId);

    // Click editor to focus
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: 400, y: 400, button: "left", clickCount: 1 });
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: 400, y: 400, button: "left", clickCount: 1 });
    await wait(400);

    // Ctrl+A (select all)
    await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
    await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 });
    await wait(400);

    // Ctrl+C (copy)
    await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyDown", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67, modifiers: 2 });
    await cdp(tabId, "Input.dispatchKeyEvent", { type: "keyUp", key: "c", code: "KeyC", windowsVirtualKeyCode: 67, nativeVirtualKeyCode: 67, modifiers: 2 });
    await wait(400);

    // Read clipboard via CDP Runtime.evaluate
    const clip = await cdp(tabId, "Runtime.evaluate", {
      expression: "navigator.clipboard.readText()",
      awaitPromise: true,
      returnByValue: true,
    });
    let text = clip?.result?.value || "";

    // Fallback: scripting API
    if (!text) {
      try {
        const r = await chrome.scripting.executeScript({
          target: { tabId },
          func: async () => { try { return await navigator.clipboard.readText(); } catch { return ""; } },
        });
        text = r[0]?.result || "";
      } catch {}
    }

    // Deselect
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: 400, y: 300, button: "left", clickCount: 1 });
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: 400, y: 300, button: "left", clickCount: 1 });

    // Get title & URL
    const tRes = await cdp(tabId, "Runtime.evaluate", { expression: "document.title", returnByValue: true });
    const uRes = await cdp(tabId, "Runtime.evaluate", { expression: "location.href", returnByValue: true });

    text = text.trim();
    return {
      success: true,
      title: tRes?.result?.value || "",
      url: uRes?.result?.value || "",
      text: text || "(Document appears empty — no text found)",
      word_count: text ? text.split(/\s+/).length : 0,
      method: "cdp-clipboard",
      is_google_docs: true,
    };
  } catch (err) {
    _attached.delete(tabId);
    return { success: false, error: `GDocs read: ${err.message}`, is_google_docs: true };
  }
}

async function gdocsType(tabId, text) {
  try {
    await cdpAttach(tabId);
    // Click to focus
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x: 400, y: 400, button: "left", clickCount: 1 });
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x: 400, y: 400, button: "left", clickCount: 1 });
    await wait(300);
    // Insert text (trusted)
    await cdp(tabId, "Input.insertText", { text });
    return { success: true, typed: text, chars: text.length, method: "cdp" };
  } catch (err) {
    _attached.delete(tabId);
    return { success: false, error: err.message };
  }
}

async function cdpClick(tabId, x, y) {
  try {
    await cdpAttach(tabId);
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await cdp(tabId, "Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
    return { success: true, clicked: `(${x}, ${y})`, method: "cdp" };
  } catch (err) {
    _attached.delete(tabId);
    return { success: false, error: err.message };
  }
}

async function cdpKey(tabId, key, modifiers) {
  const mods = modifiers || [];
  const modBit = (mods.includes("alt") ? 1 : 0) | (mods.includes("ctrl") ? 2 : 0)
    | (mods.includes("meta") ? 4 : 0) | (mods.includes("shift") ? 8 : 0);

  const KEYS = {
    Enter: [13, "\r"], Tab: [9, "\t"], Backspace: [8, ""], Delete: [46, ""],
    Escape: [27, ""], ArrowUp: [38, ""], ArrowDown: [40, ""], ArrowLeft: [37, ""],
    ArrowRight: [39, ""], Space: [32, " "], End: [35, ""], Home: [36, ""],
  };

  const spec = KEYS[key];
  const kc = spec ? spec[0] : (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0);
  const code = spec ? key : (key.length === 1 ? `Key${key.toUpperCase()}` : key);
  const text = spec ? spec[1] : (modBit ? "" : key);

  try {
    await cdpAttach(tabId);
    await cdp(tabId, "Input.dispatchKeyEvent", {
      type: "keyDown", modifiers: modBit, key, code,
      windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc, text,
    });
    await cdp(tabId, "Input.dispatchKeyEvent", {
      type: "keyUp", modifiers: modBit, key, code,
      windowsVirtualKeyCode: kc, nativeVirtualKeyCode: kc,
    });
    return { success: true, key, modifiers: mods, method: "cdp" };
  } catch (err) {
    _attached.delete(tabId);
    return { success: false, error: err.message };
  }
}

// ═════════════════════════════════════════════════════════════════
//  CONTENT SCRIPT MESSAGING
// ═════════════════════════════════════════════════════════════════

async function toContent(action, args = {}) {
  const tab = await activeTab();
  if (!tab) return { success: false, error: "No active tab" };
  try {
    return (await chrome.tabs.sendMessage(tab.id, { action, args })) || { success: true };
  } catch {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
      return (await chrome.tabs.sendMessage(tab.id, { action, args })) || { success: true };
    } catch (err) {
      return { success: false, error: `Cannot access page: ${err.message}` };
    }
  }
}

async function injectAllTabs() {
  try {
    for (const tab of await chrome.tabs.query({})) {
      if (tab.url?.startsWith("http")) {
        try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] }); }
        catch { /* chrome:// etc */ }
      }
    }
  } catch {}
}

// ═════════════════════════════════════════════════════════════════
//  TAB MANAGEMENT
// ═════════════════════════════════════════════════════════════════

async function activeTab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t || null;
}

async function activeTabInfo() {
  const t = await activeTab();
  return t ? { success: true, tab: { id: t.id, title: t.title, url: t.url, index: t.index } }
    : { success: false, error: "No active tab" };
}

async function listTabs() {
  return { success: true, tabs: (await chrome.tabs.query({})).map(t =>
    ({ id: t.id, title: t.title, url: t.url, active: t.active, index: t.index })) };
}

async function switchTab(v) {
  if (typeof v === "number" && v < 100) {
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const t = tabs[v];
    if (!t) return { success: false, error: `No tab at index ${v}` };
    await chrome.tabs.update(t.id, { active: true });
    return { success: true, tab: { id: t.id, title: t.title, url: t.url } };
  }
  await chrome.tabs.update(v, { active: true });
  const t = await chrome.tabs.get(v);
  return { success: true, tab: { id: t.id, title: t.title, url: t.url } };
}

async function newTab(url) {
  const t = await chrome.tabs.create({ url: url || "about:blank" });
  return { success: true, tab: { id: t.id, title: t.title, url: t.url } };
}

async function closeTab(id) {
  if (id) await chrome.tabs.remove(id);
  else { const t = await activeTab(); if (t) await chrome.tabs.remove(t.id); }
  return { success: true };
}

async function doNavigate(url) {
  const t = await activeTab();
  if (!t) return { success: false, error: "No active tab" };
  if (!url.startsWith("http://") && !url.startsWith("https://")) url = "https://" + url;
  await chrome.tabs.update(t.id, { url });
  return { success: true, url };
}

// ═════════════════════════════════════════════════════════════════
//  UTILITIES
// ═════════════════════════════════════════════════════════════════

async function screenshot() {
  return { success: true, screenshot: await chrome.tabs.captureVisibleTab(null, { format: "png" }) };
}

async function execJS(code) {
  const t = await activeTab();
  if (!t) return { success: false, error: "No active tab" };
  const r = await chrome.scripting.executeScript({
    target: { tabId: t.id },
    func: (c) => { try { return { success: true, result: eval(c) }; } catch (e) { return { success: false, error: e.message }; } },
    args: [code],
  });
  return r[0]?.result || { success: false, error: "Script failed" };
}

function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

function badge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

// ═════════════════════════════════════════════════════════════════
//  TAB TRACKING
// ═════════════════════════════════════════════════════════════════

function sendActiveTab() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0] && ws?.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: "tab_update", tab: { id: tabs[0].id, title: tabs[0].title, url: tabs[0].url } }));
  });
}

chrome.tabs.onActivated.addListener(() => { if (connected) sendActiveTab(); });
chrome.tabs.onUpdated.addListener((_, info) => { if (info.status === "complete" && connected) sendActiveTab(); });

// ═════════════════════════════════════════════════════════════════
//  POPUP / SETTINGS
// ═════════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((msg, _, respond) => {
  if (msg.action === "reconnect") {
    try { ws?.close(); } catch {} ws = null; connected = false; connect();
    respond({ ok: true });
  } else if (msg.action === "settings_updated") {
    chrome.storage.local.set({ nova_bridge_settings: msg.settings });
    respond({ ok: true });
  } else if (msg.action === "get_status") {
    respond({ connected, version: "2.0.0" });
  }
  return false;
});

// ═════════════════════════════════════════════════════════════════
connect();
