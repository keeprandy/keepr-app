import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migrationPath = new URL("../supabase/migrations/20260713120000_protect_profile_sensitive_fields.sql", import.meta.url);
const adminSettingsPath = new URL("../screens/AdminSettingsScreen.js", import.meta.url);
const settingsPath = new URL("../screens/SettingsScreen.js", import.meta.url);
const manifestEndpointPath = new URL("../supabase/functions/kac-intelligence-manifest/index.ts", import.meta.url);

const migration = fs.readFileSync(migrationPath, "utf8");

const protectedFields = [
  "role",
  "plan",
  "billing_status",
  "billing_cycle",
  "stripe_customer_id",
  "stripe_subscription_id",
  "current_period_end",
  "account_status",
];

const safeFields = [
  "full_name",
  "display_name",
  "phone",
  "birthday",
  "language",
  "home_address",
  "work_address",
  "username",
  "inbox_name",
  "profile_photo_attachment_id",
];

function isAllowedSelfDeactivation(oldRow, newRow, userId) {
  return (
    oldRow.account_status === "active"
    && newRow.account_status === "deactivated"
    && newRow.id === oldRow.id
    && oldRow.id === userId
  );
}

function wouldRejectProfileUpdate(oldRow, newRow, options = {}) {
  const { privileged = false, userId = oldRow.id } = options;
  if (privileged) return false;
  return protectedFields.some((field) => {
    if (oldRow[field] === newRow[field]) return false;
    if (field === "account_status" && isAllowedSelfDeactivation(oldRow, newRow, userId)) return false;
    return true;
  });
}

test("profile sensitive field trigger protects authority fields", () => {
  assert.match(migration, /CREATE TRIGGER trg_keepr_protect_profile_sensitive_fields/i);
  assert.match(migration, /BEFORE UPDATE ON public\.profiles/i);
  assert.match(migration, /profile_sensitive_field_update_denied/);

  for (const field of protectedFields) {
    assert.match(
      migration,
      new RegExp(`NEW\\.${field}\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.${field}`, "i"),
      `${field} must be protected by OLD/NEW comparison`,
    );
  }
});

test("profile sensitive field trigger allows only server-side privileged context", () => {
  assert.match(migration, /auth\.role\(\).*=\s*'service_role'/is);
  assert.match(migration, /current_user IN \('postgres', 'service_role', 'supabase_admin'\)/);
  assert.doesNotMatch(migration, /NEW\.role\s*=\s*'admin'/i, "new role value must not grant privilege");
  assert.doesNotMatch(migration, /NEW\.role\s*=\s*'superkeepr'/i, "new role value must not grant privilege");
});

test("profile sensitive field trigger permits only active self-deactivation", () => {
  assert.match(migration, /OLD\.account_status = 'active'/);
  assert.match(migration, /NEW\.account_status = 'deactivated'/);
  assert.match(migration, /NEW\.id = OLD\.id/);
  assert.match(migration, /OLD\.id = auth\.uid\(\)/);
});

test("user cannot change own role to admin", () => {
  assert.equal(wouldRejectProfileUpdate({ role: "consumer" }, { role: "admin" }), true);
});

test("user cannot change own role to superkeepr", () => {
  assert.equal(wouldRejectProfileUpdate({ role: "consumer" }, { role: "superkeepr" }), true);
});

test("user cannot change plan or billing fields", () => {
  assert.equal(wouldRejectProfileUpdate({ plan: "free" }, { plan: "team" }), true);
  assert.equal(wouldRejectProfileUpdate({ billing_status: "inactive" }, { billing_status: "active" }), true);
  assert.equal(wouldRejectProfileUpdate({ billing_cycle: null }, { billing_cycle: "yearly" }), true);
});

test("user cannot change Stripe identifiers", () => {
  assert.equal(wouldRejectProfileUpdate({ stripe_customer_id: null }, { stripe_customer_id: "cus_test" }), true);
  assert.equal(wouldRejectProfileUpdate({ stripe_subscription_id: null }, { stripe_subscription_id: "sub_test" }), true);
});

test("user cannot change entitlement dates", () => {
  assert.equal(wouldRejectProfileUpdate({ current_period_end: null }, { current_period_end: "2026-12-31T00:00:00Z" }), true);
});

test("ordinary user can perform exact active to deactivated self-service transition", () => {
  assert.equal(
    wouldRejectProfileUpdate(
      { id: "user-1", account_status: "active" },
      { id: "user-1", account_status: "deactivated" },
      { userId: "user-1" },
    ),
    false,
  );
});

test("ordinary user cannot set arbitrary account-status values", () => {
  assert.equal(
    wouldRejectProfileUpdate(
      { id: "user-1", account_status: "active" },
      { id: "user-1", account_status: "banned" },
      { userId: "user-1" },
    ),
    true,
  );
});

test("ordinary user cannot reactivate themselves", () => {
  assert.equal(
    wouldRejectProfileUpdate(
      { id: "user-1", account_status: "deactivated" },
      { id: "user-1", account_status: "active" },
      { userId: "user-1" },
    ),
    true,
  );
});

test("ordinary user cannot change another user's account status", () => {
  assert.equal(
    wouldRejectProfileUpdate(
      { id: "user-2", account_status: "active" },
      { id: "user-2", account_status: "deactivated" },
      { userId: "user-1" },
    ),
    true,
  );
});

test("user can still update safe profile fields", () => {
  const oldRow = Object.fromEntries(safeFields.map((field) => [field, null]));
  const newRow = {
    ...oldRow,
    full_name: "Test User",
    display_name: "Tester",
    phone: "555-0100",
    birthday: "2000-01-01",
    language: "en",
    home_address: "Synthetic Home",
    work_address: "Synthetic Work",
    username: "manifest-smoke",
    inbox_name: "manifest-smoke",
    profile_photo_attachment_id: "00000000-0000-0000-0000-000000000001",
  };
  assert.equal(wouldRejectProfileUpdate(oldRow, newRow), false);
});

test("profile safe-edit fields are not blocked by the trigger", () => {
  for (const field of safeFields) {
    assert.doesNotMatch(
      migration,
      new RegExp(`NEW\\.${field}\\s+IS\\s+DISTINCT\\s+FROM\\s+OLD\\.${field}`, "i"),
      `${field} should remain self-service editable`,
    );
  }
});

test("client screens no longer directly update profiles.role", () => {
  const adminSettings = fs.readFileSync(adminSettingsPath, "utf8");
  const settings = fs.readFileSync(settingsPath, "utf8");

  for (const [name, source] of [["AdminSettingsScreen", adminSettings], ["SettingsScreen", settings]]) {
    assert.doesNotMatch(source, /\.update\(\s*\{\s*role\s*:/, `${name} must not update profiles.role`);
    assert.doesNotMatch(source, /Switch to \{.*SuperKeepr/s, `${name} must not render role switch control`);
    assert.doesNotMatch(source, /title="Switch mode"/, `${name} must not expose hidden role switch`);
  }
});

test("Manifest platform-admin authorization still recognizes legitimate admin roles", () => {
  const endpoint = fs.readFileSync(manifestEndpointPath, "utf8");
  assert.match(endpoint, /data\?\.role === "admin"/);
  assert.match(endpoint, /data\?\.role === "superkeepr"/);
});
