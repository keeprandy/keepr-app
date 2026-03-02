// components/VehicleDropdown.js
import React, { useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Modal,
  FlatList,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function VehicleDropdown({ vehicles, selectedId, onChange }) {
  const [open, setOpen] = useState(false);

  if (!vehicles || vehicles.length === 0) return null;

  const selected =
    vehicles.find((v) => v.id === selectedId) || vehicles[0];

  const handleSelect = (id) => {
    onChange && onChange(id);
    setOpen(false);
  };

  return (
    <View>
      <TouchableOpacity
        style={styles.trigger}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
      >
        <Text style={styles.triggerLabel}>Vehicle</Text>
        <View style={styles.triggerRow}>
          <Text style={styles.triggerText}>{selected.name}</Text>
          <Ionicons name="chevron-down" size={16} color="#4B5563" />
        </View>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>Select vehicle</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Ionicons name="close-outline" size={22} color="#6B7280" />
              </TouchableOpacity>
            </View>

            <FlatList
              data={vehicles}
              keyExtractor={(item) => item.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => handleSelect(item.id)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.optionTitle}>{item.name}</Text>
                  <Text style={styles.optionSubtitle}>{item.role}</Text>
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#F3F4F6",
  },
  triggerLabel: {
    fontSize: 10,
    color: "#6B7280",
    textTransform: "uppercase",
    marginBottom: 2,
  },
  triggerRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  triggerText: {
    fontSize: 13,
    color: "#111827",
    marginRight: 6,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    maxHeight: "70%",
  },
  sheetHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#111827",
  },
  optionRow: {
    paddingVertical: 8,
  },
  optionTitle: {
    fontSize: 14,
    fontWeight: "500",
    color: "#111827",
  },
  optionSubtitle: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: 2,
  },
});
