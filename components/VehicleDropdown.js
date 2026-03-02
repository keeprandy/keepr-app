// VehicleDropdown.js — Dropdown menu for selecting a vehicle
// Works on both mobile and web with no external libraries.

import React from "react";
import {
  View,
  ScrollView,
  Text,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { VEHICLES } from "../data/vehicles";

export default function VehicleDropdown({ value, onSelect, onClose }) {
  return (
    <View style={styles.dropdownCard}>
      <ScrollView style={{ maxHeight: 180 }}>
        {/* Option: No vehicle assigned */}
        <TouchableOpacity
          style={styles.dropdownItem}
          onPress={() => {
            onSelect(null);
            onClose();
          }}
        >
          <Text style={styles.dropdownItemText}>No assigned vehicle</Text>
        </TouchableOpacity>

        {/* Vehicles from VEHICLES.js */}
        {VEHICLES.map((v) => (
          <TouchableOpacity
            key={v.id}
            style={styles.dropdownItem}
            onPress={() => {
              onSelect(v.name);
              onClose();
            }}
          >
            <Text style={styles.dropdownItemText}>{v.name}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  dropdownCard: {
    position: "absolute",
    top: 52,
    left: 0,
    right: 0,
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    elevation: 4,
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    zIndex: 999,
    paddingVertical: 4,
  },
  dropdownItem: {
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  dropdownItemText: {
    fontSize: 13,
    color: "#111827",
  },
});
