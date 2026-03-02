import { Alert, Platform } from "react-native";

export function confirmRemove(message, onConfirm) {
  if (Platform.OS === "web") {
    if (window.confirm(message)) onConfirm();
    return;
  }

  Alert.alert("Remove photo", message, [
    { text: "Cancel", style: "cancel" },
    { text: "Remove", style: "destructive", onPress: onConfirm },
  ]);
}