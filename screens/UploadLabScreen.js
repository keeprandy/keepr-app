// screens/UploadLabScreen.js
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";

import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, shadows } from "../styles/theme";

import AttachmentsStrip from "../components/AttachmentsStrip";

/**
 * UPIP / Upload Lab (Production-like)
 *
 * GOAL:
 * - Lab uses the SAME storage prefixes as production attachments:
 *   users/{uid}/attachments/photos/...
 *   users/{uid}/attachments/files/...
 *
 * BUCKETS:
 * - photos -> asset-photos
 * - files  -> asset-files
 *
 * NOTE:
 * - This lab remains Storage-only (no DB) to stabilize upload + view + delete.
 */

const PHOTO_BUCKET = "asset-photos";
const FILE_BUCKET = "asset-files";

// Signed URL TTL (seconds) for private buckets
const SIGNED_URL_TTL = 60 * 60; // 1 hour

const IS_WEB = Platform.OS === "web";

// Expo SDK-safe mediaTypes
const IMAGE_MEDIA_TYPES = Array.isArray(ImagePicker?.MediaType?.Images)
  ? ImagePicker.MediaType.Images
  : ImagePicker?.MediaType?.Images
  ? [ImagePicker.MediaType.Images]
  : ImagePicker?.MediaTypeOptions?.Images ?? "Images";

function nowIso() {
  try {
    return new Date().toISOString();
  } catch {
    return null;
  }
}

function sanitizeName(name) {
  return String(name || "file")
    .replace(/[^\w.\-]+/g, "_")
    .slice(0, 120);
}

function guessContentTypeFromName(name, fallback = "application/octet-stream") {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".heic")) return "image/heic";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".txt")) return "text/plain";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx"))
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (lower.endsWith(".ppt"))
    return "application/vnd.ms-powerpoint";
  if (lower.endsWith(".pptx"))
    return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
  return fallback;
}

function pickExifSummary(exif) {
  if (!exif || typeof exif !== "object") return null;

  const get = (k) => exif?.[k];

  const make = get("Make") || get("make");
  const model = get("Model") || get("model");
  const lens = get("LensModel") || get("lensModel");

  const dateOriginal =
    get("DateTimeOriginal") ||
    get("DateTimeDigitized") ||
    get("DateTime") ||
    get("datetime") ||
    get("dateTimeOriginal");

  const lat = get("GPSLatitude") || get("latitude");
  const lng = get("GPSLongitude") || get("longitude");

  return {
    make: make || null,
    model: model || null,
    lens: lens || null,
    capturedAtExif: dateOriginal || null,
    gpsMaybe: lat || lng ? { lat: lat ?? null, lng: lng ?? null } : null,
  };
}

async function getUserId() {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  return data?.user?.id || "anon";
}

// Web: fetch(uri)->blob
async function uriToUploadBodyWeb(uri) {
  const resp = await fetch(uri);
  const blob = await resp.blob();
  return blob;
}

// Native: base64 -> bytes (avoids content:// weirdness)
function base64ToUint8Array(base64) {
  // eslint-disable-next-line no-undef
  const hasBuffer = typeof Buffer !== "undefined";
  if (hasBuffer) {
    // eslint-disable-next-line no-undef
    return Uint8Array.from(Buffer.from(base64, "base64"));
  }
  // eslint-disable-next-line no-undef
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function uriToUploadBodyNative(uri) {
  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  return base64ToUint8Array(base64);
}

async function uploadToSupabaseStorage({
  bucket,
  path,
  uri,
  contentType,
  upsert = false,
}) {
  const body =
    Platform.OS === "web"
      ? await uriToUploadBodyWeb(uri)
      : await uriToUploadBodyNative(uri);

  const { error: uploadErr } = await supabase.storage
    .from(bucket)
    .upload(path, body, {
      contentType: contentType || "application/octet-stream",
      upsert,
    });

  if (uploadErr) throw uploadErr;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return { publicUrl: data?.publicUrl || null, path };
}

async function trySignedUrl(bucket, path) {
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, SIGNED_URL_TTL);
    if (error) return null;
    return data?.signedUrl || null;
  } catch {
    return null;
  }
}

