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
    category: firstPresent(pro.category, pro.specialty, pro.type),
    phone: firstPresent(pro.phone, pro.mobile, pro.phone_number),
    email: firstPresent(pro.email, pro.email_address),
    website: firstPresent(pro.website, pro.url),
    raw: pro,
  };
}

export function getAssetKeeprProFromMetadata(asset) {
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
  onRequestService,
  onViewKeeprPro,
  compact = false,
}) {
  const pro = normalizeKeeprProContact(keeprPro);
  if (!pro) return null;

  const contextLabel =
    assignmentScope === "system" && systemName
      ? `${systemName}${assetName ? ` on ${assetName}` : ""}`
      : assetName || systemName || "this asset";

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
        <View style={styles.iconWrap}>
          <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>Your KeeprPro</Text>
          <Text style={styles.name} numberOfLines={1}>
            {pro.name}
          </Text>
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
          style={[styles.action, !pro.email && styles.disabledAction]}
          onPress={openEmail}
          disabled={!pro.email}
        >
          <Ionicons name="mail-outline" size={15} color={colors.textPrimary} />
          <Text style={styles.actionText}>Email</Text>
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
