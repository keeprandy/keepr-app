import React, { useEffect, useRef } from "react";
import { Animated, View, StyleSheet } from "react-native";

export default function KaiOrb({ size = 80 }) {
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(0.6)).current;

  useEffect(() => {
    Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(scale, {
            toValue: 1.08,
            duration: 2600,
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: 2600,
            useNativeDriver: true,
          }),
        ]),
        Animated.sequence([
          Animated.timing(glow, {
            toValue: 1,
            duration: 2600,
            useNativeDriver: true,
          }),
          Animated.timing(glow, {
            toValue: 0.6,
            duration: 2600,
            useNativeDriver: true,
          }),
        ]),
      ])
    ).start();
  }, []);

  return (
    <View style={{ width: size * 2, height: size * 2, alignItems: "center", justifyContent: "center" }}>
      
      <Animated.View
        style={[
          styles.outerGlow,
          {
            width: size * 2,
            height: size * 2,
            borderRadius: size,
            opacity: glow,
            transform: [{ scale }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.orb,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            transform: [{ scale }],
          },
        ]}
      />

    </View>
  );
}

const styles = StyleSheet.create({
  orb: {
    backgroundColor: "#2F6BFF", // Keepr Blue
    shadowColor: "#2F6BFF",
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  outerGlow: {
    position: "absolute",
    backgroundColor: "#2F6BFF",
  },
});