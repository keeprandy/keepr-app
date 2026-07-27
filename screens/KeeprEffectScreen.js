import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Clipboard from "expo-clipboard";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";

import {
  fetchMyKeeprEffect,
  DEFAULT_KEEPR_EFFECT_RECENT_WINDOW,
  normalizeKeeprEffectRecentWindow,
  trackMemberInviteShareInitiated,
} from "../lib/keeprEffect";
import { buildUserInviteUrlWithChannel } from "../lib/inviteLinks";
import { createShareAction } from "../lib/shareActions";
import { supabase } from "../lib/supabaseClient";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

const CHANNEL_LABELS = [
  { channel: "text", label: "Text", icon: "chatbubble-ellipses-outline", dbChannel: "sms" },
  { channel: "email", label: "Email", icon: "mail-outline", dbChannel: "email" },
  { channel: "facebook", label: "Facebook", icon: "logo-facebook" },
  { channel: "linkedin", label: "LinkedIn", icon: "logo-linkedin" },
];

const RECENT_WINDOW_STORAGE_KEY = "keepr_effect_recent_window";
const RECENT_WINDOW_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
];

async function readRecentWindowPreference() {
  try {
    return normalizeKeeprEffectRecentWindow(await AsyncStorage.getItem(RECENT_WINDOW_STORAGE_KEY));
  } catch {}
  return DEFAULT_KEEPR_EFFECT_RECENT_WINDOW;
}

async function writeRecentWindowPreference(value) {
  try {
    await AsyncStorage.setItem(RECENT_WINDOW_STORAGE_KEY, value);
  } catch {}
}

