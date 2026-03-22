import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as ImagePicker from "expo-image-picker";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import React, { useCallback, useState } from "react";
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, spacing } from "../styles/theme";
import * as ImageManipulator from "expo-image-manipulator";

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export default function ScanDocumentMobileScreen({ route, navigation }) {
  const assetId = route?.params?.assetId || null;
  const assetName = route?.params?.assetName || "Asset";
  const targetType = route?.params?.targetType || null;
  const targetId = route?.params?.targetId || null;
  const targetRole = route?.params?.targetRole || null;

  const [pages, setPages] = useState([]);
  const [busy, setBusy] = useState(false);

  const buildPlacements = useCallback(() => {
    const placements = [
      { target_type: "asset", target_id: assetId, role: "other" },
    ];

    if (
      targetType &&
      targetId &&
      (targetType === "system" || targetType === "service_record")
    ) {
      placements.push({
        target_type: targetType,
        target_id: targetId,
        role: targetRole || "other",
      });
    }

    return placements;
  }, [assetId, targetId, targetRole, targetType]);

const capturePage = useCallback(async () => {
  try {
    const cameraPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (cameraPerm.status !== "granted") {
      Alert.alert("Permission required", "Please allow camera access.");
      return;
    }

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: false,
      exif: false,
    });

    if (res.canceled) return;

    const a = res.assets?.[0];
    if (!a?.uri) return;

    setPages((prev) => [
      ...prev,
      {
        id: `${Date.now()}_${prev.length + 1}`,
        uri: a.uri,
        mimeType: a.mimeType || "image/jpeg",
        sizeBytes: a.fileSize || null,
      },
    ]);
  } catch (e) {
    Alert.alert("Scan failed", e?.message || "Could not capture page.");
  }
}, []);

  const removePage = useCallback((id) => {
    setPages((prev) => prev.filter((p) => p.id !== id));
  }, []);

const savePdfToKeepr = useCallback(async () => {
  if (!pages.length) {
    Alert.alert("No pages", "Scan at least one page first.");
    return;
  }

  try {
    setBusy(true);

    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (!userId) throw new Error("Not signed in.");

        const pageHtmlParts = [];

        for (const [index, page] of pages.entries()) {
        const resized = await ImageManipulator.manipulateAsync(
        page.uri,
        [{ resize: { width: 1600 } }],
        {
            compress: 0.7,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
        }
        );

        const base64 = resized.base64;

        pageHtmlParts.push(`
            <div
            style="
                width: 100%;
                height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                background: white;
                padding: 20px;
                ${index < pages.length - 1 ? "page-break-after: always;" : ""}
            "
            >
            <img
            src="data:image/jpeg;base64,${base64}"
            style="
                width: 100%;
                height: auto;
                object-fit: contain;
                filter: contrast(1.1) brightness(1.03);
            "
            />
            </div>
            `);
        }

    const html = `
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
        @page {
        size: auto;
        margin: 18px;
        }

        html, body {
        margin: 0;
        padding: 0;
        background: white;
        height: 100%;
        }

        .page {
        width: 100%;
        height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        }
          </style>
        </head>
        <body>
          ${pageHtmlParts.join("")}
        </body>
      </html>
    `;

    const { uri: pdfUri } = await Print.printToFileAsync({
      html,
      base64: false,
    });

    if (!pdfUri) throw new Error("Could not create PDF.");

    const now = new Date();
    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "");
    const generatedFileName = `scan_${date}_${time}.pdf`;

    await uploadAttachmentFromUri({
      userId,
      assetId,
      kind: "file",
      fileUri: pdfUri,
      fileName: generatedFileName,
      mimeType: "application/pdf",
      sizeBytes: null,
      placements: buildPlacements(),
    });

    Alert.alert(
      "Saved to Keepr",
      `${pages.length}-page document ready for context.`,
      [
        {
          text: "Done",
          onPress: () => navigation.goBack(),
        },
      ]
    );
  } catch (e) {
    Alert.alert("Save failed", e?.message || "Could not save scanned document.");
  } finally {
    setBusy(false);
  }
}, [assetId, buildPlacements, navigation, pages]);

