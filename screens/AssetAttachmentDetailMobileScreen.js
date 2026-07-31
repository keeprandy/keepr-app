import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, radius, spacing } from "../styles/theme";
import { useAssetAttachments } from "../hooks/useAttachments";
import { supabase } from "../lib/supabaseClient";
import { getSignedUrl } from "../lib/attachmentsApi";

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function normalizeUrl(input) {
  const raw = safeStr(input).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

async function apiUpdateAttachment(attachmentId, patch) {
  const { error } = await supabase
    .from("attachments")
    .update(patch)
    .eq("id", attachmentId);
  if (error) throw error;
}

export default function AssetAttachmentDetailMobileScreen({ route, navigation }) {
  const assetId = route?.params?.assetId || null;
  const attachmentId = route?.params?.attachmentId || null;
  const assetName = route?.params?.assetName || route?.params?.asset_name || route?.params?.asset?.name || "Asset";

  const { items = [], loading, refresh } = useAssetAttachments(assetId);

  const selected = useMemo(
    () => (items || []).find((x) => (x.attachment_id || x.id) === attachmentId) || null,
    [attachmentId, items]
  );

  const [draftTitle, setDraftTitle] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setDraftTitle(selected.title || "");
    setDraftNotes(selected.notes || "");
  }, [selected]);

  const saveMeta = useCallback(async () => {
    if (!selected?.attachment_id) return;

    const title = safeStr(draftTitle).trim();
    if (!title) {
      Alert.alert("Title required", "Add a short title so you can find this later.");
      return;
    }

    try {
      setSaving(true);

      await apiUpdateAttachment(selected.attachment_id, {
        title,
        notes: safeStr(draftNotes).trim() || null,
      });

      await refresh();
      Alert.alert("Saved", "Attachment updated.");
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save changes.");
    } finally {
      setSaving(false);
    }
  }, [draftNotes, draftTitle, refresh, selected]);

  const openAttachment = useCallback(async () => {
    if (!selected) return;

    try {
      setOpening(true);

      if (selected.kind === "link") {
        const url = normalizeUrl(selected.url || "");
        if (!url) {
          Alert.alert("Open failed", "No link found.");
          return;
        }
        await Linking.openURL(url);
        return;
      }

      if (!selected.storage_path || !selected.bucket) {
        Alert.alert("Open failed", "No file path found.");
        return;
      }

      const signed = await getSignedUrl({
        bucket: selected.bucket,
        path: selected.storage_path,
      });

      if (!signed) {
        Alert.alert("Open failed", "Could not create file URL.");
        return;
      }

      await Linking.openURL(signed);
    } catch (e) {
      Alert.alert("Open failed", e?.message || "Could not open attachment.");
    } finally {
      setOpening(false);
    }
  }, [selected]);

  if (loading && !selected) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (!selected) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>Attachment not found</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[layoutStyles.screen, styles.screen]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {selected.title || selected.file_name || "Attachment"}
          </Text>
          <Text style={styles.subtitle}>Ready for Context</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <TouchableOpacity
          style={styles.openBtn}
          onPress={openAttachment}
          disabled={opening}
        >
          {opening ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="open-outline" size={18} color="#fff" />
              <Text style={styles.openBtnText}>Open Attachment</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.card}>
          <Text style={styles.label}>Title</Text>
          <TextInput
            value={draftTitle}
            onChangeText={setDraftTitle}
            placeholder="Title"
            style={styles.input}
          />

          <Text style={styles.label}>Notes</Text>
          <TextInput
            value={draftNotes}
            onChangeText={setDraftNotes}
            placeholder="Notes"
            style={[styles.input, styles.textarea]}
            multiline
            textAlignVertical="top"
          />
        </View>

        <TouchableOpacity
          style={[styles.saveBtn, saving && { opacity: 0.7 }]}
          onPress={saveMeta}
          disabled={saving}
        >
          {saving ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Ionicons name="save-outline" size={18} color="#fff" />
              <Text style={styles.saveBtnText}>Save</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.proofBtn}
          onPress={() =>
            navigation.navigate("ProofBuilder", {
              assetId,
              assetName,
              attachmentId: selected.attachment_id || selected.id,
              role: selected.role,
              returnRoute: "AssetAttachmentsMobile",
              returnParams: { assetId, assetName },
            })
          }
        >
          <Ionicons name="document-text-outline" size={18} color={colors.textPrimary} />
          <Text style={styles.proofBtnText}>Open Proof Builder</Text>
        </TouchableOpacity>
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
    fontSize: 16,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  body: {
    padding: spacing.lg,
  },
  openBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.lg,
    paddingVertical: 12,
  },
  openBtnText: {
    marginLeft: 8,
    color: "#fff",
    fontWeight: "800",
  },
  card: {
    marginTop: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  label: {
    marginTop: spacing.sm,
    color: colors.textSecondary,
    fontWeight: "700",
  },
  input: {
    marginTop: 6,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.textPrimary,
  },
  textarea: {
    minHeight: 120,
  },
  saveBtn: {
    marginTop: spacing.lg,
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
  proofBtn: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 12,
  },
  proofBtnText: {
    marginLeft: 8,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyTitle: {
    fontWeight: "800",
    color: colors.textPrimary,
  },
});
