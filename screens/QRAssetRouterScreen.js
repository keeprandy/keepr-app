// screens/QRAssetRouterScreen.js
import React, { useEffect } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, typography } from "../styles/theme";
import { boats } from "../data/boats";

export default function QRAssetRouterScreen({ route, navigation }) {
  const qrId = route?.params?.qrId;

  useEffect(() => {
    // In a real system, we'd decode qrId -> asset ID.
    // For the demo, always route to the Bennington Tri-Toon.
    const matchedBoat =
      boats.find((b) => b.id === "bennington-tritoon") ||
      boats.find((b) => b.isPrimary) ||
      boats[0];

    if (matchedBoat) {
      navigation.replace("BoatStory", { boatId: matchedBoat.id });
    } else {
      // Fallback: go back to the dashboard if somehow we have no boats
      navigation.replace("RootTabs", { screen: "Dashboard" });
    }
  }, [navigation, qrId]);

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.container}>
        <ActivityIndicator size="small" color={colors.accentBlue} />
        <Text style={styles.text}>Routing to boat record…</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    ...typography.subtitle,
    marginTop: spacing.sm,
    textAlign: "center",
  },
});


