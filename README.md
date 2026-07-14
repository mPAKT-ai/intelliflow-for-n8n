# IntelliFlow for n8n

![Manifest V3](https://img.shields.io/badge/Chrome-MV3-5b6cff)
![No build step](https://img.shields.io/badge/build-none%20(vanilla%20JS)-37b985)
![License: MIT](https://img.shields.io/badge/license-MIT-blue)

An AI copilot that lives **inside** the n8n editor and helps you build, debug and
refactor advanced workflows. Click the toolbar icon and a draggable, translucent
panel is injected into the page.

> Works with any n8n instance (self-hosted or cloud) and any major LLM provider —
> including a **local Ollama over plain HTTP**. Your API keys and credential secrets
> never leave the browser.

Instead of hand-writing n8n's verbose JSON, IntelliFlow uses **IF-Lang** — a small,
readable "pipeline" language that is compiled to/from real n8n workflows. IF-Lang is
**dynamic**: every node name, version and parameter is resolved at runtime against the
node catalog of *your* running n8n instance, so it automatically supports whatever
nodes you have installed (including community nodes) and stays correct as nodes are
updated over time.

It works with **any** major LLM provider, reads your workflow as **text first**, and
only falls back to a screenshot when text genuinely can't answer.

### Providers

Pick one in settings; each keeps its own key/model:

| Provider | Streaming | Tool-calling | Notes |
|----------|-----------|--------------|-------|
| Google Gemini | ✅ | ✅ | Free tier — key from aistudio.google.com |
| OpenAI | ✅ | ✅ | |
| Anthropic | ✅ | ✅ | Direct browser access header set for you |
| OpenRouter | ✅ | ✅ | Any model on OpenRouter |
| Ollama (local) | ✅ | ✅* | Local models, no key; *tools depend on the model |
| Custom (OpenAI-compatible) | ✅ | ✅ | **Your own** base URL / key format / model — does **not** require OpenAI's servers |
| Custom (cURL) | ❌ | via text | Paste any cURL command with `{{PROMPT}}`; no token streaming |

For non-tool providers (cURL), IntelliFlow uses a text protocol: the model returns the
workflow inside a ```` ```iflang ```` block and IntelliFlow applies it through the same
permission gate.

All provider requests are proxied through the extension's background worker (streamed
over a port), so they work **regardless of scheme or origin** — a local **Ollama over
plain `http://`** reaches you fine even though the n8n page is HTTPS (no mixed-content or
CORS blocking).

---

## What it does

- 💬 **Chat copilot** with real token streaming (no fake typing).
- 🧩 **IF-Lang** — describe workflows like:
  ```
  workflow "Lead sync" {
    trigger Webhook@2 as hook { path: "/lead" }
    hook -> HTTP.Request@4.4 as fetch {
      method: GET
      url: "https://api.example.com/{{ $json.id }}"
    }
    fetch -> IF as gate { $json.status == "ok" }
    gate.true  -> Slack.message@2 as notify { channel: "#leads" }
    gate.false -> NoOp as skip
  }
  ```
- 🔌 **Real n8n integration** (not blind clicking): it reads the live workflow and the
  full catalog of installed node types straight from n8n's own Vue/Pinia state and
  VueFlow canvas, and writes changes through n8n's authenticated API.
- 🛠️ **Tool-using AI**: `search_nodes`, `get_node_schema`, `get_workflow`,
  `get_execution_data`, `search_credentials`, `apply_iflang`, `run_workflow`,
  `create_workflow`, `search_workflows`, and (last resort) `capture_canvas`.
- 🔑 **Credential-aware, secret-safe**: `search_credentials` exposes only
  **non-sensitive metadata** (id, name, type) so the model can wire nodes to existing
  credentials and run unattended — **no API keys or secrets are ever sent** to Gemini,
  OpenAI, Anthropic, or anyone. Attach one in IF-Lang with
  `credentials: { httpHeaderAuth: { id: "…", name: "…" } }`.
- 🔎 **Works on any n8n server**: IntelliFlow identifies n8n by **page contents**
  (its Vue/Pinia app), not by URL, and badges the toolbar icon when detected. Click the
  icon to open the panel on any page (force-inject).
- 🔐 **Permission modes** (like Claude Code), switch from the title bar:
  - **Ask** (default, safest) — every edit shows a summary, a diff and the full
    IF-Lang, and waits for **Accept / Reject**. You can attach a note to your decision.
  - **Plan** — the model first posts a numbered plan and double-checks node
    names/versions, then still asks before writing.
  - **No-Perms** (dangerous) — applies changes immediately (an undo snapshot is still
    taken).
- 🔒 **Workflow-scoped sessions.** The assistant is locked to whatever you have open:
  each workflow has its own conversation, switching workflows switches the session, and
  edits can only ever land on the workflow you're actually in. On the **workflow list**
  it can *create a new workflow* or *search existing ones by name* — but it will not open
  or edit existing workflows. The panel's context bar always shows the current scope.
- 🕘 **Persisted chat history.** Every conversation is saved and browsable from the
  history dropdown (the clock button in the composer) — pick any past session to
  continue it, start a **+ New Chat**, or delete one. Survives reloads and restarts.
- 🧭 **Autonomous Plan mode.** In Plan mode the assistant self-corrects tool/compile/apply
  errors and pushes a task through to completion without stopping to ask you to continue.
  It also never stalls silently after a tool call — if it stops without a written reply,
  it's automatically nudged to explain the result.
- ✋ **Message actions on hover.** Hover any message: assistant replies get **copy**,
  **regenerate**, and a **⋯ more** menu (delete); your messages get **edit** and **copy**.
  No share button — privacy first.
- ⚙️ **Settings in their own menu** (gear opens a full settings screen) and a **floating
  launcher**: on any page that mentions "n8n", a small draggable button appears
  (bottom-right, move handle on the left) to inject the panel with one click.
- 🪟 Draggable, resizable, **minimize-to-titlebar**, translucent, adjustable opacity.
- 🖼️ Screenshot previews capped at 64×32, captured only when the AI asks for one.
- ⌨️ Send on **Enter**, **⌘/Ctrl+Enter**, or **Auto** — your choice.
- 🎨 Icons are inline **Lucide** SVGs (MIT, no external requests / no tracking).

---

## Install (load unpacked)

1. Open **`chrome://extensions`** in Chrome.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select this folder
   (`IntelliFlow for n8n`).
4. Pin the IntelliFlow icon if you like.

It runs on any site and **detects n8n by page content** (its Vue/Pinia app), so it works
on any self-hosted or cloud n8n without configuration. The toolbar icon shows a dot when
an n8n instance is detected; click it to open the panel (it force-injects on any page).

## Setup

1. Open your n8n editor and click the **IntelliFlow** toolbar icon to open the panel.
2. Click the **gear** → choose a **Provider** → fill in its key / base URL / model
   (only the fields that provider needs are shown) → pick a permission mode.
   - Gemini (free): get a key at **https://aistudio.google.com/apikey**.
   - Ollama: no key; runs against `http://localhost:11434` by default.
   - Custom (OpenAI-compatible): set your own base URL, key and model.
   - Custom (cURL): paste a cURL command and put `{{PROMPT}}` where the message goes.

> The manifest requests broad host permissions (`http(s)://*`) so custom / local
> endpoints work out of the box. It's an unpacked personal tool; tighten
> `host_permissions` in `manifest.json` if you prefer.

## Use

- Open any workflow and ask, e.g.
  *"Add a Schedule Trigger that calls this API hourly and posts failures to Slack."*
- In **Ask/Plan** mode you'll get a diff to Accept/Reject before anything is written.
- After an accepted change the page reloads so the canvas shows the saved result; your
  chat is preserved.

---

## How it works (architecture)

| Layer | File | World | Responsibility |
|------|------|-------|----------------|
| Toolbar / screenshots | `src/background.js` | SW | Toggle panel, `captureVisibleTab` |
| n8n bridge | `src/bridge/bridge.js` | **MAIN** | Pinia/VueFlow/catalog access, read & write workflow, undo |
| RPC + settings | `src/core/protocol.js` | ISOLATED | `postMessage` RPC, `chrome.storage`, session restore |
| IF-Lang | `src/lang/iflang.js` | ISOLATED | Compile/decompile, dynamic node/version/param resolution, auto-layout |
| Gemini | `src/ai/gemini.js` | ISOLATED | SSE streaming + function-calling loop |
| Icons | `src/content/icons.js` | ISOLATED | Inline Lucide SVGs |
| Panel UI | `src/content/ui.js` | ISOLATED | Shadow-DOM window, chat, diffs, approval cards |
| Orchestrator | `src/content/content.js` | ISOLATED | Tool handlers, permission gate, diffing |

The MAIN-world bridge is what makes this reliable: the isolated UI can't see the page's
`window`, so `bridge.js` runs in the page context, reaches n8n's real state, and talks
to the UI over a namespaced `postMessage` protocol.

## Notes & limitations

- Reads prefer n8n's live **workflow document store** (reflects unsaved edits), then the
  REST API, then the VueFlow graph, then a screenshot — in that order.
- Applying a change edits the workflow **in place** through n8n's document store
  (`setNodes` / `setConnections`), so the canvas updates live with **no page reload**.
  This keeps the assistant connected mid-conversation so it can immediately verify its
  own change with `get_workflow`. Saving to the backend is best-effort and non-blocking.
- Requires an n8n build that exposes a Vue app on `#app` (current n8n does). Detected by
  page content, so it works on any self-hosted or cloud n8n instance.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). There's no build step — edit `src/`, reload the
unpacked extension, done.

## Credits

Icons from [Lucide](https://lucide.dev) (ISC/MIT). Built as a proper Chrome MV3
extension, evolved from an earlier Tampermonkey prototype.

## License

[MIT](LICENSE) © IntelliFlow for n8n contributors.
