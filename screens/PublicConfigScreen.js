import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Switch,
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  Modal,
  FlatList,
  TextInput,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabaseClient";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import {
  fetchAssetHubLinks,
  fetchMyHubs,
  addStoryToHub,
  createHub,
} from "../lib/hubsApi";



const MODE_OPTIONS = [
  { key: "inquiry", label: "Informational Inquiry" },
  { key: "for_sale", label: "For Sale" },
  { key: "for_rent", label: "For Rent" },
  { key: "current_story", label: "Current Story" },
  { key: "system_story", label: "System Story" },
];

const ACTION_OPTIONS = [
  { key: "request_info", label: "Request Info" },
  { key: "request_service", label: "Request Service" },
  { key: "submit_quote", label: "Submit Quote" },
  { key: "submit_proposal", label: "Submit Proposal" },
  { key: "pay_rent", label: "Pay Rent" },
];

function getDefaultActionsForMode(mode) {
  switch (mode) {
    case "for_sale":
      return ["request_info", "submit_quote"];
    case "for_rent":
      return ["request_info", "request_service", "pay_rent"];
    case "system_story":
      return ["request_service", "submit_quote"];
    case "current_story":
      return ["request_info", "request_service", "submit_quote"];
    case "inquiry":
    default:
      return ["request_info", "request_service", "submit_quote"];
  }
}

function Pill({ label, active, onPress }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.pill, active && styles.pillActive]}
      activeOpacity={0.85}
    >
      <Text style={[styles.pillText, active && styles.pillTextActive]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function ToggleRow({ title, subtitle, value, onValueChange }) {
  return (
    <View style={styles.toggleRow}>
      <View style={{ flex: 1, marginRight: spacing.md }}>
        <Text style={styles.rowTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.rowSubtitle}>{subtitle}</Text>}
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  );
}

function getDefaultPublicConfig() {
  return {
    story: {
      enabled: false,
      showHero: true,
      showGallery: true,
      showSystems: true,
      showProof: true,
      showProofBadges: true,
      showTimeline: "highlights_only",
      showQrShare: true,
      showFooterCta: true,
      showLocation: true,
      showFinancials: false,
    },
    actions: {
      enabled: false,
      mode: "inquiry",
      actionsEnabled: getDefaultActionsForMode("inquiry"),
    },
    sharing: {
      enabled: false,
      showQrBadge: true,
      allowPrintSticker: true,
      allowCopyLink: true,
      allowShareLink: true,
    },
  };
}

export default function PublicConfigScreen({ navigation, route }) {
  const assetId = route?.params?.assetId || null;
  const assetNameFromRoute = route?.params?.assetName || "";

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [assetName, setAssetName] = React.useState(assetNameFromRoute);
  const [saveError, setSaveError] = React.useState(null);
  const [lastSavedAt, setLastSavedAt] = React.useState(null);

  const [enabled, setEnabled] = React.useState(false);
  const [mode, setMode] = React.useState("inquiry");
  const [actionsEnabled, setActionsEnabled] = React.useState(
    getDefaultActionsForMode("inquiry")
  );


  const [showLocation, setShowLocation] = React.useState(false);
  const [showFinancials, setShowFinancials] = React.useState(false);
  const [showSystems, setShowSystems] = React.useState(true);
  const [showProof, setShowProof] = React.useState(true);
  const [showTimelineHighlights, setShowTimelineHighlights] = React.useState(true);

  const [showHero, setShowHero] = React.useState(true);
  const [showGallery, setShowGallery] = React.useState(true);
  const [showProofBadges, setShowProofBadges] = React.useState(true);
  const [showQrShare, setShowQrShare] = React.useState(true);
  const [showFooterCta, setShowFooterCta] = React.useState(true);

  const [sharingEnabled, setSharingEnabled] = React.useState(true);
  const [allowPrintSticker, setAllowPrintSticker] = React.useState(true);
  const [allowCopyLink, setAllowCopyLink] = React.useState(true);
  const [allowShareLink, setAllowShareLink] = React.useState(true);
  const [assetKac, setAssetKac] = React.useState(null);
  const [hubLinks, setHubLinks] = React.useState([]);
  const [hubModalVisible, setHubModalVisible] = React.useState(false);
  const [availableHubs, setAvailableHubs] = React.useState([]);
  const [newHubName, setNewHubName] = React.useState("");
  const [creatingHub, setCreatingHub] = React.useState(false);
  const [createHubModalVisible, setCreateHubModalVisible] = React.useState(false);

  const publicUrl = assetKac ? `https://app.keeprhome.com/k/${assetKac}` : null;

const openPublicStory = () => {
  if (!publicUrl) return;

  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.open(publicUrl, "_blank", "noopener,noreferrer");
    return;
  }

  Linking.openURL(publicUrl);
};

