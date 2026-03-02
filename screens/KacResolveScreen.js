// screens/KacResolveScreen.js
// Debug/utility screen: resolves a KAC via Edge Function and shows the result.

import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { colors, spacing, radius } from "../styles/theme";

const PROJECT_REF = "jjzjuqxysucqutgjnrkk";
const FUNCTIONS_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

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

async function postFunction(path, body) {
  const res = await fetch(`${FUNCTIONS_BASE}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(ANON_KEY ? { apikey: ANON_KEY } : {}),
    },
    body: JSON.stringify(body || {}),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) throw new Error(json?.error || json?.message || `HTTP ${res.status}`);
  return json;
}

export default function KacResolveScreen({ route, navigation }) {
  const kac = useMemo(() => {
    return (
      route?.params?.kac ||
      route?.params?.kacId ||
      route?.params?.kac_id ||
      getKacFromUrlFallback() ||
      null
    );
  }, [route?.params?.kac, route?.params?.kacId, route?.params?.kac_id]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!kac) {
        setLoading(false);
        setError("Missing KAC.");
        return;
      }
      setLoading(true);
      setError("");
      try {
        const json = await postFunction("kac-resolve", {
          kac,
          channel: "qr",
          action: "scan",
        });
        if (cancelled) return;
        setResult(json || null);
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || "Resolve failed.");
        setResult(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [kac]);

  const goToActions = () => {
    if (!kac) return;
    navigation.navigate("PublicAction", { kac });
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.wrap}>
        <Text style={styles.h1}>KAC Resolve</Text>
        <Text style={styles.sub}>
          {kac ? `KAC: ${kac}` : "Missing KAC."}
        </Text>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
          </View>
        ) : null}

        {!!error && !loading ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {!!result && !loading ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Result</Text>
            <Text style={styles.code}>{JSON.stringify(result, null, 2)}</Text>
          </View>
        ) : null}

        <TouchableOpacity
          onPress={goToActions}
          disabled={!kac}
          style={[styles.primaryBtn, !kac && { opacity: 0.5 }]}
        >
          <Text style={styles.primaryBtnText}>Open Public Actions</Text>
        </TouchableOpacity>

        {!kac && IS_WEB ? (
          <Text style={styles.hint}>Try /k/KPR-XXXX-YYYY or ?kac=KPR-XXXX-YYYY</Text>
        ) : null}

        <TouchableOpacity
          onPress={() => Alert.alert("Next", "Wire resolve -> actions -> event inbox proposals.")}
          style={styles.secondaryBtn}
        >
          <Text style={styles.secondaryBtnText}>What’s next?</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  wrap: { flex: 1, padding: spacing.lg },
  h1: { fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  sub: { marginTop: 6, fontSize: 12, color: colors.textMuted },
  hint: { marginTop: 10, fontSize: 12, color: colors.textMuted },
  center: { paddingVertical: spacing.lg },
  errorBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg || 14,
    backgroundColor: "#FEE2E2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  errorText: { color: "#991B1B", fontSize: 12 },
  card: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg || 14,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.surface,
  },
  cardTitle: { fontSize: 13, fontWeight: "900", color: colors.textPrimary },
  code: { marginTop: 10, fontSize: 11, color: colors.textPrimary },
  primaryBtn: {
    marginTop: spacing.lg,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
  },
  primaryBtnText: { color: "#fff", fontWeight: "900" },
  secondaryBtn: {
    marginTop: spacing.sm,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  secondaryBtnText: { color: colors.textPrimary, fontWeight: "900" },
});
