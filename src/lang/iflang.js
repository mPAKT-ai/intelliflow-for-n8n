// IntelliFlow for n8n — IF-Lang.
//
// A small, readable "pipeline" language for describing n8n workflows. It is
// deliberately NOT tied to n8n's JSON: it compiles to/from workflow JSON, and
// all node/version/parameter resolution happens dynamically against the live
// node catalog pulled from the running n8n instance. That means IF-Lang gains
// new nodes and versions automatically as the server changes — nothing here is
// hard-coded to a fixed node set.
//
//   workflow "Lead sync" {
//     trigger Webhook@2 as hook { path: "/lead" }
//     hook -> HTTP.request@4.4 as fetch {
//       method: GET
//       url: "https://api.example.com/{{ $json.id }}"
//     }
//     fetch -> IF as gate { $json.status == "ok" }
//     gate.true -> Slack.message@2 as notify { channel: "#leads" }
//   }

(function () {
  "use strict";

  const IF = (window.IF = window.IF || {});

  // ---- Catalog + node resolution ----------------------------------------

  let CATALOG = [];
  let INDEX = new Map(); // normalized key -> catalog entry

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  }

  function shortName(fullName) {
    const dot = fullName.lastIndexOf(".");
    return dot >= 0 ? fullName.slice(dot + 1) : fullName;
  }

  function setCatalog(catalog) {
    CATALOG = Array.isArray(catalog) ? catalog : [];
    INDEX = new Map();
    for (const e of CATALOG) {
      const keys = new Set([norm(e.name), norm(shortName(e.name)), norm(e.displayName)]);
      for (const k of keys) {
        if (k && !INDEX.has(k)) INDEX.set(k, e);
      }
    }
  }

  // Resolve a friendly reference like "HTTP.request", "Slack.message", "IF",
  // or a raw "n8n-nodes-base.httpRequest" to a concrete catalog entry.
  // The part after a dot may be a resource/operation hint (e.g. Slack.message).
  function resolveRef(ref) {
    const raw = String(ref || "").trim();
    if (!raw) return { error: "Empty node reference" };

    // Exact catalog name first.
    let entry = CATALOG.find((e) => e.name === raw);
    if (entry) return { entry, hint: null };

    // Whole-ref normalized match (e.g. "HTTP.request" -> "HTTP Request").
    entry = INDEX.get(norm(raw));
    if (entry) return { entry, hint: null };

    // Split "Service.hint" and match on the service, keep hint for resource/op.
    if (raw.includes(".") && !raw.startsWith("n8n-nodes")) {
      const head = raw.slice(0, raw.indexOf("."));
      const hint = raw.slice(raw.indexOf(".") + 1);
      entry = INDEX.get(norm(head));
      if (entry) return { entry, hint };
    }

    // Fuzzy: unique startsWith on normalized display/name.
    const nq = norm(raw);
    const matches = CATALOG.filter(
      (e) => norm(e.displayName).startsWith(nq) || norm(shortName(e.name)).startsWith(nq)
    );
    if (matches.length === 1) return { entry: matches[0], hint: null };

    const suggestions = (matches.length ? matches : CATALOG)
      .filter((e) => norm(e.displayName).includes(nq))
      .slice(0, 6)
      .map((e) => e.displayName);
    return {
      error: `Unknown node "${raw}".` + (suggestions.length ? " Did you mean: " + suggestions.join(", ") + "?" : ""),
    };
  }

  function pickVersion(entry, requested) {
    const versions = (entry.versions || []).slice().sort((a, b) => a - b);
    if (requested != null) {
      const r = Number(requested);
      if (versions.includes(r)) return r;
      // Nearest not-greater, else latest.
      const le = versions.filter((v) => v <= r);
      return le.length ? le[le.length - 1] : versions[versions.length - 1] || 1;
    }
    return versions[versions.length - 1] || 1;
  }

  // ---- Lexer -------------------------------------------------------------

  function lex(src) {
    const toks = [];
    let i = 0;
    let line = 1;
    const n = src.length;
    const push = (type, value) => toks.push({ type, value, line });

    while (i < n) {
      const c = src[i];
      if (c === "\n") {
        push("nl");
        line++;
        i++;
        continue;
      }
      if (c === " " || c === "\t" || c === "\r") {
        i++;
        continue;
      }
      // Comments: // ... or # ...
      if ((c === "/" && src[i + 1] === "/") || c === "#") {
        while (i < n && src[i] !== "\n") i++;
        continue;
      }
      // Arrow
      if (c === "-" && src[i + 1] === ">") {
        push("arrow");
        i += 2;
        continue;
      }
      // Strings (single or double), preserve raw contents
      if (c === '"' || c === "'") {
        const quote = c;
        let s = "";
        i++;
        while (i < n && src[i] !== quote) {
          if (src[i] === "\\" && i + 1 < n) {
            s += src[i + 1];
            i += 2;
          } else {
            s += src[i];
            i++;
          }
        }
        i++; // closing quote
        push("string", s);
        continue;
      }
      // Punctuation
      if ("{}[]:,@".includes(c)) {
        push("punct", c);
        i++;
        continue;
      }
      if (c === ".") {
        push("dot");
        i++;
        continue;
      }
      // Bare token: identifiers, numbers, expressions ({{...}} handled as part
      // of strings normally, but allow bare runs for values/conditions).
      let s = "";
      while (i < n && !" \t\r\n{}[]:,@".includes(src[i]) && !(src[i] === "-" && src[i + 1] === ">")) {
        if (src[i] === ".") break;
        if (src[i] === "/" && src[i + 1] === "/") break;
        s += src[i];
        i++;
      }
      if (s) push("word", s);
      else i++;
    }
    push("eof");
    return toks;
  }

  // ---- Parser ------------------------------------------------------------
  // Produces an intermediate model: { name, decls: {alias->node}, edges: [] }.

  function parse(src) {
    const toks = lex(src);
    let p = 0;
    const warnings = [];

    const peek = (k = 0) => toks[p + k] || { type: "eof" };
    const at = (type, value) => peek().type === type && (value === undefined || peek().value === value);
    const next = () => toks[p++];
    const skipNl = () => {
      while (at("nl")) p++;
    };
    const err = (m) => {
      const t = peek();
      throw new Error(`IF-Lang parse error (line ${t.line || "?"}): ${m}`);
    };

    const model = { name: null, order: [], decls: {}, edges: [] };
    let anon = 0;

    skipNl();
    // optional: workflow "Name" { ... }
    if (at("word", "workflow")) {
      next();
      if (at("string")) model.name = next().value;
      skipNl();
      if (at("punct", "{")) next();
      else err('expected "{" after workflow name');
    }

    // Parse a dotted reference like HTTP.request or an alias.token
    function readRef() {
      if (!at("word") && !at("string")) return null;
      let s = at("string") ? next().value : next().value;
      while (at("dot")) {
        next();
        if (at("word") || at("string")) s += "." + next().value;
        else break;
      }
      return s;
    }

    // Parse @version, including decimals like @4.4 (dot-separated numbers).
    function readVersion() {
      if (at("punct", "@")) {
        next();
        let v = "";
        if (at("word") || at("string")) v = next().value;
        while (at("dot") && peek(1).type === "word" && /^\d+$/.test(peek(1).value)) {
          next();
          v += "." + next().value;
        }
        return v || null;
      }
      return null;
    }

    // Parse a value (string | number | bool | null | array | object | bare expr)
    function readValue() {
      skipInlineNl();
      if (at("string")) return { kind: "string", value: next().value };
      if (at("punct", "[")) return readArray();
      if (at("punct", "{")) return { kind: "object", value: readParamBlock() };
      // bare run: collect words/dots/@ until newline or , or } or ]
      let parts = [];
      while (!at("nl") && !at("eof") && !at("punct", ",") && !at("punct", "}") && !at("punct", "]")) {
        const t = next();
        if (t.type === "word") parts.push(t.value);
        else if (t.type === "dot") parts.push(".");
        else if (t.type === "string") parts.push(JSON.stringify(t.value));
        else if (t.type === "punct") parts.push(t.value);
        else if (t.type === "arrow") parts.push("->");
      }
      const raw = joinBare(parts);
      return { kind: "bare", value: raw };
    }

    function joinBare(parts) {
      let out = "";
      for (let k = 0; k < parts.length; k++) {
        const cur = parts[k];
        if (cur === ".") {
          out = out.replace(/\s+$/, "") + ".";
        } else if (out.endsWith(".")) {
          out += cur;
        } else {
          out += (out ? " " : "") + cur;
        }
      }
      return out.trim();
    }

    function skipInlineNl() {
      // do not skip; newlines are significant separators inside blocks
    }

    function readArray() {
      next(); // [
      const arr = [];
      skipNl();
      while (!at("punct", "]") && !at("eof")) {
        arr.push(readValue());
        skipNl();
        if (at("punct", ",")) {
          next();
          skipNl();
        }
      }
      if (at("punct", "]")) next();
      return { kind: "array", value: arr };
    }

    // Parse { key: value ... } param block; returns {pairs:{}, bare:string|null}
    function readParamBlock() {
      next(); // {
      const pairs = {};
      let bare = null;
      skipNl();
      while (!at("punct", "}") && !at("eof")) {
        // A bare boolean/expression block (e.g. IF condition): no leading key:
        if (looksLikeBareExpr()) {
          const v = readValue();
          bare = v.value;
          skipNl();
          if (at("punct", ",")) next();
          skipNl();
          continue;
        }
        const key = at("string") ? next().value : at("word") ? next().value : null;
        if (key === null) {
          warnings.push(`Skipped unrecognized token in block near line ${peek().line}`);
          next();
          continue;
        }
        if (!at("punct", ":")) {
          // key with no colon -> treat whole thing as bare expression fallback
          bare = key;
          skipNl();
          continue;
        }
        next(); // :
        const val = readValue();
        pairs[key] = val;
        skipNl();
        if (at("punct", ",")) {
          next();
          skipNl();
        }
      }
      if (at("punct", "}")) next();
      return { pairs, bare };
    }

    // Heuristic: is the next block content a bare expression rather than key:value?
    function looksLikeBareExpr() {
      // Look ahead on the current logical line for a top-level ':' before newline.
      let k = 0;
      let depth = 0;
      while (true) {
        const t = peek(k);
        if (t.type === "eof" || t.type === "nl") break;
        if (t.type === "punct" && (t.value === "{" || t.value === "[")) depth++;
        if (t.type === "punct" && (t.value === "}" || t.value === "]")) {
          if (depth === 0) break;
          depth--;
        }
        if (t.type === "punct" && t.value === ":" && depth === 0) return false;
        k++;
      }
      // No colon on this line -> it's a bare expression (like a condition).
      // But an empty block "{}" is not bare.
      return !(peek().type === "punct" && peek().value === "}");
    }

    // Parse a single node declaration (after we already know a ref is next).
    // Returns alias.
    function readNodeDecl() {
      const isTrigger = at("word", "trigger");
      if (isTrigger) next();
      const ref = readRef();
      if (!ref) err("expected a node reference");
      const version = readVersion();
      let alias = null;
      if (at("word", "as")) {
        next();
        alias = at("word") || at("string") ? next().value : null;
      }
      let block = { pairs: {}, bare: null };
      // optional block, possibly on the next line
      const save = p;
      skipNl();
      if (at("punct", "{")) block = readParamBlock();
      else p = save;

      if (!alias) alias = suggestAlias(ref);
      // de-dupe alias
      let a = alias;
      let c = 2;
      while (model.decls[a]) a = alias + c++;
      alias = a;

      model.decls[alias] = { ref, version, block, isTrigger };
      model.order.push(alias);
      return alias;
    }

    function suggestAlias(ref) {
      const base = ref.replace(/^n8n-nodes-[a-z]+\./, "").split(".")[0];
      let s = base.replace(/[^A-Za-z0-9]/g, "");
      s = s.charAt(0).toLowerCase() + s.slice(1);
      return s || "node" + ++anon;
    }

    // Parse an "endpoint" in a pipeline: either an existing alias reference
    // (word optionally .outlet) or a new node declaration.
    function readEndpoint() {
      // A new node decl is indicated by @version, "as", a following block, or a
      // ref that is not an existing alias. We decide by peeking.
      const startRef = at("word", "trigger");
      const refTok = peek();
      // Grab the reference string (may include dotted outlet for aliases)
      const ref = (function lookRef() {
        let k = 0;
        let s = "";
        const rd = () => toks[p + k] || { type: "eof" };
        if (rd().type === "word" && rd().value === "trigger") return "__decl__";
        if (rd().type !== "word" && rd().type !== "string") return null;
        s = rd().value;
        k++;
        while (rd().type === "dot") {
          k++;
          if (rd().type === "word" || rd().type === "string") {
            s += "." + rd().value;
            k++;
          } else break;
        }
        return s;
      })();

      if (ref === "__decl__") return { alias: readNodeDecl(), outlet: "main", inlet: 0 };

      // Is the head an existing alias? Then this is a reference w/ optional outlet.
      const head = ref ? ref.split(".")[0] : null;
      const nextIsDeclSignal = (function () {
        // look past the ref tokens for @ or 'as' or '{'
        let k = 0;
        const rd = () => toks[p + k] || { type: "eof" };
        // consume ref tokens
        if (rd().type === "word" || rd().type === "string") {
          k++;
          while (rd().type === "dot") {
            k++;
            if (rd().type === "word" || rd().type === "string") k++;
          }
        }
        if (rd().type === "punct" && rd().value === "@") return true;
        if (rd().type === "word" && rd().value === "as") return true;
        // block on same or next line
        let j = k;
        while ((toks[p + j] || {}).type === "nl") j++;
        if ((toks[p + j] || {}).type === "punct" && (toks[p + j] || {}).value === "{") return true;
        return false;
      })();

      if (head && model.decls[head] && !nextIsDeclSignal) {
        // existing alias reference with optional .outlet
        const full = readRef();
        const parts = full.split(".");
        const alias = parts[0];
        const outlet = parts[1] || "main";
        return { alias, outlet, inlet: 0 };
      }

      // Otherwise it's a new node declaration.
      return { alias: readNodeDecl(), outlet: "main", inlet: 0 };
    }

    // Explicit connection reference: <alias-or-id>[:port | .port]
    function readConnectRef() {
      const ref = at("string") || at("word") ? next().value : null;
      let port = null;
      if (at("dot")) {
        next();
        if (at("word") || at("string")) port = next().value;
      } else if (at("punct", ":")) {
        next();
        if (at("word") || at("string")) port = next().value;
      }
      return { ref, port };
    }

    // ---- statement loop ----
    skipNl();
    while (!at("eof") && !(at("punct", "}") && model.name !== null)) {
      if (at("punct", "}")) {
        next();
        break;
      }
      skipNl();
      if (at("eof")) break;

      // Explicit connection: connect <ref>[:port] -> <ref>[:port] [-> ...]
      if (at("word", "connect")) {
        next();
        let l = readConnectRef();
        skipNl();
        while (at("arrow")) {
          next();
          skipNl();
          const r = readConnectRef();
          model.edges.push({ from: l.ref, outlet: l.port, to: r.ref, inlet: r.port });
          l = { ref: r.ref, port: null };
          skipNl();
        }
        skipNl();
        continue;
      }

      // First endpoint
      let left = readEndpoint();
      skipNl();
      // chain of arrows
      while (at("arrow")) {
        next();
        skipNl();
        const right = readEndpoint();
        model.edges.push({
          from: left.alias,
          outlet: left.outlet || "main",
          to: right.alias,
          inlet: right.inlet || 0,
        });
        left = { alias: right.alias, outlet: "main" };
        skipNl();
      }
      skipNl();
    }

    return { model, warnings };
  }

  // ---- Compile model -> n8n workflow JSON --------------------------------

  function outletToConnType(outlet) {
    outlet = outlet == null ? "main" : String(outlet);
    if (!outlet || outlet === "main") return { type: "main", index: 0 };
    if (outlet === "true") return { type: "main", index: 0 };
    if (outlet === "false") return { type: "main", index: 1 };
    if (/^\d+$/.test(outlet)) return { type: "main", index: parseInt(outlet, 10) };
    if (outlet.startsWith("ai_")) return { type: outlet, index: 0 };
    return { type: "main", index: 0 };
  }

  function portIndex(port) {
    if (port == null) return 0;
    const s = String(port);
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    if (s === "false") return 1;
    return 0;
  }

  function normalizePos(v) {
    if (Array.isArray(v)) return [Number(v[0]) || 0, Number(v[1]) || 0];
    if (v && typeof v === "object") return [Number(v.x) || 0, Number(v.y) || 0];
    return null;
  }

  function toN8nValue(v) {
    if (v == null) return v;
    switch (v.kind) {
      case "string":
        return coerceString(v.value);
      case "array":
        return v.value.map(toN8nValue);
      case "object":
        return blockToObject(v.value);
      case "bare":
        return coerceBare(v.value);
      default:
        return v.value;
    }
  }

  function coerceString(s) {
    // n8n expressions: a value containing {{ }} is stored as "=..." unless the
    // author already wrote a leading "=".
    if (typeof s === "string" && s.includes("{{") && s.includes("}}")) {
      return s.startsWith("=") ? s : "=" + s;
    }
    return s;
  }

  function coerceBare(s) {
    const t = String(s).trim();
    if (t === "true") return true;
    if (t === "false") return false;
    if (t === "null") return null;
    if (t !== "" && !isNaN(Number(t)) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
    return coerceString(t);
  }

  function blockToObject(block) {
    const obj = {};
    for (const [k, v] of Object.entries(block.pairs || {})) obj[k] = toN8nValue(v);
    return obj;
  }

  // Build IF/Filter condition structure from a bare boolean expression.
  function buildBooleanCondition(expr) {
    const left = expr.includes("{{") ? coerceString(expr) : "={{ " + expr + " }}";
    return {
      options: { caseSensitive: true, leftValue: "", typeValidation: "loose", version: 2 },
      conditions: {
        combinator: "and",
        conditions: [
          {
            id: cheapId(),
            leftValue: left,
            rightValue: "",
            operator: { type: "boolean", operation: "true", singleValue: true },
          },
        ],
      },
      combinator: "and",
    };
  }

  function cheapId() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function applyResourceHint(params, schema, hint) {
    if (!hint || !schema) return;
    // If the node has a "resource" option matching the hint, set it.
    const resProp = (schema.properties || []).find((p) => p.name === "resource" && p.options);
    if (resProp) {
      const opt = resProp.options.find(
        (o) => norm(o.value) === norm(hint) || norm(o.name) === norm(hint)
      );
      if (opt && params.resource === undefined) params.resource = opt.value;
    }
  }

  function compile(src, opts) {
    opts = opts || {};
    const { model, warnings } = parse(src);
    const nodes = [];
    const refToName = {}; // alias OR explicit id -> node name
    const usedNames = new Set();
    const explicitPos = new Set(); // node names whose position the author set

    for (const alias of model.order) {
      const decl = model.decls[alias];
      const res = resolveRef(decl.ref);
      if (res.error) throw new Error(res.error);
      const entry = res.entry;
      const version = pickVersion(entry, decl.version);

      const params = blockToObject({ pairs: decl.block.pairs });
      const schema = opts.getSchema ? opts.getSchema(entry.name, version) : null;
      applyResourceHint(params, schema, res.hint);

      // IF / Filter sugar: a bare boolean block -> conditions structure.
      const isCondition = /\.(if|filter)$/i.test(entry.name);
      if (decl.block.bare && isCondition && params.conditions === undefined) {
        Object.assign(params, buildBooleanCondition(decl.block.bare));
      } else if (decl.block.bare && params.__expr === undefined) {
        warnings.push(`Ignored bare expression on ${alias} (only IF/Filter use condition sugar).`);
      }

      // Reserved block keys lifted onto the node itself.
      const nodeId = typeof params.id === "string" ? params.id : null;
      delete params.id;
      const pos = params.pos != null ? normalizePos(params.pos) : null;
      delete params.pos;
      let credentials;
      if (params.credentials && typeof params.credentials === "object" && !Array.isArray(params.credentials)) {
        credentials = params.credentials;
        delete params.credentials;
      }

      let nodeName = decl.block.pairs.__name ? decl.block.pairs.__name.value : humanName(alias, entry);
      let unique = nodeName;
      let c = 2;
      while (usedNames.has(unique)) unique = nodeName + " " + c++;
      usedNames.add(unique);
      delete params.__name;

      refToName[alias] = unique;
      if (nodeId) refToName[nodeId] = unique;
      if (pos) explicitPos.add(unique);

      const node = {
        id: nodeId || cheapId(),
        name: unique,
        type: entry.name,
        typeVersion: version,
        position: pos || [0, 0],
        parameters: params,
      };
      if (credentials) node.credentials = credentials;
      nodes.push(node);
    }

    // Connections. Each edge: from[outPort] -> to[inPort]. The n8n connection
    // TYPE (main / ai_tool / ai_languageModel / …) comes from the source port
    // and MUST also be the target's `type` — this was the AI-wiring bug.
    const connections = {};
    for (const e of model.edges) {
      const fromName = refToName[e.from];
      const toName = refToName[e.to];
      if (!fromName || !toName) {
        warnings.push(`Dangling connection ${e.from} -> ${e.to} (unknown node id/alias).`);
        continue;
      }
      const src = outletToConnType(e.outlet);
      const dstIndex = portIndex(e.inlet);
      connections[fromName] = connections[fromName] || {};
      connections[fromName][src.type] = connections[fromName][src.type] || [];
      while (connections[fromName][src.type].length <= src.index) connections[fromName][src.type].push([]);
      connections[fromName][src.type][src.index].push({ node: toName, type: src.type, index: dstIndex });
    }

    // Warn about truly floating nodes (no connection either way) — the common
    // way to ship a broken "everything is disconnected" workflow. Nodes with
    // only outgoing links (triggers, AI models/tools/memory) are fine.
    const connected = new Set();
    for (const from of Object.keys(connections)) {
      connected.add(from);
      for (const type of Object.keys(connections[from]))
        for (const slot of connections[from][type]) for (const c of slot || []) connected.add(c.node);
    }
    for (const n of nodes) {
      const entry = CATALOG.find((e) => e.name === n.type);
      const isTrig = entry && entry.isTrigger;
      if (!isTrig && !connected.has(n.name)) warnings.push(`Node "${n.name}" is not connected to anything — connect it or it will not run.`);
    }

    layout(nodes, connections, explicitPos);

    const workflow = { name: model.name || undefined, nodes, connections };
    return { workflow, warnings };
  }

  function humanName(alias, entry) {
    // Prefer the node's display name, but keep alias when the author named it.
    const pretty = alias.replace(/([a-z])([A-Z])/g, "$1 $2");
    const looksAuto = norm(alias) === norm(entry.displayName) || norm(alias) === norm(shortName(entry.name));
    return looksAuto ? entry.displayName : pretty.charAt(0).toUpperCase() + pretty.slice(1);
  }

  // Simple layered left-to-right auto-layout. Nodes with an author-set position
  // (in `keep`) are left where they are.
  function layout(nodes, connections, keep) {
    keep = keep || new Set();
    const byName = {};
    nodes.forEach((n) => (byName[n.name] = n));
    const depth = {};
    const incoming = {};
    nodes.forEach((n) => (incoming[n.name] = 0));
    for (const from of Object.keys(connections)) {
      for (const type of Object.keys(connections[from])) {
        for (const slot of connections[from][type]) {
          for (const c of slot || []) incoming[c.node] = (incoming[c.node] || 0) + 1;
        }
      }
    }
    const queue = nodes.filter((n) => !incoming[n.name]).map((n) => n.name);
    queue.forEach((n) => (depth[n] = 0));
    if (!queue.length && nodes.length) {
      depth[nodes[0].name] = 0;
      queue.push(nodes[0].name);
    }
    while (queue.length) {
      const cur = queue.shift();
      const outs = connections[cur] || {};
      for (const type of Object.keys(outs)) {
        for (const slot of outs[type]) {
          for (const c of slot || []) {
            if (depth[c.node] === undefined || depth[c.node] < depth[cur] + 1) {
              depth[c.node] = depth[cur] + 1;
              queue.push(c.node);
            }
          }
        }
      }
    }
    const lanes = {};
    nodes.forEach((n) => {
      if (keep.has(n.name)) return;
      const d = depth[n.name] || 0;
      lanes[d] = lanes[d] || 0;
      n.position = [260 + d * 300, 200 + lanes[d] * 180];
      lanes[d]++;
    });
  }

  // ---- Decompile n8n workflow JSON -> IF-Lang ----------------------------

  function friendlyRef(type) {
    const entry = CATALOG.find((e) => e.name === type);
    if (!entry) return shortName(type);
    // Use display name compacted (e.g. "HTTP Request" -> "HTTP.Request").
    const dn = entry.displayName;
    if (/\s/.test(dn)) {
      const parts = dn.split(/\s+/);
      if (parts.length === 2) return parts[0] + "." + parts[1];
    }
    return dn.replace(/\s+/g, "");
  }

  function aliasFor(name, used) {
    let a = name
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join("");
    if (!a) a = "node";
    let base = a;
    let c = 2;
    while (used.has(a)) a = base + c++;
    used.add(a);
    return a;
  }

  function valueToLang(v, indent) {
    if (v === null) return "null";
    if (typeof v === "boolean" || typeof v === "number") return String(v);
    if (typeof v === "string") {
      const s = v.startsWith("=") ? v.slice(1) : v;
      return JSON.stringify(s);
    }
    if (Array.isArray(v)) {
      if (!v.length) return "[]";
      const inner = v.map((x) => valueToLang(x, indent)).join(", ");
      return "[" + inner + "]";
    }
    if (typeof v === "object") {
      const pad = "  ".repeat(indent + 1);
      const pad0 = "  ".repeat(indent);
      const entries = Object.entries(v);
      if (!entries.length) return "{}";
      return (
        "{\n" +
        entries.map(([k, val]) => pad + k + ": " + valueToLang(val, indent + 1)).join("\n") +
        "\n" + pad0 + "}"
      );
    }
    return JSON.stringify(v);
  }

  function decompile(state) {
    const nodes = state.nodes || [];
    const connections = state.connections || {};
    const used = new Set();
    const nameToAlias = {};
    nodes.forEach((n) => (nameToAlias[n.name] = aliasFor(n.name, used)));

    const lines = [];
    lines.push(`workflow ${JSON.stringify(state.name || "Untitled")} {`);

    // Every node gets its real id + x/y position so the model can reference and
    // organise them precisely.
    const nameToId = {};
    nodes.forEach((n, i) => (nameToId[n.name] = n.id || nameToAlias[n.name] || "n" + i));

    // Declarations
    for (const n of nodes) {
      const alias = nameToAlias[n.name];
      const entry = CATALOG.find((e) => e.name === n.type);
      const isTrig = entry && entry.isTrigger;
      const ref = friendlyRef(n.type);
      const ver = n.typeVersion != null ? "@" + n.typeVersion : "";
      const head = `  ${isTrig ? "trigger " : ""}${ref}${ver} as ${alias}`;
      const meta = { id: nameToId[n.name] };
      if (Array.isArray(n.position)) meta.pos = [Math.round(n.position[0]), Math.round(n.position[1])];
      else if (n.position && typeof n.position === "object") meta.pos = [Math.round(n.position.x), Math.round(n.position.y)];
      const params = Object.assign(meta, n.parameters || {});
      if (n.credentials && Object.keys(n.credentials).length) params.credentials = n.credentials;
      const keys = Object.keys(params);
      lines.push(head + " {");
      for (const k of keys) lines.push("    " + k + ": " + valueToLang(params[k], 2));
      lines.push("  }");
    }

    // Connections — explicit: connect <fromId>:<outPort> -> <toId>:<inIdx>
    const connLines = [];
    for (const from of Object.keys(connections)) {
      const fromId = nameToId[from] || from;
      const outs = connections[from];
      for (const type of Object.keys(outs)) {
        outs[type].forEach((slot, idx) => {
          (slot || []).forEach((c) => {
            const toId = nameToId[c.node] || c.node;
            const srcPort = type === "main" ? idx : type;
            connLines.push(`  connect ${fromId}:${srcPort} -> ${toId}:${c.index || 0}`);
          });
        });
      }
    }
    if (connLines.length) {
      lines.push("");
      connLines.forEach((l) => lines.push(l));
    }
    lines.push("}");
    return lines.join("\n");
  }

  // ---- Language spec for the AI system prompt ----------------------------

  function spec() {
    return [
      "IF-Lang is a compact language for n8n workflows. Grammar:",
      "",
      'workflow "Name" {',
      "  <statements>",
      "}",
      "",
      "Statements:",
      "- Node declaration:  [trigger] <Ref>[@version] as <alias> { id: \"<id>\" pos: [x, y] <params> }",
      "    <Ref> is a friendly node name: 'HTTP.Request', 'Slack', 'IF', 'Set', 'Code',",
      "    or a raw type 'n8n-nodes-base.httpRequest'. @version is optional (defaults to latest).",
      "    Give EVERY node a stable `id` and a `pos: [x, y]` so nodes are laid out neatly, not",
      "    piled up. Space nodes ~280px apart on x for each step; keep parallel branches on",
      "    separate y lanes (~180px apart). 'Service.hint' sets a resource (e.g. 'Slack.message').",
      "",
      "- Connections (REQUIRED — every non-trigger node MUST have an incoming connection, or it",
      "  will not run). Use explicit connect statements:",
      "      connect <fromId>:<outputPort> -> <toId>:<inputPort>",
      "    Ports are numbers starting at 0. Main data flow is output 0 -> input 0:",
      "      connect n1:0 -> n2:0",
      "    Branches: IF uses output 0 (true) and 1 (false); Switch uses 0,1,2…:",
      "      connect gate:0 -> n5:0   (true)   /   connect gate:1 -> n6:0   (false)",
      "    AI sub-nodes connect by TYPE port (the model/tool/memory OUTPUTS into the agent):",
      "      connect chatModelId:ai_languageModel -> agentId:0",
      "      connect toolId:ai_tool -> agentId:0",
      "      connect memoryId:ai_memory -> agentId:0",
      "    Reference nodes by their id (or alias). You may still use a -> b as shorthand.",
      "",
      "Params: key: value pairs. Values may be strings (\"...\"), numbers, true/false/null,",
      "arrays [a, b], or nested { ... } blocks. Any string containing {{ ... }} is treated",
      "as an n8n expression automatically. Reserved keys: id, pos, credentials.",
      "",
      "IF / Filter shortcut: put a bare boolean expression in the block:",
      '  IF as gate { id: "g1" pos: [800,300]  $json.status == "ok" }',
      "",
      "Credentials: attach an existing credential (from search_credentials) with a",
      "`credentials` block keyed by the credential TYPE:",
      '  HTTP.Request as call { credentials: { httpHeaderAuth: { id: "AbC123", name: "My API" } } }',
      "",
      "Only use nodes that exist in this instance. Call search_nodes to discover node",
      "names and get_node_schema to see exact parameter names before writing params.",
    ].join("\n");
  }

  IF.Lang = {
    setCatalog,
    resolveRef,
    compile,
    decompile,
    spec,
    _internal: { lex, parse, layout },
  };
})();
