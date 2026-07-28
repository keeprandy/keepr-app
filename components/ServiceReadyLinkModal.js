import React, { useRef } from "react";
import {
  Alert,
  Modal,
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";

import { colors, radius, shadows, spacing } from "../styles/theme";

export default function ServiceReadyLinkModal({
  visible,
  url,
  systemName,
  kicker = "Service Ready",
  title,
  note = "Keepr stores only a secure token hash. This usable link is available for this session.",
  copiedAlertTitle = "Service Ready link copied",
  downloadNamePrefix,
  onClose,
}) {
  const qrRef = useRef(null);

  const copyLink = async () => {
    if (!url) return;
    await Clipboard.setStringAsync(url);
    Alert.alert(copiedAlertTitle, url);
  };

  const shareQr = async () => {
    if (!url) return;

    const qr = qrRef.current;
    if (qr?.toDataURL) {
      qr.toDataURL((data) => {
        const dataUrl = `data:image/png;base64,${data}`;
        if (Platform.OS === "web" && typeof document !== "undefined") {
          const anchor = document.createElement("a");
          const safeName = String(systemName || "service-ready")
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "")
            .slice(0, 64) || "service-ready";
          anchor.href = dataUrl;
          const prefix = downloadNamePrefix || safeName || "service-ready";
          anchor.download = `${prefix}-qr.png`;
          anchor.click();
          return;
        }

        Share.share({ url: dataUrl, message: url }).catch(() => {
          Alert.alert("QR ready", "Copy the link or scan the QR shown here.");
        });
      });
      return;
    }

    Alert.alert("QR ready", "Copy the link or scan the QR shown here.");
  };

  return (
    <Modal
      visible={!!visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <View style={styles.headerRow}>
            <View>
              <Text style={styles.kicker}>{kicker}</Text>
              <Text style={styles.title}>{title || `${systemName || "System"} QR & Link`}</Text>
            </View>
            <Pressable onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>x</Text>
            </Pressable>
          </View>

          <View style={styles.qrWrap}>
            {url ? <QRCode value={url} size={220} getRef={(c) => (qrRef.current = c)} /> : null}
          </View>

          <Text style={styles.urlText}>{url || "No active session link yet."}</Text>
          <Text style={styles.note}>{note}</Text>

          <View style={styles.actions}>
            <TouchableOpacity style={styles.primaryButton} onPress={copyLink} disabled={!url}>
              <Text style={styles.primaryText}>Copy Link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={shareQr} disabled={!url}>
              <Text style={styles.secondaryText}>
                {Platform.OS === "web" ? "Download QR" : "Share QR"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.38)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.lg,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E2E8F0",
    padding: spacing.lg,
    ...shadows.card,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  kicker: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  title: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "800",
    marginTop: 2,
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#eef2f7",
  },
  closeText: {
    color: colors.textPrimary,
    fontSize: 22,
    lineHeight: 24,
  },
  qrWrap: {
    alignSelf: "center",
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  urlText: {
    color: colors.textPrimary,
    fontSize: 13,
    lineHeight: 18,
  },
  note: {
    color: colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  actions: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  primaryButton: {
    flex: 1,
    minWidth: 130,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  primaryText: {
    color: "#fff",
    fontWeight: "800",
  },
  secondaryButton: {
    flex: 1,
    minWidth: 130,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "#d7dde8",
    paddingVertical: spacing.sm,
    alignItems: "center",
  },
  secondaryText: {
    color: colors.textPrimary,
    fontWeight: "800",
  },
});