function formatCount(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "K";
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0].slice(0, 1)}${parts[1].slice(0, 1)}`.toUpperCase();
}

function StatCard({ icon, label, value, tone = colors.primary }) {
  return (
    <View style={styles.statCard}>
      <View style={[styles.statIcon, { backgroundColor: `${tone}12` }]}>
        <Ionicons name={icon} size={22} color={tone} />
      </View>
      <Text style={styles.statValue}>{formatCount(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

export default function KeeprEffectScreen({ navigation }) {
  const [effect, setEffect] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [showQr, setShowQr] = useState(false);
  const [copied, setCopied] = useState(false);
  const [recentWindow, setRecentWindow] = useState(DEFAULT_KEEPR_EFFECT_RECENT_WINDOW);
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);
  const recentWindowRef = useRef(DEFAULT_KEEPR_EFFECT_RECENT_WINDOW);

  const loadEffect = useCallback(async ({ refresh = false, windowValue = DEFAULT_KEEPR_EFFECT_RECENT_WINDOW } = {}) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError("");

    try {
      const next = await fetchMyKeeprEffect({ recentWindow: windowValue });
      setEffect(next);
    } catch (e) {
      setError(e?.message || "Could not load your Keepr Effect.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const savedWindow = await readRecentWindowPreference();
      if (!active) return;
      recentWindowRef.current = savedWindow;
      setRecentWindow(savedWindow);
      setPreferenceLoaded(true);
    })();
    return () => {
      active = false;
    };
  }, []);

  const selectRecentWindow = useCallback((value) => {
    const next = normalizeKeeprEffectRecentWindow(value);
    if (next === recentWindowRef.current) return;
    recentWindowRef.current = next;
    setRecentWindow(next);
    writeRecentWindowPreference(next);
    if (preferenceLoaded) {
      loadEffect({ refresh: true, windowValue: next });
    }
  }, [loadEffect, preferenceLoaded]);

  useFocusEffect(
    useCallback(() => {
      if (!preferenceLoaded) return undefined;
      loadEffect({ windowValue: recentWindowRef.current });
      return undefined;
    }, [loadEffect, preferenceLoaded])
  );

  const inviteUrl = effect?.inviteUrl || "";
  const sourceSlug = effect?.sourceSlug || "";
  const activationSourceId = effect?.activationSourceId || null;

  const shareMessage = useMemo(() => {
    return `I'm a Keepr. Become one.\n\n${inviteUrl}`;
  }, [inviteUrl]);

  const getChannelInviteUrl = useCallback((channel) => {
    if (!sourceSlug) return inviteUrl;
    return buildUserInviteUrlWithChannel({ sourceSlug, channel });
  }, [inviteUrl, sourceSlug]);

  const recordShare = async (channel, dbChannel = channel) => {
    let action = null;
    try {
      if (["copy_link", "qr", "native_share", "email", "sms", "facebook", "linkedin"].includes(dbChannel)) {
        action = await createShareAction({
          supabase,
          sharedObjectType: "keepr",
          intendedAction: "signup",
          channel: dbChannel,
        });
      }
    } catch (e) {
      console.log("Keepr Effect share action failed:", e?.message || e);
    }

    trackMemberInviteShareInitiated({
      sourceSlug,
      activationSourceId: action?.activationSourceId || activationSourceId,
      channel,
    });

    return action;
  };

  const copyLink = async () => {
    if (!inviteUrl) return;
    await recordShare("copy_link");
    await Clipboard.setStringAsync(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    loadEffect({ refresh: true, windowValue: recentWindow });
  };

  const shareNative = async () => {
    if (!inviteUrl) return;
    await recordShare("native_share");
    const outboundUrl = getChannelInviteUrl("native_share");
    await Share.share({ message: `I'm a Keepr. Become one.\n\n${outboundUrl}` });
    loadEffect({ refresh: true, windowValue: recentWindow });
  };

  const toggleQr = async () => {
    const next = !showQr;
    setShowQr(next);
    if (next) {
      await recordShare("qr");
      loadEffect({ refresh: true, windowValue: recentWindow });
    }
  };

  const openChannel = async ({ channel, dbChannel }) => {
    if (!inviteUrl) return;
    await recordShare(channel, dbChannel);
    const outboundUrl = getChannelInviteUrl(channel);

    const encodedUrl = encodeURIComponent(outboundUrl);
    const encodedMessage = encodeURIComponent(`I'm a Keepr. Become one.\n\n${outboundUrl}`);
    const subject = encodeURIComponent("Join me on Keepr");

    if (channel === "email") {
      Linking.openURL(`mailto:?subject=${subject}&body=${encodedMessage}`);
    } else if (channel === "text") {
      Linking.openURL(`sms:?&body=${encodedMessage}`);
    } else if (channel === "facebook" && Platform.OS === "web") {
      window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`, "_blank", "noopener,noreferrer");
    } else if (channel === "linkedin" && Platform.OS === "web") {
      window.open(`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`, "_blank", "noopener,noreferrer");
    } else {
      Share.share({ message: `I'm a Keepr. Become one.\n\n${outboundUrl}` });
    }

    loadEffect({ refresh: true, windowValue: recentWindow });
  };

  const recentImpact = effect?.recentImpact || [];
  const shareCounts = effect?.sharesByChannel || {};
  const conversionCounts = effect?.conversionsByChannel || {};

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadEffect({ refresh: true, windowValue: recentWindow })} />}
      >
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="chevron-back" size={18} color={colors.textSecondary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Keepr Effect</Text>
            <Text style={styles.title}>Your Keepr Effect</Text>
            <Text style={styles.subtitle}>The ownership stories created through your invitation.</Text>
          </View>
          <View style={styles.headerMark}>
            <Ionicons name="sparkles-outline" size={26} color={colors.primary} />
          </View>
        </View>

        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Loading your impact...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Ionicons name="warning-outline" size={22} color={colors.danger} />
            <Text style={styles.stateText}>{error}</Text>
            <TouchableOpacity style={styles.smallButton} onPress={() => loadEffect({ windowValue: recentWindow })}>
              <Text style={styles.smallButtonText}>Try again</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.panel}>
              <View style={styles.statsGrid}>
                <StatCard icon="people-outline" label="Verified Keeprs" value={effect.verifiedKeeprs} />
                <StatCard icon="cube-outline" label="Assets Created" value={effect.assetsCreated} tone="#4F46E5" />
                <StatCard icon="shield-checkmark-outline" label="Proof Preserved" value={effect.proofItemsAdded} tone="#059669" />
                <StatCard icon="git-network-outline" label="Downstream Keeprs" value={effect.downstreamKeeprs} tone="#DB2777" />
              </View>

              <View style={styles.secondaryStats}>
                <Text style={styles.secondaryText}>{formatCount(effect.inviteVisits)} invite visits</Text>
                <Text style={styles.dot}>•</Text>
                <Text style={styles.secondaryText}>{formatCount(effect.activatedKeeprs)} activated Keeprs</Text>
              </View>
            </View>

            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelTitle}>Share Keepr</Text>
                  <Text style={styles.panelSub}>Your personal invite slug</Text>
                </View>
                <TouchableOpacity style={styles.iconButton} onPress={toggleQr} accessibilityRole="button" accessibilityLabel="Show QR code">
                  <Ionicons name={showQr ? "qr-code" : "qr-code-outline"} size={20} color={colors.primary} />
                </TouchableOpacity>
              </View>

              {sourceSlug ? (
                <View style={styles.linkBox}>
                  <Text style={styles.linkText} numberOfLines={1}>{inviteUrl}</Text>
                  <TouchableOpacity onPress={copyLink} accessibilityRole="button" accessibilityLabel="Copy invite link">
                    <Ionicons name="copy-outline" size={20} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTitle}>Your invite link is getting ready.</Text>
                  <Text style={styles.emptyText}>Open Share Keepr once to create your durable member source.</Text>
                </View>
              )}

              {showQr && inviteUrl ? (
                <View style={styles.qrBox}>
                  <QRCode value={inviteUrl} size={168} />
                </View>
              ) : null}

              <View style={styles.actionRow}>
                <TouchableOpacity style={styles.primaryButton} onPress={shareNative} disabled={!inviteUrl}>
                  <Ionicons name="share-social-outline" size={18} color={colors.onPrimary} />
                  <Text style={styles.primaryButtonText}>Share Keepr</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.secondaryButton} onPress={copyLink} disabled={!inviteUrl}>
                  <Text style={styles.secondaryButtonText}>{copied ? "Copied" : "Copy link"}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.channelGrid}>
                {CHANNEL_LABELS.map((item) => (
                  <TouchableOpacity
                    key={item.channel}
                    style={styles.channelButton}
                    onPress={() => openChannel(item)}
                    disabled={!inviteUrl}
                  >
                    <Ionicons name={item.icon} size={17} color={colors.primary} />
                    <Text style={styles.channelText}>{item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.shareCounts}>
                {["qr", "copy_link", "native_share", "email", "text", "facebook", "linkedin"].map((channel) => (
                  <Text key={channel} style={styles.shareCountText}>
                    {channel.replace("_", " ")}: {formatCount(shareCounts[channel] || 0)}
                    {conversionCounts[channel] ? ` / ${formatCount(conversionCounts[channel])} joined` : ""}
                  </Text>
                ))}
              </View>
            </View>

            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelTitle}>Recent impact</Text>
                  <Text style={styles.panelSub}>Activity from your invitation</Text>
                </View>
              </View>

              <View style={styles.segmentedControl}>
                {RECENT_WINDOW_OPTIONS.map((option) => {
                  const active = recentWindow === option.value;
                  return (
                    <TouchableOpacity
                      key={option.value}
                      style={[styles.segmentButton, active && styles.segmentButtonActive]}
                      onPress={() => selectRecentWindow(option.value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                    >
                      <Text style={[styles.segmentText, active && styles.segmentTextActive]}>
                        {option.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {recentImpact.length ? (
                recentImpact.map((item, index) => (
                  <View key={`${item.event_type}-${item.happened_at}-${index}`} style={styles.impactRow}>
                    <View style={styles.impactAvatar}>
                      {item.actor_photo_url ? (
                        <Image source={{ uri: item.actor_photo_url }} style={styles.impactAvatarImage} />
                      ) : (
                        <Text style={styles.impactAvatarText}>{getInitials(item.actor_display_name)}</Text>
                      )}
                    </View>
                    <View style={styles.impactIcon}>
                      <Ionicons
                        name={item.event_type === "proof_added" ? "shield-checkmark-outline" : item.event_type === "asset_created" ? "cube-outline" : "person-add-outline"}
                        size={18}
                        color={colors.primary}
                      />
                    </View>
                    <View style={styles.impactTextWrap}>
                      <Text style={styles.impactLabel}>{item.label}</Text>
                      <Text style={styles.impactTime}>{formatTime(item.happened_at)}</Text>
                    </View>
                  </View>
                ))
              ) : (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTitle}>No impact yet.</Text>
                  <Text style={styles.emptyText}>Share your invite to start seeing the Keepr Effect build here.</Text>
                </View>
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    width: "100%",
    maxWidth: 980,
    alignSelf: "center",
    padding: spacing.xl,
    paddingBottom: 48,
    gap: spacing.lg,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  backText: {
    color: colors.textSecondary,
    fontWeight: "700",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.lg,
  },
  kicker: {
    ...typography.sectionLabel,
    color: colors.primary,
  },
  title: {
    fontSize: 30,
    fontWeight: "800",
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: spacing.xs,
  },
  headerMark: {
    width: 52,
    height: 52,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EAF2FF",
  },
  panel: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    ...shadows.subtle,
  },
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  statCard: {
    flexGrow: 1,
    flexBasis: 180,
    minWidth: 150,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  statIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  statValue: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  statLabel: {
    color: colors.textMuted,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  secondaryStats: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  secondaryText: {
    color: colors.textSecondary,
    fontWeight: "700",
  },
  dot: {
    color: colors.textMuted,
  },
  panelHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  panelTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  panelSub: {
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  linkBox: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    backgroundColor: colors.surfaceSubtle,
  },
  linkText: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  qrBox: {
    alignSelf: "center",
    padding: spacing.lg,
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.brandWhite,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  primaryButton: {
    flexGrow: 1,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 48,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surface,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontWeight: "800",
  },
  channelGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  channelButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  channelText: {
    color: colors.textSecondary,
    fontWeight: "700",
  },
  shareCounts: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    marginTop: spacing.md,
  },
  shareCountText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  segmentedControl: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  segmentButton: {
    minHeight: 38,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
  segmentButtonActive: {
    borderColor: colors.primary,
    backgroundColor: "#EAF2FF",
  },
  segmentText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: colors.primary,
  },
  impactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  impactAvatar: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  impactAvatarImage: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
  impactAvatarText: {
    color: colors.primary,
    fontWeight: "800",
    fontSize: 13,
  },
  impactIcon: {
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: "#EAF2FF",
    alignItems: "center",
    justifyContent: "center",
  },
  impactTextWrap: {
    flex: 1,
  },
  impactLabel: {
    color: colors.textPrimary,
    fontWeight: "700",
  },
  impactTime: {
    color: colors.textMuted,
    marginTop: 2,
  },
  stateCard: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
  },
  stateText: {
    color: colors.textSecondary,
    textAlign: "center",
  },
  smallButton: {
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  smallButtonText: {
    color: colors.onPrimary,
    fontWeight: "800",
  },
  emptyBox: {
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.lg,
    backgroundColor: colors.surfaceSubtle,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontWeight: "800",
  },
  emptyText: {
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
});
