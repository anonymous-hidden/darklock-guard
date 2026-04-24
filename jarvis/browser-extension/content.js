/**
 * Nova Browser Bridge v2.0 — Content Script
 * ===========================================
 * Handles normal web pages. Google Docs is handled by CDP in background.js.
 */

(() => {
  if (window.__novaBridge === "2.0") return;
  window.__novaBridge = "2.0";

  // ═════════════════════════════════════════════════════════════════
  //  MESSAGE HANDLER
  // ═════════════════════════════════════════════════════════════════

  function handler(msg, _sender, respond) {
    (async () => {
      try {
        const r = await dispatch(msg.action, msg.args || {});
        respond(r);
      } catch (err) {
        respond({ success: false, error: err.message });
      }
    })();
    return true; // async
  }

  // Remove old listener if present, set new one
  if (window.__novaBridgeHandler) chrome.runtime.onMessage.removeListener(window.__novaBridgeHandler);
  window.__novaBridgeHandler = handler;
  chrome.runtime.onMessage.addListener(handler);

  // ═════════════════════════════════════════════════════════════════
  //  DISPATCH
  // ═════════════════════════════════════════════════════════════════

  async function dispatch(action, args) {
    switch (action) {
      case "get_page_content":  return getPageContent(args);
      case "get_page_text":     return getPageText();
      case "get_selected_text": return getSelectedText();
      case "get_input_values":  return getInputValues();
      case "get_links":         return getLinks(args);
      case "type_text":         return typeText(args);
      case "click_element":     return clickElement(args);
      case "press_key":         return pressKey(args);
      case "scroll_page":       return scrollPage(args);
      case "fill_form":         return fillForm(args);
      case "focus_element":     return focusElement(args);
      case "wait_for_element":  return waitForElement(args);
      case "go_back":           history.back(); return { success: true };
      case "go_forward":        history.forward(); return { success: true };
      default:                  return { success: false, error: `Unknown: ${action}` };
    }
  }

  // ═════════════════════════════════════════════════════════════════
  //  READ
  // ═════════════════════════════════════════════════════════════════

  function getPageContent({ maxLength = 8000 } = {}) {
    const title = document.title;
    const url = location.href;

    // Remove noisy elements
    const skipTags = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "IMG", "VIDEO", "AUDIO", "IFRAME", "CANVAS"]);
    const blocks = [];

    function walk(el) {
      if (skipTags.has(el.tagName)) return;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      for (const ch of el.childNodes) {
        if (ch.nodeType === 3) {
          const t = ch.textContent.trim();
          if (t) blocks.push(t);
        } else if (ch.nodeType === 1) walk(ch);
      }
    }
    walk(document.body);

    let text = blocks.join("\n").replace(/\n{3,}/g, "\n\n");
    if (text.length > maxLength) text = text.slice(0, maxLength) + "\n...(truncated)";

    return {
      success: true,
      title,
      url,
      text,
      word_count: text.split(/\s+/).length,
      is_google_docs: false,
    };
  }

  function getPageText() {
    const text = document.body?.innerText?.trim() || "";
    return { success: true, text, word_count: text.split(/\s+/).length };
  }

  function getSelectedText() {
    const text = window.getSelection()?.toString() || "";
    return { success: true, text };
  }

  function getInputValues() {
    const inputs = [];
    document.querySelectorAll("input, textarea, select").forEach((el) => {
      inputs.push({
        tag: el.tagName.toLowerCase(),
        type: el.type || "",
        name: el.name || "",
        id: el.id || "",
        value: el.value || "",
        placeholder: el.placeholder || "",
      });
    });
    return { success: true, inputs };
  }

  function getLinks({ maxLinks = 30 } = {}) {
    const links = [];
    document.querySelectorAll("a[href]").forEach((a) => {
      const text = a.textContent.trim();
      if (text && links.length < maxLinks) {
        links.push({ text: text.slice(0, 100), href: a.href, id: a.id || "" });
      }
    });
    return { success: true, links };
  }

  // ═════════════════════════════════════════════════════════════════
  //  INTERACT
  // ═════════════════════════════════════════════════════════════════

  function typeText({ text, selector }) {
    const el = selector ? find(selector) : document.activeElement;
    if (!el) return { success: false, error: `Element not found: ${selector}` };
    el.focus();
    if ("value" in el) {
      el.value += text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      document.execCommand("insertText", false, text);
    }
    return { success: true, typed: text, chars: text.length };
  }

  function clickElement({ selector, text, index = 0 }) {
    let el;
    if (selector) {
      el = find(selector, index);
    } else if (text) {
      el = findByText(text);
    }
    if (!el) return { success: false, error: `Element not found: ${selector || text}` };
    el.scrollIntoView({ block: "center" });
    el.focus();
    el.click();
    return { success: true, clicked: selector || text };
  }

  function pressKey({ key, modifiers = [] }) {
    const target = document.activeElement || document.body;
    const opts = {
      key,
      code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
      bubbles: true,
      ctrlKey: modifiers.includes("ctrl"),
      shiftKey: modifiers.includes("shift"),
      altKey: modifiers.includes("alt"),
      metaKey: modifiers.includes("meta"),
    };
    target.dispatchEvent(new KeyboardEvent("keydown", opts));
    target.dispatchEvent(new KeyboardEvent("keypress", opts));
    target.dispatchEvent(new KeyboardEvent("keyup", opts));
    return { success: true, key };
  }

  function scrollPage({ direction = "down", amount = 500 }) {
    const px = direction === "up" ? -amount : direction === "top" ? -document.body.scrollHeight
      : direction === "bottom" ? document.body.scrollHeight : amount;
    window.scrollBy({ top: px, behavior: "smooth" });
    return { success: true, scrolled: direction, amount: Math.abs(px) };
  }

  function fillForm({ fields }) {
    if (!fields) return { success: false, error: "No fields" };
    const filled = [];
    for (const [sel, val] of Object.entries(fields)) {
      const el = find(sel);
      if (el) {
        el.value = val;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        filled.push(sel);
      }
    }
    return { success: true, filled };
  }

  function focusElement({ selector }) {
    const el = find(selector);
    if (!el) return { success: false, error: `Not found: ${selector}` };
    el.focus();
    el.scrollIntoView({ block: "center" });
    return { success: true, focused: selector };
  }

  function waitForElement({ selector, timeout = 5000 }) {
    return new Promise((resolve) => {
      const el = find(selector);
      if (el) return resolve({ success: true, found: true });

      const observer = new MutationObserver(() => {
        const el = find(selector);
        if (el) { observer.disconnect(); clearTimeout(t); resolve({ success: true, found: true }); }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const t = setTimeout(() => {
        observer.disconnect();
        resolve({ success: false, error: "Timeout" });
      }, timeout);
    });
  }

  // ═════════════════════════════════════════════════════════════════
  //  HELPERS
  // ═════════════════════════════════════════════════════════════════

  function find(selector, index = 0) {
    try {
      const all = document.querySelectorAll(selector);
      return all[index] || null;
    } catch {
      return document.getElementById(selector) || document.querySelector(`[name="${selector}"]`) || null;
    }
  }

  function findByText(text) {
    const lower = text.toLowerCase();
    // Buttons & links first
    for (const el of document.querySelectorAll("button, a, [role='button'], input[type='submit']")) {
      if ((el.textContent || el.value || "").toLowerCase().includes(lower)) return el;
    }
    // Then any visible element
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => n.textContent.toLowerCase().includes(lower) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    const node = tw.nextNode();
    return node?.parentElement || null;
  }
})();
