// screens/PublicActionScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, spacing, radius } from "../styles/theme";

// NOTE:
// - Works as in-app screen (route.params) AND deep-linked public web entry.
// - Token-based links (public-resolve) may not return the same fields as KAC resolve,
//   so we normalize it into a "resolved" shape that this screen can use.

const PROJECT_REF = "jjzjuqxysucqutgjnrkk";
const FUNCTIONS_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
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

    // 1) Querystring (?kac=KPR-XXXX-YYYY)
    const q = url.searchParams.get("kac") || url.searchParams.get("KAC");
    if (q) return decodeURIComponent(q).trim();

    // 2) Path: /k/KPR-XXXX-YYYY or /kac/KPR-...
    const path = (url.pathname || "").replace(/\/+$/, "");
    const m = path.match(/\/(k|kac)\/([^/]+)(?:\/actions)?$/i);
    if (m?.[2]) return decodeURIComponent(m[2]).trim();

    // 3) Hash: #/k/KPR-...
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

async function postFunction(path, payload, accessToken) {
  if (!ANON_KEY) throw new Error("Missing EXPO_PUBLIC_SUPABASE_ANON_KEY");

  // On web we MUST send Authorization or Supabase will complain;
  // use anon token when we don't have a session token available.
  const bearer = accessToken ? accessToken : ANON_KEY;

  const res = await fetch(`${FUNCTIONS_BASE}/${path}`, {
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
  // Goal: always return an object with { asset_id, asset_type, has_access, allowed_actions, asset }
  const r = input && typeof input === "object" ? input : null;
  if (!r) return null;

  // Case A: KAC resolve already returns expected fields.
  if (r.master_asset_id || r.asset_id || r.has_access !== undefined) {
    return {
      ...r,
      kac: r.kac || kac || null,
      asset_id: r.asset_id || null,
      asset_type: r.asset_type || "asset",
      has_access: !!r.has_access,
      allowed_actions: Array.isArray(r.allowed_actions)
        ? r.allowed_actions
        : [],
      asset: r.asset || null,
    };
  }

  // Case B: public-resolve (token-based) returns { asset, system, mode, public_link_id }
  const assetId = r?.asset?.id || r?.asset_id || null;
  return {
    ok: true,
    source: "token",
    token: token || null,
    kac: r.kac || kac || null, // token links might not include kac yet
    public_link_id: r.public_link_id || r.public_linkId || null,
    asset_type: "asset",
    asset_id: assetId,
    has_access: false, // token-based public view: treat as public
    allowed_actions: [
      "answer_question",
      "capture_event_inbox",
      "request_access",
    ],
    asset: r.asset || null,
    system: r.system || null,
    mode: r.mode || null,
  };
}

export default function PublicActionScreen({ route, navigation }) {
  const kacFromParams =
    route?.params?.kac ||
    route?.params?.kacId ||
    route?.params?.kac_id ||
    null;

  const kac = kacFromParams || getKacFromUrlFallback() || null;
  const token = route?.params?.token || getTokenFromUrlFallback() || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [resolved, setResolved] = useState(null);

  // action inputs
  const [title, setTitle] = useState("");
  const [notes, setNotes] = useState("");
  const [question, setQuestion] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");


  const headerSubtitle = useMemo(() => {
    const aType = resolved?.asset_type ? String(resolved.asset_type) : "asset";
    return `${aType} • public`;
  }, [resolved]);

  const assetId = resolved?.asset_id || null;
  const asset = resolved?.asset || null;
  // Owner inbox email (derived from public resolve payload).
  // We support multiple possible field names to stay backward compatible.
const inboxUsername =
  resolved?.inbox_username ||
  resolved?.owner_username ||
  resolved?.ownerUsername ||
  resolved?.asset?.owner_username ||
  resolved?.asset?.ownerUsername ||
  resolved?.asset?.username ||
  "owner"; // safe fallback

const inboxEmailAddress = kac
  ? `${inboxUsername}+${kac}@inbox.keeprhome.com`
  : `${inboxUsername}@inbox.keeprhome.com`;

const inboxEmailDisplay = `${inboxUsername}@inbox.keeprhome.com`;


  const allowedActions = Array.isArray(resolved?.allowed_actions)
    ? resolved.allowed_actions
    : [];

  const canAsk = allowedActions.length
    ? allowedActions.includes("answer_question")
    : true;

  const canLog = allowedActions.length
    ? allowedActions.includes("capture_event_inbox")
    : !!assetId;

  const canUpload = allowedActions.length
    ? allowedActions.includes("attach_proof_to_record")
    : false;

  const canRequestAccess = true; // always visible for public mental model

  function requireIdentity() {
    if (!name.trim() || !email.trim()) {
      Alert.alert("Identify yourself", "Please enter your name and email.");
      return false;
    }
    return true;
  }


  // Resolve token/KAC into an asset context
  useEffect(() => {
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

        if (cancelled) return;

        const normalized = normalizeResolved(json, { kac, token });
        setResolved(normalized);
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
  }, [kac, token]);

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

// Force a git push
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
          },
        },
        null
      );

      Alert.alert(
        "Sent",
        `Sent to the owner${res?.event?.id ? ` (${shortId(res.event.id)})` : ""}.`
      );

      setQuestion("");
    } catch (e) {
      Alert.alert("Could not send", e?.message || "Try again.");
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerFill}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!kac && !token) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerFill}>
          <Text style={styles.errorText}>Missing KAC.</Text>
          {IS_WEB ? (
            <Text style={styles.metaText}>
              Try /k/KPR-XXXX-YYYY/actions or ?kac=KPR-XXXX-YYYY or ?token=...
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      {/* Header */}
      <View style={styles.headerBar}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {navigation?.canGoBack?.() ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.headerBackBtn}
            >
              <Text style={styles.headerBackText}>‹</Text>
            </TouchableOpacity>
          ) : null}
          <View>
            <Text style={styles.headerTitle}>
              {asset?.name ? asset.name : "Keepr"}
            </Text>
            <Text style={styles.headerSub}>{headerSubtitle}</Text>
          </View>
        </View>

        <View style={styles.headerChips}>
          {resolved?.kac ? (
            <View style={styles.chip}>
              <Text style={styles.chipLabel}>KAC</Text>
              <Text style={styles.chipValue}>{shortId(resolved.kac)}</Text>
            </View>
          ) : null}

          {assetId ? (
            <View style={styles.chip}>
              <Text style={styles.chipLabel}>Asset</Text>
              <Text style={styles.chipValue}>{shortId(assetId)}</Text>
            </View>
          ) : null}

          <View style={[styles.chip, styles.chipAccessNo]}>
            <Text style={styles.chipLabel}>Access</Text>
            <Text style={styles.chipValue}>public</Text>
          </View>
        </View>
      </View>

      {!!error ? (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : null}

      {/* Body */}
      <ScrollView
        style={styles.body}
        contentContainerStyle={styles.bodyContent}
        keyboardShouldPersistTaps="handled"
      >
        
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Prefer email?</Text>
          <Text style={styles.cardHint}>
            Send invoices, receipts, or documents to:
          </Text>
        <TouchableOpacity onPress={openInboxMailto}>
          <Text style={styles.emailLinkText}>{inboxEmailDisplay || inboxEmailAddress}</Text>
          <Text style={styles.emailLinkHint}>Tap to open your email app</Text>
        </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Identify yourself</Text>
          <Text style={styles.cardHint}>This helps the owner reply to you.</Text>

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
        </View>

        {/* Ask a question */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Ask a question</Text>
          <Text style={styles.cardHint}>
            Great for “What filter size do I need?” or “Where is the shutoff?”
          </Text>
          <TextInput
            value={question}
            onChangeText={setQuestion}
            placeholder="Type your question…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          <TouchableOpacity
            onPress={handleAskQuestion}
            style={[styles.primaryBtn, !canAsk && styles.btnDisabled]}
            disabled={!canAsk}
          >
            <Text style={styles.primaryBtnText}>Send question</Text>
          </TouchableOpacity>
        </View>

        {/* Quick log */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Quick log</Text>
          <Text style={styles.cardHint}>
            Creates a draft event for the owner to accept into the timeline.
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

        <View style={styles.footerNote}>
          <Text style={styles.footerNoteText}>
            Public view: actions and emails create Event Inbox drafts for the owner.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },

  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.surface,
  },
  headerBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: "#F3F4F680",
  },
  headerBackText: {
    fontSize: 22,
    fontWeight: "900",
    color: colors.textPrimary,
    marginTop: -2,
  },
  headerTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  headerSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  headerChips: { flexDirection: "row", alignItems: "center" },
  chip: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.background,
  },
  chipLabel: { fontSize: 9, textTransform: "uppercase", color: colors.textMuted },
  chipValue: { fontSize: 11, fontWeight: "800", color: colors.textPrimary },
  chipAccessNo: {
    borderColor: "#11182722",
    backgroundColor: colors.background,
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

  body: { flex: 1 },
  bodyContent: { padding: spacing.lg, paddingBottom: spacing.xl * 2 },

  card: {
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.surface,
    borderRadius: radius.lg || 14,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  cardTitle: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  cardHint: { marginTop: 6, fontSize: 12, color: colors.textMuted },
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

  btnDisabled: { opacity: 0.5 },

  lockHint: { marginTop: 10, fontSize: 12, color: colors.textMuted },

  footerNote: { paddingTop: spacing.sm },
  footerNoteText: { fontSize: 12, color: colors.textMuted },
});