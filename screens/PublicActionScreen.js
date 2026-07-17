// PublicActionScreen – Portal V1 (careful extension of current behavior)
// Preserves existing resolve / identity / ask question / quick log / email intake flows.
// Adds portal framing and light V1 structure without removing current Event Inbox mapping.

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, spacing, radius } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { useFocusEffect } from "@react-navigation/native";
import PublicShell from "../components/public/PublicShell";
import { SafeAreaView } from "react-native-safe-area-context";
import { getSupabaseFunctionUrl } from "../lib/supabaseFunctions";

const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const IS_WEB = Platform.OS === "web";

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function shortId(id) {
  const s = safeStr(id);
  if (!s) return "—";
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function getKacFromUrlFallback() {
  try {
    if (!IS_WEB) return null;
    const href = typeof window !== "undefined" ? window.location.href : "";
    if (!href) return null;
    const url = new URL(href);

    const q = url.searchParams.get("kac") || url.searchParams.get("KAC");
    if (q) return decodeURIComponent(q).trim();

    const path = (url.pathname || "").replace(/\/+$/, "");
    const m = path.match(/\/(k|kac)\/([^/]+)(?:\/actions)?$/i);
    if (m?.[2]) return decodeURIComponent(m[2]).trim();

    const hash = (url.hash || "").replace(/^#/, "");
    const mh = hash.match(/\/(k|kac)\/([^/]+)(?:\/actions)?$/i);
    if (mh?.[2]) return decodeURIComponent(mh[2]).trim();

    return null;
  } catch {
    return null;
  }
}

function getTokenFromUrlFallback() {
  try {
    if (!IS_WEB) return null;
    const href = typeof window !== "undefined" ? window.location.href : "";
    if (!href) return null;
    const url = new URL(href);
    const t = url.searchParams.get("token") || url.searchParams.get("t");
    return t ? decodeURIComponent(t).trim() : null;
  } catch {
    return null;
  }
}


function getSourceUrl() {
  try {
    if (!IS_WEB || typeof window === "undefined") return null;
    return window.location.href || null;
  } catch {
    return null;
  }
}

async function postFunction(path, payload, accessToken) {
  if (!ANON_KEY) throw new Error("Missing EXPO_PUBLIC_SUPABASE_ANON_KEY");

  const bearer = accessToken ? accessToken : ANON_KEY;

  const res = await fetch(getSupabaseFunctionUrl(path), {
    method: "POST",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${bearer}`,
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}

  if (!res.ok) {
    throw new Error(
      (json && (json.error || json.message)) || text || `HTTP ${res.status}`
    );
  }

  return json ?? {};
}

function normalizeResolved(input, { kac, token }) {
  const r = input && typeof input === "object" ? input : null;
  if (!r) return null;

  if (r.master_asset_id || r.asset_id || r.has_access !== undefined) {
    return {
      ...r,
      kac: r.kac || kac || null,
      asset_id: r.asset_id || r.asset?.id || null,
      asset_type: r.asset_type || "asset",
      has_access: !!r.has_access,
      allowed_actions: Array.isArray(r.allowed_actions)
        ? r.allowed_actions
        : [],
      asset: r.asset || null,
    };
  }

  const assetId = r?.asset?.id || r?.asset_id || null;

  return {
    ...r, // <-- important: keep inbox_username / inbox_email_address
    ok: true,
    source: "token",
    token: token || null,
    kac: r.kac || kac || null,
    public_link_id: r.public_link_id || r.public_linkId || null,
    asset_type: "asset",
    asset_id: assetId,
    has_access: false,
    allowed_actions: Array.isArray(r.allowed_actions)
      ? r.allowed_actions
      : ["answer_question", "capture_event_inbox", "request_access"],
    asset: r.asset || null,
    system: r.system || null,
    mode: r.mode || null,
  };
}

async function fetchPublicSummaryConfig(kac) {
  const cleanKac = String(kac || "").trim();
  if (!cleanKac) return null;

  const { data, error } = await supabase
    .from("public_asset_story_summary")
    .select("asset_id, kac_id, name, type, public_config, extra_metadata")
    .eq("kac_id", cleanKac)
    .maybeSingle();

  if (error || !data) return null;

  const publicConfig =
    data.public_config ||
    data.extra_metadata?.publicConfig ||
    null;

  return {
    asset_id: data.asset_id || null,
    kac: data.kac_id || cleanKac,
    asset_type: data.type || null,
    asset_name: data.name || null,
    public_config: publicConfig,
    asset: {
      id: data.asset_id || null,
      kac_id: data.kac_id || cleanKac,
      name: data.name || null,
      type: data.type || null,
    },
  };
}

const ACTION_META = {
  request_info: {
    label: "Request Info",
    title: "Request information",
    hint: "Use this for sale, rent, or general questions about this asset.",
    cta: "Send request",
    intentType: "request_info",
    needsTitle: false,
    messagePlaceholder: "What would you like to know?",
  },
  request_service: {
    label: "Request Service",
    title: "Request service",
    hint: "Describe the issue, service need, or maintenance concern.",
    cta: "Send service request",
    intentType: "request_service",
    needsTitle: true,
    titlePlaceholder: "Title (ex: AC not cooling)",
    messagePlaceholder: "Describe the issue or service needed…",
  },
  submit_quote: {
    label: "Submit Quote",
    title: "Submit quote",
    hint: "Share pricing, scope, and details for this asset.",
    cta: "Submit quote",
    intentType: "submit_quote",
    needsTitle: true,
    titlePlaceholder: "Title (ex: Landscape quote)",
    messagePlaceholder: "Add quote details, scope, and notes…",
  },
  submit_proposal: {
    label: "Submit Proposal",
    title: "Submit service proposal",
    hint: "Submit a more formal proposal for work on this asset.",
    cta: "Submit proposal",
    intentType: "submit_proposal",
    needsTitle: true,
    titlePlaceholder: "Title (ex: Spring service proposal)",
    messagePlaceholder: "Describe scope, timing, and proposal details…",
  },
  pay_rent: {
    label: "Pay Rent",
    title: "Pay rent",
    hint: "Payment flow can be enabled here later.",
    cta: "Pay rent",
    intentType: "pay_rent",
    needsTitle: false,
    messagePlaceholder: "Optional note…",
  },
};

const ACTION_ALIASES = {
  answer_question: "request_info",
  capture_event_inbox: "request_service",
};

function getActionsForMode(mode) {
  switch (String(mode || "").toLowerCase()) {
    case "for_sale":
      return ["request_info", "submit_quote"];

    case "for_rent":
      return ["request_info", "request_service", "pay_rent"];

    case "builder":
      return ["request_service", "submit_proposal"];

    case "system_story":
      return ["request_service", "submit_quote"];

    case "current_story":
      return ["request_info", "request_service", "submit_quote"];

    case "inquiry":
    default:
      return ["request_info", "request_service", "submit_quote"];
  }
}

function normalizeActionKey(action) {
  const key = String(action || "").trim();
  return ACTION_ALIASES[key] || key;
}

function uniqueSupportedActions(actions) {
  const seen = new Set();
  const out = [];

  for (const action of Array.isArray(actions) ? actions : []) {
    const key = normalizeActionKey(action);
    if (!ACTION_META[key] || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }

  return out;
}

function getEffectivePublicActions({ actionConfig, allowedActions, mode }) {
  const configured = uniqueSupportedActions(actionConfig?.actionsEnabled);
  if (configured.length) return configured;

  const backend = uniqueSupportedActions(allowedActions);
  if (backend.length) return backend;

  return uniqueSupportedActions(getActionsForMode(mode));
}

export default function PublicActionScreen({ route, navigation }) {
  const kacFromParams =
    route?.params?.kac ||
    route?.params?.kacId ||
    route?.params?.kac_id ||
    null;

  const kac = kacFromParams || getKacFromUrlFallback() || null;
  const token = route?.params?.token || getTokenFromUrlFallback() || null;

  const isInternalMode = route?.params?.mode === "internal";
  const originHubId = route?.params?.hubId || null;
  const originHubName = route?.params?.hubName || null;
  const projectionType = route?.params?.projectionType || null;
  const eventName = route?.params?.eventName || null;
  const eventDate = route?.params?.eventDate || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [resolved, setResolved] = useState(null);

  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [question, setQuestion] = useState("");

  const [selectedAction, setSelectedAction] = useState(null);
  const [actionTitle, setActionTitle] = useState("");
  const [actionMessage, setActionMessage] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  const [viewerUserId, setViewerUserId] = useState(null);
const [canConfigurePublicView, setCanConfigurePublicView] = useState(false);

  const assetId = resolved?.asset_id || null;
  const asset = resolved?.asset || null;

  const headerSubtitle = useMemo(() => {
    return "Keepr Owner Portal";
  }, []);


const publicConfig =
  resolved?.public_config && typeof resolved.public_config === "object"
    ? resolved.public_config
    : {};

const actionConfig = publicConfig.actions || {};

const configuredInboxAddress =
  publicConfig.inboxEmailAddress ||
  publicConfig.inbox_email_address ||
  resolved?.inbox_email_address ||
  resolved?.inboxEmailAddress ||
  null;

const configuredInboxUsername =
  publicConfig.inboxUsername ||
  publicConfig.inbox_username ||
  resolved?.inbox_username ||
  resolved?.asset?.owner_inbox_name ||
  resolved?.asset?.inbox_name ||
  null;

const inboxUsername = configuredInboxUsername || "owner";

const inboxEmailAddress = configuredInboxAddress
  ? configuredInboxAddress
  : kac
  ? `${inboxUsername}+${kac}@inbox.keeprhome.com`
  : `${inboxUsername}@inbox.keeprhome.com`;

const inboxEmailDisplay = configuredInboxAddress
  ? configuredInboxAddress
  : `${inboxUsername}@inbox.keeprhome.com`;

const mode =
  actionConfig.mode ||
  resolved?.mode ||
  "inquiry";

// backend fallback (what server allows)
const backendAllowedActions = Array.isArray(resolved?.allowed_actions)
  ? resolved.allowed_actions
  : [];

// config-driven actions (owner intent)
const configuredActions = Array.isArray(actionConfig.actionsEnabled)
  ? actionConfig.actionsEnabled
  : null;

// final action set
const enabledActions = getEffectivePublicActions({
  actionConfig,
  allowedActions: backendAllowedActions,
  mode,
});

const selectedActionMeta = selectedAction ? ACTION_META[selectedAction] : null;

const canAsk = enabledActions.includes("request_info");
const canLog = enabledActions.includes("request_service") || !!assetId;

  function requireIdentity() {
    if (!name.trim() || !email.trim()) {
      Alert.alert("Identify yourself", "Please enter your name and email.");
      return false;
    }
    return true;
  }

  function buildPublicActionContext(type, message) {
    return {
      type,
      message: message || null,
      contact: {
        name: name.trim() || null,
        email: email.trim() || null,
        phone: phone.trim() || null,
      },
      kac: resolved?.kac || kac || null,
      asset_id: assetId || resolved?.asset_id || null,
      asset_name: asset?.name || resolved?.asset_name || resolved?.asset?.name || null,
      projection_type: projectionType || null,
      hub_id: originHubId || null,
      hub_name: originHubName || null,
      event: {
        name: eventName || null,
        date: eventDate || null,
      },
      source_url: getSourceUrl(),
    };
  }

  useFocusEffect(
  React.useCallback(() => {
    let cancelled = false;

    const run = async () => {
      if (!kac && !token) {
        setLoading(false);
        setResolved(null);
        setError("Missing KAC.");
        return;
      }

      setLoading(true);
      setError("");

      try {
        const payload = token
          ? { token, channel: "public", action: "open" }
          : { kac, channel: "qr", action: "scan" };

        const path = token ? "public-resolve" : "kac-resolve";
        const json = await postFunction(path, payload, null);

        console.log("PUBLIC ACTION RESOLVE PATH:", path);
        console.log("PUBLIC ACTION RAW JSON:", json);

        if (cancelled) return;

        const normalized = normalizeResolved(json, { kac, token });
        const publicSummary = !token
          ? await fetchPublicSummaryConfig(normalized?.kac || kac)
          : null;

        setResolved({
          ...normalized,
          ...publicSummary,
          asset: {
            ...(normalized?.asset || {}),
            ...(publicSummary?.asset || {}),
          },
          public_config:
            normalized?.public_config ||
            publicSummary?.public_config ||
            null,
        });
      } catch (e) {
        if (cancelled) return;
        setResolved(null);
        setError(e?.message || "Could not resolve this code.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();

    return () => {
      cancelled = true;
    };
  }, [kac, token])
);

useEffect(() => {
  if (!enabledActions.length) return;

  if (!selectedAction || !enabledActions.includes(selectedAction)) {
    setSelectedAction(enabledActions[0]);
  }
}, [enabledActions]);

useEffect(() => {
  let cancelled = false;

  const run = async () => {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id || null;

      if (cancelled) return;

      setViewerUserId(uid);

      if (!uid || !assetId) {
        setCanConfigurePublicView(false);
        return;
      }

      // Owner can always configure
      if (asset?.owner_id && asset.owner_id === uid) {
        setCanConfigurePublicView(true);
        return;
      }

      // Team / steward access
      const { data: stewardship, error } = await supabase
        .from("asset_stewardships")
        .select("asset_id, user_id, active")
        .eq("asset_id", assetId)
        .eq("user_id", uid)
        .eq("active", true)
        .maybeSingle();

      if (cancelled) return;

      if (error) {
        console.log("Public configure access check failed:", error.message);
        setCanConfigurePublicView(false);
        return;
      }

      setCanConfigurePublicView(!!stewardship);
    } catch (e) {
      if (!cancelled) {
        console.log("Public configure access error:", e?.message || e);
        setCanConfigurePublicView(false);
      }
    }
  };

  run();

  return () => {
    cancelled = true;
  };
}, [assetId, asset?.owner_id]);

  const openInboxMailto = async () => {
    const kacCode = String(resolved?.kac || kac || "").trim();
    const subject = encodeURIComponent(
      kacCode ? `Keepr intake ${kacCode}` : "Keepr intake"
    );
    const url = `mailto:${inboxEmailAddress}?subject=${subject}`;

    try {
      const canOpen = await Linking.canOpenURL(url);
      if (!canOpen) {
        Alert.alert("Email", inboxEmailDisplay || inboxEmailAddress);
        return;
      }
      await Linking.openURL(url);
    } catch {
      Alert.alert("Email", inboxEmailDisplay || inboxEmailAddress);
    }
  };

  const handleLogEvent = async () => {
    if (!requireIdentity()) return;
    const t = title.trim();
    if (!t) {
      Alert.alert("Missing title", "Add a quick title (ex: Changed filter).");
      return;
    }

    if (!assetId && !kac && !token) {
      Alert.alert("Not ready", "This link didn’t resolve to an asset yet.");
      return;
    }

    try {
      const res = await postFunction(
        "public-action",
        {
          kac: resolved?.kac || kac || null,
          token: token || null,
          intent: "capture_event_inbox",
          payload: {
            title: t,
            notes: notes.trim() || null,
            occurred_at: new Date().toISOString().slice(0, 10),
            type: "quick_log",
            contact_name: name,
            contact_email: email,
            contact_phone: phone || null,
            context: {
              public_action: buildPublicActionContext("quick_log", notes.trim() || null),
            },
          },
        },
        null
      );

      Alert.alert(
        "Saved (draft)",
        `Event Inbox created${res?.event?.id ? ` (${shortId(res.event.id)})` : ""}. The owner can accept it into the timeline.`
      );

      setTitle("");
      setNotes("");
    } catch (e) {
      Alert.alert("Could not save", e?.message || "Try again.");
    }
  };

  const handleAskQuestion = async () => {
    if (!requireIdentity()) return;
    const q = question.trim();
    if (!q) {
      Alert.alert("Ask a question", "Type a question first.");
      return;
    }

    try {
      const res = await postFunction(
        "public-action",
        {
          kac: resolved?.kac || kac || null,
          token: token || null,
          intent: "capture_event_inbox",
          payload: {
            title: "Question",
            notes: q,
            occurred_at: new Date().toISOString().slice(0, 10),
            type: "question",
            contact_name: name,
            contact_email: email,
            contact_phone: phone || null,
            context: {
              public_action: buildPublicActionContext("question", q),
            },
          },
        },
        null
      );

      Alert.alert(
        "Sent",
        `Sent to the owner${res?.thread?.id ? ` (${shortId(res.thread.id)})` : ""}.`
      );

      setQuestion("");

      if (res?.public_thread?.token) {
        navigation.navigate("PublicThreadMessage", {
          publicThreadToken: res.public_thread.token,
          messageId: res?.message?.id || null,
        });
      }
    } catch (e) {
      Alert.alert("Could not send", e?.message || "Try again.");
    }
  };

  const handleSubmitStructuredAction = async () => {
  if (!selectedActionMeta) return;
  if (!requireIdentity()) return;

  if (selectedAction === "pay_rent") {
    showNotLiveYet("Pay Rent");
    return;
  }

  if (selectedActionMeta.needsTitle && !actionTitle.trim()) {
    Alert.alert("Missing title", "Please add a short title.");
    return;
  }

  if (!actionMessage.trim()) {
    Alert.alert("Missing details", "Please add a message or description.");
    return;
  }

  try {
    const res = await postFunction(
      "public-action",
      {
        kac: resolved?.kac || kac || null,
        token: token || null,
        intent: "capture_event_inbox",
        payload: {
          title: selectedActionMeta.needsTitle
            ? actionTitle.trim()
            : selectedActionMeta.title,
          notes: actionMessage.trim(),
          occurred_at: new Date().toISOString().slice(0, 10),
          type: selectedActionMeta.intentType,
          contact_name: name,
          contact_email: email,
          contact_phone: phone || null,
          context: {
            public_action: buildPublicActionContext(
              selectedActionMeta.intentType,
              actionMessage.trim()
            ),
          },
        },
      },
      null
    );

    Alert.alert(
      "Submitted",
      `${selectedActionMeta.label} sent${res?.event?.id ? ` (${shortId(res.event.id)})` : ""}.`
    );

    setSelectedAction(null);
    setActionTitle("");
    setActionMessage("");
  } catch (e) {
    Alert.alert("Could not submit", e?.message || "Try again.");
  }
};

  const showNotLiveYet = (label) => {
    Alert.alert(label, "Coming soon in Portal V1. This will publish structured demand into the owner’s Event Inbox.");
  };

  const renderShell = (children) => {
  if (isInternalMode) {
    return (
      <SafeAreaView
        style={styles.internalSafe}
        edges={["top", "left", "right", "bottom"]}
      >
        <View style={styles.internalShell}>{children}</View>
      </SafeAreaView>
    );
  }

  return <PublicShell kac={resolved?.kac || kac}>{children}</PublicShell>;
};

  const handleOpenPublicConfig = () => {
  if (!assetId) {
    Alert.alert("Not ready", "This asset is not fully resolved yet.");
    return;
  }

  navigation.navigate("PublicConfig", {
    assetId,
    assetName: asset?.name || "Asset",
  });
};

if (loading) {
  return renderShell(
    <View style={styles.centerFill}>
      <ActivityIndicator />
    </View>
  );
}

if (!kac && !token) {
  return renderShell(
    <View style={styles.centerFill}>
      <Text style={styles.errorText}>Missing KAC.</Text>
    </View>
  );
}
  return renderShell(
  <>

      <View style={styles.actionsTopRow}>
  <TouchableOpacity
    onPress={() => {
  if (isInternalMode) {
    navigation.navigate("KeeprStoryInternal", {
      kac,
      assetId,
      hubId: originHubId,
      hubName: originHubName,
      mode: "internal",
    });
    return;
  }

  navigation.navigate("PublicKeeprStory", { kac });
}}
    style={styles.backToStoryBtn}
    activeOpacity={0.85}
  >
    <Text style={styles.backToStoryText}>← Back to story</Text>
  </TouchableOpacity>

  {canConfigurePublicView ? (
    <TouchableOpacity
      onPress={handleOpenPublicConfig}
      style={styles.configureBtn}
      activeOpacity={0.85}
    >
      <Text style={styles.configureBtnText}>Configure</Text>
    </TouchableOpacity>
  ) : null}
</View>

      {!!error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      <View style={styles.bodyContent}>
        <View style={styles.portalIntroCard}>
          <Text style={styles.portalIntroTitle}>Take Action</Text>
          <Text style={styles.portalIntroText}>
            This asset can accept structured requests through Keepr. Choose what you want to do below.
          </Text>
        </View>

{actionConfig.enabled !== false && enabledActions.length > 0 ? (
  <>
<Text style={styles.sectionTitle}>CHOOSE AN ACTION</Text>
<View style={styles.card}>
  <View style={styles.actionGrid}>
    {enabledActions.map((actionKey) => {
      const meta = ACTION_META[actionKey];
      if (!meta) return null;

      const active = selectedAction === actionKey;

      return (
        <TouchableOpacity
          key={actionKey}
          onPress={() => {
            setSelectedAction(actionKey);
            setActionTitle("");
            setActionMessage("");
          }}
          style={[
            styles.actionPill,
            active && styles.actionPillActive,
          ]}
          activeOpacity={0.85}
        >
          <Text
            style={[
              styles.actionPillText,
              active && styles.actionPillTextActive,
            ]}
          >
            {meta.label}
          </Text>
        </TouchableOpacity>
      );
    })}
  </View>
</View>
  </>
) : actionConfig.enabled !== false ? (
  <View style={styles.card}>
    <Text style={styles.cardTitle}>Actions unavailable</Text>
    <Text style={styles.cardHint}>
      This public story is not currently accepting supported public actions.
    </Text>
  </View>
) : null}

{selectedActionMeta ? (
  <>
    <Text style={styles.sectionTitle}>ACTION DETAILS</Text>
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{selectedActionMeta.title}</Text>
      <Text style={styles.cardHint}>{selectedActionMeta.hint}</Text>

      {selectedActionMeta.needsTitle ? (
        <TextInput
          value={actionTitle}
          onChangeText={setActionTitle}
          placeholder={selectedActionMeta.titlePlaceholder || "Title"}
          style={styles.input}
        />
      ) : null}

      <TextInput
        value={actionMessage}
        onChangeText={setActionMessage}
        placeholder={selectedActionMeta.messagePlaceholder || "Details…"}
        placeholderTextColor={colors.textMuted}
        multiline
        textAlignVertical="top"
        style={[styles.input, styles.textArea]}
      />

      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name"
        style={styles.input}
      />

      <TextInput
        value={email}
        onChangeText={setEmail}
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        style={styles.input}
      />

      <TextInput
        value={phone}
        onChangeText={setPhone}
        placeholder="Phone (optional)"
        keyboardType="phone-pad"
        style={styles.input}
      />

      <TouchableOpacity
        onPress={handleSubmitStructuredAction}
        style={styles.primaryBtn}
      >
        <Text style={styles.primaryBtnText}>{selectedActionMeta.cta}</Text>
      </TouchableOpacity>
    </View>
  </>
) : null}

        <Text style={styles.sectionTitle}>DOCUMENT</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Prefer email?</Text>
          <Text style={styles.cardHint}>
            Send invoices, receipts, quotes, or documents to:
          </Text>
          <TouchableOpacity onPress={openInboxMailto}>
            <Text style={styles.emailLinkText}>
              {inboxEmailDisplay || inboxEmailAddress}
            </Text>
            <Text style={styles.emailLinkHint}>Tap to open your email app</Text>
          </TouchableOpacity>
        </View>

{(publicConfig?.story?.showSystems ?? true) ? (
  <>
        <Text style={styles.sectionTitle}>RECORD</Text>
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Log something for the owner</Text>
          <Text style={styles.cardHint}>
            Use this if you completed work or want to leave a record.
          </Text>

          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Title (ex: Changed filter)"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Notes (optional)"
            placeholderTextColor={colors.textMuted}
            multiline
            textAlignVertical="top"
            style={[styles.input, styles.textArea]}
          />

          <TouchableOpacity
            onPress={handleLogEvent}
            style={[styles.primaryBtn, !canLog && styles.btnDisabled]}
            disabled={!canLog}
          >
            <Text style={styles.primaryBtnText}>Save draft event</Text>
          </TouchableOpacity>

          {!canLog ? (
            <Text style={styles.lockHint}>
              This link didn’t resolve to an asset yet.
            </Text>
          ) : null}
        </View>
        </>
      ) : null}

        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            Public view: actions and emails create Event Inbox drafts for the owner.
          </Text>
        </View>
      </View>
      </>
    );
}

const styles = StyleSheet.create({

  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },

  configureBtn: {
  flexDirection: "row",
  alignItems: "center",
  gap: 6,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: colors.textPrimary,
},

configureBtnText: {
  color: "#FFFFFF",
  fontSize: 12,
  fontWeight: "900",
},

internalSafe: {
  flex: 1,
  backgroundColor: colors.background,
},

internalShell: {
  flex: 1,
  width: "100%",
  maxWidth: 1180,
  alignSelf: "center",
  paddingHorizontal: 14,
  paddingBottom: spacing.xl,
},

actionsTopRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: spacing.lg,
},

backToStoryBtn: {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: "#11182722",
},

backToStoryText: {
  fontSize: 12,
  fontWeight: "900",
  color: colors.textPrimary,
},

actionGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: spacing.sm,
},

actionPill: {
  paddingHorizontal: spacing.md,
  paddingVertical: 12,
  borderRadius: 999,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: "#11182722",
},

actionPillActive: {
  backgroundColor: colors.primary,
  borderColor: colors.primary,
},

actionPillText: {
  fontSize: 12,
  fontWeight: "900",
  color: colors.textPrimary,
},

actionPillTextActive: {
  color: "#FFFFFF",
},

  errorBanner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: "#FEE2E2",
    borderBottomWidth: 1,
    borderColor: "#FCA5A5",
  },
  errorText: { color: "#991B1B", fontSize: 12, textAlign: "center" },
  metaText: {
    marginTop: 8,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },


  bodyContent: {
  width: "100%",
  maxWidth: 1280,
  alignSelf: "center",
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.lg,
  paddingBottom: spacing.xl * 2,
},

  portalIntroCard: {
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.xs,
  },
  portalIntroTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  portalIntroText: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 20,
    color: colors.textMuted,
  },

  sectionTitle: {
    marginBottom: spacing.sm,
    fontSize: 11,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },

  card: {
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.surface,
    borderRadius: radius.lg || 14,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  cardHint: { marginTop: 6, fontSize: 12, color: colors.textMuted, lineHeight: 18 },
  emailLinkText: {
    fontWeight: "800",
    marginTop: 8,
    fontSize: 14,
    color: "#2563EB",
    textDecorationLine: "underline",
  },
  emailLinkHint: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textMuted,
  },

  input: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: radius.md || 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  textArea: { minHeight: 90 },

  primaryBtn: {
    marginTop: spacing.sm,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  primaryBtnText: { color: "#fff", fontWeight: "900" },

  secondaryBtn: {
    flex: 1,
    marginTop: spacing.sm,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  secondaryBtnText: { color: colors.textPrimary, fontWeight: "900" },

  comingSoonRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },

  btnDisabled: { opacity: 0.5 },

  lockHint: { marginTop: 10, fontSize: 12, color: colors.textMuted },

  footerNote: { paddingTop: spacing.sm },
  footerNoteText: { fontSize: 12, color: colors.textMuted },
});
