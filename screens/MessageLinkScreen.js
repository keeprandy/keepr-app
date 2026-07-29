import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Ionicons } from "@expo/vector-icons";

import { useAuth } from "../context/AuthContext";
import { keeprApiRequest } from "../lib/keeprApi";
import { supabase } from "../lib/supabaseClient";
import { colors, radius, shadows, spacing } from "../styles/theme";

export const PENDING_MESSAGE_TOKEN_KEY = "keepr_pending_message_token";

function cleanToken(value) {
  return String(value || "").trim();
}

function subjectLine(preview) {
  if (!preview) return "Keepr conversation";
  if (preview.system_name && preview.asset_name) return `${preview.system_name} on ${preview.asset_name}`;
  return preview.system_name || preview.asset_name || preview.subject || "Keepr conversation";
}

export default function MessageLinkScreen({ route, navigation }) {
  const token = cleanToken(route?.params?.token);
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState("");

  const loadPreview = useCallback(async () => {
    if (!token) {
      setError("This message link is missing its token.");
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const json = await keeprApiRequest(`/api/message-link/${encodeURIComponent(token)}`);
      setPreview(json?.preview || null);
      setError("");
    } catch (e) {
      setError(e?.message || "This message link could not be opened.");
    } finally {
      setLoading(false);
    }
  }, [token]);

  const openThread = useCallback((result) => {
    const next = result?.preview || preview || {};
    const threadId = result?.thread_id || next.thread_id;
    const assetId = result?.asset_id || next.asset_id;
    const systemId = result?.system_id || next.system_id || null;
    navigation.replace("KeeprAction", {
      scope: systemId ? "system" : assetId ? "asset" : "global",
      assetId,
      systemId,
      threadId,
      assetName: next.asset_name || null,
      systemName: next.system_name || null,
    });
  }, [navigation, preview]);

  const claimAndOpen = useCallback(async () => {
    if (!token || claiming) return;
    try {
      setClaiming(true);
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      if (sessionError) throw sessionError;
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) {
        await AsyncStorage.setItem(PENDING_MESSAGE_TOKEN_KEY, token);
        navigation.replace("Auth", {
          mode: "signin",
          intent: "claim_message_link",
          messageToken: token,
        });
        return;
      }
      const json = await keeprApiRequest(`/api/message-link/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      await AsyncStorage.removeItem(PENDING_MESSAGE_TOKEN_KEY);
      openThread(json);
    } catch (e) {
      Alert.alert("Could not open conversation", e?.message || "Try again.");
    } finally {
      setClaiming(false);
    }
  }, [claiming, navigation, openThread, token]);

  useEffect(() => {
    loadPreview();
  }, [loadPreview]);

  useEffect(() => {
    if (!user?.id || loading || error) return;
    claimAndOpen();
  }, [claimAndOpen, error, loading, user?.id]);

  const continueToAuth = async (mode = "signin") => {
    if (token) await AsyncStorage.setItem(PENDING_MESSAGE_TOKEN_KEY, token);
    navigation.replace("Auth", {
      mode,
      intent: "claim_message_link",
      messageToken: token,
    });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.shell}>
        <View style={styles.brandRow}>
          <Ionicons name="chatbubble-ellipses-outline" size={24} color={colors.brandBlue} />
          <View>
            <Text style={styles.brand}>Keepr Message</Text>
            <Text style={styles.brandSub}>Conversation continuity</Text>
          </View>
        </View>

        {loading ? (
          <View style={styles.card}>
            <ActivityIndicator color={colors.brandBlue} />
            <Text style={styles.muted}>Opening message link...</Text>
          </View>
        ) : error ? (
          <View style={styles.card}>
            <Text style={styles.title}>Message unavailable</Text>
            <Text style={styles.body}>{error}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.kicker}>Conversation invite</Text>
            <Text style={styles.title}>{preview?.sender_name || "A Keepr member"} sent you a message</Text>
            <Text style={styles.context}>{subjectLine(preview)}</Text>
            {preview?.keepr_pro_name ? (
              <Text style={styles.muted}>Connected provider context: {preview.keepr_pro_name}</Text>
            ) : null}
            <View style={styles.previewBox}>
              <Text style={styles.previewLabel}>Opening message</Text>
              <Text style={styles.previewText}>{preview?.message_preview || "Continue in Keepr to view the message."}</Text>
            </View>
            <TouchableOpacity
              style={styles.primary}
              onPress={user?.id ? claimAndOpen : () => continueToAuth("signup")}
              disabled={claiming}
            >
              {claiming ? <ActivityIndicator color="white" /> : null}
              <Text style={styles.primaryText}>
                {claiming ? "Opening..." : "Continue the conversation in Keepr"}
              </Text>
            </TouchableOpacity>
            {!user?.id ? (
              <TouchableOpacity style={styles.secondary} onPress={() => continueToAuth("signin")}>
                <Text style={styles.secondaryText}>Already a Keepr? Sign in</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F3F6FB" },
  shell: {
    flex: 1,
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    justifyContent: "center",
    padding: spacing.xl,
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  brand: { fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  brandSub: { fontSize: 13, color: colors.textSecondary },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.xl,
    ...shadows.soft,
  },
  kicker: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.brandBlue,
    textTransform: "uppercase",
    marginBottom: spacing.xs,
  },
  title: { fontSize: 28, fontWeight: "900", color: colors.textPrimary, lineHeight: 32 },
  context: { marginTop: spacing.sm, fontSize: 16, fontWeight: "800", color: colors.textSecondary },
  body: { marginTop: spacing.sm, fontSize: 15, lineHeight: 21, color: colors.textSecondary },
  muted: { marginTop: spacing.sm, color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  previewBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  previewLabel: { fontSize: 12, fontWeight: "900", color: colors.textMuted, textTransform: "uppercase" },
  previewText: { marginTop: spacing.xs, fontSize: 16, lineHeight: 22, color: colors.textPrimary },
  primary: {
    marginTop: spacing.lg,
    minHeight: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  primaryText: { color: "white", fontSize: 15, fontWeight: "900" },
  secondary: {
    marginTop: spacing.sm,
    minHeight: 44,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: { color: colors.brandBlue, fontSize: 14, fontWeight: "900" },
});
