import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { keeprContextBridgeInternals } from "../lib/keeprContextBridgeMcpServer.js";

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Keepr MCP v1 exposes only the ChatGPT Context Bridge verbs", () => {
  const route = read("api/mcp.js");
  const bridge = read("lib/keeprContextBridgeMcpServer.js");

  assert.match(route, /createMcpHandler/);
  assert.match(route, /registerKeeprContextBridgeTools\(server\)/);
  assert.match(route, /Keepr Context Bridge/);
  assert.match(bridge, /name: "get_context"/);
  assert.match(bridge, /name: "contribute_context"/);
  assert.match(bridge, /minimum_sufficient_relevant_context/);
  assert.match(bridge, /structured ChatGPT-derived context contribution/);

  for (const frozenOutOfScopeTool of [
    "create_action",
    "update_asset_action",
    "complete_asset_action",
    "add_asset_evidence",
    "list_my_assets",
  ]) {
    assert.doesNotMatch(bridge, new RegExp(`name: "${frozenOutOfScopeTool}"`));
  }
});

test("get_context resolves natural-language hints to authorized Keepr context", () => {
  const bridge = read("lib/keeprContextBridgeMcpServer.js");

  assert.match(bridge, /asset_hint/);
  assert.match(bridge, /thread_or_project_hint/);
  assert.match(bridge, /get_authorized_assets/);
  assert.match(bridge, /scoreAsset/);
  assert.match(bridge, /\.from\("systems"\)/);
  assert.match(bridge, /\.from\("asset_threads"\)/);
  assert.match(bridge, /\.from\("attachment_placements"\)/);
  assert.match(bridge, /\.from\("reminders"\)/);
  assert.match(bridge, /\.from\("asset_provider_stewardships"\)/);
  assert.match(bridge, /\.from\("service_records"\)/);
  assert.match(bridge, /unrelated portfolio assets/);
});

