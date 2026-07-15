// IntelliFlow for n8n — content orchestrator (isolated world).
// Ties together the n8n bridge, IF-Lang compiler, Gemini client and the panel.
//
// The assistant is SCOPED to whatever the user has open:
//  - A workflow editor  -> it can read/edit ONLY that workflow. Each workflow
//    keeps its own conversation; switching workflows switches the session.
//  - The workflow list  -> it may create a new workflow or search existing ones
//    by name, but must not open or edit existing workflows.

(function () {
  "use strict";
  const IF = (window.IF = window.IF || {});

  const store = {
    ready: false,
    initing: null,
    catalog: [],
    schemaCache: new Map(),
    session: null, // active session object
    history: [], // === session.messages
    context: { inEditor: false, workflowId: null, isNew: false, name: null },
    currentState: null,
    aborter: null,
  };

  // ---- session manager + conversation tree ------------------------------
  //
  // A conversation is a TREE (like ChatGPT): editing a prompt or regenerating a
  // reply creates a sibling branch instead of discarding the old one, so you can
  // flip between versions and their downstream paths. The "active path" (root ->
  // leaf, following each node's active child) is what the model sees and what we
  // render. Nodes: { id, parent, role, content, hidden, children:[ids], active }.

  function genId() {
    return "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }
  function scopeInfo(ctx) {
    return ctx && ctx.inEditor
      ? { scopeKey: "wf:" + (ctx.workflowId || ""), scopeLabel: ctx.name || "Workflow" }
      : { scopeKey: "list", scopeLabel: "Workflow list" };
  }
  function ensureTree(s) {
    if (s.nodes) return;
    s.nodes = {};
    s.rootChildren = [];
    s.rootActive = 0;
    s.leaf = null;
    // Migrate an old flat `messages` array into a linear tree.
    let parent = null;
    for (const m of s.messages || []) {
      const id = genId();
      s.nodes[id] = { id, parent, role: m.role, content: m.content, hidden: !!m.hidden, children: [], active: 0 };
      if (parent) { const p = s.nodes[parent]; p.children.push(id); p.active = p.children.length - 1; }
      else { s.rootChildren.push(id); s.rootActive = s.rootChildren.length - 1; }
      parent = id;
    }
    s.leaf = parent;
    delete s.messages;
  }
  function setActiveSession(s) {
    ensureTree(s);
    store.session = s;
  }
  function newSession(ctx) {
    const { scopeKey, scopeLabel } = scopeInfo(ctx);
    const s = { id: genId(), title: null, scopeKey, scopeLabel, createdAt: Date.now(), updatedAt: Date.now(), nodes: {}, rootChildren: [], rootActive: 0, leaf: null };
    setActiveSession(s);
    return s;
  }
  function pathNodes(s) {
    ensureTree(s);
    const path = [];
    const seen = new Set();
    let list = s.rootChildren, idx = s.rootActive, id = list[idx];
    while (id && s.nodes[id] && !seen.has(id)) {
      seen.add(id);
      const n = s.nodes[id];
      path.push(n);
      list = n.children;
      idx = n.active;
      id = list[idx];
    }
    return path;
  }
  function activeMessages(s) {
    return pathNodes(s).map((n) => ({ role: n.role, content: n.content, hidden: n.hidden }));
  }
  function appendMessage(s, msg) {
    ensureTree(s);
    const id = genId();
    const parent = s.leaf;
    s.nodes[id] = { id, parent, role: msg.role, content: msg.content, hidden: !!msg.hidden, children: [], active: 0 };
    if (parent) { const p = s.nodes[parent]; p.children.push(id); p.active = p.children.length - 1; }
    else { s.rootChildren.push(id); s.rootActive = s.rootChildren.length - 1; }
    s.leaf = id;
    return id;
  }
  function siblingsOf(s, node) {
    if (!node.parent) return { list: s.rootChildren, active: s.rootActive, setActive: (i) => (s.rootActive = i) };
    const p = s.nodes[node.parent];
    return { list: p.children, active: p.active, setActive: (i) => (p.active = i) };
  }
  function recomputeLeaf(s) {
    const p = pathNodes(s);
    s.leaf = p.length ? p[p.length - 1].id : null;
  }
  function hasMessages(s) {
    ensureTree(s);
    return s.rootChildren.length > 0;
  }
  function sessionForScope(ctx) {
    const { scopeKey } = scopeInfo(ctx);
    return (
      IF.sessionStore
        .all()
        .filter((x) => x.scopeKey === scopeKey)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0] || null
    );
  }
  function deriveTitle(s) {
    const u = pathNodes(s).find((n) => n.role === "user" && !n.hidden);
    const t = u ? u.content.filter((c) => c.type === "text").map((c) => c.text).join(" ") : "";
    return (t || "New chat").trim().slice(0, 48);
  }
  function commitSession() {
    const s = store.session;
    if (!s || !hasMessages(s)) return;
    if (!s.title) s.title = deriveTitle(s);
    s.updatedAt = Date.now();
    IF.sessionStore.upsert(s);
    IF.sessionStore.setActive(s.id);
    refreshSessionsUI();
  }
  function refreshSessionsUI() {
    IF.UI.renderSessions(IF.sessionStore.all(), store.session && store.session.id);
  }
  function activateSession(id) {
    const s = IF.sessionStore.get(id);
    if (!s || (store.session && store.session.id === id)) return;
    if (store.aborter) { store.aborter.abort(); store.aborter = null; IF.UI.setBusy(false); }
    commitSession();
    setActiveSession(s);
    store.currentState = null;
    IF.sessionStore.setActive(id);
    renderSession({});
    refreshSessionsUI();
  }
  function startNewChat() {
    if (store.session && !hasMessages(store.session)) return; // already fresh
    if (store.aborter) { store.aborter.abort(); store.aborter = null; IF.UI.setBusy(false); }
    commitSession();
    newSession(store.context);
    store.currentState = null;
    renderSession({});
    refreshSessionsUI();
  }
  function deleteSession(id) {
    IF.sessionStore.remove(id);
    if (!store.session || store.session.id === id) {
      const next = sessionForScope(store.context);
      if (next) setActiveSession(next);
      else newSession(store.context);
      store.currentState = null;
      renderSession({});
    }
    refreshSessionsUI();
  }

  // ---- init ------------------------------------------------------------

  async function ensureInit() {
    if (store.ready) return;
    if (store.initing) return store.initing;
    store.initing = (async () => {
      await IF.settings.load();
      await IF.sessionStore.load();
      IF.UI.mount();
      IF.UI.reflectMode(IF.settings.get("permissionMode"));
      IF.UI.onSend(handleSend);
      IF.UI.onStop(() => stopRun());
      IF.UI.onNewChat(() => startNewChat());
      IF.UI.onSelectSession((id) => activateSession(id));
      IF.UI.onDeleteSession((id) => deleteSession(id));
      IF.UI.onRegenerate((nodeId) => regenerateMessage(nodeId));
      IF.UI.onEditMessage((nodeId, newText) => editMessage(nodeId, newText));
      IF.UI.onDeleteMessage((nodeId) => deleteMessage(nodeId));
      IF.UI.onNavigate((nodeId, dir) => navigateVersion(nodeId, dir));

      // Establish the current context + active session up front.
      try {
        const ctx = await IF.bridge.call("getContext", {}, 8000);
        adoptContext(ctx, { render: true, announce: false });
      } catch {
        adoptContext(store.context, { render: true, announce: false });
      }
      refreshSessionsUI();

      try {
        await IF.bridge.call("ping", {}, 8000);
        const { catalog } = await IF.bridge.call("getCatalog", {}, 15000);
        store.catalog = catalog || [];
        IF.Lang.setCatalog(store.catalog);
        IF.UI.setStatus(`${store.catalog.length} node types loaded`, false);
        setTimeout(() => IF.UI.setStatus(""), 2500);
      } catch (e) {
        IF.UI.notify(
          "I couldn't reach n8n's internals yet. Make sure this is a fully loaded n8n page, then reopen me.",
          "error"
        );
      }
      store.ready = true;
    })();
    return store.initing;
  }

  // Switch the active session when the open workflow changes, and re-render.
  function adoptContext(ctx, opts) {
    opts = opts || {};
    const oldScope = store.session ? store.session.scopeKey : null;
    const { scopeKey } = scopeInfo(ctx);
    const changed = scopeKey !== oldScope;
    if (changed || !store.session) {
      commitSession();
      if (store.aborter) { store.stopped = true; store.aborter.abort(); store.aborter = null; IF.UI.setBusy(false); }
      IF.UI.cancelApprovals();
      const existing = sessionForScope(ctx);
      if (existing) setActiveSession(existing);
      else newSession(ctx);
      store.currentState = null;
    }
    store.context = ctx;
    IF.UI.setContext(ctx);
    if (opts.render) {
      renderSession({ announce: changed && opts.announce });
      refreshSessionsUI();
    }
  }

  function nodeText(n) {
    return (n.content || []).filter((c) => c.type === "text").map((c) => c.text).filter(Boolean).join("");
  }
  // {idx,total} version info if this node has sibling versions.
  function versionOf(s, n) {
    const sib = siblingsOf(s, n);
    return sib.list.length > 1 ? { idx: sib.active + 1, total: sib.list.length } : null;
  }
  function renderSession(opts) {
    opts = opts || {};
    const s = store.session;
    IF.UI.clearMessages(store.context);
    IF.UI.renderTodos((s && s.todos) || []);
    if (s) {
      for (const n of pathNodes(s)) {
        if (n.hidden) continue;
        if (n.role === "user") {
          const text = nodeText(n);
          if (text) IF.UI.addUser(text, { nodeId: n.id, version: versionOf(s, n) });
        } else if (n.role === "assistant") {
          const text = nodeText(n);
          if (text) IF.UI.renderAi(text, { nodeId: n.id, version: versionOf(s, n) });
          for (const c of n.content || []) if (c.type === "tool_call") IF.UI.addToolBadge(c.name, c.args);
        }
      }
    }
    if (opts.announce) {
      IF.UI.notify(
        store.context.inEditor
          ? `Switched to **${store.context.name || "this workflow"}** — its own conversation.`
          : "You're on the workflow list now — I can create a new workflow or find one by name."
      );
    }
  }

  // ---- tool handlers ---------------------------------------------------

  function searchNodes({ query }) {
    const q = String(query || "").toLowerCase().trim();
    const tokens = q.split(/\s+/).filter(Boolean);
    const scored = [];
    for (const e of store.catalog) {
      const hay = (e.displayName + " " + e.name + " " + (e.description || "")).toLowerCase();
      if (tokens.every((t) => hay.includes(t))) {
        let score = 0;
        if (e.displayName.toLowerCase() === q) score += 100;
        if (e.displayName.toLowerCase().startsWith(q)) score += 40;
        if (e.isTrigger && /trigger/.test(q)) score += 20;
        score -= e.displayName.length * 0.1;
        scored.push({ score, e });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, 20).map(({ e }) => ({
      node: e.name,
      displayName: e.displayName,
      versions: e.versions,
      isTrigger: e.isTrigger,
      description: e.description,
      usableAsTool: e.usableAsTool,
    }));
    return { count: results.length, results };
  }

  async function getNodeSchemaTool({ node, version }) {
    const res = IF.Lang.resolveRef(node);
    if (res.error) return { error: res.error };
    const name = res.entry.name;
    const key = name + "@" + (version || "latest");
    let schema = store.schemaCache.get(key);
    if (!schema) {
      const r = await IF.bridge.call("getSchema", { name, version });
      schema = r.schema;
      store.schemaCache.set(key, schema);
      if (schema) store.schemaCache.set(name + "@" + schema.defaultVersion, schema);
    }
    if (!schema) return { error: "No schema found for '" + node + "'." };
    return {
      node: schema.name,
      displayName: schema.displayName,
      versions: schema.versions,
      defaultVersion: schema.defaultVersion,
      credentials: schema.credentials,
      parameters: (schema.properties || []).slice(0, 80).map((p) => ({
        name: p.name,
        type: p.type,
        default: p.default,
        required: p.required,
        options: p.options,
        showWhen: p.displayOptions && p.displayOptions.show,
      })),
    };
  }

  async function getWorkflowTool() {
    if (!store.context.inEditor) return { error: "No workflow is open; there is nothing to read." };
    const state = await IF.bridge.call("getState", {}, 15000);
    store.currentState = state;
    return {
      name: state.name,
      workflowId: state.id,
      nodeCount: (state.nodes || []).length,
      active: state.active,
      source: state.source,
      issues: state.issues || [],
      iflang: IF.Lang.decompile(state),
    };
  }

  async function getExecutionTool() {
    return IF.bridge.call("getExecutionData", {}, 15000);
  }

  async function runWorkflowTool() {
    if (!store.context.inEditor) return { error: "No workflow is open to run." };
    try {
      const r = await IF.bridge.call("runWorkflow", {}, 15000);
      return { ok: true, note: "Execution started via " + (r.via || "n8n") + "." };
    } catch (e) {
      return { error: e.message };
    }
  }

  async function captureCanvasTool() {
    const dataUrl = await IF.captureScreenshot();
    if (!dataUrl) return { error: "Screenshot unavailable (permission denied or capture failed)." };
    IF.UI.addScreenshot(dataUrl);
    const m = /^data:(.+?);base64,(.*)$/.exec(dataUrl);
    if (!m) return { error: "Bad screenshot data." };
    return { __image: { mimeType: m[1], data: m[2] } };
  }

  // Compile IF-Lang with two passes so resource hints can use real schemas.
  // Schemas are fetched in PARALLEL (previously sequential — the main cause of
  // slow "Preparing changes…").
  async function compileWithSchemas(iflang) {
    const done = IF.time("compileWithSchemas");
    const first = IF.Lang.compile(iflang, {});
    const types = [...new Set(first.workflow.nodes.map((n) => n.type + "@" + n.typeVersion))];
    const missing = types.filter((t) => !store.schemaCache.has(t));
    IF.log("compile: " + first.workflow.nodes.length + " nodes, " + types.length + " types, fetching " + missing.length + " schemas");
    if (missing.length) {
      const st = IF.time("schemas(" + missing.length + ")");
      await Promise.all(
        missing.map(async (t) => {
          const at = t.lastIndexOf("@");
          const name = t.slice(0, at);
          const ver = t.slice(at + 1);
          try {
            const { schema } = await IF.bridge.call("getSchema", { name, version: Number(ver) }, 12000);
            store.schemaCache.set(t, schema);
          } catch (e) {
            IF.log("schema fetch failed for " + t + ": " + e.message);
            store.schemaCache.set(t, null);
          }
        })
      );
      st();
    }
    const getSchema = (name, ver) => store.schemaCache.get(name + "@" + ver) || null;
    const out = IF.Lang.compile(iflang, { getSchema });
    done();
    return out;
  }

  async function approve({ title, summary, currentIf, proposedIf, mode }) {
    const diff = lineDiff(currentIf || "", proposedIf);
    return IF.UI.requestApproval({ title, summary, iflang: proposedIf, diff, mode });
  }

  async function applyIfLangTool({ iflang, summary }) {
    if (!store.context.inEditor) {
      return { applied: false, error: "No workflow is open. On the workflow list I can only create a new workflow or search — open a workflow to edit it." };
    }
    const boundId = store.context.workflowId;
    let compiled;
    try {
      compiled = await compileWithSchemas(iflang);
    } catch (e) {
      return { applied: false, error: "IF-Lang did not compile: " + e.message };
    }
    const workflow = compiled.workflow;
    if (!workflow.nodes || workflow.nodes.length === 0) {
      return {
        applied: false,
        error: "I won't empty or delete a workflow. Provide the full workflow with at least one node; to remove nodes, keep the ones that should stay.",
      };
    }
    const mode = IF.settings.get("permissionMode");

    IF.UI.setStatus("Building preview…", true);
    let currentIf = "";
    try {
      const dg = IF.time("readState+decompile");
      const state = store.currentState || (await IF.bridge.call("getState", {}, 12000));
      store.currentState = state;
      currentIf = IF.Lang.decompile(state);
      dg();
    } catch (e) {
      IF.log("diff read failed: " + e.message);
      currentIf = "";
    }
    const proposedIf = IF.Lang.decompile({ name: workflow.name, nodes: workflow.nodes, connections: workflow.connections });

    if (mode !== "noperms") {
      IF.UI.setStatus("Waiting for your approval…", true);
      IF.log("apply: awaiting approval");
      const decision = await approve({
        title: mode === "plan" ? "Plan ready — apply to this workflow?" : "Apply to this workflow?",
        summary,
        currentIf,
        proposedIf,
        mode,
      });
      if (decision.cancelled) {
        IF.log("apply: cancelled (stopped)");
        return { applied: false, cancelled: true, note: "Stopped by the user before applying." };
      }
      if (!decision.approved) {
        IF.log("apply: rejected");
        return {
          applied: false,
          rejected: true,
          userNote: decision.note || "(no note)",
          hint: "The user rejected the change. Read their note and revise; do not re-apply the same thing.",
        };
      }
      IF.UI.setStatus("Applying to canvas…", true);
      const da = IF.time("applyWorkflow");
      const res = await IF.bridge.call("applyWorkflow", { workflow, opts: { expectedWorkflowId: boundId } }, 20000);
      da(res.nodeCount + " nodes");
      return { applied: true, nodeCount: res.nodeCount, issues: res.issues, note: res.note, warnings: compiled.warnings, userNote: decision.note || undefined };
    }

    IF.UI.setStatus("Applying to canvas…", true);
    const da = IF.time("applyWorkflow");
    const res = await IF.bridge.call("applyWorkflow", { workflow, opts: { expectedWorkflowId: boundId } }, 20000);
    da(res.nodeCount + " nodes");
    return { applied: true, nodeCount: res.nodeCount, issues: res.issues, note: res.note, warnings: compiled.warnings };
  }

  async function createWorkflowTool({ name, iflang, summary }) {
    if (store.context.inEditor) {
      return { created: false, error: "A workflow is already open; I only create new workflows from the workflow list. Go to the list to start a new one." };
    }
    let workflow = { name, nodes: [], connections: {} };
    let warnings = [];
    if (iflang && iflang.trim()) {
      try {
        const compiled = await compileWithSchemas(iflang);
        workflow = { name, nodes: compiled.workflow.nodes, connections: compiled.workflow.connections };
        warnings = compiled.warnings;
      } catch (e) {
        return { created: false, error: "IF-Lang did not compile: " + e.message };
      }
    }
    const proposedIf = IF.Lang.decompile({ name, nodes: workflow.nodes, connections: workflow.connections });
    const mode = IF.settings.get("permissionMode");

    if (mode !== "noperms") {
      const decision = await approve({
        title: `Create workflow “${name}”?`,
        summary: summary || `Create a new workflow named “${name}”.`,
        currentIf: "",
        proposedIf,
        mode,
      });
      if (!decision.approved) {
        return { created: false, rejected: true, userNote: decision.note || "(no note)", hint: "User rejected creation; revise per their note." };
      }
    }
    let res;
    try {
      res = await IF.bridge.call("createWorkflow", { name, workflow }, 20000);
    } catch (e) {
      return { created: false, error: e.message };
    }
    // Carry this conversation into the new workflow: retag the active session's
    // scope so the SPA navigation keeps it active on the new workflow.
    if (res && res.id && store.session) {
      store.session.scopeKey = "wf:" + res.id;
      store.session.scopeLabel = res.name || name;
      commitSession();
    }
    return { created: true, id: res.id, name: res.name, nodeCount: res.nodeCount, warnings };
  }

  async function searchWorkflowsTool({ query }) {
    if (store.context.inEditor) {
      return { error: "You're inside a workflow; searching other workflows is only available from the workflow list." };
    }
    return IF.bridge.call("searchWorkflows", { query }, 15000);
  }

  // Credential metadata only (id, name, type) — no secrets ever leave the page.
  async function searchCredentialsTool({ query }) {
    return IF.bridge.call("searchCredentials", { query }, 15000);
  }

  // ---- todo checklist (per session) ------------------------------------
  function todos() {
    if (store.session && !store.session.todos) store.session.todos = [];
    return (store.session && store.session.todos) || [];
  }
  function createTodoTool({ items }) {
    if (!store.session) return { error: "No active session." };
    store.session.todos = (items || []).map((t) => ({ text: String(t), done: false }));
    IF.UI.renderTodos(store.session.todos);
    commitSession();
    return { ok: true, todos: store.session.todos };
  }
  function editTodoTool({ index, done, text }) {
    const list = todos();
    const it = list[index];
    if (!it) return { error: "No todo item at index " + index };
    if (done != null) it.done = !!done;
    if (text != null) it.text = String(text);
    IF.UI.renderTodos(list);
    commitSession();
    return { ok: true, todos: list };
  }
  function readTodoTool() {
    return { todos: todos() };
  }

  // ---- ask the user a choice (turn-ending) -----------------------------
  function askUserTool({ question, options, multiple }) {
    IF.UI.askQuestion({ question, options: options || [], multiple: !!multiple }, (answer) => {
      handleSend(answer);
    });
    return { __askUser: true };
  }

  const toolHandlers = {
    search_nodes: searchNodes,
    get_node_schema: getNodeSchemaTool,
    get_workflow: getWorkflowTool,
    get_execution_data: getExecutionTool,
    apply_iflang: applyIfLangTool,
    run_workflow: runWorkflowTool,
    capture_canvas: captureCanvasTool,
    create_workflow: createWorkflowTool,
    search_workflows: searchWorkflowsTool,
    search_credentials: searchCredentialsTool,
    create_todo: createTodoTool,
    edit_todo: editTodoTool,
    read_todo: readTodoTool,
    ask_user: askUserTool,
  };

  function toolsForContext(ctx) {
    return ctx.inEditor ? IF.AI.EDITOR_TOOLS : IF.AI.LIST_TOOLS;
  }

  // ---- send / chat loop ------------------------------------------------

  function modeContext() {
    const mode = IF.settings.get("permissionMode");
    if (!store.context.inEditor) {
      const base =
        "Context: WORKFLOW LIST. No workflow is open. You may ONLY create a new workflow (create_workflow) " +
        "or search existing workflows by name (search_workflows). Do not attempt to open or edit existing workflows.";
      if (mode === "noperms") return base + " Permission mode NO-PERMS: create without asking.";
      return base + " Creating a workflow will show the user a preview to confirm first.";
    }
    if (mode === "plan")
      return (
        "Context: WORKFLOW EDITOR, locked to this workflow. Permission mode PLAN — work AUTONOMOUSLY. " +
        "First post a short numbered plan, then execute it end-to-end WITHOUT pausing to ask the user to continue. " +
        "Verify node names/versions with search_nodes / get_node_schema and wire auth via search_credentials before applying. " +
        "If a tool returns an error or apply_iflang fails to compile, DIAGNOSE it from the error message and fix it yourself: " +
        "inspect the relevant node schema, correct parameter names/versions/structure, and retry — iterate until it works or " +
        "you have exhausted reasonable options. Make sensible default assumptions instead of asking clarifying questions. " +
        "The user only confirms the final write in Ask contexts; in Plan you should push through obstacles on your own and " +
        "only stop to report once the workflow is working or genuinely blocked (e.g. a missing credential you cannot create)."
      );
    if (mode === "noperms")
      return "Context: WORKFLOW EDITOR, locked to this workflow. Permission mode NO-PERMS: use read tools freely and apply changes directly without asking, but explain what you did.";
    return (
      "Context: WORKFLOW EDITOR, locked to this workflow. Permission mode ASK. Reading/inspecting is free — proactively " +
      "call get_workflow, search_nodes, get_node_schema, etc. whenever helpful, and never ask the user to pick or read a " +
      "workflow (one is already open). ASK only gates WRITES: when you call apply_iflang the user is shown a diff and must " +
      "accept before anything is written."
    );
  }

  async function grounding() {
    if (!store.context.inEditor) {
      return "The user is on the workflow list. Offer to create a new workflow or find one by name.";
    }
    try {
      store.currentState = await IF.bridge.call("getState", {}, 12000);
      return (
        `A workflow named "${store.context.name || store.currentState.name || ""}" is already open and readable — ` +
        "never ask the user to choose or point you at a workflow. Its current contents (IF-Lang) are below; call " +
        "get_workflow yourself if you need to re-read it after changes.\n```\n" +
        IF.Lang.decompile(store.currentState) +
        "\n```"
      );
    } catch {
      return "A workflow is open — call get_workflow to read it. Do not ask the user which workflow to inspect.";
    }
  }

  // Stop everything: abort the in-flight request, cancel any pending approval,
  // and reset the UI — even if a tool is mid-execution.
  function stopRun() {
    IF.log("stopped by user");
    store.stopped = true;
    if (store.aborter) store.aborter.abort();
    IF.UI.cancelApprovals();
    IF.UI.setBusy(false);
    IF.UI.notify("Stopped.");
  }

  async function handleSend(text) {
    await ensureInit();
    if (store.aborter) return; // already running
    const providerKey = IF.settings.get("provider");
    const prov = IF.AI.PROVIDERS[providerKey];
    const cfg = IF.settings.providerConfig(providerKey);
    if (prov && prov.needsKey && !cfg.apiKey) {
      addUserTurn(text);
      IF.UI.notify(`Add an API key for **${prov.label}** in settings (the gear icon).`, "error");
      commitSession();
      return;
    }
    if (prov && prov.curl && !cfg.curlTemplate) {
      addUserTurn(text);
      IF.UI.notify("Paste a cURL command in settings for the Custom (cURL) provider — use `{{PROMPT}}` where the message goes.", "error");
      commitSession();
      return;
    }
    addUserTurn(text);
    await runConversation();
  }

  function addUserTurn(text) {
    appendMessage(store.session, { role: "user", content: [{ type: "text", text }] });
    renderSession({});
  }

  // Runs the model over the current active path. New turns (assistant / tool /
  // nudge) are reconciled back into the conversation tree when it finishes.
  async function runConversation() {
    const providerKey = IF.settings.get("provider");
    const cfg = IF.settings.providerConfig(providerKey);
    const s = store.session;
    IF.UI.setBusy(true, "Thinking…");
    store.stopped = false;
    store.aborter = new AbortController();
    IF.log("send: provider=" + providerKey + " model=" + (cfg.model || "?") + " mode=" + IF.settings.get("permissionMode"));

    const ground = await grounding();
    if (store.session !== s) { IF.UI.setBusy(false); store.aborter = null; return; }

    const full = activeMessages(s);
    const MAX = 40; // cap what the model sees; the tree keeps everything
    store.history = full.length > MAX ? full.slice(-MAX) : full.slice();
    const preLen = store.history.length;

    let toolTimer = null;
    let errored = false;
    try {
      await IF.AI.chat({
        providerKey,
        config: cfg,
        history: store.history,
        userParts: null,
        langSpec: IF.Lang.spec(),
        extraContext: modeContext() + "\n\n" + ground,
        tools: toolsForContext(store.context),
        toolHandlers,
        onTurnStart: (i) => { if (i > 0) IF.UI.endAi(); },
        onDelta: (d) => IF.UI.appendAi(d),
        onToolCall: (name, args) => { IF.UI.endAi(); IF.UI.addToolBadge(name, args); IF.UI.setStatus(statusFor(name), true); IF.log("tool → " + name, args); toolTimer = IF.time("tool " + name); },
        onToolResult: (name, result) => { if (toolTimer) { toolTimer(result && result.error ? "ERROR: " + result.error : "ok"); toolTimer = null; } IF.UI.setStatus("Thinking…", true); },
        signal: store.aborter.signal,
        maxIterations: IF.settings.get("permissionMode") === "plan" ? 18 : 10,
      });
      IF.UI.endAi();
    } catch (e) {
      IF.UI.endAi();
      if (e.name === "AbortError" || store.stopped) {
        /* stop already reported by stopRun */
      } else { errored = true; IF.UI.notify("Something went wrong: " + e.message, "error"); }
    } finally {
      IF.UI.setBusy(false);
      store.aborter = null;
      for (let i = preLen; i < store.history.length; i++) appendMessage(s, store.history[i]);
      // Re-render to attach node ids / version nav / actions on success. On
      // error or stop, keep the live bubbles + the notice instead of wiping it.
      if (!errored && !store.stopped) renderSession({});
      commitSession();
    }
  }

  // ---- message actions (versioned conversation tree) -------------------

  function regenerateMessage(nodeId) {
    if (store.aborter) return;
    const s = store.session;
    const path = pathNodes(s);
    const i = path.findIndex((n) => n.id === nodeId);
    if (i < 0) return;
    let u = null;
    for (let j = i - 1; j >= 0; j--) if (path[j].role === "user" && !path[j].hidden) { u = path[j]; break; }
    if (!u) return;
    u.active = u.children.length; // end the active path at the prompt; the run branches a new reply
    recomputeLeaf(s);
    renderSession({});
    runConversation();
  }

  function editMessage(nodeId, newText) {
    if (store.aborter) return;
    const s = store.session;
    const n = s.nodes[nodeId];
    if (!n || n.role !== "user") return;
    if (!newText || !newText.trim()) return;
    if (n.parent) s.nodes[n.parent].active = s.nodes[n.parent].children.length;
    else s.rootActive = s.rootChildren.length;
    recomputeLeaf(s); // active path now ends just before the old prompt
    appendMessage(s, { role: "user", content: [{ type: "text", text: newText }] }); // new sibling version
    renderSession({});
    runConversation();
  }

  function navigateVersion(nodeId, dir) {
    if (store.aborter) return;
    const s = store.session;
    const n = s.nodes[nodeId];
    if (!n) return;
    const sib = siblingsOf(s, n);
    const ni = Math.max(0, Math.min(sib.list.length - 1, sib.active + dir));
    if (ni === sib.active) return;
    sib.setActive(ni);
    recomputeLeaf(s);
    renderSession({});
    commitSession();
  }

  async function deleteMessage(nodeId) {
    if (store.aborter) return;
    const s = store.session;
    const n = s.nodes[nodeId];
    if (!n) return;
    const ok = await IF.UI.confirm({
      title: "Delete this prompt?",
      body: "This deletes the prompt and every message after it. This can't be undone.",
      confirm: "Delete",
    });
    if (!ok) return;
    const sib = siblingsOf(s, n);
    const idx = sib.list.indexOf(nodeId);
    if (idx < 0) return;
    // Remove the node and its entire subtree (everything after it).
    const stack = [nodeId];
    while (stack.length) {
      const id = stack.pop();
      const nn = s.nodes[id];
      if (!nn) continue;
      stack.push(...nn.children);
      delete s.nodes[id];
    }
    sib.list.splice(idx, 1);
    const parent = n.parent ? s.nodes[n.parent] : null;
    const na = sib.list.length ? Math.min(idx, sib.list.length - 1) : 0;
    if (parent) parent.active = na;
    else s.rootActive = na;
    recomputeLeaf(s);
    renderSession({});
    commitSession();
  }

  function statusFor(name) {
    return (
      {
        search_nodes: "Searching nodes…",
        get_node_schema: "Reading node schema…",
        get_workflow: "Reading workflow…",
        get_execution_data: "Reading execution…",
        apply_iflang: "Preparing changes…",
        run_workflow: "Running workflow…",
        capture_canvas: "Capturing screenshot…",
        create_workflow: "Creating workflow…",
        search_workflows: "Searching workflows…",
      }[name] || "Working…"
    );
  }

  IF.bridge.on("context-changed", (ctx) => {
    if (!store.ready && !store.initing) return;
    adoptContext(ctx, { render: true, announce: true });
  });

  // Content-based detection: badge the toolbar icon, and if the panel opened
  // before n8n finished loading, backfill the node catalog now.
  IF.bridge.on("n8n-detected", async () => {
    store.detected = true;
    try {
      chrome.runtime.sendMessage({ type: "INTELLIFLOW_DETECTED" });
    } catch {
      /* ignore */
    }
    if (store.ready && !store.catalog.length) {
      try {
        const { catalog } = await IF.bridge.call("getCatalog", {}, 15000);
        store.catalog = catalog || [];
        IF.Lang.setCatalog(store.catalog);
      } catch {
        /* ignore */
      }
    }
  });

  // ---- line diff (LCS) -------------------------------------------------

  function lineDiff(a, b) {
    const A = (a || "").split("\n");
    const B = (b || "").split("\n");
    const n = A.length, m = B.length;
    const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (A[i] === B[j]) { out.push({ type: "ctx", text: A[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: A[i] }); i++; }
      else { out.push({ type: "add", text: B[j] }); j++; }
    }
    while (i < n) out.push({ type: "del", text: A[i++] });
    while (j < m) out.push({ type: "add", text: B[j++] });
    return collapse(out);
  }

  function collapse(lines) {
    const res = [];
    let run = [];
    const flush = () => {
      if (run.length > 6) {
        res.push(run[0], run[1]);
        res.push({ type: "ctx", text: `… ${run.length - 4} unchanged lines …` });
        res.push(run[run.length - 2], run[run.length - 1]);
      } else res.push(...run);
      run = [];
    };
    for (const l of lines) {
      if (l.type === "ctx") run.push(l);
      else { flush(); res.push(l); }
    }
    flush();
    return res;
  }

  // ---- toggle wiring ---------------------------------------------------

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "INTELLIFLOW_TOGGLE") {
      if (!IF.UI.host) ensureInit();
      else IF.UI.toggle();
    }
  });

  // ---- floating launcher (only on pages that mention n8n) --------------

  function pageMentionsN8n() {
    try {
      if (/n8n/i.test(location.href)) return true;
      if (/n8n/i.test(document.title || "")) return true;
      const t = document.body && document.body.innerText ? document.body.innerText.slice(0, 8000) : "";
      if (/n8n/i.test(t)) return true;
    } catch {
      /* ignore */
    }
    return false;
  }

  (function setupLauncher() {
    let mounted = false;
    const tryMount = () => {
      if (mounted || IF.UI.launcherHost) return;
      if (pageMentionsN8n()) {
        mounted = true;
        IF.UI.mountLauncher(() => {
          if (!IF.UI.host) ensureInit();
          else IF.UI.show();
        });
      }
    };
    tryMount();
    // Retry for SPA / late-loading content.
    if (!mounted) {
      setTimeout(tryMount, 2500);
      setTimeout(tryMount, 6000);
    }
  })();
})();
