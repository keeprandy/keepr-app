// screens/KacRouteScreen.js
// Lightweight route helper for deep links like /k/<KAC>
// - If navigation passes params, we use them.
// - If params are missing (common on web deep-links), we parse the URL.

import React, { useEffect, useMemo } from "react";
import { ActivityIndicator, Platform, Text, View } from "react-native";

const IS_WEB = Platform.OS === "web";

function getKacFromUrlFallback() {
  try {
    if (!IS_WEB) return null;
    // eslint-disable-next-line no-undef
    const href = typeof window !== "undefined" ? window.location.href : "";
    if (!href) return null;
    // eslint-disable-next-line no-undef
    const url = new URL(href);

    const q = url.searchParams.get("kac") || url.searchParams.get("KAC");
    if (q) return decodeURIComponent(q).trim();

    const path = (url.pathname || "").replace(/\/+$/, "");
    const m = path.match(/\/(k|kac)\/([^/]+)$/i);
    if (m?.[2]) return decodeURIComponent(m[2]).trim();

    const hash = (url.hash || "").replace(/^#/, "");
    const mh = hash.match(/\/(k|kac)\/([^/]+)$/i);
    if (mh?.[2]) return decodeURIComponent(mh[2]).trim();

    return null;
  } catch {
    return null;
  }
}

export default function KacRouteScreen({ route, navigation }) {
  const kac = useMemo(() => {
    return (
      route?.params?.kac ||
      route?.params?.kacId ||
      route?.params?.kac_id ||
      getKacFromUrlFallback() ||
      null
    );
  }, [route?.params?.kac, route?.params?.kacId, route?.params?.kac_id]);

  useEffect(() => {
    if (!kac) return;
    navigation.replace("PublicAction", { kac });
  }, [kac, navigation]);

  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
      <ActivityIndicator />
      <Text>{kac ? "Opening…" : "Missing KAC."}</Text>
      {!kac && IS_WEB ? (
        <Text style={{ opacity: 0.7 }}>Try /k/KPR-XXXX-YYYY or ?kac=KPR-XXXX-YYYY</Text>
      ) : null}
    </View>
  );
}
