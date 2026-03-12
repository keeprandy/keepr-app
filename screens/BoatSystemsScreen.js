// screens/BoatSystemsScreen.js
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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

import marineKsc from "../data/marine_ksc.json";
import { supabase } from "../lib/supabaseClient";
import { formatKeeprDate } from "../lib/dateFormat";

const IS_WEB = Platform.OS === "web";
const SYSTEMS_TABLE = "systems";
const EXT_TABLE = "boat_systems";

// Web: RN Alert can be unreliable when a Modal is already visible (modal-within-modal).
// Use a lightweight Modal for plan-limit + errors on web.
const PLAN_LIMIT_TRIGGER = "plan_limit_systems_per_asset";

function safeLower(s) {
  return String(s || "").trim().toLowerCase();
}

function getLocationHint(system) {
  const meta = system?.metadata;
  if (meta && typeof meta === "object") {
    return meta.location_hint || meta.locationHint || "";
  }
  return "";
}

function getPlaybookFromSystem(system) {
  const meta = system?.metadata;
  if (meta && typeof meta === "object") return meta.playbook || "";
  return "";
}

function getDisplayName(system) {
  const meta = system?.metadata && typeof system.metadata === "object" ? system.metadata : {};
  const dn = typeof meta.display_name === "string" ? meta.display_name.trim() : "";
  return dn || system?.name || "System";
}


function withPlaybookInMetadata(system, nextPlaybook) {
  const meta = system?.metadata && typeof system.metadata === "object" ? system.metadata : {};
  const trimmed = String(nextPlaybook || "").trim();
  const nextMeta = { ...meta, playbook: trimmed ? trimmed : null };
  return nextMeta;
}

