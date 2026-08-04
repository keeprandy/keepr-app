import React from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing } from "../styles/theme";

function firstPresent(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

export function normalizeKeeprProContact(pro) {
  if (!pro) return null;
  const name = firstPresent(pro.name, pro.label, pro.company, pro.display_name);
  if (!name) return null;
  return {
    id: pro.id || pro.keepr_pro_id || pro.keeprProId || null,
    name,
    slug: firstPresent(pro.slug, pro.keepr_pro_slug, pro.profile_slug),
    category: firstPresent(pro.category, pro.specialty, pro.type),
    phone: firstPresent(pro.phone, pro.mobile, pro.phone_number),
    email: firstPresent(pro.email, pro.email_address),
    website: firstPresent(pro.website, pro.url),
    claimedState: firstPresent(pro.claimed_state, pro.claimedState),
    publishStatus: firstPresent(pro.publish_status, pro.publishStatus),
    raw: pro,
  };
}

export function getAssetKeeprProFromMetadata(asset) {
  const pros = getAssetKeeprProsFromMetadata(asset);
  if (pros.length) return pros[0];

  const meta = asset?.extra_metadata || asset?.metadata || {};
  const candidate =
    meta?.keeprPro ||
    meta?.keepr_pro ||
    meta?.assigned_keepr_pro ||
    meta?.asset_keepr_pro ||
    asset?.keepr_pro ||
    null;

  if (candidate && typeof candidate === "object") return normalizeKeeprProContact(candidate);

  const label =
    meta?.keepr_pro_label ||
    meta?.assigned_keepr_pro_label ||
    meta?.provider_label ||
    asset?.keepr_pro_label ||
    null;

  return label ? normalizeKeeprProContact({ name: label }) : null;
}

export function getAssetKeeprProsFromMetadata(asset) {
  const meta = asset?.metadata || asset?.extra_metadata || {};
  const standard = meta?.standard && typeof meta.standard === "object" ? meta.standard : {};
  const relationships =
    standard?.relationships && typeof standard.relationships === "object"
      ? standard.relationships
      : meta?.relationships && typeof meta.relationships === "object"
      ? meta.relationships
      : {};

  const assignments = Array.isArray(relationships?.keepr_pro_assignments)
    ? relationships.keepr_pro_assignments
    : Array.isArray(relationships?.keeprProAssignments)
    ? relationships.keeprProAssignments
    : [];

  const normalized = assignments
    .map((assignment) =>
      normalizeKeeprProContact({
        ...assignment,
        id: assignment?.id || assignment?.keepr_pro_id || assignment?.keeprProId,
        name: assignment?.name || assignment?.label,
      })
    )
    .filter(Boolean);

  if (normalized.length) return normalized;

  const legacy = getAssetKeeprProFromLegacyMetadata(asset);
  return legacy ? [legacy] : [];
}

function getAssetKeeprProFromLegacyMetadata(asset) {
  const meta = asset?.extra_metadata || asset?.metadata || {};
  const candidate =
    meta?.keeprPro ||
    meta?.keepr_pro ||
    meta?.assigned_keepr_pro ||
    meta?.asset_keepr_pro ||
    asset?.keepr_pro ||
    null;

  if (candidate && typeof candidate === "object") return normalizeKeeprProContact(candidate);

  const label =
    meta?.keepr_pro_label ||
    meta?.assigned_keepr_pro_label ||
    meta?.provider_label ||
    asset?.keepr_pro_label ||
    null;

  return label ? normalizeKeeprProContact({ name: label }) : null;
}

export default function KeeprProCommunicationCard({
  keeprPro,
  assignmentScope = "asset",
  assetName = "",
  systemName = "",
  relationshipLabel = "Your KeeprPro",
  onRequestService,
  onMessage,
  onViewKeeprPro,
  compact = false,
}) {
  const pro = normalizeKeeprProContact(keeprPro);
  if (!pro) return null;

  const contextLabel =
    assignmentScope === "system" && systemName
      ? `${systemName}${assetName ? ` on ${assetName}` : ""}`
      : assetName || systemName || "this asset";
  const canOpenDetail = !!onViewKeeprPro && !!pro.id;

  const openDetail = () => {
    if (!canOpenDetail) return;
    onViewKeeprPro(pro.raw || pro);
  };

  const openPhone = () => {
    if (!pro.phone) return;
    Linking.openURL(`tel:${pro.phone.replace(/[^\d+]/g, "")}`).catch(() => {});
  };

  const openEmail = () => {
    if (!pro.email) return;
    Linking.openURL(`mailto:${pro.email}`).catch(() => {});
  };

  return (
    <View style={[styles.card, compact && styles.compactCard]}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.iconWrap}
          onPress={openDetail}
          disabled={!canOpenDetail}
          activeOpacity={0.85}
        >
          <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{relationshipLabel || "Your KeeprPro"}</Text>
          <TouchableOpacity
            onPress={openDetail}
            disabled={!canOpenDetail}
            activeOpacity={0.85}
          >
            <Text style={[styles.name, canOpenDetail && styles.nameLink]} numberOfLines={1}>
              {pro.name}
            </Text>
          </TouchableOpacity>
          <Text style={styles.context} numberOfLines={2}>
            Supports {contextLabel}
          </Text>
        </View>
      </View>

      {!!pro.category && <Text style={styles.meta}>{pro.category}</Text>}

      <View style={styles.actionRow}>
        <TouchableOpacity
          style={[styles.action, !pro.phone && styles.disabledAction]}
          onPress={openPhone}
          disabled={!pro.phone}
        >
          <Ionicons name="call-outline" size={15} color={colors.textPrimary} />
          <Text style={styles.actionText}>Call</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.action, !onMessage && !pro.email && styles.disabledAction]}
          onPress={onMessage || openEmail}
          disabled={!onMessage && !pro.email}
        >
          <Ionicons
            name={onMessage ? "chatbubble-ellipses-outline" : "mail-outline"}
            size={15}
            color={colors.textPrimary}
          />
          <Text style={styles.actionText}>{onMessage ? "Message" : "Email"}</Text>
        </TouchableOpacity>

        <TouchableOpacity style={[styles.action, styles.primaryAction]} onPress={onRequestService}>
          <Ionicons name="construct-outline" size={15} color="#FFFFFF" />
          <Text style={[styles.actionText, styles.primaryActionText]}>Request Service</Text>
        </TouchableOpacity>
      </View>

      {onViewKeeprPro ? (
        <TouchableOpacity style={styles.viewLink} onPress={() => onViewKeeprPro(pro.raw || pro)}>
          <Text style={styles.viewLinkText}>View KeeprPro</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: radius.lg || 14,
    padding: spacing.md,
    backgroundColor: colors.surface || "#FFFFFF",
    marginTop: spacing.sm,
  },
  compactCard: {
    padding: spacing.sm,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EEF2FF",
    marginRight: spacing.sm,
  },
  kicker: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  name: {
    marginTop: 2,
    fontSize: 15,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  nameLink: {
    color: colors.primary,
  },
  context: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary || colors.textMuted,
  },
  meta: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textMuted,
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: spacing.md,
  },
  action: {
    minHeight: 34,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 6,
    backgroundColor: "#FFFFFF",
  },
  disabledAction: {
    opacity: 0.45,
  },
  actionText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  primaryAction: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  primaryActionText: {
    color: "#FFFFFF",
  },
  viewLink: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  viewLinkText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.primary,
    marginRight: 4,
  },
});
