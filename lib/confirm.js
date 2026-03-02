// lib/confirm.js
import { Platform, Alert } from "react-native";

/**
 * Cross-platform confirmation for destructive actions.
 * Web: window.confirm (reliable on react-native-web)
 * Native: Alert.alert with buttons
 */
export function confirmAction(title, message, confirmLabel = "OK", onConfirm) {
  if (Platform.OS === "web") {
    const ok = typeof window !== "undefined" ? window.confirm(`${title}\n\n${message}`) : true;
    if (ok) onConfirm?.();
    return;
  }

  Alert.alert(title, message, [
    { text: "Cancel", style: "cancel" },
    { text: confirmLabel, style: "destructive", onPress: onConfirm },
  ]);
}

export function confirmDestructive(title, message, onConfirm) {
  return confirmAction(title, message, "Delete", onConfirm);
}
