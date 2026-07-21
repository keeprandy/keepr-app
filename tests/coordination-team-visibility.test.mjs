import assert from "node:assert/strict";
import test from "node:test";

const now = new Date("2026-07-21T12:00:00.000Z");

function isTeamScoped(meta = {}) {
  if (String(meta?.visibility_scope || "").toLowerCase() === "team") return true;
  if (String(meta?.visibility_scope || "").toLowerCase() === "private") return false;
  const type = meta?.assignment_target?.type || "";
  return ["team", "team_member"].includes(type) ||
    String(meta?.assigned_to || "").toLowerCase() === "team";
}

function active(row) {
  if (!row?.active) return false;
  const starts = row.starts_at ? new Date(row.starts_at) : null;
  const ends = row.ends_at ? new Date(row.ends_at) : null;
  return (!starts || starts <= now) && (!ends || ends > now);
}

function hasActiveStewardship(db, assetId, userId) {
  return (db.asset_stewardships || []).some((s) => {
    if (s.asset_id !== assetId || !active(s)) return false;
    if (s.user_id === userId) return true;
    if (!s.org_id) return false;
    return (db.org_members || []).some(
      (m) => m.org_id === s.org_id && m.user_id === userId,
    );
  });
}

function hasActiveOrgMembership(db, orgId, userId) {
  if (!orgId || !userId) return false;
  return (db.orgs || []).some((org) => org.id === orgId && org.owner_user_id === userId) ||
    (db.org_members || []).some((m) => m.org_id === orgId && m.user_id === userId);
}

function actionContext(reminder) {
  const explicit = reminder.extra_metadata?.action_context;
  if (["personal", "household", "asset", "system"].includes(explicit)) {
    return explicit;
  }
  if (reminder.system_id) return "system";
  if (reminder.asset_id) return "asset";
  return isTeamScoped(reminder.extra_metadata) ? "household" : "personal";
}

function visibilityOrgId(reminder) {
  return reminder.extra_metadata?.visibility_org_id ||
    reminder.extra_metadata?.responsible_party?.org_id ||
    reminder.extra_metadata?.assignment_target?.org_id ||
    null;
}

function actionOrgMatchesAsset(db, reminder) {
  const orgId = visibilityOrgId(reminder);
  if (!orgId) return true;
  return (db.asset_stewardships || []).some(
    (s) => s.asset_id === reminder.asset_id && s.org_id === orgId && active(s),
  );
}

function canRead(db, reminder, userId) {
  const context = actionContext(reminder);
  return !!userId && (
    reminder.owner_id === userId ||
    (
      isTeamScoped(reminder.extra_metadata) &&
      (
        (
          context === "household" &&
          hasActiveOrgMembership(db, visibilityOrgId(reminder), userId)
        ) ||
        (
          ["asset", "system"].includes(context) &&
          !!reminder.asset_id &&
          actionOrgMatchesAsset(db, reminder) &&
          hasActiveStewardship(db, reminder.asset_id, userId)
        )
      )
    )
  );
}

function canComplete(db, reminder, userId) {
  if (!canRead(db, reminder, userId)) return false;
  if (reminder.owner_id === userId) return true;
  const target =
    reminder.extra_metadata?.responsible_party ||
    reminder.extra_metadata?.assignment_target ||
    {};
  if (target.type === "unassigned") return true;
  if (target.type === "team_member") return target.id === userId;
  return isTeamScoped(reminder.extra_metadata);
}

function ensureNextOccurrence(existing, sourceId, occurrenceKey) {
  const found = existing.find(
    (row) =>
      row.extra_metadata?.recurrence_source_reminder_id === sourceId &&
      row.extra_metadata?.recurrence_occurrence_key === occurrenceKey,
  );
  if (found) return { created: false, id: found.id };
  return { created: true, id: "next-1" };
}

const db = {
  orgs: [
    { id: "org-1", owner_user_id: "owner-1" },
    { id: "org-2", owner_user_id: "outside-1" },
  ],
  org_members: [
    { org_id: "org-1", user_id: "owner-1" },
    { org_id: "org-1", user_id: "member-b" },
    { org_id: "org-1", user_id: "member-c" },
    { org_id: "org-2", user_id: "outside-1" },
    { org_id: "inactive-org", user_id: "inactive-member" },
  ],
  asset_stewardships: [
    { asset_id: "asset-1", org_id: "org-1", active: true },
    { asset_id: "asset-1", org_id: "inactive-org", active: false },
    { asset_id: "asset-2", user_id: "direct-steward", active: true },
  ],
};

