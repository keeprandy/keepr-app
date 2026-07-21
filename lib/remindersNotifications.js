// lib/remindersNotifications.js
import { Platform } from "react-native";

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

  const dueAt = new Date(dueAtISO);
  if (!(dueAt instanceof Date) || isNaN(dueAt.getTime())) return null;

  // don't schedule if in the past
  if (dueAt.getTime() <= Date.now() + 1500) return null;

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
    trigger: dueAt,
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
