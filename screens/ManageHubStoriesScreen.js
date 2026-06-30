import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  Platform,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabaseClient";
import { addStoryToHub } from "../lib/hubsApi";
import AddAssetTypeModal from "../components/AddAssetTypeModal";
import HubActionRow from "../components/hubs/HubActionRow";

import { colors, spacing, radius, shadows } from "../styles/theme";
import {
  fetchHub,
  fetchHubStoryLinks,
  updateHubStoryLink,
  removeStoryFromHub,
} from "../lib/hubsApi";

export default function ManageHubStoriesScreen({ navigation, route }) {
  const hubId = route?.params?.hubId;

  const [loading, setLoading] = React.useState(true);
  const [hub, setHub] = React.useState(null);
  const [stories, setStories] = React.useState([]);
  const [storyPickerOpen, setStoryPickerOpen] = React.useState(false);
const [myAssets, setMyAssets] = React.useState([]);
const [addingAssetId, setAddingAssetId] = React.useState(null);
const [assetTypePickerOpen, setAssetTypePickerOpen] = React.useState(false);

const activationMode = route?.params?.activationMode === true;

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      const [hubRecord, storyRows] = await Promise.all([
        fetchHub(hubId),
        fetchHubStoryLinks(hubId),
      ]);
      setHub(hubRecord);
      setStories(storyRows || []);
    } catch (e) {
      Alert.alert("Could not load stories", e?.message || "Try again.");
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const toggleFeatured = async (row) => {
    await updateHubStoryLink(row.id, { featured: !row.featured });
    load();
  };

  const removeStory = async (row) => {
  console.log("REMOVE FROM HUB BUTTON FIRED", {
    linkId: row.id,
    asset: row.asset?.name,
  });

  const confirmed =
    Platform.OS === "web" && typeof window !== "undefined"
      ? window.confirm(
          "Remove this Story from this Hub? This does not delete the asset or its records."
        )
      : true;

  if (!confirmed) return;

  try {
    await removeStoryFromHub(row.id);
    await load();
  } catch (e) {
    console.log("REMOVE STORY ERROR", e);
    Alert.alert("Could not remove story", e?.message || "Try again.");
  }
};

const loadMyAssets = async () => {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return;

  const { data, error } = await supabase
    .from("assets")
    .select("id, name, type, year, make, model, kac_id, extra_metadata, deleted_at")
    .eq("owner_id", userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });

  if (error) throw error;

  setMyAssets(data || []);
};

const openStoryPicker = async () => {
  try {
    await loadMyAssets();
    setStoryPickerOpen(true);
  } catch (e) {
    Alert.alert("Could not load assets", e?.message || "Try again.");
  }
};

const isPublicStoryEnabled = (asset) => {
  return asset?.extra_metadata?.publicConfig?.story?.enabled === true;
};

const isAlreadyLinked = (assetId) => {
  return stories.some((row) => row.asset?.id === assetId);
};

const handleAddAssetToHub = async (asset) => {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const userId = auth?.user?.id;
    if (!userId) return;

    setAddingAssetId(asset.id);

    await addStoryToHub({
      hubId,
      assetId: asset.id,
      userId,
    });

    setStoryPickerOpen(false);
    await load();
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
    returnTo: "ManageHubStories",
    returnParams: { hubId },
  });
};

