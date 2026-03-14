import React from "react";
import { Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import KaiOrb from "../components/KaiOrb";

export default function KaiWelcomeScreen({ navigation, route }) {
  const standardOnboardingRoute =
    route?.params?.standardOnboardingRoute || "Onboarding";
  const skipRoute = route?.params?.skipRoute || "Dashboard";
  const kaiOnboardingRoute = route?.params?.kaiOnboardingRoute || "KaiOnboarding";

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.orbWrap}>
          <KaiOrb size={88} />
        </View>

        <Text style={styles.eyebrow}>Keepr™ Asset Intelligence</Text>
        <Text style={styles.title}>Hello — I’m Kai.</Text>
        <Text style={styles.subtitle}>
          KAI standards for Keepr™ Asset Intelligence. I’ll help you get started and show you how Keepr™
organizes the story of the things you own.
        </Text>

        <Text style={styles.prompt}>How would you like to begin?</Text>

        <Pressable
          style={({ pressed }) => [
            styles.primaryBtn,
            pressed && { opacity: 0.94 },
          ]}
          onPress={() =>
  navigation.navigate("OnboardingStack", { screen: "Onboarding1" })
}
        >
          <Text style={styles.primaryBtnText}>Start with Kai</Text>
          <Text style={styles.primaryBtnSub}>
            Guided setup in under a minute
          </Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [
            styles.secondaryCard,
            pressed && { opacity: 0.96 },
          ]}
          onPress={() => navigation.navigate("Onboarding1", { mode: "standard" })}
        >
          <Text style={styles.secondaryTitle}>Use standard onboarding</Text>
          <Text style={styles.secondarySub}>
            Jump into the existing Keepr flow
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.ghostBtn,
            pressed && { opacity: 0.8 },
          ]}
          onPress={() =>
            navigation.reset({
              index: 0,
              routes: [{ name: "RootTabs", params: { screen: "Dashboard" } }],
            })
          }
        >
          <Text style={styles.ghostBtnText}>Skip for now</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F7FB",
  },
  content: {
    flex: 1,
    maxWidth: 720,
    width: "100%",
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 52,
    paddingBottom: 28,
    justifyContent: "center",
  },
  orbWrap: {
    alignItems: "center",
    marginBottom: 18,
  },
  eyebrow: {
    textAlign: "center",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.4,
    color: "#2563EB",
    marginBottom: 10,
  },
  title: {
    textAlign: "center",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "800",
    color: "#111827",
  },
  subtitle: {
    marginTop: 12,
    textAlign: "center",
    fontSize: 16,
    lineHeight: 24,
    color: "#6B7280",
    maxWidth: 620,
    alignSelf: "center",
  },
  prompt: {
    marginTop: 30,
    marginBottom: 16,
    textAlign: "center",
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },
  primaryBtn: {
    borderRadius: 24,
    backgroundColor: "#0F172A",
    paddingVertical: 18,
    paddingHorizontal: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  primaryBtnSub: {
    color: "#CBD5E1",
    fontSize: 13,
    marginTop: 4,
  },
  secondaryCard: {
    marginTop: 14,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingVertical: 18,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  secondaryTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#111827",
  },
  secondarySub: {
    marginTop: 4,
    fontSize: 13,
    color: "#6B7280",
  },
  ghostBtn: {
    alignSelf: "center",
    marginTop: 18,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  ghostBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#6B7280",
  },
});
