import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function createLifecycleHarness({
  platform = "ios",
  permissionGranted = true,
  notificationsAvailable = true,
  nowMs = Date.parse("2026-07-21T12:00:00.000Z"),
} = {}) {
  const store = new Map();
  const cancelled = [];
  let sequence = 0;

  const key = (reminderId) => `keepr.reminderNotificationId.v1:${reminderId}`;

  async function cancel(reminderId) {
    if (platform === "web") return { status: "skipped", reason: "web" };
    const previousIdentifier = store.get(key(reminderId)) || null;
    if (previousIdentifier && notificationsAvailable) cancelled.push(previousIdentifier);
    store.delete(key(reminderId));
    return {
      status: previousIdentifier ? "cancelled" : "cleared",
      previousIdentifier,
    };
  }

  async function scheduleOrReplace({ reminderId, dueAtISO }) {
    if (platform === "web") return { status: "skipped", reason: "web" };
    const previousIdentifier = store.get(key(reminderId)) || null;
    if (previousIdentifier && notificationsAvailable) cancelled.push(previousIdentifier);
    store.delete(key(reminderId));

    if (!notificationsAvailable) {
      return { status: "skipped", reason: "notifications_unavailable", previousIdentifier };
    }
    const dueAt = new Date(dueAtISO);
    if (Number.isNaN(dueAt.getTime()) || dueAt.getTime() <= nowMs + 1500) {
      return { status: "cleared", reason: "due_at_not_future", previousIdentifier };
    }
    if (!permissionGranted) {
      return { status: "skipped", reason: "permission_denied", previousIdentifier };
    }

    const identifier = `notification-${++sequence}`;
    store.set(key(reminderId), identifier);
    return { status: "scheduled", identifier, previousIdentifier };
  }

  return { store, cancelled, key, cancel, scheduleOrReplace };
}

test("initial schedule persists one device-local notification identifier", async () => {
  const harness = createLifecycleHarness();
  const result = await harness.scheduleOrReplace({
    reminderId: "rem-1",
    dueAtISO: "2026-07-21T13:00:00.000Z",
  });

  assert.equal(result.status, "scheduled");
  assert.equal(harness.store.get(harness.key("rem-1")), result.identifier);
});

test("reschedule cancels the previous identifier and stores the replacement", async () => {
  const harness = createLifecycleHarness();
  const first = await harness.scheduleOrReplace({
    reminderId: "rem-1",
    dueAtISO: "2026-07-21T13:00:00.000Z",
  });
  const second = await harness.scheduleOrReplace({
    reminderId: "rem-1",
    dueAtISO: "2026-07-21T14:00:00.000Z",
  });

  assert.deepEqual(harness.cancelled, [first.identifier]);
  assert.equal(second.status, "scheduled");
  assert.equal(harness.store.get(harness.key("rem-1")), second.identifier);
});

test("completion and deletion clear the stored identifier", async () => {
  const harness = createLifecycleHarness();
  const first = await harness.scheduleOrReplace({
    reminderId: "rem-1",
    dueAtISO: "2026-07-21T13:00:00.000Z",
  });

  const completion = await harness.cancel("rem-1");
  const deletion = await harness.cancel("rem-1");

  assert.equal(completion.status, "cancelled");
  assert.equal(completion.previousIdentifier, first.identifier);
  assert.equal(deletion.status, "cleared");
  assert.equal(harness.store.has(harness.key("rem-1")), false);
});

test("removing or moving due_at to the past cancels without replacing", async () => {
  const harness = createLifecycleHarness();
  const first = await harness.scheduleOrReplace({
    reminderId: "rem-1",
    dueAtISO: "2026-07-21T13:00:00.000Z",
  });
  const result = await harness.scheduleOrReplace({
    reminderId: "rem-1",
    dueAtISO: "2026-07-21T11:00:00.000Z",
  });

  assert.deepEqual(harness.cancelled, [first.identifier]);
  assert.equal(result.status, "cleared");
  assert.equal(harness.store.has(harness.key("rem-1")), false);
});

test("recurrence schedules the next Action without retaining the completed one", async () => {
  const harness = createLifecycleHarness();
  const current = await harness.scheduleOrReplace({
    reminderId: "rem-current",
    dueAtISO: "2026-07-21T13:00:00.000Z",
  });

  await harness.cancel("rem-current");
  const next = await harness.scheduleOrReplace({
    reminderId: "rem-next",
    dueAtISO: "2026-08-21T13:00:00.000Z",
  });

  assert.deepEqual(harness.cancelled, [current.identifier]);
  assert.equal(harness.store.has(harness.key("rem-current")), false);
  assert.equal(harness.store.get(harness.key("rem-next")), next.identifier);
});

test("permission denial and web skip do not block saves", async () => {
  const denied = createLifecycleHarness({ permissionGranted: false });
  const deniedResult = await denied.scheduleOrReplace({
    reminderId: "rem-1",
    dueAtISO: "2026-07-21T13:00:00.000Z",
  });
  const web = createLifecycleHarness({ platform: "web" });
  const webResult = await web.scheduleOrReplace({
    reminderId: "rem-1",
    dueAtISO: "2026-07-21T13:00:00.000Z",
  });

  assert.equal(deniedResult.status, "skipped");
  assert.equal(deniedResult.reason, "permission_denied");
  assert.equal(webResult.status, "skipped");
  assert.equal(webResult.reason, "web");
});

test("implementation wires lifecycle helpers into the Action save/delete paths", () => {
  const remindersSource = read("lib/remindersNotifications.js");
  const teamActionsSource = read("lib/teamActions.js");
  const createReminderSource = read("screens/CreateReminderScreen.js");

  assert.match(remindersSource, /AsyncStorage/);
  assert.match(remindersSource, /scheduleOrReplaceReminderNotification/);
  assert.match(remindersSource, /cancelScheduledReminderNotificationForReminder/);
  assert.match(teamActionsSource, /cancelReminderPushNotification/);
  assert.match(createReminderSource, /cancelReminderPushNotification\(savedId\)/);
  assert.match(createReminderSource, /scheduleReminderPushNotification\(\{\s*reminderId: recurrenceResult\.reminderId/s);
});