const createNewAssetStory = () => {
  setAssetTypePickerOpen(true);
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
  const goCreateAssetFromHub = (assetType) => {
  setAssetTypePickerOpen(false);
  setStoryPickerOpen(false);


  if (assetType === "home") {
    navigation.navigate("AddHomeAsset", {
      source: "hub",
      returnTo: "ManageHubStories",
      returnParams: { hubId },
      suggestedHubId: hubId,
      suggestedHubName: hub?.name,
    });
    return;
  }

  if (assetType === "vehicle") {
    navigation.navigate("AddVehicleAsset", {
      source: "hub",
      returnTo: "ManageHubStories",
      returnParams: { hubId },
      suggestedHubId: hubId,
      suggestedHubName: hub?.name,
    });
    return;
  }

  if (assetType === "boat") {
    navigation.navigate("AddMarineAsset", {
      source: "hub",
      returnTo: "ManageHubStories",
      returnParams: { hubId },
      suggestedHubId: hubId,
      suggestedHubName: hub?.name,
    });
    return;
  }

  navigation.navigate("AddAsset", {
    assetType: "other",
    source: "hub",
    returnTo: "ManageHubStories",
    returnParams: { hubId },
    suggestedHubId: hubId,
    suggestedHubName: hub?.name,
  });
};

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
            <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>
            {activationMode ? "Add Your Asset" : "Manage Stories"}
          </Text>
            <Text style={styles.subtitle}>
            {activationMode
              ? `Share your ownership story with ${hub?.name}`
              : hub?.name}
          </Text>
          </View>
        </View>
        {!activationMode ? (
          <HubActionRow
            navigation={navigation}
            hub={hub}
            hubId={hubId}
            canManage={true}
            active="stories"
          />
        ) : null}
        <TouchableOpacity
          style={styles.primaryButton}
          onPress={openStoryPicker}
        >
          <Ionicons name="add-circle-outline" size={18} color="#fff" />
          <Text style={styles.primaryButtonText}>Add Asset Story</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.primaryButton, { marginHorizontal: 14, marginTop: 12, marginBottom: 12 }]}
          onPress={createNewAssetStory}
        >
          <Ionicons name="add-outline" size={18} color="#fff" />
          <Text style={styles.primaryButtonText}>Create New Asset Story</Text>
        </TouchableOpacity>

        <View style={styles.card}>
          {stories.length === 0 ? (
            <Text style={styles.emptyText}>No stories linked yet.</Text>
          ) : (
            stories.map((row) => {
              const asset = row.asset;

              return (
                <View key={row.id} style={styles.storyRow}>
                  <View style={styles.rowIcon}>
                    <Ionicons name="document-text-outline" size={17} color={colors.textPrimary} />
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{asset?.name || "Untitled Story"}</Text>
                    <Text style={styles.rowSubtext}>{asset?.kac_id || "Public story"}</Text>
                  </View>
                {!activationMode ? (
                  <>
                    <TouchableOpacity
                      style={[styles.smallButton, row.featured && styles.smallButtonActive]}
                      onPress={() => toggleFeatured(row)}
                    >
                      <Text style={[styles.smallButtonText, row.featured && styles.smallButtonTextActive]}>
                        {row.featured ? "Featured" : "Feature"}
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[styles.removeLinkButton, { borderWidth: 2, borderColor: "red" }]}
                      onPress={() => removeStory(row)}
                    >
                      <Text style={styles.removeLinkText}>Remove from Hub</Text>
                    </TouchableOpacity>
                  </>
                ) : null}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
      <Modal
          visible={storyPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setStoryPickerOpen(false)}
        >
        <View style={styles.assetStoryOverlay}>
            <View style={styles.assetStoryModal}>
              <View style={styles.modalHeader}>
              <TouchableOpacity
                onPress={() => setStoryPickerOpen(false)}
                style={styles.backButton}
              >
                <Ionicons name="close" size={20} color={colors.textPrimary} />
              </TouchableOpacity>

              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Add Asset Story</Text>
                <Text style={styles.modalSub}>
                  Only public Asset Stories can be added to a Hub. Your private records stay private.
                </Text>
              </View>
            </View>

            <TouchableOpacity
              style={[styles.primaryButton, { marginHorizontal: 14, marginBottom: 12 }]}
              onPress={createNewAssetStory}
            >
              <Ionicons name="add-outline" size={18} color="#fff" />
              <Text style={styles.primaryButtonText}>Create New Asset Story</Text>
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
                        onPress={() => handleAddAssetToHub(item)}
                      >
                        <Text style={styles.actionButtonText}>Add to Hub</Text>
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
                  <Text style={styles.emptyText}>No assets found.</Text>
                </View>
              }
            />
            <FlatList/>
          </View>
        </View>
      </Modal>
      <AddAssetTypeModal
          visible={assetTypePickerOpen}
          onClose={() => setAssetTypePickerOpen(false)}
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
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: spacing.xl,
    maxWidth: 920,
    alignSelf: "center",
    width: "100%",
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  loadingText: { marginTop: 10, color: colors.textMuted },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.lg },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  },
  title: { fontSize: 24, fontWeight: "900", color: colors.textPrimary },
  subtitle: { marginTop: 3, fontSize: 13, fontWeight: "700", color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    ...(shadows?.subtle || {}),
  },
  storyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
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

modalBody: {
  flex: 1,
  width: "100%",
  maxWidth: 760,
  alignSelf: "center",
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
  smallButtonActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  smallButtonText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  smallButtonTextActive: {
    color: "#fff",
  },
  removeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FEF2F2",
  },
  removeLinkButton: {
  paddingHorizontal: 10,
  paddingVertical: 7,
  borderRadius: 999,
  backgroundColor: "#FEF2F2",
},

removeLinkText: {
  color: "#B91C1C",
  fontSize: 11,
  fontWeight: "800",
},
  emptyText: { color: colors.textMuted, fontWeight: "600", fontSize: 13 },
});