import { Ionicons } from "@expo/vector-icons";
import { CommonActions } from "@react-navigation/native";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  activateKeeprSpaceOrg,
  getKeeprAdminOrgActivation,
  searchKeeprAdminOperatorUsers,
} from "../lib/keeprAdminApi";
import { useWorkspace } from "../context/WorkspaceContext";
import { colors, radius, shadows, spacing } from "../styles/theme";

const WORKSPACE_TYPES = ["keeprpro", "keeprdealer", "keeproem"];
const MEMBER_ROLES = ["admin", "manager", "member", "provider_member"];

export default function KeeprAdminOrgDetailScreen({ navigation, route }) {
  const { refreshWorkspaces, setCurrentWorkspaceId } = useWorkspace();
  const organizationId = route?.params?.organizationId;
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [operatorQuery, setOperatorQuery] = useState("");
  const [operatorResults, setOperatorResults] = useState([]);
  const [selectedOperator, setSelectedOperator] = useState(null);
  const [workspaceType, setWorkspaceType] = useState("keeprpro");
  const [memberRole, setMemberRole] = useState("admin");

  const org = detail?.organization || {};
  const activation = detail?.activation;
  const workspace = detail?.workspace_preview;
  const operators = detail?.operators || [];
  const workspaceId = workspace?.workspace_id || (organizationId ? `org:${organizationId}` : null);

  const title = useMemo(() => {
    return org.display_name || org.name || detail?.keepr_pro?.display_name || "Organization";
  }, [detail?.keepr_pro?.display_name, org.display_name, org.name]);

  const load = useCallback(async () => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const next = await getKeeprAdminOrgActivation(organizationId);
      setDetail(next);
      const nextWorkspaceType =
        next?.activation?.workspace_type ||
        next?.workspace_preview?.workspace_type ||
        "keeprpro";
      setWorkspaceType(WORKSPACE_TYPES.includes(nextWorkspaceType) ? nextWorkspaceType : "keeprpro");
    } catch (err) {
      setError(err?.message || "Could not load activation.");
      setDetail(null);
    } finally {
      setLoading(false);
    }
  }, [organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  const searchOperators = useCallback(async () => {
    if (!operatorQuery.trim()) return;
    setError(null);
    try {
      const data = await searchKeeprAdminOperatorUsers(operatorQuery);
      setOperatorResults(data?.users || []);
    } catch (err) {
      setError(err?.message || "Could not search users.");
      setOperatorResults([]);
    }
  }, [operatorQuery]);

  const activate = useCallback(async () => {
    if (!organizationId || !selectedOperator?.id) return;
    setSaving(true);
    setError(null);
    try {
      await activateKeeprSpaceOrg({
        organizationId,
        workspaceType,
        operatorUserId: selectedOperator.id,
        memberRole,
        capabilities: [],
      });
      await load();
      await refreshWorkspaces?.();
    } catch (err) {
      setError(err?.message || "Could not activate KeeprSpace.");
    } finally {
      setSaving(false);
    }
  }, [load, memberRole, organizationId, refreshWorkspaces, selectedOperator?.id, workspaceType]);

  const openWorkspace = useCallback(async () => {
    if (!workspaceId) return;
    await refreshWorkspaces?.();
    await setCurrentWorkspaceId?.(workspaceId);
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: "WilsonHome", params: { workspaceId } }],
      })
    );
  }, [navigation, refreshWorkspaces, setCurrentWorkspaceId, workspaceId]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.centerText}>Loading activation...</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.iconButton} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.eyebrow}>Keepr Admin</Text>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.meta} numberOfLines={1}>
            {org.slug || "no slug"} · {org.id}
          </Text>
        </View>
      </View>

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <View style={styles.grid}>
        <Panel title="Activation">
          <Metric label="Status" value={activation?.status || "not started"} />
          <Metric label="Workspace Type" value={activation?.workspace_type || workspace?.workspace_type || "untyped"} />
          <Metric label="Workspace ID" value={workspaceId || "unresolved"} />
          <TouchableOpacity style={styles.primaryButton} onPress={openWorkspace} disabled={!workspaceId}>
            <Ionicons name="open-outline" size={17} color="#fff" />
            <Text style={styles.primaryButtonText}>Open KeeprSpace</Text>
          </TouchableOpacity>
        </Panel>

        <Panel title="Activation Operators">
          {operators.length ? operators.map((operator) => (
            <View key={operator.user_id} style={styles.operatorRow}>
              <Ionicons name="person-circle-outline" size={22} color={colors.primary} />
              <View style={styles.operatorBody}>
                <Text style={styles.operatorName}>{operator.profile?.full_name || operator.profile?.email}</Text>
                <Text style={styles.operatorMeta}>{operator.member_role} · {operator.status}</Text>
              </View>
            </View>
          )) : (
            <Text style={styles.muted}>No activation operator assigned yet.</Text>
          )}
        </Panel>
      </View>

      <Panel title="Assign Existing Operator">
        <View style={styles.segmentRow}>
          {WORKSPACE_TYPES.map((type) => (
            <TouchableOpacity
              key={type}
              style={[styles.segment, workspaceType === type && styles.segmentActive]}
              onPress={() => setWorkspaceType(type)}
            >
              <Text style={[styles.segmentText, workspaceType === type && styles.segmentTextActive]}>{type}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.segmentRow}>
          {MEMBER_ROLES.map((role) => (
            <TouchableOpacity
              key={role}
              style={[styles.segment, memberRole === role && styles.segmentActive]}
              onPress={() => setMemberRole(role)}
            >
              <Text style={[styles.segmentText, memberRole === role && styles.segmentTextActive]}>{role}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <View style={styles.searchRow}>
          <TextInput
            value={operatorQuery}
            onChangeText={setOperatorQuery}
            placeholder="Search existing user by email/name"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            onSubmitEditing={searchOperators}
          />
          <TouchableOpacity style={styles.searchButton} onPress={searchOperators}>
            <Ionicons name="search" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={styles.results}>
          {operatorResults.map((user) => (
            <TouchableOpacity
              key={user.id}
              style={[styles.userRow, selectedOperator?.id === user.id && styles.userRowActive]}
              onPress={() => setSelectedOperator(user)}
            >
              <View style={styles.operatorBody}>
                <Text style={styles.operatorName}>{user.full_name || user.email}</Text>
                <Text style={styles.operatorMeta}>{user.email}</Text>
              </View>
              {selectedOperator?.id === user.id ? <Ionicons name="checkmark-circle" size={20} color={colors.primary} /> : null}
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity
          style={[styles.primaryButton, (!selectedOperator || saving) && styles.buttonDisabled]}
          onPress={activate}
          disabled={!selectedOperator || saving}
        >
          {saving ? <ActivityIndicator size="small" color="#fff" /> : <Ionicons name="flash-outline" size={17} color="#fff" />}
          <Text style={styles.primaryButtonText}>{saving ? "Activating" : "Activate KeeprSpace"}</Text>
        </TouchableOpacity>
      </Panel>
    </ScrollView>
  );
}

function Panel({ title, children }) {
  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue} numberOfLines={2}>{String(value || "-")}</Text>
    </View>
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
  },
  centerText: {
    marginTop: 8,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  iconButton: {
    width: 42,
    height: 42,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
  },
  headerText: {
    flex: 1,
  },
  eyebrow: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "900",
  },
  meta: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  errorText: {
    color: colors.error || "#b91c1c",
    fontWeight: "700",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  panel: {
    flexGrow: 1,
    flexBasis: 340,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    ...shadows.card,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "900",
  },
  metric: {
    gap: 2,
  },
  metricLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
  },
  operatorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 6,
  },
  operatorBody: {
    flex: 1,
  },
  operatorName: {
    color: colors.textPrimary,
    fontWeight: "900",
  },
  operatorMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  muted: {
    color: colors.textSecondary,
    fontWeight: "700",
  },
  searchRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: "#fff",
    color: colors.textPrimary,
    fontWeight: "700",
  },
  searchButton: {
    width: 50,
    minHeight: 46,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  segmentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  segment: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
  },
  segmentActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  segmentText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: "#fff",
  },
  results: {
    gap: spacing.xs,
  },
  userRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userRowActive: {
    borderColor: colors.primary,
    backgroundColor: "#eef5ff",
  },
  primaryButton: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  primaryButtonText: {
    color: "#fff",
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.55,
  },
});
