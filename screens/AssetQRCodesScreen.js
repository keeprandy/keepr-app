// screens/AssetQRCodesScreen.js
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import QRCode from "react-native-qrcode-svg";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";

import { supabase } from "../lib/supabaseClient";
import { colors, spacing, radius, shadows } from "../styles/theme";

function genKac() {
  // Simple, stable-ish V1 generator (we can improve format later)
  const rand = () => Math.random().toString(16).slice(2, 6).toUpperCase();
  return `KPR-${rand()}-${rand()}`;
}

function getBaseUrl() {
  // V1: keep this simple. For production you’ll use https://keepr.app
  // If you want local QR codes while testing, set EXPO_PUBLIC_KEEPR_BASE_URL in .env.
  return process.env.EXPO_PUBLIC_KEEPR_BASE_URL || "https://keepr.app";
}

function htmlForSticker({ assetName, kac, qrDataUrl, url }) {
  // 50x30mm-ish sticker: keep it compact; printers vary.
  // You can tune sizing once you test your label printer.
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif; }
      .wrap { padding: 10px; }
      .title { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
      .kac { font-size: 12px; color: #444; margin-bottom: 8px; }
      .row { display: flex; gap: 10px; align-items: center; }
      img { width: 140px; height: 140px; }
      .url { font-size: 10px; color: #666; margin-top: 6px; word-break: break-all; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="title">${escapeHtml(assetName || "Asset")}</div>
      <div class="kac">${escapeHtml(kac || "")}</div>
      <div class="row">
        <img src="${qrDataUrl}" />
      </div>
      <div class="url">${escapeHtml(url)}</div>
    </div>
  </body>
</html>`;
}

function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export default function AssetQRCodesScreen({ route, navigation }) {
  
  const assetId = route?.params?.assetId;

  const [loading, setLoading] = useState(true);
  const [asset, setAsset] = useState(null);
  const [busy, setBusy] = useState(false);

  const qrRef = useRef(null);

  const baseUrl = useMemo(() => getBaseUrl(), []);
  const kac = asset?.kac_id || null;
  const url = useMemo(() => (kac ? `${baseUrl}/k/${encodeURIComponent(kac)}` : null), [baseUrl, kac]);

  useEffect(() => {
    let mounted = true;

    async function load() {
      try {
        if (!assetId) {
          Alert.alert("Missing asset", "No assetId was provided.");
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from("assets")
          .select("id, name, kac_id, owner_id")
          .eq("id", assetId)
          .single();

        if (error) throw error;
        if (!mounted) return;

        setAsset(data);
      } catch (e) {
        Alert.alert("Load failed", e?.message || "Unable to load asset.");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, [assetId]);

  const ensureKac = async () => {
    try {
      setBusy(true);

      // already has one
      if (asset?.kac_id) return;

      const newKac = genKac();

      const { data, error } = await supabase
        .from("assets")
        .update({ kac_id: newKac })
        .eq("id", assetId)
        .select("id, name, kac_id, owner_id")
        .single();

      if (error) throw error;

      setAsset(data);
    } catch (e) {
      Alert.alert("KAC error", e?.message || "Unable to generate KAC.");
    } finally {
      setBusy(false);
    }
  };

  const getQrPngDataUrl = async () => {
    return new Promise((resolve, reject) => {
      const node = qrRef.current;
      if (!node || typeof node.toDataURL !== "function") {
        reject(new Error("QR code not ready"));
        return;
      }
      node.toDataURL((base64) => {
        if (!base64) reject(new Error("QR export failed"));
        else resolve(`data:image/png;base64,${base64}`);
      });
    });
  };

  const onPrintSticker = async () => {
    try {
      if (!asset?.kac_id) {
        await ensureKac();
      }
      if (!url) throw new Error("Missing KAC URL");

      setBusy(true);

      const qrDataUrl = await getQrPngDataUrl();
      const html = htmlForSticker({
        assetName: asset?.name,
        kac: asset?.kac_id,
        qrDataUrl,
        url,
      });

      if (Platform.OS === "web") {
        // Web print: open a new window and print.
        const w = window.open("", "_blank");
        if (!w) throw new Error("Popup blocked. Allow popups to print.");
        w.document.open();
        w.document.write(html);
        w.document.close();
        w.focus();
        w.print();
        return;
      }

      await Print.printAsync({ html });
    } catch (e) {
      Alert.alert("Print failed", e?.message || "Unable to print.");
    } finally {
      setBusy(false);
    }
  };

  const onSharePdf = async () => {
    try {
      if (!asset?.kac_id) {
        await ensureKac();
      }
      if (!url) throw new Error("Missing KAC URL");

      setBusy(true);

      const qrDataUrl = await getQrPngDataUrl();
      const html = htmlForSticker({
        assetName: asset?.name,
        kac: asset?.kac_id,
        qrDataUrl,
        url,
      });

      if (Platform.OS === "web") {
        Alert.alert("Share not supported", "Use Print on web. Sharing is mobile-only in V1.");
        return;
      }

      const file = await Print.printToFileAsync({ html });
      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert("Sharing not available", "Sharing is not available on this device.");
        return;
      }
      await Sharing.shareAsync(file.uri);
    } catch (e) {
      Alert.alert("Share failed", e?.message || "Unable to share.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.container}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>

        <Text style={styles.h1}>QR Codes</Text>

        {loading ? (
          <Text style={styles.muted}>Loading…</Text>
        ) : !asset ? (
          <Text style={styles.muted}>Asset not found.</Text>
        ) : (
          <>
            <View style={styles.card}>
              <Text style={styles.kicker}>Asset</Text>
              <Text style={styles.assetName}>{asset.name || "Asset"}</Text>
              <Text style={styles.smallMuted}>KAC: {asset.kac_id || "—"}</Text>

              {!asset.kac_id ? (
                <TouchableOpacity style={styles.secondaryButton} onPress={ensureKac} disabled={busy}>
                  <Text style={styles.secondaryButtonText}>{busy ? "Working…" : "Generate KAC"}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <View style={styles.card}>
              <Text style={styles.kicker}>Sticker QR</Text>

              <View style={styles.qrWrap}>
                <QRCode
                  value={url || "https://keepr.app"}
                  size={220}
                  getRef={(c) => (qrRef.current = c)}
                />
              </View>

              <Text style={styles.smallMuted}>{url || "Generate KAC to create a QR URL."}</Text>

              <View style={styles.row}>
                <TouchableOpacity
                  style={[styles.button, (busy || !asset.kac_id) && styles.buttonDisabled]}
                  onPress={onPrintSticker}
                  disabled={busy || !asset.kac_id}
                >
                  <Text style={styles.buttonText}>{busy ? "Working…" : "Print sticker"}</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.secondaryButton, (busy || !asset.kac_id) && styles.buttonDisabled]}
                  onPress={onSharePdf}
                  disabled={busy || !asset.kac_id}
                >
                  <Text style={styles.secondaryButtonText}>Share PDF</Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.kicker}>Next</Text>
              <Text style={styles.muted}>
                Next we’ll add “Print full 8.5×11 sheet” with multiple QR stickers per asset/system.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  container: { padding: spacing.lg, gap: spacing.md },

  backRow: { paddingVertical: spacing.sm },
  backText: { color: colors.muted, fontSize: 14, fontWeight: "600" },

  h1: { fontSize: 22, fontWeight: "800", color: colors.text },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
    gap: spacing.sm,
  },

  kicker: { fontSize: 12, fontWeight: "800", color: colors.muted, textTransform: "uppercase" },
  assetName: { fontSize: 18, fontWeight: "800", color: colors.text },

  qrWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },

  row: { flexDirection: "row", gap: spacing.md, marginTop: spacing.sm },

  button: {
    flex: 1,
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  buttonText: { color: "white", fontSize: 15, fontWeight: "800" },

  secondaryButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: "center",
  },
  secondaryButtonText: { color: colors.text, fontSize: 15, fontWeight: "800" },

  buttonDisabled: { opacity: 0.55 },

  muted: { color: colors.muted, fontSize: 14 },
  smallMuted: { color: colors.muted, fontSize: 12 },
});
