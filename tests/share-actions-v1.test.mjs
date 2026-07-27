import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const migrationPath = "supabase/migrations/20260724123000_share_actions_foundation.sql";
const digestHotfixMigrationPath =
  "supabase/migrations/20260724183500_qualify_share_action_digest.sql";

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadShareActionHelpers() {
  const inviteLinksSource = read("lib/inviteLinks.js")
    .replace(/export function /g, "function ");
  const activationSessionSource = read("lib/activationSessions.js")
    .replace(/export const /g, "const ")
    .replace(/export async function /g, "async function ");
  const shareActionSource = read("lib/shareActions.js")
    .replace(/import \{[\s\S]*?\} from "\.\/activationSessions";\n/, "")
    .replace(/import \{ getKeeprBaseUrl \} from "\.\/inviteLinks";\n/, "")
    .replace(/export const /g, "const ")
    .replace(/export function /g, "function ")
    .replace(/export async function /g, "async function ");

  return new Function(
    `${inviteLinksSource}
${activationSessionSource}
${shareActionSource}
return {
  SHARE_ACTION_OBJECT_TYPES,
  SHARE_ACTION_INTENDED_ACTIONS,
  SHARE_ACTION_CHANNELS,
  buildShareActionUrl,
  normalizeShareAction,
  createShareAction,
  openShareAction,
  ACTIVATION_SESSION_TOKEN_KEY,
  LEGACY_ACQUISITION_SOURCE_SLUG_KEY,
  LEGACY_INVITE_SLUG_KEY
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

test("share action migration creates durable table, context columns, RLS, and RPCs", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create table if not exists public\.share_actions/);
  assert.match(sql, /public_token text not null unique default encode\(extensions\.gen_random_bytes\(16\), 'hex'\)/);
  assert.match(sql, /activation_source_id uuid not null references public\.activation_sources/);
  assert.match(sql, /actor_user_id uuid null references public\.profiles/);
  assert.match(sql, /root_share_action_id uuid null references public\.share_actions/);
  assert.match(sql, /parent_share_action_id uuid null references public\.share_actions/);
  assert.match(sql, /shared_object_type text not null check/);

  for (const objectType of [
    "keepr",
    "public_story",
    "hub",
    "keeprpro",
    "asset",
    "system",
    "membership",
    "campaign",
    "service_ready",
    "invite",
  ]) {
    assert.match(sql, new RegExp(`'${objectType}'`));
  }

  for (const intendedAction of [
    "signup",
    "create_first_asset",
    "view_story",
    "join_hub",
    "connect_provider",
    "claim_asset",
    "request_service",
  ]) {
    assert.match(sql, new RegExp(`'${intendedAction}'`));
  }

  assert.match(sql, /status in \('active', 'expired', 'disabled', 'completed', 'ignored'\)/);
  assert.match(sql, /alter table public\.activation_sessions[\s\S]*add column if not exists share_action_id uuid null/);
  assert.match(sql, /add column if not exists activation_object_type text null/);
  assert.match(sql, /add column if not exists activation_object_id uuid null/);
  assert.match(sql, /add column if not exists intended_action text null/);
  assert.match(sql, /alter table public\.share_actions enable row level security/);
  assert.match(sql, /revoke all on table public\.share_actions from anon/);
  assert.match(sql, /create or replace function public\.create_share_action/);
  assert.match(sql, /create or replace function public\.resolve_share_action/);
  assert.match(sql, /create or replace function public\.open_share_action/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.doesNotMatch(sql, /encode\(gen_random_bytes\(/);
  assert.match(sql, /new\.public_token := encode\(extensions\.gen_random_bytes\(16\), 'hex'\)/);
});

test("share creation is server-authoritative and direct shares root to self", () => {
  const sql = read(migrationPath);

  assert.match(sql, /current_user_id := auth\.uid\(\)/);
  assert.match(sql, /authentication required to create share action/);
  assert.match(sql, /from public\.ensure_user_activation_identity\(current_user_id/);
  assert.match(sql, /identity_row\.activation_source_id/);
  assert.match(sql, /actor_user_id,\s*actor_profile_id/);
  assert.match(sql, /current_user_id,\s*current_user_id/);
  assert.match(sql, /if inserted_share\.root_share_action_id is null then/);
  assert.match(sql, /set root_share_action_id = inserted_share\.id/);
  assert.match(sql, /grant execute on function public\.create_share_action/);
  assert.doesNotMatch(sql, /p_actor_user_id/);
  assert.doesNotMatch(sql, /p_activation_source_id/);
});

test("share action reuse is narrow and channel-aware", () => {
  const sql = read(migrationPath);

  assert.match(sql, /p_reuse_window interval default interval '6 hours'/);
  assert.match(sql, /s\.activation_source_id = identity_row\.activation_source_id/);
  assert.match(sql, /s\.shared_object_type = normalized_object_type/);
  assert.match(sql, /s\.shared_object_id is not distinct from p_shared_object_id/);
  assert.match(sql, /s\.intended_action = normalized_intended_action/);
  assert.match(sql, /s\.channel = normalized_channel/);
  assert.match(sql, /s\.created_at >= now\(\) - greatest\(p_reuse_window, interval '5 minutes'\)/);
});

test("public resolver returns safe projection fields and not private actor metadata", () => {
  const sql = read(migrationPath);
  const start = sql.indexOf("create or replace function public.resolve_share_action");
  const returnsStart = sql.indexOf("returns table", start);
  const returnsBlock = sql.slice(returnsStart, sql.indexOf("language plpgsql", start));

  for (const safeField of [
    "resolution_state text",
    "share_action_id uuid",
    "activation_source_id uuid",
    "shared_object_type text",
    "shared_object_id uuid",
    "shared_object_slug_snapshot text",
    "intended_action text",
    "status text",
    "title text",
    "description text",
    "image_url text",
    "cta text",
    "route_name text",
    "route_path text",
  ]) {
    assert.match(returnsBlock, new RegExp(safeField));
  }

  for (const privateField of [
    "actor_user_id",
    "actor_profile_id",
    "acting_for_organization_id",
    "metadata",
    "public_token",
    "campaign_key",
  ]) {
    assert.doesNotMatch(returnsBlock, new RegExp(privateField));
  }
});

test("invalid, disabled, and expired share links fail safely", () => {
  const sql = read(migrationPath);

  assert.match(sql, /requested_token !~ '\^\[a-f0-9\]\{32,128\}\$'/);
  assert.match(sql, /resolution_state := 'invalid'/);
  assert.match(sql, /resolution_state := 'not_found'/);
  assert.match(sql, /share_row\.status <> 'active'/);
  assert.match(sql, /share_row\.expires_at is not null and share_row\.expires_at <= now\(\)/);
  assert.match(sql, /route_name := 'Auth'/);
  assert.match(sql, /raise exception 'share action is not active'/);
  assert.match(sql, /raise exception 'share action has expired'/);
});

test("opening a share creates or reuses a contextual activation session", () => {
  const sql = read(migrationPath);

  assert.match(sql, /grant execute on function public\.open_share_action/);
  assert.match(sql, /s\.activation_source_id = share_row\.activation_source_id/);
  assert.match(sql, /s\.share_action_id = share_row\.id/);
  assert.match(sql, /session_idempotency_key := encode/);
  assert.match(sql, /'share_action'/);
  assert.match(sql, /insert into public\.activation_sessions/);
  assert.match(sql, /share_action_id,\s*activation_object_type,\s*activation_object_id,\s*intended_action/);
  assert.match(sql, /share_row\.id,\s*share_row\.shared_object_type,\s*share_row\.shared_object_id,\s*share_row\.intended_action/);
  assert.match(sql, /source_slug_snapshot := inserted_session\.source_slug_snapshot/);
  assert.match(sql, /activation_session_public_token := inserted_session\.public_token/);
});

test("share action open hotfix keeps locked search_path and qualifies pgcrypto digest", () => {
  const sql = read(digestHotfixMigrationPath);

  assert.match(sql, /create or replace function public\.open_share_action/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
  assert.match(sql, /extensions\.digest\(/);
  assert.doesNotMatch(sql, /[^.]digest\(/);
  assert.match(sql, /grant execute on function public\.open_share_action/);
});

test("link scanners can be ignored but cannot create verified outcomes by themselves", () => {
  const sql = read(migrationPath);

  assert.match(sql, /p_user_agent text default null/);
  assert.match(sql, /bot\|crawler\|spider\|preview\|facebookexternalhit\|slackbot\|twitterbot\|linkedinbot/);
  assert.match(sql, /next_status := 'ignored'/);
  assert.match(sql, /status,\s*idempotency_key/);
  assert.match(sql, /activation_session_status := inserted_session\.status/);
  assert.doesNotMatch(sql, /insert into public\.attribution_records/);
});

test("client helper creates a Share Keepr action and returns a short link", async () => {
  const { createShareAction } = loadShareActionHelpers();

  const action = await createShareAction({
    sharedObjectType: "keepr",
    intendedAction: "signup",
    channel: "copy_link",
    baseUrl: "https://keeprhome.com",
    supabase: {
      async rpc(name, payload) {
        assert.equal(name, "create_share_action");
        assert.equal(payload.p_shared_object_type, "keepr");
        assert.equal(payload.p_intended_action, "signup");
        assert.equal(payload.p_channel, "copy_link");
        assert.equal(payload.p_activation_source_id, undefined);
        return {
          data: [
            {
              share_action_id: "share-1",
              public_token: "abcdef1234567890abcdef1234567890",
              activation_source_id: "source-1",
              shared_object_type: "keepr",
              shared_object_slug_snapshot: "u_12345678",
              intended_action: "signup",
              channel: "copy_link",
              status: "active",
            },
          ],
          error: null,
        };
      },
    },
  });

  assert.equal(action.id, "share-1");
  assert.equal(action.shareUrl, "https://keeprhome.com/s/abcdef1234567890abcdef1234567890");
});

test("client helper opens a share and stores only activation session token plus legacy slug keys", async () => {
  const {
    ACTIVATION_SESSION_TOKEN_KEY,
    LEGACY_ACQUISITION_SOURCE_SLUG_KEY,
    LEGACY_INVITE_SLUG_KEY,
    openShareAction,
  } = loadShareActionHelpers();
  const storage = memoryStorage();

  const opened = await openShareAction({
    token: "abcdef1234567890abcdef1234567890",
    landingUrl: "https://keeprhome.com/s/abcdef1234567890abcdef1234567890?email=a@example.com",
    referrer: "https://example.com/?token=secret",
    clientPlatform: "web",
    storage,
    supabase: {
      async rpc(name, payload) {
        assert.equal(name, "open_share_action");
        assert.equal(payload.p_public_token, "abcdef1234567890abcdef1234567890");
        assert.equal(payload.p_existing_activation_session_token, null);
        assert.equal(payload.p_client_platform, "web");
        return {
          data: [
            {
              resolution_state: "active",
              share_action_id: "share-1",
              activation_source_id: "source-1",
              shared_object_type: "keepr",
              intended_action: "signup",
              source_slug_snapshot: "u_12345678",
              activation_session_public_token: "opaque-session",
              activation_session_status: "open",
              entry_method: "invite_link",
              route_name: "Invite",
              route_path: "/invite/u_12345678",
            },
          ],
          error: null,
        };
      },
    },
  });

  assert.equal(opened.activationSessionToken, "opaque-session");
  assert.equal(await storage.getItem(ACTIVATION_SESSION_TOKEN_KEY), "opaque-session");
  assert.equal(await storage.getItem(LEGACY_ACQUISITION_SOURCE_SLUG_KEY), "u_12345678");
  assert.equal(await storage.getItem(LEGACY_INVITE_SLUG_KEY), "u_12345678");
});

test("Share Keepr and routing use the share foundation without removing legacy invite compatibility", () => {
  const shareScreen = read("screens/ShareKeeprScreen.js");
  const app = read("App.js");
  const inviteLinks = read("lib/inviteLinks.js");

  assert.match(shareScreen, /import \{ createShareAction \} from "\.\.\/lib\/shareActions"/);
  assert.match(shareScreen, /getCleanInviteUrlForSlug/);
  assert.match(shareScreen, /buildUserInviteUrl\(\{ sourceSlug: slug \}\)/);
  assert.match(shareScreen, /profile\?\.acquisition_source_slug/);
  assert.match(shareScreen, /select\("username, inbox_name, acquisition_source_slug"\)/);
  assert.match(shareScreen, /createKeeprShareAction\("qr"\)/);
  assert.match(shareScreen, /createKeeprShareAction\("native_share"\)/);
  assert.match(shareScreen, /createKeeprShareAction\("copy_link"\)/);
  assert.doesNotMatch(shareScreen, /slug = action\.sharedObjectSlugSnapshot/);
  assert.match(shareScreen, /getCleanInviteUrlForSlug\(sourceSlug, shareUrl\)/);
  assert.match(shareScreen, /getCleanInviteUrlForSlug\(sourceSlug, copyUrl\)/);
  assert.match(shareScreen, /track\("share_action_created"/);
  assert.match(shareScreen, /track\("share_qr_viewed"/);
  assert.match(shareScreen, /track\("share_native_opened"/);
  assert.match(shareScreen, /track\("share_link_copied"/);
  assert.match(shareScreen, /Share action QR creation failed; using legacy invite link/);

  assert.match(app, /ShareAction: "s\/:token"/);
  assert.match(app, /Invite: "invite\/:slug"/);
  assert.match(app, /import \{ startActivationSession \} from "\.\/lib\/activationSessions"/);
  assert.match(app, /function ShareActionRedirectScreen/);
  assert.match(app, /function extractShareActionTokenFromUrl/);
  assert.match(app, /const shareActionOpenPromises = new Map\(\)/);
  assert.match(app, /async function captureShareActionToken/);
  assert.match(app, /await openShareAction/);
  assert.match(app, /shareActionOpenPromises\.has\(token\)/);
  assert.doesNotMatch(app, /captureShareActionFromUrl/);
  assert.match(app, /track\("share_link_opened"/);
  assert.match(app, /await flushAnalytics\(\)/);
  assert.match(app, /opened\?\.routePath/);
  assert.match(app, /navigation\.replace\("Invite", \{ slug: destinationSlug \}/);
  assert.match(app, /Share link unavailable/);
  assert.match(app, /async function captureInviteSourceFromUrl/);
  assert.match(app, /await startActivationSession\(/);
  assert.match(app, /entryMethod: "invite_link"/);
  assert.match(app, /track\("invite_link_opened"/);

  assert.match(inviteLinks, /buildUserInviteUrl/);
  assert.match(inviteLinks, /buildShortShareUrl/);
});
