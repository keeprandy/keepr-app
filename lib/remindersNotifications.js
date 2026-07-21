// lib/remindersNotifications.js
import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

let Notifications = null;
try {
  // eslint-disable-next-line import/no-extraneous-dependencies
  Notifications = require("expo-notifications");
} catch {
  Notifications = null;
}

function buildNotificationActionDeepLink(reminderId, afterSave = "Notifications") {
  if (!reminderId) return "keepr://inbox";
  const params = new URLSearchParams({
    reminderId: String(reminderId),
    afterSave,
  });
  return `keepr://CreateReminder?${params.toString()}`;
}

const REMINDER_NOTIFICATION_PREFIX = "keepr.reminderNotificationId.v1:";

export function getReminderNotificationStorageKey(reminderId) {
  return reminderId ? `${REMINDER_NOTIFICATION_PREFIX}${String(reminderId)}` : null;
}

export function getReminderNotificationDueStatus(dueAtISO, nowMs = Date.now()) {
  const dueAt = new Date(dueAtISO);
  if (!(dueAt instanceof Date) || isNaN(dueAt.getTime())) {
    return { ok: false, reason: "missing_or_invalid_due_at" };
  }
  if (dueAt.getTime() <= nowMs + 1500) {
    return { ok: false, reason: "due_at_not_future" };
  }
  return { ok: true, dueAt };
}

export async function getPersistedReminderNotificationId(reminderId) {
  const key = getReminderNotificationStorageKey(reminderId);
  if (!key) return null;
  try {
    return (await AsyncStorage.getItem(key)) || null;
  } catch {
    return null;
  }
}

export async function persistReminderNotificationId(reminderId, notificationId) {
  const key = getReminderNotificationStorageKey(reminderId);
  if (!key || !notificationId) return;
  try {
    await AsyncStorage.setItem(key, String(notificationId));
  } catch {}
}

export async function clearPersistedReminderNotificationId(reminderId) {
  const key = getReminderNotificationStorageKey(reminderId);
  if (!key) return;
  try {
    await AsyncStorage.removeItem(key);
  } catch {}
}

export async function ensureNotificationPerms() {
  if (Platform.OS === "web") return { granted: false, web: true };
  if (!Notifications) return { granted: false, missing: true };

  const settings = await Notifications.getPermissionsAsync();
  const granted =
    settings?.granted ||
    settings?.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;

  if (granted) return { granted: true };

  const req = await Notifications.requestPermissionsAsync();
  const granted2 =
    req?.granted || req?.ios?.status === Notifications.IosAuthorizationStatus?.PROVISIONAL;

  return { granted: !!granted2 };
}

export async function scheduleReminderNotification({
  reminderId,
  title,
  body,
  dueAtISO,
  notificationType = "reminder_due",
  eventKey = null,
}) {
  if (Platform.OS === "web") return null;
  if (!Notifications) return null;

  const dueStatus = getReminderNotificationDueStatus(dueAtISO);
  if (!dueStatus.ok) return null;

  const identifier = await Notifications.scheduleNotificationAsync({
    content: {
      title: title || "Action",
      body: body || "Tap to open in Keepr",
      data: {
        type: "reminder",
        notificationType,
        reminderId,
        eventKey,
        afterSave: "Notifications",
        deepLink: buildNotificationActionDeepLink(reminderId),
        route: "CreateReminder",
      },
    },
    trigger: dueStatus.dueAt,
  });

  return identifier;
}

export async function cancelReminderNotification(notificationId) {
  if (Platform.OS === "web") return;
  if (!Notifications) return;
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {}
}

export function addReminderNotificationResponseListener(handler) {
  if (Platform.OS === "web") return null;
  if (!Notifications?.addNotificationResponseReceivedListener) return null;
  return Notifications.addNotificationResponseReceivedListener(handler);
}

export async function getLastReminderNotificationResponse() {
  if (Platform.OS === "web") return null;
  if (!Notifications?.getLastNotificationResponseAsync) return null;
  try {
    return await Notifications.getLastNotificationResponseAsync();
  } catch {
    return null;
  }
}

export async function cancelScheduledReminderNotificationForReminder(reminderId) {
  if (Platform.OS === "web") {
    return { status: "skipped", reason: "web" };
  }

  const previousIdentifier = await getPersistedReminderNotificationId(reminderId);
  if (previousIdentifier && Notifications) {
    await cancelReminderNotification(previousIdentifier);
  }
  await clearPersistedReminderNotificationId(reminderId);

  return {
    status: previousIdentifier ? "cancelled" : "cleared",
    previousIdentifier,
  };
}

export async function scheduleOrReplaceReminderNotification({
  reminderId,
  title,
  body,
  dueAtISO,
  notificationType = "reminder_due",
  eventKey = null,
}) {
  if (Platform.OS === "web") {
    return { status: "skipped", reason: "web" };
  }
  if (!reminderId) {
    return { status: "skipped", reason: "missing_reminder_id" };
  }

  const previousIdentifier = await getPersistedReminderNotificationId(reminderId);
  if (previousIdentifier && Notifications) {
    await cancelReminderNotification(previousIdentifier);
  }
  await clearPersistedReminderNotificationId(reminderId);

  if (!Notifications) {
    return {
      status: "skipped",
      reason: "notifications_unavailable",
      previousIdentifier,
    };
  }

  const dueStatus = getReminderNotificationDueStatus(dueAtISO);
  if (!dueStatus.ok) {
    return {
      status: "cleared",
      reason: dueStatus.reason,
      previousIdentifier,
    };
  }

  const perms = await ensureNotificationPerms();
  if (!perms?.granted) {
    return {
      status: "skipped",
      reason: perms?.web ? "web" : perms?.missing ? "notifications_unavailable" : "permission_denied",
      previousIdentifier,
    };
  }

  try {
    const identifier = await scheduleReminderNotification({
      reminderId,
      title,
      body,
      dueAtISO,
      notificationType,
      eventKey,
    });

    if (!identifier) {
      return {
        status: "cleared",
        reason: "not_scheduled",
        previousIdentifier,
      };
    }

    await persistReminderNotificationId(reminderId, identifier);

    return {
      status: "scheduled",
      identifier,
      previousIdentifier,
    };
  } catch (error) {
    return {
      status: "failed",
      reason: error?.message || "schedule_failed",
      previousIdentifier,
      error,
    };
  }
}

export function setReminderNotificationHandler() {
  if (Platform.OS === "web") return;
  if (!Notifications?.setNotificationHandler) return;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}
