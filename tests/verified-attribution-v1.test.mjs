import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const migrationPath = "supabase/migrations/20260724083431_verified_attribution_identity_foundation.sql";
const identityProjectionMigrationPath =
  "supabase/migrations/20260724135000_user_activation_identities_projection.sql";
const memberInviteMigrationPath =
  "supabase/migrations/20260727153000_member_invite_share_workflow.sql";
const keeprEffectMigrationPath =
  "supabase/migrations/20260727213000_keepr_effect_email_slug_base.sql";
const userHandleBackfillMigrationPath =
  "supabase/migrations/20260727214500_backfill_user_activation_identities_for_profile_handles.sql";
const knownAttributionSeedMigrationPath =
  "supabase/migrations/20260727220000_seed_known_person_attributions_drake_keeprandy.sql";
const keeprEffectRecentWindowMigrationPath =
  "supabase/migrations/20260727221500_keepr_effect_recent_window.sql";
const keeprEffectChannelConversionsMigrationPath =
  "supabase/migrations/20260727224500_keepr_effect_slug_channel_conversions.sql";

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadVerifiedAttributionHelpers() {
  const activationSessionSource = read("lib/activationSessions.js")
    .replace(/export const /g, "const ")
    .replace(/export async function /g, "async function ");
  const verifiedSource = read("lib/verifiedAttribution.js")
    .replace(/import \{[\s\S]*?\} from "\.\/activationSessions";\n/, "")
    .replace(/export async function /g, "async function ");

  return new Function(
    `${activationSessionSource}
${verifiedSource}
return {
  ACTIVATION_SESSION_TOKEN_KEY,
  LEGACY_ACQUISITION_SOURCE_SLUG_KEY,
  LEGACY_INVITE_SLUG_KEY,
  getStoredLegacySourceSlug,
  completeSignupAttribution
};`
  )();
}

function memoryStorage() {
  const values = new Map();
  return {
    async getItem(key) {
      return values.get(key) || null;
    },
    async setItem(key, value) {
      values.set(key, String(value));
    },
    async removeItem(key) {
      values.delete(key);
    },
  };
}

test("verified attribution migration creates immutable attribution records and graph-ready lineage", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create table if not exists public\.attribution_records/);
  assert.match(sql, /activation_source_id uuid null references public\.activation_sources/);
  assert.match(sql, /activation_session_id uuid null references public\.activation_sessions/);
  assert.match(sql, /user_id uuid not null references public\.profiles/);
  assert.match(sql, /profile_id uuid not null references public\.profiles/);
  assert.match(sql, /source_slug_snapshot text/);
  assert.match(sql, /source_type_snapshot text/);
  assert.match(sql, /attribution_model text not null default 'direct' check/);
  for (const model of ["direct", "person", "organization", "campaign", "hub", "partner", "system_internal", "legacy"]) {
    assert.match(sql, new RegExp(`'${model}'`));
  }
  assert.match(sql, /organization_id uuid null references public\.orgs/);
  assert.match(sql, /campaign_id uuid null/);
  assert.match(sql, /initiating_actor_id uuid null references public\.profiles/);
  assert.match(sql, /activation_object_type text null/);
  assert.match(sql, /activation_object_id uuid null/);
  assert.match(sql, /intended_action text null/);
  assert.match(sql, /parent_attribution_record_id uuid null references public\.attribution_records/);
  assert.match(sql, /root_attribution_record_id uuid null references public\.attribution_records/);
  assert.match(sql, /attribution_records_user_uidx/);
  assert.match(sql, /attribution_records_session_uidx/);
  assert.match(sql, /attribution_records_metadata_size/);
});

