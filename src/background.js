// IntelliFlow for n8n — background service worker.
// - Toggles the injected panel when the toolbar icon is clicked (any page).
// - Badges the icon on pages detected (by content) as n8n.
// - Captures a screenshot for the AI's fallback tool.

const CONTENT_FILES = [
  "src/core/protocol.js",
  "src/lang/iflang.js",
  "src/ai/providers.js",
  "src/content/icons.js",
  "src/content/ui.js",
  "src/content/content.js",
];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg) return;

  // Screenshot fallback.
  if (msg.type === "INTELLIFLOW_CAPTURE") {
    const windowId = sender.tab ? sender.tab.windowId : undefined;
    chrome.tabs.captureVisibleTab(windowId, { format: "png" }, (dataUrl) => {
      if (chrome.runtime.lastError) sendResponse({ dataUrl: null, error: chrome.runtime.lastError.message });
      else sendResponse({ dataUrl });
    });
    return true; // async
  }

  // Content-based n8n detection → badge this tab's icon.
  if (msg.type === "INTELLIFLOW_DETECTED" && sender.tab && sender.tab.id != null) {
    const tabId = sender.tab.id;
    chrome.action.setBadgeText({ tabId, text: "●" });
    chrome.action.setBadgeBackgroundColor({ tabId, color: "#5b6cff" });
    chrome.action.setTitle({ tabId, title: "IntelliFlow — n8n detected (click to open)" });
  }
});

// Streaming request proxy. The content script runs in the n8n page's (HTTPS)
// origin, so it can't fetch HTTP endpoints (mixed content) or cross-origin
// providers blocked by CSP/CORS. The background (extension origin) is exempt and
// uses the extension's host permissions, so it can reach any endpoint the user
// configures — including a local Ollama over plain HTTP. Chunks stream back over
// the port so token streaming still works.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "intelliflow-fetch") return;
  const controller = new AbortController();
  let closed = false;
  port.onDisconnect.addListener(() => {
    closed = true;
    controller.abort();
  });
  port.onMessage.addListener(async (msg) => {
    if (!msg) return;
    if (msg.type === "abort") {
      controller.abort();
      return;
    }
    if (msg.type !== "fetch") return;
    const post = (m) => {
      if (!closed) {
        try { port.postMessage(m); } catch (_) { /* port gone */ }
      }
    };
    try {
      const res = await fetch(msg.url, {
        method: msg.method || "GET",
        headers: msg.headers || {},
        body: msg.body,
        signal: controller.signal,
      });
      post({ type: "head", ok: res.ok, status: res.status, statusText: res.statusText });
      if (res.body && res.body.getReader) {
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          post({ type: "chunk", data: dec.decode(value, { stream: true }) });
        }
      } else {
        post({ type: "chunk", data: await res.text() });
      }
      post({ type: "done" });
    } catch (e) {
      post({ type: "error", message: (e && e.message) || String(e) });
    }
    try { port.disconnect(); } catch (_) { /* ignore */ }
  });
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || tab.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: "INTELLIFLOW_TOGGLE" });
  } catch {
    // Content scripts may not be present (e.g. installed mid-session, or a page
    // that wasn't matched). Force-inject, then toggle.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "MAIN", files: ["src/bridge/bridge.js"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_FILES });
      await chrome.tabs.sendMessage(tab.id, { type: "INTELLIFLOW_TOGGLE" });
    } catch {
      // Likely a restricted page (chrome://, web store). Nothing to do.
    }
  }
});
