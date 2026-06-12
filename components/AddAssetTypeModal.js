import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius } from "../styles/theme";
import { cardStyles } from "../styles/cards";

export default function AddAssetTypeModal({
  visible,
  onClose,
  title = "Add an asset",
  subtitle,
  onSelectHome,
  onSelectVehicle,
  onSelectBoat,
  onSelectOther,
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.card} onPress={() => {}}>
          <Text style={styles.title}>{title}</Text>

          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}

          <AssetButton icon="home-outline" label="Home" onPress={onSelectHome} />
          <AssetButton icon="car-outline" label="Vehicle" onPress={onSelectVehicle} />
          <AssetButton icon="boat-outline" label="Boat" onPress={onSelectBoat} />
          <AssetButton icon="cube-outline" label="Other Asset" onPress={onSelectOther} />

          <Pressable style={[styles.btn, styles.cancel]} onPress={onClose}>
            <Text style={[styles.btnText, { fontWeight: "900" }]}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function AssetButton({ icon, label, onPress }) {
  return (
    <Pressable style={styles.btn} onPress={onPress}>
      <Ionicons name={icon} size={24} color={colors.textPrimary} />
      <Text style={styles.btnText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.xl || 20,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: 14,
    ...cardStyles.shadowStrong,
  },
  title: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "600",
    lineHeight: 16,
    marginBottom: 12,
  },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.75)",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: 10,
  },
  btnText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "800",
  },
  cancel: {
    backgroundColor: "rgba(15,23,42,0.06)",
  },
});