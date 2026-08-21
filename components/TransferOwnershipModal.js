// components/TransferOwnershipModal.js
import React, { useEffect, useMemo, useState } from "react";
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
import {
  DEFAULT_TRANSFER_PREVIEW,
  buildAssetTransferPreview,
} from "../lib/assetTransferPreview";
import { useAuth } from "../context/AuthContext";
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
 * - inbox_items table with: to_user_id, to_email, from_user_id, type, status, payload
 * - existing email-claim behavior for pending inbox items when to_user_id is not resolved yet
 */
export default function TransferOwnershipModal({
  visible,
  onClose,
  assetId,
  assetType, // "boat" | "vehicle" | "home" | etc
  assetName,
}) {
  const { user, initializing: authInitializing } = useAuth();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingOutgoing, setPendingOutgoing] = useState(null);

  const title = useMemo(() => assetName || "This asset", [assetName]);

  useEffect(() => {
    let cancelled = false;

    if (!visible || !assetId) {
      setPreview(null);
      setPreviewLoading(false);
      setPendingOutgoing(null);
      setPendingLoading(false);
      return undefined;
    }

    setPreviewLoading(true);
    buildAssetTransferPreview({ assetId })
      .then((nextPreview) => {
        if (!cancelled) setPreview(nextPreview);
      })
      .catch((error) => {
        console.log("buildAssetTransferPreview error:", error);
        if (!cancelled) setPreview(null);
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [assetId, visible]);

  useEffect(() => {
    let cancelled = false;
    const userId = user?.id || null;

    if (!visible || !assetId || !userId) {
      setPendingOutgoing(null);
      setPendingLoading(false);
      return undefined;
    }

    setPendingLoading(true);
    supabase
      .from("inbox_items")
      .select("id, to_email, to_user_id, payload, created_at")
      .eq("from_user_id", userId)
      .eq("type", "asset_transfer")
      .eq("status", "pending")
      .filter("payload->>asset_id", "eq", assetId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.log("pending transfer lookup skipped:", error);
          if (!cancelled) setPendingOutgoing(null);
          return;
        }
        if (!cancelled) setPendingOutgoing(data || null);
      })
      .finally(() => {
        if (!cancelled) setPendingLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [assetId, user?.id, visible]);

  const findRecipientByEmail = async (emailNorm) => {
    const { data: rpcUserId, error: rpcError } = await supabase.rpc(
      "keepr_profile_id_by_email",
      { p_email: emailNorm }
    );
    if (!rpcError && rpcUserId) {
      return { id: rpcUserId, email: emailNorm };
    }
    if (rpcError) {
      console.log("keepr_profile_id_by_email skipped:", rpcError);
    }

    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, preferred_contact_email")
      .or(`email.eq.${emailNorm},preferred_contact_email.eq.${emailNorm}`)
      .maybeSingle();

    if (error) {
      console.error("findRecipientByEmail error", error);
      return null;
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
      const myId = user?.id || null;
      if (!myId) throw new Error("You must be signed in to transfer ownership.");

      const recipient = await findRecipientByEmail(emailNorm);

      if (recipient?.id === myId) {
        Alert.alert("Already yours", "That account is already the current owner.");
        return;
      }

      const transferPackage = preview || {
        ...DEFAULT_TRANSFER_PREVIEW,
        asset: {
          id: assetId,
          name: title,
          type: assetType || null,
          kac: null,
        },
        projection_note:
          "This boat's history stays with the boat. When ownership changes, Keepr updates access without starting over.",
      };

      const payload = {
        asset_id: assetId,
        asset_type: assetType || transferPackage?.asset?.type || null,
        asset_name: title,
        asset_kac: transferPackage?.asset?.kac || null,
        asset_identity: transferPackage?.asset || null,
        transfer_model: "persistent_kac_relationship_change",
        transfer_package: transferPackage,
        projection_note:
          "This boat's history stays with the boat. When ownership changes, Keepr updates access without starting over.",
        from_email: user?.email || null,
        to_email: emailNorm,
      };

      const { data: insertedRequest, error: insErr } = await supabase.from("inbox_items").insert({
          to_user_id: recipient?.id || null,
          to_email: emailNorm,
          from_user_id: myId,
          type: "asset_transfer",
          status: "pending",
          payload,
        })
        .select("id, to_email, to_user_id, payload, created_at")
        .single();

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
        "They’ll need to accept it in their Inbox. If the request was sent by email, it will attach to that account when they sign in."
      );

      // reset + close
      setEmail("");
      setPendingOutgoing(insertedRequest || {
        id: null,
        to_email: emailNorm,
        to_user_id: recipient?.id || null,
        payload,
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.log("TransferOwnershipModal handleSend error:", e);
      Alert.alert("Transfer failed", e?.message || "Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const confirmWithdraw = () =>
    new Promise((resolve) => {
      if (typeof window !== "undefined" && typeof window.confirm === "function") {
        resolve(window.confirm("Withdraw this transfer request before it is accepted?"));
        return;
      }
      Alert.alert(
        "Withdraw transfer?",
        "The recipient will no longer be able to accept this request.",
        [
          { text: "Keep request", style: "cancel", onPress: () => resolve(false) },
          { text: "Withdraw", style: "destructive", onPress: () => resolve(true) },
        ]
      );
    });

  const handleWithdraw = async () => {
    const requestId = pendingOutgoing?.id;
    const myId = user?.id || null;
    if (!requestId || !myId) return;

    const ok = await confirmWithdraw();
    if (!ok) return;

    setLoading(true);
    try {
      const { error } = await supabase
        .from("inbox_items")
        .update({
          status: "declined",
          responded_at: new Date().toISOString(),
        })
        .eq("id", requestId)
        .eq("from_user_id", myId)
        .eq("type", "asset_transfer")
        .eq("status", "pending");

      if (error) throw error;
      setPendingOutgoing(null);
      Alert.alert("Transfer withdrawn", "The boat has not changed hands.");
    } catch (error) {
      console.log("handleWithdraw transfer error:", error);
      Alert.alert(
        "Could not withdraw",
        error?.message || "Please try again or ask the recipient to decline it."
      );
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
                This boat's history stays with the boat. Your private
                information stays with you. When ownership changes, Keepr
                updates access without starting over.
              </Text>
            </View>

            <Text style={styles.helper}>
              Boat: <Text style={{ fontWeight: "700", color: colors.textPrimary }}>{title}</Text>
            </Text>

            {!!pendingOutgoing && (
              <View style={styles.pendingCard}>
                <View style={styles.pendingHeader}>
                  <Ionicons name="time-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.pendingTitle}>Transfer request pending</Text>
                </View>
                <Text style={styles.pendingText}>
                  This boat has not changed hands yet. The request is waiting for{" "}
                  <Text style={styles.pendingStrong}>
                    {pendingOutgoing.to_email || pendingOutgoing.payload?.to_email || "the recipient"}
                  </Text>{" "}
                  to accept it.
                </Text>
                <TouchableOpacity
                  style={[styles.withdrawButton, loading && { opacity: 0.6 }]}
                  onPress={handleWithdraw}
                  disabled={loading || !pendingOutgoing?.id}
                >
                  <Ionicons name="close-circle-outline" size={15} color="#DC2626" />
                  <Text style={styles.withdrawButtonText}>Withdraw request</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={styles.previewCard}>
              <View style={styles.previewHeader}>
                <Ionicons name="git-network-outline" size={16} color={colors.brandBlue} />
                <Text style={styles.previewTitle}>What comes with the boat</Text>
              </View>
              <Text style={styles.previewIntro}>
                Keepr is not copying this boat. It is showing what boat history and
                records follow the boat and what remains private to the current
                person or workspace.
              </Text>

              {previewLoading ? (
                <View style={styles.previewLoadingRow}>
                  <ActivityIndicator size="small" color={colors.brandBlue} />
                  <Text style={styles.previewMuted}>Checking what follows the boat...</Text>
                </View>
              ) : (
                <>
                  {!!preview?.asset?.kac && (
                    <Text style={styles.kacText}>
                      Keepr Code: <Text style={styles.kacStrong}>{preview.asset.kac}</Text>
                    </Text>
                  )}

                  {!!preview?.counts && (
                    <View style={styles.countGrid}>
                      {[
                        ["Systems", preview.counts.systems],
                        ["Service", preview.counts.service_records],
                        ["Timeline", preview.counts.timeline_records],
                        ["Photos", preview.counts.showcase_photos],
                        ["Docs", preview.counts.documents],
                      ]
                        .filter(([, value]) => value !== null && value !== undefined)
                        .map(([label, value]) => (
                          <View key={label} style={styles.countPill}>
                            <Text style={styles.countValue}>{value}</Text>
                            <Text style={styles.countLabel}>{label}</Text>
                          </View>
                        ))}
                    </View>
                  )}

                  <View style={styles.packageColumns}>
                    <View style={styles.packageColumn}>
                      <Text style={styles.packageHeading}>Follows the boat</Text>
                      {(preview?.transfers || []).map((line) => (
                        <Text key={line} style={styles.packageLine}>- {line}</Text>
                      ))}
                    </View>
                    <View style={styles.packageColumn}>
                      <Text style={styles.packageHeading}>Stays private</Text>
                      {(preview?.remains_private || []).map((line) => (
                        <Text key={line} style={styles.packageLine}>- {line}</Text>
                      ))}
                    </View>
                  </View>
                </>
              )}
            </View>

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
                disabled={loading || previewLoading || pendingLoading || authInitializing || !assetId || !!pendingOutgoing}
              >
                {loading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.buttonPrimaryText}>
                    {previewLoading || pendingLoading
                      ? "Checking..."
                      : pendingOutgoing
                      ? "Request pending"
                      : "Send request"}
                  </Text>
                )}
              </TouchableOpacity>
            </View>

            <Text style={styles.footerHint}>
              Trainer note: Owner, dealer, and manufacturer views all explain the same idea:
              what you can see depends on your relationship to the boat.
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
  pendingCard: {
    borderWidth: 1,
    borderColor: "#FDE68A",
    borderRadius: radius.lg,
    backgroundColor: "#FFFBEB",
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  pendingHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  pendingTitle: {
    marginLeft: spacing.xs,
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  pendingText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
  pendingStrong: {
    fontWeight: "800",
    color: colors.textPrimary,
  },
  withdrawButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
    marginTop: spacing.sm,
  },
  withdrawButtonText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#DC2626",
  },
  previewCard: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  previewHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  previewTitle: {
    marginLeft: spacing.xs,
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  previewLoadingRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  previewIntro: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
    marginBottom: spacing.sm,
  },
  previewMuted: {
    marginLeft: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
  },
  kacText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  kacStrong: {
    fontWeight: "800",
    color: colors.textPrimary,
  },
  countGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: spacing.sm,
  },
  countPill: {
    minWidth: 72,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  countValue: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  countLabel: {
    fontSize: 10,
    fontWeight: "700",
    color: colors.textMuted,
  },
  packageColumns: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  packageColumn: {
    flex: 1,
    minWidth: 180,
    marginRight: spacing.sm,
  },
  packageHeading: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  packageLine: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
