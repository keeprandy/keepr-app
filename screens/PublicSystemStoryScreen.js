import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";

import PublicShell from "../components/public/PublicShell";
import { keeprApiRequest } from "../lib/keeprApi";
import { supabase } from "../lib/supabaseClient";
import { colors, radius, shadows, spacing } from "../styles/theme";

const IS_WEB = Platform.OS === "web";

function getUrlParts() {
  if (!IS_WEB || typeof window === "undefined") return {};
  try {
    const url = new URL(window.location.href);
    const match = url.pathname.match(/^\/k\/([^/]+)\/n\/([^/]+)$/i);
    return {
      kac: match?.[1] ? decodeURIComponent(match[1]) : null,
      nodeId: match?.[2] ? decodeURIComponent(match[2]) : null,
      sourceUrl: url.toString(),
    };
  } catch {
    return {};
  }
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function valueOrDash(value) {
  const text = String(value || "").trim();
  return text || "-";
}

function sentenceName(value) {
  const text = String(value || "system").trim();
  return text ? text.toLowerCase() : "system";
}

export default function PublicSystemStoryScreen({ route }) {
  const { width } = useWindowDimensions();
  const isWide = IS_WEB && width >= 980;
  const urlParts = getUrlParts();
  const kac = route?.params?.kac || urlParts.kac || null;
  const nodeId = route?.params?.nodeId || route?.params?.node_id || urlParts.nodeId || null;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [story, setStory] = useState(null);
  const [viewer, setViewer] = useState({ loading: true, user: null, label: "Public visitor" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    title: "",
    message: "",
  });

  const publicUrl = useMemo(() => {
    if (!kac || !nodeId) return "";
    if (IS_WEB && typeof window !== "undefined") {
      return `${window.location.origin}/k/${encodeURIComponent(kac)}/n/${encodeURIComponent(nodeId)}`;
    }
    return `https://app.keeprhome.com/k/${encodeURIComponent(kac)}/n/${encodeURIComponent(nodeId)}`;
  }, [kac, nodeId]);

  useEffect(() => {
    let cancelled = false;
    async function loadViewer() {
      try {
        const { data } = await supabase.auth.getUser();
        const user = data?.user || null;
        if (!user?.id) {
          if (!cancelled) setViewer({ loading: false, user: null, label: "Public visitor" });
          return;
        }

        let label = "Keepr member";
        const { data: profile } = await supabase
          .from("profiles")
          .select("display_name, full_name")
          .eq("id", user.id)
          .maybeSingle();
        const displayName = String(profile?.display_name || profile?.full_name || "").trim();
        if (displayName) label = displayName;

        if (!cancelled) setViewer({ loading: false, user, label });
      } catch {
        if (!cancelled) setViewer({ loading: false, user: null, label: "Public visitor" });
      }
    }
    loadViewer();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user || null;
      setViewer((prev) => ({
        loading: false,
        user,
        label: user ? prev.label === "Public visitor" ? "Keepr member" : prev.label : "Public visitor",
      }));
      if (user) loadViewer();
    });

    return () => {
      cancelled = true;
      sub?.subscription?.unsubscribe?.();
    };
  }, []);

  const load = useCallback(async () => {
    if (!kac || !nodeId) {
      setError("This system link is missing its node identity.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const json = await keeprApiRequest(
        `/api/public-node/${encodeURIComponent(kac)}/${encodeURIComponent(nodeId)}`
      );
      setStory(json);
      const displayName = json?.node?.display_name || json?.node?.name || "System";
      setForm((prev) => {
        if (prev.title) return prev;
        return { ...prev, title: `${displayName} update` };
      });
    } catch (e) {
      setStory(null);
      setError(e?.message || "Could not load this system story.");
    } finally {
      setLoading(false);
    }
  }, [kac, nodeId]);

  useEffect(() => {
    load();
  }, [load]);

  const node = story?.node || {};
  const asset = story?.asset || {};
  const pros = story?.connectors?.keepr_pros || [];
  const primaryPro = pros[0] || null;
  const timeline = story?.timeline || [];
  const identity = node.identity || {};
  const nodeDisplayName = node.display_name || node.name || "System";
  const nodeSentenceName = sentenceName(nodeDisplayName);

  const updateForm = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const copyLink = async () => {
    if (!publicUrl) return;
    await Clipboard.setStringAsync(publicUrl);
    Alert.alert("Copied", "Public System Story link copied.");
  };

  const submitMessage = async () => {
    if (submitting || submitted) return;
    if (!form.name.trim() || !form.email.trim()) {
      Alert.alert("Contact required", "Add your name and email so the owner can follow up.");
      return;
    }
    if (!form.message.trim()) {
      Alert.alert("Message required", "Add the update, issue, or service note.");
      return;
    }

    setSubmitting(true);
    try {
      const json = await keeprApiRequest("/api/public-node-action", {
        method: "POST",
        body: {
          kac,
          node_id: nodeId,
          keepr_pro_id: primaryPro?.id || null,
          source_url: urlParts.sourceUrl || publicUrl,
          title: form.title.trim() || `${nodeDisplayName} update`,
          message: form.message.trim(),
          contact: {
            name: form.name.trim(),
            email: form.email.trim(),
            phone: form.phone.trim() || null,
          },
        },
      });
      setSubmitted(json);
    } catch (e) {
      Alert.alert("Could not send", e?.message || "Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const shell = (children) => (
    <PublicShell
      kac={kac}
      contextTitle={node?.name || "Public System Story"}
      contextSubtitle={asset?.name ? `${asset.name} system` : "Keepr System Story"}
      viewerLabel={viewer.label}
      primaryActionLabel={viewer.user ? "Open in Keepr" : "What's Keepr?"}
      onPrimaryAction={() => {
        if (viewer.user) {
          if (IS_WEB && typeof window !== "undefined") {
            const params = new URLSearchParams();
            if (asset?.id) params.set("assetId", asset.id);
            if (node?.id || nodeId) params.set("systemId", node?.id || nodeId);
            window.location.href = `/messages${params.toString() ? `?${params.toString()}` : ""}`;
          }
          return;
        }
        if (IS_WEB && typeof window !== "undefined") {
          window.open("https://www.keeprhome.com/", "_blank", "noopener,noreferrer");
        }
      }}
    >
      {children}
    </PublicShell>
  );

  if (loading) {
    return shell(
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.centerText}>Loading Public System Story...</Text>
      </View>
    );
  }

  if (error || !story?.ok) {
    return shell(
      <View style={styles.center}>
        <Text style={styles.errorTitle}>System Story unavailable</Text>
        <Text style={styles.centerText}>{error || "This public node could not be resolved."}</Text>
      </View>
    );
  }

  return shell(
    <View style={styles.wrap}>
      <View style={[styles.heroCard, isWide && styles.heroCardWide]}>
        <View style={[styles.heroImageWrap, isWide && styles.heroImageWrapWide]}>
          {node.hero_url ? (
            <Image source={{ uri: node.hero_url }} style={styles.heroImage} resizeMode="contain" />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="hardware-chip-outline" size={42} color={colors.textMuted} />
              <Text style={styles.heroPlaceholderText}>System proof photo pending</Text>
            </View>
          )}
        </View>

        <View style={styles.heroMeta}>
          <Text style={styles.kicker}>Public System Story</Text>
          <Text style={styles.title}>{nodeDisplayName}</Text>
          <Text style={styles.subtitle}>
            Connected to {asset.name || "this Keepr asset"}.
          </Text>

          {node.story_summary ? (
            <Text style={styles.storyText}>{node.story_summary}</Text>
          ) : null}

          <View style={styles.factGrid}>
            <Fact label="Manufacturer" value={identity.manufacturer} />
            <Fact label="Model" value={identity.model} />
            <Fact label="Serial" value={identity.serial_number} />
            <Fact label="Installed" value={formatDate(identity.installed_on)} />
            <Fact label="Location" value={identity.location} />
            <Fact label="Connected Asset" value={asset.name} />
          </View>
        </View>
      </View>

      <View style={styles.grid}>
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Operational Connector</Text>
            <Ionicons name="git-network-outline" size={18} color={colors.primary} />
          </View>

          {primaryPro ? (
            <View style={styles.proCard}>
              <Text style={styles.proKicker}>Assigned KeeprPro</Text>
              <Text style={styles.proTitle}>{primaryPro.name}</Text>
              <Text style={styles.proMeta}>
                {primaryPro.category ? `${primaryPro.category} service` : "System service"} for {node.name}.
              </Text>
            </View>
          ) : (
            <Text style={styles.muted}>No public KeeprPro connector is assigned yet.</Text>
          )}

          <View style={styles.qrBox}>
            <Text style={styles.qrLabel}>Share this {nodeSentenceName} story</Text>
            <QRCode value={publicUrl || "https://app.keeprhome.com"} size={150} />
            <TouchableOpacity style={styles.secondaryButton} onPress={copyLink}>
              <Ionicons name="link-outline" size={16} color={colors.textPrimary} />
              <Text style={styles.secondaryButtonText}>Copy link</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Send a message about this {nodeSentenceName}</Text>
            <Ionicons name="chatbubble-ellipses-outline" size={18} color={colors.primary} />
          </View>

          {submitted ? (
            <View style={styles.confirmBox}>
              <Ionicons name="checkmark-circle" size={28} color="#059669" />
              <Text style={styles.confirmTitle}>Message sent to the owner</Text>
              <Text style={styles.confirmText}>
                Keepr attached the {nodeDisplayName}, {asset.name || "connected asset"}, and {primaryPro?.name || "provider"} context.
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.muted}>
                Share a service note, issue, quote, or visit update. It will land in the owner's Keepr inbox with this system context.
              </Text>
              <TextInput style={styles.input} value={form.name} onChangeText={(v) => updateForm("name", v)} placeholder="Your name" />
              <TextInput style={styles.input} value={form.email} onChangeText={(v) => updateForm("email", v)} placeholder="Email" autoCapitalize="none" keyboardType="email-address" />
              <TextInput style={styles.input} value={form.phone} onChangeText={(v) => updateForm("phone", v)} placeholder="Phone (optional)" keyboardType="phone-pad" />
              <TextInput style={styles.input} value={form.title} onChangeText={(v) => updateForm("title", v)} placeholder="Title" />
              <TextInput
                style={[styles.input, styles.textArea]}
                value={form.message}
                onChangeText={(v) => updateForm("message", v)}
                placeholder="What should the owner know?"
                multiline
                textAlignVertical="top"
              />
              <TouchableOpacity style={[styles.primaryButton, submitting && styles.disabled]} onPress={submitMessage} disabled={submitting}>
                <Ionicons name="send-outline" size={16} color="white" />
                <Text style={styles.primaryButtonText}>{submitting ? "Sending..." : "Send to owner"}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <View style={styles.card}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Public Timeline</Text>
          <Ionicons name="time-outline" size={18} color={colors.primary} />
        </View>

        {timeline.length ? (
          timeline.map((item) => (
            <View key={item.id} style={styles.timelineRow}>
              <View style={styles.timelineIcon}>
                <Ionicons name="construct-outline" size={16} color={colors.textPrimary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.timelineTitle}>{item.title}</Text>
                {item.performed_at ? <Text style={styles.timelineDate}>{formatDate(item.performed_at)}</Text> : null}
                {item.description ? <Text style={styles.timelineText}>{item.description}</Text> : null}
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.muted}>No public system timeline entries yet.</Text>
        )}
      </View>

      <View style={styles.aboutCard}>
        <Text style={styles.aboutTitle}>What's Keepr?</Text>
        <Text style={styles.aboutText}>
          Keepr connects ownership stories, systems, proof, and service relationships so the right context travels with the things people care about.
        </Text>
      </View>
    </View>
  );
}

function Fact({ label, value }) {
  return (
    <View style={styles.fact}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{valueOrDash(value)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    minHeight: 420,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  centerText: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    textAlign: "center",
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  wrap: {
    width: "100%",
    maxWidth: 1180,
    alignSelf: "center",
    gap: spacing.lg,
    paddingTop: spacing.lg,
  },
  heroCard: {
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.subtle,
  },
  heroCardWide: {
    flexDirection: "row",
    minHeight: 420,
  },
  heroImageWrap: {
    width: "100%",
    aspectRatio: 4 / 3,
    backgroundColor: "#FFFFFF",
  },
  heroImageWrapWide: {
    width: 0,
    flex: 1.12,
    minHeight: 420,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  heroPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  heroPlaceholderText: {
    color: colors.textMuted,
    fontWeight: "800",
  },
  heroMeta: {
    flex: 1,
    padding: spacing.lg,
  },
  kicker: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.primary,
    textTransform: "uppercase",
  },
  title: {
    marginTop: 8,
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 8,
    fontSize: 15,
    lineHeight: 22,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  storyText: {
    marginTop: 18,
    paddingTop: 18,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    fontSize: 15,
    lineHeight: 23,
    color: colors.textSecondary,
  },
  factGrid: {
    marginTop: spacing.lg,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  fact: {
    width: "48%",
    minWidth: 150,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  factLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  factValue: {
    marginTop: 5,
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
  },
  card: {
    flex: 1,
    minWidth: 320,
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  muted: {
    fontSize: 13,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  proCard: {
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#EFF6FF",
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  proKicker: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.primary,
    textTransform: "uppercase",
  },
  proTitle: {
    marginTop: 4,
    fontSize: 20,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  proMeta: {
    marginTop: 5,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  qrBox: {
    marginTop: spacing.lg,
    alignItems: "center",
    gap: spacing.md,
  },
  qrLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  primaryButton: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    paddingVertical: 13,
  },
  primaryButtonText: {
    color: "white",
    fontWeight: "900",
  },
  secondaryButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: 11,
    paddingHorizontal: 16,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontWeight: "900",
  },
  input: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    color: colors.textPrimary,
    paddingHorizontal: spacing.md,
    paddingVertical: 11,
    fontSize: 14,
  },
  textArea: {
    minHeight: 110,
  },
  disabled: {
    opacity: 0.6,
  },
  confirmBox: {
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: "#ECFDF5",
    borderWidth: 1,
    borderColor: "#A7F3D0",
  },
  confirmTitle: {
    marginTop: 8,
    fontSize: 18,
    fontWeight: "900",
    color: "#065F46",
  },
  confirmText: {
    marginTop: 6,
    color: "#047857",
    textAlign: "center",
    lineHeight: 20,
  },
  timelineRow: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  timelineIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  timelineTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  timelineDate: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "800",
    color: colors.textMuted,
  },
  timelineText: {
    marginTop: 6,
    color: colors.textSecondary,
    lineHeight: 20,
  },
  aboutCard: {
    padding: spacing.lg,
    borderRadius: radius.xl,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.xl,
  },
  aboutTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  aboutText: {
    marginTop: 6,
    color: colors.textSecondary,
    lineHeight: 20,
  },
});