const copyPublicLink = async () => {
  if (!publicUrl) return;

  if (Platform.OS === "web" && navigator?.clipboard) {
    await navigator.clipboard.writeText(publicUrl);
    Alert.alert("Copied", "Public story link copied.");
    return;
  }

  Alert.alert("Public Link", publicUrl);
};

const openHubPicker = async () => {
  console.log("OPEN HUB PICKER CLICKED");

  setHubModalVisible(true);
  setAvailableHubs([]);

  try {
    const user = (await supabase.auth.getUser()).data?.user;

    console.log("HUB PICKER USER", user?.id);

    if (!user?.id) {
      Alert.alert("Sign in required", "You need to be signed in to add this story to a Hub.");
      return;
    }

    const hubs = await fetchMyHubs(user.id);

    console.log("MY HUBS", hubs);

    const alreadyLinked = new Set(hubLinks.map((h) => h.id));

    setAvailableHubs((hubs || []).filter((h) => !alreadyLinked.has(h.id)));
  } catch (e) {
    console.log("HUB PICKER ERROR", e?.message || e);
    Alert.alert("Could not load Hubs", e?.message || "Try again.");
  }
};

    const handleAddStoryToHub = async (hub) => {
      try {
        const user = (await supabase.auth.getUser()).data?.user;
        if (!user?.id) return;

        console.log("ADDING STORY TO NEW HUB", {
          hubId: hub?.id,
          assetId,
          userId: user?.id,
        });
        
        console.log("ADDING STORY TO NEW HUB", {
          hubId: hub?.id,
          assetId,
          userId: user?.id,
        });
        
        await addStoryToHub({
          hubId: hub.id,
          assetId,
          userId: user.id,
        });

        const links = await fetchAssetHubLinks(assetId);
        setHubLinks(links || []);
        setHubModalVisible(false);
      } catch (e) {
        console.log("CREATE HUB ERROR", e);
        Alert.alert("Could not add to Hub", e?.message || "Try again.");
      }
    };
    const handleCreateHub = () => {
      setNewHubName("");
      setCreateHubModalVisible(true);
    };

    function slugifyHubName(name) {
      return String(name || "")
        .trim()
        .toLowerCase()
        .replace(/&/g, "and")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    }

    const handleCreateHubAndAddStory = async () => {
      const name = newHubName.trim();
      if (!name) return;

      try {
        setCreatingHub(true);

        const user = (await supabase.auth.getUser()).data?.user;
        if (!user?.id) return;

        console.log("CREATE HUB PAYLOAD", {
          name,
          slug: slugifyHubName(name),
          createdBy: user.id,
        });

        const hub = await createHub({
          name,
          slug: slugifyHubName(name),
          description: null,
          createdBy: user.id,
        });

        console.log("CREATE HUB RESULT", hub);

        try {
          console.log("ADDING STORY TO CREATED HUB", {
            hubId: hub?.id,
            assetId,
            userId: user?.id,
          });

          await addStoryToHub({
            hubId: hub.id,
            assetId,
            userId: user.id,
          });

          console.log("STORY ADDED TO CREATED HUB");
          } catch (linkErr) {
            const msg = linkErr?.message || "";

            if (msg.includes("duplicate key") || linkErr?.code === "23505") {
              console.log("STORY ALREADY LINKED TO CREATED HUB");
            } else {
              console.log("ADD STORY TO CREATED HUB ERROR", linkErr);
              throw linkErr;
            }
          }

        await addStoryToHub({
          hubId: hub.id,
          assetId,
          userId: user.id,
        });

        const links = await fetchAssetHubLinks(assetId);
        setHubLinks(links || []);

        setNewHubName("");
        setCreateHubModalVisible(false);
      } catch (e) {
       console.log("CREATE HUB ERROR", e);
        Alert.alert("Could not create Hub", e?.message || "Try again.");
      } finally {
        setCreatingHub(false);
      }
    };

  const loadAssetConfig = React.useCallback(async () => {
    if (!assetId) {
      setLoading(false);
      Alert.alert("Missing asset", "No asset was passed into Public Config.");
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("assets")
        .select("id, name, kac_id, extra_metadata")
        .eq("id", assetId)
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error("Asset not found.");

      setAssetName(data?.name || assetNameFromRoute || "Asset");
      setAssetKac(data?.kac_id || null);

      const existing = data?.extra_metadata?.publicConfig || getDefaultPublicConfig();
      console.log(
  "LOADED PUBLIC CONFIG",
  JSON.stringify(existing, null, 2)
);

const actionConfig = existing.actions || getDefaultPublicConfig().actions;
const storyConfig = existing.story || getDefaultPublicConfig().story;
const sharingConfig = existing.sharing || getDefaultPublicConfig().sharing;

setEnabled(storyConfig.enabled === true);
setMode(actionConfig.mode || "inquiry");
setActionsEnabled(
  Array.isArray(actionConfig.actionsEnabled) && actionConfig.actionsEnabled.length
    ? actionConfig.actionsEnabled
    : getDefaultActionsForMode(actionConfig.mode || "inquiry")
);

setShowLocation(!!storyConfig.showLocation);
setShowFinancials(!!storyConfig.showFinancials);
setShowSystems(storyConfig.showSystems !== false);
setShowProof(storyConfig.showProof !== false);
setShowHero(storyConfig.showHero !== false);
setShowGallery(storyConfig.showGallery !== false);
setShowProofBadges(storyConfig.showProofBadges !== false);
setShowQrShare(storyConfig.showQrShare !== false);
setShowFooterCta(storyConfig.showFooterCta !== false);

setSharingEnabled(sharingConfig.enabled === true);
setAllowPrintSticker(sharingConfig.allowPrintSticker !== false);
setAllowCopyLink(sharingConfig.allowCopyLink !== false);
setAllowShareLink(sharingConfig.allowShareLink !== false);
setShowTimelineHighlights(
  (storyConfig.showTimeline || "highlights_only") === "highlights_only"
);

try {
  const links = await fetchAssetHubLinks(assetId);
  setHubLinks(links || []);
} catch (hubErr) {
  console.log("Hub links load failed:", hubErr?.message || hubErr);
  setHubLinks([]);
}

    } catch (e) {
      Alert.alert("Could not load config", e?.message || "Try again.");
    } finally {
      setLoading(false);
    }
  }, [assetId, assetNameFromRoute]);

  React.useEffect(() => {
    loadAssetConfig();
  }, [loadAssetConfig]);

    const applyModeDefaults = (nextMode) => {
    setMode(nextMode);
    setActionsEnabled(getDefaultActionsForMode(nextMode));
     
  };

  const toggleAction = (key) => {
    setActionsEnabled((prev) =>
      prev.includes(key)
        ? prev.filter((x) => x !== key)
        : [...prev, key]
    );
  };

