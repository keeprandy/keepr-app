
import React, { useCallback, useEffect, useMemo, useState } from "react";
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
  Platform,
  Modal,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";

import { layoutStyles } from "../styles/layout";
import { colors, radius, spacing } from "../styles/theme";
import { useAssetAttachments } from "../hooks/useAttachments";
import { supabase } from "../lib/supabaseClient";
import {
  createLinkAttachment,
  createTextAttachment,
  uploadAttachmentFromUri,
} from "../lib/attachmentsUploader";
import { inferSharedFileMimeType, isSharedFileImage } from "../lib/shareIntentPayload";
import LinkCoverCard from "../components/LinkCoverCard";
import { enrichLinkAttachment, shouldEnrichLinkAttachment } from "../lib/linkCover";

import { useFocusEffect } from "@react-navigation/native";

const IS_WEB = Platform.OS === "web";

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function normalizeUrl(input) {
  const raw = safeStr(input).trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "object") return v.content || "";
  return "";
}

export default function AssetAttachmentsMobileScreen({ route, navigation }) {
  const assetId =
    route?.params?.assetId ||
    route?.params?.asset_id ||
    route?.params?.id ||
    route?.params?.asset?.id ||
    null;

  const assetName =
    route?.params?.assetName ||
    route?.params?.asset_name ||
    route?.params?.asset?.name ||
    "Asset";

  const fromTargetType = route?.params?.targetType || null;
  const fromTargetId = route?.params?.targetId || null;
  const fromTargetRole = route?.params?.targetRole || null;
  const returnToAttachmentsParams = useMemo(
    () => ({
      assetId,
      assetName,
      targetType: fromTargetType,
      targetId: fromTargetId,
      targetRole: fromTargetRole,
    }),
    [assetId, assetName, fromTargetId, fromTargetRole, fromTargetType]
  );

  const { items: hookItems = [], loading, error, refresh } = useAssetAttachments(assetId);

  const [q, setQ] = useState("");
  const [tab, setTab] = useState("all");
  const [uploading, setUploading] = useState(false);
  const [showWebLinkModal, setShowWebLinkModal] = useState(false);
  const [webLinkValue, setWebLinkValue] = useState("");
  const [optimisticItems, setOptimisticItems] = useState([]);
  const [linkCoverLoading, setLinkCoverLoading] = useState({});

  const filtered = useMemo(() => {
    const query = q.trim().toLowerCase();

    return ([...optimisticItems, ...(hookItems || [])])
      .filter((x) => {
        const kind = safeStr(x.kind).toLowerCase();
        if (tab === "all") return true;
        if (tab === "link") return kind === "link";
        if (tab === "photo") return kind === "photo";
        if (tab === "file") return kind !== "photo" && kind !== "link";
        return true;
      })
      .filter((x) => {
        if (!query) return true;
        const hay =
        `${asText(x.title)} ${asText(x.notes)} ${asText(x.file_name)} ${asText(x.url)}`
          .toLowerCase();
        return hay.includes(query);
      })
      .sort((a, b) => {
        const da = a.created_at || "";
        const db = b.created_at || "";
        return db.localeCompare(da);
      });
 }, [hookItems, optimisticItems, q, tab]);

useEffect(() => {
  let cancelled = false;
  const visibleLinks = (filtered || [])
    .filter((row) => row?.kind === "link")
    .filter((row) => shouldEnrichLinkAttachment(row))
    .slice(0, 4);

  if (visibleLinks.length === 0) return () => {
    cancelled = true;
  };

  (async () => {
    for (const row of visibleLinks) {
      if (cancelled) break;
      const id = row.attachment_id || row.id;
      if (!id) continue;
      setLinkCoverLoading((prev) => ({ ...prev, [id]: true }));
      try {
        await enrichLinkAttachment(row);
        if (!cancelled) await refresh();
      } catch (e) {
        console.log("Link cover enrichment failed", e?.message || e);
      } finally {
        if (!cancelled) {
          setLinkCoverLoading((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
        }
      }
    }
  })();

  return () => {
    cancelled = true;
  };
}, [filtered, refresh]);

const buildPlacements = useCallback(() => {
  const placements = [];

  if (assetId) {
    placements.push({
      target_type: "asset",
      target_id: assetId,
      role: "other",
    });
  }

  if (
    fromTargetType &&
    fromTargetId &&
    (fromTargetType === "system" || fromTargetType === "service_record")
  ) {
    placements.push({
      target_type: fromTargetType,
      target_id: fromTargetId,
      role: fromTargetRole || "other",
    });
  }

  return placements;
}, [assetId, fromTargetId, fromTargetRole, fromTargetType]);

  const scanDocument = useCallback(async () => {
  if (IS_WEB) return;

  try {
    const cameraPerm = await ImagePicker.requestCameraPermissionsAsync();
    if (cameraPerm.status !== "granted") {
      Alert.alert("Permission required", "Please allow camera access.");
      return;
    }

    setUploading(true);

    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (!userId) throw new Error("Not signed in.");

    const res = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.5,
      allowsEditing: false,
      exif: false,
    });

    if (res.canceled) return;

    const a = res.assets?.[0];
    if (!a?.uri) return;

    const now = new Date();

    const date = now.toISOString().slice(0, 10);
    const time = now.toTimeString().slice(0, 8).replace(/:/g, "");

    const generatedFileName = `scan_${date}_${time}.jpg`;

    await uploadAttachmentFromUri({
      userId,
      assetId,
      kind: "file",
      fileUri: a.uri,
      fileName: generatedFileName,
      mimeType: a.mimeType || "image/jpeg",
      sizeBytes: a.fileSize || null,
      placements: buildPlacements(),
    });

    await refresh();
    Alert.alert("Saved to Keepr", "Scanned document is ready for context.");
  } catch (e) {
    Alert.alert("Scan failed", e?.message || "Could not scan document.");
  } finally {
    setUploading(false);
  }
}, [assetId, buildPlacements, refresh]);

  const addCameraPhoto = useCallback(async () => {
    if (IS_WEB) return;

    try {
      const cameraPerm = await ImagePicker.requestCameraPermissionsAsync();
      if (cameraPerm.status !== "granted") {
        Alert.alert("Permission required", "Please allow camera access.");
        return;
      }

      setUploading(true);

      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const res = await ImagePicker.launchCameraAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        allowsEditing: false,
        exif: false,
      });

      if (res.canceled) return;

      const a = res.assets?.[0];
      if (!a?.uri) return;

      await uploadAttachmentFromUri({
        userId,
        assetId,
        kind: "photo",
        fileUri: a.uri,
        fileName: a.fileName || a.uri.split("/").pop() || "camera-photo.jpg",
        mimeType: a.mimeType || "image/jpeg",
        sizeBytes: a.fileSize || null,
        placements: buildPlacements(),
      });

      await refresh();
      Alert.alert("Saved to Keepr", "Ready for Context.");
    } catch (e) {
      Alert.alert("Upload failed", e?.message || "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  }, [assetId, buildPlacements, refresh]);

  const addPhotoFromLibrary = useCallback(async () => {
    if (IS_WEB) return;

    try {
      setUploading(true);

      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (perm.status !== "granted") {
        Alert.alert("Permission required", "Please allow photo library access.");
        return;
      }

      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        allowsEditing: false,
        exif: false,
      });

      if (res.canceled) return;

      const a = res.assets?.[0];
      if (!a?.uri) return;

      await uploadAttachmentFromUri({
        userId,
        assetId,
        kind: "photo",
        fileUri: a.uri,
        fileName: a.fileName || a.uri.split("/").pop() || "photo.jpg",
        mimeType: a.mimeType || "image/jpeg",
        sizeBytes: a.fileSize || null,
        placements: buildPlacements(),
      });

      await refresh();
      Alert.alert("Saved to Keepr", "Ready for Context.");
    } catch (e) {
      Alert.alert("Upload failed", e?.message || "Could not upload photo.");
    } finally {
      setUploading(false);
    }
  }, [assetId, buildPlacements, refresh]);

const addFile = useCallback(async () => {
  try {
    setUploading(true);

    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (!userId) throw new Error("Not signed in.");

    // ✅ WEB VERSION
    if (IS_WEB) {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.onchange = async (e) => {
          try {
            const file = e.target.files?.[0];
            if (!file) return resolve();

            const fileUri = URL.createObjectURL(file);

            await uploadAttachmentFromUri({
              userId,
              assetId,
              kind: "file",
              fileUri,
              fileName: file.name,
              mimeType: file.type || "application/octet-stream",
              sizeBytes: file.size || null,
              placements: buildPlacements(),
            });

            await refresh();
            Alert.alert("Saved to Keepr", "Ready for Context.");
          } catch (err) {
            Alert.alert("Upload failed", err?.message || "Could not upload file.");
          } finally {
            setUploading(false);
            resolve();
          }
        };

        input.click();
      });
    }

    // ✅ MOBILE VERSION (unchanged)
    const res = await DocumentPicker.getDocumentAsync({
      type: "*/*",
      multiple: false,
      copyToCacheDirectory: true,
    });

    if (res.canceled) return;

    const f = res.assets?.[0];
    if (!f?.uri) return;

    await uploadAttachmentFromUri({
      userId,
      assetId,
      kind: "file",
      fileUri: f.uri,
      fileName: f.name || f.uri.split("/").pop() || "file",
      mimeType: f.mimeType || "application/octet-stream",
      sizeBytes: f.size || null,
      placements: buildPlacements(),
    });

    await refresh();
    Alert.alert("Saved to Keepr", "Ready for Context.");
  } catch (e) {
    Alert.alert("Upload failed", e?.message || "Could not upload file.");
  } finally {
    setUploading(false);
  }
}, [assetId, buildPlacements, refresh]);