test("every verified user gets one privacy-safe activation identity and personal slug", () => {
  const sql = read(migrationPath);

  assert.match(sql, /activation_sources_one_user_identity_uidx/);
  assert.match(sql, /create or replace function public\.ensure_user_activation_identity/);
  assert.match(sql, /source_type = 'user'/);
  assert.match(sql, /owner_user_id = p_user_id/);
  assert.match(sql, /user_activation_slug_candidate\(p_user_id, 8\)/);
  assert.match(sql, /'u_' \|\| left\(regexp_replace\(p_user_id::text, '-', '', 'g'\)/);
  assert.match(sql, /profile_json->>'username'/);
  assert.match(sql, /profile_json->>'inbox_name'/);
  assert.match(sql, /is_valid_personal_activation_slug/);
  assert.doesNotMatch(sql, /email.*canonical/i);
});

test("user activation identity projection is read-only and derived from activation sources", () => {
  const sql = read(identityProjectionMigrationPath);

  assert.match(sql, /create or replace view public\.user_activation_identities/);
  assert.match(sql, /with \(security_invoker = true\)/);
  assert.match(sql, /from public\.activation_sources src/);
  assert.match(sql, /where src\.source_type = 'user'/);
  assert.match(sql, /src\.owner_user_id as user_id/);
  assert.match(sql, /src\.id as activation_source_id/);
  assert.match(sql, /canonical\.slug as canonical_slug/);
  assert.match(sql, /s\.slug_kind = 'canonical'/);
  assert.match(sql, /revoke all on table public\.user_activation_identities from anon/);
  assert.match(sql, /grant select on table public\.user_activation_identities to authenticated/);
});

test("completion RPC is authenticated, idempotent, and consumes sessions atomically", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create or replace function public\.complete_verified_attribution/);
  assert.match(sql, /current_user_id := auth\.uid\(\)/);
  assert.match(sql, /authentication required to complete verified attribution/);
  assert.match(sql, /from public\.ensure_user_activation_identity/);
  assert.match(sql, /where ar\.user_id = current_user_id/);
  assert.match(sql, /when unique_violation then/);
  assert.match(sql, /for update/);
  assert.match(sql, /set status = 'identified'/);
  assert.match(sql, /set status = 'consumed'/);
  assert.match(sql, /conversion_type = 'signup'/);
  assert.match(sql, /root_attribution_record_id = inserted_record\.id/);
  assert.match(sql, /session_token_supplied boolean/);
  assert.match(sql, /rejection_reason := 'activation_session_expired'/);
  assert.match(sql, /rejection_reason := 'activation_session_claimed_by_another_user'/);
  assert.match(sql, /and chosen_source_slug is not null and not session_token_supplied/);
});

test("legacy compatibility and authoritative source boundaries are preserved", () => {
  const sql = read(migrationPath);

  assert.match(sql, /alter table public\.profiles[\s\S]*add column if not exists acquisition_source_slug text/);
  assert.match(sql, /public\.resolve_activation_source_slug\(chosen_source_slug\)/);
  assert.match(sql, /resolved\.resolution_state in \('canonical', 'alias'\)/);
  assert.match(sql, /record_status := 'legacy_fallback'/);
  assert.match(sql, /chosen_attribution_model := 'legacy'/);
  assert.match(sql, /chosen_source_slug ~ '\^u_\[a-z0-9\]\{8\}\$'/);
  assert.match(sql, /update public\.profiles/);
  assert.match(sql, /acquisition_source_slug = coalesce\(acquisition_source_slug, chosen_source_slug\)/);
});

test("admin corrections are append-only and audited", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create table if not exists public\.attribution_record_corrections/);
  assert.match(sql, /reason text not null check \(length\(trim\(reason\)\) >= 8\)/);
  assert.match(sql, /corrected_by uuid not null references public\.profiles/);
  assert.match(sql, /corrected_at timestamptz not null default now\(\)/);
  assert.match(sql, /create or replace function public\.correct_attribution_record/);
  assert.match(sql, /if not public\.is_activation_source_admin\(\) then/);
  assert.doesNotMatch(sql, /delete from public\.attribution_records/i);
});

test("historical PostHog-style backfill remains report-only", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create or replace function public\.report_unmatched_historical_activations/);
  assert.match(sql, /p\.acquisition_source_slug/);
  assert.match(sql, /where public\.is_activation_source_admin\(\)/);
  assert.doesNotMatch(sql, /insert into public\.attribution_records[\\s\\S]*report_unmatched_historical_activations/);
});

