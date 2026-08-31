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

import { createKeeprOrganization, searchKeeprAdminOrgs } from "../lib/keeprAdminApi";
import { colors, radius, shadows, spacing } from "../styles/theme";

const ORG_PRESETS = [
  { key: "oem", label: "OEM" },
  { key: "dealer", label: "Dealer" },
  { key: "member_team", label: "Member Team" },
  { key: "parent_company", label: "Parent Company" },
];

const ORG_FILTERS = [
  { key: "", label: "All" },
  ...ORG_PRESETS,
];

function orgTypeForDisplay(org) {
  return org.organization_type || org.org_type || org.workspace_type || "org";
}

function orgTypeLabel(value) {
  switch (value) {
    case "oem":
    case "manufacturer":
      return "OEM";
    case "dealer":
    case "keeprdealer":
      return "Dealer";
    case "member_team":
      return "Member Team";
    case "parent_company":
      return "Parent Company";
    default:
      return "Organization";
  }
}

function orgIconName(org) {
  const type = orgTypeForDisplay(org);
  if (type === "dealer" || type === "keeprdealer") return "storefront-outline";
  if (type === "member_team") return "people-outline";
  if (type === "parent_company") return "git-network-outline";
  return "business-outline";
}

export default function KeeprAdminHomeScreen({ navigation }) {
  const [query, setQuery] = useState("");
  const [orgTypeFilter, setOrgTypeFilter] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [createPreset, setCreatePreset] = useState("oem");
  const [createOrgName, setCreateOrgName] = useState("");
  const [createAdminEmail, setCreateAdminEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createWebsite, setCreateWebsite] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [createError, setCreateError] = useState(null);

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await searchKeeprAdminOrgs(query, { organizationType: orgTypeFilter });
      setResults(data?.organizations || []);
    } catch (err) {
      setError(err?.message || "Could not search organizations.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [orgTypeFilter, query]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  const runCreateOrganization = useCallback(async () => {
    setCreatingOrg(true);
    setCreateError(null);
    try {
      const created = await createKeeprOrganization({
        organizationName: createOrgName,
        preset: createPreset,
        adminEmail: createAdminEmail,
        password: createPassword,
        brand: {
          display_name: createOrgName,
          website: createWebsite,
        },
      });
      const orgId = created?.organization_id || created?.organization?.id;
      setQuery(createOrgName);
      await runSearch();
      setCreateOrgName("");
      setCreateAdminEmail("");
      setCreatePassword("");
      setCreateWebsite("");
      setOrgTypeFilter(createPreset);
      if (orgId) {
        navigation.navigate("KeeprAdminOrgDetail", { organizationId: orgId });
      }
    } catch (err) {
      setCreateError(err?.message || "Could not create organization.");
    } finally {
      setCreatingOrg(false);
    }
  }, [
    createAdminEmail,
    createOrgName,
    createPassword,
    createPreset,
    createWebsite,
    navigation,
    runSearch,
  ]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View>
          <Text style={styles.eyebrow}>Keepr Admin</Text>
          <Text style={styles.title}>Organizations</Text>
        </View>
        <View style={styles.badge}>
          <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
          <Text style={styles.badgeText}>Internal</Text>
        </View>
      </View>

      <View style={styles.createPanel}>
        <View style={styles.sectionHeader}>
          <View>
            <Text style={styles.sectionEyebrow}>Provision</Text>
            <Text style={styles.sectionTitle}>Create Organization</Text>
          </View>
        </View>
        <View style={styles.presetRow}>
          {ORG_PRESETS.map((preset) => {
            const selected = preset.key === createPreset;
            return (
              <TouchableOpacity
                key={preset.key}
                style={[styles.presetButton, selected && styles.presetButtonActive]}
                onPress={() => setCreatePreset(preset.key)}
                disabled={creatingOrg}
              >
                <Text style={[styles.presetButtonText, selected && styles.presetButtonTextActive]}>{preset.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <View style={styles.createGrid}>
          <TextInput
            value={createOrgName}
            onChangeText={setCreateOrgName}
            placeholder="Organization name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
          />
          <TextInput
            value={createAdminEmail}
            onChangeText={setCreateAdminEmail}
            placeholder="Primary admin email"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="email-address"
            style={styles.input}
          />
          <TextInput
            value={createPassword}
            onChangeText={setCreatePassword}
            placeholder="Temporary password or blank to invite"
            placeholderTextColor={colors.textMuted}
            secureTextEntry
            style={styles.input}
          />
          <TextInput
            value={createWebsite}
            onChangeText={setCreateWebsite}
            placeholder="Website"
            placeholderTextColor={colors.textMuted}
            autoCapitalize="none"
            keyboardType="url"
            style={styles.input}
          />
        </View>
        {createError ? <Text style={styles.errorText}>{createError}</Text> : null}
        <TouchableOpacity
          style={[styles.createButton, creatingOrg && styles.disabledButton]}
          onPress={runCreateOrganization}
          disabled={creatingOrg || !createOrgName.trim() || !createAdminEmail.trim()}
        >
          {creatingOrg ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <>
              <Ionicons name="add-circle-outline" size={18} color="#fff" />
              <Text style={styles.createButtonText}>Create Organization</Text>
            </>
          )}
        </TouchableOpacity>
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

      <View style={styles.filterRow}>
        {ORG_FILTERS.map((filter) => {
          const selected = filter.key === orgTypeFilter;
          return (
            <TouchableOpacity
              key={filter.key || "all"}
              style={[styles.filterButton, selected && styles.filterButtonActive]}
              onPress={() => setOrgTypeFilter(filter.key)}
              disabled={loading}
            >
              <Text style={[styles.filterButtonText, selected && styles.filterButtonTextActive]}>
                {filter.label}
              </Text>
            </TouchableOpacity>
          );
        })}
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
              <Ionicons name={orgIconName(org)} size={20} color={colors.primary} />
            </View>
            <View style={styles.orgBody}>
              <View style={styles.orgTitleRow}>
                <Text style={styles.orgName}>{org.display_name || org.name || "Organization"}</Text>
                <View style={styles.orgTypeBadge}>
                  <Text style={styles.orgTypeBadgeText}>{orgTypeLabel(orgTypeForDisplay(org))}</Text>
                </View>
              </View>
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
            <Text style={styles.emptyText}>Search an existing canonical org or create one above.</Text>
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
  createPanel: {
    gap: spacing.sm,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#fff",
    ...shadows.card,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionEyebrow: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  presetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  presetButton: {
    minHeight: 38,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
  },
  presetButtonActive: {
    borderColor: colors.primary,
    backgroundColor: "#eef5ff",
  },
  presetButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "900",
  },
  presetButtonTextActive: {
    color: colors.primary,
  },
  createGrid: {
    gap: spacing.sm,
  },
  createButton: {
    minHeight: 46,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.xs,
    backgroundColor: colors.primary,
  },
  disabledButton: {
    opacity: 0.62,
  },
  createButtonText: {
    color: "#fff",
    fontWeight: "900",
  },
  searchRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  filterRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  filterButton: {
    minHeight: 34,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  filterButtonActive: {
    borderColor: colors.primary,
    backgroundColor: "#eef5ff",
  },
  filterButtonText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  filterButtonTextActive: {
    color: colors.primary,
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
  orgTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    flexWrap: "wrap",
  },
  orgName: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "900",
  },
  orgTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: "#f1f5f9",
    borderWidth: 1,
    borderColor: colors.border,
  },
  orgTypeBadgeText: {
    color: colors.textSecondary,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
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