const addLink = useCallback(() => {
  if (IS_WEB) {
    setWebLinkValue("");
    setShowWebLinkModal(true);
    return;
  }

  if (Platform.OS === "ios") {
    Alert.prompt(
      "Add Link",
      "Paste a URL",
      async (value) => {
        try {
          const url = normalizeUrl(value);
          if (!url) return;

          setUploading(true);

          const { data } = await supabase.auth.getUser();
          const userId = data?.user?.id;
          if (!userId) throw new Error("Not signed in.");

          await createLinkAttachment({
            userId,
            assetId,
            url,
            title: url,
            notes: null,
            placements: buildPlacements(),
          });

          await refresh();
          Alert.alert("Link Added", "Ready for context.");
        } catch (e) {
          Alert.alert("Add link failed", e?.message || "Could not add link.");
        } finally {
          setUploading(false);
        }
      }
    );
    return;
  }

  Alert.alert("Add Link", "Link capture prompt is wired for iPhone first.");
}, [assetId, buildPlacements, refresh]);

const saveWebLink = useCallback(async () => {
  try {
    const url = normalizeUrl(webLinkValue);
    if (!url) {
      Alert.alert("Missing link", "Paste a valid URL.");
      return;
    }

    setUploading(true);

    const { data } = await supabase.auth.getUser();
    const userId = data?.user?.id;
    if (!userId) throw new Error("Not signed in.");

    await createLinkAttachment({
      userId,
      assetId,
      url,
      title: url,
      notes: null,
      placements: buildPlacements(),
    });

    setShowWebLinkModal(false);
    setWebLinkValue("");
    await refresh();
    Alert.alert("Saved to Keepr", "Link added.");
  } catch (e) {
    Alert.alert("Add link failed", e?.message || "Could not add link.");
  } finally {
    setUploading(false);
  }
}, [webLinkValue, assetId, buildPlacements, refresh]);

