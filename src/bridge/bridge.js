// IntelliFlow for n8n — MAIN-world bridge.
//
// Runs in the page's own JavaScript context (not the extension's isolated
// world) so it can reach n8n's Vue app, Pinia stores, node-type catalog and
// the VueFlow canvas graph directly. It exposes a small, stable RPC surface to
// the isolated-world UI over window.postMessage.
//
// Everything here is defensive: n8n versions move internals around, so each
// accessor degrades gracefully and the read path has multiple fallbacks
// (REST -> Pinia -> VueFlow) before the UI ever falls back to a screenshot.

(function () {
  "use strict";

  if (window.__INTELLIFLOW_BRIDGE__) return;
  window.__INTELLIFLOW_BRIDGE__ = true;

  const WIRE = "__intelliflow_bridge__";

  function now() {
    return performance && performance.now ? performance.now() : Date.now();
  }
  function bridgeLog(...args) {
    try {
      console.log("%c[IntelliFlow/bridge]", "color:#8b5cf6;font-weight:bold", ...args);
    } catch (e) {
      /* ignore */
    }
  }

  // ---- n8n internal accessors -------------------------------------------

  function appRoot() {
    const el = document.querySelector("#app") || document.body.firstElementChild;
    return el && el.__vue_app__ ? el.__vue_app__ : null;
  }

  function globals() {
    const app = appRoot();
    return app && app._context ? app._context.config.globalProperties : null;
  }

  function pinia() {
    const g = globals();
    return g && g.$pinia ? g.$pinia : null;
  }

  function store(id) {
    const p = pinia();
    if (!p || !p._s) return null;
    return p._s.get(id) || null;
  }

  function currentWorkflowId() {
    const m = location.pathname.match(/\/workflow\/([^/?#]+)/);
    if (m) return m[1];
    const wf = store("workflows");
    if (wf && wf.workflowId) return wf.workflowId;
    return null;
  }

  function titleName() {
    // n8n sets the tab title to the workflow name; strip decorations.
    return (document.title || "")
      .replace(/\s*-\s*n8n.*$/i, "")
      .replace(/^[▶️\s]+/, "")
      .trim() || null;
  }

  // Whether a workflow editor is open (incl. a brand-new unsaved one), vs the
  // workflow list / other pages. This is what scopes the assistant.
  function currentContext() {
    const path = location.pathname;
    const inEditor = /\/workflow\//.test(path);
    const id = inEditor ? currentWorkflowId() : null;
    return {
      inEditor,
      workflowId: id,
      isNew: id ? /^new$/i.test(id) : false,
      name: inEditor ? titleName() : null,
      path,
    };
  }

  // The live, per-workflow document store — modern n8n's source of truth for
  // the open workflow. Editing it updates the canvas in place (no reload) and
  // is what lets IntelliFlow apply changes without disconnecting the assistant.
  function documentStore(id) {
    const p = pinia();
    if (!p || !p._s) return null;
    if (id) {
      const s = p._s.get("workflowDocuments/" + id + "@latest");
      if (s) return s;
    }
    for (const key of p._s.keys()) {
      const m = /^workflowDocuments\/(.+)@latest$/.exec(key);
      if (m && m[1]) return p._s.get(key);
    }
    return null;
  }

  function docNodesToArray(nodes) {
    if (!nodes) return [];
    return Array.isArray(nodes) ? nodes : Object.values(nodes);
  }

  function browserId() {
    try {
      return localStorage.getItem("n8n-browserId") || "";
    } catch {
      return "";
    }
  }

  async function restJson(path, options) {
    const bid = browserId();
    const headers = Object.assign(
      { "Content-Type": "application/json" },
      bid ? { "browser-id": bid } : {},
      (options && options.headers) || {}
    );
    const res = await fetch(path, {
      credentials: "include",
      ...options,
      headers,
    });
    const text = await res.text();
    let body = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const err = new Error("REST " + res.status + " " + path);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body && body.data !== undefined ? body.data : body;
  }

  // ---- Node catalog (the backbone of the dynamic language) ---------------

  function nodeTypesStore() {
    return store("nodeTypes");
  }

  function allNodeTypes() {
    const nt = nodeTypesStore();
    if (!nt) return [];
    if (Array.isArray(nt.allNodeTypes)) return nt.allNodeTypes;
    if (typeof nt.getAllNodeTypes === "function") return nt.getAllNodeTypes() || [];
    return [];
  }

  // A compact index of every installed node type. Regenerated on demand so it
  // always reflects nodes added/updated on the server over time.
  function buildCatalog() {
    const types = allNodeTypes();
    const byName = new Map();
    for (const t of types) {
      if (!t || !t.name) continue;
      const entry = byName.get(t.name) || {
        name: t.name,
        displayName: t.displayName || t.name,
        group: t.group || [],
        description: (t.description || "").slice(0, 160),
        versions: new Set(),
        isTrigger: false,
        usableAsTool: !!t.usableAsTool,
      };
      const vers = Array.isArray(t.version) ? t.version : [t.version];
      vers.forEach((v) => v != null && entry.versions.add(v));
      if ((t.group || []).includes("trigger")) entry.isTrigger = true;
      byName.set(t.name, entry);
    }
    return [...byName.values()].map((e) => ({
      name: e.name,
      displayName: e.displayName,
      group: e.group,
      description: e.description,
      versions: [...e.versions].sort((a, b) => a - b),
      isTrigger: e.isTrigger,
      usableAsTool: e.usableAsTool,
    }));
  }

  function nodeSchema(name, version) {
    const nt = nodeTypesStore();
    if (!nt || typeof nt.getNodeType !== "function") return null;
    const desc = version != null ? nt.getNodeType(name, version) : nt.getNodeType(name);
    if (!desc) return null;
    const versions =
      typeof nt.getNodeVersions === "function" ? nt.getNodeVersions(name) : [desc.version];
    const props = (desc.properties || []).map((p) => ({
      name: p.name,
      displayName: p.displayName,
      type: p.type,
      default: p.default,
      required: !!p.required,
      description: (p.description || "").slice(0, 200),
      options: Array.isArray(p.options)
        ? p.options.slice(0, 40).map((o) => ({
            name: o.name,
            value: o.value !== undefined ? o.value : o.name,
          }))
        : undefined,
      displayOptions: p.displayOptions,
    }));
    return {
      name: desc.name,
      displayName: desc.displayName,
      description: desc.description,
      defaultVersion: desc.defaultVersion,
      versions: Array.isArray(versions) ? versions : [versions],
      defaults: desc.defaults,
      inputs: desc.inputs,
      outputs: desc.outputs,
      credentials: (desc.credentials || []).map((c) => ({
        name: c.name,
        required: !!c.required,
      })),
      subtitle: desc.subtitle,
      properties: props,
    };
  }

  // ---- Reading the current workflow (text-first) -------------------------

  function readFromVueFlow(id) {
    const g = globals();
    const vfs = g && g.$vueFlowStorage;
    if (!vfs || !vfs.flows) return null;
    const flow = vfs.flows.get(id);
    if (!flow) return null;
    const deref = (r) => (r && r.value !== undefined ? r.value : r);
    const vnodes = deref(flow.nodes) || [];
    const vedges = deref(flow.edges) || [];
    const nodes = vnodes
      .filter((n) => n && n.data && typeof n.data.type === "string" && !n.data.type.startsWith("n8n-nodes-internal."))
      .map((n) => ({
        id: n.data.id || n.id,
        name: n.data.name,
        type: n.data.type,
        typeVersion: n.data.typeVersion,
        position: n.position ? [Math.round(n.position.x), Math.round(n.position.y)] : n.data.position,
        parameters: n.data.parameters || {},
        credentials: n.data.credentials || undefined,
        disabled: n.data.disabled || undefined,
      }));
    // VueFlow edges -> n8n connection map (best-effort).
    const nameById = {};
    nodes.forEach((n) => (nameById[n.id] = n.name));
    const connections = {};
    for (const e of vedges) {
      const from = nameById[e.source] || e.source;
      const to = nameById[e.target] || e.target;
      if (!from || !to) continue;
      const outType = handleType(e.sourceHandle) || "main";
      const outIdx = handleIndex(e.sourceHandle);
      const inIdx = handleIndex(e.targetHandle);
      connections[from] = connections[from] || {};
      connections[from][outType] = connections[from][outType] || [];
      while (connections[from][outType].length <= outIdx) connections[from][outType].push([]);
      connections[from][outType][outIdx].push({ node: to, type: "main", index: inIdx });
    }
    return { id, nodes, connections, source: "vueflow" };
  }

  function handleType(handle) {
    if (!handle || typeof handle !== "string") return "main";
    // n8n handle ids look like "outputs/main/0" or "inputs/main/0".
    const parts = handle.split("/");
    const i = parts.indexOf("main");
    if (i >= 0) return "main";
    // AI connection types (ai_tool, ai_languageModel, ...) appear verbatim.
    const known = parts.find((p) => p.startsWith("ai_"));
    return known || "main";
  }

  function handleIndex(handle) {
    if (!handle || typeof handle !== "string") return 0;
    const m = handle.match(/(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : 0;
  }

  async function getState() {
    const id = currentWorkflowId();
    const result = {
      id,
      name: null,
      active: null,
      nodes: [],
      connections: {},
      settings: undefined,
      versionId: undefined,
      source: "none",
    };
    if (!id) return result;

    // 1. Live document store — reflects unsaved in-place edits immediately, so
    //    the assistant always sees the true current state of what it applied.
    try {
      const doc = documentStore(id);
      if (doc && typeof doc.getSnapshot === "function") {
        const s = doc.getSnapshot();
        const nodes = docNodesToArray(s && s.nodes);
        if (s && nodes) {
          return {
            id,
            name: s.name,
            active: s.active,
            nodes,
            connections: s.connections || {},
            settings: s.settings,
            versionId: s.versionId,
            pinData: s.pinData,
            issues: collectIssues(),
            source: "document",
          };
        }
      }
    } catch (e) {
      /* fall through */
    }

    // 2. REST — complete source when the document store isn't reachable.
    if (!/^new$/i.test(id)) {
      try {
        const w = await restJson("/rest/workflows/" + encodeURIComponent(id));
        if (w && Array.isArray(w.nodes)) {
          return {
            id,
            name: w.name,
            active: w.active,
            nodes: w.nodes,
            connections: w.connections || {},
            settings: w.settings,
            versionId: w.versionId,
            pinData: w.pinData,
            source: "rest",
          };
        }
      } catch (e) {
        // Fall through to in-page state (covers new/unsaved workflows too).
      }
    }

    // 3. VueFlow canvas graph — always available in-page, auth-independent.
    const vf = readFromVueFlow(id);
    if (vf && vf.nodes.length) {
      const wf = store("workflows");
      vf.name = (wf && wf.workflowName) || document.title.replace(/ - n8n.*/, "");
      vf.active = wf && wf.isWorkflowActive;
      return vf;
    }

    return result;
  }

  // n8n continuously validates the canvas and stores human-readable problems on
  // each node at node.data.issues.validation, e.g. "No node connected to
  // required input \"Model\"" or "At least 1 field is required". These are
  // exactly the errors the user sees and the model needs to self-correct.
  function collectIssues() {
    const g = globals();
    const vfs = g && g.$vueFlowStorage;
    const id = currentWorkflowId();
    const flow = vfs && vfs.flows ? vfs.flows.get(id) : null;
    if (!flow) return [];
    const deref = (r) => (r && r.value !== undefined ? r.value : r);
    const out = [];
    for (const n of deref(flow.nodes) || []) {
      if (!n.data || String(n.data.type).startsWith("n8n-nodes-internal.")) continue;
      const iss = n.data.issues;
      const raw = iss && Array.isArray(iss.validation) ? iss.validation : [];
      const msgs = raw
        .map((x) => (typeof x === "string" ? x : x && (x.message || JSON.stringify(x))))
        .filter(Boolean);
      if (msgs.length) out.push({ node: n.data.name, type: n.data.type, issues: msgs });
    }
    return out;
  }

  async function getExecutionData() {
    const id = currentWorkflowId();
    const nodeIssues = collectIssues();
    let lastExecution = { available: false };
    if (id && !/^new$/i.test(id)) {
      try {
        const wf = store("workflows");
        let exec = null;
        if (wf && typeof wf.getPastExecutions === "function") {
          const res = await wf.getPastExecutions({ workflowId: id }, 1);
          const arr = (res && (res.results || res.data)) || res;
          exec = Array.isArray(arr) ? arr[0] : null;
        }
        if (!exec && wf && typeof wf.fetchLastSuccessfulExecution === "function") {
          exec = await wf.fetchLastSuccessfulExecution(id);
        }
        if (exec) {
          const err = exec.data && exec.data.resultData && exec.data.resultData.error;
          lastExecution = {
            available: true,
            id: exec.id,
            status: exec.status || (exec.finished ? "success" : "unknown"),
            finished: exec.finished,
            error: err && (err.message || err.description),
            errorNode: err && err.node && err.node.name,
          };
        }
      } catch {
        /* best effort */
      }
    }
    return {
      nodeIssues,
      issueCount: nodeIssues.length,
      lastExecution,
      note: nodeIssues.length
        ? "These validation issues BLOCK the workflow from running — fix every one (missing required connections, missing required fields, etc.) then re-check."
        : "No validation issues on the canvas.",
    };
  }

  // ---- Applying changes --------------------------------------------------

  const undoStack = [];
  const redoStack = [];

  async function snapshot() {
    try {
      const s = await getState();
      undoStack.push({
        nodes: s.nodes,
        connections: s.connections,
        settings: s.settings,
        name: s.name,
        versionId: s.versionId,
      });
      if (undoStack.length > 30) undoStack.shift();
      redoStack.length = 0;
    } catch {
      /* snapshotting is best-effort */
    }
  }

  async function persistWorkflow(id, payload) {
    // Prefer the store action (uses n8n's authenticated axios + versioning).
    const wf = store("workflows");
    if (wf && typeof wf.updateWorkflow === "function") {
      try {
        return await wf.updateWorkflow(id, payload, false);
      } catch (e) {
        if (payload.versionId) {
          const retry = Object.assign({}, payload);
          delete retry.versionId;
          return await wf.updateWorkflow(id, retry, true);
        }
        throw e;
      }
    }
    // Fallback: raw REST PATCH.
    return await restJson("/rest/workflows/" + encodeURIComponent(id), {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
  }

  // Normalise a compiled IF-Lang node into the shape the document store wants.
  function toDocNode(n) {
    const pos = Array.isArray(n.position)
      ? n.position
      : [(n.position && n.position.x) || 0, (n.position && n.position.y) || 0];
    const node = {
      id: n.id || cheapId(),
      name: n.name,
      type: n.type,
      typeVersion: n.typeVersion,
      position: pos,
      parameters: n.parameters || {},
    };
    if (n.credentials) node.credentials = n.credentials;
    if (n.disabled) node.disabled = n.disabled;
    return node;
  }

  async function applyWorkflow(workflow, opts) {
    opts = opts || {};
    const ctx = currentContext();
    if (!ctx.inEditor) throw new Error("No workflow is open. Open or create a workflow before editing.");
    const id = ctx.workflowId;
    // Lock edits to the workflow the conversation is bound to.
    if (opts.expectedWorkflowId && opts.expectedWorkflowId !== id) {
      throw new Error(
        "The open workflow changed while I was working; not applying, to avoid editing the wrong workflow. Re-ask on the intended workflow."
      );
    }
    // Never let an edit empty out / effectively delete a workflow (undo/redo may).
    const nodes = (workflow && workflow.nodes) || [];
    if (!opts.allowEmpty && (!Array.isArray(nodes) || nodes.length === 0)) {
      throw new Error(
        "Refusing to apply an empty workflow — IntelliFlow will not delete or clear all nodes from a workflow."
      );
    }

    const doc = documentStore(id);
    if (!doc || typeof doc.setNodes !== "function") {
      throw new Error("Could not access the live workflow editor for this page.");
    }

    if (!opts.skipSnapshot) await snapshot();

    // Apply IN PLACE — the canvas is reactive to the document store, so this
    // updates the editor live with NO page reload. The assistant stays
    // connected and can immediately read the result via get_workflow.
    const tn = now();
    doc.setNodes(nodes.map(toDocNode));
    if (typeof doc.setConnections === "function") doc.setConnections(workflow.connections || {});
    bridgeLog("applyWorkflow.setNodes/Connections", (now() - tn).toFixed(0) + "ms", nodes.length + " nodes");

    // Persist to the backend best-effort, without reloading. If n8n's document
    // model autosaves, this is harmless; otherwise it saves like a normal edit.
    persistBestEffort(id, doc);

    // Let n8n recompute node validation, then report any issues back so the
    // model can immediately fix broken/missing connections and fields.
    await new Promise((r) => setTimeout(r, 400));
    const issues = collectIssues();
    return {
      ok: true,
      nodeCount: nodes.length,
      applied: "in-place",
      issues,
      note: issues.length
        ? "Applied, BUT n8n reports validation issues (below) — the workflow will not run until you fix them: " +
          issues.map((i) => i.node + ": " + i.issues.join("; ")).join(" | ")
        : "Applied cleanly — no validation issues.",
    };
  }

  function persistBestEffort(id, doc) {
    try {
      const wf = store("workflows");
      if (!wf || typeof wf.updateWorkflow !== "function") return;
      const snap = typeof doc.serialize === "function" ? doc.serialize() : null;
      if (!snap) return;
      const payload = {
        name: snap.name,
        nodes: snap.nodes,
        connections: snap.connections || {},
        settings: snap.settings || {},
      };
      if (snap.versionId) payload.versionId = snap.versionId;
      // Fire and forget — never block or reload on save.
      Promise.resolve(wf.updateWorkflow(id, payload, false)).catch(() => {});
    } catch {
      /* saving is best-effort */
    }
  }

  async function undo() {
    const snap = undoStack.pop();
    if (!snap) throw new Error("Nothing to undo.");
    const current = await getState();
    redoStack.push({
      nodes: current.nodes,
      connections: current.connections,
      settings: current.settings,
      name: current.name,
    });
    await applyWorkflow(snap, { skipSnapshot: true, allowEmpty: true });
    return { ok: true };
  }

  async function redo() {
    const snap = redoStack.pop();
    if (!snap) throw new Error("Nothing to redo.");
    await snapshot();
    await applyWorkflow(snap, { skipSnapshot: true, allowEmpty: true });
    return { ok: true };
  }

  async function runWorkflow() {
    // Trigger n8n's own execute path via its toolbar button (version-stable).
    const btn =
      document.querySelector('[data-test-id="execute-workflow-button"]') ||
      document.querySelector('[data-test-id="workflow-execute-button"]');
    if (btn) {
      btn.click();
      return { ok: true, via: "button" };
    }
    const wf = store("workflows");
    if (wf && typeof wf.runWorkflow === "function") {
      await wf.runWorkflow({});
      return { ok: true, via: "store" };
    }
    throw new Error("Could not find a way to execute the workflow.");
  }

  // ---- Workflow-list operations (create / search only) -------------------

  async function createWorkflow({ name, workflow }) {
    const payload = {
      name: name || "New workflow",
      nodes: (workflow && workflow.nodes) || [],
      connections: (workflow && workflow.connections) || {},
      settings: (workflow && workflow.settings) || {},
    };
    const created = await restJson("/rest/workflows", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    const id = created && created.id;
    if (!id) throw new Error("Workflow was not created (no id returned).");
    // Open the new workflow (creating/opening a NEW workflow is allowed).
    const g = globals();
    if (g && g.$router && typeof g.$router.push === "function") {
      try {
        g.$router.push("/workflow/" + id);
      } catch {
        location.href = "/workflow/" + id;
      }
    } else {
      location.href = "/workflow/" + id;
    }
    return { ok: true, id, name: payload.name, nodeCount: payload.nodes.length };
  }

  // Non-sensitive credential metadata only — NEVER secret data. n8n's
  // credentials store list contains no decrypted `data` field (verified), so
  // the assistant can wire nodes to credentials without any secret leaving the
  // browser to the model provider.
  async function searchCredentials({ query }) {
    const cred = store("credentials");
    if (!cred) return { error: "Credentials store not available on this page." };
    let all = cred.allCredentials;
    if ((!all || !all.length) && typeof cred.fetchAllCredentials === "function") {
      try {
        await cred.fetchAllCredentials();
        all = cred.allCredentials;
      } catch {
        /* ignore */
      }
    }
    all = Array.isArray(all) ? all : [];
    const q = String(query || "").toLowerCase();
    const results = all
      .filter((c) => !q || (c.name || "").toLowerCase().includes(q) || (c.type || "").toLowerCase().includes(q))
      .slice(0, 40)
      .map((c) => {
        let typeDisplayName;
        try {
          const t = cred.getCredentialTypeByName && cred.getCredentialTypeByName(c.type);
          typeDisplayName = t && t.displayName;
        } catch {
          /* optional */
        }
        // Only id / name / type — deliberately no secret data.
        return { id: c.id, name: c.name, type: c.type, typeDisplayName };
      });
    return {
      count: results.length,
      results,
      note: "Only non-sensitive metadata (id, name, type) is exposed — never secret values. To use one on a node, set the node's credentials to { <type>: { id, name } }.",
    };
  }

  async function searchWorkflows({ query }) {
    let list = [];
    try {
      const res = await restJson("/rest/workflows?limit=100");
      list = Array.isArray(res) ? res : (res && res.data) || [];
    } catch (e) {
      return { error: e.message };
    }
    const q = String(query || "").toLowerCase();
    const results = list
      .filter((w) => !q || (w.name || "").toLowerCase().includes(q))
      .slice(0, 25)
      .map((w) => ({ id: w.id, name: w.name, active: w.active }));
    // Note: we intentionally do NOT open existing workflows from here.
    return { count: results.length, results };
  }

  // ---- Context tracking (scopes the assistant to one workflow) -----------

  let lastContextKey = null;
  function contextKey(c) {
    return (c.inEditor ? "wf:" + (c.workflowId || "") : "list") + "|" + (c.path || "");
  }
  function emitContext(force) {
    const c = currentContext();
    const key = contextKey(c);
    if (!force && key === lastContextKey) return;
    lastContextKey = key;
    postToUI("context-changed", c);
  }
  function installContextWatch() {
    const wrap = (fn) =>
      function () {
        const r = fn.apply(this, arguments);
        setTimeout(() => emitContext(false), 60);
        return r;
      };
    try {
      history.pushState = wrap(history.pushState);
      history.replaceState = wrap(history.replaceState);
    } catch {
      /* ignore */
    }
    window.addEventListener("popstate", () => setTimeout(() => emitContext(false), 60));
    const g = globals();
    if (g && g.$router && typeof g.$router.afterEach === "function") {
      try {
        g.$router.afterEach(() => setTimeout(() => emitContext(false), 60));
      } catch {
        /* ignore */
      }
    }
    // Fallback poll for navigations we didn't hook.
    setInterval(() => emitContext(false), 1500);
  }

  // ---- RPC plumbing ------------------------------------------------------

  const handlers = {
    ping: async () => ({ ok: true, hasVue: !!appRoot(), workflowId: currentWorkflowId() }),
    getContext: async () => currentContext(),
    getCatalog: async () => ({ catalog: buildCatalog() }),
    getSchema: async ({ name, version }) => ({ schema: nodeSchema(name, version) }),
    getState: async () => getState(),
    getExecutionData: async () => getExecutionData(),
    applyWorkflow: async ({ workflow, opts }) => applyWorkflow(workflow, opts),
    createWorkflow: async ({ name, workflow }) => createWorkflow({ name, workflow }),
    searchWorkflows: async ({ query }) => searchWorkflows({ query }),
    searchCredentials: async ({ query }) => searchCredentials({ query }),
    undo: async () => undo(),
    redo: async () => redo(),
    runWorkflow: async () => runWorkflow(),
    canUndo: async () => ({ undo: undoStack.length, redo: redoStack.length }),
  };

  // n8n's state (catalog entries, VueFlow nodes) are Vue reactive Proxies which
  // structured-clone (postMessage) cannot serialize. Round-tripping through JSON
  // yields plain, cloneable data.
  function plain(x) {
    try {
      return JSON.parse(JSON.stringify(x === undefined ? null : x));
    } catch {
      return null;
    }
  }

  function postToUI(event, payload) {
    window.postMessage({ [WIRE]: true, dir: "event", event, payload: plain(payload) }, window.location.origin);
  }

  window.addEventListener("message", async (ev) => {
    if (ev.source !== window) return;
    const msg = ev.data;
    if (!msg || !msg[WIRE] || msg.dir !== "req") return;
    const { id, op, payload } = msg;
    const fn = handlers[op];
    let reply;
    const t0 = now();
    if (!fn) {
      reply = { ok: false, error: "Unknown op: " + op };
    } else {
      try {
        reply = { ok: true, result: await fn(payload || {}) };
      } catch (e) {
        reply = { ok: false, error: (e && e.message) || String(e) };
      }
    }
    bridgeLog(op, (now() - t0).toFixed(0) + "ms", reply.ok ? "" : "ERROR: " + reply.error);
    window.postMessage(
      plain({ [WIRE]: true, dir: "res", id, ...reply }),
      window.location.origin
    );
  });

  // Content-based n8n detection (URL-independent): the page is n8n if its Vue
  // app has the n8n Pinia stores. This lets IntelliFlow work on ANY n8n server.
  function isN8n() {
    try {
      const p = pinia();
      if (p && p._s && p._s.has("nodeTypes") && p._s.has("workflows")) return true;
    } catch {
      /* not n8n */
    }
    return false;
  }

  function announceDetection() {
    if (isN8n()) {
      postToUI("n8n-detected", currentContext());
      installContextWatch();
      return;
    }
    // n8n loads asynchronously — poll briefly, then give up quietly.
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (isN8n()) {
        clearInterval(iv);
        postToUI("n8n-detected", currentContext());
        installContextWatch();
      } else if (tries > 20) {
        clearInterval(iv);
      }
    }, 500);
  }

  announceDetection();
  postToUI("bridge-ready", { detected: isN8n() });
})();