test("owner sees own private reminder", () => {
  const reminder = { owner_id: "owner-1", asset_id: "asset-1", extra_metadata: {} };
  assert.equal(canRead(db, reminder, "owner-1"), true);
});

test("team member cannot see owner private reminder on shared asset", () => {
  const reminder = { owner_id: "owner-1", asset_id: "asset-1", extra_metadata: {} };
  assert.equal(canRead(db, reminder, "member-b"), false);
});

test("owner and team member see explicitly Team-shared reminder", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      responsible_party: { type: "unassigned", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), true);
  assert.equal(canRead(db, reminder, "member-b"), true);
});

test("owner-created Team Action is visible to member", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      visibility_org_id: "org-1",
      action_context: "asset",
      responsible_party: { type: "team_member", id: "member-b", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "member-b"), true);
});

test("member-created Team Action is visible to owner", () => {
  const reminder = {
    owner_id: "member-b",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      visibility_org_id: "org-1",
      action_context: "asset",
      responsible_party: { type: "team_member", id: "owner-1", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), true);
  assert.equal(canComplete(db, reminder, "owner-1"), true);
});

test("member-created Team Action assigned to another member is visible to all authorized stewards", () => {
  const reminder = {
    owner_id: "member-b",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      visibility_org_id: "org-1",
      action_context: "asset",
      responsible_party: { type: "team_member", id: "member-c", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), true);
  assert.equal(canRead(db, reminder, "member-b"), true);
  assert.equal(canRead(db, reminder, "member-c"), true);
  assert.equal(canComplete(db, reminder, "owner-1"), false);
  assert.equal(canComplete(db, reminder, "member-c"), true);
});

test("Team-visible unassigned Action is visible to authorized stewards", () => {
  const reminder = {
    owner_id: "member-b",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      visibility_org_id: "org-1",
      action_context: "asset",
      responsible_party: { type: "unassigned", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), true);
  assert.equal(canRead(db, reminder, "member-c"), true);
  assert.equal(canComplete(db, reminder, "member-c"), true);
});

test("Team coordination Action is visible through org membership without an asset", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: null,
    system_id: null,
    extra_metadata: {
      action_context: "household",
      visibility_scope: "team",
      visibility_org_id: "org-1",
      responsible_party: { type: "unassigned", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), true);
  assert.equal(canRead(db, reminder, "member-b"), true);
  assert.equal(canRead(db, reminder, "outside-1"), false);
});

test("personal Action without an asset remains private to creator", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: null,
    system_id: null,
    extra_metadata: {
      action_context: "personal",
      visibility_scope: "private",
      responsible_party: { type: "unassigned", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), true);
  assert.equal(canRead(db, reminder, "member-b"), false);
});

test("private member Action remains private to member creator", () => {
  const reminder = {
    owner_id: "member-b",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "private",
      action_context: "asset",
      responsible_party: { type: "team_member", id: "owner-1", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "member-b"), true);
  assert.equal(canRead(db, reminder, "owner-1"), false);
});

test("Team-visible asset Action with missing asset id is not shared", () => {
  const reminder = {
    owner_id: "member-b",
    asset_id: null,
    extra_metadata: {
      visibility_scope: "team",
      visibility_org_id: "org-1",
      action_context: "asset",
      responsible_party: { type: "team_member", id: "owner-1", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), false);
});

test("wrong org id does not authorize an asset Team Action", () => {
  const reminder = {
    owner_id: "member-b",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      visibility_org_id: "org-2",
      action_context: "asset",
      responsible_party: { type: "team_member", id: "owner-1", org_id: "org-2" },
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), false);
});

test("assignment label alone does not authorize if responsible user id is wrong", () => {
  const reminder = {
    owner_id: "member-b",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      visibility_org_id: "org-1",
      action_context: "asset",
      assigned_to: "Owner",
      responsible_party: { type: "team_member", id: "not-owner-1", label: "Owner", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), true);
  assert.equal(canComplete(db, reminder, "owner-1"), false);
});

