import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const migrationPath = "supabase/migrations/20260724064109_activation_sessions.sql";

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadActivationSessionHelpers() {
  const source = read("lib/activationSessions.js")
    .replace(/export const /g, "const ")
    .replace(/export async function /g, "async function ");

  return new Function(
    `${source}
return {
  ACTIVATION_SESSION_TOKEN_KEY,
  LEGACY_ACQUISITION_SOURCE_SLUG_KEY,
  LEGACY_INVITE_SLUG_KEY,
  ACTIVATION_ENTRY_METHODS,
  ACTIVATION_SESSION_TERMINAL_STATUSES,
  getStoredActivationSessionToken,
  storeActivationSessionToken,
  clearStoredActivationSessionToken,
  clearExpiredOrConsumedActivationSession,
  preserveLegacyActivationSlug,
  startActivationSession,
  identifyActivationSession
};`
  )();
}

function memoryStorage() {
  const values = new Map();
  return {
    values,
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

test("activation session migration creates table, constraints, RLS, and controlled RPCs", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create table if not exists public\.activation_sessions/);
  assert.match(sql, /public_token text not null unique default encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/);
  assert.match(sql, /activation_source_id uuid null references public\.activation_sources\(id\)/);
  assert.match(sql, /resolution_state in \('canonical', 'alias', 'legacy_fallback', 'unresolved'\)/);
  for (const method of [
    "invite_link",
    "qr_code",
    "claim_link",
    "service_ready",
    "hub_invite",
    "partner_link",
    "campaign_link",
    "direct",
  ]) {
    assert.match(sql, new RegExp(`'${method}'`));
  }
  assert.match(sql, /status in \('open', 'identified', 'consumed', 'converted', 'expired', 'ignored', 'blocked'\)/);
  assert.match(sql, /internal_test_status in \('normal', 'internal', 'test', 'suspected_abuse'\)/);
  assert.match(sql, /activation_sessions_active_idempotency_uidx/);
  assert.match(sql, /alter table public\.activation_sessions enable row level security/);
  assert.match(sql, /create policy activation_sessions_admin_all/);
  assert.match(sql, /revoke all on table public\.activation_sessions from anon/);
  assert.match(sql, /create or replace function public\.create_activation_session/);
  assert.match(sql, /create or replace function public\.identify_activation_session/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = public/);
});

test("public RPC response shape is safe and does not expose owner or metadata fields", () => {
  const sql = read(migrationPath);
  const functionStart = sql.indexOf("create or replace function public.create_activation_session");
  const returnsStart = sql.indexOf("returns table", functionStart);
  const createReturns = sql.slice(
    returnsStart,
    sql.indexOf("language plpgsql", functionStart)
  );

  for (const safeField of [
    "public_token text",
    "status text",
    "resolution_state text",
    "activation_source_id uuid",
    "source_slug_snapshot text",
    "entry_method text",
    "expires_at timestamptz",
  ]) {
    assert.match(createReturns, new RegExp(safeField.replace(/[()]/g, "\\$&")));
  }

  for (const unsafeField of [
    "owner_user_id",
    "owner_org_id",
    "owner_hub_id",
    "owner_keepr_pro_id",
    "metadata jsonb",
    "created_at",
    "updated_at",
    "converted_user_id",
    "anonymous_id",
    "posthog_distinct_id",
  ]) {
    assert.doesNotMatch(createReturns, new RegExp(unsafeField));
  }
});

test("server-side creation resolves sources and preserves V0 compatibility without fabricating owners", () => {
  const sql = read(migrationPath);

  assert.match(sql, /from public\.resolve_activation_source_slug\(requested_slug\)/);
  assert.match(sql, /resolved\.resolution_state in \('canonical', 'alias'\)/);
  assert.match(sql, /resolved_state := 'legacy_fallback'/);
  assert.match(sql, /requested_slug in \('keeprandy', 'drake', 'hub', 'email'\)/);
  assert.match(sql, /requested_slug ~ '\^u_\[a-z0-9\]\{8\}\$'/);
  assert.match(sql, /resolved_state := 'unresolved'/);
  assert.match(sql, /activation_sessions_source_truth check/);
  assert.match(sql, /resolution_state in \('legacy_fallback', 'unresolved'\) and activation_source_id is null/);
});