const saveConfig = React.useCallback(async () => {
  if (!assetId) {
  setSaving(false);
  Alert.alert("Missing asset", "No asset was passed into Public Config.");
  return;
}

  try {
    setSaving(true);
    setSaveError(null);

    // fetch current metadata FIRST
    const { data: current, error: fetchErr } = await supabase
      .from("assets")
      .select("extra_metadata")
      .eq("id", assetId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;

    const existingPublicConfig =
      current?.extra_metadata?.publicConfig || getDefaultPublicConfig();
    
    console.log("SAVE ENABLED =", enabled);

    const publicConfig = {
      ...existingPublicConfig,
      
      actions: {
        enabled,
        mode,
        actionsEnabled,
      },
      story: {
        ...(existingPublicConfig.story || getDefaultPublicConfig().story),
        enabled,
        showLocation,
        showFinancials,
        showSystems,
        showProof,
        showTimeline: showTimelineHighlights
          ? "highlights_only"
          : "hidden",
          showHero,
          showGallery,
          showProofBadges,
          showQrShare,
          showFooterCta,
      },
      sharing: {
      ...(existingPublicConfig.sharing || getDefaultPublicConfig().sharing),
      enabled: sharingEnabled,
      showQrBadge: true,
      allowPrintSticker,
      allowCopyLink,
      allowShareLink,
    },
    };

    const updatedMetadata = {
      ...(current?.extra_metadata || {}),
      publicConfig,
    };

    const { error: updateErr } = await supabase
      .from("assets")
      .update({
        extra_metadata: updatedMetadata,
      })
      .eq("id", assetId);

    if (updateErr) throw updateErr;

    console.log("SAVED CONFIG:", publicConfig);
    setLastSavedAt(Date.now());

  } catch (e) {
    console.log("SAVE ERROR:", e);
    Alert.alert("Could not save", e?.message || "Try again.");
  } finally {
    setSaving(false);
  }
}, [
  assetId,
  enabled,
  mode,
  actionsEnabled,
  showLocation,
  showFinancials,
  showSystems,
  showProof,
  showTimelineHighlights,
  showHero,
  showGallery,
  showProofBadges,
  showQrShare,
  showFooterCta,
  sharingEnabled,
  allowPrintSticker,
  allowCopyLink,
  allowShareLink,
]);

const initialLoadComplete = React.useRef(false);

React.useEffect(() => {
  if (!assetId) return;

  if (!initialLoadComplete.current) {
    initialLoadComplete.current = true;
    return;
  }

  const timeout = setTimeout(() => {
    saveConfig();
  }, 700);

  return () => clearTimeout(timeout);
}, [
  enabled,
  mode,
  actionsEnabled,
  showLocation,
  showFinancials,
  showSystems,
  showProof,
  showTimelineHighlights,
  showHero,
  showGallery,
  showProofBadges,
  showQrShare,
  showFooterCta,
  sharingEnabled,
  allowPrintSticker,
  allowCopyLink,
  allowShareLink,
  saveConfig,
  assetId,
]);

    if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading public settings…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backButton}
            activeOpacity={0.8}
          >
            <Ionicons name="chevron-back-outline" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Public View & Actions</Text>
            <Text style={styles.subtitle}>
            {assetName
                ? `Control what others can see and do for ${assetName}.`
                : "Control what others can see and do for this asset."}
            </Text>
          </View>
        </View>

        <View style={styles.statusCard}>
  <View style={{ flex: 1 }}>
    <Text style={styles.statusEyebrow}>Public Story Status</Text>
    <Text style={styles.statusTitle}>{assetName || "Asset"}</Text>

    <Text style={styles.statusMeta}>
      {assetKac ? `KAC ${assetKac}` : "No KAC assigned"}
    </Text>

    <View style={styles.statusBadge}>
      <View
        style={[
          styles.statusDot,
          enabled ? styles.statusDotLive : styles.statusDotPrivate,
        ]}
      />
      <Text style={styles.statusBadgeText}>
        {enabled ? "Public view enabled" : "Private until enabled"}
      </Text>
    </View>
  </View>

  {!!lastSavedAt && !saving && (
  <Text style={styles.savedText}>
    Saved
  </Text>
)}

