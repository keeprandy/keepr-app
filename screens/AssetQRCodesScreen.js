// screens/AssetQRCodesScreen.js
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
} from "react-native";
import QRCode from "react-native-qrcode-svg";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "../lib/supabaseClient";
import { colors, radius, shadows, spacing } from "../styles/theme";
import * as Clipboard from "expo-clipboard";
import { Share } from "react-native";
import { Asset } from "expo-asset";

const qrFrame = require("../assets/public/keepr-enabled-band-500.png");

function genKac() {
  // Simple, stable-ish V1 generator (we can improve format later)
  const rand = () => Math.random().toString(16).slice(2, 6).toUpperCase();
  return `KPR-${rand()}-${rand()}`;
}

function getBaseUrl() {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.location.origin;
  }

  return (
    process.env.EXPO_PUBLIC_KEEPR_BASE_URL ||
    process.env.PUBLIC_KEEPR_BASE_URL ||
    "https://app.keeprhome.com"
  );
}

function htmlForSticker({ assetName, kac, qrDataUrl, frameUri, url }) {

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
      .url { font-size: 10px; color: #666; margin-top: 6px; word-break: break-all; }
      .brandedQr {
        width: 500px;
        height: 500px;
        position: relative;
        margin: 24px auto;
      }
      .qrFrame {
          position: absolute;
          top: 0;
          left: 0;
          width: 500px;
          height: auto;
          z-index: 2;
        }

        .qrCode {
          position: absolute;
          top: 70px;
          left: 115px;
          width: 270px;
          height: 270px;
          z-index: 1;
        }

    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="title">${escapeHtml(assetName || "Asset")}</div>
      <div class="kac">${escapeHtml(kac || "")}</div>
      <div class="row">
        ${htmlForBrandedQr({ qrDataUrl, frameUri })}
      </div>
      <div class="url">${escapeHtml(url)}</div>
    </div>
  </body>
</html>`;
}

function htmlForBrandedQr({ qrDataUrl, frameUri }) {
  return `
    <div class="brandedQr">
      <img id="keepr-qr-image" class="qrCode" src="${qrDataUrl}" />
      <img id="keepr-qr-frame" class="qrFrame" src="${frameUri}" />
    </div>
  `;
}

function htmlForPdfSheet({ assetName, kac, qrDataUrl, frameUri, url }) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(assetName || "Asset")} – Keepr Public View</title>
    <style>
      body {
        margin: 0;
        padding: 32px;
        font-family: -apple-system, BlinkMacSystemFont, Arial, sans-serif;
        color: #111827;
        background: #ffffff;
      }
      .sheet {
        max-width: 800px;
        margin: 0 auto;
      }
      .eyebrow {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #6B7280;
        margin-bottom: 8px;
      }
      .title {
        font-size: 28px;
        font-weight: 800;
        margin-bottom: 8px;
      }
      .kac {
        font-size: 14px;
        color: #4B5563;
        margin-bottom: 24px;
      }
      .qrWrap {
        display: flex;
        justify-content: center;
        margin: 24px 0;
      }
      
      .urlLabel {
        font-size: 12px;
        font-weight: 700;
        text-transform: uppercase;
        color: #6B7280;
        margin-top: 24px;
        margin-bottom: 6px;
      }
      .url {
        font-size: 14px;
        color: #111827;
        word-break: break-all;
      }
      .help {
        margin-top: 20px;
        font-size: 13px;
        color: #4B5563;
        line-height: 1.5;
      }
      .footer {
        margin-top: 40px;
        padding-top: 16px;
        border-top: 1px solid #E5E7EB;
        font-size: 12px;
        color: #6B7280;
      }
        .brandedQr {
        width: 500px;
        height: 500px;
        position: relative;
        margin: 24px auto;
      }
      .qrFrame {
        position: absolute;
        top: 0;
        left: 0;
        width: 500px;
        height: auto;
        z-index: 2;
      }

      .qrCode {
        position: absolute;
        top: 70px;
        left: 115px;
        width: 270px;
        height: 270px;
        z-index: 1;
      }
    </style>
  </head>
  <body>
    <div class="sheet">
      <div class="eyebrow">Keepr Public View</div>
      <div class="title">${escapeHtml(assetName || "Asset")}</div>
      <div class="kac">KAC: ${escapeHtml(kac || "")}</div>

      <div class="qrWrap">
        ${htmlForBrandedQr({ qrDataUrl, frameUri })}
      </div>

      <div class="urlLabel">Public link</div>
      <div class="url">${escapeHtml(url || "")}</div>

      <div class="help">
        Scan the QR code or open the link above to view and interact with this asset’s public page.
      </div>

      <div class="footer">
        Generated by Keepr
      </div>
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

const printStyles = `
  @media print {
    html, body {
      background: #fff !important;
    }

    body * {
      visibility: hidden;
    }

    #keepr-print-sheet,
    #keepr-print-sheet * {
      visibility: visible;
    }

    #keepr-print-sheet {
      position: absolute !important;
      left: 0 !important;
      top: 0 !important;
      width: 100% !important;
    }

    aside,
    nav,
    [role="navigation"],
    [data-sidebar],
    [data-app-shell-sidebar],
    [class*="sidebar"],
    [class*="nav"] {
      display: none !important;
    }
  }
