import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadActivationHelpers() {
  const source = read("lib/activationSources.js")
    .replace(/export const /g, "const ")
    .replace(/export function /g, "function ")
    .replace(/export async function /g, "async function ");

  return new Function(
    `${source}
return {
  ACTIVATION_SOURCE_TYPES,
  ACTIVATION_SLUG_STATUSES,
  ACTIVATION_SLUG_KINDS,
  LEGACY_COMPATIBILITY_SLUGS,
  normalizeActivationSlug,
  getLegacySlugCompatibility,
  normalizeResolvedActivationSource,
  resolveActivationSourceSlug,
  lookupActivationSources
};`
  )();
}

test("activation source migration creates durable sources, slug aliases, RLS, and RPCs", () => {
  const sql = read("supabase/migrations/20260723165431_activation_sources_slug_foundation.sql");

  assert.match(sql, /create table if not exists public\.activation_sources/);
  assert.match(sql, /create table if not exists public\.activation_source_slugs/);
  assert.match(sql, /source_type in \(/);
  for (const type of ["user", "organization", "campaign", "hub", "keeprpro", "partner", "system_internal"]) {
    assert.match(sql, new RegExp(`'${type}'`));
  }
  assert.match(sql, /activation_source_slugs_normalized_slug_uidx/);
  assert.match(sql, /on public\.activation_source_slugs \(normalized_slug\)/);
  assert.match(sql, /status in \('active', 'disabled', 'retired'\)/);
  assert.match(sql, /slug_kind in \('canonical', 'alias'\)/);
  assert.match(sql, /redirect_activation_source_id uuid references public\.activation_sources/);
  assert.match(sql, /raise exception 'activation source slug cannot redirect to its own source'/);
  assert.match(sql, /raise exception 'activation source slug redirect target must be active'/);
  assert.match(sql, /new\.created_by = coalesce\(new\.created_by, auth\.uid\(\)\)/);
  assert.match(sql, /before insert or update on public\.activation_sources/);
  assert.match(sql, /alter table public\.activation_sources enable row level security/);
  assert.match(sql, /alter table public\.activation_source_slugs enable row level security/);
  assert.match(sql, /grant execute on function public\.resolve_activation_source_slug\(text\) to anon, authenticated/);
  assert.match(sql, /grant execute on function public\.lookup_activation_sources\(text, integer\) to authenticated/);
});

test("public resolver returns only safe fields and excludes disabled slugs", () => {
  const sql = read("supabase/migrations/20260723165431_activation_sources_slug_foundation.sql");
  const publicReturns = sql.slice(
    sql.indexOf("create or replace function public.resolve_activation_source_slug"),
    sql.indexOf("language plpgsql", sql.indexOf("create or replace function public.resolve_activation_source_slug"))
  );

  assert.match(sql, /create or replace function public\.resolve_activation_source_slug/);
  assert.match(sql, /s\.status in \('active', 'retired'\)/);
  assert.match(sql, /where src\.status = 'active'/);
  assert.doesNotMatch(sql, /s\.status in \('active', 'disabled', 'retired'\)/);
  assert.match(publicReturns, /resolution_state text/);
  assert.match(publicReturns, /activation_source_id uuid/);
  assert.match(publicReturns, /source_type text/);
  assert.match(publicReturns, /display_name text/);
  assert.match(publicReturns, /slug text/);
  assert.match(publicReturns, /normalized_slug text/);
  assert.match(publicReturns, /slug_kind text/);
  assert.match(publicReturns, /is_redirect boolean/);
  assert.doesNotMatch(publicReturns, /metadata/);
  assert.doesNotMatch(publicReturns, /created_by/);
  assert.doesNotMatch(publicReturns, /owner_user_id/);
  assert.doesNotMatch(publicReturns, /owner_org_id/);
  assert.doesNotMatch(publicReturns, /source_key/);
  assert.doesNotMatch(publicReturns, /source_status/);
});

test("legacy invite slugs remain compatible until canonical sources are migrated", () => {
  const {
    normalizeActivationSlug,
    getLegacySlugCompatibility,
    LEGACY_COMPATIBILITY_SLUGS,
  } = loadActivationHelpers();

  assert.equal(normalizeActivationSlug(" KeeprAndy "), "keeprandy");
  assert.equal(normalizeActivationSlug("Wilson Marine"), "wilson-marine");
  assert.equal(LEGACY_COMPATIBILITY_SLUGS.keeprandy.legacyClassification, "known_v0_personal_invite");
  assert.equal(LEGACY_COMPATIBILITY_SLUGS.drake.legacyClassification, "known_v0_personal_invite");
  assert.equal(LEGACY_COMPATIBILITY_SLUGS.hub.legacyClassification, "known_v0_system_campaign");
  assert.equal(LEGACY_COMPATIBILITY_SLUGS.email.legacyClassification, "known_v0_system_campaign");

  assert.deepEqual(getLegacySlugCompatibility("u_67187ffd"), {
    normalizedSlug: "u_67187ffd",
    sourceSlug: "u_67187ffd",
    activationSourceId: null,
    resolutionState: "legacy_fallback",
    legacyClassification: "legacy_generated_user_prefix",
    isVerifiedCanonical: false,
    isCompatibilityFallback: true,
  });
});

test("resolver prefers canonical server identity and falls back to V0 source_slug", async () => {
  const { resolveActivationSourceSlug } = loadActivationHelpers();

  const canonical = await resolveActivationSourceSlug({
    slug: "movember",
    supabase: {
      async rpc(name, payload) {
        assert.equal(name, "resolve_activation_source_slug");
        assert.deepEqual(payload, { p_slug: "movember" });
        return {
          data: [
            {
              activation_source_id: "source-movember",
              resolution_state: "canonical",
              source_type: "campaign",
              display_name: "Movember",
              slug: "movember",
              normalized_slug: "movember",
              slug_kind: "canonical",
              is_redirect: false,
            },
          ],
          error: null,
        };
      },
    },
  });

  assert.equal(canonical.activationSourceId, "source-movember");
  assert.equal(canonical.sourceType, "campaign");
  assert.equal(canonical.resolutionState, "canonical");
  assert.equal(canonical.isVerifiedCanonical, true);
  assert.equal(canonical.isCompatibilityFallback, false);

  const fallback = await resolveActivationSourceSlug({
    slug: "wilsonmarine",
    supabase: {
      async rpc() {
        return { data: [], error: null };
      },
    },
  });

  assert.equal(fallback.activationSourceId, null);
  assert.equal(fallback.resolutionState, "legacy_fallback");
  assert.equal(fallback.sourceSlug, "wilsonmarine");
  assert.equal(fallback.legacyClassification, "unmigrated_v0_source_slug");
  assert.equal(fallback.isVerifiedCanonical, false);
  assert.equal(fallback.isCompatibilityFallback, true);
});

test("acceptance examples cover active, disabled, and retired alias behavior", () => {
  const sql = read("supabase/migrations/20260723165431_activation_sources_slug_foundation.sql");
  const { getLegacySlugCompatibility } = loadActivationHelpers();

  assert.equal(getLegacySlugCompatibility("keeprandy").legacyClassification, "known_v0_personal_invite");
  assert.equal(getLegacySlugCompatibility("wilsonmarine").sourceSlug, "wilsonmarine");
  assert.equal(getLegacySlugCompatibility("movember").sourceSlug, "movember");
  assert.equal(getLegacySlugCompatibility("u_abcdef12").legacyClassification, "legacy_generated_user_prefix");

  assert.match(sql, /s\.status in \('active', 'retired'\)/);
  assert.match(sql, /redirect_activation_source_id is not null as is_redirect/);
  assert.match(sql, /status text not null default 'active' check \(status in \('active', 'disabled', 'retired'\)\)/);
});

test("resolution states distinguish canonical, alias, legacy fallback, and unresolved", () => {
  const sql = read("supabase/migrations/20260723165431_activation_sources_slug_foundation.sql");

  assert.match(sql, /then 'canonical'/);
  assert.match(sql, /else 'alias'/);
  assert.match(sql, /'unresolved'::text/);

  const { getLegacySlugCompatibility } = loadActivationHelpers();
  assert.equal(getLegacySlugCompatibility("keeprandy").resolutionState, "legacy_fallback");
  assert.equal(getLegacySlugCompatibility("u_12345678").resolutionState, "legacy_fallback");
});

test("legacy fallback never fabricates verified owner identity", () => {
  const { getLegacySlugCompatibility } = loadActivationHelpers();

  for (const slug of ["keeprandy", "drake", "hub", "email", "u_12345678", "wilsonmarine", "movember"]) {
    const fallback = getLegacySlugCompatibility(slug);
    assert.equal(fallback.activationSourceId, null);
    assert.equal(fallback.isVerifiedCanonical, false);
    assert.equal(fallback.ownerUserId, undefined);
    assert.equal(fallback.ownerOrgId, undefined);
    assert.equal(fallback.sourceType, undefined);
    assert.equal(fallback.sourceTypeHint, undefined);
  }
});

test("case-insensitive uniqueness is enforced by normalized slug", () => {
  const sql = read("supabase/migrations/20260723165431_activation_sources_slug_foundation.sql");
  const { normalizeActivationSlug } = loadActivationHelpers();

  assert.equal(normalizeActivationSlug("KeeprAndy"), "keeprandy");
  assert.equal(normalizeActivationSlug("keeprandy"), "keeprandy");
  assert.equal(normalizeActivationSlug("KEEP RANDY"), "keep-randy");
  assert.match(sql, /activation_source_slugs_normalized_slug_uidx/);
  assert.match(sql, /on public\.activation_source_slugs \(normalized_slug\)/);
});

test("admin lookup is protected and normal authenticated users rely on RLS for table writes", () => {
  const sql = read("supabase/migrations/20260723165431_activation_sources_slug_foundation.sql");

  assert.match(sql, /where public\.is_activation_source_admin\(\)/);
  assert.match(sql, /revoke all on function public\.is_activation_source_admin\(\) from public/);
  assert.match(sql, /grant execute on function public\.is_activation_source_admin\(\) to authenticated/);
  assert.match(sql, /using \(public\.is_activation_source_admin\(\)\)/);
  assert.match(sql, /with check \(public\.is_activation_source_admin\(\)\)/);
  assert.match(sql, /grant select, insert, update, delete on table public\.activation_sources to authenticated/);
  assert.match(sql, /grant select, insert, update, delete on table public\.activation_source_slugs to authenticated/);
  assert.match(sql, /revoke all on table public\.activation_sources from anon/);
  assert.match(sql, /revoke all on table public\.activation_source_slugs from anon/);
});