{saving && (
  <Text style={styles.savedText}>
    Saving...
  </Text>
)}

  <View style={styles.statusActions}>
    <TouchableOpacity
      style={[styles.statusButton, !publicUrl && styles.disabledButton]}
      onPress={openPublicStory}
      disabled={!publicUrl}
    >
      <Ionicons name="open-outline" size={15} color={colors.textPrimary} />
      <Text style={styles.statusButtonText}>Open</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={[styles.statusButton, !publicUrl && styles.disabledButton]}
      onPress={copyPublicLink}
      disabled={!publicUrl}
    >
      <Ionicons name="copy-outline" size={15} color={colors.textPrimary} />
      <Text style={styles.statusButtonText}>Copy</Text>
    </TouchableOpacity>
  </View>
</View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Public access</Text>
          <View style={styles.card}>
            <ToggleRow
              title="Enable public view"
              subtitle="Turn this on to allow this asset to receive requests, questions, and documents via link or QR."
              value={enabled}
              onValueChange={setEnabled}
            />
          </View>
        </View>

        <View style={styles.section}>
        <View style={styles.sectionHeaderRow}>
        <Text style={styles.sectionTitle}>
          AFFILIATED HUBS
        </Text>

        <TouchableOpacity
          style={styles.createHubLink}
          onPress={handleCreateHub}
        >
          <Ionicons
            name="add-circle-outline"
            size={16}
            color={colors.primary}
          />
          <Text style={styles.createHubLinkText}>
            Create Hub
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        {hubLinks.length === 0 ? (
        <Text style={styles.hubEmptyText}>
          This public story is not affiliated with any Hubs yet.
        </Text>
      ) : (
        hubLinks.map((hub) => (
          <TouchableOpacity
              key={hub.id}
              style={styles.hubRow}
              activeOpacity={0.85}
              onPress={() =>
                navigation.navigate("HubDetail", {
                  hubId: hub.id,
                  slug: hub.slug,
                })
              }
            >
            <View style={styles.hubIcon}>
              <Ionicons name="albums-outline" size={17} color={colors.textPrimary} />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.hubName}>{hub.name}</Text>
              <Text style={styles.hubSubtext}>Public story link shared to this Hub</Text>
            </View>

            {hub.featured ? (
              <View style={styles.featuredBadge}>
                <Text style={styles.featuredText}>Featured</Text>
              </View>
            ) : null}
            <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
            </TouchableOpacity>
        ))
      )}

      <TouchableOpacity
        style={styles.addHubButton}
        onPress={openHubPicker}
        activeOpacity={0.85}
      >
        <Ionicons name="add-circle-outline" size={18} color={colors.textPrimary} />
        <Text style={styles.addHubText}>Add Story to Hub</Text>
      </TouchableOpacity>
      </View>
    </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Mode</Text>
          <View style={styles.card}>
            <Text style={styles.blockHint}>
              Mode changes the default action set and how this asset behaves publicly.
            </Text>

            <View style={styles.pillWrap}>
              {MODE_OPTIONS.map((item) => (
                <Pill
                  key={item.key}
                  label={item.label}
                  active={mode === item.key}
                  onPress={() => applyModeDefaults(item.key)}
                />
              ))}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Actions</Text>
          <View style={styles.card}>
            <Text style={styles.blockHint}>
              Choose which actions are available on the public action surface.
            </Text>

            <View style={styles.pillWrap}>
              {ACTION_OPTIONS.map((item) => (
                <Pill
                  key={item.key}
                  label={item.label}
                  active={actionsEnabled.includes(item.key)}
                  onPress={() => toggleAction(item.key)}
                />
              ))}
            </View>
          </View>
        </View>