const openQuickCapture = useCallback(() => {
  if (uploading) return;

  if (IS_WEB) {
    // ✅ Web fallback = direct file upload
    addFile();
    return;
  }

  Alert.alert("Quick Capture", "What would you like to add?", [
    { text: "Cancel", style: "cancel" },
    {
      text: "Scan Document",
      onPress: () =>
        navigation.navigate("ScanDocumentMobile", {
          assetId,
          assetName,
          targetType: fromTargetType,
          targetId: fromTargetId,
          targetRole: fromTargetRole,
        }),
    },
    { text: "Camera", onPress: addCameraPhoto },
    { text: "Photo Library", onPress: addPhotoFromLibrary },
    { text: "File", onPress: addFile },
    { text: "Link", onPress: addLink },
  ]);
}, [
  addCameraPhoto,
  addFile,
  addLink,
  addPhotoFromLibrary,
  uploading,
  navigation,
  assetId,
  assetName,
  fromTargetType,
  fromTargetId,
  fromTargetRole,
]);

useEffect(() => {
  const optimisticItem = route?.params?.optimisticItem;
  if (!optimisticItem || !assetId) return;

  setTimeout(() => {
    setOptimisticItems((prev) => {
      if (prev.some((x) => x.id === optimisticItem.id)) return prev;
      return [optimisticItem, ...prev];
    });
  }, 50);

  navigation.setParams({ optimisticItem: null });
}, [route?.params?.optimisticItem, assetId]);



