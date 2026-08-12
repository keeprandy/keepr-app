import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { addStoryToHub, fetchHub, fetchHubStoryLinks } from "../lib/hubsApi";
import AddAssetTypeModal from "../components/AddAssetTypeModal";
import { colors, spacing, radius, shadows } from "../styles/theme";
import { getHubUserCapabilities } from "../lib/hubCapabilities";
import { assetMatchesHubParticipation, getHubParticipationConfig } from "../lib/hubConfig";

export default function AddHubStoryScreen({ navigation, route }) {
  const hubId = route?.params?.hubId;

  const [loading, setLoading] = React.useState(true);
  const [hub, setHub] = React.useState(null);
  const [stories, setStories] = React.useState([]);
  const [myAssets, setMyAssets] = React.useState([]);
  const [storyPickerOpen, setStoryPickerOpen] = React.useState(false);
  const [addingAssetId, setAddingAssetId] = React.useState(null);
  const [assetTypePickerOpen, setAssetTypePickerOpen] = React.useState(false);
  const [currentUserId, setCurrentUserId] = React.useState(null);

  const loadMyAssets = React.useCallback(async (hubRecord = hub) => {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    setCurrentUserId(userId || null);
    if (!userId) {
      navigation.navigate("Auth", {
        mode: "signup",
        source: "hub_activation",
        hubId,
        hubSlug: hub?.slug,
        hubName: hub?.name,
        returnTo: "AddHubStory",
      });
      return;
    }

    const { data, error } = await supabase
      .from("assets")
      .select("id, name, type, year, make, model, kac_id, extra_metadata, deleted_at")
      .eq("owner_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });

    if (error) throw error;
    setMyAssets((data || []).filter((asset) => assetMatchesHubParticipation(asset, hubRecord)));
  }, [hub, hubId, navigation]);

  const load = React.useCallback(async () => {
    if (!hubId) {
      Alert.alert("Missing Hub", "No Hub was provided.");
      setLoading(false);
      return;
    }

    try {
      setLoading(true);

      const hubRecord = await fetchHub(hubId);
      const [storyRows] = await Promise.all([
        fetchHubStoryLinks(hubId),
        loadMyAssets(hubRecord),
      ]);

      setHub(hubRecord);
      setStories(storyRows || []);
      setStoryPickerOpen(true);
    } catch (e) {
      Alert.alert("Could not load Hub stories", e?.message || "Try again.");
    } finally {
      setLoading(false);
    }
  }, [hubId, loadMyAssets]);

  React.useEffect(() => {
    load();
  }, [load]);

  const isPublicStoryEnabled = (asset) => {
    return asset?.extra_metadata?.publicConfig?.story?.enabled === true;
  };

  const isAlreadyLinked = (assetId) => {
    return stories.some(
      (row) => row.asset?.id === assetId && row.status !== "declined"
    );
  };

  const handleAddAssetToHub = async (asset) => {
    try {
      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) return;

      setAddingAssetId(asset.id);

      if (!capabilities.canShowAddAssetCTA) {
        Alert.alert("Not available", "This Hub is not accepting public vehicle submissions.");
        return;
      }

      await addStoryToHub({
        hubId,
        assetId: asset.id,
        userId,
        hub,
        status: capabilities.submissionStatus,
      });

      Alert.alert(
        capabilities.submissionStatus === "pending" ? "Submitted" : "Story added",
        capabilities.submissionStatus === "pending"
          ? "Your vehicle is pending Hub admin approval."
          : "Your Asset Story was added to this Hub."
      );
      navigation.goBack();
    } catch (e) {
      Alert.alert("Could not add story", e?.message || "Try again.");
    } finally {
      setAddingAssetId(null);
    }
  };

  const configurePublicStory = (asset) => {
    setStoryPickerOpen(false);

    navigation.navigate("PublicConfig", {
      assetId: asset.id,
      assetName: asset.name,
      returnTo: "AddHubStory",
      returnParams: { hubId },
    });
  };

  const createNewAssetStory = () => {
    setStoryPickerOpen(false);
    setAssetTypePickerOpen(true);
  };

  const goCreateAssetFromHub = (assetType) => {
    setAssetTypePickerOpen(false);
    const config = getHubParticipationConfig(hub);

    const params = {
      source: "hub",
      returnTo: "AddHubStory",
      returnParams: { hubId },
      suggestedHubId: hubId,
      suggestedHubName: hub?.name,
      suggestedAssetType: config.primaryAssetType,
      suggestedMake: config.eligibleMake,
      suggestedModel: config.eligibleModel,
      suggestedYear: config.eligibleYear,
    };

    if (assetType === "home") {
      navigation.navigate("AddHomeAsset", params);
      return;
    }

    if (assetType === "vehicle") {
      navigation.navigate("AddVehicleAsset", params);
      return;
    }

    if (assetType === "boat") {
      navigation.navigate("AddMarineAsset", params);
      return;
    }

    navigation.navigate("AddAsset", {
      ...params,
      assetType: "other",
    });
  };

  const closeAndGoBack = () => {
    setStoryPickerOpen(false);
    navigation.goBack();
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading stories…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const capabilities = getHubUserCapabilities({
    hub,
    user: currentUserId ? { id: currentUserId } : null,
    currentMember: hub?.currentMember || null,
    isInternal: false,
  });
  const hubConfig = getHubParticipationConfig(hub);

  return (
    <SafeAreaView style={styles.screen}>
      <Modal
        visible={storyPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={closeAndGoBack}
      >
        <View style={styles.assetStoryOverlay}>
          <View style={styles.assetStoryModal}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={closeAndGoBack} style={styles.backButton}>
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Add {hubConfig.assetLabel} Story</Text>
                <Text style={styles.modalSub}>
                  Add one of your public Asset Stories to {hub?.name || "this Hub"}. Your private records stay private.
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, { marginHorizontal: 14, marginBottom: 12 }]}
              onPress={createNewAssetStory}
            >
              <Ionicons name="add-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Create New {hubConfig.assetLabel} Story</Text>
            </TouchableOpacity>

            <FlatList
              style={{ flexGrow: 0 }}
              data={myAssets}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 14, paddingBottom: 80 }}
              renderItem={({ item }) => {
                const linked = isAlreadyLinked(item.id);
                const publicEnabled = isPublicStoryEnabled(item);
                const meta = [item.year, item.make, item.model].filter(Boolean).join(" ");
                const busy = addingAssetId === item.id;

                return (
                  <View style={styles.assetPickRow}>
                    <View style={styles.rowIcon}>
                      <Ionicons name="cube-outline" size={17} color={colors.textPrimary} />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowTitle}>{item.name || "Untitled Asset"}</Text>
                      <Text style={styles.rowSubtext}>{meta || item.type || "Asset"}</Text>
                      <Text style={styles.rowSubtext}>
                        {linked
                          ? "Already added to this Hub"
                          : publicEnabled
                          ? "Public Story enabled"
                          : "Public Story not enabled"}
                      </Text>
                    </View>

                    {linked ? (
                      <View style={styles.addedPill}>
                        <Text style={styles.addedPillText}>Added</Text>
                      </View>
                    ) : publicEnabled ? (
                      <TouchableOpacity
                        style={styles.actionButton}
                        disabled={busy}
                        onPress={() => handleAddAssetToHub(item)}
                      >
                        <Text style={styles.actionButtonText}>
                          {busy ? "Adding…" : "Add to Hub"}
                        </Text>
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity
                        style={styles.smallButton}
                        onPress={() => configurePublicStory(item)}
                      >
                        <Text style={styles.smallButtonText}>Configure</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                );
              }}
              ListEmptyComponent={
                <View style={styles.card}>
                  <Text style={styles.emptyText}>No matching assets found.</Text>
                </View>
              }
            />
          </View>
        </View>
      </Modal>

      <AddAssetTypeModal
        visible={assetTypePickerOpen}
        onClose={() => {
          setAssetTypePickerOpen(false);
          setStoryPickerOpen(true);
        }}
        title="What kind of Asset Story are you adding?"
        subtitle="Choose the asset type. You can make it public and add it to this Hub after creation."
        onSelectHome={() => goCreateAssetFromHub("home")}
        onSelectVehicle={() => goCreateAssetFromHub("vehicle")}
        onSelectBoat={() => goCreateAssetFromHub("boat")}
        onSelectOther={() => goCreateAssetFromHub("other")}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg || colors.background || "#F5F6F8" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 10, color: colors.textMuted },

  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  },

  primaryButton: {
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.textPrimary,
    borderRadius: 14,
    paddingVertical: 13,
  },

  primaryButtonText: {
    color: "#fff",
    fontWeight: "900",
    fontSize: 13,
  },

  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle || "#E5E7EB",
    backgroundColor: colors.surface,
  },

  assetStoryOverlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.35)",
    alignItems: "center",
    justifyContent: "center",
    padding: 18,
  },

  assetStoryModal: {
    width: "100%",
    maxWidth: 920,
    maxHeight: "88%",
    backgroundColor: colors.bg || colors.background || "#F5F6F8",
    borderRadius: 22,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    ...(shadows?.subtle || {}),
  },

  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  modalSub: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
    color: colors.textMuted,
  },

  assetPickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    marginBottom: 10,
  },

  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
  },

  rowTitle: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  rowSubtext: { marginTop: 2, fontSize: 12, fontWeight: "600", color: colors.textMuted },

  addedPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  },

  addedPillText: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textMuted,
  },

  actionButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.textPrimary,
    borderWidth: 1,
    borderColor: colors.textPrimary,
  },

  actionButtonText: {
    color: "#fff",
    fontSize: 11,
    fontWeight: "800",
  },

  smallButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
  },

  smallButtonText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    ...(shadows?.subtle || {}),
  },

  emptyText: { color: colors.textMuted, fontWeight: "600", fontSize: 13 },
});
