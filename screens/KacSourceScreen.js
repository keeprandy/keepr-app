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

import { fetchSourceManifestByKac } from "../lib/sourceManifestApi";
import { colors, radius, spacing } from "../styles/theme";
import { layoutStyles } from "../styles/layout";

function getKacFromUrlFallback() {
  try {
    if (typeof window === "undefined") return null;
    const url = new URL(window.location.href);
    const pathMatch = url.pathname.match(/^\/k\/([^/]+)\/source\/?$/i);
    return pathMatch?.[1] ? decodeURIComponent(pathMatch[1]).trim() : null;
  } catch {
    return null;
  }
}

function sourceGroups(sources = []) {
  return {
    primary: sources.filter((source) => source.ai_context === "primary"),
    supporting: sources.filter((source) => source.ai_context === "supporting"),
  };
}

function compact(values) {
  return values.map((value) => String(value || "").trim()).filter(Boolean).join(" · ");
}

export default function KacSourceScreen({ navigation, route }) {
  const kac = useMemo(
    () =>
      route?.params?.kac ||
      route?.params?.kacId ||
      route?.params?.kac_id ||
      getKacFromUrlFallback() ||
      null,
    [route?.params?.kac, route?.params?.kacId, route?.params?.kac_id]
  );

  const [manifest, setManifest] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!kac) {
      setError("Missing KAC.");
      setManifest(null);
      return;
    }
    setError("");
    const json = await fetchSourceManifestByKac(kac);
    setManifest(json || null);
  }, [kac]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        await load();
      } catch (e) {
        if (!cancelled) setError(e?.message || "Could not load Source manifest.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      setRefreshing(true);
      await load();
    } catch (e) {
      setError(e?.message || "Could not refresh Source manifest.");
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const groups = useMemo(() => sourceGroups(manifest?.sources || []), [manifest?.sources]);
  const asset = manifest?.asset || {};

  const goBack = useCallback(() => {
    if (navigation.canGoBack?.()) navigation.goBack();
    else navigation.navigate("Dashboard");
  }, [navigation]);

  const SourceList = ({ title, empty, items }) => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {items.length === 0 ? (
        <Text style={styles.emptyText}>{empty}</Text>
      ) : (
        items.map((source) => (
          <View key={source.attachment_id} style={styles.sourceRow}>
            <View style={styles.sourceIcon}>
              <Ionicons name="document-text-outline" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.sourceTitle} numberOfLines={2}>{source.title}</Text>
              <Text style={styles.sourceMeta} numberOfLines={2}>
                {compact([source.role, source.scope, source.contributor])}
              </Text>
              <Text style={styles.sourcePrivacy} numberOfLines={1}>
                Privacy: {source.privacy}
              </Text>
              {source.url ? (
                <Text style={styles.sourcePrivacy} numberOfLines={1}>
                  URL authorized
                </Text>
              ) : null}
            </View>
          </View>
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
          <Text style={styles.title}>Keepr Source</Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {kac || "Source manifest"}
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator />
            <Text style={styles.emptyText}>Loading Source manifest...</Text>
          </View>
        ) : error ? (
          <View style={styles.section}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Asset Identity</Text>
              <Text style={styles.identityTitle} numberOfLines={2}>
                {asset.name || compact([asset.year, asset.make, asset.model]) || asset.kac}
              </Text>
              <Text style={styles.identityMeta}>
                {compact([asset.kac, asset.year, asset.make, asset.model])}
              </Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Systems</Text>
              {(manifest?.systems || []).length === 0 ? (
                <Text style={styles.emptyText}>No systems returned in this projection.</Text>
              ) : (
                (manifest?.systems || []).map((system) => (
                  <View key={system.id} style={styles.systemRow}>
                    <Text style={styles.systemName} numberOfLines={1}>{system.name}</Text>
                    <Text style={styles.systemMeta} numberOfLines={1}>
                      {compact([system.type, system.ksc_code, system.status])}
                    </Text>
                  </View>
                ))
              )}
            </View>

            <SourceList
              title="Primary Sources"
              items={groups.primary}
              empty="No primary sources returned in this projection."
            />
            <SourceList
              title="Supporting Sources"
              items={groups.supporting}
              empty="No supporting sources returned in this projection."
            />

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>JSON</Text>
              <Text style={styles.code}>{JSON.stringify(manifest, null, 2)}</Text>
            </View>
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
  section: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
  },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  identityTitle: { marginTop: spacing.sm, fontSize: 15, fontWeight: "900", color: colors.textPrimary },
  identityMeta: { marginTop: 4, fontSize: 12, color: colors.textSecondary },
  systemRow: { paddingTop: spacing.sm, marginTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  systemName: { fontSize: 14, fontWeight: "900", color: colors.textPrimary },
  systemMeta: { marginTop: 3, fontSize: 12, color: colors.textSecondary },
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
  sourceMeta: { marginTop: 3, fontSize: 12, fontWeight: "800", color: colors.textSecondary },
  sourcePrivacy: { marginTop: 3, fontSize: 11, color: colors.textMuted },
  emptyText: { marginTop: spacing.sm, fontSize: 13, color: colors.textSecondary, lineHeight: 18 },
  loading: { alignItems: "center", paddingVertical: spacing.xl },
  errorText: { color: colors.danger || "red", fontWeight: "800" },
  code: { marginTop: spacing.sm, fontSize: 11, lineHeight: 15, color: colors.textPrimary },
});
