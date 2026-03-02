// components/KeeprBreadcrumbs.js
import React, { useMemo } from "react";
import { View, Text, TouchableOpacity, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

export default function KeeprBreadcrumbs({ items = [], maxItems = 4, style }) {
  const safeItems = useMemo(() => {
    const arr = (items || []).filter((x) => x && x.label);
    if (arr.length <= maxItems) return arr;

    // Collapse middle items to keep the row clean.
    const first = arr[0];
    const last = arr[arr.length - 1];
    return [first, { key: "__more__", label: "…", disabled: true }, last];
  }, [items, maxItems]);

  return (
    <View style={[styles.row, style]}>
      {safeItems.map((it, idx) => {
        const key = it.key || `${idx}-${it.label}`;
        const clickable = typeof it.onPress === "function" && !it.disabled;
        const Wrapper = clickable ? TouchableOpacity : View;

        return (
          <View key={key} style={styles.itemWrap}>
            {idx > 0 && (
              <Ionicons
                name="chevron-forward"
                size={14}
                color="#8B97A7"
                style={styles.sep}
              />
            )}
            <Wrapper
              onPress={clickable ? it.onPress : undefined}
              activeOpacity={0.85}
              style={styles.item}
            >
              <Text
                numberOfLines={1}
                style={[
                  styles.label,
                  clickable && styles.link,
                  it.disabled && styles.disabled,
                ]}
              >
                {it.label}
              </Text>
            </Wrapper>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  itemWrap: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  sep: { marginHorizontal: 4 },
  item: { minWidth: 0 },
  label: {
    fontSize: 13,
    color: "#5B6B7D",
    maxWidth: 260,
  },
  link: {
    color: "#2F6FED",
    fontWeight: "600",
  },
  disabled: { color: "#9AA6B2" },
});
