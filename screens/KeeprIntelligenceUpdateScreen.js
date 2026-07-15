import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import KeeprIntelligenceUpdatePanel from "../components/kai/KeeprIntelligenceUpdatePanel";
import { fetchKeeprIntelligenceUpdate } from "../lib/kaiIntelligenceUpdate";
import { colors, spacing } from "../styles/theme";

export default function KeeprIntelligenceUpdateScreen({ navigation, route }) {
  const { kac, assetName, assetType } = route?.params || {};
  const [loading, setLoading] = useState(true);
  const [viewModel, setViewModel] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const result = await fetchKeeprIntelligenceUpdate({ kac, assetName, assetType });
    setViewModel(result.viewModel);
    setLoading(false);
  }, [kac, assetName, assetType]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()} activeOpacity={0.85}>
          <Ionicons name="chevron-back" size={20} color={colors.textPrimary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Keepr Intelligence Update</Text>
        <View style={styles.spacer} />
      </View>
      <KeeprIntelligenceUpdatePanel viewModel={viewModel} loading={loading} onRetry={load} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  topBar: {
    minHeight: 56,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    minWidth: 72,
  },
  backText: {
    color: colors.textPrimary,
    fontWeight: "700",
  },
  title: {
    color: colors.textPrimary,
    fontWeight: "800",
    fontSize: 16,
  },
  spacer: {
    width: 72,
  },
});
