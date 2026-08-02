import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { confirmDestructive } from "../lib/confirm";
import { formatKeeprDate } from "../lib/dateFormat";
import {
  completeSharedCoordinationAction,
  fetchCoordinationActions,
  getReminderProviderLabel,
  getReminderResponsibilityLabel,
} from "../lib/teamActions";
import { cancelReminderPushNotification } from "../lib/teamActions";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";
import {
  isWhatNextActionOverdue,
  projectWhatNextActions,
} from "../lib/assetWhatNextProjection";

function getProjectLabel(action) {
  const meta =
    action?.extra_metadata && typeof action.extra_metadata === "object"
      ? action.extra_metadata
      : {};
  const project =
    meta.project ||
    meta.project_target ||
    meta.associated_project ||
    meta.action_project ||
    null;

  if (typeof project === "string") return project;
  return project?.label || project?.name || project?.title || null;
}

function getDueLabel(action) {
  if (!action?.due_at) return null;
  const label = formatKeeprDate(action.due_at);
  return isWhatNextActionOverdue(action) ? `Overdue: ${label}` : `Due ${label}`;
}

function ActionMetaPill({ icon, label, tone }) {
  if (!label) return null;
  return (
    <View style={[styles.metaPill, tone === "overdue" && styles.metaPillOverdue]}>
      {!!icon && (
        <Ionicons
          name={icon}
          size={13}
          color={tone === "overdue" ? "#b42318" : colors.textSecondary}
        />
      )}
      <Text
        numberOfLines={1}
        style={[styles.metaPillText, tone === "overdue" && styles.metaPillTextOverdue]}
      >
        {label}
      </Text>
    </View>
  );
}

