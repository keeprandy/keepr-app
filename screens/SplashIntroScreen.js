import React, { useEffect, useRef } from "react";
import {
    Animated,
    Image,
    Platform,
    StatusBar,
    StyleSheet
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, spacing } from "../styles/theme";

const LOGO = require("../assets/keepr-splash.png");

// ✅ Native driver only where it exists
const USE_NATIVE_DRIVER = Platform.OS !== "web";

export default function SplashIntroScreen({ navigation }) {
  const opacity = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(16)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 4000,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: 800,
        useNativeDriver: USE_NATIVE_DRIVER,
      }),
    ]).start();

    const timer = setTimeout(() => {
      navigation?.reset?.({
        index: 0,
        routes: [{ name: "RootTabs" }],
      });
    }, 1600);

    return () => clearTimeout(timer);
  }, [navigation, opacity, translateY]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar
        barStyle="light-content"
        backgroundColor={colors.background || "#0B1740"}
      />
      <Animated.View
        style={[
          styles.content,
          {
            opacity,
            transform: [{ translateY }],
          },
        ]}
      >
        <Image source={LOGO} style={styles.logo} resizeMode="contain" />
      </Animated.View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#20244d",
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },
  logo: {
    width: 500,
    height: 500,
  },
});
