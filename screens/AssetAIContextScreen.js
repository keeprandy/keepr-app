import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import {
  AI_CONTEXT_VALUES,
  listAssetAIContextSources,
} from "../lib/attachmentsApi";
import { colors, radius, spacing } from "../styles/theme";
import { layoutStyles } from "../styles/layout";

function titleForSource(source) {
  return source?.title || source?.file_name || "Attachment";
}

function roleLabel(role) {
  return String(role || "Other").trim() || "Other";
}

function groupSources(sources, type) {
  return (sources || []).filter((source) => source.ai_context === type);
}

export default function AssetAIContextScreen({ navigation, route }) {
  const assetId = route?.params?.assetId || route?.params?.boatId || null;
  const assetName = route?.params?.assetName || route?.params?.boatName || "Asset";
  const assetKind = route?.params?.assetKind || route?.params?.assetType || "asset";

  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const loadSources = useCallback(async () => {
    if (!assetId) {
      setSources([]);
      setError("Missing asset.");
      setLoading(false);
      return;
    }

    setError("");
    const rows = await listAssetAIContextSources(assetId, { assetKind });
    setSources(rows);
  }, [assetId, assetKind]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        setLoading(true);
        await loadSources();
      } catch (e) {
        if (!cancelled) setError(e?.message || "Could not load AI context.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [loadSources]);

  const refresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await loadSources();
    } catch (e) {
      setError(e?.message || "Could not refresh AI context.");
    } finally {
      setRefreshing(false);
    }
  }, [loadSources]);

  const primary = useMemo(() => groupSources(sources, AI_CONTEXT_VALUES.PRIMARY), [sources]);
  const supporting = useMemo(() => groupSources(sources, AI_CONTEXT_VALUES.SUPPORTING), [sources]);
  const systemsCovered = useMemo(() => {
    const ids = new Set();
    (sources || []).forEach((source) => {
      (source.placements || []).forEach((placement) => {
        if (placement?.target_type === "system" && placement?.target_id) ids.add(placement.target_id);
      });
    });
    return ids.size;
  }, [sources]);

  const openSource = useCallback(
    (source) => {
      if (!source?.attachment_id) return;
      navigation.navigate("ProofBuilder", {
        assetId,
        assetName,
        attachmentId: source.attachment_id,
        role: source.role,
        returnRoute: "AssetAIContext",
        returnParams: { assetId, assetName, assetKind },
      });
    },
    [assetId, assetKind, assetName, navigation]
  );

  const goBack = useCallback(() => {
    if (navigation.canGoBack?.()) navigation.goBack();
    else navigation.navigate("Dashboard");
  }, [navigation]);

  const SourceGroup = ({ title, empty, items }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>{empty}</Text>
      ) : (
        items.map((source) => (
          <TouchableOpacity
            key={source.attachment_id}
            style={styles.sourceRow}
            onPress={() => openSource(source)}
            activeOpacity={0.85}
          >
            <View style={styles.sourceIcon}>
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.sourceType} numberOfLines={1}>
                {source.ai_context_label}
              </Text>
              <Text style={styles.sourceTitle} numberOfLines={2}>
                {titleForSource(source)}
              </Text>
              <Text style={styles.sourceMeta} numberOfLines={2}>
                {roleLabel(source.role)} · {source.scope_label}
              </Text>
              <Text style={styles.sourceAttribution} numberOfLines={2}>
                Provided by {source.contributor}
              </Text>
              <Text style={styles.sourcePrivacy} numberOfLines={1}>
                Privacy: {source.privacy_label}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ))
      )}
    </View>
  );

  return (
    <SafeAreaView style={[layoutStyles.screen, styles.screen]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={goBack}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>AI Context</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            Trusted sources that help AI understand this boat.
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <Text style={styles.assetName} numberOfLines={1}>{assetName}</Text>

        <View style={styles.summaryRow}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>{primary.length}</Text>
            <Text style={styles.summaryLabel}>Primary Sources</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>{supporting.length}</Text>
            <Text style={styles.summaryLabel}>Supporting Sources</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryNumber}>{systemsCovered}</Text>
            <Text style={styles.summaryLabel}>Systems Covered</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.emptyText}>Loading sources...</Text>
          </View>
        ) : error ? (
          <View style={styles.section}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <>
            <SourceGroup
              title="Primary Sources"
              items={primary}
              empty="No primary sources designated yet."
            />
            <SourceGroup
              title="Supporting Sources"
              items={supporting}
              empty="Service invoices, equipment photos, records, etc., when designated."
            />
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: 10,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  title: { fontSize: 22, fontWeight: "900", color: colors.textPrimary },
  subtitle: { marginTop: 2, fontSize: 13, color: colors.textSecondary },
  body: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
  assetName: { fontSize: 13, fontWeight: "800", color: colors.textSecondary },
  summaryRow: {
    flexDirection: "row",
    gap: 8,
  },
  summaryItem: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: 10,
    minHeight: 74,
  },
  summaryNumber: { fontSize: 20, fontWeight: "900", color: colors.textPrimary },
  summaryLabel: { marginTop: 4, fontSize: 11, fontWeight: "800", color: colors.textSecondary },
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  sourceRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingTop: spacing.md,
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sourceIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  sourceTitle: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  sourceType: { marginBottom: 3, fontSize: 12, fontWeight: "900", color: colors.primary },
  sourceMeta: { marginTop: 3, fontSize: 12, fontWeight: "800", color: colors.textSecondary },
  sourceAttribution: { marginTop: 3, fontSize: 12, color: colors.textSecondary },
  sourcePrivacy: { marginTop: 3, fontSize: 11, color: colors.textMuted },
  emptyText: { marginTop: spacing.sm, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  loading: { alignItems: "center", paddingVertical: spacing.xl },
  errorText: { color: colors.danger || "red", fontWeight: "800" },
});