test("idempotency reuses active matching sessions and avoids reuse after expiration or consumption", () => {
  const sql = read(migrationPath);

  assert.match(sql, /stable_client_key := lower\(nullif\(coalesce\(normalized_anonymous_id, normalized_posthog_distinct_id\), ''\)\)/);
  assert.match(sql, /digest\(/);
  assert.doesNotMatch(sql, /stable_client_key := encode\(gen_random_bytes\(16\), 'hex'\)/);
  assert.doesNotMatch(sql, /encode\(gen_random_bytes\(/);
  assert.match(sql, /new\.public_token := encode\(extensions\.gen_random_bytes\(32\), 'hex'\)/);
  assert.match(sql, /'unkeyed'/);
  assert.match(sql, /coalesce\(sanitized_landing_url, ''\)/);
  assert.match(sql, /coalesce\(resolved_source_id::text, resolved_state\)/);
  assert.match(sql, /session_slug_snapshot/);
  assert.match(sql, /where s\.idempotency_key = session_idempotency_key/);
  assert.match(sql, /s\.status in \('open', 'identified'\)/);
  assert.match(sql, /s\.consumed_at is null/);
  assert.match(sql, /s\.expires_at > now\(\)/);
  assert.match(sql, /set status = 'expired'/);
});

test("state transitions and identification rules are enforced server-side", () => {
  const sql = read(migrationPath);

  assert.match(sql, /old\.status = 'open' and new\.status not in \('open', 'identified', 'expired', 'ignored', 'blocked'\)/);
  assert.match(sql, /old\.status = 'identified' and new\.status not in \('identified', 'consumed', 'expired', 'blocked'\)/);
  assert.match(sql, /old\.status = 'consumed' and new\.status not in \('consumed', 'converted'\)/);
  assert.match(sql, /old\.status in \('converted', 'expired', 'ignored', 'blocked'\) and new\.status <> old\.status/);
  assert.match(sql, /current_user_id := auth\.uid\(\)/);
  assert.match(sql, /authentication required to identify activation session/);
  assert.match(sql, /session_row\.converted_user_id = current_user_id/);
  assert.match(sql, /activation session is already identified by another user/);
});

test("internal, test, and suspected abuse sessions are excluded from future qualification", () => {
  const sql = read(migrationPath);

  assert.match(sql, /normalized_internal_test_status in \('internal', 'test'\)/);
  assert.match(sql, /next_status := 'ignored'/);
  assert.match(sql, /normalized_internal_test_status = 'suspected_abuse'/);
  assert.match(sql, /next_status := 'blocked'/);
});

test("sensitive URL and metadata fields are stripped before storage", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create or replace function public\.sanitize_activation_url/);
  assert.match(sql, /create or replace function public\.sanitize_activation_jsonb/);
  for (const key of ["password", "token", "code", "access_token", "refresh_token", "authorization", "email", "phone"]) {
    assert.match(sql, new RegExp(`'${key}'`));
  }
  assert.match(sql, /new\.landing_url := public\.sanitize_activation_url\(new\.landing_url\)/);
  assert.match(sql, /new\.metadata := public\.sanitize_activation_jsonb\(new\.metadata\)/);
});

test("client supplied activation session inputs are bounded before storage", () => {
  const sql = read(migrationPath);

  assert.match(sql, /requested_slug := public\.normalize_activation_slug\(left\(p_slug, 256\)\)/);
  assert.match(sql, /normalized_anonymous_id := left\(nullif\(trim\(coalesce\(p_anonymous_id, ''\)\), ''\), 256\)/);
  assert.match(sql, /normalized_posthog_distinct_id := left\(nullif\(trim\(coalesce\(p_posthog_distinct_id, ''\)\), ''\), 256\)/);
  assert.match(sql, /normalized_client_platform := left\(nullif\(trim\(coalesce\(p_client_platform, ''\)\), ''\), 64\)/);
  assert.match(sql, /normalized_app_version := left\(nullif\(trim\(coalesce\(p_app_version, ''\)\), ''\), 64\)/);
  assert.match(sql, /normalized_runtime_version := left\(nullif\(trim\(coalesce\(p_runtime_version, ''\)\), ''\), 128\)/);
  assert.match(sql, /octet_length\(sanitized_utm::text\) > 8192/);
  assert.match(sql, /octet_length\(sanitized_metadata::text\) > 8192/);
});

test("client helper stores only opaque activation token for session continuity and keeps V0 slug keys", async () => {
  const {
    ACTIVATION_SESSION_TOKEN_KEY,
    LEGACY_ACQUISITION_SOURCE_SLUG_KEY,
    LEGACY_INVITE_SLUG_KEY,
    startActivationSession,
  } = loadActivationSessionHelpers();
  const storage = memoryStorage();

  const session = await startActivationSession({
    slug: "keeprandy",
    entryMethod: "invite_link",
    landingUrl: "https://app.keeprhome.com/invite/keeprandy?email=a@example.com&utm_source=qr",
    referrer: "https://example.com/?token=secret&utm_campaign=launch",
    posthogDistinctId: "ph_123",
    clientPlatform: "web",
    storage,
    supabase: {
      async rpc(name, payload) {
        assert.equal(name, "create_activation_session");
        assert.equal(payload.p_slug, "keeprandy");
        assert.equal(payload.p_entry_method, "invite_link");
        assert.equal(payload.p_existing_public_token, null);
        assert.equal(payload.p_posthog_distinct_id, "ph_123");
        return {
          data: [
            {
              public_token: "opaque-token",
              status: "open",
              resolution_state: "canonical",
              source_slug_snapshot: "keeprandy",
              entry_method: "invite_link",
              expires_at: "2099-01-01T00:00:00Z",
            },
          ],
          error: null,
        };
      },
    },
  });

  assert.equal(session.public_token, "opaque-token");
  assert.equal(await storage.getItem(ACTIVATION_SESSION_TOKEN_KEY), "opaque-token");
  assert.equal(await storage.getItem(LEGACY_ACQUISITION_SOURCE_SLUG_KEY), "keeprandy");
  assert.equal(await storage.getItem(LEGACY_INVITE_SLUG_KEY), "keeprandy");
});

test("client helper reuses stored token and clears terminal sessions", async () => {
  const {
    ACTIVATION_SESSION_TOKEN_KEY,
    startActivationSession,
    identifyActivationSession,
  } = loadActivationSessionHelpers();
  const storage = memoryStorage();
  await storage.setItem(ACTIVATION_SESSION_TOKEN_KEY, "existing-token");

  await startActivationSession({
    slug: "movember",
    entryMethod: "campaign_link",
    storage,
    supabase: {
      async rpc(name, payload) {
        assert.equal(name, "create_activation_session");
        assert.equal(payload.p_existing_public_token, "existing-token");
        return {
          data: [{ public_token: "existing-token", status: "open", expires_at: "2099-01-01T00:00:00Z" }],
          error: null,
        };
      },
    },
  });

  await identifyActivationSession({
    storage,
    supabase: {
      async rpc(name, payload) {
        assert.equal(name, "identify_activation_session");
        assert.deepEqual(payload, { p_public_token: "existing-token" });
        return {
          data: [{ public_token: "existing-token", status: "expired", expires_at: "2000-01-01T00:00:00Z" }],
          error: null,
        };
      },
    },
  });

  assert.equal(await storage.getItem(ACTIVATION_SESSION_TOKEN_KEY), null);
});
