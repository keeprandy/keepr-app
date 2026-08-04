import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { supabase } from "./supabaseClient";

const DEVICE_ID_KEY = "keepr.notifications.deviceId.v1";
const EAS_PROJECT_ID = "7705d387-cff3-4310-b835-58cf3dfac948";

function cleanId(value) {
  const text = String(value || "").trim();
  return text || null;
}

function cleanText(value) {
  return String(value || "").trim();
}

function randomId() {
  if (typeof crypto !== "undefined" && crypto?.randomUUID) return crypto.randomUUID();
  return `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function getStableDeviceId() {
  let existing = null;
  try {
    existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  } catch {}
  if (existing) return existing;
  const next = randomId();
  try {
    await AsyncStorage.setItem(DEVICE_ID_KEY, next);
  } catch {}
  return next;
}

function routeForEvent(event = {}) {
  const payload = event.delivery_payload || {};
  const threadId = cleanId(event.thread_id || payload.thread_id);
  const actionId = cleanId(event.action_id || payload.action_id);
  const assetId = cleanId(event.asset_id || payload.asset_id);
  const kac = cleanId(event.kac || payload.kac);
  if (threadId) {
    const params = new URLSearchParams();
    if (assetId) params.set("assetId", assetId);
    if (threadId) params.set("threadId", threadId);
    return `/messages?${params.toString()}`;
  }
  if (actionId) {
    const params = new URLSearchParams();
    if (assetId) params.set("assetId", assetId);
    if (kac) params.set("kac", kac);
    params.set("actionId", actionId);
    return `/KeeprAction?${params.toString()}`;
  }
  if (kac) return `/pro-mode?assetKac=${encodeURIComponent(kac)}`;
  return "/dashboard";
}

export function buildNotificationPayload(event = {}) {
  return {
    eventId: event.id || null,
    eventType: event.event_type || null,
    assetId: event.asset_id || null,
    kac: event.kac || null,
    stewardshipId: event.stewardship_id || null,
    actionId: event.action_id || null,
    threadId: event.thread_id || null,
    url: routeForEvent(event),
  };
}

export async function getUnreadNotificationCount() {
  const { count, error } = await supabase
    .from("notification_events")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  if (error) throw error;
  return count || 0;
}

export async function markNotificationRead(eventId) {
  if (!eventId) return;
  const { error } = await supabase.rpc("mark_notification_event_read", { p_event_id: eventId });
  if (error) throw error;
}

export function subscribeToNotificationEvents({ userId, onEvent } = {}) {
  const id = cleanId(userId);
  if (!id) return () => {};
  const channel = supabase
    .channel(`notification-events:${id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notification_events",
        filter: `recipient_user_id=eq.${id}`,
      },
      (payload) => onEvent?.(payload?.new || null)
    )
    .subscribe();

  return () => {
    try {
      supabase.removeChannel(channel);
    } catch {}
  };
}

async function persistAndDeliver(params) {
  const { data, error } = await supabase.rpc("create_keepr_notification_event", params);
  if (error) throw error;
  const events = Array.isArray(data) ? data : [];
  const eventIds = events.map((event) => event?.id).filter(Boolean);
  if (eventIds.length) {
    try {
      await supabase.functions.invoke("send-notification-event", {
        body: { event_ids: eventIds },
      });
    } catch {
      // The event ledger is canonical; external push delivery is best effort.
    }
  }
  return events;
}

export async function createServiceRequestNotification({
  actorUserId,
  assetId,
  kac,
  organizationId,
  stewardshipId,
  actionId,
  threadId,
  title,
  body,
}) {
  return persistAndDeliver({
    p_event_type: "service_request_created",
    p_actor_user_id: actorUserId || undefined,
    p_asset_id: assetId,
    p_kac: kac || null,
    p_recipient_organization_id: organizationId || null,
    p_stewardship_id: stewardshipId || null,
    p_action_id: actionId || null,
    p_thread_id: threadId || null,
    p_title: title || "New service request",
    p_body: body || "A customer requested service.",
    p_priority: "normal",
    p_dedupe_key: actionId ? `service_request_created:${actionId}` : null,
  });
}

