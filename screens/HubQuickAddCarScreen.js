import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { supabase } from "../lib/supabaseClient";
import { createAssetWithDefaults } from "../lib/assetsService";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { addStoryToHub, fetchHub, fetchPublicHubBySlug } from "../lib/hubsApi";
import { clearStoredAuthActivationIntent } from "../lib/authActivationIntent";
import { getHubUserCapabilities } from "../lib/hubCapabilities";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

function hubUrl(slug) {
  const path = `/h/${encodeURIComponent(slug || "")}`;
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return `${window.location.origin}${path}`;
  }
  return `https://app.keeprhome.com${path}`;
}

function clean(value) {
  const text = String(value || "").trim();
  return text || null;
}

export default function HubQuickAddCarScreen({ navigation, route }) {
  const { hubId, hubName } = route?.params || {};
  const hubSlug = route?.params?.hubSlug || route?.params?.slug || null;
  const [resolvedHubId, setResolvedHubId] = useState(hubId || null);
  const [hub, setHub] = useState(route?.params?.hub || null);
  const [year, setYear] = useState("");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [photo, setPhoto] = useState(null);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) setCurrentUserId(data?.user?.id || null);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    let mounted = true;
    if (hub) return undefined;
    const loader = resolvedHubId
      ? fetchHub(resolvedHubId)
      : hubSlug
        ? fetchPublicHubBySlug(hubSlug)
        : Promise.resolve(null);
    loader
      .then((record) => {
        if (!mounted) return;
        setHub(record);
        if (record?.id) setResolvedHubId(record.id);
      })
      .catch((e) => Alert.alert("Hub unavailable", e?.message || "Could not load this Hub."));
    return () => {
      mounted = false;
    };
  }, [hub, hubSlug, resolvedHubId]);

  const effectiveHubName = hub?.name || hubName || "this Hub";
  const effectiveHubSlug = hub?.slug || hubSlug;
  const capabilities = getHubUserCapabilities({
    hub,
    user: currentUserId ? { id: currentUserId } : null,
    currentMember: null,
    isInternal: false,
  });
  const routeAllowed = Boolean(hub && capabilities.canOpenQuickActivation);
  const canSubmit = routeAllowed && resolvedHubId && clean(year) && clean(make) && clean(model) && photo?.uri && !saving;
  const assetName = useMemo(
    () => [clean(year), clean(make), clean(model)].filter(Boolean).join(" "),
    [year, make, model]
  );

  const pickPhoto = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.85,
      aspect: [4, 3],
    });
    if (result.canceled) return;
    const asset = result.assets?.[0];
    if (!asset?.uri) return;
    setPhoto({
      uri: asset.uri,
      fileName: asset.fileName || `hub-car-${Date.now()}.jpg`,
      mimeType: asset.mimeType || "image/jpeg",
    });
  };

  const createProjection = useCallback(async () => {
    if (!canSubmit) return;
    try {
      setSaving(true);
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) {
        navigation.replace("Auth", {
          mode: "signup",
          source: "hub_activation",
          hubId: resolvedHubId,
          hubSlug: effectiveHubSlug,
          hubName: effectiveHubName,
          returnTo: "HubQuickAddCar",
        });
        return;
      }

      const asset = await createAssetWithDefaults({
        ownerId: userId,
        name: assetName,
        type: "vehicle",
        make: clean(make),
        model: clean(model),
        year: parseInt(year, 10),
        primaryPhotoUrl: null,
      });

      const attachment = await uploadAttachmentFromUri({
        userId,
        assetId: asset.id,
        kind: "photo",
        fileUri: photo.uri,
        fileName: photo.fileName,
        mimeType: photo.mimeType,
        placements: [{ target_type: "asset", target_id: asset.id, role: "hero" }],
      });

      const extraMetadata = {
        ...(asset.extra_metadata || {}),
        hubActivation: {
          hub_id: resolvedHubId,
          hub_slug: effectiveHubSlug,
          created_at: new Date().toISOString(),
        },
        publicConfig: {
          story: {
            enabled: false,
            showOwnerName: false,
            showPhotos: true,
            showYearMakeModel: true,
          },
          projection: {
            hub: {
              photo: true,
              year: true,
              make: true,
              model: true,
              displayName: !!clean(displayName),
              ownerName: false,
            },
          },
        },
      };

      await supabase
        .from("assets")
        .update({
          extra_metadata: extraMetadata,
        })
        .eq("id", asset.id);

      const link = await addStoryToHub({ hubId: resolvedHubId, assetId: asset.id, userId });
      await clearStoredAuthActivationIntent();
      setCreated({ asset, attachment, link });
    } catch (e) {
      Alert.alert("Could not add your car", e?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [assetName, canSubmit, displayName, effectiveHubName, effectiveHubSlug, make, model, navigation, photo, resolvedHubId, year]);

  const shareHub = async () => {
    const url = hubUrl(effectiveHubSlug);
    try {
      await Share.share({ message: `${effectiveHubName}: ${url}`, url });
    } catch (_) {
      Alert.alert("Share", url);
    }
  };

  if (created) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.successWrap}>
          <Ionicons name="checkmark-circle" size={48} color="#16A34A" />
          <Text style={styles.title}>Your car is now part of {effectiveHubName}</Text>
          <Text style={styles.subtitle}>{assetName}</Text>
          {photo?.uri ? <Image source={{ uri: photo.uri }} style={styles.successPhoto} /> : null}
          <TouchableOpacity style={styles.primaryButton} onPress={() => navigation.replace("KeeprHub", { slug: effectiveHubSlug })}>
            <Text style={styles.primaryButtonText}>View in Hub</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.secondaryButton} onPress={shareHub}>
            <Ionicons name="share-social-outline" size={17} color={colors.primary} />
            <Text style={styles.secondaryButtonText}>Share</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.textButton} onPress={() => navigation.replace("Dashboard")}>
            <Text style={styles.textButtonText}>Complete my Keepr later</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (hub && !routeAllowed) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.successWrap}>
          <Ionicons name="lock-closed-outline" size={42} color={colors.textSecondary} />
          <Text style={styles.title}>This Hub is not open for public car activation.</Text>
          <Text style={styles.subtitle}>
            {capabilities.addAssetAction === "request"
              ? "Request to join before adding an asset."
              : capabilities.addAssetAction === "invite_required"
              ? "Join with an invite before adding an asset."
              : "The Hub owner controls which assets appear here."}
          </Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={() => navigation.replace("KeeprHub", { slug: effectiveHubSlug })}>
            <Text style={styles.secondaryButtonText}>Back to Hub</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.eyebrow}>Add Your Car</Text>
        <Text style={styles.title}>{effectiveHubName}</Text>
        <Text style={styles.subtitle}>Add one photo and the basics. Private Keepr setup can wait.</Text>

        <View style={styles.card}>
          <View style={styles.row}>
            <TextInput style={styles.inputSmall} placeholder="Year" value={year} onChangeText={setYear} keyboardType="number-pad" maxLength={4} />
            <TextInput style={styles.input} placeholder="Make" value={make} onChangeText={setMake} autoCapitalize="words" />
            <TextInput style={styles.input} placeholder="Model" value={model} onChangeText={setModel} autoCapitalize="words" />
          </View>
          <TextInput style={styles.inputFull} placeholder="Display name (optional)" value={displayName} onChangeText={setDisplayName} />
          <TouchableOpacity style={styles.photoPicker} onPress={pickPhoto}>
            {photo?.uri ? (
              <Image source={{ uri: photo.uri }} style={styles.photoPreview} />
            ) : (
              <>
                <Ionicons name="camera-outline" size={28} color={colors.primary} />
                <Text style={styles.photoPickerText}>Add one photo</Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.privacyCard}>
          <Text style={styles.cardTitle}>Public Hub projection</Text>
          <Text style={styles.privacyLine}>Photo, year, make, and model will appear in {effectiveHubName}.</Text>
          <Text style={styles.privacyLine}>Owner name is off. Public Story is off.</Text>
        </View>

        <TouchableOpacity style={[styles.primaryButton, !canSubmit && styles.disabled]} onPress={createProjection} disabled={!canSubmit}>
          {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : null}
          <Text style={styles.primaryButtonText}>{saving ? "Adding..." : "Confirm and add to Hub"}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F8FAFC" },
  content: { padding: spacing.lg, gap: spacing.md },
  successWrap: { flex: 1, padding: spacing.xl, alignItems: "center", justifyContent: "center", gap: spacing.md },
  eyebrow: { ...typography.caption, color: colors.textSecondary, fontWeight: "800", textTransform: "uppercase" },
  title: { ...typography.h1, color: colors.textPrimary, textAlign: "center" },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: "center" },
  card: { backgroundColor: "#FFFFFF", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: spacing.md, ...shadows.card },
  row: { flexDirection: "row", gap: spacing.sm },
  inputSmall: { width: 82, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, fontWeight: "800", backgroundColor: "#FFFFFF" },
  input: { flex: 1, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, fontWeight: "800", backgroundColor: "#FFFFFF" },
  inputFull: { minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, paddingHorizontal: spacing.md, fontWeight: "800", backgroundColor: "#FFFFFF" },
  photoPicker: { minHeight: 210, borderRadius: radius.md, borderWidth: 1, borderColor: "#BFDBFE", backgroundColor: "#EFF6FF", alignItems: "center", justifyContent: "center", overflow: "hidden" },
  photoPreview: { width: "100%", height: 260 },
  photoPickerText: { ...typography.body, color: colors.primary, fontWeight: "800", marginTop: spacing.sm },
  privacyCard: { backgroundColor: "#FFFFFF", borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, gap: 4 },
  cardTitle: { ...typography.body, color: colors.textPrimary, fontWeight: "900" },
  privacyLine: { ...typography.caption, color: colors.textSecondary },
  primaryButton: { minHeight: 52, borderRadius: radius.md, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg },
  primaryButtonText: { ...typography.body, color: "#FFFFFF", fontWeight: "900" },
  secondaryButton: { minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: "#FFFFFF", alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg },
  secondaryButtonText: { ...typography.body, color: colors.primary, fontWeight: "900" },
  textButton: { padding: spacing.sm },
  textButtonText: { ...typography.caption, color: colors.textSecondary, fontWeight: "800" },
  successPhoto: { width: "100%", maxWidth: 420, height: 260, borderRadius: radius.md },
  disabled: { opacity: 0.55 },
});
