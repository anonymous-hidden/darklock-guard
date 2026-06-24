# Nova Browser Bridge Extension

This Chrome/Brave extension connects the active browser tab to Nova's local browser bridge.

## Load it

1. Open `chrome://extensions` or `brave://extensions`.
2. Turn on `Developer mode`.
3. Click `Load unpacked`.
4. Select this folder: `jarvis/nova-ai/browser-extension`.
5. Open Nova. The local bridge starts at `ws://localhost:8950/browser-bridge` by default.
6. Click the Nova extension icon and confirm the bridge URL is the same.

## Capabilities

Nova can use the extension to:

- read the active tab
- list tabs
- open a new tab
- switch to a specific tab
- navigate the active tab
- click, type, scroll, and read selected text

Nova should not close tabs unless you explicitly ask or a task cleanup requires it.

## What Nova can do

- Read the current active tab, including visible controls and links.
- Navigate the active tab.
- Click buttons/links by selector or visible text.
- Focus fields and type text.
- Press keys, select all, scroll, and read selected text.
- Run page JavaScript when the page allows it.

Browser-internal pages like `chrome://extensions` are intentionally blocked.
