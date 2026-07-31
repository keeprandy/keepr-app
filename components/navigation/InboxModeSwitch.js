import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { INBOX_MODES } from "../../lib/inboxNavigation";
import { colors, radius, spacing } from "../../styles/theme";

export default function InboxModeSwitch({
  activeMode,
  onChange,
  actionsCount,
  messagesCount,
  style,
}) {
  const modes = [
    { key: INBOX_MODES.ACTIONS, label: "Actions", count: actionsCount },
    { key: INBOX_MODES.MESSAGES, label: "Messages", count: messagesCount },
  ];

  return (
    <View style={[styles.shell, style]}>
      {modes.map((mode) => {
        const active = activeMode === mode.key;
        const count = Number(mode.count || 0);
        return (
          <TouchableOpacity
            key={mode.key}
            style={[styles.segment, active && styles.segmentActive]}
            onPress={() => onChange?.(mode.key)}
            activeOpacity={0.86}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{mode.label}</Text>
            {count > 0 ? (
              <View style={[styles.badge, active && styles.badgeActive]}>
                <Text style={[styles.badgeText, active && styles.badgeTextActive]}>
                  {count > 99 ? "99+" : count}
                </Text>
              </View>
            ) : null}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    padding: 4,
    gap: 4,
  },
  segment: {
    flex: 1,
    minHeight: 38,
    borderRadius: radius.pill,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
  },
  segmentActive: {
    backgroundColor: colors.brandBlue,
  },
  label: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "900",
  },
  labelActive: {
    color: "white",
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E5E7EB",
    paddingHorizontal: 6,
  },
  badgeActive: {
    backgroundColor: "rgba(255,255,255,0.22)",
  },
  badgeText: {
    color: colors.textPrimary,
    fontSize: 10,
    fontWeight: "900",
  },
  badgeTextActive: {
    color: "white",
  },
});
