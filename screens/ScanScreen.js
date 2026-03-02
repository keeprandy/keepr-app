// screens/ScanScreen.js
import React from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography } from "../styles/theme";
import { useWorkspace } from "../context/WorkspaceContext";

export default function ScanScreen({ navigation }) {
  const { currentWorkspace } = useWorkspace();
  const isPro = currentWorkspace.type === "pro";

  // PRO WORKSPACE: Wilson Marine mode → go straight to Keepr Pro flow
  if (isPro) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.container}>
          <Text style={styles.title}>Scan KeeprTag</Text>
          <Text style={styles.subtitle}>
            You’re working as {currentWorkspace.name}. Scanning a KeeprTag on a
            customer’s boat takes you directly into logging a service record.
          </Text>

          <TouchableOpacity
            style={styles.cardPrimary}
            activeOpacity={0.9}
            onPress={() => navigation.navigate("KeeprProAddService")}
          >
            <View style={styles.iconCirclePrimary}>
              <Ionicons name="construct-outline" size={20} color="#FFFFFF" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitlePrimary}>Add service record</Text>
              <Text style={styles.cardSubtitlePrimary}>
                Use Wilson Marine’s service packages, attach a work order, and
                update the boat’s story in one step.
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color="#FFFFFFCC" />
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // OWNER WORKSPACE: My Keepr mode → choose Owner vs Keepr Pro
  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.container}>
        <Text style={styles.title}>Scan KeeprTag</Text>
        <Text style={styles.subtitle}>
          In the live app, scanning the KeeprTag on your boat or asset brings
          you here automatically. For now, choose how you want to continue.
        </Text>

        {/* Owner path */}
        <TouchableOpacity
          style={styles.card}
          activeOpacity={0.9}
          onPress={() => navigation.navigate("BoatStory")}
        >
          <View style={styles.iconCircle}>
            <Ionicons
              name="person-outline"
              size={20}
              color={colors.accentBlue}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>I’m the owner</Text>
            <Text style={styles.cardSubtitle}>
              View the complete boat story — Wilson Marine’s work, your DIY
              entries, and location over time.
            </Text>
          </View>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={colors.textMuted}
          />
        </TouchableOpacity>

        {/* Technician / Keepr Pro path */}
        <TouchableOpacity
          style={styles.cardPrimary}
          activeOpacity={0.9}
          onPress={() => navigation.navigate("KeeprProAddService")}
        >
          <View style={styles.iconCirclePrimary}>
            <Ionicons name="construct-outline" size={20} color="#FFFFFF" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitlePrimary}>I’m a Keepr Pro</Text>
            <Text style={styles.cardSubtitlePrimary}>
              Add a service record with pre-filled boat details and a configured
              service package, then attach a work order.
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#FFFFFFCC" />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: 4,
    marginBottom: spacing.md,
  },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.sm,
  },
  cardPrimary: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.accentBlue,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.sm,
  },
  iconCirclePrimary: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#1D4ED8",
    marginRight: spacing.sm,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  cardSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  cardTitlePrimary: {
    fontSize: 14,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  cardSubtitlePrimary: {
    fontSize: 12,
    color: "#E5E7EB",
    marginTop: 2,
  },
});


