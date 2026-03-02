// screens/AddVehicleChatScreen.js
import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import {
  colors,
  spacing,
  radius,
  typography,
  shadows,
} from "../styles/theme";

import { useVehicles } from "../context/VehiclesContext";

export default function AddVehicleChatScreen({ navigation }) {
  const { setVehicles } = useVehicles();

  const [messages, setMessages] = useState([
    {
      id: "sys-1",
      from: "keepr",
      text: "Let’s add a vehicle. Start with the year, make, and model (for example: 2000 Porsche Boxster S).",
    },
  ]);

  const [step, setStep] = useState(0);
  const [input, setInput] = useState("");

  // Collected answers
  const [vehicleName, setVehicleName] = useState("");
  const [vehicleUsage, setVehicleUsage] = useState("");
  const [vehicleNotes, setVehicleNotes] = useState("");

  // Simple preview plan
  const [previewTasks, setPreviewTasks] = useState([]);

  const appendMessage = (msg) => {
    setMessages((prev) => [...prev, msg]);
  };

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const userMsg = {
      id: `user-${Date.now()}`,
      from: "user",
      text: trimmed,
    };

    appendMessage(userMsg);
    setInput("");

    if (step === 0) {
      // Q1: year/make/model
      setVehicleName(trimmed);

      appendMessage({
        id: "sys-2",
        from: "keepr",
        text: "Great. How do you mostly use this vehicle? (For example: weekend drives, daily commuting, long-distance touring, track days, etc.)",
      });

      setStep(1);
    } else if (step === 1) {
      // Q2: usage
      setVehicleUsage(trimmed);

      appendMessage({
        id: "sys-3",
        from: "keepr",
        text: "Any known issues, upgrades, or important context? (For example: major service done, common problem you want to watch, or how you like to care for it.)",
      });

      setStep(2);
    } else if (step === 2) {
      // Q3: context / issues / upgrades
      setVehicleNotes(trimmed);

      const baseName = vehicleName || "this vehicle";
      const tasks = [
        `Set up a baseline maintenance schedule for ${baseName}.`,
        `Log how you use it: ${trimmed || "usage and conditions."}`,
        `Capture any important history or known issues so future work is easier.`,
      ];

      setPreviewTasks(tasks);

      appendMessage({
        id: "sys-4",
        from: "keepr",
        text:
          "Here’s a simple Maintain plan Keepr can attach to this vehicle as a checklist. You can refine it later:",
      });

      appendMessage({
        id: "sys-5",
        from: "keepr",
        text: tasks.map((t, idx) => `${idx + 1}. ${t}`).join("\n"),
      });

      appendMessage({
        id: "sys-6",
        from: "keepr",
        text:
          "When you’re ready, tap “Add to Garage” below and Keepr will create this vehicle with this Maintain plan.",
      });

      setStep(3);
    } else {
      // After step 3, extra messages are just acknowledged
      appendMessage({
        id: `sys-extra-${Date.now()}`,
        from: "keepr",
        text:
          "You can refine this later in the vehicle’s story. When you’re ready, tap “Add to Garage” to save it.",
      });
    }
  };

  const handleAddToGarage = () => {
    const name = vehicleName || "New vehicle";
    const id = `vehicle-${Date.now()}`;

    // 🔹 1) Build Maintain tasks from preview
    const maintainTasks = previewTasks.map((line, index) => ({
      id: `${id}-plan-${index + 1}`,
      label: line,
      cadence: null,
      status: "open",
      lastCompletedOn: null,
      lastNotes: null,
    }));

    // 🔹 2) Smart hero image defaults for *your* real demo vehicles
    let image = null;
    let photos = [];

    const lowerName = name.toLowerCase();

    try {
      if (lowerName.includes("boxster")) {
        // Your Boxster hero image
        image = require("../assets/vehicles/vehicle_porsche_hero.jpg");
        photos = [image];
      } else if (lowerName.includes("tracer")) {
        // Your Tracer hero image
        image = require("../assets/vehicles/vehicle_yamaha_tracer.jpg");
        photos = [image];
      }
    } catch (e) {
      // In Snack / bundler issues, fail gracefully
      image = null;
      photos = [];
    }

    // 🔹 3) Construct the new vehicle object
    const newVehicle = {
      id,
      type: "vehicle",
      name,
      nickname: name,
      category: null,
      location: null,

      // Hero + gallery for Garage / Showcase
      image,
      photos,

      year: null,
      make: null,
      model: name,
      vin: null,
      purchaseDate: null,
      purchasePrice: null,
      odometerMiles: null,
      estimatedValue: null,
      tags: [],

      usageProfile: {
        primaryUse: vehicleUsage || null,
        secondaryUse: null,
        notes: vehicleNotes ? [vehicleNotes] : [],
      },

      baseSpec: null,
      maintainProfile: null,

      // Actionable Maintain plan we generated from chat
      maintainTasks,

      notes:
        vehicleNotes ||
        "Vehicle added via the Keepr Add Vehicle chat. You can refine its story, usage, and Maintain plan at any time.",
      serviceHistory: [],
    };

    // 🔹 4) Persist into VehiclesContext
    setVehicles((prev) => [...prev, newVehicle]);
    navigation.goBack();
  };

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Garage");
  };

  const canAddToGarage = step >= 3 && previewTasks.length > 0;

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 60 : 0}
      >
        <View style={styles.contentWrapper}>
          <View style={styles.container}>
            {/* Header */}
            <View style={styles.headerRow}>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={handleBack}
                activeOpacity={0.8}
              >
                <Ionicons
                  name="chevron-back-outline"
                  size={20}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>
              <View style={styles.headerTextWrap}>
                <Text style={styles.title}>Add vehicle</Text>
                <Text style={styles.subtitle}>
                  Answer a few questions and Keepr will build the profile and a simple Maintain plan.
                </Text>
              </View>
            </View>

            {/* Chat area */}
            <View style={styles.chatCard}>
              <ScrollView
                style={styles.chatScroll}
                contentContainerStyle={styles.chatContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                {messages.map((m) => (
                  <View
                    key={m.id}
                    style={
                      m.from === "keepr"
                        ? styles.keeprBubble
                        : styles.userBubble
                    }
                  >
                    <Text
                      style={[
                        styles.bubbleText,
                        m.from === "user" && { color: colors.brandWhite },
                      ]}
                    >
                      {m.text}
                    </Text>
                  </View>
                ))}
              </ScrollView>

              {/* Maintain plan preview */}
              {canAddToGarage && (
                <View style={styles.previewCard}>
                  <Text style={styles.previewTitle}>Maintain plan preview</Text>
                  {previewTasks.map((t, idx) => (
                    <View key={idx} style={styles.previewRow}>
                      <View style={styles.previewBullet} />
                      <Text style={styles.previewText}>{t}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Input row */}
              <View style={styles.inputRow}>
                <TextInput
                  style={styles.input}
                  value={input}
                  onChangeText={setInput}
                  placeholder="Type your answer..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  blurOnSubmit={false}
                />
                <TouchableOpacity
                  style={styles.sendButton}
                  onPress={handleSend}
                  activeOpacity={0.9}
                >
                  <Ionicons
                    name="arrow-up"
                    size={18}
                    color={colors.brandWhite}
                  />
                </TouchableOpacity>
              </View>

              {canAddToGarage && (
                <TouchableOpacity
                  style={styles.addButton}
                  onPress={handleAddToGarage}
                  activeOpacity={0.9}
                >
                  <Text style={styles.addButtonText}>Add to Garage</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  contentWrapper: {
    flex: 1,
    alignItems: "center",
  },
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 900,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.sm,
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: 2,
  },

  chatCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
    padding: spacing.md,
  },
  chatScroll: {
    flex: 1,
  },
  chatContent: {
    paddingBottom: spacing.md,
  },
  keeprBubble: {
    alignSelf: "flex-start",
    maxWidth: "90%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: spacing.xs,
  },
  userBubble: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
    marginBottom: spacing.xs,
  },
  bubbleText: {
    fontSize: 13,
    color: colors.textPrimary,
  },

  previewCard: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  previewTitle: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 2,
  },
  previewBullet: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.textSecondary,
    marginTop: 6,
    marginRight: spacing.xs,
  },
  previewText: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
  },

  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    marginTop: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
    textAlignVertical: "top",
    marginRight: spacing.xs,
  },
  sendButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
  },

  addButton: {
    marginTop: spacing.sm,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentGreen,
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.brandWhite,
  },
});