<View style={styles.section}>
  <Text style={styles.sectionLabel}>Public Story</Text>
  <View style={styles.card}>
    <ToggleRow
      title="Show hero"
      subtitle="Display the main public story hero image and asset summary."
      value={showHero}
      onValueChange={setShowHero}
    />
    <View style={styles.divider} />

    <ToggleRow
      title="Show gallery"
      subtitle="Display public photos and visual proof."
      value={showGallery}
      onValueChange={setShowGallery}
    />
    <View style={styles.divider} />

    <ToggleRow
      title="Show proof badges"
      subtitle="Show document, photo, and verified proof indicators."
      value={showProofBadges}
      onValueChange={setShowProofBadges}
    />
    <View style={styles.divider} />

    <ToggleRow
      title="Show Share / QR"
      subtitle="Display the Share / QR Code button on the public story."
      value={showQrShare}
      onValueChange={setShowQrShare}
    />
    <View style={styles.divider} />

    <ToggleRow
      title="Show footer CTA"
      subtitle="Show a lightweight Keepr call-to-action at the bottom of the public story."
      value={showFooterCta}
      onValueChange={setShowFooterCta}
    />
  </View>
</View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Public Sharing</Text>
          <View style={styles.card}>
            <ToggleRow
              title="Enable sharing tools"
              subtitle="Allow this asset to generate QR, print, copy, and share surfaces."
              value={sharingEnabled}
              onValueChange={setSharingEnabled}
            />
            <View style={styles.divider} />

            <ToggleRow
              title="Allow print sticker"
              subtitle="Allow printable keepr enabled QR stickers."
              value={allowPrintSticker}
              onValueChange={setAllowPrintSticker}
            />
            <View style={styles.divider} />

            <ToggleRow
              title="Allow copy link"
              subtitle="Allow the public story URL to be copied."
              value={allowCopyLink}
              onValueChange={setAllowCopyLink}
            />
            <View style={styles.divider} />

            <ToggleRow
              title="Allow share link"
              subtitle="Allow native link sharing."
              value={allowShareLink}
              onValueChange={setAllowShareLink}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Visibility</Text>
          <View style={styles.card}>
            <ToggleRow
              title="Show location"
              subtitle="Display location details publicly."
              value={showLocation}
              onValueChange={setShowLocation}
            />
            <View style={styles.divider} />

            <ToggleRow
              title="Show financials"
              subtitle="Display spend or value-related numbers."
              value={showFinancials}
              onValueChange={setShowFinancials}
            />
            <View style={styles.divider} />

            <ToggleRow
              title="Show systems"
              subtitle="Show major systems and history."
              value={showSystems}
              onValueChange={setShowSystems}
            />
            <View style={styles.divider} />

            <ToggleRow
              title="Show proof"
              subtitle="Show proof gallery or visual records."
              value={showProof}
              onValueChange={setShowProof}
            />
            <View style={styles.divider} />

            <ToggleRow
              title="Show timeline highlights"
              subtitle="Show a short public history instead of full detail."
              value={showTimelineHighlights}
              onValueChange={setShowTimelineHighlights}
            />
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Save</Text>
          <View style={styles.card}>
            <TouchableOpacity
            style={[styles.primaryBtn, saving && { opacity: 0.6 }]}
            onPress={saveConfig}
            activeOpacity={0.9}
            disabled={saving}
            >
            {saving ? (
                <ActivityIndicator color="#FFFFFF" />
            ) : (
                <Text style={styles.saveButtonText}>
                {saving
                  ? "Saving..."
                  : saveError
                  ? "Save Failed"
                  : "Saved"}
              </Text>
            )}
            </TouchableOpacity>
            <Text style={styles.footerHint}>
              These settings control how your asset appears and behaves publicly.
            </Text>
          </View>
        </View>
      </ScrollView>
      <Modal
        visible={hubModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setHubModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Add Story to Hub
              </Text>

              <TouchableOpacity
                onPress={() => setHubModalVisible(false)}
              >
                <Ionicons
                  name="close"
                  size={22}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>
            </View>

            {availableHubs.length === 0 ? (
              <View style={styles.modalEmptyState}>
                <Ionicons name="albums-outline" size={30} color={colors.textMuted} />
                <Text style={styles.modalEmptyTitle}>No additional Hubs</Text>
                <Text style={styles.modalEmptyText}>
                  This Story is already shared to every Hub you can contribute to.
                </Text>
              </View>
              
            ) : (
              <FlatList
                data={availableHubs}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.hubPickerRow}
                    onPress={() => handleAddStoryToHub(item)}
                  >
                    <View style={styles.hubIcon}>
                      <Ionicons
                        name="albums-outline"
                        size={18}
                        color={colors.textPrimary}
                      />
                    </View>

                    <View style={{ flex: 1 }}>
                      <Text style={styles.hubName}>
                        {item.name}
                      </Text>

                      {!!item.description && (
                        <Text
                          style={styles.hubSubtext}
                          numberOfLines={2}
                        >
                          {item.description}
                        </Text>
                      )}
                    </View>

                    <Ionicons
                      name="add-circle-outline"
                      size={22}
                      color={colors.primary}
                    />
                  </TouchableOpacity>
                )}
              />
            )}
            
          </View>
          
        </View>
      </Modal>
      <Modal
        visible={createHubModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setCreateHubModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Create Hub</Text>

              <TouchableOpacity onPress={() => setCreateHubModalVisible(false)}>
                <Ionicons name="close" size={22} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.createHubLabel}>Hub name</Text>

            <TextInput
              value={newHubName}
              onChangeText={setNewHubName}
              placeholder="PCA 986 Registry"
              placeholderTextColor={colors.textMuted}
              style={styles.createHubInput}
            />

            <TouchableOpacity
              style={[
                styles.createHubButton,
                { marginTop: 14, alignItems: "center" },
                (!newHubName.trim() || creatingHub) && { opacity: 0.5 },
              ]}
              onPress={handleCreateHubAndAddStory}
              disabled={!newHubName.trim() || creatingHub}
            >
              {creatingHub ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.createHubButtonText}>Create Hub + Add Story</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg || colors.background || "#F5F6F8",
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: spacing.xl,
    maxWidth: 920,
    alignSelf: "center",
    width: "100%",
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },

  createHubBox: {
  marginTop: 16,
  paddingTop: 14,
  borderTopWidth: StyleSheet.hairlineWidth,
  borderTopColor: colors.borderSubtle || "#E5E7EB",
},

