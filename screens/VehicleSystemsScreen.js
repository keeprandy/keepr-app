// screens/VehicleSystemsScreen.js
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";
import { formatKeeprDate } from "../lib/dateFormat";

const IS_WEB = Platform.OS === "web";
const SYSTEMS_TABLE = "systems";
const EXT_TABLE = "vehicle_systems";

// Web: RN Alert can be unreliable when a Modal is already visible (modal-within-modal).
// Use a lightweight Modal for plan-limit + errors on web.
const PLAN_LIMIT_TRIGGER = "plan_limit_systems_per_asset";


const getDisplayName = (system) => {
  const v = system?.metadata?.display_name;
  const s = typeof v === "string" ? v.trim() : "";
  return s || system?.name || "System";
};


const VehicleSystemsScreen = ({ route, navigation }) => {
  const { vehicleId, vehicleName } = route?.params || {};
  const vehicleLabel = vehicleName || "Vehicle";

  const [systems, setSystems] = useState([]);
  const [systemsLoading, setSystemsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // timeline meta per system
  const [timelineMeta, setTimelineMeta] = useState({});

  // add custom system
  const [newSystemName, setNewSystemName] = useState("");
  const [creatingSystem, setCreatingSystem] = useState(false);


  // filter/search
  const [systemSearch, setSystemSearch] = useState("");

  // add system modal (separate from search)
  const [addSystemModalVisible, setAddSystemModalVisible] = useState(false);
  const [addSystemDraft, setAddSystemDraft] = useState("");

  // web-safe error/plan modal (handles modal-within-modal on web)
  const [planModalVisible, setPlanModalVisible] = useState(false);
  const [planModalTitle, setPlanModalTitle] = useState("");
  const [planModalBody, setPlanModalBody] = useState("");

  const closeAddSystemModal = () => {
    if (creatingSystem) return;
    setAddSystemModalVisible(false);
    setAddSystemDraft("");
  };

  const openAddSystemModal = () => {
    setAddSystemDraft("");
    setAddSystemModalVisible(true);
  };


  // rename (display name override)
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameSystem, setRenameSystem] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  // playbook modal
  const [playbookModalVisible, setPlaybookModalVisible] = useState(false);
  const [activePlaybookSystem, setActivePlaybookSystem] = useState(null);
  const [playbookDraft, setPlaybookDraft] = useState("");
  const [savingPlaybook, setSavingPlaybook] = useState(false);
  const [playbookInputHeight, setPlaybookInputHeight] = useState(220);

  const handleBack = () => navigation.goBack();

  const showWebSafeAlert = useCallback((title, body) => {
    const t = String(title || "");
    const b = String(body || "");
    if (IS_WEB) {
      setPlanModalTitle(t);
      setPlanModalBody(b);
      setPlanModalVisible(true);
      return;
    }
    Alert.alert(t || "Notice", b);
  }, []);

  const closePlanModal = () => setPlanModalVisible(false);

  const loadSystems = useCallback(async () => {
    if (!vehicleId) return;

    setSystemsLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from(SYSTEMS_TABLE)
      .select("*")
      .eq("asset_id", vehicleId)
      .order("name", { ascending: true });

    if (error) {
      console.error("VehicleSystemsScreen: error loading systems", error);
      setLoadError("Could not load vehicle systems.");
      setSystems([]);
    } else {
      setSystems(data || []);
    }

    setSystemsLoading(false);
  }, [vehicleId]);


  const loadTimelineMeta = useCallback(async () => {
    if (!vehicleId) return;

    try {
      const { data, error } = await supabase
        .from("service_records")
        .select("id, system_id, performed_at, created_at")
        .eq("asset_id", vehicleId)
        .not("system_id", "is", null)
        .order("performed_at", { ascending: false })
        .order("created_at", { ascending: false });

      if (error) {
        console.error("VehicleSystemsScreen: error loading timeline meta", error);
        setTimelineMeta({});
        return;
      }

      const grouped = {};
      (data || []).forEach((row) => {
        if (!row.system_id) return;
        const dt = row.performed_at || row.created_at;
        const existing = grouped[row.system_id];
        if (!existing) grouped[row.system_id] = { lastDate: dt, count: 1 };
        else existing.count += 1;
      });

      setTimelineMeta(grouped);
    } catch (err) {
      console.error("VehicleSystemsScreen: unexpected meta error", err);
      setTimelineMeta({});
    }
  }, [vehicleId]);

  useFocusEffect(
    useCallback(() => {
      loadSystems();
      loadTimelineMeta();
    }, [loadSystems, loadTimelineMeta])
  );

  const handleViewVehicleStory = () => {
    if (!vehicleId) return;
    navigation.navigate("VehicleStory", { vehicleId });
  };

  const handleViewSystemStory = (system) => {
    if (!system?.id || !vehicleId) return;

    navigation.navigate("VehicleSystemStory", {
      systemId: system.id,
      vehicleId,
      vehicleName: vehicleLabel,
    });
  };

  const handleEditSystemEnrichment = (system) => {
    if (!system?.id || !vehicleId) return;
    navigation.navigate("EditSystemEnrichment", {
      assetId: vehicleId,
      assetName: vehicleLabel,
      assetType: "vehicle",
      systemId: system.id,
      systemName: getDisplayName(system),
      systemKey: system.id,
    });
  };

  const handleOpenSystemAttachments = (system) => {
    if (!system?.id) return;
    navigation.navigate("AssetAttachments", {
      assetId: vehicleId,
      assetName: vehicleLabel,
      targetType: "system",
      targetId: system.id,
      targetRole: "other",
    });
  };

  const handleAddRecordForSystem = (system) => {
    if (!system?.id || !vehicleId) return;

    navigation.navigate("AddTimelineRecord", {
      source: "vehicleSystem",
      assetId: vehicleId,
      assetName: vehicleLabel,
      systemId: system.id,
      systemName: getDisplayName(system),
      defaultCategory: "service",
      defaultTitle: getDisplayName(system) ? `${getDisplayName(system)} service` : "Service",
    });
  };

  const handleCreateSystem = async (nameOverride) => {
    const trimmed = ((nameOverride ?? newSystemName) || "").trim();
    if (!trimmed || !vehicleId || creatingSystem) return;

    const exists = systems.some(
      (s) => String(s.name || "").trim().toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      Alert.alert("Already added", "That system is already on your list.");
      return;
    }

    setCreatingSystem(true);

    try {
  // 1) Foundation row (canonical system id)
  const foundationPayload = {
    asset_id: vehicleId,
    ksc_code: "general", // NOT NULL in your schema
    name: trimmed,
    lod: 2,
    status: "ok",
    system_type: "general",
    source_type: "manual",
    metadata: {},
    playbook: null,
  };


  const { data: foundation, error: sysErr } = await supabase
    .from(SYSTEMS_TABLE)
    .insert(foundationPayload)
    .select("*")
    .single();

  if (sysErr) {
    console.error("VehicleSystemsScreen: error creating system", sysErr);
    const msg = String(sysErr?.message || "");
    if (msg.includes(PLAN_LIMIT_TRIGGER)) {
      showWebSafeAlert(
        "Plan limit reached",
        "Starter allows up to 5 systems per asset. Upgrade to add more systems."
      );
    } else {
      showWebSafeAlert("Could not add system", "Please try again.");
    }
    return;
  }

  // 2) Vehicle extension row (keeps your schema aligned; rollback if it fails)
  const extPayload = {
    asset_id: vehicleId,
    system_id: foundation.id,
    system_type: "general",
    name: trimmed,
    manufacturer: null,
    model: null,
    serial_number: null,
    year: null,
    hours: null,
    notes: null,
  };

  const { error: extErr } = await supabase.from(EXT_TABLE).insert(extPayload);
  if (extErr) {
    console.error("VehicleSystemsScreen: error creating vehicle_systems extension", extErr);
    try {
      await supabase.from(SYSTEMS_TABLE).delete().eq("id", foundation.id);
    } catch {}
    const msg = String(extErr?.message || "");
    if (msg.includes(PLAN_LIMIT_TRIGGER)) {
      showWebSafeAlert(
        "Plan limit reached",
        "Starter allows up to 5 systems per asset. Upgrade to add more systems."
      );
    } else {
      showWebSafeAlert("Could not add system", "Please try again.");
    }
    return;
  }

  setSystems((prev) =>
    [...prev, foundation].sort((a, b) => String(a.name).localeCompare(String(b.name)))
  );
  setNewSystemName("");
  closeAddSystemModal();
  Keyboard.dismiss();
} catch (err) {

      console.error("VehicleSystemsScreen: unexpected create error", err);
      showWebSafeAlert("Could not add system", "Unexpected error creating this system.");
    } finally {
      setCreatingSystem(false);
    }
  };

  const confirmWeb = (title, message) => {
    if (!IS_WEB) return false;
    if (typeof window === "undefined") return false;
    return window.confirm(`${title}\n\n${message}`);
  };

  const handleDeleteSystem = (system) => {
    if (!system?.id) return;

    const title = "Delete this system?";
    const msg = "This removes the system from your list. It will not delete existing timeline entries.";

    const doDelete = async () => {
      try {
        // delete vehicle extension row first (best effort)
        try {
          await supabase.from(EXT_TABLE).delete().eq("system_id", system.id);
        } catch (e) {
          console.warn("VehicleSystemsScreen: ext delete warning", e);
        }

        const { error } = await supabase.from(SYSTEMS_TABLE).delete().eq("id", system.id);
        if (error) {
          console.error("VehicleSystemsScreen: delete error", error);
          Alert.alert("Could not delete", "There was a problem deleting this system.");
          return;
        }
        setSystems((prev) => prev.filter((s) => s.id !== system.id));
      } catch (err) {
        console.error("VehicleSystemsScreen: unexpected delete error", err);
        Alert.alert("Could not delete", "Unexpected error deleting this system.");
      }
    };

    if (IS_WEB) {
      const ok = confirmWeb(title, msg);
      if (ok) doDelete();
      return;
    }

    Alert.alert(title, msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: doDelete },
    ]);
  };

  // Playbook
  const openPlaybook = (system) => {
    setActivePlaybookSystem(system);
    setPlaybookDraft(system?.playbook || "");
    setPlaybookInputHeight(220);
    setPlaybookModalVisible(true);
  };

  const closePlaybook = (force = false) => {
    if (savingPlaybook && !force) return;
    setPlaybookModalVisible(false);
    setActivePlaybookSystem(null);
    setPlaybookDraft("");
    setPlaybookInputHeight(220);
    Keyboard.dismiss();
  };

  const openRename = (system) => {
    setRenameSystem(system);
    setRenameDraft(getDisplayName(system));
    setRenameModalVisible(true);
  };

  const closeRename = () => {
    if (savingRename) return;
    setRenameModalVisible(false);
    setRenameSystem(null);
    setRenameDraft("");
    Keyboard.dismiss();
  };

  const saveRename = async () => {
    const sys = renameSystem;
    if (!sys?.id || savingRename) return;

    const trimmed = (renameDraft || "").trim();
    setSavingRename(true);
    try {
      const nextMeta = sys.metadata && typeof sys.metadata === "object" ? { ...sys.metadata } : {};
      if (trimmed) nextMeta.display_name = trimmed;
      else delete nextMeta.display_name;

      const { data, error } = await supabase
        .from(SYSTEMS_TABLE)
        .update({ metadata: nextMeta })
        .eq("id", sys.id)
        .select("*")
        .single();

      if (error) throw error;

      setSystems((prev) =>
        prev
          .map((s) => (s.id === sys.id ? data : s))
          .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      );
      closeRename();
    } catch (e) {
      console.error("VehicleSystemsScreen: error renaming system", e);
      Alert.alert("Could not update title", e?.message || "Please try again.");
    } finally {
      setSavingRename(false);
    }
  };

  const handleSavePlaybook = async () => {
    if (!activePlaybookSystem?.id) return;
    if (savingPlaybook) return;

    const nextPlaybook = (playbookDraft || "").trim();
    setSavingPlaybook(true);

    try {
      const { data, error } = await supabase
        .from(SYSTEMS_TABLE)
        .update({ playbook: nextPlaybook || null })
        .eq("id", activePlaybookSystem.id)
        .select("*")
        .single();

      if (error) {
        console.error("VehicleSystemsScreen: playbook save error", error);
        Alert.alert("Could not save playbook", "There was a problem saving this playbook.");
        return;
      }

      if (data) {
        setSystems((prev) =>
          prev
            .map((s) => (s.id === data.id ? data : s))
            .sort((a, b) => String(a.name).localeCompare(String(b.name)))
        );
        setActivePlaybookSystem(data);
      }

      closePlaybook(true);
    } catch (err) {
      console.error("VehicleSystemsScreen: unexpected playbook save error", err);
      Alert.alert("Could not save playbook", "Unexpected error while saving this playbook.");
    } finally {
      setSavingPlaybook(false);
    }
  };

  const handleDeletePlaybook = async () => {
    const title = "Delete playbook?";
    const msg = "This will clear the playbook text for this system.";

    if (IS_WEB) {
      const ok = confirmWeb(title, msg);
      if (!ok) return;
      setPlaybookDraft("");
      await handleSavePlaybook();
      return;
    }

    Alert.alert(title, msg, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setPlaybookDraft("");
          await handleSavePlaybook();
        },
      },
    ]);
  };

  const listHeader = (
    <View>
      <View style={styles.overviewCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.overviewTitle}>Systems overview</Text>
          <Text style={styles.overviewBody}>
            Track each major system, add timeline entries, and keep a clean ownership story you can trust.
          </Text>
        </View>

        <TouchableOpacity style={styles.overviewButton} onPress={handleViewVehicleStory}>
          <Ionicons name="car-outline" size={16} color={colors.accentBlue} style={{ marginRight: 6 }} />
          <Text style={styles.overviewButtonText}>Vehicle story</Text>
        </TouchableOpacity>
      </View>


      <View style={styles.searchRow}>
        <Ionicons
          name="search-outline"
          size={18}
          color={colors.textMuted}
          style={{ marginRight: 8 }}
        />
        <TextInput
          style={styles.searchInput}
          placeholder="Search systems..."
          value={systemSearch}
          onChangeText={setSystemSearch}
          placeholderTextColor={colors.textMuted}
          returnKeyType="search"
        />

        {systemSearch.trim() ? (
          <TouchableOpacity
            onPress={() => setSystemSearch("")}
            style={styles.searchClearBtn}
          >
            <Ionicons
              name="close-circle"
              size={18}
              color={colors.textMuted}
            />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.addSystemActionsRow}>
        <TouchableOpacity
          style={styles.addSystemCta}
          onPress={openAddSystemModal}
          activeOpacity={0.9}
        >
          <Ionicons
            name="add-circle-outline"
            size={18}
            color={colors.brandWhite}
            style={{ marginRight: 8 }}
          />
          <Text style={styles.addSystemCtaText}>Add system</Text>
        </TouchableOpacity>
      </View>


      <View style={{ height: spacing.sm }} />
    </View>
  );

  const listEmpty = () => {
    if (systemsLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator size="small" />
          <Text style={styles.loadingText}>Loading systems…</Text>
        </View>
      );
    }

    if (loadError) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No systems yet</Text>
        <Text style={styles.emptyBody}>
          Add a few systems you care about and start logging timeline entries.
        </Text>
      </View>
    );
  };

  const filteredSystems = useMemo(() => {
    const q = (systemSearch || "").trim().toLowerCase();
    if (!q) return systems;
    return (systems || []).filter((s) => {
      const name = String(getDisplayName(s) || "").toLowerCase();
      const type = String(s?.system_type || "").toLowerCase();
      const ksc = String(s?.ksc_code || "").toLowerCase();
      return name.includes(q) || type.includes(q) || ksc.includes(q);
    });
  }, [systems, systemSearch]);

  const renderSystemItem = ({ item: system }) => {
    const meta = timelineMeta[system.id];
    const countLabel = !meta ? "No entries" : meta.count === 1 ? "1 entry" : `${meta.count} entries`;
    const lastEntry = meta?.lastDate
  ? formatKeeprDate(String(meta.lastDate).slice(0, 10))
  : null;
    const hasPlaybook = !!system.playbook;

    return (
      <View style={styles.systemCard}>
        <View style={styles.systemHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.systemName}>{getDisplayName(system)}</Text>
          </View>

          <View style={styles.systemHeaderActions}>

            <TouchableOpacity style={styles.iconButton} onPress={() => handleEditSystemEnrichment(system)}>
              <Ionicons name="pencil-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={() => openRename(system)}>
              <Ionicons name="text-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={() => handleOpenSystemAttachments(system)}>
              <Ionicons name="attach-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconButton} onPress={() => handleDeleteSystem(system)}>
              <Ionicons name="trash-outline" size={16} color="#B91C1C" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.systemMetaRow}>
          <Text style={styles.systemMetaLabel}>Status: </Text>
          <Text style={styles.systemMetaValue}>{system.status || "ok"}</Text>
        </View>

        <View style={styles.systemMetaRow}>
          <Text style={styles.systemMetaLabel}>Timeline: </Text>
          <Text style={styles.systemMetaValue}>
            {countLabel}
            {lastEntry ? ` · Last: ${lastEntry}` : ""}
          </Text>
        </View>

        <View style={styles.systemActionsRow}>
          <TouchableOpacity
            style={[styles.chipButton, hasPlaybook && styles.chipButtonPlaybookFilled]}
            onPress={() => openPlaybook(system)}
          >
            <Ionicons
              name={hasPlaybook ? "document-text" : "document-text-outline"}
              size={14}
              color={hasPlaybook ? colors.brandWhite : colors.accentBlue}
              style={{ marginRight: 4 }}
            />
            <Text style={[styles.chipButtonText, hasPlaybook && styles.chipButtonPlaybookTextFilled]}>
              Playbook
            </Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.chipButton} onPress={() => handleAddRecordForSystem(system)}>
            <Ionicons name="add-circle-outline" size={14} color={colors.accentBlue} style={{ marginRight: 4 }} />
            <Text style={styles.chipButtonText}>Add record</Text>
          </TouchableOpacity>
                    <TouchableOpacity
                        style={styles.chipButton}
                        onPress={() => handleViewSystemStory(system)}
                      >
                        <Ionicons name="time-outline" size={14} color={colors.accentBlue} style={{ marginRight: 4 }} />
                        <Text style={styles.chipButtonText}>View Story</Text>
                      </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.screen}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={handleBack}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>{vehicleLabel}</Text>
            <Text style={styles.screenSubtitle}>Systems that keep {vehicleLabel} running.</Text>
          </View>
        </View>

        {IS_WEB ? (
          <FlatList
            data={filteredSystems}
            keyExtractor={(item) => item.id}
            renderItem={renderSystemItem}
            ListHeaderComponent={listHeader}
            ListEmptyComponent={listEmpty}
            ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          />
        ) : (
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.overviewCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.overviewTitle}>Systems overview</Text>
              <Text style={styles.overviewBody}>
                Track each major system, add timeline entries, and keep a clean ownership story you can trust.
              </Text>
            </View>

            <TouchableOpacity style={styles.overviewButton} onPress={handleViewVehicleStory}>
              <Ionicons name="car-outline" size={16} color={colors.accentBlue} style={{ marginRight: 6 }} />
              <Text style={styles.overviewButtonText}>Vehicle story</Text>
            </TouchableOpacity>
          </View>

          
          <View style={styles.searchRow}>
            <Ionicons
              name="search-outline"
              size={18}
              color={colors.textMuted}
              style={{ marginRight: 8 }}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search systems..."
              value={systemSearch}
              onChangeText={setSystemSearch}
              placeholderTextColor={colors.textMuted}
              returnKeyType="search"
            />

            {systemSearch.trim() ? (
              <TouchableOpacity
                onPress={() => setSystemSearch("")}
                style={styles.searchClearBtn}
              >
                <Ionicons
                  name="close-circle"
                  size={18}
                  color={colors.textMuted}
                />
              </TouchableOpacity>
            ) : null}
          </View>

          <View style={styles.addSystemActionsRow}>
            <TouchableOpacity
              style={styles.addSystemCta}
              onPress={openAddSystemModal}
              activeOpacity={0.9}
            >
              <Ionicons
                name="add-circle-outline"
                size={18}
                color={colors.brandWhite}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.addSystemCtaText}>Add system</Text>
            </TouchableOpacity>
          </View>


          {systemsLoading && !filteredSystems.length ? (
            <View style={styles.centered}>
              <ActivityIndicator size="small" />
              <Text style={styles.loadingText}>Loading systems…</Text>
            </View>
          ) : loadError ? (
            <View style={styles.centered}>
              <Text style={styles.errorText}>{loadError}</Text>
            </View>
          ) : !filteredSystems.length ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No systems yet</Text>
              <Text style={styles.emptyBody}>
                Add a few systems you care about and start logging timeline entries.
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredSystems}
              keyExtractor={(item) => item.id}
              renderItem={renderSystemItem}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
              contentContainerStyle={{ paddingTop: spacing.sm }}
            />
          )}
        </ScrollView>
        )}

        
        {/* Add system modal */}
        <Modal
          visible={addSystemModalVisible}
          transparent
          animationType="fade"
          onRequestClose={closeAddSystemModal}
        >
          <Pressable style={styles.modalBackdrop} onPress={closeAddSystemModal}>
            <Pressable style={[styles.modalCard, { maxWidth: 460 }]} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Add a system</Text>
                <TouchableOpacity onPress={closeAddSystemModal} disabled={creatingSystem}>
                  <Ionicons name="close-outline" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.playbookHintText}>
                Create a system so you can attach proof, log service, and build the story.
              </Text>

              <TextInput
                value={addSystemDraft}
                onChangeText={setAddSystemDraft}
                placeholder="System name (e.g., Brakes, Audio, Suspension)"
                style={styles.modalTextInput}
                placeholderTextColor={colors.textMuted}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={() => handleCreateSystem(addSystemDraft)}
                editable={!creatingSystem}
              />

              <View style={styles.playbookActionsRow}>
                <TouchableOpacity
                  style={[styles.playbookButton, styles.renameCancel]}
                  onPress={closeAddSystemModal}
                  disabled={creatingSystem}
                >
                  <Text style={styles.renameCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.playbookButton,
                    styles.playbookSave,
                    (!addSystemDraft.trim() || creatingSystem) && { opacity: 0.6 },
                  ]}
                  onPress={() => handleCreateSystem(addSystemDraft)}
                  disabled={!addSystemDraft.trim() || creatingSystem}
                >
                  {creatingSystem ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.playbookSaveText}>Add</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

