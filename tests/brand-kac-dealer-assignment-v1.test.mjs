import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("brand graph adds first-class brands without replacing orgs or templates", () => {
  const sql = read("supabase/migrations/20260831150000_brand_kac_dealer_assignment_v1.sql");

  assert.match(sql, /create table if not exists public\.brands/);
  assert.match(sql, /create table if not exists public\.organization_brand_relationships/);
  assert.match(sql, /alter table public\.asset_model_templates[\s\S]*add column if not exists brand_id/);
  assert.match(sql, /references public\.orgs\(id\)/);
  assert.match(sql, /references public\.brands\(id\)/);
  assert.match(sql, /brand_id uuid references public\.brands\(id\) on delete set null/);
  assert.doesNotMatch(sql, /drop table public\.orgs/);
  assert.doesNotMatch(sql, /drop table public\.asset_relationships/);
  assert.doesNotMatch(sql, /drop table public\.asset_model_templates/);
});

test("organization brand relationships model eligibility, not KAC participation", () => {
  const sql = read("supabase/migrations/20260831150000_brand_kac_dealer_assignment_v1.sql");

  for (const key of [
    "owns_brand",
    "manufactures_brand",
    "manages_brand",
    "distributes_brand",
    "authorized_dealer_for",
    "represents_brand",
    "services_brand",
  ]) {
    assert.match(sql, new RegExp(key));
  }

  assert.match(sql, /organization_is_eligible_dealer_for_brand/);
  assert.match(sql, /relationship_type in \('authorized_dealer_for', 'represents_brand'\)/);
  assert.match(sql, /r\.status = 'active'/);
  assert.match(sql, /r\.evidence_state in \('org_confirmed', 'evidence_verified'\)/);
  assert.match(sql, /These rows establish eligibility\/context only/);
  const relationshipTable = sql.slice(
    sql.indexOf("create table if not exists public.organization_brand_relationships"),
    sql.indexOf("create unique index if not exists organization_brand_relationships_active_uidx")
  );
  assert.doesNotMatch(relationshipTable, /access_scope/);
});

test("legacy marine org relationship data backfills into brands compatibly", () => {
  const sql = read("supabase/migrations/20260831150000_brand_kac_dealer_assignment_v1.sql");

  assert.match(sql, /asset_model_templates\.manufacturer/);
  assert.match(sql, /legacy_brand_like_org/);
  assert.match(sql, /legacy_org_relationship_backfill/);
  assert.match(sql, /r\.relationship_type in \('represented_brand', 'authorized_dealer'\)/);
  assert.match(sql, /when 'authorized_dealer' then 'authorized_dealer_for'/);
  assert.match(sql, /else 'represents_brand'/);
  assert.match(sql, /manufactures_brand/);
});

test("assign_kac_dealer validates model brand eligibility before writing asset relationship", () => {
  const sql = read("supabase/migrations/20260831150000_brand_kac_dealer_assignment_v1.sql");
  const client = read("lib/keeprspaceApi.js");

  assert.match(sql, /create or replace function public\.assign_kac_dealer/);
  assert.match(sql, /from public\.asset_template_bindings b/);
  assert.match(sql, /join public\.asset_model_templates t on t\.id = b\.template_id/);
  assert.match(sql, /if v_template\.brand_id is null then/);
  assert.match(sql, /organization_is_eligible_dealer_for_brand\(v_dealer\.id, v_brand\.id\)/);
  assert.match(sql, /dealer is not eligible for this brand/);
  assert.match(sql, /insert into public\.asset_relationships/);
  assert.match(sql, /'assigned_dealer'/);
  assert.match(sql, /'kac\.dealer\.assigned'/);
  assert.match(client, /assignKacDealer/);
  assert.match(client, /p_relationship_type: relationshipType/);
  assert.match(sql, /relationship_type in \([^)]*'assigned_dealer'/);
});

test("brand creation is an internal control-plane operation", () => {
  const sql = read("supabase/migrations/20260831150000_brand_kac_dealer_assignment_v1.sql");

  assert.match(sql, /create or replace function public\.upsert_brand_by_name/);
  assert.match(sql, /not public\.is_keepr_internal_admin\(auth\.uid\(\)\)/);
  assert.match(sql, /not authorized to create or manage brands/);
});
