import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const KAC_RESOLVE = new URL("../supabase/functions/_shared/kacResolve.ts", import.meta.url);
const KAC_AUTH = new URL("../supabase/functions/_shared/kacAuth.ts", import.meta.url);
const KAC_TYPES = new URL("../supabase/functions/_shared/kacManifestTypes.ts", import.meta.url);

function loadModule(path) {
  const source = fs.readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const module = { exports: {} };
  const context = { module, exports: module.exports, Request, Response, console };
  vm.createContext(context);
  new vm.Script(compiled, { filename: path.pathname }).runInContext(context);
  return module.exports;
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

function makeClient(db = {}) {
  return {
    from(table) {
      return new Query(table, db);
    },
  };
}

function local(value) {
  return JSON.parse(JSON.stringify(value));
}

function activeStewardship(overrides) {
  return {
    asset_id: "asset-1",
    active: true,
    starts_at: "2024-01-01T00:00:00.000Z",
    ends_at: null,
    ...overrides,
  };
}

const { normalizeKac, isValidNormalizedKac, resolveKacAsset } = loadModule(KAC_RESOLVE);
const { authorizeKacAsset } = loadModule(KAC_AUTH);
const { isCallableV1ManifestPurpose, CALLABLE_V1_MANIFEST_PURPOSES } = loadModule(KAC_TYPES);

test("normalizes KAC input", () => {
  assert.equal(normalizeKac(" kpr-6gv2-mj6w "), "KPR-6GV2-MJ6W");
  assert.equal(normalizeKac("kpr 6gv2 mj6w"), "KPR6GV2MJ6W");
  assert.equal(normalizeKac(" kpr - 6gv2 - mj6w "), "KPR-6GV2-MJ6W");
  assert.equal(normalizeKac(""), null);
  assert.equal(normalizeKac(null), null);
});

test("validates malformed KACs after normalization", async () => {
  assert.equal(isValidNormalizedKac("KPR-6GV2-MJ6W"), true);
  assert.equal(isValidNormalizedKac(normalizeKac(" kpr - 6gv2 - mj6w ")), true);
  assert.equal(isValidNormalizedKac(normalizeKac("kpr 6gv2 mj6w")), false);
  assert.equal(isValidNormalizedKac(normalizeKac("kpr/6gv2/mj6w")), false);

  const result = await resolveKacAsset(makeClient({ assets: [] }), "kpr/6gv2/mj6w");
  assert.deepEqual(local(result), { ok: false, kac: "KPR/6GV2/MJ6W", error: "malformed_kac" });
});

test("resolves a valid asset by normalized assets.kac_id", async () => {
  const admin = makeClient({
    assets: [
      {
        id: "asset-1",
        kac_id: "KPR-6GV2-MJ6W",
        owner_id: "owner-1",
        name: "Asset",
        type: "vehicle",
        status: "active",
        asset_mode: "personal",
        deleted_at: null,
      },
    ],
  });

  const result = await resolveKacAsset(admin, " kpr-6gv2-mj6w ");
  assert.equal(result.ok, true);
  assert.equal(result.asset.id, "asset-1");
  assert.equal(result.asset.kac_id, "KPR-6GV2-MJ6W");
  assert.equal(result.asset.owner_id, "owner-1");
  assert.equal(result.asset.lifecycle_state, "active");
  assert.equal(result.asset.manifest_availability, "available");
});

test("returns asset_not_found for unknown KAC", async () => {
  const result = await resolveKacAsset(makeClient({ assets: [] }), "KPR-NOPE");
  assert.deepEqual(local(result), { ok: false, kac: "KPR-NOPE", error: "asset_not_found" });
});

test("excludes deleted assets without treating archived assets as deleted", async () => {
  const admin = makeClient({
    assets: [
      { id: "deleted", kac_id: "KPR-DELETED", status: "active", deleted_at: "2025-01-01" },
      { id: "archived", kac_id: "KPR-ARCHIVED", status: "archived", deleted_at: null },
      { id: "disputed", kac_id: "KPR-DISPUTED", status: "disputed", deleted_at: null },
    ],
  });

  assert.equal((await resolveKacAsset(admin, "KPR-DELETED")).ok, false);

  const archived = await resolveKacAsset(admin, "KPR-ARCHIVED");
  assert.equal(archived.ok, true);
  assert.equal(archived.asset.lifecycle_state, "archived");
  assert.equal(archived.asset.manifest_availability, "available");

  const disputed = await resolveKacAsset(admin, "KPR-DISPUTED");
  assert.equal(disputed.ok, true);
  assert.equal(disputed.asset.lifecycle_state, "disputed");
  assert.equal(disputed.asset.manifest_availability, "admin_review_required");
});

test("authorizes a direct owner", async () => {
  const result = await authorizeKacAsset(makeClient(), { id: "asset-1", owner_id: "user-1" }, "user-1");
  assert.deepEqual(local(result), { access: "owner", access_role: "owner", user_id: "user-1" });
});

test("authorizes a direct steward", async () => {
  const result = await authorizeKacAsset(
    makeClient({
      asset_stewardships: [
        activeStewardship({ user_id: "user-1", org_id: null, access_role: "steward" }),
      ],
      org_members: [],
    }),
    { id: "asset-1", owner_id: "owner-1" },
    "user-1",
    new Date("2025-01-01T00:00:00.000Z"),
  );

  assert.deepEqual(local(result), { access: "direct_steward", access_role: "steward", user_id: "user-1" });
});

test("authorizes organization-based stewardship", async () => {
  const result = await authorizeKacAsset(
    makeClient({
      org_members: [{ user_id: "user-1", org_id: "org-1" }],
      asset_stewardships: [
        activeStewardship({ user_id: null, org_id: "org-1", access_role: "steward" }),
      ],
    }),
    { id: "asset-1", owner_id: "owner-1" },
    "user-1",
    new Date("2025-01-01T00:00:00.000Z"),
  );

  assert.deepEqual(local(result), {
    access: "org_steward",
    access_role: "steward",
    user_id: "user-1",
    via_org_id: "org-1",
  });
});

test("preserves viewer behavior", async () => {
  const result = await authorizeKacAsset(
    makeClient({
      asset_stewardships: [
        activeStewardship({ user_id: "user-1", org_id: null, access_role: "viewer" }),
      ],
      org_members: [],
    }),
    { id: "asset-1", owner_id: "owner-1" },
    "user-1",
    new Date("2025-01-01T00:00:00.000Z"),
  );

  assert.deepEqual(local(result), { access: "viewer", access_role: "viewer", user_id: "user-1" });
});

test("returns unauthorized without ownership or stewardship", async () => {
  const result = await authorizeKacAsset(
    makeClient({ asset_stewardships: [], org_members: [] }),
    { id: "asset-1", owner_id: "owner-1" },
    "user-1",
  );

  assert.deepEqual(local(result), { access: "unauthorized", access_role: null, user_id: "user-1" });
});

test("accepts only asset_overview and admin_diagnostic as callable v1 purposes", () => {
  assert.deepEqual(local(CALLABLE_V1_MANIFEST_PURPOSES), ["asset_overview", "admin_diagnostic"]);
  assert.equal(isCallableV1ManifestPurpose("asset_overview"), true);
  assert.equal(isCallableV1ManifestPurpose("admin_diagnostic"), true);
  assert.equal(isCallableV1ManifestPurpose("answer_question"), false);
  assert.equal(isCallableV1ManifestPurpose("build_plan"), false);
  assert.equal(isCallableV1ManifestPurpose("prepare_transfer"), false);
  assert.equal(isCallableV1ManifestPurpose("export"), false);
});