{/* Playbook modal */}
        <Modal
          visible={playbookModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => closePlaybook(true)}
        >
          {IS_WEB ? (
            <View style={styles.modalBackdrop}>
              <View style={[styles.modalCard, styles.playbookModalCardWeb]}>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>
                    Playbook for {activePlaybookSystem?.name || "system"}
                  </Text>

                  <TouchableOpacity
                    onPress={() => closePlaybook(true)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    disabled={savingPlaybook}
                  >
                    <Ionicons name="close-outline" size={22} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <View style={styles.playbookBodyWeb}>
                  <Text style={styles.playbookHintText}>
                    Write steps like:
                    {"\n\n"}1. What to check{"\n"}2. Common issues{"\n"}3. Parts / specs{"\n"}4. How you like it maintained
                  </Text>

                  <TextInput
                    style={[styles.playbookInput, styles.playbookInputWeb]}
                    multiline
                    textAlignVertical="top"
                    placeholder="Paste or write your playbook for this system…"
                    placeholderTextColor={colors.textMuted}
                    value={playbookDraft}
                    onChangeText={setPlaybookDraft}
                    scrollEnabled
                  />
                </View>

                <View style={styles.playbookActionsRow}>
                  <View style={styles.playbookLeftActions}>
                    {!!activePlaybookSystem?.playbook && (
                      <TouchableOpacity
                        style={[styles.playbookButton, styles.playbookDelete]}
                        onPress={handleDeletePlaybook}
                        disabled={savingPlaybook}
                      >
                        <Text style={styles.playbookDeleteText}>Delete</Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <TouchableOpacity
                    style={[styles.playbookButton, styles.playbookSave]}
                    onPress={handleSavePlaybook}
                    disabled={savingPlaybook}
                  >
                    {savingPlaybook ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.playbookSaveText}>Save</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            <Pressable style={styles.modalBackdrop} onPress={Keyboard.dismiss}>
              <View style={{ width: "100%", alignItems: "center" }}>
                <Pressable onPress={() => {}} style={[styles.modalCard, { maxWidth: 420 }]}>
                  <View style={styles.modalHeaderRow}>
                    <Text style={styles.modalTitle}>
                      Playbook for {activePlaybookSystem?.name || "system"}
                    </Text>

                    <TouchableOpacity
                      onPress={() => closePlaybook(true)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      disabled={savingPlaybook}
                    >
                      <Ionicons name="close-outline" size={22} color={colors.textMuted} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    style={{ flexGrow: 0 }}
                    contentContainerStyle={{ paddingBottom: spacing.md }}
                    keyboardShouldPersistTaps="always"
                    showsVerticalScrollIndicator={false}
                  >
                    <Text style={styles.playbookHintText}>
                      Write steps like:
                      {"\n\n"}1. What to check{"\n"}2. Common issues{"\n"}3. Parts / specs{"\n"}4. How you like it maintained
                    </Text>

                    <TextInput
                      style={[styles.playbookInput, { height: playbookInputHeight }]}
                      multiline
                      textAlignVertical="top"
                      placeholder="Paste or write your playbook for this system…"
                      placeholderTextColor={colors.textMuted}
                      value={playbookDraft}
                      onChangeText={setPlaybookDraft}
                      scrollEnabled
                      onContentSizeChange={(e) => {
                        const minHeight = 220;
                        const maxHeight = 360;
                        const nextHeight = e.nativeEvent.contentSize.height;
                        const clamped = Math.max(minHeight, Math.min(maxHeight, nextHeight));
                        setPlaybookInputHeight(clamped);
                      }}
                    />
                  </ScrollView>

                  <View style={styles.playbookActionsRow}>
                    <View style={styles.playbookLeftActions}>
                      {!!activePlaybookSystem?.playbook && (
                        <TouchableOpacity
                          style={[styles.playbookButton, styles.playbookDelete]}
                          onPress={handleDeletePlaybook}
                          disabled={savingPlaybook}
                        >
                          <Text style={styles.playbookDeleteText}>Delete</Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <TouchableOpacity
                      style={[styles.playbookButton, styles.playbookSave]}
                      onPress={handleSavePlaybook}
                      disabled={savingPlaybook}
                    >
                      {savingPlaybook ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <Text style={styles.playbookSaveText}>Save</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </Pressable>
              </View>
            </Pressable>
          )}
        </Modal>

        {/* Rename system title (display name override) */}
        <Modal
          visible={renameModalVisible}
          transparent
          animationType="fade"
          onRequestClose={closeRename}
        >
          <Pressable style={styles.modalBackdrop} onPress={Keyboard.dismiss}>
            <Pressable style={styles.modalCard} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Edit system title</Text>
                <TouchableOpacity
                  onPress={closeRename}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  disabled={savingRename}
                >
                  <Ionicons name="close-outline" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.playbookHintText}>
                This is the name you’ll see in your asset. The standard system label stays intact for reporting.
              </Text>

              <TextInput
                style={styles.modalTextInput}
                value={renameDraft}
                onChangeText={setRenameDraft}
                placeholder="e.g., 5.0 MPI - I/O"
                placeholderTextColor={colors.textMuted}
                returnKeyType="done"
                onSubmitEditing={saveRename}
                editable={!savingRename}
              />

              <View style={styles.playbookActionsRow}>
                <TouchableOpacity
                  style={[styles.playbookButton, styles.renameCancel]}
                  onPress={closeRename}
                  disabled={savingRename}
                >
                  <Text style={styles.renameCancelText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.playbookButton, styles.playbookSave]}
                  onPress={saveRename}
                  disabled={savingRename || !renameDraft.trim()}
                >
                  {savingRename ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.playbookSaveText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Web-safe error/plan modal (handles modal-within-modal) */}
        <Modal
          visible={planModalVisible}
          transparent
          animationType="fade"
          onRequestClose={closePlanModal}
        >
          <Pressable style={styles.modalBackdrop} onPress={closePlanModal}>
            <Pressable style={[styles.modalCard, { maxWidth: 460 }]} onPress={() => {}}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>{planModalTitle || "Notice"}</Text>
                <TouchableOpacity onPress={closePlanModal}>
                  <Ionicons name="close-outline" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {!!planModalBody && <Text style={styles.modalSubtitle}>{planModalBody}</Text>}

              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={[styles.modalActionBtn, styles.modalActionBtnPrimary]}
                  onPress={closePlanModal}
                >
                  <Text style={styles.modalActionTextPrimary}>OK</Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

      </View>
    </SafeAreaView>
  );
};

export default VehicleSystemsScreen;

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  scrollContent: { paddingBottom: spacing.xl },
  listContent: { paddingBottom: spacing.xl, paddingTop: 0 },
  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  backButton: { marginRight: spacing.sm, paddingRight: spacing.sm, paddingVertical: 4 },
  screenTitle: { ...typography.title },
  screenSubtitle: { ...typography.subtitle },

  overviewCard: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    marginBottom: spacing.lg,
    ...shadows.subtle,
  },
  overviewTitle: { fontSize: 14, fontWeight: "600", color: colors.textPrimary, marginBottom: 4 },
  overviewBody: { fontSize: 12, color: colors.textSecondary },
  overviewButton: {
    marginLeft: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.accentBlue,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
  },
  overviewButtonText: { fontSize: 12, fontWeight: "600", color: colors.accentBlue },


  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    ...shadows.subtle,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    paddingVertical: 0,
  },
  searchClearBtn: {
    marginLeft: 8,
  },
  addSystemActionsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  addSystemCta: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.accentBlue,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  addSystemCtaText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.brandWhite,
  },


  addSystemRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  addSystemInput: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    fontSize: 13,
    color: colors.textPrimary,
  },
  addSystemButton: {
    marginLeft: spacing.sm,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.accentBlue,
    alignItems: "center",
    justifyContent: "center",
  },

  centered: { alignItems: "center", justifyContent: "center", paddingVertical: spacing.lg },
  loadingText: { marginTop: spacing.xs, fontSize: 12, color: colors.textSecondary },
  errorText: { fontSize: 13, color: "#B91C1C", textAlign: "center" },

  emptyState: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    ...shadows.subtle,
  },
  emptyTitle: { fontSize: 14, fontWeight: "600", color: colors.textPrimary, marginBottom: 4 },
  emptyBody: { fontSize: 12, color: colors.textSecondary },

  systemCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    ...shadows.subtle,
  },
  systemHeaderRow: { flexDirection: "row", alignItems: "flex-start", marginBottom: spacing.xs },
  systemName: { fontSize: 14, fontWeight: "600", color: colors.textPrimary },

  systemHeaderActions: { flexDirection: "row", marginLeft: spacing.sm },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.xs,
  },

  systemMetaRow: { flexDirection: "row", alignItems: "center", marginTop: 2 },
  systemMetaLabel: { fontSize: 12, color: colors.textSecondary },
  systemMetaValue: { fontSize: 12, color: colors.textPrimary, fontWeight: "500" },

  systemActionsRow: { flexDirection: "row", marginTop: spacing.sm },
  chipButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder || colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    marginRight: spacing.xs,
    backgroundColor: colors.chipBackground || colors.surfaceSubtle,
  },
  chipButtonText: { fontSize: 12, color: colors.accentBlue, fontWeight: "500" },
  chipButtonPlaybookFilled: { backgroundColor: colors.accentBlue },
  chipButtonPlaybookTextFilled: { color: colors.brandWhite },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: "100%",
    maxWidth: 520,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    maxHeight: "80%",
  },
  modalHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
    alignItems: "center",
  },
  modalTitle: { fontSize: 16, fontWeight: "700", color: colors.textPrimary },

  modalSubtitle: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  modalActionsRow: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  modalActionBtnPrimary: {
    backgroundColor: colors.accentBlue,
  },
  modalActionTextPrimary: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },

  playbookHintText: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  playbookInput: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary,
  },

  playbookModalCardWeb: { height: "80%", maxHeight: 560, display: "flex" },
  playbookBodyWeb: { flex: 1, alignSelf: "stretch" },
  playbookInputWeb: { flex: 1, minHeight: 180 },

  playbookActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
  },
  playbookLeftActions: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  playbookButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    minWidth: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  playbookDelete: { borderWidth: 1, borderColor: "#B91C1C", backgroundColor: "#FEF2F2" },
  playbookDeleteText: { fontSize: 13, fontWeight: "600", color: "#B91C1C" },
  playbookSave: { backgroundColor: colors.accentBlue },
  playbookSaveText: { fontSize: 13, fontWeight: "600", color: "#fff" },

  renameHintText: { fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm },
  renameInput: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary,
  },
  renameActionsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    marginTop: spacing.md,
  },
  renameCancelButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.sm,
  },
  renameCancelText: { fontSize: 13, fontWeight: "600", color: colors.textPrimary },
  renameSaveButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.accentBlue,
    minWidth: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  renameSaveText: { fontSize: 13, fontWeight: "600", color: "#fff" },


  modalTextInput: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary,
  },

  renameCancel: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },
  renameCancelText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
});