const BoatSystemsScreen = ({ route, navigation }) => {
  const { boatId, boatName } = route?.params || {};
  const boatLabel = boatName || "Boat";

  const [systems, setSystems] = useState([]);
  const [systemsLoading, setSystemsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // service history per system: { [systemId]: { lastDate, count } }
  const [serviceMeta, setServiceMeta] = useState({});

  // add-custom-system input
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

  // starter pack modal
  const [starterModalVisible, setStarterModalVisible] = useState(false);
  const [addingTemplateId, setAddingTemplateId] = useState(null);

  // playbook modal
  const [playbookModalVisible, setPlaybookModalVisible] = useState(false);
  const [activePlaybookSystem, setActivePlaybookSystem] = useState(null);
  const [playbookDraft, setPlaybookDraft] = useState("");
  const [savingPlaybook, setSavingPlaybook] = useState(false);
  const [playbookInputHeight, setPlaybookInputHeight] = useState(220);
  // rename system (display name override)
  const [renameModalVisible, setRenameModalVisible] = useState(false);
  const [renameSystem, setRenameSystem] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  // Starter Pack templates (derived from marine_ksc.json systems map)
  // marine_ksc.json is a taxonomy map keyed by KSC code (e.g., "ENG-MAIN") with a label/subsystems.
  // For boats, we treat this taxonomy as the baseline starter pack.
  const starterPackTemplates = useMemo(() => {
    const map = marineKsc?.systems && typeof marineKsc.systems === "object" ? marineKsc.systems : {};
    return Object.entries(map).map(([ksc_code, def]) => ({
      ksc_code,
      name: def?.label || ksc_code,
      system_type: ksc_code,
      lod: typeof def?.default_lod === "number" ? def.default_lod : 2,
      subsystems: Array.isArray(def?.subsystems) ? def.subsystems : [],
      source_type: "starter_pack",
     }));
  }, []);

  const filteredSystems = useMemo(() => {
    const q = (systemSearch || "").trim().toLowerCase();
    if (!q) return systems;
    return (systems || []).filter((s) => {
      const name = String(getDisplayName(s) || "").toLowerCase();
      const type = String(s?.system_type || "").toLowerCase();
      const ksc = String(s?.ksc_code || "").toLowerCase();
      const loc = String(getLocationHint(s) || "").toLowerCase();
      return name.includes(q) || type.includes(q) || ksc.includes(q) || loc.includes(q);
    });
  }, [systems, systemSearch]);

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

  /* ----------------- LOADERS ----------------- */

  const loadSystems = useCallback(async () => {
    if (!boatId) return;

    setSystemsLoading(true);
    setLoadError(null);

    const { data, error } = await supabase
      .from(SYSTEMS_TABLE)
      .select("*")
      .eq("asset_id", boatId)
      .order("name", { ascending: true });

    if (error) {
      console.error("BoatSystemsScreen: error loading systems", error);
      setLoadError("Could not load boat systems.");
      setSystems([]);
    } else {
      setSystems(data || []);
    }

    setSystemsLoading(false);
  }, [boatId]);

  const loadServiceMeta = useCallback(async () => {
    if (!boatId) return;

    try {
      const { data, error } = await supabase
        .from("service_records")
        .select("id, system_id, performed_at")
        .eq("asset_id", boatId)
        .order("performed_at", { ascending: false });

      if (error) {
        console.error("BoatSystemsScreen: error loading service meta", error);
        setServiceMeta({});
        return;
      }

      const grouped = {};
      (data || []).forEach((row) => {
        if (!row.system_id) return;
        const existing = grouped[row.system_id];
        if (!existing) grouped[row.system_id] = { lastDate: row.performed_at, count: 1 };
        else existing.count += 1;
      });

      setServiceMeta(grouped);
    } catch (err) {
      console.error("BoatSystemsScreen: unexpected meta error", err);
      setServiceMeta({});
    }
  }, [boatId]);

  const loadAll = useCallback(async () => {
    await Promise.all([loadSystems(), loadServiceMeta()]);
  }, [loadSystems, loadServiceMeta]);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [loadAll])
  );

  const onRefresh = useCallback(async () => {
    if (!boatId) return;
    setRefreshing(true);
    try {
      await loadAll();
    } finally {
      setRefreshing(false);
    }
  }, [boatId, loadAll]);

  /* ----------------- NAV HELPERS ----------------- */

  const handleViewBoatStory = () => {
    if (!boatId) return;
    navigation.navigate("BoatStory", { boatId });
  };

  const handleViewSystemStory = (system) => {
    if (!system?.id || !boatId) return;

    navigation.navigate("BoatSystemStory", {
      systemId: system.id,
      boatId,
      boatName: boatLabel,
    });
  };

  const handleEditSystemEnrichment = (system) => {
    if (!system?.id || !boatId) return;
    navigation.navigate("EditSystemEnrichment", {
      assetId: boatId,
      assetName: boatLabel,
      assetType: "boat",
      systemId: system.id,
      systemName: getDisplayName(system),
      systemKey: system.id,
    });
  };


  // ✅ Add record uses AddTimelineRecord (not AddServiceRecord)
  const handleAddServiceForSystem = (system) => {
    if (!system?.id || !boatId) return;

    navigation.navigate("AddTimelineRecord", {
      source: "boatSystem",
      assetId: boatId,
      assetName: boatLabel,
      systemId: system.id,
      systemName: getDisplayName(system),
      defaultCategory: "service",
      defaultTitle: system.name ? `${system.name} service` : "Service",
    });
  };

  const handleOpenSystemAttachments = (system) => {
    if (!boatId || !system?.id) return;

    navigation.navigate("AssetAttachments", {
      assetId: boatId,
      assetName: boatLabel,
      targetType: "system",
      targetId: system.id,
      targetRole: "other",
    });
  };

  /* ----------------- ADD / DELETE SYSTEMS ----------------- */

  const handleCreateSystem = async () => {
    const trimmed = (newSystemName || "").trim();
    if (!trimmed || !boatId || creatingSystem) return;

    const exists = systems.some((sys) => safeLower(sys?.name) === safeLower(trimmed));
    if (exists) {
      Alert.alert("Already added", "That system is already on your list.");
      return;
    }

    setCreatingSystem(true);

    let foundation = null;

    try {
      // 1) Foundation row (canonical system id)
      const foundationPayload = {
        asset_id: boatId,
        ksc_code: "general",
        name: trimmed,
        lod: 2,
        status: "ok",
        system_type: "general",
        source_type: "manual",
        metadata: {},
      };

      const { data: sysRow, error: sysErr } = await supabase
        .from(SYSTEMS_TABLE)
        .insert(foundationPayload)
        .select("*")
        .single();

      if (sysErr) {
        console.error("BoatSystemsScreen: error creating foundation system", sysErr);
        const msg = String(sysErr?.message || "");
        if (msg.includes(PLAN_LIMIT_TRIGGER)) {
          showWebSafeAlert(
            "Plan limit reached",
            "Starter allows up to 5 systems per asset. Upgrade to add more systems."
          );
        } else {
          showWebSafeAlert(
            "Could not add system",
            "Please try again or add this system later."
          );
        }
        return;
      }

      foundation = sysRow;

      // 2) Boat extension row (optional but keeps schema aligned)
      try {
        const extPayload = {
          asset_id: boatId,
          system_id: foundation.id,
          system_type: "general",
          name: trimmed,
          manufacturer: null,
          model: null,
          serial_number: null,
          year: null,
          hours: null,
          notes: null,
          photo_url: null,
        };

        const { error: extErr } = await supabase.from(EXT_TABLE).insert(extPayload);

        if (extErr) {
          console.error("BoatSystemsScreen: error creating boat_systems extension", extErr);
          await supabase.from(SYSTEMS_TABLE).delete().eq("id", foundation.id);
          const msg = String(extErr?.message || "");
          if (msg.includes(PLAN_LIMIT_TRIGGER)) {
            showWebSafeAlert(
              "Plan limit reached",
              "Starter allows up to 5 systems per asset. Upgrade to add more systems."
            );
          } else {
            showWebSafeAlert(
              "Could not add system",
              "Please try again or add this system later."
            );
          }
          return;
        }
      } catch (extCatch) {
        console.error("BoatSystemsScreen: unexpected extension create error", extCatch);
        await supabase.from(SYSTEMS_TABLE).delete().eq("id", foundation.id);
        showWebSafeAlert(
          "Could not add system",
          "Please try again or add this system later."
        );
        return;
      }

      setSystems((prev) =>
        [...prev, foundation].sort((a, b) => String(a.name).localeCompare(String(b.name)))
      );
      setNewSystemName("");
      Keyboard.dismiss();
      await loadServiceMeta();
    } catch (err) {
      console.error("BoatSystemsScreen: unexpected create error", err);
      if (foundation?.id) {
        try {
          await supabase.from(SYSTEMS_TABLE).delete().eq("id", foundation.id);
        } catch {}
      }
      showWebSafeAlert("Could not add system", "Unexpected error creating this system.");
    } finally {
      setCreatingSystem(false);
    }
  };

  const closeAddSystemModal = () => {
    if (creatingSystem) return;
    setAddSystemModalVisible(false);
    setAddSystemDraft("");
  };

  const handleCreateSystemFromModal = async () => {
    const trimmed = (addSystemDraft || "").trim();
    if (!trimmed || !boatId || creatingSystem) return;

    const exists = systems.some((sys) => safeLower(sys?.name) === safeLower(trimmed));
    if (exists) {
      Alert.alert("Already added", "That system is already on your list.");
      return;
    }

    setCreatingSystem(true);
    let foundation = null;

    try {
      const foundationPayload = {
        asset_id: boatId,
        ksc_code: "general",
        name: trimmed,
        lod: 2,
        status: "ok",
        system_type: "general",
        source_type: "manual",
        metadata: {},
      };

      const { data: sysRow, error: sysErr } = await supabase
        .from(SYSTEMS_TABLE)
        .insert(foundationPayload)
        .select("*")
        .single();

      if (sysErr) {
        console.error("BoatSystemsScreen: error creating foundation system", sysErr);
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

      foundation = sysRow;

      // boat extension row (best-effort)
      try {
        const extPayload = {
          asset_id: boatId,
          system_id: foundation.id,
          system_type: "general",
          name: trimmed,
          manufacturer: null,
          model: null,
          serial_number: null,
          year: null,
          hours: null,
          notes: null,
          photo_url: null,
        };

        const { error: extErr } = await supabase.from(EXT_TABLE).insert(extPayload);
        if (extErr) console.warn("BoatSystemsScreen: extension insert failed", extErr);
      } catch (e) {
        console.warn("BoatSystemsScreen: extension insert exception", e);
      }

      setSystems((prev) =>
        [...(prev || []), foundation].sort((a, b) =>
          String(a?.name || "").localeCompare(String(b?.name || ""))
        )
      );

      closeAddSystemModal();
      Keyboard.dismiss();
      await loadServiceMeta();
    } catch (err) {
      console.error("BoatSystemsScreen: unexpected create error (modal)", err);
      if (foundation?.id) {
        try {
          await supabase.from(SYSTEMS_TABLE).delete().eq("id", foundation.id);
        } catch {}
      }
      showWebSafeAlert("Could not add system", "Unexpected error creating this system.");
    } finally {
      setCreatingSystem(false);
    }
  };


  const confirmWeb = (title, message) => {
    if (!IS_WEB) return false;
    if (typeof window === "undefined") return false;
    // eslint-disable-next-line no-undef
    return window.confirm(`${title}\n\n${message}`);
  };

  const handleDeleteSystem = (system) => {
    if (!system?.id) return;

    const title = "Delete this system?";
    const msg =
      "This will not delete existing records, but you will no longer see this system in your list.";

    const doDelete = async () => {
      try {
        await supabase.from(EXT_TABLE).delete().eq("system_id", system.id);

        const { error } = await supabase.from(SYSTEMS_TABLE).delete().eq("id", system.id);

        if (error) {
          console.error("BoatSystemsScreen: delete error", error);
          Alert.alert("Could not delete", "There was a problem deleting this system.");
          return;
        }

        setSystems((prev) => prev.filter((s) => s.id !== system.id));
        await loadServiceMeta();
      } catch (err) {
        console.error("BoatSystemsScreen: unexpected delete error", err);
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

  /* ----------------- STARTER PACK (CREATE ONLY) ----------------- */

  const openStarterPack = () => setStarterModalVisible(true);

  const closeStarterPack = () => {
    setStarterModalVisible(false);
    setAddingTemplateId(null);
  };

  const isTemplateAlreadyAdded = (tpl) => {
    const code = String(tpl?.ksc_code || "").trim();
    if (code) {
      return systems.some((s) => String(s?.ksc_code || "").trim() === code);
    }
    const name = safeLower(tpl?.name);
    if (!name) return false;
    return systems.some((s) => safeLower(s?.name) === name);
  };

  const handleAddTemplateSystem = async (template) => {
    if (!boatId || !template) return;

    if (isTemplateAlreadyAdded(template)) {
      Alert.alert("Already added", "That system is already on your list.");
      return;
    }

    setAddingTemplateId(template.ksc_code || template.name);

    try {
      const payload = {
        asset_id: boatId,
        ksc_code: template.ksc_code || template.system_type || "general",
        name: template.name,
        lod: 2,
        status: "ok",
        system_type: template.system_type || "general",
        source_type: "starter_pack",
        metadata: {
          ...(template.metadata && typeof template.metadata === "object" ? template.metadata : {}),
          location_hint: template.location_hint || null,
          options: Array.isArray(template.options) ? template.options : undefined,
          subsystems: Array.isArray(template.subsystems) ? template.subsystems : undefined,
        },
      };

      const { data, error } = await supabase
        .from(SYSTEMS_TABLE)
        .insert(payload)
        .select("*")
        .single();

      if (error) {
        console.error("BoatSystemsScreen: error creating system from template", error);
        const msg = String(error?.message || "");
        if (msg.includes(PLAN_LIMIT_TRIGGER)) {
          showWebSafeAlert(
            "Plan limit reached",
            "Starter allows up to 5 systems per asset. Upgrade to add more systems."
          );
        } else {
          showWebSafeAlert(
            "Could not add system",
            "Problem adding this system from the starter pack."
          );
        }
      } else if (data) {
        // 2) Boat extension row (best-effort)
        try {
          const extPayload = {
            asset_id: boatId,
            system_id: data.id,
            system_type: template.system_type || template.ksc_code || "general",
            name: template.name,
            manufacturer: null,
            model: null,
            serial_number: null,
            year: null,
            hours: null,
            notes: null,
            photo_url: null,
          };
          await supabase.from("boat_systems").insert(extPayload);
        } catch (extErr) {
          console.warn("BoatSystemsScreen: boat_systems extension insert failed (template add)", extErr);
        }


        setSystems((prev) =>
          [...prev, data].sort((a, b) => String(a.name).localeCompare(String(b.name)))
        );
        await loadServiceMeta();
      }
    } catch (err) {
      console.error("BoatSystemsScreen: unexpected template add error", err);
      showWebSafeAlert("Template error", "Unexpected problem adding this starter pack system.");
    } finally {
      setAddingTemplateId(null);
    }
  };

  /* ----------------- PLAYBOOK (stored in systems.metadata.playbook) ----------------- */

  const openPlaybook = (system) => {
    setActivePlaybookSystem(system);
    setPlaybookDraft(getPlaybookFromSystem(system));
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

      setSystems((prev) => prev.map((s) => (s.id === sys.id ? data : s)));
      closeRename();
    } catch (e) {
      console.error("BoatSystemsScreen: error renaming system", e);
      Alert.alert("Could not update title", e?.message || "Please try again.");
    } finally {
      setSavingRename(false);
    }
  };


  const handleSavePlaybook = async () => {
    if (!activePlaybookSystem?.id) return;
    if (savingPlaybook) return;

    const nextMeta = withPlaybookInMetadata(activePlaybookSystem, playbookDraft);

    setSavingPlaybook(true);
    try {
      const { data, error } = await supabase
        .from(SYSTEMS_TABLE)
        .update({ metadata: nextMeta })
        .eq("id", activePlaybookSystem.id)
        .select("*")
        .single();

      if (error) {
        console.error("BoatSystemsScreen: playbook save error", error);
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
      console.error("BoatSystemsScreen: unexpected playbook save error", err);
      Alert.alert("Could not save playbook", "Unexpected error while saving this playbook.");
    } finally {
      setSavingPlaybook(false);
    }
  };

  const handleDeletePlaybook = async () => {
    const title = "Delete playbook?";
    const msg = "This will clear the playbook text for this system.";

    const clearAndSave = async () => {
      setPlaybookDraft("");
      await handleSavePlaybook();
    };

    if (IS_WEB) {
      const ok = confirmWeb(title, msg);
      if (!ok) return;
      await clearAndSave();
      return;
    }

    Alert.alert(title, msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: clearAndSave },
    ]);
  };

  const handlePrintPlaybook = () => {
    const text = (playbookDraft || "").trim();
    if (!text) return;
    if (!IS_WEB) return;
    if (typeof window === "undefined") return;

    const title = `Playbook for ${activePlaybookSystem?.name || "system"}`;
    const safeBody = text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // eslint-disable-next-line no-undef
    const popup = window.open("", "_blank");
    if (!popup) return;

    popup.document.write(
      `<html><head><title>${title}</title></head><body><h2>${title}</h2><pre style="white-space:pre-wrap;font-family:system-ui, -apple-system, BlinkMacSystemFont, sans-serif;">${safeBody}</pre></body></html>`
    );
    popup.document.close();
    popup.focus();
    popup.print();
  };

  /* ----------------- RENDER ----------------- */

  const renderSystemItem = ({ item: system }) => {
    const meta = serviceMeta[system.id];
    const hasRecords = !!meta;

    const countLabel = !meta ? "No records" : meta.count === 1 ? "1 record" : `${meta.count} records`;
    const lastService = meta?.lastDate ? formatKeeprDate(meta.lastDate) : null;

    const playbookText = getPlaybookFromSystem(system);
    const hasPlaybook = !!(playbookText && playbookText.trim().length > 0);

    const options = system?.metadata?.options || [];
    const optionCount = Array.isArray(options) ? options.length : 0;
    const optionPreview = Array.isArray(options) ? options.slice(0, 2) : [];

    return (
      <View style={styles.systemCard}>
        <View style={styles.systemHeaderRow}>
          <View style={{ flex: 1 }}>
            <View style={styles.systemTitleRow}>
              <Text style={styles.systemName}>{getDisplayName(system)}</Text>

              {optionCount > 0 && (
                <View style={styles.optionCountPill}>
                  <Ionicons
                    name="pricetag-outline"
                    size={12}
                    color={colors.textSecondary}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={styles.optionCountText}>{optionCount} options</Text>
                </View>
              )}
            </View>

            {!!getLocationHint(system) && (
              <Text style={styles.systemLocation}>{getLocationHint(system)}</Text>
            )}

            {optionPreview.length > 0 && (
              <View style={styles.optionChipRow}>
                {optionPreview.map((o) => (
                  <View key={o} style={styles.optionChip}>
                    <Text style={styles.optionChipText} numberOfLines={1}>
                      {o}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>

          <View style={styles.systemHeaderActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => handleEditSystemEnrichment(system)}
            >
              <Ionicons name="pencil-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => openRename(system)}
            >
              <Ionicons name="text-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => handleOpenSystemAttachments(system)}
            >
              <Ionicons name="attach-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => handleDeleteSystem(system)}
            >
              <Ionicons name="trash-outline" size={16} color="#B91C1C" />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.systemMetaRow}>
          <Text style={styles.systemMetaLabel}>Status: </Text>
          <Text style={styles.systemMetaValue}>{system.status || "healthy"}</Text>
        </View>

        <View style={styles.systemMetaRow}>
          <Text style={styles.systemMetaLabel}>Service history: </Text>
          <Text style={styles.systemMetaValue}>
            {countLabel}
            {hasRecords && lastService ? ` · Last: ${lastService}` : ""}
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

          <TouchableOpacity
            style={styles.chipButton}
            onPress={() => handleAddServiceForSystem(system)}
          >
            <Ionicons name="construct-outline" size={14} color={colors.accentBlue} style={{ marginRight: 4 }} />
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

  const listHeader = (
    <View>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={handleBack}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={{ flex: 1 }}>
          <Text style={styles.screenTitle}>{boatLabel}</Text>
          <Text style={styles.screenSubtitle}>
            Systems and subsystems that keep {boatLabel} running.
          </Text>
        </View>
      </View>

      <View style={styles.overviewCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.overviewTitle}>Systems overview</Text>
          <Text style={styles.overviewBody}>
            Track each major system, add records, and build an ownership story you can trust.
          </Text>
        </View>

        <TouchableOpacity style={styles.overviewButton} onPress={handleViewBoatStory}>
          <Ionicons name="book-outline" size={16} color={colors.accentBlue} style={{ marginRight: 6 }} />
          <Text style={styles.overviewButtonText}>View boat story</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.sectionLabel}>SYSTEMS FOR {boatLabel.toUpperCase()}</Text>
        </View>
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
          <TouchableOpacity onPress={() => setSystemSearch("")} style={styles.searchClearBtn}>
            <Ionicons name="close-circle" size={18} color={colors.textMuted} />
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.addSystemActionsRow}>
        <TouchableOpacity
          style={styles.addSystemCta}
          onPress={() => {
            setAddSystemDraft("");
            setAddSystemModalVisible(true);
          }}
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

        <TouchableOpacity style={styles.starterPackButton} onPress={openStarterPack}>
          <Ionicons
            name="sparkles-outline"
            size={16}
            color={colors.accentBlue}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.starterPackText}>Starter pack</Text>
        </TouchableOpacity>
      </View>


      {/* list spacing */}
      <View style={{ height: spacing.sm }} />
    </View>
  );

  const listEmpty = () => {
    if (systemsLoading && !filteredSystems.length) {
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
          Use Starter pack to add common boat systems, or add your own custom systems above.
        </Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.screen}>
        <FlatList
          data={filteredSystems}
          keyExtractor={(item) => item.id}
          renderItem={renderSystemItem}
          ListHeaderComponent={listHeader}
          ListEmptyComponent={listEmpty}
          ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />

        
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

              <Text style={styles.modalSubtitle}>
                Create a system so you can attach proof, log service, and build the story.
              </Text>

              <TextInput
                value={addSystemDraft}
                onChangeText={setAddSystemDraft}
                placeholder="System name (e.g., Generator, Bow Thruster)"
                style={styles.modalInput}
                placeholderTextColor={colors.textMuted}
                autoFocus
                returnKeyType="done"
                onSubmitEditing={handleCreateSystemFromModal}
              />

              <View style={styles.modalActionsRow}>
                <TouchableOpacity
                  style={[styles.modalActionBtn, styles.modalActionBtnGhost]}
                  onPress={closeAddSystemModal}
                  disabled={creatingSystem}
                >
                  <Text style={styles.modalActionTextGhost}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.modalActionBtn,
                    styles.modalActionBtnPrimary,
                    (!addSystemDraft.trim() || creatingSystem) && { opacity: 0.6 },
                  ]}
                  onPress={handleCreateSystemFromModal}
                  disabled={!addSystemDraft.trim() || creatingSystem}
                >
                  <Text style={styles.modalActionTextPrimary}>
                    {creatingSystem ? "Adding..." : "Add"}
                  </Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

{/* Starter pack modal (CREATE ONLY) */}
        <Modal
          visible={starterModalVisible}
          transparent
          animationType="fade"
          onRequestClose={closeStarterPack}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Starter pack systems</Text>

                <TouchableOpacity
                  onPress={closeStarterPack}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="close-outline" size={22} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: spacing.md }}
              >
                <Text style={styles.modalSectionLabel}>Core systems</Text>

                {starterPackTemplates.map((tpl) => {
                  const isAdded = isTemplateAlreadyAdded(tpl);

                  return (
                    <View key={tpl.name} style={styles.templateRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.templateName}>{tpl.name}</Text>
                        {!!tpl.location_hint && <Text style={styles.templateHint}>{tpl.location_hint}</Text>}
                      </View>

                      <TouchableOpacity
                        style={[styles.templateButton, isAdded && styles.templateButtonDisabled]}
                        disabled={isAdded || addingTemplateId === tpl.name}
                        onPress={() => handleAddTemplateSystem(tpl)}
                      >
                        {addingTemplateId === tpl.name ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={[styles.templateButtonText, isAdded && { color: colors.textMuted }]}>
                            {isAdded ? "Added" : "Add"}
                          </Text>
                        )}
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        
      {/* Rename system modal */}
      <Modal visible={renameModalVisible} transparent animationType="fade" onRequestClose={closeRename}>
        <Pressable style={styles.modalBackdrop} onPress={closeRename}>
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>Edit title</Text>
            <Text style={styles.modalSubtitle}>This updates how the system is shown in Keepr.</Text>

            <TextInput
              value={renameDraft}
              onChangeText={setRenameDraft}
              placeholder="System title"
              style={styles.modalInput}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={saveRename}
            />

            <View style={styles.modalActionsRow}>
              <TouchableOpacity style={[styles.modalActionBtn, styles.modalActionBtnGhost]} onPress={closeRename}>
                <Text style={styles.modalActionTextGhost}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalActionBtn, styles.modalActionBtnPrimary]}
                onPress={saveRename}
                disabled={savingRename}
              >
                <Text style={styles.modalActionTextPrimary}>{savingRename ? "Saving..." : "Save"}</Text>
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
                    Paste your playbook here, or jot down steps like:
                    {"\n\n"}1. Seasonal checklist{"\n"}2. Layup / spring commissioning{"\n"}3. Things to watch for
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
                    {!!getPlaybookFromSystem(activePlaybookSystem) && (
                      <TouchableOpacity
                        style={[styles.playbookButton, styles.playbookDelete]}
                        onPress={handleDeletePlaybook}
                        disabled={savingPlaybook}
                      >
                        <Text style={styles.playbookDeleteText}>Delete</Text>
                      </TouchableOpacity>
                    )}

                    {playbookDraft.trim().length > 0 && (
                      <TouchableOpacity
                        style={[styles.playbookButton, styles.playbookPrint]}
                        onPress={handlePrintPlaybook}
                        disabled={savingPlaybook}
                      >
                        <Text style={styles.playbookPrintText}>Print</Text>
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
            <View style={styles.modalBackdrop}>
              <View style={{ width: "100%", alignItems: "center" }}>
                <View style={[styles.modalCard, { maxWidth: 420 }]}>
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
                      Paste your playbook here, or jot down steps like:
                      {"\n\n"}1. Seasonal checklist{"\n"}2. Layup / spring commissioning{"\n"}3. Things to watch for
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
                      {!!getPlaybookFromSystem(activePlaybookSystem) && (
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
            </View>
          )}
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

export default BoatSystemsScreen;

/* ---- STYLES ---- */

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  listContent: {
    paddingBottom: spacing.xl,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
  backButton: {
    marginRight: spacing.sm,
    paddingRight: spacing.sm,
    paddingVertical: 4,
  },
  screenTitle: {
    ...typography.title,
  },
  screenSubtitle: {
    ...typography.subtitle,
  },

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
  overviewTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  overviewBody: {
    fontSize: 12,
    color: colors.textSecondary,
  },
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
  overviewButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.accentBlue,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  sectionLabel: {
    ...typography.sectionLabel,
  },

  starterPackButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    backgroundColor: colors.surfaceSubtle,
  },
  starterPackText: {
    fontSize: 12,
    color: colors.accentBlue,
    fontWeight: "500",
  },

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


  addSystemRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.md,
  },
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

  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.lg,
  },
  loadingText: {
    marginTop: spacing.xs,
    fontSize: 12,
    color: colors.textSecondary,
  },
  errorText: {
    fontSize: 13,
    color: "#B91C1C",
    textAlign: "center",
  },

  emptyState: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    ...shadows.subtle,
  },
  emptyTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  emptyBody: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  systemCard: {
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.md,
    ...shadows.subtle,
  },
  systemHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: spacing.xs,
  },

  systemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  systemName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  optionCountPill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: colors.surfaceSubtle,
    marginLeft: spacing.xs,
  },
  optionCountText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "600",
  },

  systemLocation: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  optionChipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: spacing.xs,
    gap: spacing.xs,
  },
  optionChip: {
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    maxWidth: "100%",
  },
  optionChipText: {
    fontSize: 11,
    color: colors.textSecondary,
    fontWeight: "500",
  },

  systemHeaderActions: {
    flexDirection: "row",
    marginLeft: spacing.sm,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.xs,
  },

  systemMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  systemMetaLabel: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  systemMetaValue: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: "500",
  },

  systemActionsRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },
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
  chipButtonText: {
    fontSize: 12,
    color: colors.accentBlue,
    fontWeight: "500",
  },
  chipButtonPlaybookFilled: {
    backgroundColor: colors.accentBlue,
  },
  chipButtonPlaybookTextFilled: {
    color: colors.brandWhite,
  },

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
    maxWidth: 420,
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
  modalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  modalSectionLabel: {
    ...typography.sectionLabel,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
  },
  templateRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  templateName: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  templateHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  templateButton: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 1,
    borderRadius: radius.pill,
    backgroundColor: colors.accentBlue,
  },
  templateButtonDisabled: {
    backgroundColor: colors.surfaceSubtle,
  },
  templateButtonText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#fff",
  },

  playbookHintText: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
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

  playbookModalCardWeb: {
    height: "80%",
    maxHeight: 560,
    display: "flex",
  },
  playbookBodyWeb: {
    flex: 1,
    alignSelf: "stretch",
  },
  playbookInputWeb: {
    flex: 1,
    minHeight: 180,
  },

  playbookActionsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
  },
  playbookLeftActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  playbookButton: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    minWidth: 100,
    alignItems: "center",
    justifyContent: "center",
  },
  playbookDelete: {
    borderWidth: 1,
    borderColor: "#B91C1C",
    backgroundColor: "#FEF2F2",
  },
  playbookDeleteText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#B91C1C",
  },
  playbookSave: {
    backgroundColor: colors.accentBlue,
  },
  playbookSaveText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#fff",
  },
  playbookPrint: {
    borderWidth: 1,
    borderColor: colors.accentBlue,
    backgroundColor: colors.surface,
  },
  playbookPrintText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.accentBlue,
  },
  modalSubtitle: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  modalInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
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
  modalActionBtnGhost: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalActionBtnPrimary: {
    backgroundColor: colors.accentBlue,
  },
  modalActionTextGhost: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.text,
  },
  modalActionTextPrimary: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },

});