export default function AssetWhatNextSection({
  assetId,
  assetName,
  assetType,
  navigation,
}) {
  const { user } = useAuth();
  const ownerId = user?.id || null;
  const [actions, setActions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);

  const loadActions = useCallback(
    async ({ silent = false } = {}) => {
      if (!ownerId || !assetId) {
        setActions([]);
        setLoading(false);
        return;
      }

      if (!silent) setLoading(true);
      setError(null);

      try {
        const rows = await fetchCoordinationActions({
          statuses: ["open"],
          ownerId,
        });
        setActions(projectWhatNextActions(rows || [], assetId).actions);
      } catch (err) {
        console.log("Story WhatNext actions load error:", err);
        setError(err?.message || "Could not load actions.");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [assetId, ownerId]
  );

  useFocusEffect(
    useCallback(() => {
      loadActions({ silent: true });
    }, [loadActions])
  );

  const projection = useMemo(
    () => projectWhatNextActions(actions, assetId),
    [actions, assetId]
  );
  const { visibleActions, hiddenCount } = projection;

  const openAction = useCallback(
    (action) => {
      if (!action?.id) return;
      navigation.navigate("CreateReminder", {
        reminderId: action.id,
        afterSave: "Notifications",
      });
    },
    [navigation]
  );

  const addAction = useCallback(() => {
    navigation.navigate("CreateReminder", {
      assetId,
      prefill: {
        asset_id: assetId,
        title: "",
        notes: "",
        status: "open",
      },
      afterSave: "Notifications",
    });
  }, [assetId, navigation]);

  const viewAllActions = useCallback(() => {
    navigation.navigate("Notifications", {
      assetId,
      assetName,
      assetType,
      reminderFilter: "open",
    });
  }, [assetId, assetName, assetType, navigation]);

  const markComplete = useCallback(
    async (action) => {
      if (!action?.id || busyId) return;
      setBusyId(action.id);
      try {
        try {
          await completeSharedCoordinationAction({
            reminderId: action.id,
            completionMetadata: {
              completed_at: new Date().toISOString(),
              completed_by_user_id: ownerId,
              completion_source: "asset_story_projection",
            },
          });
        } catch (rpcError) {
          const { error: updateError } = await supabase
            .from("reminders")
            .update({
              status: "completed",
              updated_at: new Date().toISOString(),
              extra_metadata: {
                ...(action.extra_metadata || {}),
                completed_at: new Date().toISOString(),
                completed_by_user_id: ownerId,
                completion_source: "asset_story_projection",
              },
            })
            .eq("id", action.id)
            .eq("owner_id", ownerId);
          if (updateError) throw rpcError || updateError;
        }
        await cancelReminderPushNotification(action.id);
        await loadActions({ silent: true });
      } catch (err) {
        console.log("Story WhatNext complete action error:", err);
        Alert.alert("Could not complete action", err?.message || "Please try again.");
      } finally {
        setBusyId(null);
      }
    },
    [busyId, loadActions, ownerId]
  );

  const deleteAction = useCallback(
    (action) => {
      if (!action?.id || busyId) return;

      confirmDestructive(
        "Delete action?",
        "This will permanently remove this action.",
        async () => {
          setBusyId(action.id);
          try {
            const { error: deleteError } = await supabase
              .from("reminders")
              .delete()
              .eq("id", action.id)
              .eq("owner_id", ownerId);
            if (deleteError) throw deleteError;
            await cancelReminderPushNotification(action.id);
            await loadActions({ silent: true });
          } catch (err) {
            console.log("Story WhatNext delete action error:", err);
            Alert.alert("Could not delete action", err?.message || "Please try again.");
          } finally {
            setBusyId(null);
          }
        }
      );
    },
    [busyId, loadActions, ownerId]
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>What's Next</Text>
          <Text style={styles.subtitle}>
            Open actions connected to this asset.
          </Text>
        </View>
        <TouchableOpacity style={styles.headerButton} onPress={addAction} activeOpacity={0.85}>
          <Ionicons name="add" size={16} color={colors.primary} />
          <Text style={styles.headerButtonText}>Add action</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" />
          <Text style={styles.loadingText}>Loading actions...</Text>
        </View>
      ) : error ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>Actions are unavailable</Text>
          <Text style={styles.emptyText}>{error}</Text>
        </View>
      ) : visibleActions.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyTitle}>No open actions</Text>
          <Text style={styles.emptyText}>
            This asset has no incomplete actions right now.
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {visibleActions.map((action) => {
            const overdue = isWhatNextActionOverdue(action);
            const dueLabel = getDueLabel(action);
            const responsibleLabel = getReminderResponsibilityLabel(action);
            const providerLabel = getReminderProviderLabel(action);
            const projectLabel = getProjectLabel(action);
            const isBusy = busyId === action.id;

            return (
              <View key={action.id} style={styles.actionRow}>
                <TouchableOpacity
                  style={styles.actionBody}
                  onPress={() => openAction(action)}
                  activeOpacity={0.85}
                >
                  <View style={[styles.statusDot, overdue && styles.statusDotOverdue]} />
                  <View style={styles.actionTextWrap}>
                    <Text style={styles.actionTitle} numberOfLines={1}>
                      {action.title || "Untitled action"}
                    </Text>
                    <View style={styles.metaRow}>
                      <ActionMetaPill
                        icon="calendar-outline"
                        label={dueLabel || "No due date"}
                        tone={overdue ? "overdue" : null}
                      />
                      <ActionMetaPill
                        icon="person-outline"
                        label={responsibleLabel ? `Responsible: ${responsibleLabel}` : null}
                      />
                      <ActionMetaPill
                        icon="business-outline"
                        label={providerLabel ? `Provider: ${providerLabel}` : null}
                      />
                      <ActionMetaPill
                        icon="folder-open-outline"
                        label={projectLabel ? `Project: ${projectLabel}` : null}
                      />
                    </View>
                  </View>
                </TouchableOpacity>

                <View style={styles.rowActions}>
                  <TouchableOpacity
                    style={[styles.iconButton, isBusy && styles.iconButtonDisabled]}
                    onPress={() => markComplete(action)}
                    disabled={isBusy}
                    activeOpacity={0.85}
                  >
                    {isBusy ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Ionicons name="checkmark-circle-outline" size={20} color={colors.primary} />
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.iconButton, isBusy && styles.iconButtonDisabled]}
                    onPress={() => deleteAction(action)}
                    disabled={isBusy}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="trash-outline" size={18} color="#b42318" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>
      )}

      <View style={styles.footer}>
        {hiddenCount > 0 ? (
          <Text style={styles.footerText}>{hiddenCount} more open action{hiddenCount === 1 ? "" : "s"}</Text>
        ) : null}
        <TouchableOpacity onPress={viewAllActions} activeOpacity={0.85} style={styles.footerLink}>
          <Text style={styles.footerLinkText}>View all actions</Text>
          <Ionicons name="chevron-forward" size={14} color={colors.primary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface || "white",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border || "#e5e7eb",
    padding: spacing.md,
    marginBottom: spacing.md,
    ...Platform.select({
      web: shadows?.soft || {},
      default: {},
    }),
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  titleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
    fontFamily: typography?.heading,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  headerButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border || "#e5e7eb",
    backgroundColor: "white",
  },
  headerButtonText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  loadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  loadingText: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  emptyBox: {
    paddingVertical: spacing.sm,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "850",
    color: colors.textPrimary,
  },
  emptyText: {
    marginTop: 3,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  list: {
    gap: 8,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border || "#e5e7eb",
  },
  actionBody: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.primary,
    marginTop: 6,
  },
  statusDotOverdue: {
    backgroundColor: "#f97316",
  },
  actionTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  actionTitle: {
    fontSize: 14,
    fontWeight: "850",
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 7,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: colors.border || "#e5e7eb",
    maxWidth: "100%",
  },
  metaPillOverdue: {
    backgroundColor: "#fff7ed",
    borderColor: "#fed7aa",
  },
  metaPillText: {
    fontSize: 11,
    fontWeight: "750",
    color: colors.textSecondary,
  },
  metaPillTextOverdue: {
    color: "#b42318",
  },
  rowActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: colors.border || "#e5e7eb",
  },
  iconButtonDisabled: {
    opacity: 0.55,
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border || "#e5e7eb",
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
  },
  footerText: {
    flex: 1,
    fontSize: 12,
    color: colors.textSecondary,
  },
  footerLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  footerLinkText: {
    fontSize: 12,
    fontWeight: "850",
    color: colors.primary,
  },
});