`;

export default function AssetQRCodesScreen({ route, navigation }) {
  
  const assetId = route?.params?.assetId;

  const [loading, setLoading] = useState(true);
  const [asset, setAsset] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const qrRef = useRef(null);

  const baseUrl = useMemo(() => getBaseUrl(), []);
  const kac = asset?.kac_id || null;
  const url = useMemo(
  () => (kac ? `${baseUrl}/k/${encodeURIComponent(kac)}` : null),
  [baseUrl, kac]
);

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

  const ensureKacAndUrl = async () => {
  let nextAsset = asset;

  if (!nextAsset?.kac_id) {
    try {
      setBusy(true);

      const newKac = genKac();

      const { data, error } = await supabase
        .from("assets")
        .update({ kac_id: newKac })
        .eq("id", assetId)
        .select("id, name, kac_id, owner_id")
        .single();

      if (error) throw error;

      setAsset(data);
      nextAsset = data;
    } finally {
      setBusy(false);
    }
  }

  const nextKac = nextAsset?.kac_id || null;
  const nextUrl = nextKac
    ? `${baseUrl}/k/${encodeURIComponent(nextKac)}`
    : null;

  return { nextAsset, nextKac, nextUrl };
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

async function openPrintWindowAndWait(w, html) {
  if (!w) {
    Alert.alert("Popup blocked", "Allow popups to print this badge.");
    return;
  }

  const htmlWithPrintScript = html.replace(
    "</body>",
    `
      <script>
        window.onload = function () {
          setTimeout(function () {
            window.focus();
            window.print();
          }, 800);
        };
      </script>
    </body>`
  );

  w.document.open();
  w.document.write(htmlWithPrintScript);
  w.document.close();
}

const onPrintSticker = async () => {
  const printWindow = Platform.OS === "web" ? window.open("", "_blank") : null;

  if (Platform.OS === "web" && printWindow) {
    printWindow.document.write("<p style='font-family:sans-serif;padding:24px;'>Preparing Keepr badge…</p>");
    printWindow.document.close();
  }

  try {
    const { nextAsset, nextKac, nextUrl } = await ensureKacAndUrl();
    if (!nextUrl) throw new Error("Missing KAC URL");

    setBusy(true);

    const qrDataUrl = await getQrPngDataUrl();
    const frameUri = Asset.fromModule(qrFrame).uri;

    const html = htmlForSticker({
      assetName: nextAsset?.name,
      kac: nextKac,
      qrDataUrl,
      frameUri,
      url: nextUrl,
    });

    if (Platform.OS === "web") {
      await openPrintWindowAndWait(printWindow, html);
      return;
    }

    await Print.printAsync({ html });
  } catch (e) {
    if (Platform.OS === "web" && printWindow) {
      printWindow.document.open();
      printWindow.document.write(
        `<pre style="font-family:monospace;padding:24px;white-space:pre-wrap;">Print failed:\n${String(e?.message || e)}</pre>`
      );
      printWindow.document.close();
    }

    Alert.alert("Print failed", e?.message || "Unable to print.");
  } finally {
    setBusy(false);
  }
};

const onPrintPdf = async () => {
  try {
    const printWindow = Platform.OS === "web" ? window.open("", "_blank") : null;
    const { nextAsset, nextKac, nextUrl } = await ensureKacAndUrl();
    if (!nextUrl) throw new Error("Missing public URL");

    setBusy(true);

    const qrDataUrl = await getQrPngDataUrl();
    const frameUri = Asset.fromModule(qrFrame).uri;
    const html = htmlForPdfSheet({
      assetName: nextAsset?.name,
      kac: nextKac,
      qrDataUrl,
      frameUri,
      url: nextUrl,
    });

    if (Platform.OS === "web") {
  await openPrintWindowAndWait(printWindow, html);
  return;
}

    await Print.printAsync({ html });
  } catch (e) {
    Alert.alert("Print failed", e?.message || "Unable to print PDF.");
  } finally {
    setBusy(false);
  }
};

const onCopyLink = async () => {
  try {
    const { nextUrl } = await ensureKacAndUrl();
    if (!nextUrl) throw new Error("Missing public URL");

    await Clipboard.setStringAsync(nextUrl);

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  } catch (e) {
    Alert.alert("Copy failed", e?.message || "Unable to copy link.");
  }
};

const onShareLink = async () => {
  try {
    const { nextAsset, nextUrl } = await ensureKacAndUrl();
    if (!nextUrl) throw new Error("Missing public URL");

    await Share.share({
      title: nextAsset?.name || "Keepr Asset",
      message: `${nextAsset?.name || "Asset"} — view and interact\n${nextUrl}`,
      url: nextUrl,
    });
  } catch (e) {
    Alert.alert("Share failed", e?.message || "Unable to share.");
  }
};

  return (
    <>
    {Platform.OS === "web" ? (
      <style dangerouslySetInnerHTML={{ __html: printStyles }} />
    ) : null}
    <SafeAreaView style={styles.safe}>
      <ScrollView
          nativeID={Platform.OS === "web" ? "keepr-print-sheet" : undefined}
          contentContainerStyle={styles.container}
        >
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backRow}>
          <Text style={styles.backText}>‹ Back</Text>
        </TouchableOpacity>

        <Text style={styles.h1}>Share Public View</Text>

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

          <View style={styles.brandedQrWrap}>
          <View style={styles.qrCodePositioner}>
            <QRCode
            value={url || `${baseUrl}/k/unknown`}
            size={270}
            getRef={(c) => (qrRef.current = c)}
          />
          </View>


          <Image
            source={qrFrame}
            style={styles.qrFrameOverlay}
            resizeMode="contain"
            pointerEvents="none"
          />
        </View>

          <Text style={styles.smallMuted}>
            {url || "Generate KAC to create a QR URL."}
          </Text>

          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.button, (busy || !asset.kac_id) && styles.buttonDisabled]}
              onPress={onShareLink}
              disabled={busy || !asset.kac_id}
            >
              <Text style={styles.buttonText}>Share link</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, (busy || !asset.kac_id) && styles.buttonDisabled]}
              onPress={onCopyLink}
              disabled={busy || !asset.kac_id}
            >
              <Text style={styles.secondaryButtonText}>
                {copied ? "Copied" : "Copy link"}
              </Text>
            </TouchableOpacity>
          </View>

          {copied ? (
            <Text style={styles.copySuccessText}>Copied to clipboard</Text>
          ) : null}

          <View style={styles.row}>
            <TouchableOpacity
              style={[styles.button, (busy || !asset.kac_id) && styles.buttonDisabled]}
              onPress={onPrintSticker}
              disabled={busy || !asset.kac_id}
            >
              <Text style={styles.buttonText}>Print sticker</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryButton, (busy || !asset.kac_id) && styles.buttonDisabled]}
              onPress={onPrintPdf}
              disabled={busy || !asset.kac_id}
            >
              <Text style={styles.secondaryButtonText}>Print PDF</Text>
            </TouchableOpacity>
          </View>
        </View>
          </>
        )}
        </ScrollView>
        </SafeAreaView>
        </>
      );
    }

const styles = StyleSheet.create({
  container: {
  width: "100%",
  maxWidth: 1280,
  alignSelf: "center",
  paddingHorizontal: spacing.lg,
  paddingTop: spacing.lg,
  paddingBottom: spacing.xl * 2,
  gap: spacing.md,
},

safe: { flex: 1, backgroundColor: "#f5f7fb" },

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

  brandedQrWrap: {
  width: 500,
  height: 500,
  alignItems: "center",
  justifyContent: "center",
  position: "relative",
  alignSelf: "center",
},

qrCodePositioner: {
  position: "absolute",
  top: 70,
  left: 115,
},

qrFrameOverlay: {
  position: "absolute",
  width: 500,
},

  copySuccessText: {
  marginTop: 8,
  fontSize: 12,
  fontWeight: "600",
  color: colors.textMuted,
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