createHubLabel: {
  fontSize: 12,
  fontWeight: "800",
  color: colors.textMuted,
  textTransform: "uppercase",
  letterSpacing: 0.6,
  marginBottom: 8,
},

createHubRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
},

createHubInput: {
  flex: 1,
  borderWidth: 1,
  borderColor: colors.borderSubtle || "#E5E7EB",
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  color: colors.textPrimary,
  backgroundColor: colors.surfaceSubtle || "#F3F4F6",
},

createHubButton: {
  paddingHorizontal: 14,
  paddingVertical: 11,
  borderRadius: 12,
  backgroundColor: colors.textPrimary,
},

createHubButtonText: {
  color: "#FFFFFF",
  fontWeight: "800",
  fontSize: 12,
},

sectionHeaderRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 8,
},

createHubLink: {
  flexDirection: "row",
  alignItems: "center",
  gap: 4,
},

createHubLinkText: {
  color: colors.primary,
  fontWeight: "700",
  fontSize: 13,
},

  hubRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 10,
  paddingVertical: 10,
},

hubIcon: {
  width: 34,
  height: 34,
  borderRadius: 17,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  borderWidth: 1,
  borderColor: colors.borderSubtle || "#E5E7EB",
},

hubName: {
  fontSize: 14,
  fontWeight: "800",
  color: colors.textPrimary,
},

