// IntelliFlow for n8n — isolated-world core: RPC client + settings.
// Establishes the window.IF namespace shared by the other content scripts.

(function () {
  "use strict";

  const WIRE = "__intelliflow_bridge__";
  const IF = (window.IF = window.IF || {});

  // ---- Bridge RPC client (talks to MAIN-world bridge.js) -----------------

  const pending = new Map();
  const listeners = new Map();
  let seq = 0;

  window.addEventListener("message", (ev) => {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || !msg[WIRE]) return;

    if (msg.dir === "res") {
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error || "Bridge error"));
    } else if (msg.dir === "event") {
      (listeners.get(msg.event) || []).forEach((cb) => {
        try {
          cb(msg.payload);
        } catch {
          /* listener errors are non-fatal */
        }
      });
    }
  });

  const bridge = {
    call(op, payload, timeoutMs = 20000) {
      return new Promise((resolve, reject) => {
        const id = "if" + ++seq;
        pending.set(id, { resolve, reject });
        window.postMessage({ [WIRE]: true, dir: "req", id, op, payload }, window.location.origin);
        setTimeout(() => {
          if (pending.has(id)) {
            pending.delete(id);
            reject(new Error("Bridge timeout for '" + op + "'. Is this an n8n page fully loaded?"));
          }
        }, timeoutMs);
      });
    },
    on(event, cb) {
      const arr = listeners.get(event) || [];
      arr.push(cb);
      listeners.set(event, arr);
    },
  };

  IF.bridge = bridge;

  // ---- Settings (chrome.storage.local, with sane defaults) ---------------

  const DEFAULTS = {
    provider: "gemini",
    // Per-provider config keyed by provider id: { apiKey, model, baseURL, curlTemplate }
    providers: {
      gemini: { apiKey: "", model: "gemini-2.5-flash" },
    },
    enterMode: "auto", // auto | enter | ctrl
    permissionMode: "ask", // ask | plan | noperms
    panel: { x: 40, y: 90, w: 470, h: 650, minimized: false },
    opacity: 1,
  };

  const settings = {
    _cache: Object.assign({}, DEFAULTS),
    async load() {
      const stored = await chrome.storage.local.get("intelliflow_settings");
      this._cache = Object.assign({}, DEFAULTS, stored.intelliflow_settings || {});
      this._cache.panel = Object.assign({}, DEFAULTS.panel, this._cache.panel || {});
      return this._cache;
    },
    get(key) {
      return this._cache[key];
    },
    async set(patch) {
      this._cache = Object.assign({}, this._cache, patch);
      await chrome.storage.local.set({ intelliflow_settings: this._cache });
      return this._cache;
    },
    all() {
      return this._cache;
    },
    // Active provider's resolved config, with provider defaults filled in.
    providerConfig(providerKey) {
      const key = providerKey || this._cache.provider;
      const meta = (window.IF.AI && window.IF.AI.PROVIDERS[key]) || {};
      const saved = (this._cache.providers && this._cache.providers[key]) || {};
      return {
        apiKey: saved.apiKey || "",
        model: saved.model || meta.defaultModel || "",
        baseURL: saved.baseURL || meta.baseURL || "",
        curlTemplate: saved.curlTemplate || "",
      };
    },
    async setProviderConfig(patch, providerKey) {
      const key = providerKey || this._cache.provider;
      const providers = Object.assign({}, this._cache.providers);
      providers[key] = Object.assign({}, providers[key], patch);
      return this.set({ providers });
    },
  };

  IF.settings = settings;

  // ---- Logging -----------------------------------------------------------

  IF.log = function (...args) {
    try {
      console.log("%c[IntelliFlow]", "color:#5b6cff;font-weight:bold", ...args);
    } catch (e) {
      /* ignore */
    }
  };
  IF.time = function (label) {
    const start = (performance && performance.now ? performance.now() : Date.now());
    return function (extra) {
      const ms = (performance && performance.now ? performance.now() : Date.now()) - start;
      IF.log(label, ms.toFixed(0) + "ms", extra != null ? extra : "");
    };
  };

  // ---- Persisted chat sessions (survive reloads / restarts) --------------

  const SESS_KEY = "intelliflow_sessions";
  const sessionStore = {
    _cache: { list: [], activeId: null },
    async load() {
      const s = await chrome.storage.local.get(SESS_KEY);
      this._cache = Object.assign({ list: [], activeId: null }, s[SESS_KEY] || {});
      if (!Array.isArray(this._cache.list)) this._cache.list = [];
      return this._cache;
    },
    all() {
      return this._cache.list;
    },
    activeId() {
      return this._cache.activeId;
    },
    get(id) {
      return this._cache.list.find((s) => s.id === id) || null;
    },
    _timer: null,
    persist() {
      clearTimeout(this._timer);
      this._timer = setTimeout(() => {
        try {
          chrome.storage.local.set({ [SESS_KEY]: this._cache });
        } catch {
          /* ignore quota */
        }
      }, 300);
    },
    upsert(session) {
      const i = this._cache.list.findIndex((s) => s.id === session.id);
      if (i >= 0) this._cache.list[i] = session;
      else this._cache.list.unshift(session);
      // Keep newest 60, by updatedAt.
      this._cache.list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (this._cache.list.length > 60) this._cache.list.length = 60;
      this.persist();
    },
    remove(id) {
      this._cache.list = this._cache.list.filter((s) => s.id !== id);
      if (this._cache.activeId === id) this._cache.activeId = null;
      this.persist();
    },
    setActive(id) {
      this._cache.activeId = id;
      this.persist();
    },
  };

  IF.sessionStore = sessionStore;

  // ---- Screenshot fallback (routes through the background worker) ---------

  IF.captureScreenshot = function () {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: "INTELLIFLOW_CAPTURE" }, (resp) => {
        if (chrome.runtime.lastError || !resp || !resp.dataUrl) {
          resolve(null);
          return;
        }
        resolve(resp.dataUrl);
      });
    });
  };
})();
