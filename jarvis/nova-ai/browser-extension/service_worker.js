const DEFAULT_URL = 'ws://localhost:8950/browser-bridge';
let ws = null;
let reconnectTimer = null;

async function bridgeUrl() {
  const cfg = await chrome.storage.local.get('bridgeUrl');
  return cfg.bridgeUrl || DEFAULT_URL;
}

function setStatus(connected, lastError = '') {
  chrome.storage.local.set({ connected, lastError, updatedAt: Date.now() });
}

async function activeTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function assertPage(tab) {
  if (!tab?.id) throw new Error('no active tab');
  if (/^(chrome|edge|brave|about|chrome-extension):/i.test(tab.url || '')) {
    throw new Error('browser-internal pages cannot be automated');
  }
}

async function runInActiveTab(fn, args = []) {
  const tab = await activeTab();
  assertPage(tab);
  const [result] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: fn,
    args,
    world: 'MAIN'
  });
  return result?.result;
}

function pageSnapshot() {
  const text = document.body?.innerText || '';
  const links = Array.from(document.querySelectorAll('a[href]'))
    .slice(0, 100)
    .map((el, i) => ({
      index: i + 1,
      text: (el.innerText || el.getAttribute('aria-label') || el.href || '').trim().replace(/\s+/g, ' ').slice(0, 180),
      url: el.href,
    }));
  const controls = Array.from(document.querySelectorAll('a,button,input,textarea,select,[role="button"],[contenteditable="true"]'))
    .slice(0, 80)
    .map((el, i) => {
      const rect = el.getBoundingClientRect();
      const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title || el.name || el.id || el.href || '').trim().replace(/\s+/g, ' ');
      return {
        index: i + 1,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        selector: el.id ? `#${CSS.escape(el.id)}` : el.name ? `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]` : '',
        text: label.slice(0, 160),
        visible: rect.width > 0 && rect.height > 0,
      };
    });
  return {
    title: document.title,
    url: location.href,
    text: text.slice(0, 14000),
    links,
    controls,
    scroll: { x: scrollX, y: scrollY, height: document.documentElement.scrollHeight, viewport: innerHeight },
  };
}

function pageLinks() {
  return {
    links: Array.from(document.querySelectorAll('a[href]')).slice(0, 120).map((el, i) => ({
      index: i + 1,
      text: (el.innerText || el.getAttribute('aria-label') || el.href || '').trim().replace(/\s+/g, ' ').slice(0, 180),
      url: el.href,
    })),
  };
}

function findElement(selectorOrText) {
  const q = String(selectorOrText || '').trim();
  if (!q) return null;
  try {
    const direct = document.querySelector(q);
    if (direct) return direct;
  } catch {}
  const needle = q.toLowerCase();
  const candidates = Array.from(document.querySelectorAll('button,a,input,textarea,select,[role="button"],[contenteditable="true"],label'));
  return candidates.find((el) => {
    const hay = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title || '').trim().toLowerCase();
    return hay && hay.includes(needle);
  }) || null;
}

function clickElement(selectorOrText) {
  const el = findElement(selectorOrText);
  if (!el) return { error: `element not found: ${selectorOrText}` };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus?.();
  el.click();
  return { ok: true, clicked: selectorOrText, text: (el.innerText || el.value || '').trim().slice(0, 160) };
}

function focusElement(selectorOrText) {
  const el = findElement(selectorOrText);
  if (!el) return { error: `element not found: ${selectorOrText}` };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus?.();
  return { ok: true, focused: selectorOrText };
}

function typeText(text, selector, clear) {
  let el = selector ? findElement(selector) : document.activeElement;
  if (!el || el === document.body) el = findElement('textarea') || findElement('input') || document.activeElement;
  if (!el) return { error: 'no focused/input element' };
  el.scrollIntoView({ block: 'center', inline: 'center' });
  el.focus?.();
  const value = String(text || '');
  if ('value' in el) {
    if (clear) el.value = '';
    el.value += value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { ok: true, method: 'value', chars: value.length };
  }
  document.execCommand('insertText', false, value);
  return { ok: true, method: 'insertText', chars: value.length };
}

function pressKey(key, modifiers = []) {
  const k = String(key || '');
  const opts = {
    key: k,
    code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
    bubbles: true,
    cancelable: true,
    ctrlKey: modifiers.includes('ctrl'),
    shiftKey: modifiers.includes('shift'),
    altKey: modifiers.includes('alt'),
    metaKey: modifiers.includes('meta'),
  };
  const target = document.activeElement || document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', opts));
  target.dispatchEvent(new KeyboardEvent('keyup', opts));
  return { ok: true, method: 'keyboardEvent', key: k, modifiers };
}