hubSubtext: {
  marginTop: 2,
  fontSize: 12,
  fontWeight: "600",
  color: colors.textMuted,
},

featuredBadge: {
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: colors.textPrimary,
},

featuredText: {
  color: "#FFFFFF",
  fontSize: 11,
  fontWeight: "800",
},

hubEmptyText: {
  fontSize: 12,
  color: colors.textMuted,
  fontWeight: "600",
  marginBottom: 10,
},

addHubButton: {
  marginTop: 8,
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  alignSelf: "flex-start",
  paddingHorizontal: 12,
  paddingVertical: 9,
  borderRadius: 999,
  backgroundColor: colors.surfaceSubtle || "#F3F4F6",
  borderWidth: 1,
  borderColor: colors.borderSubtle || "#E5E7EB",
},

addHubText: {
  fontSize: 12,
  fontWeight: "800",
  color: colors.textPrimary,
},

  savedText: {
  marginTop: 6,
  fontSize: 11,
  fontWeight: "700",
  color: colors.textMuted,
},

modalBackdrop: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.45)",
  justifyContent: "center",
  alignItems: "center",
  padding: 20,
},

modalCard: {
  width: "100%",
  maxWidth: 520,
  backgroundColor: colors.surface,
  borderRadius: 18,
  padding: 16,
  maxHeight: "70%",
},

