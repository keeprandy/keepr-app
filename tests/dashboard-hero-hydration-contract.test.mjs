import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("dashboard hero resolver migration returns thumbnail URL and preserves private access guard", () => {
  const sql = read("supabase/migrations/20260910124000_dashboard_hero_thumbnail_contract.sql");

  assert.match(sql, /drop function if exists public\.get_dashboard_hero_attachments\(uuid\[\]\)/);
  assert.match(sql, /returns table \([\s\S]*thumb_320_url text/);
  assert.match(sql, /a\.thumb_320_url/);
  assert.match(sql, /public\.keepr_can_access_asset\(a\.asset_id, auth\.uid\(\)\)/);
  assert.match(sql, /revoke execute on function public\.get_dashboard_hero_attachments\(uuid\[\]\) from anon/);
  assert.match(sql, /grant execute on function public\.get_dashboard_hero_attachments\(uuid\[\]\) to authenticated/);
});

test("dashboard prefers precomputed thumbnails and guards unchanged hero placement hydration", () => {
  const source = read("screens/DashboardScreen.js");

  assert.match(source, /if \(a\.thumb_320_url\) \{/);
  assert.match(source, /immediateEntries\.push\(\[placementId, a\.thumb_320_url\]\)/);
  assert.match(source, /fallbackRows\.push\(a\)/);
  assert.match(source, /heroResolvedKeyRef\.current === requestedKey/);
  assert.match(source, /heroResolvingKeyRef\.current === requestedKey/);
  assert.match(source, /resolveSignedHeroFallback\(row\)\.then/);
  assert.doesNotMatch(source, /DASH THUMB/);
});
