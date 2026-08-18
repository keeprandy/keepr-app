import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { getActionScheduleLabel } from "../lib/playbookSchedule";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

function formatDate(value) {
  if (!value) return "Not scheduled";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function compact(values) {
  return values.filter(Boolean).join(" · ");
}

function getActionMetadata(action) {
  const candidates = [
    action?.extra_metadata,
    action?.metadata,
    action?.reminder?.extra_metadata,
    action?.reminder?.metadata,
  ];
  return candidates.find((candidate) => candidate && typeof candidate === "object") || {};
}

function getServiceSnapshot(action) {
  const meta = getActionMetadata(action);
  const snapshot = meta.service_template_snapshot || meta.serviceTemplateSnapshot || null;
  return (
    snapshot ||
    (meta.service_action || meta.action_type === "service"
      ? {
          name: meta.service_template_name,
          label: meta.service_template_label || meta.service_template_name,
          interval_trigger: meta.service_interval_trigger,
          owner_facing_description: meta.service_description,
          service_items: [],
        }
      : null)
  );
}

function normalizeServiceItems(snapshot) {
  const items = snapshot?.service_items || snapshot?.checklist_items || [];
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (typeof item === "string") return item.trim();
      if (item && typeof item === "object") {
        return String(item.label || item.title || item.name || "").trim();
      }
      return "";
    })
    .filter(Boolean);
}