const previewPdf = useCallback(async () => {
  if (!pages.length) {
    Alert.alert("No pages", "Scan at least one page first.");
    return;
  }

  try {
    setBusy(true);

    const pageHtmlParts = [];

    for (const [index, page] of pages.entries()) {
    const resized = await ImageManipulator.manipulateAsync(
    page.uri,
    [{ resize: { width: 1600 } }],
    {
        compress: 0.7,
        format: ImageManipulator.SaveFormat.JPEG,
        base64: true,
    }
    );

    const base64 = resized.base64;

      pageHtmlParts.push(`
            <div
            style="
                width: 100%;
                height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
                background: white;
                padding: 20px;
                ${index < pages.length - 1 ? "page-break-after: always;" : ""}
            "
            >
        >
            <img
            src="data:image/jpeg;base64,${base64}"
            style="
                width: 100%;
                height: auto;
                object-fit: contain;
                filter: contrast(1.1) brightness(1.03);
            "
            />
        </div>
      `);
    }

    const html = `
      <html>
        <head>
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <style>
            @page {
            size: auto;
            margin: 18px;
            }

            html, body {
            margin: 0;
            padding: 0;
            background: white;
            height: 100%;
            }

            .page {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            }
          </style>
        </head>
        <body>
          ${pageHtmlParts.join("")}
        </body>
      </html>
    `;

    const { uri: pdfUri } = await Print.printToFileAsync({
      html,
      base64: false,
    });

    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(pdfUri);
    } else {
      Alert.alert("Preview unavailable", "Sharing is not available on this device.");
    }
  } catch (e) {
    Alert.alert("Preview failed", e?.message || "Could not preview PDF.");
  } finally {
    setBusy(false);
  }
}, [pages]);

  return (
    <SafeAreaView style={[layoutStyles.screen, styles.screen]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Scan Document</Text>
          <Text style={styles.subtitle}>{assetName}</Text>
        </View>
      </View>

      <View style={styles.topActions}>
        <TouchableOpacity style={styles.primaryBtn} onPress={capturePage} disabled={busy}>
          <Ionicons name="scan-outline" size={18} color="#fff" />
          <Text style={styles.primaryBtnText}>
            {pages.length ? "Add Page" : "Scan First Page"}
          </Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {pages.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="document-outline" size={32} color={colors.textSecondary} />
            <Text style={styles.emptyTitle}>No pages scanned yet</Text>
            <Text style={styles.emptyText}>
              Capture one or more pages, then save them as a single PDF into Keepr.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Scanned Pages ({pages.length})</Text>

            {pages.map((page, index) => (
              <View key={page.id} style={styles.pageCard}>
                <Image source={{ uri: page.uri }} style={styles.pageImage} resizeMode="cover" />

                <View style={styles.pageMeta}>
                  <Text style={styles.pageTitle}>Page {index + 1}</Text>
                  <TouchableOpacity onPress={() => removePage(page.id)} style={styles.removeBtn}>
                    <Ionicons name="trash-outline" size={16} color={colors.textSecondary} />
                    <Text style={styles.removeBtnText}>Remove</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}

            <TouchableOpacity
              style={[styles.secondaryBtn, busy && { opacity: 0.7 }]}
              onPress={previewPdf}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color={colors.textPrimary} />
              ) : (
                <>
                  <Ionicons name="eye-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.secondaryBtnText}>Preview PDF</Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.saveBtn, busy && { opacity: 0.7 }]}
              onPress={savePdfToKeepr}
              disabled={busy}
            >
              {busy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="document-text-outline" size={18} color="#fff" />
                  <Text style={styles.saveBtnText}>Save PDF to Keepr</Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  backBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  topActions: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 12,
  },
  primaryBtnText: {
    marginLeft: 8,
    color: "#fff",
    fontWeight: "800",
  },
  body: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  emptyCard: {
    marginTop: 24,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: "center",
  },
  emptyTitle: {
    marginTop: 10,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  emptyText: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: "center",
  },
  sectionTitle: {
    marginBottom: spacing.sm,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  pageCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
    marginBottom: spacing.md,
  },
  pageImage: {
    width: "100%",
    height: 220,
    backgroundColor: colors.surfaceSubtle,
  },
  pageMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  pageTitle: {
    fontWeight: "700",
    color: colors.textPrimary,
  },
  removeBtn: {
    flexDirection: "row",
    alignItems: "center",
  },
  removeBtnText: {
    marginLeft: 6,
    color: colors.textSecondary,
    fontWeight: "600",
  },
  secondaryBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 12,
  },
  secondaryBtnText: {
    marginLeft: 8,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  saveBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 12,
  },
  saveBtnText: {
    marginLeft: 8,
    color: "#fff",
    fontWeight: "800",
  },
});