export default function UploadLabScreen() {
  const [busy, setBusy] = useState(false);

  const [bucketMode, setBucketMode] = useState("photos"); // "photos" | "files"
  const bucket = bucketMode === "photos" ? PHOTO_BUCKET : FILE_BUCKET;

  const [userId, setUserId] = useState(null);
  const [items, setItems] = useState([]);

  const [knownByPath, setKnownByPath] = useState({});
  const [selectedPath, setSelectedPath] = useState(null);

  const [lastAction, setLastAction] = useState("");
  const [lastOk, setLastOk] = useState(null);
  const [lastErr, setLastErr] = useState(null);

  const [storageCheck, setStorageCheck] = useState(null);

  // ✅ PRODUCTION-LIKE PREFIX (matches bucket policies)
  const folderPrefix = useMemo(() => {
    if (!userId) return null;
    return `users/${userId}/attachments/${bucketMode}`;
  }, [userId, bucketMode]);

  const stage = useCallback((action, payload) => {
    setLastAction(action);
    setLastOk(payload ? JSON.stringify(payload, null, 2) : "ok");
    setLastErr(null);
  }, []);

  const fail = useCallback((action, err, extra) => {
    setLastAction(action);
    setLastOk(null);

    const shaped = {
      action,
      platform: Platform.OS,
      extra: extra || null,
      error:
        err?.message
          ? { message: err.message, ...err }
          : err && typeof err === "object"
          ? err
          : { message: String(err) },
    };

    try {
      setLastErr(JSON.stringify(shaped, null, 2));
    } catch {
      setLastErr(String(err?.message || err));
    }
  }, []);

  const openAttachment = useCallback((att) => {
    const url = att?.url || att?.publicUrl;
    if (!url) return;
    if (Platform.OS === "web") {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      Linking.openURL(url);
    }
  }, []);

  const remember = useCallback((storagePath, info) => {
    setKnownByPath((prev) => ({
      ...prev,
      [storagePath]: {
        ...(prev?.[storagePath] || {}),
        ...(info || {}),
      },
    }));
  }, []);

  const refreshList = useCallback(async () => {
    if (!folderPrefix) return;

    try {
      setBusy(true);
      stage("list() start", { bucket, folderPrefix });

      const { data, error } = await supabase.storage.from(bucket).list(folderPrefix, {
        limit: 100,
        offset: 0,
        sortBy: { column: "updated_at", order: "desc" },
      });

      if (error) throw error;

      const normalized = await Promise.all(
        (data || []).map(async (obj) => {
          const fullPath = `${folderPrefix}/${obj.name}`;

          const { data: pub } = supabase.storage.from(bucket).getPublicUrl(fullPath);
          const publicUrl = pub?.publicUrl || null;

          const signedUrl = await trySignedUrl(bucket, fullPath);

          return {
            name: obj.name,
            fullPath,
            publicUrl,
            signedUrl,
            updated_at: obj.updated_at || null,
            metadata: obj.metadata || null,
            kind: bucketMode === "photos" ? "photo" : "file",
          };
        })
      );

      setItems(normalized);
      stage("list() ok", { bucket, folderPrefix, count: normalized.length });
    } catch (e) {
      fail("list() failed", e, { bucket, folderPrefix });
    } finally {
      setBusy(false);
    }
  }, [bucket, bucketMode, fail, folderPrefix, stage]);

  useEffect(() => {
    (async () => {
      try {
        stage("auth.getUser() start");
        const id = await getUserId();
        setUserId(id);
        stage("auth.getUser() ok", { userId: id });
      } catch (e) {
        fail("auth.getUser() failed", e);
        setUserId("anon");
      }
    })();
  }, [fail, stage]);

  // ✅ auto refresh on mode/user
  useEffect(() => {
    refreshList();
  }, [refreshList]);

  const runStorageCheck = async () => {
    try {
      setBusy(true);
      setStorageCheck(null);
      stage("storage check start");

      const id = userId || (await getUserId());

      // ✅ production-like prefixes
      const photoPrefix = `users/${id}/attachments/photos`;
      const filePrefix = `users/${id}/attachments/files`;

      const checkOne = async (b, prefix) => {
        const out = { bucket: b, prefix, ok: false, error: null, count: null };
        const { data, error } = await supabase.storage.from(b).list(prefix, {
          limit: 5,
          offset: 0,
          sortBy: { column: "updated_at", order: "desc" },
        });
        if (error) {
          out.error = error;
          return out;
        }
        out.ok = true;
        out.count = (data || []).length;
        return out;
      };

      const results = await Promise.all([
        checkOne(PHOTO_BUCKET, photoPrefix),
        checkOne(FILE_BUCKET, filePrefix),
      ]);

      setStorageCheck(results);
      stage("storage check ok", results);
    } catch (e) {
      fail("storage check failed", e);
    } finally {
      setBusy(false);
    }
  };

  const pickAndUploadPhoto = async () => {
    try {
      setBusy(true);
      stage("photo pick start");

      if (Platform.OS !== "web") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Permission needed", "Please allow photo library access.");
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: IMAGE_MEDIA_TYPES,
        quality: 0.9,
        exif: true,
      });

      if (result.canceled) {
        stage("photo pick canceled");
        return;
      }

      const asset = result.assets?.[0];
      if (!asset?.uri) throw new Error("No image uri returned.");

      const id = userId || (await getUserId());
      const safeName = sanitizeName(asset.fileName || `photo_${Date.now()}.jpg`);
      const contentType =
        asset.mimeType || guessContentTypeFromName(safeName, "image/jpeg");

      // ✅ production-like path
      const path = `users/${id}/attachments/photos/${Date.now()}_${safeName}`;

      stage("photo upload start", {
        bucket: PHOTO_BUCKET,
        path,
        contentType,
        platform: Platform.OS,
        uriScheme: String(asset.uri).split(":")[0],
      });

      const res = await uploadToSupabaseStorage({
        bucket: PHOTO_BUCKET,
        path,
        uri: asset.uri,
        contentType,
      });

      remember(path, {
        kind: "photo",
        fileName: safeName,
        contentType,
        uploadedAt: nowIso(),
        picked: {
          width: asset.width ?? null,
          height: asset.height ?? null,
          duration: asset.duration ?? null,
          fileSize: asset.fileSize ?? null,
        },
        exifSummary: pickExifSummary(asset.exif),
        exifRaw: asset.exif || null,
      });

      stage("photo upload ok", res);

      setBucketMode("photos");
      await refreshList(); // ✅ no funky “needs refresh”
    } catch (e) {
      fail("photo upload failed", e);
      Alert.alert("Upload failed", e?.message || "Photo upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const pickAndUploadFile = async () => {
    try {
      setBusy(true);
      stage("file pick start");

      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled) {
        stage("file pick canceled");
        return;
      }

      const file = result.assets?.[0];
      if (!file?.uri) throw new Error("No file uri returned.");

      const id = userId || (await getUserId());
      const safeName = sanitizeName(file.name || `file_${Date.now()}`);
      const contentType =
        file.mimeType || guessContentTypeFromName(safeName);

      // ✅ production-like path
      const path = `users/${id}/attachments/files/${Date.now()}_${safeName}`;

      stage("file upload start", {
        bucket: FILE_BUCKET,
        path,
        contentType,
        size: file.size ?? null,
        platform: Platform.OS,
        uriScheme: String(file.uri).split(":")[0],
      });

      const res = await uploadToSupabaseStorage({
        bucket: FILE_BUCKET,
        path,
        uri: file.uri,
        contentType,
      });

      remember(path, {
        kind: "file",
        fileName: safeName,
        contentType,
        uploadedAt: nowIso(),
        picked: { size: file.size ?? null },
      });

      stage("file upload ok", res);

      setBucketMode("files");
      await refreshList(); // ✅ no funky “needs refresh”
    } catch (e) {
      fail("file upload failed", e);
      Alert.alert("Upload failed", e?.message || "File upload failed.");
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (fullPath) => {
    try {
      setBusy(true);
      stage("remove() start", { bucket, fullPath });

      const { error } = await supabase.storage.from(bucket).remove([fullPath]);
      if (error) throw error;

      stage("remove() ok", { bucket, fullPath });

      setKnownByPath((prev) => {
        const copy = { ...(prev || {}) };
        delete copy[fullPath];
        return copy;
      });

      await refreshList();
    } catch (e) {
      fail("remove() failed", e, { bucket, fullPath });
      Alert.alert("Delete failed", e?.message || "Couldn’t delete that item.");
    } finally {
      setBusy(false);
    }
  };

  const stripAttachments = useMemo(() => {
    return (items || [])
      .map((it) => {
        const url = it.signedUrl || it.publicUrl || null;
        return {
          id: it.fullPath,
          url,
          kind: it.kind,
          fileName: it.name,
          storagePath: it.fullPath,
          _raw: it,
        };
      })
      .filter((a) => !!a.url);
  }, [items]);

  const selectedItem = useMemo(() => {
    if (!selectedPath) return null;
    const it = items.find((x) => x.fullPath === selectedPath) || null;
    const known = selectedPath ? knownByPath?.[selectedPath] || null : null;
    if (!it && !known) return null;

    return {
      storagePath: selectedPath,
      kind: it?.kind || known?.kind || null,
      name: it?.name || known?.fileName || null,
      publicUrl: it?.publicUrl || null,
      signedUrl: it?.signedUrl || null,
      updated_at: it?.updated_at || null,
      listedMetadata: it?.metadata || null,
      known: known || null,
    };
  }, [items, knownByPath, selectedPath]);

  const BucketToggle = () => (
    <View style={styles.toggleRow}>
      <TouchableOpacity
        style={[
          styles.toggleBtn,
          bucketMode === "photos" && styles.toggleBtnActive,
        ]}
        onPress={() => setBucketMode("photos")}
        disabled={busy}
      >
        <Ionicons
          name="images-outline"
          size={16}
          color={bucketMode === "photos" ? colors.white : colors.textSecondary}
        />
        <Text
          style={[
            styles.toggleText,
            bucketMode === "photos" && styles.toggleTextActive,
          ]}
        >
          Photos
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.toggleBtn,
          bucketMode === "files" && styles.toggleBtnActive,
        ]}
        onPress={() => setBucketMode("files")}
        disabled={busy}
      >
        <Ionicons
          name="document-text-outline"
          size={16}
          color={bucketMode === "files" ? colors.white : colors.textSecondary}
        />
        <Text
          style={[
            styles.toggleText,
            bucketMode === "files" && styles.toggleTextActive,
          ]}
        >
          Files
        </Text>
      </TouchableOpacity>
    </View>
  );

  const safeBrand =
    colors?.brandBlue || colors?.primary || colors?.accent || colors?.textPrimary;

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={[layoutStyles.screenInner, styles.screenFix]}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>UPIP Lab</Text>
            <Text style={styles.subtitle}>
              Bucket: <Text style={{ fontWeight: "700" }}>{bucket}</Text>
            </Text>
            <Text style={styles.subtitleSmall}>
              Folder: {folderPrefix || "…"}
            </Text>
          </View>

          <TouchableOpacity
            style={styles.refreshBtn}
            onPress={refreshList}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.textSecondary} />
            ) : (
              <Ionicons
                name="refresh-outline"
                size={18}
                color={colors.textSecondary}
              />
            )}
          </TouchableOpacity>
        </View>

        <BucketToggle />

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={pickAndUploadPhoto}
            disabled={busy}
          >
            <Ionicons name="camera-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.actionText}>Upload photo</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionBtn}
            onPress={pickAndUploadFile}
            disabled={busy}
          >
            <Ionicons name="attach-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.actionText}>Upload file</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.secondaryBtn]}
            onPress={runStorageCheck}
            disabled={busy}
          >
            <Ionicons name="pulse-outline" size={18} color={colors.textPrimary} />
            <Text style={styles.actionText}>Storage check</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
          <Text style={styles.sectionTitle}>Gallery strip</Text>

          <View style={styles.stripCard}>
            <AttachmentsStrip
              attachments={stripAttachments}
              onOpenAttachment={(att) => openAttachment(att)}
              showHero={false}
            />

            {stripAttachments.length === 0 ? (
              <Text style={styles.emptyInline}>Nothing in this folder yet.</Text>
            ) : (
              <Text style={styles.hintInline}>
                Tap an item below to see “What we know”.
              </Text>
            )}
          </View>

          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
            Manage items
          </Text>

          {items.length === 0 ? (
            <Text style={styles.empty}>Nothing here yet.</Text>
          ) : (
            items.map((it) => {
              const url = it.signedUrl || it.publicUrl || null;
              return (
                <TouchableOpacity
                  key={it.fullPath}
                  activeOpacity={0.85}
                  onPress={() => setSelectedPath(it.fullPath)}
                  style={styles.itemRow}
                >
                  <View style={styles.thumb}>
                    {bucketMode === "photos" && url ? (
                      <Image source={{ uri: url }} style={styles.thumbImg} resizeMode="cover" />
                    ) : (
                      <Ionicons
                        name={bucketMode === "photos" ? "image-outline" : "document-outline"}
                        size={18}
                        color={colors.textSecondary}
                      />
                    )}
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemName} numberOfLines={1}>
                      {it.name}
                    </Text>
                    <Text style={styles.itemMeta} numberOfLines={1}>
                      {it.fullPath}
                    </Text>
                  </View>

                  <TouchableOpacity
                    onPress={() => openAttachment({ url })}
                    disabled={!url || busy}
                    style={{ marginRight: spacing.sm }}
                  >
                    <Ionicons name="open-outline" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => deleteItem(it.fullPath)} disabled={busy}>
                    <Ionicons name="trash-outline" size={18} color={colors.danger} />
                  </TouchableOpacity>
                </TouchableOpacity>
              );
            })
          )}

          {storageCheck ? (
            <>
              <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
                Storage check
              </Text>
              <View style={styles.debugBox}>
                <Text style={styles.debugMono}>
                  {JSON.stringify(storageCheck, null, 2)}
                </Text>
              </View>
            </>
          ) : null}

          <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>
            Debug (truth)
          </Text>
          <View style={styles.debugBox}>
            <Text style={styles.debugLabel}>Last action</Text>
            <Text style={styles.debugMono}>{lastAction || "—"}</Text>

            <Text style={[styles.debugLabel, { marginTop: spacing.sm }]}>
              Last OK
            </Text>
            <Text style={styles.debugMono}>{lastOk || "—"}</Text>

            <Text style={[styles.debugLabel, { marginTop: spacing.sm }]}>
              Last error
            </Text>
            <Text style={[styles.debugMono, { color: colors.danger }]}>
              {lastErr || "—"}
            </Text>

            {lastErr ? (
              <Text style={styles.debugHint}>
                If this shows 403/unauthorized, it’s a Storage policy issue.
                Lab is doing its job by exposing it.
              </Text>
            ) : null}
          </View>

          <View style={{ height: 24 }} />
        </ScrollView>

        <Modal
          visible={!!selectedItem}
          animationType="slide"
          transparent
          onRequestClose={() => setSelectedPath(null)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>What we know</Text>
                <TouchableOpacity onPress={() => setSelectedPath(null)}>
                  <Ionicons
                    name="close-outline"
                    size={22}
                    color={colors.textSecondary}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView style={{ maxHeight: IS_WEB ? "70%" : "80%" }}>
                <View style={styles.kvRow}>
                  <Text style={styles.kLabel}>Name</Text>
                  <Text style={styles.kValue}>{selectedItem?.name || "—"}</Text>
                </View>
                <View style={styles.kvRow}>
                  <Text style={styles.kLabel}>Kind</Text>
                  <Text style={styles.kValue}>{selectedItem?.kind || "—"}</Text>
                </View>
                <View style={styles.kvRow}>
                  <Text style={styles.kLabel}>Storage path</Text>
                  <Text style={styles.kValue}>
                    {selectedItem?.storagePath || "—"}
                  </Text>
                </View>
                <View style={styles.kvRow}>
                  <Text style={styles.kLabel}>Signed URL</Text>
                  <Text style={styles.kValue} numberOfLines={2}>
                    {selectedItem?.signedUrl || "—"}
                  </Text>
                </View>
                <View style={styles.kvRow}>
                  <Text style={styles.kLabel}>Public URL</Text>
                  <Text style={styles.kValue} numberOfLines={2}>
                    {selectedItem?.publicUrl || "—"}
                  </Text>
                </View>

                <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>
                  Known metadata (captured at upload)
                </Text>
                <View style={styles.debugBox}>
                  <Text style={styles.debugMono}>
                    {JSON.stringify(selectedItem?.known || null, null, 2)}
                  </Text>
                </View>

                <Text style={[styles.sectionTitle, { marginTop: spacing.md }]}>
                  Listed metadata (from storage list)
                </Text>
                <View style={styles.debugBox}>
                  <Text style={styles.debugMono}>
                    {JSON.stringify(
                      {
                        updated_at: selectedItem?.updated_at || null,
                        metadata: selectedItem?.listedMetadata || null,
                      },
                      null,
                      2
                    )}
                  </Text>
                </View>
              </ScrollView>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={[styles.modalBtn, { backgroundColor: safeBrand }]}
                  onPress={() => {
                    const url = selectedItem?.signedUrl || selectedItem?.publicUrl;
                    if (url) openAttachment({ url });
                  }}
                >
                  <Ionicons name="open-outline" size={18} color={colors.white} />
                  <Text style={styles.modalBtnTextPrimary}>Open</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalBtn, styles.modalBtnDanger]}
                  onPress={() => {
                    const p = selectedItem?.storagePath;
                    setSelectedPath(null);
                    if (p) deleteItem(p);
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.white} />
                  <Text style={styles.modalBtnTextPrimary}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const shadowSm = (shadows && shadows.sm) ? shadows.sm : {};
const fullRadius = typeof radius?.full === "number" ? radius.full : 18;
const safeBrand =
  colors?.brandBlue || colors?.primary || colors?.accent || colors?.textPrimary;

const styles = StyleSheet.create({
  screenFix: { flex: 1, minHeight: 0 },

  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  title: { fontSize: 18, fontWeight: "700", color: colors.textPrimary },
  subtitle: { marginTop: 2, fontSize: 13, color: colors.textSecondary },
  subtitleSmall: { marginTop: 2, fontSize: 11, color: colors.textMuted },

  refreshBtn: {
    width: 36,
    height: 36,
    borderRadius: fullRadius,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
  },

  toggleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  toggleBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },
  toggleBtnActive: {
    backgroundColor: safeBrand,
    borderColor: safeBrand,
  },
  toggleText: { fontSize: 13, color: colors.textSecondary, fontWeight: "600" },
  toggleTextActive: { color: colors.white },

  actionsRow: {
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    ...shadowSm,
  },
  secondaryBtn: { opacity: 0.95 },
  actionText: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },

  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },

  sectionTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },

  stripCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadowSm,
  },
  emptyInline: { marginTop: spacing.sm, fontSize: 12, color: colors.textMuted },
  hintInline: { marginTop: spacing.sm, fontSize: 12, color: colors.textSecondary },

  empty: { fontSize: 13, color: colors.textMuted },

  itemRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  thumb: {
    width: 44,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbImg: { width: "100%", height: "100%" },
  itemName: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  itemMeta: { fontSize: 11, color: colors.textMuted, marginTop: 2 },

  debugBox: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  debugLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "700" },
  debugMono: {
    marginTop: 4,
    fontSize: 11,
    color: colors.textPrimary,
    fontFamily:
      Platform.OS === "ios"
        ? "Menlo"
        : Platform.select({ android: "monospace", default: "monospace" }),
  },
  debugHint: { marginTop: spacing.sm, fontSize: 11, color: colors.textMuted },

  // ✅ Web: center dialog, Mobile: bottom sheet
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    padding: spacing.lg,
    justifyContent: IS_WEB ? "center" : "flex-end",
    alignItems: IS_WEB ? "center" : "stretch",
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    width: "100%",
    ...(IS_WEB ? { maxWidth: 900, maxHeight: "85%" } : {}),
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
  },
  modalTitle: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },

  kvRow: { paddingVertical: 6 },
  kLabel: { fontSize: 11, color: colors.textMuted, fontWeight: "700" },
  kValue: { fontSize: 12, color: colors.textPrimary, marginTop: 2 },

  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  modalBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
  },
  modalBtnDanger: { backgroundColor: colors.danger },
  modalBtnTextPrimary: { color: colors.white, fontWeight: "800", fontSize: 13 },
});