export default function KeeprProActionDetailScreen({ route }) {
  const { actionId, organizationId } = route?.params || {};
  const [action, setAction] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState("");
  const [nextStep, setNextStep] = useState("");

  const load = useCallback(async () => {
    if (!actionId) {
      setError("Missing Action.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data, error: rpcError } = await supabase.rpc(
        "get_keeprpro_stewardship_action",
        {
          p_reminder_id: actionId,
          p_organization_id: organizationId || null,
        }
      );
      if (rpcError) throw rpcError;
      if (!data) {
        setError("This Action is not available in the active KeeprPro context.");
        setAction(null);
        return;
      }

      setAction(data);
      setNote(data.provider_response?.note || "");
      setNextStep(data.provider_response?.next_step || "");
    } catch (err) {
      console.error("KeeprPro Action detail load failed:", err);
      setError(err?.message || "Could not load this Action.");
      setAction(null);
    } finally {
      setLoading(false);
    }
  }, [actionId, organizationId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveResponse = async () => {
    setSaving(true);
    try {
      const { data, error: rpcError } = await supabase.rpc(
        "update_keeprpro_stewardship_action_response",
        {
          p_reminder_id: actionId,
          p_organization_id: organizationId,
          p_note: note,
          p_next_step: nextStep,
        }
      );
      if (rpcError) throw rpcError;
      if (!data) throw new Error("This Action is not available in the active KeeprPro context.");
      setAction(data);
      Alert.alert("Response saved", "Wilson Marine's next step was saved to the shared Action.");
    } catch (err) {
      Alert.alert("Could not save", err?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const completeAction = async () => {
    Alert.alert(
      "Complete Action",
      "Mark this shared Action complete and add it to Wilson Marine service history?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Complete",
          onPress: async () => {
            setCompleting(true);
            try {
              const { data, error: rpcError } = await supabase.rpc(
                "complete_keeprpro_stewardship_action",
                {
                  p_reminder_id: actionId,
                  p_organization_id: organizationId,
                  p_completion_notes: note,
                  p_performed_at: new Date().toISOString().slice(0, 10),
                }
              );
              if (rpcError) throw rpcError;
              if (!data) throw new Error("This Action is not available in the active KeeprPro context.");
              setAction(data);
              Alert.alert("Action completed", "A Wilson Marine service record was added to Harris history.");
            } catch (err) {
              Alert.alert("Could not complete", err?.message || "Please try again.");
            } finally {
              setCompleting(false);
            }
          },
        },
      ]
    );
  };

  const asset = action?.asset || {};
  const provider = action?.provider || {};
  const serviceSnapshot = getServiceSnapshot(action);
  const serviceItems = normalizeServiceItems(serviceSnapshot);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <View style={styles.stateCard}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.stateText}>Loading Action...</Text>
          </View>
        ) : error ? (
          <View style={styles.stateCard}>
            <Ionicons name="lock-closed-outline" size={24} color={colors.textSecondary} />
            <Text style={styles.stateTitle}>Restricted</Text>
            <Text style={styles.stateText}>{error}</Text>
          </View>
        ) : (
          <>
            <View style={styles.header}>
              <Text style={styles.eyebrow}>Professional stewardship mode</Text>
              <Text style={styles.title}>{action.title}</Text>
              <Text style={styles.subtitle}>
                {compact([action.status, action.relationship_label, action.access_scope])}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardLabel}>Shared Action context</Text>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Owner</Text>
                <Text style={styles.detailValue}>{asset.owner_display_name}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Asset</Text>
                <Text style={styles.detailValue}>{asset.name} · {asset.kac_id}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Provider</Text>
                <Text style={styles.detailValue}>{provider.name || provider.organization_name}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>System</Text>
                <Text style={styles.detailValue}>{action.system?.name || "Asset-level request"}</Text>
              </View>
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Timing</Text>
                <Text style={styles.detailValue}>{getActionScheduleLabel(action, formatDate)}</Text>
              </View>
            </View>

            {serviceSnapshot ? (
              <View style={styles.serviceCard}>
                <View style={styles.serviceHeader}>
                  <View style={styles.serviceIcon}>
                    <Ionicons name="construct-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardLabel}>Service template</Text>
                    <Text style={styles.cardTitle}>
                      {serviceSnapshot.label || serviceSnapshot.name || "Service"}
                    </Text>
                  </View>
                </View>
                {serviceSnapshot.owner_facing_description ? (
                  <Text style={styles.bodyText}>{serviceSnapshot.owner_facing_description}</Text>
                ) : null}
                <View style={styles.serviceMetaGrid}>
                  {[
                    ["Type", serviceSnapshot.service_type],
                    ["Applies to", compact([serviceSnapshot.asset_system_type, serviceSnapshot.brand_applicability])],
                    ["Interval", serviceSnapshot.interval_trigger],
                  ]
                    .filter(([, value]) => !!value)
                    .map(([label, value]) => (
                      <View key={label} style={styles.serviceMetaItem}>
                        <Text style={styles.detailLabel}>{label}</Text>
                        <Text style={styles.detailValue}>{value}</Text>
                      </View>
                    ))}
                </View>
                {serviceItems.length ? (
                  <View style={styles.serviceItems}>
                    <Text style={styles.detailLabel}>Service items</Text>
                    {serviceItems.map((item, index) => (
                      <View key={`${item}-${index}`} style={styles.serviceItemRow}>
                        <Ionicons name="checkmark-circle-outline" size={16} color={colors.primary} />
                        <Text style={styles.serviceItemText}>{item}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Issue</Text>
              <Text style={styles.bodyText}>{action.notes || "No issue notes provided."}</Text>
              {!!action.shared_notes && (
                <Text style={styles.sharedNotes}>{action.shared_notes}</Text>
              )}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Wilson response</Text>
              <Text style={styles.inputLabel}>Provider response</Text>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Add a provider response..."
                multiline
                style={[styles.input, styles.textArea]}
              />
              <Text style={styles.inputLabel}>Next step</Text>
              <TextInput
                value={nextStep}
                onChangeText={setNextStep}
                placeholder="Recommended next step..."
                style={styles.input}
              />
              <TouchableOpacity
                style={[styles.saveButton, saving && styles.disabled]}
                activeOpacity={0.88}
                onPress={saveResponse}
                disabled={saving}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Ionicons name="checkmark-circle-outline" size={18} color="#FFFFFF" />
                )}
                <Text style={styles.saveButtonText}>Save response</Text>
              </TouchableOpacity>
              {action.status === "completed" ? (
                <View style={styles.completedNotice}>
                  <Ionicons name="checkmark-circle" size={18} color={colors.success || "#16A34A"} />
                  <Text style={styles.completedText}>
                    Completed and recorded in Wilson service history.
                  </Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.completeButton, completing && styles.disabled]}
                  activeOpacity={0.88}
                  onPress={completeAction}
                  disabled={completing}
                >
                  {completing ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : (
                    <Ionicons name="flag-outline" size={18} color={colors.primary} />
                  )}
                  <Text style={styles.completeButtonText}>Complete and add history</Text>
                </TouchableOpacity>
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
    backgroundColor: "#F8FAFC",
  },
  content: {
    padding: spacing.lg,
    gap: spacing.md,
  },
  header: {
    paddingVertical: spacing.md,
  },
  eyebrow: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    ...typography.h1,
    color: colors.textPrimary,
    marginTop: 4,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: 4,
  },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadows.card,
  },
  serviceCard: {
    backgroundColor: "#EFF6FF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  serviceHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  serviceIcon: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  serviceMetaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  serviceMetaItem: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DBEAFE",
    borderRadius: radius.md,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 160,
    padding: spacing.md,
  },
  serviceItems: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DBEAFE",
    borderRadius: radius.md,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  serviceItemRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  serviceItemText: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    fontWeight: "700",
  },
  cardLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
    textTransform: "uppercase",
    marginBottom: spacing.sm,
  },
  cardTitle: {
    ...typography.h2,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  detailRow: {
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  detailLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
  },
  detailValue: {
    ...typography.body,
    color: colors.textPrimary,
    fontWeight: "700",
    marginTop: 2,
  },
  bodyText: {
    ...typography.body,
    color: colors.textPrimary,
  },
  sharedNotes: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  inputLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: "800",
    marginTop: spacing.sm,
    marginBottom: 4,
  },
  input: {
    minHeight: 44,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: "#FFFFFF",
    ...typography.body,
    color: colors.textPrimary,
  },
  textArea: {
    minHeight: 96,
    textAlignVertical: "top",
  },
  saveButton: {
    minHeight: 46,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  saveButtonText: {
    ...typography.body,
    color: "#FFFFFF",
    fontWeight: "800",
  },
  completeButton: {
    minHeight: 46,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    backgroundColor: "#FFFFFF",
  },
  completeButtonText: {
    ...typography.body,
    color: colors.primary,
    fontWeight: "800",
  },
  completedNotice: {
    borderRadius: radius.md,
    backgroundColor: "#ECFDF5",
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  completedText: {
    ...typography.body,
    color: "#166534",
    fontWeight: "700",
    flex: 1,
  },
  disabled: {
    opacity: 0.65,
  },
  stateCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    alignItems: "center",
    gap: spacing.sm,
  },
  stateTitle: {
    ...typography.h3,
    color: colors.textPrimary,
  },
  stateText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: "center",
  },
});
