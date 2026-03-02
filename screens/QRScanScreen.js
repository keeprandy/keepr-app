// screens/QRScanScreen.js
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";

export default function QRScanScreen({ navigation }) {
  const handleFakeScan = () => {
    // For the demo, always route to the same "QR asset"
    navigation.replace("QRAssetRouter", {
      qrId: "BENNINGTON-TRITOON-001",
    });
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => navigation.goBack()}
            activeOpacity={0.7}
          >
            <Ionicons
              name="chevron-back"
              size={26}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          <Text style={styles.title}>Scan KeeprTag</Text>
          {/* Spacer to balance the back button */}
          <View style={{ width: 40 }} />
        </View>

        {/* Instructions */}
        <Text style={styles.subtitle}>
          In production, you’d point your camera at a KeeprTag on the boat. For
          this demo, tap below to simulate scanning the Bennington Tri-Toon.
        </Text>

        {/* Fake scanner frame */}
        <View style={styles.scanFrame}>
          <Ionicons
            name="qr-code-outline"
            size={48}
            color={colors.accentBlue}
          />
          <Text style={styles.scanHint}>KeeprTag goes here</Text>
        </View>

        {/* Simulate scan button */}
        <TouchableOpacity
          style={styles.fakeScanButton}
          onPress={handleFakeScan}
          activeOpacity={0.9}
        >
          <Ionicons name="scan-outline" size={20} color="#FFFFFF" />
          <Text style={styles.fakeScanText}>Simulate scan</Text>
        </TouchableOpacity>

        {/* Footer copy */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Keepr uses a single QR to anchor the entire story of an asset —
            whether you’re the owner or the Keepr Pro doing the work.
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  backButton: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginLeft: -6,
    borderRadius: 22,
  },
  title: {
    flex: 1,
    textAlign: "left",
    fontSize: 18,
    fontWeight: "600",
    color: colors.textPrimary,
  },

  subtitle: {
    ...typography.subtitle,
    marginBottom: spacing.lg,
  },

  scanFrame: {
    flexGrow: 1,
    minHeight: 220,
    borderRadius: radius.xl,
    borderWidth: 2,
    borderColor: colors.accentBlue,
    borderStyle: "dashed",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    ...shadows.subtle,
  },
  scanHint: {
    marginTop: spacing.sm,
    fontSize: 13,
    color: colors.textMuted,
  },

  fakeScanButton: {
    marginTop: spacing.lg,
    backgroundColor: colors.accentBlue,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  fakeScanText: {
    marginLeft: spacing.xs,
    fontSize: 15,
    fontWeight: "600",
    color: "#FFFFFF",
  },

  footer: {
    marginTop: spacing.lg,
  },
  footerText: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
