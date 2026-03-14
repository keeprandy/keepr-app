import React, { useMemo, useState } from "react";
import { Alert, Pressable, SafeAreaView, StyleSheet, Text, View } from "react-native";
import KaiOrb from "../components/KaiOrb";

const QUESTIONS = [
  {
    key: "info_source",
    title: "Where do you usually keep information about the things you own?",
    choices: [
      "Email",
      "Paper files",
      "Notes or spreadsheets",
      "Different places",
      "I’m not really sure",
    ],
  },
  {
    key: "retrieval_confidence",
    title:
      "If something broke tomorrow, would you quickly know who installed it, when it was last serviced, and whether it’s still under warranty?",
    choices: ["Yes", "Some of it", "Probably not"],
  },
  {
    key: "routine_tracking",
    title: "Do you track seasonal or recurring services anywhere today?",
    choices: ["Calendar reminders", "Notes or lists", "My head", "Not really"],
  },
];

const ASSET_OPTIONS = [
  { key: "home", label: "My home" },
  { key: "vehicle", label: "A vehicle" },
  { key: "boat", label: "A boat" },
  { key: "other", label: "Return to Dashboard" },
];

export default function KaiOnboardingScreen({ navigation, route }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [assetType, setAssetType] = useState("home");

const nextRoute =
  route?.params?.nextRoute || "OnboardingChooseAssetType";
  const skipRoute = route?.params?.skipRoute || "Dashboard";

  const inQuestions = stepIndex < QUESTIONS.length;
  const onModelStep = stepIndex === QUESTIONS.length;
  const onAssetChoiceStep = stepIndex === QUESTIONS.length + 1;

  const activeQuestion = QUESTIONS[stepIndex] || null;
  const selected = activeQuestion ? answers[activeQuestion.key] : null;

  const summary = useMemo(() => {
    if (answers.info_source === "I’m not really sure") {
      return "That’s very common. A lot of ownership information ends up scattered across memory, email, paper, and disconnected files.";
    }
    return "That’s very common. Most ownership information ends up spread across email, notes, files, and memory.";
  }, [answers]);

  const nextDisabled =
    (inQuestions && !selected) || (onAssetChoiceStep && !assetType);

const handleNext = () => {
  console.log("Kai handleNext", {
    stepIndex,
    inQuestions,
    onModelStep,
    onAssetChoiceStep,
    assetType,
  });

  if (inQuestions) {
    setStepIndex((s) => s + 1);
    return;
  }

  if (onModelStep) {
    setStepIndex((s) => s + 1);
    return;
  }

if (onAssetChoiceStep) {
  if (assetType === "home") {
    navigation.navigate("AddHomeAsset");
    return;
  }

  if (assetType === "vehicle") {
    navigation.navigate("AddVehicleAsset");
    return;
  }

  if (assetType === "boat") {
    navigation.navigate("AddMarineAsset");
    return;
  }

  navigation.navigate("RootTabs");
  return;
}
};

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <View style={styles.headerRow}>
          <View style={styles.orbWrap}>
          <KaiOrb size={88} />
          </View>
          <Text style={styles.headerLabel}>Let's get started...</Text>
        </View>

        {inQuestions ? (
          <>
            <Text style={styles.stepLabel}>
              Question {stepIndex + 1} of {QUESTIONS.length}
            </Text>
            <Text style={styles.title}>{activeQuestion.title}</Text>

            <View style={styles.choiceList}>
              {activeQuestion.choices.map((choice) => {
                const isSelected = selected === choice;
                return (
                  <Pressable
                    key={choice}
                    onPress={() =>
                      setAnswers((prev) => ({
                        ...prev,
                        [activeQuestion.key]: choice,
                      }))
                    }
                    style={({ pressed }) => [
                      styles.choiceCard,
                      isSelected && styles.choiceCardSelected,
                      pressed && { opacity: 0.96 },
                    ]}
                  >
                    <View
                      style={[
                        styles.choiceDot,
                        isSelected && styles.choiceDotSelected,
                      ]}
                    />
                    <Text
                      style={[
                        styles.choiceText,
                        isSelected && styles.choiceTextSelected,
                      ]}
                    >
                      {choice}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : onModelStep ? (
          <>
            <Text style={styles.stepLabel}>Happy your're here! </Text>
            <Text style={styles.title}>
              Keepr™ organizes things around four simple ideas.
            </Text>

            <View style={styles.modelCard}>
              <Text style={styles.modelItem}>
                <Text style={styles.modelStrong}>Asset</Text> — the thing you
                own, like a home, vehicle, boat, or motorcycle.
              </Text>
              <Text style={styles.modelItem}>
                <Text style={styles.modelStrong}>System</Text> — a major part
                inside it, like HVAC, a generator, plumbing, or a motor.
              </Text>
              <Text style={styles.modelItem}>
                <Text style={styles.modelStrong}>Record</Text> — something that
                happened, like a repair, replacement, inspection, or moment in
                time.
              </Text>
              <Text style={styles.modelItem}>
                <Text style={styles.modelStrong}>Proof</Text> — the documents or
                photos that back it up, like an invoice, receipt, manual, or
                warranty.
              </Text>
            </View>

            <Text style={styles.summaryText}>{summary}</Text>

            <Text style={styles.storyText}>
              Every asset has a story. Every system has a story. Over time,
              Keepr™ helps you build that story so you — and the people who help
              you — Your Team, Family, KeeprPros - can understand, maintain, and help you.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.stepLabel}>Let’s get started</Text>
            <Text style={styles.title}>What would you like to start with?</Text>

            <View style={styles.choiceList}>
              {ASSET_OPTIONS.map((option) => {
                const isSelected = assetType === option.key;
                return (
                  <Pressable
                    key={option.key}
                    onPress={() => setAssetType(option.key)}
                    style={({ pressed }) => [
                      styles.choiceCard,
                      isSelected && styles.choiceCardSelected,
                      pressed && { opacity: 0.96 },
                    ]}
                  >
                    <View
                      style={[
                        styles.choiceDot,
                        isSelected && styles.choiceDotSelected,
                      ]}
                    />
                    <Text
                      style={[
                        styles.choiceText,
                        isSelected && styles.choiceTextSelected,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.summaryText}>
              I’ll hand you into the existing Keepr™ interface flow and stay out of
              your way.  Time to be a Keepr™!
            </Text>
          </>
        )}

        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.linkBtn,
              pressed && { opacity: 0.8 },
            ]}
            onPress={() =>
              stepIndex === 0
                ? navigation.navigate(skipRoute)
                : setStepIndex((s) => Math.max(0, s - 1))
            }
          >
            <Text style={styles.linkBtnText}>
              {stepIndex === 0 ? "Skip for now" : "Back"}
            </Text>
          </Pressable>

          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              nextDisabled && styles.primaryBtnDisabled,
              pressed && !nextDisabled && { opacity: 0.94 },
            ]}
            disabled={nextDisabled}
            onPress={handleNext}
          >
            <Text style={styles.primaryBtnText}>
              {onAssetChoiceStep ? "Start building" : "Next"}
            </Text>
          </Pressable>
        </View>
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
    width: "100%",
    maxWidth: 820,
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 28,
    justifyContent: "space-between",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 22,
  },
   orbWrap: {
    width: 120,
  height: 120,
  alignItems: "center",
  marginBottom: 18,
  },
  headerLabel: {
    marginLeft: 10,
    fontSize: 14,
    fontWeight: "800",
    color: "#111827",
  },
  stepLabel: {
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
    color: "#2563EB",
    marginBottom: 10,
  },
  title: {
    fontSize: 30,
    lineHeight: 38,
    fontWeight: "800",
    color: "#111827",
    maxWidth: 760,
  },
  choiceList: {
    marginTop: 22,
    gap: 12,
  },
  choiceCard: {
    minHeight: 62,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
  },
  choiceCardSelected: {
    borderColor: "#93C5FD",
    backgroundColor: "#EFF6FF",
  },
  choiceDot: {
    width: 22,
    height: 22,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "#D1D5DB",
    marginRight: 14,
    backgroundColor: "#FFFFFF",
  },
  choiceDotSelected: {
    borderColor: "#2563EB",
    backgroundColor: "#2563EB",
  },
  choiceText: {
    flex: 1,
    fontSize: 17,
    fontWeight: "700",
    color: "#111827",
  },
  choiceTextSelected: {
    color: "#111827",
  },
  modelCard: {
    marginTop: 22,
    padding: 18,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    gap: 12,
  },
  modelItem: {
    fontSize: 16,
    lineHeight: 24,
    color: "#374151",
  },
  modelStrong: {
    fontWeight: "800",
    color: "#111827",
  },
  summaryText: {
    marginTop: 18,
    fontSize: 16,
    lineHeight: 24,
    color: "#4B5563",
    maxWidth: 720,
  },
  storyText: {
    marginTop: 14,
    fontSize: 18,
    lineHeight: 28,
    color: "#111827",
    fontWeight: "600",
    maxWidth: 760,
  },
  footer: {
    marginTop: 28,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  linkBtn: {
    paddingVertical: 12,
    paddingHorizontal: 6,
  },
  linkBtnText: {
    fontSize: 15,
    fontWeight: "700",
    color: "#6B7280",
  },
  primaryBtn: {
    minWidth: 160,
    height: 50,
    borderRadius: 999,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  primaryBtnDisabled: {
    backgroundColor: "#CBD5E1",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
  },
});
