import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url);
const SHARED_ROOT = new URL("../supabase/functions/_shared/", import.meta.url);
const ENDPOINT = new URL("../supabase/functions/kac-intelligence-manifest/index.ts", import.meta.url);
const REGAL_FIXTURE = new URL("../data/regal_3300_keepr_import.json", import.meta.url);

function loadEndpoint(getClient) {
  const cache = new Map();

  function loadSharedModule(specifier) {
    const name = specifier.replace("../_shared/", "").replace("./", "");
    const path = new URL(name, SHARED_ROOT);
    const key = path.pathname;
    if (cache.has(key)) return cache.get(key).exports;

    const source = fs.readFileSync(path, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;

    const module = { exports: {} };
    cache.set(key, module);

    const context = {
      module,
      exports: module.exports,
      require: (nextSpecifier) => loadSharedModule(nextSpecifier),
      console,
    };
    vm.createContext(context);
    new vm.Script(compiled, { filename: path.pathname }).runInContext(context);
    return module.exports;
  }

  const source = fs.readFileSync(ENDPOINT, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  let handler = null;
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    Request,
    Response,
    console,
    Deno: { env: { get: (key) => (key === "SUPABASE_URL" ? "https://example.supabase.co" : "anon-key") } },
    require(specifier) {
      if (specifier.includes("supabase-js")) return { createClient: () => getClient() };
      if (specifier.includes("server.ts")) return { serve: (fn) => { handler = fn; } };
      if (specifier.includes("_shared")) return loadSharedModule(specifier);
      throw new Error(`Unexpected require: ${specifier}`);
    },
  };

  vm.createContext(context);
  new vm.Script(compiled, { filename: ENDPOINT.pathname }).runInContext(context);
  assert.equal(typeof handler, "function");
  return handler;
}

class Query {
  constructor(table, db) {
    this.table = table;
    this.db = db;
    this.filters = [];
    this.limitCount = null;
    this.expectSingle = false;
  }

  select() {
    return this;
  }

  eq(key, value) {
    this.filters.push((row) => row?.[key] === value);
    return this;
  }

  is(key, value) {
    this.filters.push((row) => (value === null ? row?.[key] == null : row?.[key] === value));
    return this;
  }

  in(key, values) {
    this.filters.push((row) => values.includes(row?.[key]));
    return this;
  }

  lte(key, value) {
    this.filters.push((row) => !row?.[key] || row[key] <= value);
    return this;
  }

  or(expression) {
    const endsAtMatch = expression.match(/ends_at\.gt\.([^,]+)/);
    if (expression.includes("ends_at.is.null") && endsAtMatch) {
      const value = endsAtMatch[1];
      this.filters.push((row) => row?.ends_at == null || row.ends_at > value);
    }
    return this;
  }

  order() {
    return this;
  }

  limit(count) {
    this.limitCount = count;
    return this;
  }

  single() {
    this.expectSingle = true;
    return this.result();
  }

  rows() {
    if (this.db.__fail?.has(this.table)) return null;
    let rows = [...(this.db[this.table] || [])];
    for (const filter of this.filters) rows = rows.filter(filter);
    if (this.limitCount != null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  result() {
    const rows = this.rows();
    if (rows == null) return Promise.resolve({ data: null, error: { message: "raw db boom" } });
    if (this.expectSingle && rows.length !== 1) {
      return Promise.resolve({ data: null, error: { message: "not found" } });
    }
    return Promise.resolve({ data: rows[0] || null, error: null });
  }

  then(resolve, reject) {
    const rows = this.rows();
    const result = rows == null
      ? { data: null, error: { message: "raw db boom" } }
      : { data: rows, error: null };
    return Promise.resolve(result).then(resolve, reject);
  }
}

function makeClient(db, userResult) {
  return {
    from(table) {
      return new Query(table, db);
    },
    rpc(name, args) {
      db.__rpcCalls?.push({ name, args });
      if (name !== "keepr_resolve_kac_for_manifest_admin") {
        return Promise.resolve({ data: null, error: { message: "unexpected rpc" } });
      }
      const userId = userResult?.data?.user?.id;
      const profile = (db.profiles || []).find((p) => p.id === userId);
      if (!["admin", "superkeepr"].includes(profile?.role)) {
        return Promise.resolve({ data: [], error: null });
      }
      const assets = db.__admin_assets || db.assets || [];
      const data = assets
        .filter((asset) => asset?.kac_id === args?.p_kac && asset?.deleted_at == null)
        .slice(0, 1)
        .map((asset) => ({
          id: asset.id,
          kac_id: asset.kac_id,
          master_asset_id: asset.master_asset_id,
          status: asset.status,
          asset_mode: asset.asset_mode,
        }));
      return Promise.resolve({ data, error: null });
    },
    auth: {
      async getUser() {
        return userResult;
      },
    },
  };
}

function baseDb(overrides = {}) {
  return {
    profiles: [],
    assets: [
      {
        id: "asset-1",
        kac_id: "KPR-TEST-1",
        master_asset_id: null,
        owner_id: "owner-1",
        name: "Test Asset",
        type: "vehicle",
        status: "active",
        asset_mode: "personal",
        vin: "VIN123456789",
        serial_number: "SERIAL-ASSET",
        deleted_at: null,
      },
    ],
    asset_stewardships: [],
    org_members: [],
    asset_identifiers: [
      { id: "id-kac", asset_id: "asset-1", kind: "kac", value: "KPR-TEST-1", is_primary: true },
      { id: "id-vin", asset_id: "asset-1", kind: "vin", value: "VIN123456789", is_primary: true },
      { id: "id-hin", asset_id: "asset-1", kind: "hin", value: "HIN987654321", is_primary: true },
      { id: "id-serial", asset_id: "asset-1", kind: "serial_number", value: "SERIAL-123456", is_primary: true },
    ],
    systems: [{ id: "sys-1", asset_id: "asset-1", ksc_code: "ENG", name: "Engine", system_type: "engine" }],
    vehicle_systems: [{ id: "veh-1", asset_id: "asset-1", system_id: "sys-1", system_type: "engine", name: "Engine", serial_number: "SYS-123456" }],
    boat_systems: [],
    home_systems: [],
    service_records: [{ id: "svc-1", asset_id: "asset-1", title: "Oil change", performed_at: "2026-01-01", system_id: "sys-1", keepr_pro_id: "pro-1", verification_status: "verified", source_type: "manual" }],
    story_events: [{ id: "story-1", asset_id: "asset-1", event_type: "maintenance", title: "Oil change Moment", metadata: { service_record_id: "svc-1" }, occurred_at: "2026-01-01T00:00:00Z", source_type: "manual", system_id: "sys-1" }],
    timeline_records: [],
    maintenance_events: [],
    service_entries: [],
    attachments: [
      {
        id: "att-1",
        asset_id: "asset-1",
        kind: "file",
        bucket: "asset-files",
        file_name: "invoice.pdf",
        mime_type: "application/pdf",
        title: "Invoice",
        doc_type: "invoice",
        ocr_status: "complete",
        text_source: "ocr",
        extracted_at: "2026-01-01",
        extracted_text: "do not leak",
        url: "https://signed.example",
        storage_path: "private/path",
        privacy: "moves_with_asset",
        deleted_at: null,
      },
    ],
    attachment_placements: [
      { id: "pl-1", attachment_id: "att-1", target_type: "asset", target_id: "asset-1", role: "receipt" },
      { id: "pl-2", attachment_id: "att-1", target_type: "system", target_id: "sys-1", role: "evidence" },
    ],
    attachment_links: [],
    ...overrides,
  };
}

function user(id) {
  return { data: { user: { id } }, error: null };
}

async function call(handler, db, body, authorization = "Bearer valid", userResult = user("owner-1")) {
  const client = makeClient(db, userResult);
  const response = await handler(new Request("http://localhost", {
    method: "POST",
    headers: authorization ? { authorization } : {},
    body: JSON.stringify(body || {}),
  }));
  return { response, body: await response.json() };
}

function endpointFor(dbRef, userResultRef = { current: user("owner-1") }) {
  return loadEndpoint(() => makeClient(dbRef.current, userResultRef.current));
}

function serialized(value) {
  return JSON.stringify(value);
}

test("missing JWT returns 401", async () => {
  const dbRef = { current: baseDb() };
  const handler = endpointFor(dbRef);
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, null);
  assert.equal(response.status, 401);
  assert.equal(body.error, "Missing auth");
});

test("invalid JWT returns 401", async () => {
  const dbRef = { current: baseDb() };
  const userResultRef = { current: { data: { user: null }, error: { message: "invalid" } } };
  const handler = endpointFor(dbRef, userResultRef);
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, "Bearer bad", userResultRef.current);
  assert.equal(response.status, 401);
  assert.equal(body.error, "Invalid user");
});

test("malformed KAC returns 400", async () => {
  const dbRef = { current: baseDb() };
  const handler = endpointFor(dbRef);
  const { response, body } = await call(handler, dbRef.current, { kac: "kpr/not/valid", purpose: "asset_overview" });
  assert.equal(response.status, 400);
  assert.equal(body.error, "malformed_kac");
});

test("unknown KAC returns 404", async () => {
  const dbRef = { current: baseDb() };
  const handler = endpointFor(dbRef);
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-NOPE", purpose: "asset_overview" });
  assert.equal(response.status, 404);
  assert.equal(body.error, "asset_not_found");
});

test("owner access returns asset overview", async () => {
  const dbRef = { current: baseDb() };
  const handler = endpointFor(dbRef);
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" });
  assert.equal(response.status, 200);
  assert.equal(body.authorization.access, "owner");
  assert.equal(body.purpose, "asset_overview");
});

test("direct steward access returns asset overview", async () => {
  const dbRef = { current: baseDb({ asset_stewardships: [{ asset_id: "asset-1", user_id: "user-1", active: true, access_role: "steward", starts_at: "2020-01-01" }] }) };
  const handler = endpointFor(dbRef, { current: user("user-1") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, "Bearer valid", user("user-1"));
  assert.equal(response.status, 200);
  assert.equal(body.authorization.access, "direct_steward");
});

test("org steward access returns asset overview", async () => {
  const dbRef = { current: baseDb({
    org_members: [{ user_id: "user-1", org_id: "org-1" }],
    asset_stewardships: [{ asset_id: "asset-1", org_id: "org-1", active: true, access_role: "steward", starts_at: "2020-01-01" }],
  }) };
  const handler = endpointFor(dbRef, { current: user("user-1") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, "Bearer valid", user("user-1"));
  assert.equal(response.status, 200);
  assert.equal(body.authorization.access, "org_steward");
});

test("viewer is denied", async () => {
  const dbRef = { current: baseDb({ asset_stewardships: [{ asset_id: "asset-1", user_id: "viewer-1", active: true, access_role: "viewer", starts_at: "2020-01-01" }] }) };
  const handler = endpointFor(dbRef, { current: user("viewer-1") });
  const { response } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, "Bearer valid", user("viewer-1"));
  assert.equal(response.status, 403);
});

test("unauthorized is denied", async () => {
  const dbRef = { current: baseDb({ assets: [] }) };
  const handler = endpointFor(dbRef, { current: user("stranger") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, "Bearer valid", user("stranger"));
  assert.equal(response.status, 404);
  assert.equal(body.error, "asset_not_found");
});

test("admin asset_overview is allowed", async () => {
  const dbRef = { current: baseDb({ profiles: [{ id: "admin-1", role: "superkeepr", email: "do-not-return@example.com" }] }) };
  const handler = endpointFor(dbRef, { current: user("admin-1") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, "Bearer valid", user("admin-1"));
  assert.equal(response.status, 200);
  assert.equal(body.authorization.access, "admin");
});

test("platform admin resolves an asset without stewardship through admin RPC", async () => {
  const rpcCalls = [];
  const dbRef = { current: baseDb({
    profiles: [{ id: "admin-1", role: "superkeepr" }],
    assets: [],
    __admin_assets: baseDb().assets,
    __rpcCalls: rpcCalls,
  }) };
  const handler = endpointFor(dbRef, { current: user("admin-1") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, "Bearer valid", user("admin-1"));
  assert.equal(response.status, 200);
  assert.equal(body.authorization.access, "admin");
  assert.equal(body.asset.id, "asset-1");
  assert.equal(rpcCalls.length, 1);
  assert.equal(rpcCalls[0].name, "keepr_resolve_kac_for_manifest_admin");
  assert.equal(rpcCalls[0].args.p_kac, "KPR-TEST-1");
});

test("admin RPC resolves only the requested KAC and returns one identity", async () => {
  const rpcCalls = [];
  const dbRef = { current: baseDb({
    profiles: [{ id: "admin-1", role: "admin" }],
    assets: [],
    __admin_assets: [
      { ...baseDb().assets[0], id: "asset-target" },
      { ...baseDb().assets[0], id: "asset-duplicate" },
      { ...baseDb().assets[0], id: "asset-other", kac_id: "KPR-OTHER-1" },
    ],
    __rpcCalls: rpcCalls,
  }) };
  const handler = endpointFor(dbRef, { current: user("admin-1") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, "Bearer valid", user("admin-1"));
  assert.equal(response.status, 200);
  assert.equal(body.asset.id, "asset-target");
  assert.equal(body.asset.kac_id, "KPR-TEST-1");
  assert.equal(body.asset.name, undefined);
  assert.equal(body.asset.type, undefined);
  assert.deepEqual(rpcCalls.map((call) => call.args.p_kac), ["KPR-TEST-1"]);
});

test("owner path still uses caller-scoped resolver, not admin RPC", async () => {
  const rpcCalls = [];
  const dbRef = { current: baseDb({ __rpcCalls: rpcCalls }) };
  const handler = endpointFor(dbRef);
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" });
  assert.equal(response.status, 200);
  assert.equal(body.authorization.access, "owner");
  assert.deepEqual(rpcCalls, []);
});

test("admin admin_diagnostic is allowed", async () => {
  const dbRef = { current: baseDb({ profiles: [{ id: "admin-1", role: "admin" }] }) };
  const handler = endpointFor(dbRef, { current: user("admin-1") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "admin_diagnostic" }, "Bearer valid", user("admin-1"));
  assert.equal(response.status, 200);
  assert.equal(body.purpose, "admin_diagnostic");
});

test("non-admin is denied admin_diagnostic", async () => {
  const dbRef = { current: baseDb() };
  const handler = endpointFor(dbRef);
  const { response } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "admin_diagnostic" });
  assert.equal(response.status, 403);
});

test("disputed asset is restricted for owner", async () => {
  const dbRef = { current: baseDb({ assets: [{ ...baseDb().assets[0], status: "disputed" }] }) };
  const handler = endpointFor(dbRef);
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" });
  assert.equal(response.status, 200);
  assert.equal(body.status, "restricted");
  assert.equal(body.asset.availability, "admin_review_required");
  assert.equal(body.associations.length, 0);
});

test("disputed asset diagnostic is available to admin", async () => {
  const dbRef = { current: baseDb({ profiles: [{ id: "admin-1", role: "admin" }], assets: [{ ...baseDb().assets[0], status: "disputed" }] }) };
  const handler = endpointFor(dbRef, { current: user("admin-1") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "admin_diagnostic" }, "Bearer valid", user("admin-1"));
  assert.equal(response.status, 200);
  assert.equal(body.diagnostics.some((d) => d.code === "disputed_asset_requires_admin_review"), true);
});

test("disputed asset diagnostic is available to admin without stewardship", async () => {
  const disputed = { ...baseDb().assets[0], status: "disputed" };
  const dbRef = { current: baseDb({ profiles: [{ id: "admin-1", role: "admin" }], assets: [], __admin_assets: [disputed] }) };
  const handler = endpointFor(dbRef, { current: user("admin-1") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "admin_diagnostic" }, "Bearer valid", user("admin-1"));
  assert.equal(response.status, 200);
  assert.equal(body.authorization.access, "admin");
  assert.equal(body.diagnostics.some((d) => d.code === "disputed_asset_requires_admin_review"), true);
});

test("complete result includes collector summaries", async () => {
  const dbRef = { current: baseDb() };
  const handler = endpointFor(dbRef);
  const { body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" });
  assert.equal(body.status, "complete");
  assert.equal(body.collector_summaries.length, 4);
});

test("direct steward with hidden domains returns partial", async () => {
  const dbRef = { current: baseDb({
    asset_stewardships: [{ asset_id: "asset-1", user_id: "user-1", active: true, access_role: "steward", starts_at: "2020-01-01" }],
    systems: [],
    vehicle_systems: [],
    attachments: [],
    attachment_placements: [],
  }) };
  const handler = endpointFor(dbRef, { current: user("user-1") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, "Bearer valid", user("user-1"));
  assert.equal(response.status, 200);
  assert.equal(body.status, "partial");
  assert.equal(body.collector_summaries.some((s) => s.status === "not_visible"), true);
});

test("org steward with hidden domains returns partial", async () => {
  const dbRef = { current: baseDb({
    org_members: [{ user_id: "user-1", org_id: "org-1" }],
    asset_stewardships: [{ asset_id: "asset-1", org_id: "org-1", active: true, access_role: "steward", starts_at: "2020-01-01" }],
    asset_identifiers: [],
    master_assets: [],
    vehicle_systems: [],
    boat_systems: [],
    home_systems: [],
  }) };
  const handler = endpointFor(dbRef, { current: user("user-1") });
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" }, "Bearer valid", user("user-1"));
  assert.equal(response.status, 200);
  assert.equal(body.status, "partial");
  assert.equal(body.collector_summaries.some((s) => s.status === "not_visible"), true);
});

test("partial collector failure returns partial with sanitized diagnostics", async () => {
  const dbRef = { current: baseDb({ __fail: new Set(["systems"]) }) };
  const handler = endpointFor(dbRef);
  const { body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" });
  assert.equal(body.status, "partial");
  assert.equal(body.collector_summaries.find((s) => s.collector === "systems").status, "failed");
  assert.equal(serialized(body).includes("raw db boom"), false);
  assert.equal(body.diagnostics.some((d) => d.code === "partial_query_failure"), true);
});

test("does not return extracted text, signed URLs, or personal contact fields", async () => {
  const dbRef = { current: baseDb({ profiles: [{ id: "owner-1", role: "consumer", email: "do-not-return@example.com", phone: "555" }] }) };
  const handler = endpointFor(dbRef);
  const { body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" });
  const text = serialized(body);
  assert.equal(text.includes("do not leak"), false);
  assert.equal(text.includes("signed.example"), false);
  assert.equal(text.includes("private/path"), false);
  assert.equal(text.includes("do-not-return@example.com"), false);
  assert.equal(text.includes("555"), false);
});

test("VIN and HIN are returned while serial number is masked", async () => {
  const dbRef = { current: baseDb() };
  const handler = endpointFor(dbRef);
  const { body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" });
  const identifiers = body.association_groups.identity.filter((a) => a.object_type === "asset_identifier");
  assert.equal(identifiers.find((a) => a.safe_metadata.kind === "vin").safe_metadata.value, "VIN123456789");
  assert.equal(identifiers.find((a) => a.safe_metadata.kind === "hin").safe_metadata.value, "HIN987654321");
  const serial = identifiers.find((a) => a.safe_metadata.kind === "serial_number").safe_metadata.value;
  assert.equal(serial.endsWith("3456"), true);
  assert.equal(serial.includes("SERIAL-12"), false);
});

test("service/Moment event is counted once", async () => {
  const dbRef = { current: baseDb() };
  const handler = endpointFor(dbRef);
  const { body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" });
  assert.equal(body.association_groups.timeline.filter((a) => a.object_type === "work_event").length, 1);
  assert.equal(body.association_groups.timeline.some((a) => a.association_id === "moment:story_event:story-1"), false);
});

test("attachment with multiple placements is one document with multiple relationships", async () => {
  const dbRef = { current: baseDb() };
  const handler = endpointFor(dbRef);
  const { body } = await call(handler, dbRef.current, { kac: "KPR-TEST-1", purpose: "asset_overview" });
  assert.equal(body.association_groups.attachments.filter((a) => a.association_id === "attachment:att-1").length, 1);
  assert.equal(body.association_groups.attachments.filter((a) => a.object_type === "attachment_placement").length, 2);
});

test("Porsche acceptance fixture manifests through vehicle path", async () => {
  const dbRef = { current: baseDb({ assets: [{ ...baseDb().assets[0], kac_id: "KPR-6GV2-MJ6W", name: "2000 Porsche Boxster S", make: "Porsche" }] }) };
  const handler = endpointFor(dbRef);
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-6GV2-MJ6W", purpose: "asset_overview" });
  assert.equal(response.status, 200);
  assert.equal(body.kac, "KPR-6GV2-MJ6W");
  assert.equal(body.association_groups.systems.some((a) => a.source_table === "vehicle_systems"), true);
});

test("Regal marine acceptance fixture manifests through marine path", async () => {
  const fixture = JSON.parse(fs.readFileSync(REGAL_FIXTURE, "utf8"));
  const dbRef = { current: baseDb({
    assets: [{ ...baseDb().assets[0], id: "asset-regal", kac_id: "KPR-REGAL-3300", type: "marine", name: fixture.asset.display_name }],
    systems: [{ id: "sys-regal-engine", asset_id: "asset-regal", ksc_code: "PROP", name: "Propulsion", system_type: "propulsion" }],
    vehicle_systems: [],
    boat_systems: fixture.systems.slice(0, 1).map((system) => ({
      id: "regal-boat-1",
      asset_id: "asset-regal",
      system_id: "sys-regal-engine",
      system_type: system.type,
      name: system.name,
      manufacturer: system.manufacturer,
      model: system.model,
    })),
    asset_identifiers: [{ id: "regal-kac", asset_id: "asset-regal", kind: "kac", value: "KPR-REGAL-3300", is_primary: true }],
    attachments: [],
    attachment_placements: [],
    service_records: [],
    story_events: [],
  }) };
  const handler = endpointFor(dbRef);
  const { response, body } = await call(handler, dbRef.current, { kac: "KPR-REGAL-3300", purpose: "asset_overview" });
  assert.equal(response.status, 200);
  assert.equal(body.association_groups.systems.some((a) => a.source_table === "boat_systems"), true);
  assert.equal(body.association_groups.systems.find((a) => a.source_table === "boat_systems").safe_metadata.manufacturer, "Volvo Penta");
});