export async function createRelationshipMessageNotification({
  actorUserId,
  actingOrganizationId,
  assetId,
  kac,
  organizationId,
  stewardshipId,
  actionId,
  threadId,
  title,
  body,
}) {
  return persistAndDeliver({
    p_event_type: "relationship_message_created",
    p_actor_user_id: actorUserId || undefined,
    p_acting_organization_id: actingOrganizationId || null,
    p_asset_id: assetId,
    p_kac: kac || null,
    p_recipient_organization_id: organizationId || null,
    p_stewardship_id: stewardshipId || null,
    p_action_id: actionId || null,
    p_thread_id: threadId || null,
    p_title: title || "New relationship message",
    p_body: body || "Open Keepr to view the message.",
    p_priority: "normal",
    p_dedupe_key: null,
  });
}

export async function registerNativePushToken() {
  if (Platform.OS === "web") {
    return { ok: false, reason: "native_only" };
  }
  let Notifications;
  try {
    Notifications = require("expo-notifications");
  } catch {
    return { ok: false, reason: "expo_notifications_unavailable" };
  }

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData?.user?.id;
  if (!userId) throw new Error("Sign in to enable notifications.");

  const permission = await Notifications.getPermissionsAsync();
  let status = permission?.status;
  if (status !== "granted") {
    const requested = await Notifications.requestPermissionsAsync();
    status = requested?.status;
  }
  if (status !== "granted") return { ok: false, reason: "permission_denied" };

  const token = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  const deviceId = await getStableDeviceId();
  const { error } = await supabase.from("notification_devices").upsert(
    {
      user_id: userId,
      platform: Platform.OS,
      device_id: deviceId,
      push_provider: "expo",
      expo_push_token: token?.data || null,
      enabled: true,
      invalid_at: null,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,platform,device_id" }
  );
  if (error) throw error;
  return { ok: true, provider: "expo", token: token?.data || null };
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`.replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function registerWebPushSubscription() {
  if (Platform.OS !== "web") return { ok: false, reason: "web_only" };
  if (typeof window === "undefined") return { ok: false, reason: "unsupported_browser" };
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return { ok: false, reason: "unsupported_browser" };
  }
  const isSecure = window.location.protocol === "https:" || window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!isSecure) return { ok: false, reason: "https_required" };

  const publicKey = cleanText(process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY);
  if (!publicKey) return { ok: false, reason: "missing_vapid_public_key" };

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData?.user?.id;
  if (!userId) throw new Error("Sign in to enable notifications.");

  const permission = await window.Notification.requestPermission();
  if (permission !== "granted") return { ok: false, reason: "permission_denied" };

  const registration = await navigator.serviceWorker.register("/keepr-sw.js");
  const subscription =
    (await registration.pushManager.getSubscription()) ||
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    }));

  const deviceId = await getStableDeviceId();
  const { error } = await supabase.from("notification_devices").upsert(
    {
      user_id: userId,
      platform: "web",
      device_id: deviceId,
      push_provider: "web_push",
      web_push_subscription: subscription.toJSON(),
      user_agent: navigator.userAgent || null,
      enabled: true,
      invalid_at: null,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,platform,device_id" }
  );
  if (error) throw error;
  return { ok: true, provider: "web_push" };
}

export async function enableNotificationsForThisDevice() {
  if (Platform.OS === "web") return registerWebPushSubscription();
  return registerNativePushToken();
}

export async function setCurrentNotificationContext(context = {}) {
  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;
  const userId = authData?.user?.id;
  if (!userId) return;
  const deviceId = await getStableDeviceId();
  await supabase
    .from("notification_devices")
    .update({
      active_context: context || {},
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("platform", Platform.OS === "web" ? "web" : Platform.OS)
    .eq("device_id", deviceId);
}