modalHeader: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
},

modalTitle: {
  fontSize: 18,
  fontWeight: "800",
  color: colors.textPrimary,
},

modalEmptyText: {
  textAlign: "center",
  color: colors.textMuted,
  fontWeight: "600",
},
modalEmptyState: {
  alignItems: "center",
  justifyContent: "center",
  paddingVertical: 28,
  paddingHorizontal: 16,
},

modalEmptyTitle: {
  marginTop: 10,
  fontSize: 15,
  fontWeight: "800",
  color: colors.textPrimary,
},

modalEmptyText: {
  marginTop: 6,
  textAlign: "center",
  color: colors.textMuted,
  fontWeight: "600",
  lineHeight: 18,
},

hubPickerRow: {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  paddingVertical: 12,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: colors.borderSubtle || "#E5E7EB",
},

  statusCard: {
  flexDirection: "row",
  alignItems: "center",
  gap: 12,
  backgroundColor: colors.surface,
  borderRadius: radius?.lg ?? 16,
  padding: 14,
  borderWidth: 1,
  borderColor: colors.borderSubtle || "#E5E7EB",
  ...(shadows?.subtle || {}),
  marginBottom: 12,
  },

  statusEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },

  statusTitle: {
    marginTop: 4,
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  statusMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },

  statusBadge: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  statusDot: {
    width: 9,
    height: 9,
    borderRadius: 999,
  },

  statusDotLive: {
    backgroundColor: "#059669",
  },

  statusDotPrivate: {
    backgroundColor: "#9CA3AF",
  },

  statusBadgeText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  statusActions: {
    flexDirection: "row",
    gap: 8,
  },

  statusButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    backgroundColor: colors.surfaceSubtle,
  },

  statusButtonText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  disabledButton: {
    opacity: 0.45,
  },

    loadingWrap: {
    flex: 1,
    minHeight: 240,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 12,
    color: colors.textMuted,
  },

  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  title: {
    ...(typography?.title || {}),
    fontSize: typography?.title?.fontSize ?? 22,
    fontWeight: typography?.title?.fontWeight ?? "700",
    color: colors.textPrimary,
  },
  subtitle: {
    ...(typography?.subtitle || {}),
    fontSize: typography?.subtitle?.fontSize ?? 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  section: {
    marginTop: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    ...(shadows?.subtle || {}),
  },
  blockHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  pillWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
  },
  pillActive: {
    backgroundColor: colors.textPrimary,
    borderColor: colors.textPrimary,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  pillTextActive: {
    color: "#FFFFFF",
  },
  toggleRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle || "#E5E7EB",
    marginVertical: 8,
  },
  primaryBtn: {
    backgroundColor: colors.primary || colors.textPrimary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },
  footerHint: {
    marginTop: 10,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 18,
  },
});