useEffect(() => {
  const incoming = route?.params?.incomingShare;
  if (!incoming || !assetId) return;

  // 🔥 prevent duplicate runs immediately
  navigation.setParams({ incomingShare: null });

  const run = async () => {
    try {
      setUploading(true);

      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;
      if (!userId) throw new Error("Not signed in.");

      const file =
      incoming?.file ||
      (Array.isArray(incoming?.files) ? incoming.files[0] : null) ||
      null;
      const url = incoming?.url || incoming?.webUrl || null;
      const text = incoming?.text || null;

      const fileUri =
        file?.uri ||
        file?.path ||
        file?.filePath ||
        file?.contentUri;

      if (fileUri) {
        const mimeType =
        inferSharedFileMimeType({
          ...file,
          uri: fileUri,
        });
        const isPhoto = isSharedFileImage({
          ...file,
          uri: fileUri,
          mimeType,
        });

        await uploadAttachmentFromUri({
          userId,
          assetId,
          kind: isPhoto ? "photo" : "file",
          fileUri,
          fileName:
            file.fileName ||
            file.name ||
            file.fileNameWithExtension ||
            fileUri.split("/").pop() ||
            (isPhoto ? "shared-photo.jpg" : "shared-file"),
          mimeType,
          sizeBytes: file.size || file.fileSize || null,
          placements: buildPlacements(),
        });
      } else if (url) {
        
        await createLinkAttachment({
          userId,
          assetId,
          url,
          title: url,
          notes: null,
          placements: buildPlacements(),
        });
      } else if (text && /^https?:\/\//i.test(text)) {
        await createLinkAttachment({
          userId,
          assetId,
          url: text,
          title: text,
          notes: null,
          placements: buildPlacements(),
        });
      } else if (text) {
        await createTextAttachment({
          userId,
          assetId,
          text,
          title: "Shared text",
          placements: buildPlacements(),
        });
      } else {
        throw new Error("No supported shared item found.");
      }

      await refresh();

      // 🔥 let optimistic row live briefly so user sees it
      setTimeout(() => {
        setOptimisticItems([]);
      }, 400);

      Alert.alert("Saved to Keepr", "Ready for Context.");
    } catch (e) {
      Alert.alert("Send to Keepr failed", e?.message || "Could not save shared item.");
    } finally {
      setUploading(false);
    }
  };

  run();
}, [route?.params?.incomingShare, assetId]);

useEffect(() => {
  if (route?.params?.autoOpen === "camera" && !IS_WEB) {
    navigation.setParams({ autoOpen: null });
    addCameraPhoto();
  }
}, [route?.params?.autoOpen, addCameraPhoto, navigation]);

useEffect(() => {
  if (route?.params?.autoOpen === "scan" && !IS_WEB) {
    navigation.setParams({ autoOpen: null });

    navigation.navigate("ScanDocumentMobile", {
      assetId,
      assetName,
      targetType: fromTargetType,
      targetId: fromTargetId,
      targetRole: fromTargetRole,
    });
  }
}, [
  route?.params?.autoOpen,
  navigation,
  assetId,
  assetName,
  fromTargetType,
  fromTargetId,
  fromTargetRole,
]);

useEffect(() => {
  const openAttachmentId = route?.params?.openAttachmentId;
  if (!openAttachmentId) return;

  navigation.setParams({ openAttachmentId: null });

  navigation.navigate("ProofBuilder", {
    assetId,
    assetName,
    attachmentId: openAttachmentId,
    returnRoute: "AssetAttachmentsMobile",
    returnParams: returnToAttachmentsParams,
  });
}, [route?.params?.openAttachmentId, navigation, assetId, assetName, returnToAttachmentsParams]);

