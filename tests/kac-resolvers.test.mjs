import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const ROOT = new URL("..", import.meta.url);
const PUBLIC_RESOLVER = new URL("../supabase/functions/kac-resolve/index.ts", import.meta.url);
const AUTH_RESOLVER = new URL("../supabase/functions/kac-resolve-auth/index.ts", import.meta.url);
const PUBLIC_ACTION_SCREEN = new URL("../screens/PublicActionScreen.js", import.meta.url);

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function countServeHandlers(path) {
  return (read(path).match(/\bserve\s*\(/g) || []).length;
}

function loadResolverHandler(path, getSupabaseClient) {
  const sourceWithoutImports = read(path).replace(/^import .*;\n/gm, "");
  const compiled = ts.transpileModule(sourceWithoutImports, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  let handler = null;
  const context = {
    Response,
    console,
    getSupabaseClient,
    serve(fn) {
      handler = fn;
    },
  };

  vm.createContext(context);
  new vm.Script(compiled, { filename: path.pathname }).runInContext(context);
  assert.equal(typeof handler, "function", `${path.pathname} did not register a handler`);
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

  lte() {
    return this;
  }

  or() {
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

  maybeSingle() {
    return this.result();
  }

  rows() {
    let rows = [...(this.db[this.table] || [])];
    for (const filter of this.filters) rows = rows.filter(filter);
    if (this.limitCount != null) rows = rows.slice(0, this.limitCount);
    return rows;
  }

  result() {
    const rows = this.rows();
    if (this.expectSingle && rows.length !== 1) {
      return Promise.resolve({ data: null, error: { message: "not found" } });
    }
    return Promise.resolve({ data: rows[0] || null, error: null });
  }

  then(resolve, reject) {
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
}

function makeClient({ db = {}, userResult = { data: { user: null }, error: null } } = {}) {
  return {
    from(table) {
      return new Query(table, db);
    },
    auth: {
      async getUser() {
        return userResult;
      },
    },
  };
}

async function post(handler, body, authorization = null) {
  const headers = authorization ? { authorization } : {};
  return handler(
    new Request("http://localhost", {
      method: "POST",
      headers,
      body: JSON.stringify(body || {}),
    })
  );
}

async function readJson(response) {
  return JSON.parse(await response.text());
}

function loadNormalizeResolved() {
  const source = read(PUBLIC_ACTION_SCREEN);
  const match = source.match(/function normalizeResolved[\s\S]*?^}/m);
  assert.ok(match, "normalizeResolved was not found");

  const context = {};
  vm.createContext(context);
  new vm.Script(`${match[0]}; this.normalizeResolved = normalizeResolved;`).runInContext(context);
  return context.normalizeResolved;
}

test("KAC resolver modules each register exactly one serve handler", () => {
  assert.equal(countServeHandlers(PUBLIC_RESOLVER), 1);
  assert.equal(countServeHandlers(AUTH_RESOLVER), 1);
});

test("public KAC resolver returns 400 for missing KAC", async () => {
  const handler = loadResolverHandler(PUBLIC_RESOLVER, () => makeClient());
  const response = await post(handler, {});
  assert.equal(response.status, 400);
  assert.deepEqual(await readJson(response), { error: "Missing kac" });
});

test("public KAC resolver returns 404 for unknown KAC", async () => {
  const handler = loadResolverHandler(PUBLIC_RESOLVER, () => makeClient({ db: { assets: [] } }));
  const response = await post(handler, { kac: "KPR-NOPE" });
  assert.equal(response.status, 404);
  assert.deepEqual(await readJson(response), { error: "Asset not found" });
});

test("public KAC resolver returns valid asset contract", async () => {
  const asset = { id: "asset-1", name: "Asset", kac_id: "KPR-OK", deleted_at: null };
  const handler = loadResolverHandler(PUBLIC_RESOLVER, () =>
    makeClient({ db: { assets: [asset] } })
  );

  const response = await post(handler, { kac: "KPR-OK" });
  assert.equal(response.status, 200);

  const body = await readJson(response);
  assert.equal(body.asset.id, "asset-1");
  assert.equal(body.asset.kac_id, "KPR-OK");
  assert.deepEqual(body.allowed_actions, ["view"]);
});

test("authenticated KAC resolver returns 401 for missing auth", async () => {
  const handler = loadResolverHandler(AUTH_RESOLVER, () => makeClient());
  const response = await post(handler, { kac: "KPR-OK" });
  assert.equal(response.status, 401);
  assert.deepEqual(await readJson(response), { error: "Missing auth" });
});

test("authenticated KAC resolver returns 401 for invalid JWT", async () => {
  const handler = loadResolverHandler(AUTH_RESOLVER, () =>
    makeClient({ userResult: { data: { user: null }, error: { message: "invalid" } } })
  );

  const response = await post(handler, { kac: "KPR-OK" }, "Bearer invalid");
  assert.equal(response.status, 401);
  assert.deepEqual(await readJson(response), { error: "Invalid user" });
});

test("authenticated KAC resolver returns request access actions without stewardship", async () => {
  const asset = { id: "asset-1", name: "Asset", kac_id: "KPR-OK", deleted_at: null };
  const handler = loadResolverHandler(AUTH_RESOLVER, () =>
    makeClient({
      db: { assets: [asset], asset_stewardships: [], org_members: [] },
      userResult: { data: { user: { id: "user-1", email: "user@example.com" } }, error: null },
    })
  );

  const response = await post(handler, { kac: "KPR-OK" }, "Bearer valid");
  assert.equal(response.status, 200);

  const body = await readJson(response);
  assert.equal(body.stewardship.access_role, null);
  assert.deepEqual(body.allowed_actions, ["request_access", "view"]);
});

test("authenticated KAC resolver returns viewer actions", async () => {
  const asset = { id: "asset-1", name: "Asset", kac_id: "KPR-OK", deleted_at: null };
  const handler = loadResolverHandler(AUTH_RESOLVER, () =>
    makeClient({
      db: {
        assets: [asset],
        org_members: [],
        asset_stewardships: [
          { asset_id: "asset-1", user_id: "user-1", active: true, access_role: "viewer" },
        ],
      },
      userResult: { data: { user: { id: "user-1" } }, error: null },
    })
  );

  const response = await post(handler, { kac: "KPR-OK" }, "Bearer valid");
  assert.equal(response.status, 200);

  const body = await readJson(response);
  assert.equal(body.stewardship.access_role, "viewer");
  assert.deepEqual(body.allowed_actions, ["view"]);
});

test("authenticated KAC resolver returns steward actions", async () => {
  const asset = { id: "asset-1", name: "Asset", kac_id: "KPR-OK", deleted_at: null };
  const handler = loadResolverHandler(AUTH_RESOLVER, () =>
    makeClient({
      db: {
        assets: [asset],
        org_members: [],
        asset_stewardships: [
          { asset_id: "asset-1", user_id: "user-1", active: true, access_role: "steward" },
        ],
      },
      userResult: { data: { user: { id: "user-1" } }, error: null },
    })
  );

  const response = await post(handler, { kac: "KPR-OK" }, "Bearer valid");
  assert.equal(response.status, 200);

  const body = await readJson(response);
  assert.equal(body.stewardship.access_role, "steward");
  assert.deepEqual(body.allowed_actions, ["log", "proof", "view"]);
});

test("PublicActionScreen normalization accepts existing public resolver response shape", () => {
  const normalizeResolved = loadNormalizeResolved();
  const asset = { id: "asset-1", name: "Asset", kac_id: "KPR-OK" };

  const normalized = normalizeResolved(
    { asset, system: null, mode: "action", allowed_actions: ["view"] },
    { kac: "KPR-OK", token: null }
  );

  assert.equal(normalized.asset_id, "asset-1");
  assert.equal(normalized.kac, "KPR-OK");
  assert.equal(normalized.asset.id, "asset-1");
  assert.deepEqual(normalized.allowed_actions, ["view"]);
});

