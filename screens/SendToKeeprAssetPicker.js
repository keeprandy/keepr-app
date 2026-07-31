import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  TextInput,
  StyleSheet,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabaseClient";
import { getSignedUrl } from "../lib/attachmentsApi";
import { isSharedFileImage } from "../lib/shareIntentPayload";
import { pickAssetHeroUri } from "../lib/assetImageResolver";
import { colors, radius, shadows } from "../styles/theme";

async function resolveAssetHeroUris(list = []) {
  const placementToAsset = {};
  (list || []).forEach((asset) => {
    if (asset?.id && asset?.hero_placement_id) {
      placementToAsset[asset.hero_placement_id] = asset.id;
    }
  });

  const placementIds = Object.keys(placementToAsset);
  if (!placementIds.length) return {};

  const { data, error } = await supabase.rpc("get_dashboard_hero_attachments", {
    placement_ids: placementIds,
  });

  if (error) return {};

  const entries = await Promise.all(
    (data || []).map(async (row) => {
      const assetId = placementToAsset[row?.placement_id];
      if (!assetId || row?.deleted_at) return null;
      if (row?.thumb_320_url) return [assetId, row.thumb_320_url];

      if (row?.bucket && row?.storage_path) {
        try {
          const signed = await getSignedUrl({
            bucket: row.bucket,
            path: row.storage_path,
            transform: {
              width: 128,
              height: 128,
              resize: "cover",
              quality: 75,
            },
          });
          if (signed) return [assetId, signed];
        } catch {}
      }

      return null;
    })
  );

  return Object.fromEntries(entries.filter(Boolean));
}