test("signup helper sends session token and legacy source slug to authoritative RPC", async () => {
  const {
    ACTIVATION_SESSION_TOKEN_KEY,
    LEGACY_ACQUISITION_SOURCE_SLUG_KEY,
    completeSignupAttribution,
  } = loadVerifiedAttributionHelpers();
  const storage = memoryStorage();
  await storage.setItem(ACTIVATION_SESSION_TOKEN_KEY, "opaque-session");
  await storage.setItem(LEGACY_ACQUISITION_SOURCE_SLUG_KEY, "keeprandy");

  const result = await completeSignupAttribution({
    storage,
    supabase: {
      async rpc(name, payload) {
        assert.equal(name, "complete_verified_attribution");
        assert.equal(payload.p_activation_session_token, "opaque-session");
        assert.equal(payload.p_source_slug, "keeprandy");
        assert.equal(payload.p_intended_action, "signup");
        return {
          data: [
            {
              attribution_record_id: "attr-1",
              activation_session_id: "session-1",
              canonical_slug: "u_12345678",
              personal_share_url: "https://www.keeprhome.com/invite/u_12345678",
            },
          ],
          error: null,
        };
      },
    },
  });

  assert.equal(result.attribution_record_id, "attr-1");
  assert.equal(await storage.getItem(ACTIVATION_SESSION_TOKEN_KEY), null);
});

