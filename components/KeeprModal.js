// components/KeeprModal.js
import React from "react";
import {
  Modal,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  View,
  StyleSheet,
} from "react-native";
import { spacing, radius, colors } from "../styles/theme";

export default function KeeprModal({
  visible,
  onRequestClose,
  children,
  animationType = "fade",
}) {
  return (
    <Modal
      visible={visible}
      onRequestClose={onRequestClose}
      animationType={animationType}
      transparent
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.backdrop}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <View style={styles.card}>{children}</View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.65)", // subtle slate overlay
    paddingHorizontal: spacing.md,          // keep card away from screen edges
    justifyContent: "center",
    alignItems: "center",
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "stretch",
    width: "100%",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignSelf: "stretch",           // stretch within padded backdrop
    maxWidth: 480,                  // looks good on tablets / web
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
});
