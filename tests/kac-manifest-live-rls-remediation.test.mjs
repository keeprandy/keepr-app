import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260713162000_kac_manifest_admin_resolve_asset.sql", import.meta.url),
  "utf8",
);
const endpoint = fs.readFileSync(
  new URL("../supabase/functions/kac-intelligence-manifest/index.ts", import.meta.url),
  "utf8",
);
const resolver = fs.readFileSync(
  new URL("../supabase/functions/_shared/kacResolve.ts", import.meta.url),
  "utf8",
);

test("admin KAC resolution RPC is narrowly scoped and security-definer", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.keepr_resolve_kac_for_manifest_admin\(p_kac text\)/);
  assert.match(migration, /SECURITY DEFINER/);
  assert.match(migration, /SET search_path = public, pg_catalog/);
  assert.match(migration, /SET row_security = off/);
  assert.match(migration, /v_uid uuid := auth\.uid\(\)/);
  assert.match(migration, /WHERE p\.id = v_uid/);
  assert.match(migration, /v_role NOT IN \('admin', 'superkeepr'\)/);
  assert.match(migration, /WHERE a\.kac_id = v_kac/);
  assert.match(migration, /AND a\.deleted_at IS NULL/);
  assert.match(migration, /LIMIT 1/);
});

test("admin KAC resolution RPC exposes only minimal identity fields", () => {
  const returnsBlock = migration.match(/RETURNS TABLE \(([\s\S]*?)\)\s+LANGUAGE/)[1];
  const selectedBlock = migration.match(/RETURN QUERY\s+SELECT([\s\S]*?)FROM public\.assets/)[1];
  const allowed = ["id", "kac_id", "master_asset_id", "status", "asset_mode"];
  for (const column of allowed) {
    assert.match(returnsBlock, new RegExp(`\\b${column}\\b`));
  }
  for (const forbidden of ["owner_id", "email", "phone", "address", "name", "type", "vin", "hin", "serial_number", "storage_path", "extracted_text"]) {
    assert.equal(returnsBlock.includes(forbidden), false, `${forbidden} must not be returned`);
    assert.equal(selectedBlock.includes(`.${forbidden}`), false, `${forbidden} must not be selected`);
  }
});

test("admin KAC resolution RPC grants only authenticated execution", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.keepr_resolve_kac_for_manifest_admin\(text\) FROM PUBLIC/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.keepr_resolve_kac_for_manifest_admin\(text\) FROM anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.keepr_resolve_kac_for_manifest_admin\(text\) TO authenticated/);
});

test("endpoint uses admin RPC only after trusted profile role check", () => {
  const adminCheckIndex = endpoint.indexOf("const isAdmin = await getPlatformAdminAccess(client, auth.user_id);");
  const adminResolveIndex = endpoint.indexOf("resolveKacAssetForManifestAdmin(client, body?.kac)");
  const normalResolveIndex = endpoint.indexOf("resolveKacAsset(client, body?.kac)");
  assert.notEqual(adminCheckIndex, -1);
  assert.ok(adminCheckIndex < adminResolveIndex);
  assert.ok(normalResolveIndex > adminResolveIndex);
  assert.match(endpoint, /const resolved = isAdmin\s+\?\s+await resolveKacAssetForManifestAdmin\(client, body\?\.kac\)\s+:\s+await resolveKacAsset\(client, body\?\.kac\)/);
});

test("manifest endpoint has no service-role fallback", () => {
  assert.equal(endpoint.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(endpoint.includes("SERVICE_ROLE_KEY"), false);
  assert.equal(endpoint.includes("service_role"), false);
  assert.match(endpoint, /const anonKey = Deno\.env\.get\("SUPABASE_ANON_KEY"\)/);
  assert.match(endpoint, /return createClient\(url, anonKey,/);
});

test("shared admin resolver calls only the narrow RPC", () => {
  assert.match(resolver, /admin\.rpc\("keepr_resolve_kac_for_manifest_admin", \{ p_kac: kac \}\)/);
  assert.equal(resolver.includes("SUPABASE_SERVICE_ROLE_KEY"), false);
  assert.equal(resolver.includes("service_role"), false);
});
