import { getSupabaseClient } from "../_shared/context.ts";
import webpush from "npm:web-push@3.6.7";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type NotificationEvent = {
  id: string;
  event_type: "service_request_created" | "relationship_message_created";
  recipient_user_id: string;
  actor_user_id: string | null;
  title: string;
  body: string | null;
  delivery_payload: Record<string, unknown>;
  dedupe_key: string;
};

type NotificationDevice = {
  id: string;
  user_id: string;
  platform: "ios" | "android" | "web";
  push_provider: "expo" | "web_push";
  expo_push_token: string | null;
  web_push_subscription: Record<string, unknown> | null;
  enabled: boolean;
  invalid_at: string | null;
  active_context: Record<string, unknown> | null;
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function eventAllowedByPreferences(event: NotificationEvent, preferences: Record<string, unknown> | null) {
  if (!preferences) return true;
  if (event.event_type === "service_request_created") return preferences.new_requests !== false;
  if (event.event_type === "relationship_message_created") return preferences.direct_assigned_messages !== false;
  return true;
}

function shouldSuppressForActiveContext(event: NotificationEvent, device: NotificationDevice) {
  const active = device.active_context || {};
  const payload = event.delivery_payload || {};
  const activeThread = String(active.thread_id || "");
  const activeAction = String(active.action_id || "");
  const eventThread = String(payload.thread_id || "");
  const eventAction = String(payload.action_id || "");
  return Boolean((activeThread && activeThread === eventThread) || (activeAction && activeAction === eventAction));
}

function pushPayload(event: NotificationEvent, preferences: Record<string, unknown> | null) {
  const previewAllowed = preferences?.lock_screen_preview === true;
  const body = previewAllowed ? event.body || "Open Keepr to view details." : "Open Keepr to view details.";
  return {
    title: event.title,
    body,
    data: event.delivery_payload,
    tag: event.dedupe_key,
  };
}

async function sendExpo(device: NotificationDevice, payload: Record<string, unknown>) {
  if (!device.expo_push_token) return { ok: false, invalid: true, response: { error: "missing_expo_token" } };
  const res = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      to: device.expo_push_token,
      title: payload.title,
      body: payload.body,
      data: payload.data,
      sound: "default",
    }),
  });
  const response = await res.json().catch(() => ({ status: res.status }));
  const detailsError = response?.data?.details?.error || response?.errors?.[0]?.details?.error || null;
  const invalid = detailsError === "DeviceNotRegistered";
  return { ok: res.ok && !invalid, invalid, response };
}

async function sendWebPush(device: NotificationDevice, payload: Record<string, unknown>) {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT") || "mailto:support@keeprhome.com";
  if (!publicKey || !privateKey) return { ok: false, invalid: false, response: { error: "missing_vapid_keys" } };
  if (!device.web_push_subscription) return { ok: false, invalid: true, response: { error: "missing_subscription" } };

  webpush.setVapidDetails(subject, publicKey, privateKey);
  try {
    await webpush.sendNotification(device.web_push_subscription as any, JSON.stringify(payload));
    return { ok: true, invalid: false, response: { status: "sent" } };
  } catch (err) {
    const statusCode = Number((err as { statusCode?: number })?.statusCode || 0);
    return {
      ok: false,
      invalid: statusCode === 404 || statusCode === 410,
      response: { statusCode, message: String((err as Error)?.message || err) },
    };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!token) return json({ error: "Missing authorization" }, 401);

    const supabase = getSupabaseClient();
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData?.user?.id) return json({ error: "Invalid authorization" }, 401);
    const callerUserId = userData.user.id;

    const body = await req.json().catch(() => ({}));
    const eventIds = Array.isArray(body.event_ids) ? body.event_ids : body.event_id ? [body.event_id] : [];
    const cleanEventIds = eventIds.map((id: unknown) => String(id || "").trim()).filter(Boolean);
    if (!cleanEventIds.length) return json({ error: "Missing event_ids" }, 400);

    const { data: events, error: eventsError } = await supabase
      .from("notification_events")
      .select("*")
      .in("id", cleanEventIds)
      .eq("actor_user_id", callerUserId);
    if (eventsError) throw eventsError;

    const results: unknown[] = [];
    for (const event of (events || []) as NotificationEvent[]) {
      if (event.recipient_user_id === callerUserId) continue;

      const { data: preferences } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", event.recipient_user_id)
        .maybeSingle();
      if (!eventAllowedByPreferences(event, preferences || null)) {
        results.push({ event_id: event.id, status: "preference_suppressed" });
        continue;
      }

      const { data: devices, error: devicesError } = await supabase
        .from("notification_devices")
        .select("*")
        .eq("user_id", event.recipient_user_id)
        .eq("enabled", true)
        .is("invalid_at", null);
      if (devicesError) throw devicesError;

      const payload = pushPayload(event, preferences || null);
      for (const device of (devices || []) as NotificationDevice[]) {
        const deliveryChannel = device.push_provider;
        const { data: delivery } = await supabase
          .from("notification_deliveries")
          .upsert(
            {
              notification_event_id: event.id,
              device_id: device.id,
              channel: deliveryChannel,
              status: "pending",
            },
            { onConflict: "notification_event_id,device_id" }
          )
          .select("id")
          .single();

        if (shouldSuppressForActiveContext(event, device)) {
          await supabase
            .from("notification_deliveries")
            .update({ status: "suppressed", provider_response: { reason: "active_context" } })
            .eq("id", delivery?.id);
          results.push({ event_id: event.id, device_id: device.id, status: "suppressed" });
          continue;
        }

        if (Deno.env.get("ENABLE_EXTERNAL_PUSH_DELIVERY") !== "true") {
          await supabase
            .from("notification_deliveries")
            .update({ status: "suppressed", provider_response: { reason: "external_push_disabled" } })
            .eq("id", delivery?.id);
          results.push({ event_id: event.id, device_id: device.id, status: "suppressed" });
          continue;
        }

        const sent =
          deliveryChannel === "expo"
            ? await sendExpo(device, payload)
            : await sendWebPush(device, payload);

        if (sent.invalid) {
          await supabase.from("notification_devices").update({ invalid_at: new Date().toISOString(), enabled: false }).eq("id", device.id);
        }
        await supabase
          .from("notification_deliveries")
          .update({
            status: sent.invalid ? "invalid" : sent.ok ? "sent" : "failed",
            provider_response: sent.response,
            sent_at: sent.ok ? new Date().toISOString() : null,
          })
          .eq("id", delivery?.id);
        results.push({ event_id: event.id, device_id: device.id, status: sent.invalid ? "invalid" : sent.ok ? "sent" : "failed" });
      }
    }

    return json({ ok: true, results });
  } catch (err) {
    console.error("send-notification-event failed", err);
    return json({ error: String((err as Error)?.message || err) }, 500);
  }
});