test("AuthScreen integrates verified attribution without changing signup analytics contract", () => {
  const source = read("screens/AuthScreen.js");

  assert.match(source, /import \{ completeSignupAttribution, getStoredLegacySourceSlug \} from "\.\.\/lib\/verifiedAttribution"/);
  assert.match(source, /await completeSignupAttribution\(/);
  assert.match(source, /track\("user_signed_up"/);
  assert.match(source, /source_slug: sourceSlug/);
  assert.match(source, /has_attribution: !!sourceSlug/);
  assert.doesNotMatch(source, /ShareKeeprScreen/);
});

test("member invite workflow exposes clean-link preview metadata and join notification trigger", () => {
  const sql = read(memberInviteMigrationPath);
  const api = read("api/og/invite/[slug].js");
  const vercel = read("vercel.json");

  assert.match(sql, /create or replace function public\.resolve_member_invite_link/);
  assert.match(sql, /from public\.resolve_activation_source_slug\(p_slug\)/);
  assert.match(sql, /grant execute on function public\.resolve_member_invite_link\(text\) to anon, authenticated/);
  assert.match(sql, /route_path := '\/invite\/' \|\| coalesce/);
  assert.match(sql, /create or replace function public\.notify_member_invite_attribution/);
  assert.match(sql, /new\.status <> 'verified'/);
  assert.match(sql, /new\.attribution_model <> 'person'/);
  assert.match(sql, /to_regclass\('public\.notifications'\) is null/);
  assert.match(sql, /source_row\.owner_user_id = new\.user_id/);
  assert.match(sql, /'member_invite_joined'/);
  assert.match(sql, /after insert on public\.attribution_records/);
  assert.doesNotMatch(sql, /delete from public\.attribution_records/i);

  assert.match(api, /resolve_member_invite_link/);
  assert.match(api, /og:title/);
  assert.match(api, /og:description/);
  assert.match(api, /og:image/);
  assert.match(api, /Cache-Control/);

  assert.match(vercel, /"source": "\/invite\/:slug"/);
  assert.match(vercel, /"destination": "\/api\/og\/invite\/:slug"/);
});

test("Keepr Effect report is authenticated, ledger-backed, and privacy-safe", () => {
  const sql = read(keeprEffectMigrationPath);

  assert.match(sql, /create or replace function public\.get_my_keepr_effect\(\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /current_user_id := auth\.uid\(\)/);
  assert.match(sql, /raise exception 'authentication required'/);
  assert.match(sql, /from public\.attribution_records ar/);
  assert.match(sql, /ar\.activation_source_id = source_row\.id/);
  assert.match(sql, /ar\.status = 'verified'/);
  assert.match(sql, /ar\.attribution_model = 'person'/);
  assert.match(sql, /from public\.assets a/);
  assert.match(sql, /from public\.attachments att/);
  assert.match(sql, /from public\.share_actions sa/);
  assert.match(sql, /jsonb_build_object/);
  assert.match(sql, /actor_display_name/);
  assert.match(sql, /actor_photo_url/);
  assert.match(sql, /email_local_slug/);
  assert.match(sql, /p\.profile_photo_attachment_id/);
  assert.match(sql, /s\.normalized_slug !~ '\^u_\[0-9a-f\]\{8\}\$'/);
  assert.match(sql, /became a Keepr/);
  assert.match(sql, /created an asset/);
  assert.match(sql, /preserved an ownership record/);
  assert.doesNotMatch(sql, /@[^']*actor_display_name/i);
  assert.doesNotMatch(sql, /att\.file_name|['"]file_name['"]/i);
  assert.doesNotMatch(sql, /serial/i);
  assert.doesNotMatch(sql, /vin/i);
  assert.doesNotMatch(sql, /address/i);
  assert.match(sql, /grant execute on function public\.get_my_keepr_effect\(\) to authenticated/);
});

test("profile handle backfill materializes invite identities without attribution credit", () => {
  const sql = read(userHandleBackfillMigrationPath);

  assert.match(sql, /public\.is_valid_personal_activation_slug\(p\.username\)/);
  assert.match(sql, /public\.is_valid_personal_activation_slug\(p\.inbox_name\)/);
  assert.match(sql, /public\.ensure_user_activation_identity/);
  assert.match(sql, /https:\/\/www\.keeprhome\.com\/invite/);
  assert.doesNotMatch(sql, /insert into public\.attribution_records/i);
  assert.doesNotMatch(sql, /update public\.attribution_records/i);
  assert.doesNotMatch(sql, /profiles[\s\S]*acquisition_source_slug[\s\S]*=/i);
});

test("known historical attribution seed is audited and limited to member sources", () => {
  const sql = read(knownAttributionSeedMigrationPath);

  assert.match(sql, /andy_approved_historical_seed/);
  assert.match(sql, /Andy supplied known legitimate referral list/);
  assert.match(sql, /insert into public\.attribution_records/);
  assert.match(sql, /on conflict \(user_id\) do nothing/);
  assert.match(sql, /where not exists/);
  assert.match(sql, /lower\(p\.email\) = lower\(seed\.expected_email\)/);
  assert.match(sql, /source\.source_type = 'user'/);
  assert.match(sql, /source_slug_snapshot/);
  assert.match(sql, /'person'/);
  assert.match(sql, /'verified'/);
  assert.match(sql, /set acquisition_source_slug = seed\.source_slug/);
  assert.doesNotMatch(sql, /'web'/);
});

test("Keepr Effect recent impact supports a sticky 30-day default window", () => {
  const sql = read(keeprEffectRecentWindowMigrationPath);
  const helper = read("lib/keeprEffect.js");
  const screen = read("screens/KeeprEffectScreen.js");

  assert.match(sql, /p_recent_window text default '30d'/);
  assert.match(sql, /when 'today' then date_trunc\('day', now\(\)\)/);
  assert.match(sql, /when '7d' then now\(\) - interval '7 days'/);
  assert.match(sql, /when '30d' then now\(\) - interval '30 days'/);
  assert.match(sql, /where happened_at >= recent_since/);
  assert.match(sql, /grant execute on function public\.get_my_keepr_effect\(text\) to authenticated/);

  assert.match(helper, /DEFAULT_KEEPR_EFFECT_RECENT_WINDOW = "30d"/);
  assert.match(helper, /p_recent_window: normalizeKeeprEffectRecentWindow\(recentWindow\)/);
  assert.match(screen, /RECENT_WINDOW_STORAGE_KEY/);
  assert.match(screen, /Last 30 days/);
  assert.match(screen, /AsyncStorage\.setItem\(RECENT_WINDOW_STORAGE_KEY, value\)/);
});

test("Keepr Effect channel conversions join verified attribution to share actions and slug channels", () => {
  const sql = read(keeprEffectChannelConversionsMigrationPath);
  const helper = read("lib/keeprEffect.js");
  const screen = read("screens/KeeprEffectScreen.js");

  assert.match(sql, /create or replace function public\.get_my_keepr_effect_channel_conversions/);
  assert.match(sql, /owner_user_id = auth\.uid\(\)/);
  assert.match(sql, /join public\.attribution_records ar/);
  assert.match(sql, /join public\.activation_sessions session/);
  assert.match(sql, /left join public\.share_actions sa/);
  assert.match(sql, /session\.id = ar\.activation_session_id/);
  assert.match(sql, /sa\.id = session\.share_action_id/);
  assert.match(sql, /session\.utm->>'channel'/);
  assert.match(sql, /session\.metadata->>'share_channel'/);
  assert.match(sql, /\[\?&\]channel=\(\[\^&#\]\+\)/);
  assert.match(sql, /grant execute on function public\.get_my_keepr_effect_channel_conversions\(\) to authenticated/);

  assert.match(helper, /get_my_keepr_effect_channel_conversions/);
  assert.match(helper, /conversionsByChannel/);
  assert.match(screen, /conversionCounts/);
  assert.match(screen, /buildUserInviteUrlWithChannel/);
  assert.match(screen, /joined/);
});
