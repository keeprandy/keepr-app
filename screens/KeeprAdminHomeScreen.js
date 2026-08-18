import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { searchKeeprAdminOrgs } from "../lib/keeprAdminApi";
import { colors, radius, shadows, spacing } from "../styles/theme";

export default function KeeprAdminHomeScreen({ navigation }) {
  const [query, setQuery] = useState("Wilson Marine");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await searchKeeprAdminOrgs(query);
      setResults(data?.organizations || []);
    } catch (err) {
      setError(err?.message || "Could not search organizations.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Keepr Admin</Text>
          <Text style={styles.title}>Org Activation</Text>
        </View>
        <View style={styles.badge}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
          <Text style={styles.badgeText}>Internal</Text>
        </View>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search canonical org, slug, domain, KPC"
          placeholderTextColor={colors.textMuted}
          style={styles.input}
          onSubmitEditing={runSearch}
        />
        <TouchableOpacity style={styles.searchButton} onPress={runSearch} disabled={loading}>
          {loading ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="search" size={18} color="#fff" />}
        </TouchableOpacity>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.list}>
        {results.map((org) => (
          <TouchableOpacity
            key={org.id}
            style={styles.orgCard}
            activeOpacity={0.86}
            onPress={() => navigation.navigate("KeeprAdminOrgDetail", { organizationId: org.id })}
          >
            <View style={styles.orgIcon}>
              <Ionicons name="business-outline" size={20} color={colors.primary} />
            </View>
            <View style={styles.orgBody}>
              <Text style={styles.orgName}>{org.display_name || org.name || "Organization"}</Text>
              <Text style={styles.orgMeta} numberOfLines={1}>
                {org.slug || "no slug"} · {org.workspace_type || "untyped"} · {org.status || "active"}
              </Text>
              <Text style={styles.orgMeta} numberOfLines={1}>
                Activation: {org.activation?.status || "not started"}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ))}
        {!loading && !results.length ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>No organizations found</Text>
            <Text style={styles.emptyText}>Search an existing canonical org. Admin V1 does not create orgs.</Text>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 28,
    fontWeight: "900",
  },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  badgeText: {
    color: colors.textPrimary,
    fontWeight: "800",
  },
  searchRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#fff",
    color: colors.textPrimary,
    fontWeight: "700",
  },
  searchButton: {
    width: 52,
    minHeight: 48,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  errorText: {
    color: colors.error || "#b91c1c",
    fontWeight: "700",
  },
  list: {
    gap: spacing.sm,
  },
  orgCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    ...shadows.card,
  },
  orgIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef5ff",
  },
  orgBody: {
    flex: 1,
  },
  orgName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "900",
  },
  orgMeta: {
    marginTop: 3,
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  empty: {
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#fff",
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontWeight: "900",
  },
  emptyText: {
    marginTop: 4,
    color: colors.textSecondary,
    fontWeight: "600",
  },
});
