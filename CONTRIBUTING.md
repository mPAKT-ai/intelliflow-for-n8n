# Contributing

Thanks for your interest in IntelliFlow for n8n!

## Development setup

There is **no build step** — it's plain MV3 + vanilla JS.

1. `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select the repo folder.
3. Edit files under `src/`, then hit the **reload** ↻ button on the extension card to pick up changes.
4. Open an n8n workflow, click the toolbar icon, and test.

Turn on the DevTools console to see the built-in trace logs (`[IntelliFlow] …` and
`[IntelliFlow/bridge] …`) for timing and tool calls.

## Project layout

| Area | File | World |
|------|------|-------|
| Toolbar / screenshots / request proxy | `src/background.js` | service worker |
| n8n bridge (Pinia/VueFlow, read/apply, issues) | `src/bridge/bridge.js` | MAIN |
| RPC + settings + sessions + logging | `src/core/protocol.js` | ISOLATED |
| IF-Lang compiler / decompiler | `src/lang/iflang.js` | ISOLATED |
| Multi-provider AI + tools | `src/ai/providers.js` | ISOLATED |
| Icons (inline Lucide) | `src/content/icons.js` | ISOLATED |
| Panel UI | `src/content/ui.js` | ISOLATED |
| Orchestrator (tool handlers, permission gate) | `src/content/content.js` | ISOLATED |

## Guidelines

- Keep the code dependency-free and readable — no bundler, no minification.
- The content script shares the n8n page's origin; make network requests through the
  background proxy (`proxyFetch`), never a direct `fetch`, so HTTP/CORS endpoints work.
- Never hard-code a specific n8n host or any secret. n8n is detected by page content.
- IF-Lang changes: keep compile ⇄ decompile round-tripping.

## Reporting issues

Please include your n8n version, the provider/model used, and any `[IntelliFlow]` console
output. Never paste API keys or credential values.
