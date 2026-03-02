// components/OperationFeedbackModal.js
import React, { useEffect, useMemo, useRef } from "react";
import { ActivityIndicator, Animated, Modal, Platform, StyleSheet, Text, View } from "react-native";
import { useOperationFeedback } from "../context/OperationFeedbackContext";

/**
 * Keepr-styled global feedback UI:
 * 1) Busy modal (blocking) — for longer operations like Uploading…
 * 2) Feedback modal (non-blocking) — fades in/out, auto-dismiss
 *
 * Mount once near the root (inside OperationFeedbackProvider).
 */

export default function OperationFeedbackModal() {
  const { feedback, busy } = useOperationFeedback();

  const fade = useRef(new Animated.Value(0)).current;

  const feedbackVisible = !!feedback?.visible;
  const feedbackType = feedback?.type || "success";
  const feedbackMessage = feedback?.message || "";

  const busyVisible = !!busy?.visible;
  const busyMessage = busy?.message || "Working…";

  useEffect(() => {
    if (feedbackVisible) {
      Animated.timing(fade, {
        toValue: 1,
        duration: 140,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(fade, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }).start();
    }
  }, [feedbackVisible, fade]);

  const feedbackCardStyle = useMemo(() => {
    const base = [styles.card];
    if (feedbackType === "error") base.push(styles.cardError);
    else base.push(styles.cardSuccess);
    return base;
  }, [feedbackType]);

  const accentStyle = useMemo(() => {
    return feedbackType === "error" ? styles.accentError : styles.accentSuccess;
  }, [feedbackType]);

  return (
    <>
      {/* Busy modal (blocking) */}
      <Modal visible={busyVisible} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={styles.backdropBusy}>
          <View style={[styles.card, styles.busyCard]}>
            <View style={styles.busyRow}>
              <ActivityIndicator />
              <View style={styles.busyTextCol}>
                <Text style={styles.busyTitle}>{busyMessage}</Text>
                <Text style={styles.busySub}>Please wait…</Text>
              </View>
            </View>
          </View>
        </View>
      </Modal>

      {/* Feedback modal (non-blocking, fades out) */}
      <Modal visible={feedbackVisible} transparent animationType="none" onRequestClose={() => {}}>
        <View pointerEvents="none" style={styles.backdrop}>
          <Animated.View
            style={[
              ...feedbackCardStyle,
              {
                opacity: fade,
                transform: [
                  {
                    scale: fade.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.985, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={[styles.accent, accentStyle]} />
            <Text style={styles.feedbackText}>{feedbackMessage}</Text>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  // Subtle Keepr backdrop: soft dim, not black
  backdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  backdropBusy: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
    backgroundColor: "rgba(0,0,0,0.16)",
  },

  // Keepr card: light, calm
  card: {
    minWidth: Platform.OS === "web" ? 360 : "78%",
    maxWidth: 520,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.08)",
    shadowColor: "#000",
    shadowOpacity: 0.10,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },

  // Accent bar (Keepr-style, subtle)
  accent: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 6,
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
    opacity: 0.95,
  },
  accentSuccess: {
    backgroundColor: "#1F8A5B", // calm green
  },
  accentError: {
    backgroundColor: "#C2413A", // calm red
  },

  cardSuccess: {
    backgroundColor: "#FFFFFF",
  },
  cardError: {
    backgroundColor: "#FFFFFF",
  },

  feedbackText: {
    color: "#0F172A",
    fontSize: 14,
    fontWeight: "800",
    textAlign: "center",
    paddingLeft: 10,
    paddingRight: 10,
  },

  // Busy card styling
  busyCard: {
    paddingVertical: 16,
  },
  busyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    justifyContent: "center",
  },
  busyTextCol: {
    flexShrink: 1,
  },
  busyTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "800",
  },
  busySub: {
    marginTop: 2,
    color: "rgba(15, 23, 42, 0.70)",
    fontSize: 12,
    fontWeight: "600",
  },
});
