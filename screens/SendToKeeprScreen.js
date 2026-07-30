import React, { useEffect } from "react";
import { View, ActivityIndicator } from "react-native";
import { useShareIntent } from "expo-share-intent";
import { navigationRef } from "../navigationRoot";
import { normalizeShareIntentPayload } from "../lib/shareIntentPayload";

export default function SendToKeeprScreen() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent();

  useEffect(() => {
    if (!hasShareIntent || !shareIntent) return;

    const payload = normalizeShareIntentPayload(shareIntent);
    if (!payload) return;

    setTimeout(() => {
      navigationRef.navigate("SendToKeeprAssetPicker", {
        incomingShare: payload,
      });

      resetShareIntent();
    }, 0);
  }, [hasShareIntent, shareIntent, resetShareIntent]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
      <ActivityIndicator />
    </View>
  );
}
