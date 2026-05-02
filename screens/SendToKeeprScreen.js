import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useShareIntent } from "expo-share-intent";
import { navigationRef } from "../navigationRoot";

export default function SendToKeeprScreen() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  useEffect(() => {
    if (!hasShareIntent || !shareIntent) return;

    const file = shareIntent?.files?.[0];
    const text = shareIntent?.text;
    const url = shareIntent?.webUrl;

    // Normalize into something your system understands
    const payload = {
      type: file ? "file" : url ? "link" : text ? "text" : null,
      file,
      url,
      text,
    };

    navigationRef.navigate("SendToKeeprAssetPicker", {
  incomingShare: payload,
});

    resetShareIntent();
  }, [hasShareIntent, shareIntent]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}