export default function SendToKeeprAssetPicker({ route, navigation }) {
  const incomingShare = route?.params?.incomingShare;

  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastAssetId, setLastAssetId] = useState(null);
  const [search, setSearch] = useState("");
  const [ready, setReady] = useState(false);
  const [selectedAssetId, setSelectedAssetId] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [assetHeroUris, setAssetHeroUris] = useState({});

  // 🔐 Cold start guard
    useEffect(() => {
      let timeout;

      if (incomingShare) {
        setReady(true);
      } else {
        // wait briefly for share intent to hydrate (cold launch)
        timeout = setTimeout(() => {
          setReady(true);
        }, 400);
      }

      return () => clearTimeout(timeout);
    }, [incomingShare]);

  useEffect(() => {
    loadAssets();
  }, []);

  const loadAssets = async () => {
    try {
      setLoadError(null);
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { data, error } = await supabase
        .from("assets")
        .select(
          "id,name,status,deleted_at,hero_placement_id,hero_thumb_url,hero_image_url,extra_metadata"
        )
        .eq("owner_id", userId)
        .is("deleted_at", null)
        .eq("status", "active")
        .order("name", { ascending: true });

      if (error) throw error;

      const clean = data || [];
      setAssets(clean);
      resolveAssetHeroUris(clean).then(setAssetHeroUris).catch(() => setAssetHeroUris({}));

      const last = await AsyncStorage.getItem(`lastCaptureAsset:${userId}`);
      const lastId = last ? String(last) : null;

      const stillExists = clean.some((a) => a.id === lastId);

      if (!stillExists) {
        await AsyncStorage.removeItem(`lastCaptureAsset:${userId}`);
        setLastAssetId(null);
      } else {
        setLastAssetId(lastId);
      }
    } catch (e) {
      console.log("Asset load failed", e);
      setLoadError(e?.message || "Could not load your assets.");
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (asset) => {
    try {
      setSelectedAssetId(asset.id);
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;

      await AsyncStorage.setItem(
        `lastCaptureAsset:${userId}`,
        asset.id
      );

      const payload = incomingShare ? { ...incomingShare } : null;

      navigation.setParams({ incomingShare: null });

      const tempId = `temp-${Date.now()}`;

      const optimisticItem = {
        id: tempId,
        attachment_id: tempId,
        kind: payload?.file
          ? isSharedFileImage(payload.file)
            ? "photo"
            : "file"
          : payload?.url
          ? "link"
          : "file",
        title:
          payload?.file?.fileName ||
          payload?.file?.name ||
          payload?.url ||
          payload?.text ||
          "Shared item",
        file_name:
          payload?.file?.fileName ||
          payload?.file?.name ||
          null,
        url: payload?.url || null,
        status: "uploading",
        created_at: new Date().toISOString(),
      };

      navigation.navigate("AssetAttachmentsMobile", {
        assetId: asset.id,
        assetName: asset.name,
        incomingShare: payload,
        optimisticItem,
      });
    } catch (e) {
      setSelectedAssetId(null);
      console.log("Select failed", e);
    }
  };

  // 🔍 Search + sort
  const filtered = useMemo(() => {
    const list = [...assets];

    list.sort((a, b) => {
      if (a.id === lastAssetId) return -1;
      if (b.id === lastAssetId) return 1;
      return a.name.localeCompare(b.name);
    });

    if (!search.trim()) return list;

    return list.filter((a) =>
      a.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [assets, lastAssetId, search]);

  const sourceSummary = useMemo(() => {
    const file = incomingShare?.file || null;
    const isImage = file ? isSharedFileImage(file) : false;
    const fileUri = file?.uri || file?.path || file?.filePath || file?.contentUri || null;

    if (file) {
      return {
        icon: isImage ? "image-outline" : "document-text-outline",
        label: isImage ? "Photo" : "File",
        title: file.fileName || file.name || "Shared file",
        body: isImage ? "Ready to add as photo proof." : "Ready to add as a Keepr file.",
        imageUri: isImage ? fileUri : null,
      };
    }

    if (incomingShare?.url) {
      let host = incomingShare.url;
      try {
        host = new URL(incomingShare.url).hostname.replace(/^www\./, "");
      } catch {}
      return {
        icon: "link-outline",
        label: "Link",
        title: host || "Shared link",
        body: incomingShare.url,
        imageUri: null,
      };
    }

    if (incomingShare?.text) {
      return {
        icon: "document-outline",
        label: "Text",
        title: "Shared text",
        body: incomingShare.text,
        imageUri: null,
      };
    }

    return {
      icon: "cube-outline",
      label: "Keepr",
      title: "Shared item",
      body: "Choose an asset to add this to Keepr.",
      imageUri: null,
    };
  }, [incomingShare]);

  // Loading
  if (loading || !ready) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.loadingText}>Preparing Share to Keepr...</Text>
        </View>
      </SafeAreaView>
    );
  }

  const renderPreview = () => {
    return (
      <View style={styles.previewCard}>
        {sourceSummary.imageUri ? (
          <Image source={{ uri: sourceSummary.imageUri }} style={styles.previewImage} />
        ) : (
          <View style={styles.previewIcon}>
            <Ionicons name={sourceSummary.icon} size={24} color={colors.primary} />
          </View>
        )}
        <View style={styles.previewText}>
          <Text style={styles.eyebrow}>Share to Keepr</Text>
          <Text style={styles.previewTitle} numberOfLines={2}>
            {sourceSummary.title}
          </Text>
          <Text style={styles.previewBody} numberOfLines={2}>
            {sourceSummary.body}
          </Text>
          {incomingShare?.singleItemOnly && (
            <Text style={styles.previewNote}>Only the first shared item will be added.</Text>
          )}
        </View>
      </View>
    );
  };

  const getAssetImageUri = (asset) => {
    return assetHeroUris[asset?.id] || pickAssetHeroUri(asset);
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right", "bottom"]}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.closeButton}
            onPress={() => navigation.canGoBack?.() ? navigation.goBack() : navigation.navigate("Dashboard")}
          >
            <Ionicons name="close" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerText}>
            <Text style={styles.title}>Add to Keepr</Text>
            <Text style={styles.subtitle}>Choose the asset this belongs to.</Text>
          </View>
        </View>

        {renderPreview()}

        <View style={styles.searchWrap}>
          <Ionicons name="search-outline" size={18} color={colors.textMuted} />
          <TextInput
            placeholder="Search assets"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.searchInput}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch("")} style={styles.clearSearch}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => {
            const isLast = item.id === lastAssetId;
            const isSaving = item.id === selectedAssetId;
            const assetImageUri = getAssetImageUri(item);

            return (
              <TouchableOpacity
                onPress={() => handleSelect(item)}
                style={styles.assetCard}
                activeOpacity={0.82}
                disabled={!!selectedAssetId}
              >
                {assetImageUri ? (
                  <Image source={{ uri: assetImageUri }} style={styles.assetImage} />
                ) : (
                  <View style={styles.assetIcon}>
                    <Ionicons name="cube-outline" size={20} color={colors.primary} />
                  </View>
                )}
                <View style={styles.assetText}>
                  <Text style={styles.assetName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <View style={styles.metaRow}>
                    <Text style={styles.assetMeta}>Asset</Text>
                    {isLast && <Text style={styles.lastUsed}>Last used</Text>}
                  </View>
                </View>
                <View style={[styles.addButton, isSaving && styles.addButtonSaving]}>
                  {isSaving ? (
                    <ActivityIndicator size="small" color={colors.onPrimary} />
                  ) : (
                    <>
                      <Text style={styles.addButtonText}>Add here</Text>
                      <Ionicons name="arrow-forward" size={15} color={colors.onPrimary} />
                    </>
                  )}
                </View>
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Ionicons name="search-outline" size={24} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>
                {loadError ? "Assets unavailable" : "No assets found"}
              </Text>
              <Text style={styles.emptyBody}>Try another search or add this from Keepr after creating an asset.</Text>
              {loadError && (
                <TouchableOpacity style={styles.retryButton} onPress={loadAssets}>
                  <Text style={styles.retryButtonText}>Retry</Text>
                </TouchableOpacity>
              )}
            </View>
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  loadingText: {
    marginTop: 12,
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingTop: 12,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  closeButton: {
    width: 42,
    height: 42,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  headerText: {
    flex: 1,
  },
  title: {
    fontSize: 26,
    lineHeight: 30,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 3,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  previewCard: {
    flexDirection: "row",
    padding: 14,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    ...shadows.subtle,
  },
  previewImage: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
  },
  previewIcon: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    backgroundColor: "#EEF5FF",
    alignItems: "center",
    justifyContent: "center",
  },
  previewText: {
    flex: 1,
    marginLeft: 12,
    minWidth: 0,
  },
  eyebrow: {
    fontSize: 11,
    lineHeight: 14,
    fontWeight: "900",
    color: colors.primary,
    textTransform: "uppercase",
  },
  previewTitle: {
    marginTop: 3,
    fontSize: 16,
    lineHeight: 20,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  previewBody: {
    marginTop: 4,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  previewNote: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 16,
    color: colors.textMuted,
    fontWeight: "700",
  },
  searchWrap: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    marginLeft: 8,
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "700",
  },
  clearSearch: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  listContent: {
    paddingBottom: 28,
  },
  assetCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    marginBottom: 10,
  },
  assetIcon: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: "#EEF5FF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  assetImage: {
    width: 42,
    height: 42,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceSubtle,
    marginRight: 12,
  },
  assetText: {
    flex: 1,
    minWidth: 0,
  },
  assetName: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 3,
  },
  assetMeta: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: "700",
  },
  lastUsed: {
    marginLeft: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: "#EAF2FF",
    color: colors.primary,
    fontSize: 11,
    fontWeight: "900",
  },
  addButton: {
    minWidth: 94,
    minHeight: 38,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginLeft: 10,
    paddingHorizontal: 12,
  },
  addButtonSaving: {
    opacity: 0.8,
  },
  addButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
    marginRight: 5,
  },
  emptyState: {
    marginTop: 36,
    padding: 24,
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  emptyTitle: {
    marginTop: 10,
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  emptyBody: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textMuted,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 14,
    minHeight: 38,
    paddingHorizontal: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  retryButtonText: {
    color: colors.onPrimary,
    fontSize: 13,
    fontWeight: "900",
  },
});