test("contribute_context persists continuity without canonical operational writes", () => {
  const bridge = read("lib/keeprContextBridgeMcpServer.js");
  const contributionOnly = bridge.slice(bridge.indexOf("async function contributeContext"));

  assert.match(bridge, /confirmation_required/);
  assert.match(bridge, /CONTRIBUTE_CONTEXT/);
  assert.match(bridge, /\.from\("asset_threads"\)/);
  assert.match(bridge, /\.from\("asset_thread_messages"\)/);
  assert.match(bridge, /ChatGPT context contribution/);
  assert.match(bridge, /canonical_truth_changed: false/);
  assert.match(bridge, /operational_writes_created: \[\]/);
  assert.match(bridge, /review_required_for/);
  assert.match(bridge, /proposed_actions/);
  assert.match(bridge, /proposed_facts/);

  assert.doesNotMatch(contributionOnly, /\.from\("reminders"\)[\s\S]*\.insert\(/);
  assert.doesNotMatch(contributionOnly, /\.from\("service_records"\)[\s\S]*\.insert\(/);
  assert.doesNotMatch(contributionOnly, /\.from\("objects"\)[\s\S]*\.insert\(/);
});

test("OAuth discovery metadata remains present for remote HTTPS MCP", () => {
  const protectedResource = read("api/oauth/protected-resource.js");
  const authorizationServer = read("api/oauth/authorization-server.js");
  const rewrites = read("vercel.json");

  assert.match(protectedResource, /keepr\.chatgpt_context_bridge\.v1/);
  assert.match(authorizationServer, /keepr\.chatgpt_context_bridge\.v1/);
  assert.match(protectedResource, /keepr\.context\.read/);
  assert.match(protectedResource, /keepr\.context\.contribute/);
  assert.match(authorizationServer, /\/auth\/v1/);
  assert.match(rewrites, /"source": "\/mcp"/);
  assert.match(rewrites, /"destination": "\/api\/mcp"/);
  assert.match(rewrites, /"source": "\/\.well-known\/oauth-protected-resource"/);
  assert.match(rewrites, /"destination": "\/api\/oauth\/protected-resource"/);
});

function createFakeSupabase(seed) {
  const store = structuredClone(seed);
  const writes = [];
  let sequence = 0;

  class Query {
    constructor(table) {
      this.table = table;
      this.filters = [];
      this.operation = "select";
      this.payload = null;
      this.limitCount = null;
    }

    select() { return this; }
    eq(column, value) { this.filters.push((row) => row?.[column] === value); return this; }
    is(column, value) { this.filters.push((row) => row?.[column] === value); return this; }
    ilike(column, pattern) {
      const needle = String(pattern).replaceAll("%", "").toLowerCase();
      this.filters.push((row) => String(row?.[column] || "").toLowerCase().includes(needle));
      return this;
    }
    not(column, operator, value) {
      if (operator === "in") {
        const excluded = String(value).replace(/^\(|\)$/g, "").split(",");
        this.filters.push((row) => !excluded.includes(String(row?.[column])));
      }
      return this;
    }
    order() { return this; }
    limit(value) { this.limitCount = value; return this; }
    insert(payload) { this.operation = "insert"; this.payload = payload; return this; }
    update(payload) { this.operation = "update"; this.payload = payload; return this; }
    upsert(payload) { this.operation = "upsert"; this.payload = payload; return this; }

    rows() {
      const rows = store[this.table] || [];
      const filtered = rows.filter((row) => this.filters.every((filter) => filter(row)));
      return this.limitCount == null ? filtered : filtered.slice(0, this.limitCount);
    }

    execute(single = false, maybeSingle = false) {
      if (this.operation === "select") {
        const rows = this.rows();
        return { data: single || maybeSingle ? rows[0] || null : rows, error: null };
      }
      if (this.operation === "insert") {
        const payloads = Array.isArray(this.payload) ? this.payload : [this.payload];
        const inserted = payloads.map((payload) => ({
          ...structuredClone(payload),
          id: payload.id || `${this.table}-${++sequence}`,
          created_at: payload.created_at || `2026-09-17T12:00:${String(sequence).padStart(2, "0")}Z`,
          updated_at: payload.updated_at || `2026-09-17T12:00:${String(sequence).padStart(2, "0")}Z`,
        }));
        store[this.table] ||= [];
        store[this.table].push(...inserted);
        writes.push({ table: this.table, operation: "insert", payload: structuredClone(this.payload) });
        return { data: single ? inserted[0] : inserted, error: null };
      }
      if (this.operation === "update") {
        const rows = this.rows();
        rows.forEach((row) => Object.assign(row, structuredClone(this.payload)));
        writes.push({ table: this.table, operation: "update", payload: structuredClone(this.payload) });
        return { data: single ? rows[0] || null : rows, error: null };
      }
      if (this.operation === "upsert") {
        const payloads = Array.isArray(this.payload) ? this.payload : [this.payload];
        store[this.table] ||= [];
        for (const payload of payloads) {
          const existing = store[this.table].find((row) =>
            row.attachment_id === payload.attachment_id &&
            row.target_type === payload.target_type &&
            row.target_id === payload.target_id
          );
          if (existing) Object.assign(existing, structuredClone(payload));
          else store[this.table].push({ ...structuredClone(payload), id: `${this.table}-${++sequence}` });
        }
        writes.push({ table: this.table, operation: "upsert", payload: structuredClone(this.payload) });
        return { data: payloads, error: null };
      }
      return { data: null, error: new Error("unsupported fake query") };
    }

    single() { return Promise.resolve(this.execute(true, false)); }
    maybeSingle() { return Promise.resolve(this.execute(false, true)); }
    then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
  }

  return {
    store,
    writes,
    client: {
      rpc(name) {
        assert.equal(name, "get_authorized_assets");
        return Promise.resolve({ data: structuredClone(store.authorized_assets), error: null });
      },
      from(table) { return new Query(table); },
    },
  };
}

function bridgeFixture() {
  return createFakeSupabase({
    authorized_assets: [
      { id: "asset-brighton", name: "Brighton Home", type: "home", kac_id: "KPR-BRLR-GLEN", owner_id: "user-andy" },
      { id: "asset-porsche", name: "Porsche Boxster S", type: "vehicle", kac_id: "KPR-PORSCHE", owner_id: "user-andy" },
    ],
    systems: [
      { id: "system-pool", asset_id: "asset-brighton", name: "Pool", system_type: "pool", status: "active" },
      { id: "system-generator", asset_id: "asset-brighton", name: "Generator", system_type: "generator", status: "active" },
    ],
    asset_threads: [
      { id: "thread-pool", asset_id: "asset-brighton", system_id: "system-pool", subject: "Pool Renovation", status: "open", source_type: "member", resource_ref: {}, updated_at: "2026-09-16T10:00:00Z" },
      { id: "thread-porsche", asset_id: "asset-porsche", system_id: null, subject: "Annual Service", status: "open", source_type: "member", resource_ref: {}, updated_at: "2026-09-15T10:00:00Z" },
    ],
    asset_thread_messages: [],
    reminders: [
      { id: "action-pool", asset_id: "asset-brighton", system_id: "system-pool", title: "Resolve restoration timing", status: "open" },
      { id: "action-porsche", asset_id: "asset-porsche", system_id: null, title: "Change Porsche oil", status: "open" },
    ],
    attachment_placements: [
      {
        id: "placement-pool-quote",
        attachment_id: "attachment-pool-quote",
        target_type: "system",
        target_id: "system-pool",
        role: "proposal",
        label: "Legacy quote",
        attachments: {
          id: "attachment-pool-quote",
          kind: "file",
          title: "Legacy Pool Restoration Quote",
          file_name: "Legacy_Quote.pdf",
          mime_type: "application/pdf",
          url: "https://files.example.test/legacy-quote",
          source_context: { source_type: "provider", source_name: "Legacy Pool Plastering", external_source_id: "QUOTE-2026-17", authority_state: "provider_authored" },
          ai_metadata: { ai_context: "primary", knowledge_state: "evidence_available", review_state: "unreviewed" },
          extracted_text: "Pool restoration scope and pricing",
          doc_type: "quote",
        },
      },
      {
        id: "placement-generator",
        attachment_id: "attachment-generator",
        target_type: "system",
        target_id: "system-generator",
        role: "manual",
        attachments: { id: "attachment-generator", kind: "file", title: "Generator Manual", ai_metadata: { ai_context: "primary" } },
      },
    ],
    asset_provider_stewardships: [
      { id: "provider-pool", asset_id: "asset-brighton", keepr_pro_id: "legacy-pool", relationship_type: "contractor", status: "active", projection_config: { system_ids: ["system-pool"] } },
      { id: "provider-generator", asset_id: "asset-brighton", keepr_pro_id: "generator-provider", relationship_type: "contractor", status: "active", projection_config: { system_ids: ["system-generator"] } },
      { id: "provider-porsche", asset_id: "asset-porsche", keepr_pro_id: "porsche-dealer", relationship_type: "dealer", status: "active" },
    ],
    service_records: [
      { id: "history-closing", asset_id: "asset-brighton", system_id: "system-pool", title: "Pool winterized", service_type: "winterization", performed_at: "2025-10-15" },
      { id: "history-porsche", asset_id: "asset-porsche", system_id: null, title: "Porsche annual service", performed_at: "2025-05-01" },
    ],
    attachments: [],
  });
}

test("KeeprLINK normalization resolves the governed Brighton Pool projection without portfolio pollution", async () => {
  const fixture = bridgeFixture();
  const auth = { supabase: fixture.client, user: { id: "user-andy" } };
  assert.equal(
    keeprContextBridgeInternals.normalizeKacHint("https://app.keeprhome.com/k/KPR-BRLR-GLEN/context?source=chatgpt"),
    "kpr-brlr-glen"
  );

  const result = await keeprContextBridgeInternals.getContext(auth, {
    address: "https://app.keeprhome.com/k/KPR-BRLR-GLEN/context?source=chatgpt",
    system_hint: "Pool",
    job_hint: "Pool Renovation",
  });

  assert.equal(result.scope.kac_id, "KPR-BRLR-GLEN");
  assert.equal(result.scope.system_id, "system-pool");
  assert.equal(result.scope.thread_id, "thread-pool");
  assert.deepEqual(result.context.actions.map((row) => row.id), ["action-pool"]);
  assert.deepEqual(result.context.resources.map((row) => row.attachment_id), ["attachment-pool-quote"]);
  assert.equal(result.context.resources[0].authority_state, "provider_authored");
  assert.equal(result.context.resources[0].source_identity.external_source_id, "QUOTE-2026-17");
  assert.deepEqual(result.context.history.map((row) => row.id), ["history-closing"]);
  assert.deepEqual(result.context.provider_relationships.map((row) => row.id), ["provider-pool"]);
  assert.ok(result.excluded_context.some((entry) => entry.source === "provider_relationship" && entry.count === 1));
  assert.ok(result.context_used.some((entry) => entry.source === "evidence"));
  assert.doesNotMatch(JSON.stringify(result), /Porsche|Generator Manual|generator-provider|porsche-dealer/);
});

test("explicit unknown KAC and mismatched thread scope fail closed", async () => {
  const fixture = bridgeFixture();
  const auth = { supabase: fixture.client, user: { id: "user-andy" } };

  await assert.rejects(
    keeprContextBridgeInternals.getContext(auth, { kac_id: "KPR-DOES-NOT-EXIST" }),
    (error) => error.message === "asset_not_resolved"
  );
  await assert.rejects(
    keeprContextBridgeInternals.contributeContext(auth, {
      asset_hint: "Brighton Home",
      system_hint: "Pool",
      thread_id: "thread-porsche",
      confirmation: "CONTRIBUTE_CONTEXT",
      contribution: { summary: "This must not cross scopes." },
    }),
    (error) => error.message === "thread_scope_mismatch"
  );
  assert.equal(fixture.writes.length, 0);
});

test("Brighton Pool contribution is reviewable, scoped, replay-resistant, and creates no canonical writes", async () => {
  const fixture = bridgeFixture();
  const auth = { supabase: fixture.client, user: { id: "user-andy" } };
  const args = {
    asset_hint: "Brighton Home",
    system_hint: "Pool",
    thread_or_project_hint: "Pool Renovation",
    confirmation: "CONTRIBUTE_CONTEXT",
    idempotency_key: "chatgpt-pool-renovation-2026-09-17",
    source: { type: "chatgpt_conversation", title: "Brighton Pool renovation", url: "https://chatgpt.com/share/pool-fixture" },
    contribution: {
      summary: "The Legacy proposal expands the restoration scope and may affect fall winterization.",
      decisions: ["Review comprehensive restoration before selecting finish"],
      observations: ["Restoration timing overlaps normal pool closing"],
      unresolved_questions: ["Who owns winterization if work begins this fall?"],
      proposed_actions: [{ title: "Confirm timing and winterization responsibility" }],
      proposed_facts: [{ statement: "Legacy supplied a restoration proposal", review_state: "proposed" }],
    },
  };

  const first = await keeprContextBridgeInternals.contributeContext(auth, args);
  const replay = await keeprContextBridgeInternals.contributeContext(auth, args);

  assert.equal(first.saved, true);
  assert.equal(first.replayed, false);
  assert.equal(first.scope.kac_id, "KPR-BRLR-GLEN");
  assert.equal(first.scope.system_id, "system-pool");
  assert.equal(first.scope.thread_id, "thread-pool");
  assert.equal(first.contribution.review_state, "pending_review");
  assert.match(first.contribution.id, /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
  assert.equal(first.persistent_objects.message.id, first.contribution.id);
  assert.equal(first.canonical_truth_changed, false);
  assert.deepEqual(first.operational_writes_created, []);
  assert.equal(replay.replayed, true);
  assert.equal(replay.contribution.id, first.contribution.id);
  assert.equal(fixture.store.asset_thread_messages.length, 1);
  assert.equal(fixture.store.attachments.length, 1);
  assert.equal(fixture.store.asset_threads[0].resource_ref.context_contributions.length, 1);
  assert.equal(fixture.store.asset_threads[0].resource_ref.context_contributions[0].review_state, "pending_review");
  assert.equal(fixture.store.attachment_placements.filter((row) => row.attachment_id === fixture.store.attachments[0].id).length, 2);

  const allowedWriteTables = new Set(["asset_threads", "asset_thread_messages", "attachments", "attachment_placements"]);
  assert.deepEqual(
    [...new Set(fixture.writes.map((write) => write.table).filter((table) => !allowedWriteTables.has(table)))],
    []
  );
  for (const table of ["authorized_assets", "systems", "reminders", "service_records", "asset_provider_stewardships"]) {
    assert.equal(fixture.writes.some((write) => write.table === table), false, `unexpected write to ${table}`);
  }
});
