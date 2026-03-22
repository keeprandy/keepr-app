import React from "react";
import {
  View,
  TouchableOpacity,
  Text,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function GlassFooter({
  state,
  descriptors,
  navigation,
  onQuickCapture,
}) {
  const insets = useSafeAreaInsets();

  const visibleTabs = [
    "Dashboard",
    "Notifications",
    "Create",
    "KeeprPros",
    "More",
  ];

  return (
    <View style={[styles.wrapper, { paddingBottom: insets.bottom || 10 }]}>
      <View style={styles.container}>
        {state.routes
          .filter((route) => visibleTabs.includes(route.name))
          .map((route) => {
            const index = state.routes.findIndex((r) => r.key === route.key);
            const { options } = descriptors[route.key];
            const isFocused = state.index === index;

            if (route.name === "Create") {
              return (
                <View key={route.key} style={styles.centerWrap}>
                  <TouchableOpacity
                    onPress={onQuickCapture}
                    style={styles.centerButton}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add" size={28} color="#fff" />
                  </TouchableOpacity>
                </View>
              );
            }

            const label = options.tabBarLabel ?? options.title ?? route.name;
            const iconName = getIcon(route.name, isFocused);

            return (
              <TouchableOpacity
                key={route.key}
                onPress={() => navigation.navigate(route.name)}
                style={styles.tab}
                activeOpacity={0.7}
              >
                <Ionicons
                  name={iconName}
                  size={20}
                  color={isFocused ? "#007AFF" : "#999"}
                />
                <Text
                  style={[
                    styles.label,
                    { color: isFocused ? "#007AFF" : "#999" },
                  ]}
                >
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}
      </View>
    </View>
  );
}

function getIcon(routeName, focused) {
  switch (routeName) {
case "Dashboard":
  return focused ? "grid" : "grid-outline";
case "Notifications":
  return focused ? "mail" : "mail-outline";
case "KeeprPros":
  return focused ? "shield-checkmark" : "shield-checkmark-outline";
case "More":
  return focused ? "ellipsis-horizontal" : "ellipsis-horizontal-outline";
    default:
      return "ellipse-outline";
  }
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    bottom: 0,
    width: "100%",
    alignItems: "center",
  },
  container: {
    flexDirection: "row",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderRadius: 30,
    paddingHorizontal: 14,
    paddingVertical: 10,
    width: "92%",
    justifyContent: "space-between",
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },
  label: {
    fontSize: 10,
    marginTop: 2,
  },
  centerWrap: {
    position: "relative",
    top: -18,
  },
  centerButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 10,
  },
});