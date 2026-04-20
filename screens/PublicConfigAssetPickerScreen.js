import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { useAssets } from "../hooks/useAssets";

function firstNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function formatAssetSubtitle(asset) {
  return firstNonEmpty(
    asset.location,
    asset.address,
    asset.city_state_zip,
    asset.notes
  );
}

export default function PublicConfigAssetPickerScreen({ navigation }) {

  const {
  assets: homes = [],
  loading: loadingHomes,
    } = useAssets("home");

    const {
    assets: vehicles = [],
    loading: loadingVehicles,
    } = useAssets("vehicle");

    const {
    assets: boats = [],
    loading: loadingBoats,
    } = useAssets("boat");

    const isLoading = loadingHomes || loadingVehicles || loadingBoats;

    const allAssets = [
    ...homes,
    ...vehicles,
    ...boats,
    ];

    function sortAssets(list) {
  return [...list].sort((a, b) => {
    const at = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bt = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bt - at;
  });
}

const sortedAssets = sortAssets(allAssets);

const handleSelectAsset = (asset) => {
  navigation.navigate("PublicConfig", {
    assetId: asset.id,
    assetName: asset.name || "Asset",
  });
};

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            activeOpacity={0.8}
          >
            <Ionicons
              name="chevron-back-outline"
              size={22}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Select asset</Text>
            <Text style={styles.subtitle}>
              Choose which asset to configure for public view and actions.
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Your assets</Text>

          <View style={styles.card}>
            {isLoading ? (
              <View style={styles.loadingWrap}>
                <ActivityIndicator />
                <Text style={styles.loadingText}>Loading assets…</Text>
              </View>
            ) : sortedAssets.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyTitle}>No assets found</Text>
                <Text style={styles.emptyText}>
                  Add an asset first, then come back here to configure its public behavior.
                </Text>
              </View>
            ) : (
              sortedAssets.map((asset, index) => {
                const subtitle = formatAssetSubtitle(asset);

                return (
                  <React.Fragment key={asset.id}>
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => handleSelectAsset(asset)}
                      activeOpacity={0.85}
                    >
                      <View style={styles.rowIcon}>
                        <Ionicons
                          name="home-outline"
                          size={18}
                          color={colors.textPrimary}
                        />
                      </View>

                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {asset.name || "Untitled asset"}
                        </Text>
                        {!!subtitle && (
                          <Text style={styles.rowSubtitle} numberOfLines={1}>
                            {subtitle}
                          </Text>
                        )}
                      </View>

                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>

                    {index < sortedAssets.length - 1 ? <View style={styles.divider} /> : null}
                  </React.Fragment>
                );
              })
            )}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg || colors.background || "#F5F6F8",
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: spacing.xl,
    maxWidth: 920,
    alignSelf: "center",
    width: "100%",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  title: {
    ...(typography?.title || {}),
    fontSize: typography?.title?.fontSize ?? 22,
    fontWeight: typography?.title?.fontWeight ?? "700",
    color: colors.textPrimary,
  },
  subtitle: {
    ...(typography?.subtitle || {}),
    fontSize: typography?.subtitle?.fontSize ?? 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  section: {
    marginTop: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    ...(shadows?.subtle || {}),
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
    backgroundColor: colors.surfaceSubtle,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  rowSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle || "#E5E7EB",
    marginLeft: 48,
  },
  loadingWrap: {
    paddingVertical: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 12,
    color: colors.textMuted,
  },
  emptyWrap: {
    paddingVertical: 24,
    paddingHorizontal: 8,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  emptyText: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textMuted,
  },
});