function scrollPage(amount) {
  const a = String(amount || 'down').toLowerCase();
  if (a === 'top') scrollTo({ top: 0, behavior: 'auto' });
  else if (a === 'bottom') scrollTo({ top: document.documentElement.scrollHeight, behavior: 'auto' });
  else {
    const n = /^-?\d+$/.test(a) ? Number(a) : a.startsWith('up') ? -Math.round(innerHeight * 0.8) : Math.round(innerHeight * 0.8);
    scrollBy({ top: n, behavior: 'auto' });
  }
  return { ok: true, y: scrollY, height: document.documentElement.scrollHeight };
}

function selectedText() {
  return { text: String(getSelection?.() || '') };
}

function executeJs(code) {
  let value;
  try {
    value = eval(code);
  } catch {
    value = Function(`"use strict"; return (async () => { ${code} })()`)();
  }
  return Promise.resolve(value).then((v) => {
    let out = '';
    try { out = typeof v === 'string' ? v : JSON.stringify(v); }
    catch { out = String(v); }
    return { ok: true, value: out };
  });
}

async function handleCommand(action, args = {}) {
  if (action === 'get_active_tab') return activeTab();
  if (action === 'get_tabs') {
    const tabs = await chrome.tabs.query({});
    return { tabs: tabs.map((t) => ({ id: t.id, title: t.title, url: t.url, active: t.active })) };
  }
  if (action === 'open_tab') {
    const tab = await chrome.tabs.create({ url: args.url || 'about:blank', active: args.active !== false });
    return { ok: true, id: tab.id, title: tab.title, url: tab.url, active: tab.active };
  }
  if (action === 'switch_tab') {
    const id = Number(args.id);
    if (!id) throw new Error('missing tab id');
    const tab = await chrome.tabs.update(id, { active: true });
    if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
    return { ok: true, id: tab.id, title: tab.title, url: tab.url, active: tab.active };
  }
  if (action === 'close_tab') {
    const id = Number(args.id);
    if (!id) throw new Error('missing tab id');
    await chrome.tabs.remove(id);
    return { ok: true, id };
  }
  if (action === 'navigate') {
    const tab = await activeTab();
    if (!tab?.id) throw new Error('no active tab');
    await chrome.tabs.update(tab.id, { url: args.url });
    return { ok: true, url: args.url };
  }
  if (action === 'get_page_content') return runInActiveTab(pageSnapshot);
  if (action === 'get_links') return runInActiveTab(pageLinks);
  if (action === 'click_element') return runInActiveTab(clickElement, [args.selector]);
  if (action === 'focus_element') return runInActiveTab(focusElement, [args.selector]);
  if (action === 'type_text') return runInActiveTab(typeText, [args.text, args.selector || '', !!args.clear]);
  if (action === 'press_key') return runInActiveTab(pressKey, [args.key, args.modifiers || []]);
  if (action === 'scroll') return runInActiveTab(scrollPage, [args.amount || 'down']);
  if (action === 'get_selected_text') return runInActiveTab(selectedText);
  if (action === 'execute_js') return runInActiveTab(executeJs, [args.code || '']);
  throw new Error(`unknown action: ${action}`);
}

async function connect() {
  clearTimeout(reconnectTimer);
  try { ws?.close(); } catch {}
  const url = await bridgeUrl();
  try {
    ws = new WebSocket(url);
  } catch (e) {
    setStatus(false, String(e?.message || e));
    reconnectTimer = setTimeout(connect, 1500);
    return;
  }
  ws.onopen = () => setStatus(true, '');
  ws.onclose = () => {
    setStatus(false, 'Disconnected. Waiting for Nova bridge...');
    reconnectTimer = setTimeout(connect, 1500);
  };
  ws.onerror = () => setStatus(false, 'WebSocket error');
  ws.onmessage = async (event) => {
    let msg;
    try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type !== 'command') return;
    try {
      const result = await handleCommand(msg.action, msg.args || {});
      ws.send(JSON.stringify({ type: 'command_result', id: msg.id, result }));
    } catch (e) {
      ws.send(JSON.stringify({ type: 'command_result', id: msg.id, result: { error: String(e?.message || e) } }));
    }
  };
}

chrome.runtime.onInstalled.addListener(connect);
chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'reconnect') connect();
});
connect();