useEffect(() => {
  if (route?.params?.autoOpen === "library" && !IS_WEB) {
    navigation.setParams({ autoOpen: null });
    addPhotoFromLibrary();
  }
}, [route?.params?.autoOpen, addPhotoFromLibrary, navigation]);

useFocusEffect(
  useCallback(() => {
    if (!assetId) return;
    refresh();
  }, [assetId, refresh])
);

useEffect(() => {
  if (route?.params?.autoOpen === "file") {
    navigation.setParams({ autoOpen: null });
    addFile();
  }
}, [route?.params?.autoOpen, addFile, navigation]);


  const openDetail = useCallback(
    (row) => {
      navigation.navigate("ProofBuilder", {
        assetId,
        assetName,
        attachmentId: row.attachment_id || row.id,
        returnRoute: "AssetAttachmentsMobile",
        returnParams: returnToAttachmentsParams,
      });
    },
    [assetId, assetName, navigation, returnToAttachmentsParams]
  );

  const retryLinkCover = useCallback(async (row) => {
    const id = row?.attachment_id || row?.id;
    if (!id) return;
    setLinkCoverLoading((prev) => ({ ...prev, [id]: true }));
    try {
      await enrichLinkAttachment(row, { force: true });
      await refresh();
    } catch (e) {
      Alert.alert("Preview unavailable", e?.message || "Could not refresh this link preview.");
    } finally {
      setLinkCoverLoading((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    }
  }, [refresh]);

  const openOriginalLink = useCallback(async (row) => {
    const url = normalizeUrl(row?.url || "");
    if (!url) return;
    try {
      const ok = await Linking.canOpenURL(url);
      if (!ok) throw new Error("Cannot open this URL on this device.");
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert("Open failed", e?.message || "Could not open link.");
    }
  }, []);

  return (
    
    <SafeAreaView style={[layoutStyles.screen, styles.screen]}>
<View style={styles.header}>
  <TouchableOpacity onPress={() => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate("Dashboard");
  }}>
    <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
  </TouchableOpacity>

  <View style={{ flex: 1, marginLeft: 10 }}>
    <Text style={styles.title}>{assetName}</Text>
    <Text style={styles.subtitle}>Attachments</Text>
  </View>
{IS_WEB ? (
  <TouchableOpacity
    style={styles.linkBtn}
    onPress={addLink}
    disabled={uploading}
  >
    <Ionicons name="link-outline" size={16} color={colors.textPrimary} />
    <Text style={styles.linkBtnText}>Add Link</Text>
  </TouchableOpacity>
) : null}
  <TouchableOpacity
    style={[styles.captureBtn, uploading && { opacity: 0.7 }]}
    onPress={openQuickCapture}
    disabled={uploading}
  >
    {uploading ? (
      <ActivityIndicator color="#fff" />
    ) : (
      <>
        <Ionicons name="attach-outline" size={18} color="#fff" />
        <Text style={styles.captureBtnText}>
          {IS_WEB ? "Upload" : "Quick Capture"}
        </Text>
      </>
    )}
  </TouchableOpacity>
</View>

      <View style={styles.searchWrap}>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search attachments..."
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <View style={styles.tabs}>
        {[
          ["all", "All"],
          ["photo", "Photos"],
          ["file", "Files"],
          ["link", "Links"],
        ].map(([key, label]) => (
          <TouchableOpacity
            key={key}
            onPress={() => setTab(key)}
            style={[styles.tab, tab === key && styles.tabActive]}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>
            {error?.message || "Could not load attachments."}
          </Text>
        </View>
      ) : loading && filtered.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={styles.helper}>Loading attachments…</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {filtered.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="attach-outline" size={28} color={colors.textSecondary} />
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyText}>
                Use Quick Capture to get something into Keepr fast.
              </Text>
            </View>
          ) : (
            filtered.map((row) => (
              row.kind === "link" ? (
                <LinkCoverCard
                  key={row.attachment_id || row.id}
                  attachment={row}
                  compact
                  loading={!!linkCoverLoading[row.attachment_id || row.id]}
                  onPress={() => openDetail(row)}
                  onOpen={() => openOriginalLink(row)}
                  onRetry={() => retryLinkCover(row)}
                />
              ) : (
                <TouchableOpacity
                  key={row.attachment_id || row.id}
                  style={styles.row}
                  onPress={() => openDetail(row)}
                >
                <View style={styles.rowIcon}>
                  <Ionicons
                    name={
                      row.kind === "link"
                        ? "link-outline"
                        : row.kind === "photo"
                        ? "image-outline"
                        : "document-outline"
                    }
                    size={18}
                    color={colors.textPrimary}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>
                    {asText(row.title) || asText(row.file_name) || "Attachment"}
                  </Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {row.kind === "link"
                    ? asText(row.url)
                    : asText(row.file_name)}
                  </Text>
                  {row.status === "uploading" ? (
                  <Text style={styles.rowSaving}>Saving to Keepr…</Text>
                ) : null}
                </View>

                <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              )
            ))
          )}
        </ScrollView>
      )}
                      {IS_WEB ? (
                  <Modal
                    visible={showWebLinkModal}
                    transparent
                    animationType="fade"
                    onRequestClose={() => setShowWebLinkModal(false)}
                  >
                    <View style={styles.modalBackdrop}>
                      <View style={styles.modalCard}>
                        <Text style={styles.modalTitle}>Add Link</Text>

                        <TextInput
                          value={webLinkValue}
                          onChangeText={setWebLinkValue}
                          placeholder="https://example.com"
                          autoCapitalize="none"
                          autoCorrect={false}
                          style={styles.search}
                        />

                        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 12 }}>
                          <TouchableOpacity onPress={() => setShowWebLinkModal(false)} style={styles.modalCancelBtn}>
                            <Text style={styles.modalCancelText}>Cancel</Text>
                          </TouchableOpacity>

                          <TouchableOpacity onPress={saveWebLink} style={styles.modalSaveBtn}>
                            <Text style={styles.modalSaveText}>Save Link</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </Modal>
                ) : null}
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
  captureBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.primary,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  captureBtnText: {
    marginLeft: 6,
    color: "#fff",
    fontWeight: "700",
  },
  linkBtn: {
  flexDirection: "row",
  alignItems: "center",
  marginRight: 10,
  backgroundColor: colors.surface,
  borderRadius: radius.pill,
  paddingHorizontal: 12,
  paddingVertical: 10,
},

