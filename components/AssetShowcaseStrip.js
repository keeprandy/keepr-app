// components/AssetShowcaseStrip.js
import React, { useMemo } from "react";
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAttachments } from "../hooks/useAttachments";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { setPlacementShowcase } from "../lib/attachmentsApi";
import * as ImagePicker from "expo-image-picker";
import { colors, spacing, radius, shadows } from "../styles/theme";

const IS_WEB = Platform.OS === "web";

export default function AssetShowcaseStrip({
  assetId,
  title = "Showcase",
}) {
  const {
    items,
    loading,
    error,
    refresh,
  } = useAttachments("asset", assetId);

  const showcasePhotos = useMemo(() => {
    return (items || []).filter(
      (x) =>
        (x._isPhoto || x.kind === "photo") &&
        x.target_type === "asset" &&
        x.target_id === assetId &&
        !!x.is_showcase
    );
  }, [items, assetId]);

  const hero = showcasePhotos[0] || null;

  const pickPhoto = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") return;

    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9,
    });
    if (res.canceled) return;
    const a = res.assets?.[0];
    if (!a?.uri) return;

    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (!userId) return;

    await uploadAttachmentFromUri({
      userId,
      assetId,
      kind: "photo",
      fileUri: a.uri,
      fileName: a.fileName || a.uri.split("/").pop() || "photo.jpg",
      mimeType: a.mimeType || "image/jpeg",
      sizeBytes: a.fileSize || null,
      placements: [
        {
          target_type: "asset",
          target_id: assetId,
          role: "other",
          is_showcase: true,
        },
      ],
      source_context: {
        origin: "asset_showcase",
        asset_id: assetId,
      },
    });

    await refresh();
  };

  const toggleShowcase = async (row, value) => {
    await setPlacementShowcase({
      attachment_id: row.attachment_id,
      target_type: "asset",
      target_id: assetId,
      is_showcase: value,
    });
    await refresh();
  };

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={refresh}
            style={styles.iconBtn}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator size="small" />
            ) : (
              <Ionicons
                name="refresh"
                size={18}
                color={colors.textPrimary}
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={pickPhoto} style={styles.addBtn}>
            <Ionicons name="add" size={18} color="#fff" />
            <Text style={styles.addText}>Add photo</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* HERO */}
      {hero ? (
        <View style={styles.hero}>
          <Image
            source={{
              uri:
                hero.public_url ||
                hero.thumbnail_url ||
                hero.url ||
                "",
            }}
            style={styles.heroImage}
            resizeMode="cover"
          />
        </View>
      ) : (
        <View style={styles.heroEmpty}>
          <Ionicons
            name="image-outline"
            size={26}
            color={colors.textSecondary}
          />
          <Text style={styles.heroEmptyText}>
            Add a photo to start your showcase.
          </Text>
        </View>
      )}

      {/* STRIP */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
      >
        {showcasePhotos.map((row) => (
          <TouchableOpacity
            key={row.placement_id}
            style={styles.thumbWrap}
            onLongPress={() => toggleShowcase(row, false)}
          >
            <Image
              source={{
                uri:
                  row.public_url ||
                  row.thumbnail_url ||
                  row.url ||
                  "",
              }}
              style={styles.thumb}
              resizeMode="cover"
            />
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    ...shadows.sm,
    marginBottom: spacing.lg,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  title: { fontWeight: "900", color: colors.textPrimary, fontSize: 14 },
  headerRight: { flexDirection: "row", alignItems: "center" },
  iconBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  addBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
  },
  addText: {
    marginLeft: 6,
    color: "#fff",
    fontWeight: "900",
  },

  hero: {
    borderRadius: radius.lg,
    overflow: "hidden",
    backgroundColor: colors.surfaceSubtle,
    marginBottom: spacing.sm,
  },
  heroImage: {
    width: "100%",
    aspectRatio: 16 / 9,
  },
  heroEmpty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: spacing.sm,
  },
  heroEmptyText: {
    marginTop: 6,
    color: colors.textSecondary,
  },

  strip: { paddingTop: spacing.xs },
  thumbWrap: {
    marginRight: spacing.sm,
    borderRadius: radius.md,
    overflow: "hidden",
    backgroundColor: colors.surfaceSubtle,
  },
  thumb: {
    width: 80,
    height: 80,
  },
});
