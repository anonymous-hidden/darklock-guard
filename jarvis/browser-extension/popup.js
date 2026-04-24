/**
 * Nova Browser Bridge v2.0 — Popup
 */

const $ = (s) => document.getElementById(s);

function update(connected) {
  const dot = $("dot");
  const glow = $("glow");
  const label = $("statusLabel");
  const ws = $("wsStatus");

  if (connected) {
    dot.classList.remove("off");
    glow.classList.remove("off");
    label.innerHTML = `Connected <span>to Nova Terminal</span>`;
    ws.textContent = "Live";
    ws.classList.remove("off");
  } else {
    dot.classList.add("off");
    glow.classList.add("off");
    label.innerHTML = `Disconnected <span>— click Reconnect</span>`;
    ws.textContent = "Off";
    ws.classList.add("off");
  }
}

function refresh() {
  chrome.runtime.sendMessage({ action: "get_status" }, (res) => {
    update(res?.connected ?? false);
  });
}

$("btnReconnect").addEventListener("click", () => {
  $("statusLabel").innerHTML = "Reconnecting...";
  chrome.runtime.sendMessage({ action: "reconnect" }, () => {
    setTimeout(refresh, 1500);
  });
});

$("btnTest").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  try {
    const res = await chrome.tabs.sendMessage(tab.id, { action: "get_page_content", args: {} });
    if (res?.success) {
      $("statusLabel").innerHTML = `<span>Page: ${res.title?.slice(0, 30) || "OK"} (${res.word_count} words)</span>`;
    } else {
      $("statusLabel").innerHTML = `<span style="color:#f87171">Test failed: ${res?.error || "unknown"}</span>`;
    }
  } catch (err) {
    $("statusLabel").innerHTML = `<span style="color:#f87171">${err.message}</span>`;
  }
});

refresh();
setInterval(refresh, 5000);