linkBtnText: {
  marginLeft: 6,
  color: colors.textPrimary,
  fontWeight: "700",
},

rowSaving: {
  marginTop: 4,
  fontSize: 12,
  color: colors.textSecondary,
  fontWeight: "700",
},

modalBackdrop: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.25)",
  justifyContent: "center",
  padding: spacing.lg,
},

modalCard: {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  padding: spacing.lg,
},

modalTitle: {
  fontSize: 16,
  fontWeight: "800",
  color: colors.textPrimary,
  marginBottom: 12,
},

modalCancelBtn: {
  paddingHorizontal: 14,
  paddingVertical: 10,
  marginRight: 8,
},

modalCancelText: {
  color: colors.textSecondary,
  fontWeight: "700",
},

modalSaveBtn: {
  backgroundColor: colors.primary,
  borderRadius: radius.pill,
  paddingHorizontal: 14,
  paddingVertical: 10,
},

modalSaveText: {
  color: "#fff",
  fontWeight: "700",
},
  searchWrap: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  search: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.textPrimary,
  },
  tabs: {
    flexDirection: "row",
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  tab: {
    marginRight: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  tabActive: {
    backgroundColor: colors.primary,
  },
  tabText: {
    color: colors.textPrimary,
    fontWeight: "700",
  },
  tabTextActive: {
    color: "#fff",
  },
  list: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  rowTitle: {
    fontWeight: "800",
    color: colors.textPrimary,
  },
  rowSub: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  centered: {
    paddingTop: 40,
    alignItems: "center",
  },
  helper: {
    marginTop: 8,
    color: colors.textSecondary,
  },
  errorText: {
    color: "red",
  },
  emptyCard: {
    marginTop: 20,
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
});
