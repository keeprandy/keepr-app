// components/TransferOwnershipModal.js
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { colors, spacing, radius } from "../styles/theme";

function normalizeEmail(v) {
  return String(v || "").trim().toLowerCase();
}

function isValidEmail(v) {
  const s = normalizeEmail(v);
  return s.includes("@") && s.includes(".");
}

/**
 * TransferOwnershipModal
 *
 * Creates an inbox transfer request for a recipient (they must accept).
 *
 * Requires:
 * - inbox_items table with: to_user_id, from_user_id, type, status, payload
 * - profiles table with: id, email (or adjust query)
 */
export default function TransferOwnershipModal({
  visible,
  onClose,
  assetId,
  assetType, // "boat" | "vehicle" | "home" | etc
  assetName,
}) {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  const title = useMemo(() => assetName || "This asset", [assetName]);

  const findRecipientByEmail = async (emailNorm) => {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("email", emailNorm)
      .maybeSingle();

    if (error) {
      console.error("findRecipientByEmail error", error);
      throw new Error("Could not look up that account.");
    }
    return data || null;
  };

  const handleSend = async () => {
    if (!assetId) return;

    const emailNorm = normalizeEmail(email);
    if (!isValidEmail(emailNorm)) {
      Alert.alert("Enter an email", "Type a valid recipient email address.");
      return;
    }

    setLoading(true);
    try {
      const { data: authData, error: authErr } = await supabase.auth.getUser();
      if (authErr) throw authErr;

      const myId = authData?.user?.id || null;
      if (!myId) throw new Error("You must be signed in to transfer ownership.");

      const recipient = await findRecipientByEmail(emailNorm);
      if (!recipient?.id) {
        Alert.alert(
          "Account not found",
          "That email doesn’t match a Keepr account yet. Have them create an account first, then try again."
        );
        return;
      }

      if (recipient.id === myId) {
        Alert.alert("Already yours", "That account is already the current owner.");
        return;
      }

      const payload = {
        asset_id: assetId,
        asset_type: assetType || null,
        asset_name: title,
        // Future-proof fields:
        // include_package: false,
        // package_scope: "summary",
      };

      const { error: insErr } = await supabase.from("inbox_items").insert({
        to_user_id: recipient.id,
        from_user_id: myId,
        type: "asset_transfer",
        status: "pending",
        payload,
      });

      if (insErr) {
        console.error("asset_transfer insert error", insErr);
        Alert.alert(
          "Transfer failed",
          insErr?.message || "Could not create a transfer request."
        );
        return;
      }

      Alert.alert(
        "Transfer sent",
        "They’ll need to accept it in their Inbox."
      );

      // reset + close
      setEmail("");
      onClose?.();
    } catch (e) {
      console.log("TransferOwnershipModal handleSend error:", e);
      Alert.alert("Transfer failed", e?.message || "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    if (loading) return;
    setEmail("");
    onClose?.();
  };

  return (
    <Modal visible={!!visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 6 }}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Transfer ownership</Text>
              <TouchableOpacity onPress={handleClose} disabled={loading}>
                <Ionicons name="close-outline" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            <View style={styles.infoBox}>
              <Ionicons name="swap-horizontal-outline" size={18} color={colors.textSecondary} />
              <Text style={styles.infoText}>
                Ownership transfers to another Keepr account.{"\n"}
                The recipient must accept the request in their Inbox.
              </Text>
            </View>

            <Text style={styles.helper}>
              Asset: <Text style={{ fontWeight: "700", color: colors.textPrimary }}>{title}</Text>
            </Text>

            <Text style={styles.label}>Recipient email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="newowner@email.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              style={styles.input}
              editable={!loading}
              placeholderTextColor={colors.textMuted}
            />

            <View style={styles.buttonRow}>
              <TouchableOpacity
                style={[styles.button, styles.buttonGhost]}
                onPress={handleClose}
                disabled={loading}
              >
                <Text style={styles.buttonGhostText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.button, styles.buttonPrimary, !assetId && { opacity: 0.6 }]}
                onPress={handleSend}
                disabled={loading || !assetId}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.buttonPrimaryText}>Send request</Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.footerHint}>
              Tip: If you’re selling, you can send the request now and keep using the asset until they accept.
            </Text>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 520,
    maxHeight: "85%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  infoText: {
    marginLeft: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
    flex: 1,
  },
  helper: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  label: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    fontSize: 14,
    color: colors.textPrimary,
  },
  buttonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.lg,
  },
  button: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    minWidth: 120,
    marginLeft: spacing.sm,
  },
  buttonGhost: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  buttonGhostText: {
    color: colors.textPrimary,
    fontWeight: "700",
  },
  buttonPrimary: {
    backgroundColor: colors.brandBlue,
  },
  buttonPrimaryText: {
    color: "white",
    fontWeight: "800",
  },
  footerHint: {
    marginTop: spacing.md,
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
  },
});