test("directly assigned Team member sees and can complete their Action", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      responsible_party: { type: "team_member", id: "member-b", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "member-b"), true);
  assert.equal(canComplete(db, reminder, "member-b"), true);
});

test("authorized member can open the same Action from Inbox", () => {
  const reminder = {
    id: "reminder-1",
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: { visibility_scope: "team", responsible_party: { type: "unassigned" } },
  };
  const inboxRows = [reminder].filter((row) => canRead(db, row, "member-b"));
  assert.deepEqual(inboxRows.map((row) => row.id), ["reminder-1"]);
});

test("permitted member completes team-owned Action and actor metadata is durable", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      responsible_party: { type: "unassigned", org_id: "org-1" },
    },
  };
  assert.equal(canComplete(db, reminder, "member-b"), true);
  const completed = {
    ...reminder,
    status: "completed",
    extra_metadata: {
      ...reminder.extra_metadata,
      completed_by_user_id: "member-b",
      completed_at: now.toISOString(),
    },
  };
  assert.equal(canRead(db, completed, "owner-1"), true);
  assert.equal(canRead(db, completed, "member-b"), true);
  assert.equal(completed.extra_metadata.completed_by_user_id, "member-b");
});

test("inactive org member cannot read shared action", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      responsible_party: { type: "unassigned", org_id: "inactive-org" },
    },
  };
  assert.equal(canRead(db, reminder, "inactive-member"), false);
});

test("stewardship revoked stops access", () => {
  const revokedDb = { ...db, asset_stewardships: [{ asset_id: "asset-1", org_id: "org-1", active: false }] };
  const reminder = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      responsible_party: { type: "unassigned", org_id: "org-1" },
    },
  };
  assert.equal(canRead(revokedDb, reminder, "member-b"), false);
});

test("outside user cannot read or mutate team action", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      responsible_party: { type: "unassigned", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "outside-1"), false);
  assert.equal(canComplete(db, reminder, "outside-1"), false);
});

test("legacy assigned_to Team works only with active shared asset", () => {
  const linked = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: { assigned_to: "Team" },
  };
  const unlinked = {
    owner_id: "owner-1",
    asset_id: null,
    extra_metadata: { assigned_to: "Team" },
  };
  assert.equal(canRead(db, linked, "member-b"), true);
  assert.equal(canRead(db, unlinked, "member-b"), false);
});

test("provider metadata alone grants no access", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: { provider_target: { type: "keepr_pro", id: "pro-1" } },
  };
  assert.equal(canRead(db, reminder, "member-b"), false);
});

test("owner still sees the Action after member completion", () => {
  const reminder = {
    owner_id: "owner-1",
    status: "completed",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      responsible_party: { type: "team_member", id: "member-b", org_id: "org-1" },
      completed_by_user_id: "member-b",
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), true);
});

test("reassignment changes responsibility without changing Team visibility", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "team",
      responsible_party: { type: "team_member", id: "member-b", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "member-b"), true);
  assert.equal(canRead(db, reminder, "owner-1"), true);

  const reassigned = {
    ...reminder,
    extra_metadata: {
      ...reminder.extra_metadata,
      responsible_party: { type: "team_member", id: "owner-1", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reassigned, "member-b"), true);
  assert.equal(canComplete(db, reassigned, "member-b"), false);
});

test("removing Team visibility removes access for other members", () => {
  const reminder = {
    owner_id: "owner-1",
    asset_id: "asset-1",
    extra_metadata: {
      visibility_scope: "private",
      responsible_party: { type: "team_member", id: "member-b", org_id: "org-1" },
    },
  };
  assert.equal(canRead(db, reminder, "owner-1"), true);
  assert.equal(canRead(db, reminder, "member-b"), false);
});

test("recurrence next occurrence remains idempotent", () => {
  const existing = [
    {
      id: "next-existing",
      extra_metadata: {
        recurrence_source_reminder_id: "source-1",
        recurrence_occurrence_key: "source-1:2026-08-21",
      },
    },
  ];
  assert.deepEqual(
    ensureNextOccurrence(existing, "source-1", "source-1:2026-08-21"),
    { created: false, id: "next-existing" },
  );
});
