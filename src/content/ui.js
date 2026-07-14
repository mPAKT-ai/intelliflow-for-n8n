// IntelliFlow for n8n — panel UI (isolated world, Shadow DOM).
// Draggable / minimizable / resizable translucent window with a streaming chat,
// tool-call badges, screenshot previews and permission-mode approval cards.

(function () {
  "use strict";
  const IF = (window.IF = window.IF || {});
  const icon = (n, s) => IF.Icons.icon(n, s);

  const CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: "Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
.if-panel {
  --bg:#0b0c0f; --surface:#121419; --surface2:#171a20; --line:#252a32; --line2:#333944;
  --text:#e2e5ea; --muted:#868d99; --accent:#5b6cff; --accent-soft:#1b1f33;
  --ok:#37b985; --warn:#d9a13a; --danger:#e26a6d;
  --mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
  position: fixed; z-index: 2147483000; display: flex; flex-direction: column;
  min-width: 330px; min-height: 44px; width: 470px; height: 650px;
  color: var(--text);
  background: color-mix(in srgb, var(--bg) calc(var(--if-opacity, 1) * 100%), transparent);
  backdrop-filter: blur(7px); -webkit-backdrop-filter: blur(7px);
  border: 1px solid var(--line); border-radius: 12px;
  box-shadow: 0 14px 44px rgba(0,0,0,.5);
  overflow: hidden; resize: both;
}
.if-panel.min { height: 44px !important; min-height: 44px; resize: none; }
.if-panel.min .if-body { display: none; }
.if-titlebar {
  height: 44px; flex: none; display: flex; align-items: center; gap: 8px;
  padding: 0 8px 0 11px; cursor: move; user-select: none;
  background: var(--surface); border-bottom: 1px solid var(--line);
}
.if-brand { display: flex; align-items: center; gap: 8px; font-weight: 650; font-size: 13px; letter-spacing: .2px; }
.if-brand .if-logo { color: var(--accent); display: flex; align-items:center; }
.if-brand small { font-weight: 500; color: var(--muted); font-size: 10px; margin-left: 1px;
  font-family: var(--mono); text-transform: uppercase; letter-spacing: .6px; }
.if-spacer { flex: 1; }
.if-mode { display:flex; align-items:center; gap:5px; font-size:11px; font-weight:600; font-family:var(--mono);
  padding: 3px 8px; border-radius: 6px; cursor: pointer; border: 1px solid var(--line2);
  background: var(--surface2); color:var(--muted); }
.if-mode:hover { border-color: var(--accent); }
.if-mode.ask { color:#7f8cff; } .if-mode.plan { color:var(--warn); } .if-mode.noperms { color:var(--danger); }
.if-iconbtn { display:flex; align-items:center; justify-content:center; width:28px; height:26px;
  border:1px solid transparent; border-radius:6px; background: transparent; color:var(--muted); cursor:pointer; }
.if-iconbtn:hover { background: var(--surface2); color:var(--text); border-color:var(--line); }
.if-body { flex:1; min-height:0; display:flex; flex-direction:column; position:relative; }
.if-ctxbar { flex:none; display:flex; align-items:center; gap:7px; padding:7px 12px; font-size:11px; font-weight:600;
  font-family:var(--mono); border-bottom:1px solid var(--line); background:var(--surface); color:var(--muted); }
.if-ctxbar .if-ico { flex:none; }
.if-ctxbar.editor { color:#8b96ff; } .if-ctxbar.editor .if-ico { color:#8b96ff; }
.if-ctxbar.list { color:var(--warn); } .if-ctxbar.list .if-ico { color:var(--warn); }
.if-ctxbar .name { color:var(--text); font-weight:700; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.if-ctxbar .tag { margin-left:auto; opacity:.7; font-weight:600; text-transform:uppercase; letter-spacing:.5px; font-size:9px;
  border:1px solid var(--line2); padding:1px 5px; border-radius:4px; }
.if-todos { display:none; flex:none; flex-direction:column; gap:3px; padding:8px 12px; border-bottom:1px solid var(--line); background:var(--surface); }
.if-todos.show { display:flex; }
.if-todo-head { display:flex; align-items:center; gap:6px; font-size:10.5px; font-weight:700; color:var(--muted); font-family:var(--mono); text-transform:uppercase; letter-spacing:.5px; margin-bottom:2px; }
.if-todo-head span { margin-left:auto; }
.if-todo-item { display:flex; align-items:center; gap:7px; font-size:12px; color:var(--text); }
.if-todo-item.done { color:var(--muted); text-decoration:line-through; }
.if-todo-item .if-ico { color:var(--ok); flex:none; }
.if-todo-box { width:13px; height:13px; flex:none; border:1.5px solid var(--line2); border-radius:3px; }
.if-qcard { align-self:stretch; width:100%; border:1px solid var(--line2); border-radius:9px; overflow:hidden; background:var(--surface); }
.if-qhead { padding:10px 12px; font-size:12.5px; font-weight:600; line-height:1.4; display:flex; gap:7px; align-items:flex-start; border-bottom:1px solid var(--line); }
.if-qhead .if-ico { color:var(--accent); flex:none; margin-top:2px; }
.if-qopts { display:flex; flex-direction:column; gap:6px; padding:10px 12px; }
.if-qbtn { text-align:left; padding:9px 11px; border:1px solid var(--line2); border-radius:8px; background:var(--surface2); color:var(--text);
  cursor:pointer; font-size:12.5px; font-family:inherit; }
.if-qbtn:hover { border-color:var(--accent); background:var(--accent-soft); }
.if-qopt { display:flex; align-items:center; gap:9px; padding:7px 10px; border:1px solid var(--line2); border-radius:8px; cursor:pointer; font-size:12.5px; }
.if-qopt:hover { border-color:var(--accent); }
.if-qopt input { accent-color:var(--accent); }
.if-qother { display:flex; gap:6px; padding:0 12px 12px; }
.if-qtext { flex:1; padding:8px 10px; border-radius:8px; font-size:12.5px; background:var(--surface2); color:var(--text); border:1px solid var(--line2); outline:none; }
.if-qtext:focus { border-color:var(--accent); }
.if-qsend { width:34px; border:0; border-radius:8px; background:var(--accent); color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center; }
.if-qcard.done { opacity:.7; }
.if-settings { position:absolute; inset:0; z-index:6; display:none; flex-direction:column; background:var(--bg); }
.if-settings.open { display:flex; }
.if-settings-head { flex:none; display:flex; align-items:center; gap:8px; height:42px; padding:0 8px; font-weight:700; font-size:13px;
  border-bottom:1px solid var(--line); background:var(--surface); }
.if-settings-scroll { flex:1; overflow-y:auto; display:flex; flex-direction:column; gap:9px; padding:12px; }
.if-settings label { font-size:10px; color:var(--muted); margin-bottom:-5px; font-family:var(--mono); text-transform:uppercase; letter-spacing:.5px; }
.if-settings input, .if-settings select, .if-settings textarea {
  width:100%; padding:8px 10px; border-radius:7px; font-size:12.5px;
  background: var(--surface2); color:var(--text); border:1px solid var(--line2); outline:none; }
.if-settings textarea { font-family:var(--mono); font-size:11.5px; resize:vertical; min-height:64px; }
.if-settings input:focus, .if-settings select:focus, .if-settings textarea:focus { border-color:var(--accent); }
.if-settings .hide { display:none; }
.if-keyhint { font-size:10.5px; color:var(--muted); margin-top:-4px; }
.if-row { display:flex; gap:8px; } .if-row > * { flex:1; min-width:0; }
.if-messages { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:11px; scroll-behavior:smooth; }
.if-messages::-webkit-scrollbar { width:9px; } .if-messages::-webkit-scrollbar-thumb { background:var(--line2); border-radius:8px; border:2px solid transparent; background-clip:padding-box; }
.if-row { display:flex; flex-direction:column; gap:2px; }
.if-row-user { align-self:flex-end; align-items:flex-end; max-width:86%; }
.if-row-ai { align-self:flex-start; align-items:flex-start; width:100%; }
.if-msg { max-width:100%; font-size:13px; line-height:1.5; }
.if-msg.user { background:var(--surface2); color:var(--text); border:1px solid var(--line2);
  border-left:2px solid var(--accent); padding:8px 11px; border-radius:8px; max-width:100%; white-space:pre-wrap; word-break:break-word; }
.if-msg.ai { align-self:flex-start; color:var(--text); white-space:normal; word-break:break-word; width:100%; }
.if-actions { display:flex; gap:1px; opacity:0; transition:opacity .1s; position:relative; }
.if-row-user .if-actions { justify-content:flex-end; }
.if-row:hover .if-actions, .if-actions.menu-open { opacity:1; }
.if-actbtn { width:26px; height:24px; border:0; border-radius:6px; background:transparent; color:var(--muted); cursor:pointer; display:flex; align-items:center; justify-content:center; }
.if-actbtn:hover { background:var(--surface2); color:var(--text); }
.if-moremenu { display:none; position:absolute; bottom:100%; right:0; margin-bottom:4px; background:var(--surface); border:1px solid var(--line2);
  border-radius:8px; box-shadow:0 6px 20px rgba(0,0,0,.4); z-index:10; padding:4px; min-width:118px; }
.if-actions.menu-open .if-moremenu { display:block; }
.if-moremenu button { display:flex; align-items:center; gap:8px; width:100%; padding:7px 10px; border:0; border-radius:6px; background:transparent;
  color:var(--danger); cursor:pointer; font-size:12px; font-family:inherit; text-align:left; }
.if-moremenu button:hover { background:var(--surface2); }
.if-msg.ai .if-ai-head { display:flex; align-items:center; gap:6px; font-size:10px; font-weight:700; color:var(--muted);
  margin-bottom:5px; text-transform:uppercase; letter-spacing:.7px; font-family:var(--mono); }
.if-msg.ai .if-ai-head .if-logo { color:var(--accent); }
.if-msg pre { background: var(--surface); border:1px solid var(--line); border-radius:8px;
  padding:10px 12px; overflow:auto; font-family: var(--mono); font-size:11.5px; margin:6px 0; line-height:1.45; }
.if-msg code { font-family: var(--mono); background:var(--surface2); border:1px solid var(--line); padding:1px 5px; border-radius:4px; font-size:11.5px; }
.if-msg pre code { background:none; padding:0; border:0; }
.if-tools { display:flex; flex-wrap:wrap; gap:6px; align-self:flex-start; }
.if-tool { display:flex; align-items:center; gap:6px; font-size:11px; font-family:var(--mono); padding:3px 8px; border-radius:6px;
  background:var(--surface2); border:1px solid var(--line2); color:var(--muted); }
.if-tool .if-ico { color:var(--accent); }
.if-shots { display:flex; gap:6px; flex-wrap:wrap; align-self:flex-start; }
.if-shot { width:64px; height:32px; object-fit:cover; border-radius:4px; border:1px solid var(--line2); cursor:zoom-in; }
.if-approval-host { position:absolute; inset:0; z-index:7; display:none; overflow:auto; padding:12px;
  background:color-mix(in srgb, var(--bg) 94%, transparent); }
.if-approval-host.active { display:block; }
.if-card { align-self:stretch; border:1px solid var(--line2); border-radius:9px; overflow:hidden; background:var(--surface); }
.if-card-head { padding:9px 12px; display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700;
  background:var(--surface2); border-bottom:1px solid var(--line); }
.if-card-head .if-ico { color:var(--accent); }
.if-card-sum { padding:9px 12px; font-size:12.5px; line-height:1.5; color:var(--text); }
.if-card-sum b { color:#fff; }
.if-diff { margin:0 12px 10px; border-radius:6px; overflow:auto; max-height:220px;
  font-family: var(--mono); font-size:11px; background:var(--bg); border:1px solid var(--line); line-height:1.5; }
.if-diff div { padding:1px 10px; white-space:pre; }
.if-diff .add { background:rgba(55,185,133,.12); color:#6ee7b0; }
.if-diff .del { background:rgba(226,106,109,.12); color:#f2a3a5; }
.if-diff .ctx { color:var(--muted); }
.if-card-actions { display:flex; flex-direction:column; gap:8px; padding:0 12px 12px; }
.if-card-note { width:100%; padding:8px 10px; border-radius:7px; font-size:12px; resize:none; height:38px;
  background:var(--surface2); color:var(--text); border:1px solid var(--line2); outline:none; }
.if-card-note:focus { border-color:var(--accent); }
.if-card-btns { display:flex; gap:8px; }
.if-btn { flex:1; display:flex; align-items:center; justify-content:center; gap:6px; padding:9px; font-size:12px; font-weight:700;
  border:1px solid transparent; border-radius:7px; cursor:pointer; }
.if-btn.accept { background:var(--ok); color:#04120b; }
.if-btn.accept:hover { filter:brightness(1.08); }
.if-btn.reject { background:transparent; color:var(--danger); border-color:var(--line2); }
.if-btn.reject:hover { border-color:var(--danger); }
.if-btn:disabled { opacity:.5; cursor:default; }
.if-card.done .if-card-actions { display:none; }
.if-card-result { padding:8px 12px; font-size:11.5px; font-family:var(--mono); border-top:1px solid var(--line); display:none; }
.if-card.done .if-card-result { display:block; }
.if-composer { flex:none; border-top:1px solid var(--line); padding:10px; display:flex; flex-direction:column; gap:6px; background:var(--surface); position:relative; }
.if-sessions-menu { display:none; position:absolute; left:10px; right:10px; bottom:100%; margin-bottom:6px; max-height:300px;
  overflow-y:auto; background:var(--surface); border:1px solid var(--line2); border-radius:10px; box-shadow:0 -10px 34px rgba(0,0,0,.45); z-index:9; padding:6px; }
.if-sessions-menu.open { display:block; }
.if-sess-new { display:flex; align-items:center; gap:8px; width:100%; padding:8px 10px; border-radius:7px; cursor:pointer;
  background:transparent; border:0; color:var(--accent); font-weight:700; font-size:12.5px; text-align:left; font-family:inherit; }
.if-sess-new:hover { background:var(--surface2); }
.if-sess-sep { height:1px; background:var(--line); margin:6px 4px; }
.if-sess-row { display:flex; align-items:center; gap:8px; padding:7px 10px; border-radius:7px; cursor:pointer; }
.if-sess-row:hover { background:var(--surface2); }
.if-sess-row.active { background:var(--accent-soft); }
.if-sess-main { flex:1; min-width:0; }
.if-sess-title { font-size:12.5px; color:var(--text); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.if-sess-meta { font-size:10px; color:var(--muted); font-family:var(--mono); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:1px; }
.if-sess-del { flex:none; width:24px; height:24px; border:0; border-radius:6px; background:transparent; color:var(--muted); cursor:pointer;
  display:flex; align-items:center; justify-content:center; opacity:0; }
.if-sess-row:hover .if-sess-del { opacity:1; }
.if-sess-del:hover { background:var(--surface); color:var(--danger); }
.if-sess-empty { padding:12px; text-align:center; color:var(--muted); font-size:11.5px; }
.if-status { font-size:11px; min-height:14px; color:var(--muted); font-family:var(--mono); display:flex; align-items:center; gap:7px; }
.if-status .dot { width:6px; height:6px; border-radius:50%; background:var(--accent); animation:ifpulse 1s infinite; }
@keyframes ifpulse { 0%,100%{opacity:.25} 50%{opacity:1} }
.if-inputbox { display:flex; flex-direction:column; gap:6px; padding:8px 8px 7px; border:1px solid var(--line2);
  border-radius:12px; background:var(--surface2); transition:border-color .12s; }
.if-inputbox:focus-within { border-color:var(--accent); }
.if-input { width:100%; resize:none; min-height:24px; max-height:150px; padding:2px 4px; font-size:13px; line-height:1.45;
  background:transparent; color:var(--text); border:0; outline:none; }
.if-input::placeholder { color:var(--muted); }
.if-inputbar { display:flex; align-items:center; gap:6px; }
.if-toolbtn { display:flex; align-items:center; justify-content:center; width:28px; height:28px; flex:none;
  border:1px solid var(--line2); border-radius:8px; background:transparent; color:var(--muted); cursor:pointer; }
.if-toolbtn:hover { background:var(--surface); color:var(--text); }
.if-inputbar .if-mode { background:var(--surface); }
.if-inputbar .if-mode:hover { border-color:var(--accent); }
.if-send { width:30px; height:30px; flex:none; border:0; border-radius:8px; cursor:pointer; display:flex; align-items:center; justify-content:center;
  background:var(--accent); color:#fff; }
.if-send:hover { filter:brightness(1.1); } .if-send:disabled { opacity:.45; cursor:default; }
.if-hint { font-size:10px; color:var(--muted); text-align:right; font-family:var(--mono); }
.if-empty { margin:auto; text-align:center; color:var(--muted); font-size:12.5px; max-width:280px; line-height:1.65; }
.if-empty .if-logo { color:var(--accent); display:inline-flex; margin-bottom:10px; }
.if-empty b { color:var(--text); }
`;

  const MODE_LABEL = { ask: "Ask", plan: "Plan", noperms: "No-Perms" };
  const MODE_ORDER = ["ask", "plan", "noperms"];

  const LAUNCHER_CSS = `
:host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483000; }
* { box-sizing: border-box; font-family: Inter, -apple-system, system-ui, sans-serif; }
.lwrap { display:flex; align-items:center; gap:2px; padding:4px; border-radius:12px;
  background:rgba(18,20,25,.96); border:1px solid #2b3038; box-shadow:0 8px 24px rgba(0,0,0,.4);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px); }
.lgrip, .lgo { display:flex; align-items:center; justify-content:center; border:0; cursor:pointer; background:transparent; }
.lgrip { width:22px; height:30px; cursor:grab; color:#7b828e; }
.lgrip:active { cursor:grabbing; }
.lgo { width:34px; height:30px; border-radius:9px; background:#5b6cff; color:#fff; }
.lgo:hover { filter:brightness(1.1); }
.if-ico { display:block; }
`;

  function relTime(ts) {
    if (!ts) return "";
    const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m ago";
    const h = Math.floor(m / 60);
    if (h < 24) return h + "h ago";
    const d = Math.floor(h / 24);
    if (d < 7) return d + "d ago";
    return new Date(ts).toLocaleDateString();
  }

  class Panel {
    constructor() {
      this.host = null;
      this.root = null;
      this.el = {};
      this.onSendCb = null;
      this.onStopCb = null;
      this.busy = false;
    }

    mount() {
      if (this.host) return;
      const s = IF.settings.all();
      this.host = document.createElement("div");
      this.host.id = "intelliflow-host";
      this.root = this.host.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = CSS;
      this.root.appendChild(style);

      const panel = document.createElement("div");
      panel.className = "if-panel" + (s.panel.minimized ? " min" : "");
      panel.style.left = s.panel.x + "px";
      panel.style.top = s.panel.y + "px";
      panel.style.width = s.panel.w + "px";
      panel.style.height = s.panel.h + "px";
      panel.style.setProperty("--if-opacity", s.opacity);
      panel.innerHTML = this.markup(s);
      this.root.appendChild(panel);
      document.body.appendChild(this.host);

      this.panel = panel;
      this.cache();
      this.wire();
      this.renderEmpty();
    }

    markup(s) {
      return `
<div class="if-titlebar">
  <div class="if-brand"><span class="if-logo">${icon("sparkles", 17)}</span>IntelliFlow<small>for n8n</small></div>
  <div class="if-spacer"></div>
  <button class="if-iconbtn if-settings-btn" title="Settings">${icon("settings")}</button>
  <button class="if-iconbtn if-min-btn" title="Minimize">${icon("minus")}</button>
</div>
<div class="if-body">
  <div class="if-ctxbar list">${icon("list", 13)}<span class="ctx-text">Workflow list</span></div>
  <div class="if-todos"></div>
  <div class="if-settings">
    <div class="if-settings-head">
      <button class="if-iconbtn if-settings-close" title="Back">${icon("arrowLeft", 16)}</button>
      <span>Settings</span>
    </div>
    <div class="if-settings-scroll">
    <label>Provider</label>
    <select class="if-provider"></select>
    <div class="if-field-base"><label>Base URL</label>
      <input class="if-base" placeholder="https://your-endpoint/v1"></div>
    <div class="if-field-key"><label>API key</label>
      <input type="password" class="if-key" placeholder="API key"></div>
    <div class="if-keyhint"></div>
    <div class="if-field-model"><label>Model</label>
      <input class="if-model" placeholder="model id" list="if-model-list" spellcheck="false">
      <datalist id="if-model-list"></datalist></div>
    <div class="if-field-curl hide"><label>cURL command · use {{PROMPT}}</label>
      <textarea class="if-curl" spellcheck="false" placeholder='curl https://api.example.com/v1/chat -H "Authorization: Bearer KEY" -H "Content-Type: application/json" -d "{&quot;prompt&quot;:&quot;{{PROMPT}}&quot;}"'></textarea></div>
    <div class="if-row">
      <div><label>Send on</label>
        <select class="if-enter">
          <option value="auto">Auto (⌘/Ctrl+Enter)</option>
          <option value="enter">Enter</option>
          <option value="ctrl">⌘/Ctrl + Enter</option>
        </select></div>
      <div><label>Opacity</label>
        <input type="range" class="if-opacity" min="0.6" max="1" step="0.01" value="${s.opacity}"></div>
    </div>
    </div>
  </div>
  <div class="if-messages"></div>
  <div class="if-composer">
    <div class="if-sessions-menu"></div>
    <div class="if-status"></div>
    <div class="if-inputbox">
      <textarea class="if-input" rows="1" placeholder="Ask IntelliFlow to build, debug, or modify…"></textarea>
      <div class="if-inputbar">
        <button class="if-toolbtn if-sessions-btn" title="Chats">${icon("history", 15)}</button>
        <div class="if-spacer"></div>
        <button class="if-mode ${s.permissionMode}" title="Permission mode — click to change">${icon("hand", 13)}<span class="if-mode-label">${MODE_LABEL[s.permissionMode]}</span></button>
        <button class="if-send" title="Send">${icon("arrowUp", 18)}</button>
      </div>
    </div>
    <div class="if-hint"></div>
  </div>
  <div class="if-approval-host"></div>
</div>`;
    }

    cache() {
      const q = (sel) => this.panel.querySelector(sel);
      this.el = {
        titlebar: q(".if-titlebar"),
        modeChip: q(".if-mode"),
        modeLabel: q(".if-mode-label"),
        settingsBtn: q(".if-settings-btn"),
        minBtn: q(".if-min-btn"),
        settings: q(".if-settings"),
        settingsClose: q(".if-settings-close"),
        provider: q(".if-provider"),
        fieldBase: q(".if-field-base"),
        base: q(".if-base"),
        fieldKey: q(".if-field-key"),
        key: q(".if-key"),
        keyhint: q(".if-keyhint"),
        fieldModel: q(".if-field-model"),
        model: q(".if-model"),
        modelList: q(".if-model-list") || q("#if-model-list"),
        fieldCurl: q(".if-field-curl"),
        curl: q(".if-curl"),
        enter: q(".if-enter"),
        opacity: q(".if-opacity"),
        ctxbar: q(".if-ctxbar"),
        todos: q(".if-todos"),
        approvalHost: q(".if-approval-host"),
        messages: q(".if-messages"),
        status: q(".if-status"),
        input: q(".if-input"),
        sessionsBtn: q(".if-sessions-btn"),
        sessionsMenu: q(".if-sessions-menu"),
        send: q(".if-send"),
        hint: q(".if-hint"),
      };
      const s = IF.settings.all();
      // Populate providers
      const provs = (IF.AI && IF.AI.PROVIDERS) || {};
      this.el.provider.innerHTML = Object.keys(provs)
        .map((k) => `<option value="${k}">${escapeHtml(provs[k].label)}</option>`)
        .join("");
      this.el.provider.value = s.provider;
      this.el.enter.value = s.enterMode;
      this.renderProviderFields();
      this.updateHint();
    }

    renderProviderFields() {
      const provs = (IF.AI && IF.AI.PROVIDERS) || {};
      const key = this.el.provider.value;
      const meta = provs[key] || {};
      const cfg = IF.settings.providerConfig(key);
      const show = (el, on) => el.classList.toggle("hide", !on);
      // Field visibility per provider
      const isCurl = !!meta.curl;
      show(this.el.fieldCurl, isCurl);
      show(this.el.fieldKey, !isCurl);
      show(this.el.fieldModel, !isCurl);
      show(this.el.fieldBase, !isCurl && (meta.editableBaseURL || meta.custom));
      // Values
      this.el.key.value = cfg.apiKey || "";
      this.el.model.value = cfg.model || meta.defaultModel || "";
      this.el.base.value = cfg.baseURL || meta.baseURL || "";
      this.el.curl.value = cfg.curlTemplate || "";
      this.el.keyhint.textContent = meta.keyHint || "";
      // Model suggestions
      this.el.modelList.innerHTML = (meta.models || []).map((m) => `<option value="${escapeHtml(m)}">`).join("");
    }

    wire() {
      // Keep keystrokes inside the panel: n8n binds global shortcuts on document
      // (Backspace/Delete remove nodes, letters trigger canvas tools, etc.) that
      // otherwise hijack typing. Stop propagation but never preventDefault, so the
      // inputs still work normally.
      ["keydown", "keyup", "keypress"].forEach((type) =>
        this.panel.addEventListener(type, (e) => e.stopPropagation())
      );
      // Same for pointer/wheel so panning/zoom shortcuts don't fire under the panel.
      ["wheel", "mousedown", "pointerdown"].forEach((type) =>
        this.panel.addEventListener(type, (e) => e.stopPropagation())
      );

      // Drag
      let drag = null;
      this.el.titlebar.addEventListener("mousedown", (e) => {
        if (e.target.closest("button") || e.target.closest(".if-mode")) return;
        drag = { x: e.clientX - this.panel.offsetLeft, y: e.clientY - this.panel.offsetTop };
        e.preventDefault();
      });
      window.addEventListener("mousemove", (e) => {
        if (!drag) return;
        const x = Math.max(0, Math.min(window.innerWidth - 60, e.clientX - drag.x));
        const y = Math.max(0, Math.min(window.innerHeight - 30, e.clientY - drag.y));
        this.panel.style.left = x + "px";
        this.panel.style.top = y + "px";
      });
      window.addEventListener("mouseup", () => {
        if (!drag) return;
        drag = null;
        this.savePanel();
      });

      // Resize persistence
      new ResizeObserver(() => {
        if (!this.panel.classList.contains("min")) this.savePanel();
      }).observe(this.panel);

      // Titlebar buttons
      this.el.minBtn.addEventListener("click", () => this.toggleMin());
      this.el.settingsBtn.addEventListener("click", () => this.el.settings.classList.toggle("open"));
      this.el.settingsClose.addEventListener("click", () => this.el.settings.classList.remove("open"));
      this.el.modeChip.addEventListener("click", () => this.cycleMode());

      // Sessions dropdown
      this.el.sessionsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.el.sessionsMenu.classList.toggle("open");
      });
      this.panel.addEventListener("click", (e) => {
        if (!e.target.closest(".if-sessions-menu") && !e.target.closest(".if-sessions-btn")) {
          this.el.sessionsMenu.classList.remove("open");
        }
        if (!e.target.closest(".act-more") && !e.target.closest(".if-moremenu")) {
          this.el.messages.querySelectorAll(".if-actions.menu-open").forEach((a) => a.classList.remove("menu-open"));
        }
      });

      // Message hover actions (delegated).
      this.el.messages.addEventListener("click", (e) => {
        const wrapAi = e.target.closest(".if-row-ai");
        const wrapUser = e.target.closest(".if-row-user");
        if (e.target.closest(".act-copy")) {
          const w = wrapAi || wrapUser;
          if (w) { this.copyText(w._raw || ""); this.flash(e.target.closest(".act-copy")); }
        } else if (e.target.closest(".act-regen")) {
          if (wrapAi && this.regenCb) this.regenCb(this.aiOrdinal(wrapAi));
        } else if (e.target.closest(".act-edit")) {
          if (wrapUser && this.editCb) this.editCb(this.userOrdinal(wrapUser));
        } else if (e.target.closest(".act-more")) {
          e.stopPropagation();
          const row = e.target.closest(".if-actions");
          const open = row.classList.contains("menu-open");
          this.el.messages.querySelectorAll(".if-actions.menu-open").forEach((a) => a.classList.remove("menu-open"));
          if (!open) row.classList.add("menu-open");
        } else if (e.target.closest(".mm-del")) {
          if (wrapAi && this.deleteMsgCb) this.deleteMsgCb(this.aiOrdinal(wrapAi));
        }
      });

      // Provider selection
      this.el.provider.addEventListener("change", () => {
        IF.settings.set({ provider: this.el.provider.value });
        this.renderProviderFields();
      });
      // Provider-scoped config fields
      const saveProvider = () => {
        IF.settings.setProviderConfig(
          {
            apiKey: this.el.key.value.trim(),
            model: this.el.model.value.trim(),
            baseURL: this.el.base.value.trim(),
            curlTemplate: this.el.curl.value,
          },
          this.el.provider.value
        );
      };
      this.el.key.addEventListener("blur", saveProvider);
      this.el.base.addEventListener("blur", saveProvider);
      this.el.model.addEventListener("change", saveProvider);
      this.el.curl.addEventListener("blur", saveProvider);

      // Top-level prefs
      this.el.enter.addEventListener("change", () => {
        IF.settings.set({ enterMode: this.el.enter.value });
        this.updateHint();
      });
      this.el.opacity.addEventListener("input", () => this.panel.style.setProperty("--if-opacity", this.el.opacity.value));
      this.el.opacity.addEventListener("change", () => IF.settings.set({ opacity: parseFloat(this.el.opacity.value) }));

      // Composer
      this.el.send.addEventListener("click", () => this.handleSend());
      this.el.input.addEventListener("input", () => this.autoGrow());
      this.el.input.addEventListener("keydown", (e) => this.onKey(e));
    }

    autoGrow() {
      const t = this.el.input;
      t.style.height = "auto";
      t.style.height = Math.min(150, t.scrollHeight) + "px";
    }

    updateHint() {
      const mode = IF.settings.get("enterMode");
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const cmd = isMac ? "⌘" : "Ctrl";
      this.el.hint.textContent =
        mode === "enter" ? "Enter to send · Shift+Enter for newline" : `${cmd}+Enter to send`;
    }

    onKey(e) {
      const mode = IF.settings.get("enterMode");
      const isMac = navigator.platform.toUpperCase().includes("MAC");
      const chord = isMac ? e.metaKey : e.ctrlKey;
      if (e.key !== "Enter") return;
      if (mode === "enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      } else if (mode === "ctrl" && chord) {
        e.preventDefault();
        this.handleSend();
      } else if (mode === "auto" && chord) {
        e.preventDefault();
        this.handleSend();
      }
    }

    handleSend() {
      if (this.busy) {
        if (this.onStopCb) this.onStopCb();
        return;
      }
      const text = this.el.input.value.trim();
      if (!text) return;
      this.el.input.value = "";
      this.autoGrow();
      if (this.onSendCb) this.onSendCb(text);
    }

    onSend(cb) { this.onSendCb = cb; }
    onStop(cb) { this.onStopCb = cb; }
    onNewChat(cb) { this.newChatCb = cb; }
    onSelectSession(cb) { this.selectSessionCb = cb; }
    onDeleteSession(cb) { this.deleteSessionCb = cb; }
    onRegenerate(cb) { this.regenCb = cb; }
    onEditMessage(cb) { this.editCb = cb; }
    onDeleteMessage(cb) { this.deleteMsgCb = cb; }

    aiOrdinal(wrap) {
      return Array.from(this.el.messages.querySelectorAll(".if-row-ai")).indexOf(wrap);
    }
    userOrdinal(wrap) {
      return Array.from(this.el.messages.querySelectorAll(".if-row-user")).indexOf(wrap);
    }
    copyText(t) {
      try {
        navigator.clipboard.writeText(t || "");
      } catch {
        const ta = document.createElement("textarea");
        ta.value = t || "";
        this.root.appendChild(ta);
        ta.select();
        try { document.execCommand("copy"); } catch { /* ignore */ }
        ta.remove();
      }
    }
    flash(btn) {
      if (!btn) return;
      const old = btn.innerHTML;
      btn.innerHTML = IF.Icons.icon("check2", 13);
      setTimeout(() => (btn.innerHTML = old), 900);
    }

    renderSessions(list, activeId) {
      const menu = this.el && this.el.sessionsMenu;
      if (!menu) return;
      const rows = (list || [])
        .map((s) => {
          const active = s.id === activeId ? " active" : "";
          return (
            `<div class="if-sess-row${active}" data-id="${s.id}">` +
            `<div class="if-sess-main"><div class="if-sess-title">${escapeHtml(s.title || "New chat")}</div>` +
            `<div class="if-sess-meta">${escapeHtml(s.scopeLabel || "")} · ${relTime(s.updatedAt)}</div></div>` +
            `<button class="if-sess-del" data-del="${s.id}" title="Delete">${icon("trash", 13)}</button></div>`
          );
        })
        .join("");
      menu.innerHTML =
        `<button class="if-sess-new">${icon("plus", 15)}<span>New chat</span></button>` +
        `<div class="if-sess-sep"></div>` +
        (rows || `<div class="if-sess-empty">No previous chats yet.</div>`);
      menu.querySelector(".if-sess-new").addEventListener("click", () => {
        menu.classList.remove("open");
        this.newChatCb && this.newChatCb();
      });
      menu.querySelectorAll(".if-sess-row").forEach((row) => {
        row.addEventListener("click", (e) => {
          if (e.target.closest(".if-sess-del")) return;
          menu.classList.remove("open");
          this.selectSessionCb && this.selectSessionCb(row.dataset.id);
        });
      });
      menu.querySelectorAll(".if-sess-del").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.deleteSessionCb && this.deleteSessionCb(btn.dataset.del);
        });
      });
    }

    // Small floating launcher shown on pages that mention n8n.
    mountLauncher(onClick) {
      if (this.launcherHost) return;
      const host = document.createElement("div");
      host.id = "intelliflow-launcher";
      const root = host.attachShadow({ mode: "open" });
      root.innerHTML =
        `<style>${LAUNCHER_CSS}</style>` +
        `<div class="lwrap"><button class="lgrip" title="Drag to move">${icon("move", 14)}</button>` +
        `<button class="lgo" title="Open IntelliFlow">${icon("sparkles", 18)}</button></div>`;
      (document.body || document.documentElement).appendChild(host);
      this.launcherHost = host;
      const wrap = root.querySelector(".lwrap");
      try {
        chrome.storage.local.get("intelliflow_launcher").then((r) => {
          const p = r && r.intelliflow_launcher;
          if (p && typeof p.x === "number") {
            host.style.left = p.x + "px";
            host.style.top = p.y + "px";
            host.style.right = "auto";
            host.style.bottom = "auto";
          }
        });
      } catch {
        /* ignore */
      }
      let d = null;
      root.querySelector(".lgrip").addEventListener("mousedown", (e) => {
        const r = host.getBoundingClientRect();
        d = { dx: e.clientX - r.left, dy: e.clientY - r.top };
        e.preventDefault();
        e.stopPropagation();
      });
      window.addEventListener("mousemove", (e) => {
        if (!d) return;
        const x = Math.max(4, Math.min(window.innerWidth - 56, e.clientX - d.dx));
        const y = Math.max(4, Math.min(window.innerHeight - 40, e.clientY - d.dy));
        host.style.left = x + "px";
        host.style.top = y + "px";
        host.style.right = "auto";
        host.style.bottom = "auto";
      });
      window.addEventListener("mouseup", () => {
        if (!d) return;
        d = null;
        const r = host.getBoundingClientRect();
        try {
          chrome.storage.local.set({ intelliflow_launcher: { x: r.left, y: r.top } });
        } catch {
          /* ignore */
        }
      });
      root.querySelector(".lgo").addEventListener("click", () => onClick && onClick());
      ["keydown", "keyup", "keypress", "wheel"].forEach((t) => wrap.addEventListener(t, (e) => e.stopPropagation()));
    }

    setBusy(b, statusText) {
      this.busy = b;
      this.el.send.innerHTML = b ? icon("stop", 16) : icon("arrowUp", 18);
      this.el.send.title = b ? "Stop" : "Send";
      if (b) this.setStatus(statusText || "Thinking…", true);
      else this.setStatus("");
    }

    setStatus(text, spin) {
      this.el.status.innerHTML = text ? (spin ? '<span class="dot"></span>' : "") + escapeHtml(text) : "";
    }

    // ---- context ------------------------------------------------------
    setContext(ctx) {
      this._ctx = ctx || { inEditor: false };
      const bar = this.el.ctxbar;
      if (!bar) return;
      if (this._ctx.inEditor) {
        // In a workflow the scope bar is just noise — hide it entirely.
        bar.style.display = "none";
      } else {
        bar.style.display = "flex";
        bar.className = "if-ctxbar list";
        bar.innerHTML = `${icon("list", 13)}<span class="ctx-text">Workflow list — create or search only</span><span class="tag">no edits</span>`;
      }
    }

    clearMessages(ctx) {
      if (ctx) this._ctx = ctx;
      this.el.messages.innerHTML = "";
      this._aiBody = null;
      this._aiWrap = null;
      this._aiRaw = "";
      this.renderEmpty();
    }

    // ---- messages -----------------------------------------------------
    renderEmpty() {
      if (this.el.messages.children.length) return;
      const div = document.createElement("div");
      div.className = "if-empty";
      const inEditor = this._ctx && this._ctx.inEditor;
      div.innerHTML =
        `<div class="if-logo">${icon("sparkles", 28)}</div>` +
        (inEditor
          ? "I build and debug this workflow in <b>IF-Lang</b>, grounded in the nodes installed on <b>this</b> server.<br><br>" +
            "Try: “add a Schedule Trigger that hits an API every hour and posts failures to Slack”."
          : "You're on the <b>workflow list</b>. I can <b>create a new workflow</b> or <b>find one by name</b> — I won't edit existing workflows from here.<br><br>" +
            "Try: “create a workflow that syncs new Stripe charges to a Google Sheet” or “find my Slack workflow”.");
      this.el.messages.appendChild(div);
    }
    clearEmpty() {
      const e = this.el.messages.querySelector(".if-empty");
      if (e) e.remove();
    }
    scroll() { this.el.messages.scrollTop = this.el.messages.scrollHeight; }

    addUser(text) {
      this.clearEmpty();
      const wrap = document.createElement("div");
      wrap.className = "if-row if-row-user";
      const d = document.createElement("div");
      d.className = "if-msg user";
      d.textContent = text;
      wrap.appendChild(d);
      wrap._raw = text;
      wrap.appendChild(this.userActions());
      this.el.messages.appendChild(wrap);
      this.scroll();
    }

    userActions() {
      const row = document.createElement("div");
      row.className = "if-actions";
      row.innerHTML =
        `<button class="if-actbtn act-edit" title="Edit">${icon("edit", 13)}</button>` +
        `<button class="if-actbtn act-copy" title="Copy">${icon("copy", 13)}</button>`;
      return row;
    }
    aiActions() {
      const row = document.createElement("div");
      row.className = "if-actions";
      row.innerHTML =
        `<button class="if-actbtn act-copy" title="Copy">${icon("copy", 13)}</button>` +
        `<button class="if-actbtn act-regen" title="Regenerate">${icon("refresh", 13)}</button>` +
        `<button class="if-actbtn act-more" title="More">${icon("more", 13)}</button>` +
        `<div class="if-moremenu"><button class="mm-del">${icon("trash", 13)}<span>Delete</span></button></div>`;
      return row;
    }

    startAi() {
      this.clearEmpty();
      const wrap = document.createElement("div");
      wrap.className = "if-row if-row-ai";
      const d = document.createElement("div");
      d.className = "if-msg ai if-genai";
      d.innerHTML = `<div class="if-ai-head"><span class="if-logo">${icon("sparkles", 12)}</span>IntelliFlow</div><div class="if-ai-body"></div>`;
      wrap.appendChild(d);
      this.el.messages.appendChild(wrap);
      this._aiWrap = wrap;
      this._aiBody = d.querySelector(".if-ai-body");
      this._aiRaw = "";
      this.scroll();
      return d;
    }
    appendAi(delta) {
      if (!this._aiBody) this.startAi();
      this._aiRaw += delta;
      this._aiBody.innerHTML = renderMarkdown(this._aiRaw);
      this.scroll();
    }
    endAi() {
      if (this._aiWrap) {
        if (!this._aiRaw.trim()) {
          this._aiWrap.remove(); // turn was only tool calls / empty
        } else {
          this._aiWrap._raw = this._aiRaw;
          this._aiWrap.appendChild(this.aiActions());
        }
      }
      this._aiWrap = null;
      this._aiBody = null;
      this._aiRaw = "";
    }

    setInput(text) {
      this.el.input.value = text;
      this.autoGrow();
      this.el.input.focus();
    }

    addToolBadge(name, args) {
      this.clearEmpty();
      let wrap = this.el.messages.lastElementChild;
      if (!wrap || !wrap.classList.contains("if-tools")) {
        wrap = document.createElement("div");
        wrap.className = "if-tools";
        this.el.messages.appendChild(wrap);
      }
      const chip = document.createElement("div");
      chip.className = "if-tool";
      chip.innerHTML = icon(toolIcon(name), 12) + "<span>" + escapeHtml(prettyTool(name, args)) + "</span>";
      wrap.appendChild(chip);
      this.scroll();
    }

    addScreenshot(dataUrl) {
      const wrap = document.createElement("div");
      wrap.className = "if-shots";
      const img = document.createElement("img");
      img.className = "if-shot";
      img.src = dataUrl;
      img.addEventListener("click", () => window.open(dataUrl, "_blank"));
      wrap.appendChild(img);
      this.el.messages.appendChild(wrap);
      this.scroll();
    }

    // Approval card used by Ask / Plan modes. Resolves with {approved, note}.
    // Rendered in a dedicated overlay (NOT the message list, which gets cleared
    // on re-renders) so a pending approval can never be silently wiped.
    requestApproval({ title, summary, iflang, diff, mode }) {
      this.cancelApprovals();
      return new Promise((resolve) => {
        const host = this.el.approvalHost;
        const card = document.createElement("div");
        card.className = "if-card";
        card.innerHTML = `
<div class="if-card-head">${icon(mode === "plan" ? "listTodo" : "shield", 14)} ${escapeHtml(title || "Apply changes?")}</div>
<div class="if-card-sum">${summary ? escapeHtml(summary) : ""}</div>
<div class="if-diff">${renderDiff(diff)}</div>
<div class="if-card-actions">
  <textarea class="if-card-note" placeholder="Optional note to send with your decision…"></textarea>
  <div class="if-card-btns">
    <button class="if-btn accept">${icon("check", 14)} Accept</button>
    <button class="if-btn reject">${icon("x", 14)} Reject</button>
  </div>
</div>`;
        host.innerHTML = "";
        host.appendChild(card);
        host.classList.add("active");
        const note = card.querySelector(".if-card-note");
        let settled = false;
        const finish = (approved, cancelled) => {
          if (settled) return;
          settled = true;
          this._pendingApproval = null;
          host.classList.remove("active");
          host.innerHTML = "";
          resolve({ approved, cancelled: !!cancelled, note: note ? note.value.trim() : "" });
        };
        this._pendingApproval = finish;
        card.querySelector(".accept").addEventListener("click", () => finish(true));
        card.querySelector(".reject").addEventListener("click", () => finish(false));
        if (note) note.focus();
      });
    }

    renderTodos(list) {
      const el = this.el && this.el.todos;
      if (!el) return;
      if (!list || !list.length) {
        el.classList.remove("show");
        el.innerHTML = "";
        return;
      }
      const done = list.filter((t) => t.done).length;
      el.classList.add("show");
      el.innerHTML =
        `<div class="if-todo-head">${icon("listTodo", 13)} Tasks <span>${done}/${list.length}</span></div>` +
        list
          .map(
            (t) =>
              `<div class="if-todo-item${t.done ? " done" : ""}">${
                t.done ? icon("check2", 13) : '<span class="if-todo-box"></span>'
              }<span>${escapeHtml(t.text)}</span></div>`
          )
          .join("");
    }

    // A single/multiple choice question, rendered inline after the reply. On
    // answer, onAnswer(text) is called (the answer is sent as the next message).
    askQuestion({ question, options, multiple }, onAnswer) {
      this.clearEmpty();
      const wrap = document.createElement("div");
      wrap.className = "if-row if-row-ai";
      const card = document.createElement("div");
      card.className = "if-qcard";
      const opts = (options || [])
        .map((o) =>
          multiple
            ? `<label class="if-qopt"><input type="checkbox" value="${escapeAttr(o)}"><span>${escapeHtml(o)}</span></label>`
            : `<button class="if-qbtn" data-val="${escapeAttr(o)}">${escapeHtml(o)}</button>`
        )
        .join("");
      card.innerHTML =
        `<div class="if-qhead">${icon("hand", 13)} ${escapeHtml(question)}</div>` +
        `<div class="if-qopts${multiple ? " multi" : ""}">${opts}</div>` +
        `<div class="if-qother"><input class="if-qtext" placeholder="Other — type your own answer…"><button class="if-qsend" title="Send">${icon("arrowUp", 15)}</button></div>`;
      wrap.appendChild(card);
      this.el.messages.appendChild(wrap);
      this.scroll();

      let answered = false;
      const textIn = card.querySelector(".if-qtext");
      const answer = (text) => {
        if (answered || !text) return;
        answered = true;
        card.classList.add("done");
        card.querySelectorAll("button, input").forEach((e) => (e.disabled = true));
        onAnswer(text);
      };
      card.querySelectorAll(".if-qbtn").forEach((b) => b.addEventListener("click", () => answer(b.dataset.val)));
      const submit = () => {
        if (multiple) {
          const sel = [...card.querySelectorAll("input[type=checkbox]:checked")].map((c) => c.value);
          const t = textIn.value.trim();
          if (t) sel.push(t);
          if (sel.length) answer(sel.join(", "));
        } else {
          answer(textIn.value.trim());
        }
      };
      card.querySelector(".if-qsend").addEventListener("click", submit);
      textIn.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          submit();
        }
      });
    }

    // Resolve any pending approval as cancelled (used by the Stop button and on
    // context/session switches) so the chat loop never hangs waiting on it.
    cancelApprovals() {
      if (this._pendingApproval) {
        const f = this._pendingApproval;
        this._pendingApproval = null;
        this.el.approvalHost.classList.remove("active");
        this.el.approvalHost.innerHTML = "";
        f(false, true);
      }
    }

    notify(text, kind) {
      this.clearEmpty();
      const d = document.createElement("div");
      d.className = "if-msg ai";
      d.innerHTML =
        `<div class="if-ai-body" style="opacity:.85">${
          kind === "error" ? `<span style="color:#fca5a5">${icon("x", 12)} </span>` : ""
        }${renderMarkdown(text)}</div>`;
      this.el.messages.appendChild(d);
      this.scroll();
    }

    // ---- window state -------------------------------------------------
    toggleMin() {
      const min = this.panel.classList.toggle("min");
      IF.settings.set({ panel: Object.assign({}, IF.settings.get("panel"), { minimized: min }) });
    }
    toggle() {
      if (!this.host) { this.mount(); return; }
      this.host.style.display = this.host.style.display === "none" ? "" : "none";
    }
    show() { if (this.host) this.host.style.display = ""; }

    cycleMode() {
      const cur = IF.settings.get("permissionMode");
      const nextMode = MODE_ORDER[(MODE_ORDER.indexOf(cur) + 1) % MODE_ORDER.length];
      IF.settings.set({ permissionMode: nextMode });
      this.reflectMode(nextMode);
    }
    reflectMode(mode) {
      if (!this.el.modeChip) return;
      this.el.modeChip.className = "if-mode " + mode;
      this.el.modeLabel.textContent = MODE_LABEL[mode];
      const ic = { ask: "hand", plan: "listTodo", noperms: "zap" }[mode] || "hand";
      const label = this.el.modeLabel.textContent;
      this.el.modeChip.innerHTML = IF.Icons.icon(ic, 13) + `<span class="if-mode-label">${label}</span>`;
      this.el.modeLabel = this.el.modeChip.querySelector(".if-mode-label");
    }

    savePanel() {
      const p = {
        x: this.panel.offsetLeft,
        y: this.panel.offsetTop,
        w: this.panel.offsetWidth,
        h: this.panel.offsetHeight,
        minimized: this.panel.classList.contains("min"),
      };
      IF.settings.set({ panel: p });
    }
  }

  // ---- helpers --------------------------------------------------------
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function renderMarkdown(src) {
    // Minimal, safe markdown: code fences, inline code, bold, links, line breaks.
    const parts = [];
    let i = 0;
    const re = /```(\w*)\n?([\s\S]*?)```/g;
    let m;
    let last = 0;
    while ((m = re.exec(src))) {
      parts.push({ t: "text", v: src.slice(last, m.index) });
      parts.push({ t: "code", v: m[2] });
      last = re.lastIndex;
    }
    parts.push({ t: "text", v: src.slice(last) });
    return parts
      .map((p) => {
        if (p.t === "code") return `<pre><code>${escapeHtml(p.v.replace(/\n$/, ""))}</code></pre>`;
        let h = escapeHtml(p.v);
        h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
        h = h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
        h = h.replace(/\n/g, "<br>");
        return h;
      })
      .join("");
  }

  function renderDiff(diff) {
    if (!diff || !diff.length) return '<div class="ctx">No structural changes.</div>';
    return diff
      .map((l) => {
        const cls = l.type === "add" ? "add" : l.type === "del" ? "del" : "ctx";
        const sign = l.type === "add" ? "+" : l.type === "del" ? "-" : " ";
        return `<div class="${cls}">${escapeHtml(sign + " " + l.text)}</div>`;
      })
      .join("");
  }

  function prettyTool(name, args) {
    if (name === "search_nodes") return `search “${(args && args.query) || ""}”`;
    if (name === "get_node_schema") return `schema: ${(args && args.node) || ""}`;
    if (name === "get_workflow") return "read workflow";
    if (name === "get_execution_data") return "read execution";
    if (name === "apply_iflang") return "apply workflow";
    if (name === "run_workflow") return "run workflow";
    if (name === "capture_canvas") return "screenshot";
    return name;
  }
  function toolIcon(name) {
    return (
      {
        search_nodes: "wrench",
        get_node_schema: "fileCode",
        get_workflow: "fileCode",
        get_execution_data: "play",
        apply_iflang: "check",
        run_workflow: "play",
        capture_canvas: "camera",
      }[name] || "wrench"
    );
  }

  IF.UI = new Panel();
  IF.util = { renderMarkdown, escapeHtml, renderDiff };
})();
