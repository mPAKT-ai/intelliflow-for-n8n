// IntelliFlow for n8n — multi-provider AI layer.
//
// A single agentic tool-calling loop over a provider-neutral message format.
// Adapters translate that neutral format to/from each provider's wire format
// and normalise streaming. Supported: Google Gemini, OpenAI, Anthropic,
// OpenRouter, Ollama, a Custom OpenAI-compatible endpoint (any base URL / key /
// model — does NOT require OpenAI's servers), and Custom cURL (no streaming; a
// text "apply-block" protocol replaces native tool calls).
//
// Neutral message shape:
//   { role: 'user'|'assistant'|'tool', content: [ part, ... ] }
//   part: { type:'text', text }
//       | { type:'tool_call', id, name, args }        (assistant)
//       | { type:'tool_result', id, name, response }  (tool)
//       | { type:'image', mime, data }                (user or tool)

(function () {
  "use strict";
  const IF = (window.IF = window.IF || {});

  // ---- Provider registry -------------------------------------------------

  const PROVIDERS = {
    gemini: {
      label: "Google Gemini",
      kind: "gemini",
      baseURL: "https://generativelanguage.googleapis.com/v1beta",
      defaultModel: "gemini-2.5-flash",
      models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
      needsKey: true,
      keyHint: "AI Studio API key — aistudio.google.com/apikey",
    },
    openai: {
      label: "OpenAI",
      kind: "openai",
      baseURL: "https://api.openai.com/v1",
      defaultModel: "gpt-4o",
      models: ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "o4-mini"],
      needsKey: true,
      keyHint: "OpenAI API key — platform.openai.com",
    },
    anthropic: {
      label: "Anthropic",
      kind: "anthropic",
      baseURL: "https://api.anthropic.com",
      defaultModel: "claude-sonnet-4-5",
      models: ["claude-sonnet-4-5", "claude-opus-4-1", "claude-3-5-haiku-latest"],
      needsKey: true,
      keyHint: "Anthropic API key — console.anthropic.com",
    },
    openrouter: {
      label: "OpenRouter",
      kind: "openai",
      baseURL: "https://openrouter.ai/api/v1",
      defaultModel: "anthropic/claude-3.7-sonnet",
      models: ["anthropic/claude-3.7-sonnet", "openai/gpt-4o", "google/gemini-2.5-flash", "meta-llama/llama-3.3-70b-instruct"],
      needsKey: true,
      keyHint: "OpenRouter API key — openrouter.ai/keys",
    },
    ollama: {
      label: "Ollama (local)",
      kind: "openai",
      baseURL: "http://localhost:11434/v1",
      defaultModel: "llama3.1",
      models: ["llama3.1", "qwen2.5", "mistral-nemo"],
      needsKey: false,
      editableBaseURL: true,
      keyHint: "No key needed for local Ollama",
    },
    customOpenai: {
      label: "Custom (OpenAI-compatible)",
      kind: "openai",
      baseURL: "",
      defaultModel: "",
      needsKey: false,
      editableBaseURL: true,
      custom: true,
      keyHint: "Any OpenAI-compatible server — your own base URL / key / model",
    },
    curl: {
      label: "Custom (cURL — no streaming)",
      kind: "curl",
      textMode: true,
      curl: true,
      keyHint: "Paste a cURL command; use {{PROMPT}} where the message goes",
    },
  };

  // ---- Tool declarations (neutral: {name, description, parameters}) -------

  const TOOLS = {};
  [
    { name: "search_nodes", description: "Search this n8n instance's installed node catalog by keyword. Returns node names, display names and versions. Use before writing IF-Lang.", parameters: { type: "object", properties: { query: { type: "string", description: "Keywords, e.g. 'slack', 'http', 'postgres'." } }, required: ["query"] } },
    { name: "get_node_schema", description: "Get exact parameters (names, types, options, required) for a node type at a version. Use before setting parameters.", parameters: { type: "object", properties: { node: { type: "string" }, version: { type: "number" } }, required: ["node"] } },
    { name: "get_workflow", description: "Read the open workflow as IF-Lang plus a summary.", parameters: { type: "object", properties: {} } },
    { name: "get_execution_data", description: "Metadata about the most recent successful execution, for debugging.", parameters: { type: "object", properties: {} } },
    { name: "apply_iflang", description: "Compile IF-Lang and apply it to the open workflow (replaces its full contents; must be non-empty). Respects the user's permission mode.", parameters: { type: "object", properties: { iflang: { type: "string" }, summary: { type: "string" } }, required: ["iflang", "summary"] } },
    { name: "run_workflow", description: "Execute the open workflow.", parameters: { type: "object", properties: {} } },
    { name: "capture_canvas", description: "FALLBACK ONLY. Screenshot the canvas when text tools can't answer. Prefer get_workflow.", parameters: { type: "object", properties: {} } },
    { name: "create_workflow", description: "Create a BRAND-NEW workflow and open it (workflow list only). Optionally pre-fill from IF-Lang.", parameters: { type: "object", properties: { name: { type: "string" }, iflang: { type: "string" }, summary: { type: "string" } }, required: ["name"] } },
    { name: "search_workflows", description: "Search existing workflows by name (workflow list only). Does NOT open them.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "search_credentials", description: "List the credentials configured on this n8n instance. Returns ONLY non-sensitive metadata (id, name, type) — never secret values. Use this to wire nodes to existing credentials: set a node's `credentials` to { <type>: { id, name } } in IF-Lang.", parameters: { type: "object", properties: { query: { type: "string", description: "Optional filter over credential name or type." } } } },
    { name: "create_todo", description: "Create or replace your task checklist for the current job. Required in Plan mode. Provide the ordered list of steps.", parameters: { type: "object", properties: { items: { type: "array", items: { type: "string" }, description: "Ordered task descriptions." } }, required: ["items"] } },
    { name: "edit_todo", description: "Update one checklist item — mark it done and/or change its text.", parameters: { type: "object", properties: { index: { type: "number", description: "0-based item index." }, done: { type: "boolean" }, text: { type: "string" } }, required: ["index"] } },
    { name: "read_todo", description: "Read your current task checklist and each item's status.", parameters: { type: "object", properties: {} } },
    { name: "ask_user", description: "Ask the user a single- or multiple-choice question and PAUSE until they answer (their choice is sent back as their next message). An 'Other' free-text option is always added automatically. Use only for choices; for open questions ask in plain text instead.", parameters: { type: "object", properties: { question: { type: "string" }, options: { type: "array", items: { type: "string" }, description: "The choices to offer (do not include 'Other')." }, multiple: { type: "boolean", description: "true = user may pick several." } }, required: ["question", "options"] } },
  ].forEach((t) => (TOOLS[t.name] = t));

  const COMMON = ["create_todo", "edit_todo", "read_todo", "ask_user"];
  const EDITOR_TOOLS = ["search_nodes", "get_node_schema", "get_workflow", "get_execution_data", "search_credentials", "apply_iflang", "run_workflow", "capture_canvas", ...COMMON].map((n) => TOOLS[n]);
  const LIST_TOOLS = ["search_nodes", "get_node_schema", "search_credentials", "create_workflow", "search_workflows", ...COMMON].map((n) => TOOLS[n]);

  // ---- System prompt -----------------------------------------------------

  function buildSystem(langSpec, extra, textMode) {
    return (
      "You are IntelliFlow, an expert n8n automation engineer embedded in the n8n editor. " +
      "You help design, debug and modify workflows.\n\n" +
      "You do NOT write raw n8n JSON — you express workflows in IF-Lang. You are scoped to whatever the user " +
      "currently has open: when a workflow is open you edit ONLY that workflow; on the workflow list you may " +
      "create a new workflow or search existing ones by name but must not open/edit existing ones. " +
      "You cannot delete, archive or empty a workflow (apply always needs at least one node). " +
      "Ground everything in the actually installed nodes.\n\n" +
      "When a node needs authentication, call search_credentials to find an existing credential and attach it in " +
      "IF-Lang with a `credentials` block, e.g. `credentials: { httpHeaderAuth: { id: \"<id>\", name: \"<name>\" } }`. " +
      "You never see secret values, so prefer existing credentials over asking the user for keys.\n\n" +
      (textMode
        ? "IMPORTANT: In this mode you have NO callable tools. To modify the workflow, output the COMPLETE workflow " +
          "as a single fenced code block tagged `iflang` (```iflang ... ```). Put nothing inside that block except " +
          "IF-Lang. Explain your reasoning outside the block.\n\n"
        : "Use the provided tools: search_nodes / get_node_schema before using unfamiliar nodes, get_workflow to read " +
          "state, apply_iflang / create_workflow to make changes (always the COMPLETE workflow), capture_canvas only " +
          "as a last resort.\n\n") +
      "The user CANNOT edit the workflow or apply anything themselves — ONLY you can, via apply_iflang / " +
      "create_workflow. So NEVER paste IF-Lang, workflow code, JSON, or fenced code blocks of the workflow into your " +
      "replies — the user can't use them and doesn't want to see them. Describe what you changed in plain English and " +
      "apply it yourself with the tool.\n\n" +
      "n8n continuously validates the canvas. apply_iflang, get_workflow and get_execution_data all return an `issues` " +
      "list of node problems — ALWAYS check it after applying and fix EVERY issue; the workflow will not run otherwise. " +
      "An issue like 'No node connected to required input \"Model\"' means that node REQUIRES a connection of that type: " +
      "many nodes only work when specific other nodes are wired in — an AI Agent or Chain needs a chat model on its " +
      "ai_languageModel input, and may need memory (ai_memory) and tools (ai_tool); tools/models/memory nodes must be " +
      "connected INTO the agent. 'At least 1 field is required' means a required parameter is empty. Use get_node_schema " +
      "to learn a node's inputs/outputs and requirements, and never leave a required input unconnected or a required " +
      "field blank. Do not tell the user to connect nodes manually — wire them yourself.\n\n" +
      "Track multi-step work with create_todo / read_todo / edit_todo (mark items done as you finish them). In PLAN " +
      "mode you MUST create and maintain a todo list. When you need a decision from the user, use ask_user to present " +
      "a single- or multiple-choice question — it pauses you until they answer. For open/free-text questions, just ask " +
      "in plain text instead of using the tool.\n\n" +
      "Reading and inspecting are FREE actions that never need permission or explicit instruction: proactively call " +
      "get_workflow, search_nodes, get_node_schema, search_credentials and get_execution_data whenever they would " +
      "help — in EVERY permission mode. Decide for yourself when a tool is the right move. If the user asks anything " +
      "about the open workflow (e.g. 'what's wrong with this?', 'what does it do?'), immediately read it with " +
      "get_workflow — do NOT ask them to pick a workflow, point you at one, or tell you to read it. Only ACTUAL " +
      "CHANGES (apply_iflang / create_workflow) are ever gated by the permission mode.\n\n" +
      "IMPORTANT: after you call any tool, you MUST continue and reply to the user in plain text — explain what " +
      "you found or did. Never end your response with only a tool call or with no text; the user must always see a " +
      "written answer after tools run.\n\n" +
      "Keep a clear, concise, technical tone.\n\n=== IF-Lang specification ===\n" +
      langSpec +
      (extra ? "\n\n" + extra : "")
    );
  }

  // ---- Request proxy -----------------------------------------------------
  //
  // Provider requests run through the background service worker over a streaming
  // port. This is essential: the content script shares the n8n page's (HTTPS)
  // origin, so a direct fetch to an HTTP endpoint (e.g. a local Ollama at
  // http://host:11434) is blocked as mixed content, and cross-origin providers
  // can be blocked by the page's CSP/CORS. The background (extension origin) is
  // exempt and uses the extension's host permissions, so anything works.
  function proxyFetch(req) {
    // Fallback to a direct fetch when the extension runtime isn't available
    // (unit tests / non-extension contexts).
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.connect) {
      return fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: req.signal });
    }
    return new Promise((resolve, reject) => {
      let port;
      try {
        port = chrome.runtime.connect({ name: "intelliflow-fetch" });
      } catch (e) {
        reject(new Error("Extension messaging unavailable: " + (e && e.message)));
        return;
      }
      const queue = [];
      let waiting = null; // { res, rej }
      let done = false;
      let errored = null;
      let headResolved = false;

      const reader = {
        read() {
          if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
          if (errored) return Promise.reject(errored);
          if (done) return Promise.resolve({ value: undefined, done: true });
          return new Promise((res, rej) => (waiting = { res, rej }));
        },
        cancel() {
          try { port.disconnect(); } catch (_) { /* ignore */ }
        },
      };
      const respLike = (head) => ({
        ok: head.ok,
        status: head.status,
        statusText: head.statusText || "",
        body: { getReader: () => reader },
        async text() {
          let out = "";
          while (true) {
            const r = await reader.read();
            if (r.done) break;
            out += r.value;
          }
          return out;
        },
        async json() {
          return JSON.parse(await this.text());
        },
      });

      port.onMessage.addListener((msg) => {
        if (!msg) return;
        if (msg.type === "head") {
          if (!headResolved) { headResolved = true; resolve(respLike(msg)); }
        } else if (msg.type === "chunk") {
          if (waiting) { const w = waiting; waiting = null; w.res({ value: msg.data, done: false }); }
          else queue.push(msg.data);
        } else if (msg.type === "done") {
          done = true;
          if (waiting) { const w = waiting; waiting = null; w.res({ value: undefined, done: true }); }
        } else if (msg.type === "error") {
          errored = new Error(msg.message || "Network error");
          if (!headResolved) { headResolved = true; reject(errored); }
          if (waiting) { const w = waiting; waiting = null; w.rej(errored); }
        }
      });
      port.onDisconnect.addListener(() => {
        if (!done && !errored) {
          if (headResolved) {
            done = true;
            if (waiting) { const w = waiting; waiting = null; w.res({ value: undefined, done: true }); }
          } else {
            errored = new Error("Request port closed unexpectedly.");
            reject(errored);
          }
        }
      });

      if (req.signal) {
        if (req.signal.aborted) {
          try { port.disconnect(); } catch (_) { /* ignore */ }
          reject(new DOMException("Aborted", "AbortError"));
          return;
        }
        req.signal.addEventListener(
          "abort",
          () => {
            errored = new DOMException("Aborted", "AbortError");
            try { port.postMessage({ type: "abort" }); port.disconnect(); } catch (_) { /* ignore */ }
            if (waiting) { const w = waiting; waiting = null; w.rej(errored); }
          },
          { once: true }
        );
      }

      port.postMessage({ type: "fetch", url: req.url, method: req.method, headers: req.headers, body: req.body });
    });
  }

  // ---- SSE reader --------------------------------------------------------

  async function sse(response, onObject) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += typeof value === "string" ? value : decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line || line.startsWith(":") || line.startsWith("event:")) continue;
        if (line.startsWith("data:")) {
          const p = line.slice(5).trim();
          if (p === "[DONE]") continue;
          try {
            onObject(JSON.parse(p));
          } catch {
            /* ignore partial */
          }
        }
      }
    }
  }

  function apiError(res, detail) {
    return new Error(res.status + " " + (res.statusText || "") + (detail ? " — " + detail : ""));
  }
  async function errText(res) {
    try {
      const j = await res.json();
      return (j.error && (j.error.message || j.error)) || JSON.stringify(j).slice(0, 200);
    } catch {
      return "";
    }
  }
  function safeParse(s) {
    try {
      return JSON.parse(s || "{}");
    } catch {
      return {};
    }
  }
  function joinUrl(base, path) {
    return (base || "").replace(/\/+$/, "") + path;
  }

  // ---- OpenAI-compatible adapter (OpenAI / OpenRouter / Ollama / custom) --

  function toOpenAIContent(parts) {
    const imgs = parts.filter((p) => p.type === "image");
    const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("");
    if (!imgs.length) return text;
    return [
      ...(text ? [{ type: "text", text }] : []),
      ...imgs.map((i) => ({ type: "image_url", image_url: { url: "data:" + i.mime + ";base64," + i.data } })),
    ];
  }

  function toOpenAIMessages(system, messages) {
    const out = [];
    if (system) out.push({ role: "system", content: system });
    for (const m of messages) {
      if (m.role === "user") {
        out.push({ role: "user", content: toOpenAIContent(m.content) });
      } else if (m.role === "assistant") {
        const text = m.content.filter((c) => c.type === "text").map((c) => c.text).join("");
        const calls = m.content.filter((c) => c.type === "tool_call");
        const msg = { role: "assistant", content: text || (calls.length ? null : "") };
        if (calls.length)
          msg.tool_calls = calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args || {}) } }));
        out.push(msg);
      } else if (m.role === "tool") {
        const imgs = [];
        for (const c of m.content) {
          if (c.type === "tool_result") out.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(c.response) });
          else if (c.type === "image") imgs.push(c);
        }
        if (imgs.length) out.push({ role: "user", content: imgs.map((i) => ({ type: "image_url", image_url: { url: "data:" + i.mime + ";base64," + i.data } })) });
      }
    }
    return out;
  }

  const openaiAdapter = {
    async stream({ prov, config, system, tools, messages, onDelta, signal }) {
      const body = { model: config.model, messages: toOpenAIMessages(system, messages), stream: true };
      if (tools && tools.length) body.tools = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
      const headers = { "Content-Type": "application/json" };
      if (config.apiKey) headers.Authorization = "Bearer " + config.apiKey;
      if (prov && prov.label === "OpenRouter") {
        headers["HTTP-Referer"] = "https://intelliflow.extension";
        headers["X-Title"] = "IntelliFlow for n8n";
      }
      const res = await proxyFetch({ url: joinUrl(config.baseURL || prov.baseURL, "/chat/completions"), method: "POST", headers, body: JSON.stringify(body), signal });
      if (!res.ok) throw apiError(res, await errText(res));

      let text = "";
      const calls = new Map();
      await sse(res, (obj) => {
        const choice = obj.choices && obj.choices[0];
        const d = choice && choice.delta;
        if (!d) return;
        if (d.content) {
          text += d.content;
          onDelta(d.content);
        }
        if (d.tool_calls) {
          for (const tc of d.tool_calls) {
            const i = tc.index != null ? tc.index : 0;
            const cur = calls.get(i) || { id: tc.id, name: "", args: "" };
            if (tc.id) cur.id = tc.id;
            if (tc.function) {
              if (tc.function.name) cur.name = tc.function.name;
              if (tc.function.arguments) cur.args += tc.function.arguments;
            }
            calls.set(i, cur);
          }
        }
      });
      const content = [];
      if (text) content.push({ type: "text", text });
      for (const c of calls.values())
        content.push({ type: "tool_call", id: c.id || "call_" + Math.random().toString(36).slice(2), name: c.name, args: safeParse(c.args) });
      return { content };
    },
  };

  // ---- Anthropic adapter -------------------------------------------------

  function toAnthropicMessages(messages) {
    const out = [];
    for (const m of messages) {
      if (m.role === "user") {
        out.push({ role: "user", content: anthropicBlocks(m.content) });
      } else if (m.role === "assistant") {
        const blocks = [];
        for (const c of m.content) {
          if (c.type === "text" && c.text) blocks.push({ type: "text", text: c.text });
          else if (c.type === "tool_call") blocks.push({ type: "tool_use", id: c.id, name: c.name, input: c.args || {} });
        }
        out.push({ role: "assistant", content: blocks.length ? blocks : [{ type: "text", text: "" }] });
      } else if (m.role === "tool") {
        const blocks = [];
        for (const c of m.content) {
          if (c.type === "tool_result") blocks.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(c.response) });
          else if (c.type === "image") blocks.push({ type: "image", source: { type: "base64", media_type: c.mime, data: c.data } });
        }
        out.push({ role: "user", content: blocks });
      }
    }
    return out;
  }
  function anthropicBlocks(parts) {
    return parts.map((p) =>
      p.type === "image" ? { type: "image", source: { type: "base64", media_type: p.mime, data: p.data } } : { type: "text", text: p.text }
    );
  }

  const anthropicAdapter = {
    async stream({ prov, config, system, tools, messages, onDelta, signal }) {
      const body = {
        model: config.model,
        system,
        max_tokens: 4096,
        messages: toAnthropicMessages(messages),
        stream: true,
      };
      if (tools && tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
      const res = await proxyFetch({
        url: joinUrl(config.baseURL || prov.baseURL, "/v1/messages"),
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey || "",
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: JSON.stringify(body),
        signal,
      });
      if (!res.ok) throw apiError(res, await errText(res));

      let text = "";
      const content = [];
      let curTool = null;
      await sse(res, (obj) => {
        if (obj.type === "content_block_start" && obj.content_block && obj.content_block.type === "tool_use") {
          curTool = { id: obj.content_block.id, name: obj.content_block.name, args: "" };
        } else if (obj.type === "content_block_delta" && obj.delta) {
          if (obj.delta.type === "text_delta") {
            text += obj.delta.text;
            onDelta(obj.delta.text);
          } else if (obj.delta.type === "input_json_delta" && curTool) {
            curTool.args += obj.delta.partial_json || "";
          }
        } else if (obj.type === "content_block_stop" && curTool) {
          content.push({ type: "tool_call", id: curTool.id, name: curTool.name, args: safeParse(curTool.args) });
          curTool = null;
        }
      });
      if (text) content.unshift({ type: "text", text });
      return { content };
    },
  };

  // ---- Gemini adapter ----------------------------------------------------

  function geminiParts(parts) {
    return parts.map((p) => (p.type === "image" ? { inlineData: { mimeType: p.mime, data: p.data } } : { text: p.text }));
  }
  function toGeminiContents(messages) {
    const contents = [];
    for (const m of messages) {
      if (m.role === "user") contents.push({ role: "user", parts: geminiParts(m.content) });
      else if (m.role === "assistant") {
        const parts = [];
        for (const c of m.content) {
          if (c.type === "text" && c.text) parts.push({ text: c.text });
          else if (c.type === "tool_call") parts.push({ functionCall: { name: c.name, args: c.args || {} } });
        }
        contents.push({ role: "model", parts: parts.length ? parts : [{ text: "" }] });
      } else if (m.role === "tool") {
        const parts = [];
        for (const c of m.content) {
          if (c.type === "tool_result") parts.push({ functionResponse: { name: c.name, response: c.response } });
          else if (c.type === "image") parts.push({ inlineData: { mimeType: c.mime, data: c.data } });
        }
        contents.push({ role: "user", parts });
      }
    }
    return contents;
  }

  const geminiAdapter = {
    async stream({ prov, config, system, tools, messages, onDelta, signal }) {
      const url = joinUrl(config.baseURL || prov.baseURL, "/models/" + encodeURIComponent(config.model) + ":streamGenerateContent?alt=sse");
      const body = {
        contents: toGeminiContents(messages),
        systemInstruction: { role: "system", parts: [{ text: system }] },
        generationConfig: { temperature: 0.4 },
      };
      if (tools && tools.length) body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters })) }];
      const res = await proxyFetch({ url, method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey }, body: JSON.stringify(body), signal });
      if (!res.ok) throw apiError(res, await errText(res));

      let text = "";
      const calls = [];
      await sse(res, (obj) => {
        const cand = obj.candidates && obj.candidates[0];
        if (!cand || !cand.content || !cand.content.parts) return;
        for (const part of cand.content.parts) {
          if (typeof part.text === "string") {
            text += part.text;
            onDelta(part.text);
          } else if (part.functionCall) {
            calls.push(part.functionCall);
          }
        }
      });
      const content = [];
      if (text) content.push({ type: "text", text });
      calls.forEach((fc, i) => content.push({ type: "tool_call", id: "g_" + i + "_" + fc.name, name: fc.name, args: fc.args || {} }));
      return { content };
    },
  };

  // ---- cURL adapter (no streaming, no native tools) ----------------------

  function flatten(system, messages) {
    const lines = [system, ""];
    for (const m of messages) {
      if (m.role === "user") lines.push("USER: " + m.content.filter((c) => c.type === "text").map((c) => c.text).join(""));
      else if (m.role === "assistant") lines.push("ASSISTANT: " + m.content.filter((c) => c.type === "text").map((c) => c.text).join(""));
      else if (m.role === "tool") lines.push("TOOL_RESULT: " + m.content.filter((c) => c.type === "tool_result").map((c) => JSON.stringify(c.response)).join(" "));
    }
    return lines.join("\n");
  }
  function tokenizeCurl(s) {
    const toks = [];
    let i = 0;
    while (i < s.length) {
      while (i < s.length && /\s/.test(s[i])) i++;
      if (i >= s.length) break;
      if (s[i] === "'" || s[i] === '"') {
        const q = s[i++];
        let t = "";
        while (i < s.length && s[i] !== q) {
          if (s[i] === "\\" && i + 1 < s.length) {
            t += s[i + 1];
            i += 2;
          } else t += s[i++];
        }
        i++;
        toks.push(t);
      } else {
        let t = "";
        while (i < s.length && !/\s/.test(s[i])) {
          if (s[i] === "\\" && s[i + 1] === "\n") {
            i += 2;
            break;
          }
          t += s[i++];
        }
        if (t) toks.push(t);
      }
    }
    return toks;
  }
  function parseCurl(template, promptText, systemText) {
    const escaped = JSON.stringify(promptText).slice(1, -1);
    const sysEsc = JSON.stringify(systemText || "").slice(1, -1);
    const filled = String(template)
      .replace(/\{\{\s*PROMPT\s*\}\}/g, escaped)
      .replace(/\{\{\s*SYSTEM\s*\}\}/g, sysEsc);
    const toks = tokenizeCurl(filled.replace(/\\\n/g, " "));
    let method = "GET";
    let url = "";
    const headers = {};
    let bodyData = null;
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t === "curl") continue;
      if (t === "-X" || t === "--request") method = toks[++i];
      else if (t === "-H" || t === "--header") {
        const h = toks[++i] || "";
        const c = h.indexOf(":");
        if (c > 0) headers[h.slice(0, c).trim()] = h.slice(c + 1).trim();
      } else if (t === "-d" || t === "--data" || t === "--data-raw" || t === "--data-binary" || t === "--data-ascii") {
        bodyData = toks[++i];
        if (method === "GET") method = "POST";
      } else if (t === "-u" || t === "--user") {
        headers.Authorization = "Basic " + btoa(toks[++i] || "");
      } else if (/^https?:\/\//.test(t) && !url) url = t;
      else if (!t.startsWith("-") && !url) url = t;
    }
    return { method, url, headers, body: bodyData };
  }
  function extractText(json, raw) {
    if (json == null) return raw || null;
    if (typeof json === "string") return json;
    const g = (o, path) => path.reduce((a, k) => (a == null ? a : a[k]), o);
    return (
      g(json, ["choices", 0, "message", "content"]) ||
      g(json, ["choices", 0, "text"]) ||
      (Array.isArray(json.content) ? json.content.map((c) => c && c.text).filter(Boolean).join("") : null) ||
      g(json, ["candidates", 0, "content", "parts", 0, "text"]) ||
      g(json, ["message", "content"]) ||
      json.response ||
      json.output_text ||
      raw ||
      null
    );
  }

  const curlAdapter = {
    async stream({ config, system, messages, onDelta, signal }) {
      if (!config.curlTemplate || !/curl/.test(config.curlTemplate)) throw new Error("Set a cURL command in settings (use {{PROMPT}} for the message).");
      const prompt = flatten("", messages);
      const req = parseCurl(config.curlTemplate, prompt, system);
      if (!req.url) throw new Error("Couldn't find a URL in your cURL command.");
      const res = await proxyFetch({ url: req.url, method: req.method, headers: req.headers, body: req.body, signal });
      const raw = await res.text();
      if (!res.ok) throw apiError(res, raw.slice(0, 200));
      let json = null;
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
      const text = extractText(json, raw) || "(empty response)";
      onDelta(text); // single shot — no token streaming for cURL
      return { content: [{ type: "text", text }] };
    },
  };

  const ADAPTERS = { openai: openaiAdapter, anthropic: anthropicAdapter, gemini: geminiAdapter, curl: curlAdapter };

  // ---- Text apply-block protocol (for tool-less providers) ---------------

  function extractIfLangBlock(text) {
    const m = /```(?:iflang|if-lang|workflow)?\s*\n([\s\S]*?)```/i.exec(text || "");
    if (!m) return null;
    const body = m[1].trim();
    return /\b(workflow|trigger|->)\b/.test(body) ? body : null;
  }

  // ---- Unified chat loop -------------------------------------------------

  async function chat({
    providerKey,
    config,
    history,
    userParts,
    langSpec,
    extraContext,
    tools,
    toolHandlers,
    onDelta,
    onToolCall,
    onToolResult,
    onTurnStart,
    signal,
    maxIterations = 8,
  }) {
    const prov = PROVIDERS[providerKey];
    if (!prov) throw new Error("Unknown provider: " + providerKey);
    const adapter = ADAPTERS[prov.kind];
    if (!adapter) throw new Error("No adapter for provider kind " + prov.kind);
    if (prov.needsKey && !config.apiKey) throw new Error("Add an API key for " + prov.label + " in settings.");
    const textMode = !!prov.textMode;
    const system = buildSystem(langSpec, extraContext, textMode);

    // userParts may be empty when continuing/regenerating an existing history.
    if (userParts && userParts.length) history.push({ role: "user", content: userParts });

    let finalText = "";
    let nudged = false;
    for (let iter = 0; iter < maxIterations; iter++) {
      if (onTurnStart) onTurnStart(iter);
      const assistant = await adapter.stream({
        prov,
        config,
        system,
        tools: textMode ? null : tools,
        messages: history,
        onDelta,
        signal,
      });
      history.push({ role: "assistant", content: assistant.content.length ? assistant.content : [{ type: "text", text: "" }] });

      let toolCalls = assistant.content.filter((c) => c.type === "tool_call");

      // Tool-less providers: mine an ```iflang block out of the reply.
      if (textMode && !toolCalls.length) {
        const text = assistant.content.filter((c) => c.type === "text").map((c) => c.text).join("");
        const block = extractIfLangBlock(text);
        if (block && toolHandlers.apply_iflang) {
          toolCalls = [{ type: "tool_call", id: "text_apply", name: "apply_iflang", args: { iflang: block, summary: (text.split("\n")[0] || "Apply workflow").slice(0, 140) } }];
        }
      }

      if (!toolCalls.length) {
        finalText = assistant.content.filter((c) => c.type === "text").map((c) => c.text).join("");
        // The model stopped without saying anything (common right after a tool).
        // Nudge it once to produce a written reply instead of leaving the user blank.
        if (!finalText.trim() && !nudged && iter < maxIterations - 1) {
          nudged = true;
          history.push({
            role: "user",
            hidden: true,
            content: [{ type: "text", text: "Now reply to the user in plain text — briefly summarise what you found or did." }],
          });
          continue;
        }
        break;
      }

      const results = [];
      let paused = false; // ask_user pauses the loop until the user replies
      for (const call of toolCalls) {
        if (onToolCall) onToolCall(call.name, call.args || {});
        let result;
        try {
          const h = toolHandlers[call.name];
          result = h ? await h(call.args || {}) : { error: "Unknown tool: " + call.name };
        } catch (e) {
          result = { error: (e && e.message) || String(e) };
        }
        if (onToolResult) onToolResult(call.name, result);
        if (result && result.__image) {
          results.push({ type: "tool_result", id: call.id, name: call.name, response: { status: "image attached" } });
          results.push({ type: "image", mime: result.__image.mimeType, data: result.__image.data });
        } else {
          if (result && result.__askUser) paused = true;
          results.push({ type: "tool_result", id: call.id, name: call.name, response: normalize(result && result.__askUser ? { status: "awaiting the user's answer" } : result) });
        }
      }
      history.push({ role: "tool", content: results });

      if (paused) break; // stop generating; the user's answer arrives as a new message
      // cURL is single-shot; don't loop it back through another request.
      if (textMode) break;
      if (signal && signal.aborted) break;
    }
    return { text: finalText };
  }

  function normalize(result) {
    if (result === undefined || result === null) return { result: null };
    if (typeof result === "object" && !Array.isArray(result)) return result;
    return { result };
  }

  IF.AI = { chat, PROVIDERS, TOOLS, EDITOR_TOOLS, LIST_TOOLS };
})();
