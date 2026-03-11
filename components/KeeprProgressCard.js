import { Ionicons } from "@expo/vector-icons";
import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { cardStyles } from "../styles/cards";
import { colors, radius } from "../styles/theme";

export function buildKeeprProgressModel({
  mode = "dashboard",
  assetCount,
  systemCount,
  recordCount,
  proofCount,
}) {
  const hasAsset = Number(assetCount || 0) > 0;
  const hasSystem = Number(systemCount || 0) > 0;
  const hasRecord = Number(recordCount || 0) > 0;
  const hasProof = Number(proofCount || 0) > 0;

  if (mode === "asset") {
    const steps = [
      {
        key: "system",
        label: "Systems",
        done: hasSystem,
        helper: "Add the systems that make up this asset.",
      },
      {
        key: "record",
        label: "Records",
        done: hasRecord,
        helper: "Log service, installs, and key events.",
      },
      {
        key: "proof",
        label: "Proof",
        done: hasProof,
        helper: "Attach manuals, invoices, and photos.",
      },
    ];

    const nextStep = steps.find((s) => !s.done)?.key || null;

    let nextStepLabel = null;
    if (nextStep === "system") nextStepLabel = "Add your first system";
    if (nextStep === "record") nextStepLabel = "Add your first record";
    if (nextStep === "proof") nextStepLabel = "Add proof for this asset";

    const completedCount = steps.filter((s) => s.done).length;
    const complete = completedCount === steps.length;

    return {
      mode,
      steps,
      nextStep,
      nextStepLabel,
      completedCount,
      complete,
    };
  }

  const steps = [
    {
      key: "asset",
      label: "Add Asset",
      done: hasAsset,
      helper: "Start with something you own.",
    },
    {
      key: "system",
      label: "Add System",
      done: hasSystem,
      helper: "Add a system inside an asset.",
    },
    {
      key: "record",
      label: "Add Record",
      done: hasRecord,
      helper: "Log a service, install, or event.",
    },
    {
      key: "proof",
      label: "Add Proof",
      done: hasProof,
      helper: "Upload a photo, invoice, or manual.",
    },
  ];

  const nextStep = steps.find((s) => !s.done)?.key || null;
  const nextStepLabel = steps.find((s) => !s.done)?.label || null;
  const completedCount = steps.filter((s) => s.done).length;
  const complete = completedCount === steps.length;

  return {
    mode,
    steps,
    nextStep,
    nextStepLabel,
    completedCount,
    complete,
  };
}

export default function KeeprProgressCard({
  mode = "dashboard",
  progress,
  loading,
  onPress,
  onStepPress,
  onDismiss,
}) {
  const cardCopy = useMemo(() => {
    if (mode === "asset") {
      if (progress?.complete) {
        return {
          title: "Keepr Enabled",
          subtitle: "This asset’s ownership story is documented and ongoing!",
        };
      }

      return {
        title: "Complete this KeeprStory",
        subtitle: "Add systems, records, and proof to fully document this asset.",
      };
    }

    if (progress?.complete) {
      return {
        title: "You’re a Keepr",
        subtitle: "Your first ownership story is complete.",
      };
    }

    return {
      title: "Become a Keepr",
      subtitle: "Build your first ownership story by completing these steps.",
    };
  }, [mode, progress?.complete]);

  const handleCardPress = () => {
    if (!onPress) return;
    onPress(progress?.nextStep || null);
  };

  return (
    <View style={styles.progressCard}>
      <View style={styles.progressTopRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.progressTitle}>{cardCopy.title}</Text>
          <Text style={styles.progressSub}>{cardCopy.subtitle}</Text>
        </View>

        <View style={styles.progressTopActions}>
          {onDismiss ? (
            <TouchableOpacity
              onPress={onDismiss}
              style={styles.dismissBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Dismiss Keepr progress"
            >
              <Ionicons name="close" size={16} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <TouchableOpacity
        style={styles.progressBodyTap}
        activeOpacity={0.92}
        onPress={handleCardPress}
        accessibilityRole="button"
        accessibilityLabel="View Keepr progress"
      >
        {!progress?.complete && progress?.nextStepLabel ? (
          <View style={styles.progressNextRow}>
            <View style={styles.progressNextBadge}>
              <Text style={styles.progressNextBadgeText}>Next Step</Text>
            </View>

            <Text style={styles.progressNextAction}>{progress.nextStepLabel}</Text>

            <Ionicons
              name="chevron-forward"
              size={14}
              color={colors.textMuted}
              style={{ marginLeft: "auto" }}
            />
          </View>
        ) : (
          <View style={styles.progressCompleteRow}>
            <Text style={styles.progressCompleteText}>
              {mode === "asset"
                ? "This asset is fully documented."
                : "Your first ownership story is complete."}
            </Text>
            <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
          </View>
        )}

        {loading ? (
          <Text style={styles.progressMuted}>Loading…</Text>
        ) : (
          <View style={styles.progressStepsWrap}>
            {progress?.steps?.map((step, index) => {
              const isCurrent = !step.done && progress?.nextStep === step.key;

              return (
                <React.Fragment key={step.key}>
                  <TouchableOpacity
                    style={[
                      styles.progressStepChip,
                      step.done && styles.progressStepChipDone,
                      isCurrent && styles.progressStepChipCurrent,
                    ]}
                    activeOpacity={0.85}
                    onPress={(e) => {
                      e?.stopPropagation?.();
                      onStepPress?.(step.key);
                    }}
                  >
                    <Ionicons
                      name={
                        step.done
                          ? "checkmark-circle"
                          : isCurrent
                          ? "radio-button-on"
                          : "ellipse-outline"
                      }
                      size={14}
                      color={
                        step.done
                          ? colors.brandBlue
                          : isCurrent
                          ? colors.textPrimary
                          : colors.textMuted
                      }
                    />
                    <Text
                      style={[
                        styles.progressStepText,
                        step.done && styles.progressStepTextDone,
                      ]}
                    >
                      {step.label}
                    </Text>
                  </TouchableOpacity>

                  {index < (progress?.steps?.length || 0) - 1 ? (
                    <Ionicons
                      name="chevron-forward"
                      size={14}
                      color={colors.textMuted}
                      style={{ marginHorizontal: 4 }}
                    />
                  ) : null}
                </React.Fragment>
              );
            })}
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  progressCard: {
    width: "100%",
    maxWidth: 640,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: 12,
    paddingHorizontal: 14,
    ...cardStyles.shadowSoft,
  },
  progressTopRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    marginBottom: 8,
    gap: 8,
  },
  progressTopActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dismissBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  progressBodyTap: {
    width: "100%",
  },
  progressTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
    letterSpacing: 0.2,
  },
  progressSub: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  progressMuted: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
  },
  progressNextRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    marginBottom: 8,
    flexWrap: "wrap",
  },
  progressNextBadge: {
    backgroundColor: "rgba(45,125,227,0.12)",
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  progressNextBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: colors.brandBlue,
    letterSpacing: 0.4,
  },
  progressNextAction: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  progressCompleteRow: {
    marginTop: 4,
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  progressCompleteText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    flex: 1,
  },
  progressStepsWrap: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    marginTop: 2,
  },
  progressStepChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: 4,
  },
  progressStepChipDone: {
    backgroundColor: "rgba(45, 125, 227, 0.08)",
    borderColor: "rgba(45, 125, 227, 0.22)",
  },
  progressStepChipCurrent: {
    backgroundColor: "rgba(15,23,42,0.04)",
    borderColor: colors.borderSubtle,
  },
  progressStepText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  progressStepTextDone: {
    color: colors.textPrimary,
  },
});