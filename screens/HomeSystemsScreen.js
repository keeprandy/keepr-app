// screens/HomeSystemsScreen.js
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
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

import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing, typography } from "../styles/theme";

import homeKsc from "../data/home_ksc.json";
import { supabase } from "../lib/supabaseClient";
import { formatDateUS } from "../utils/format";

const IS_WEB = Platform.OS === "web";

// Web: RN Alert can be unreliable when a Modal is already visible (modal-within-modal).
// Use a lightweight Modal for plan-limit + errors on web.
const PLAN_LIMIT_TRIGGER = "plan_limit_systems_per_asset";

const CONTENT_MAX_WIDTH = 1200; // standardized page container width


// Foundation + extension tables (Home uses both)
const SYSTEMS_TABLE = "systems"; // foundation (canonical system id)
const HOME_SYSTEMS_TABLE = "home_systems"; // home-specific extension
const EVENT_INBOX_TABLE = "event_inbox"; // new module base

function getDisplayName(system) {
  const meta =
    system?.metadata && typeof system.metadata === "object" ? system.metadata : {};
  const dn = typeof meta.display_name === "string" ? meta.display_name.trim() : "";
  return dn || system?.name || "System";
}

const todayISODate = () => {
  try {
    return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  } catch {
    return null;
  }
};

// Mode (state) is derived from draft Inbox Events (event_inbox.context.mode)
// "Good to Go" is implicit when no draft exists for a system.
const MODE_LABELS = {
  under_repair: "Under Repair",
  enhance: "Enhance / Update",
  replace: "Time to Replace",
  warranty: "Warranty Claim",
  insurance: "Insurance Claim",
};

const normalizeModeKey = (raw) => {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // If already a stable key
  const keyish = s.toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
  if (MODE_LABELS[keyish]) return keyish;

  // Map common human strings to keys
  const lc = s.toLowerCase();
  if (lc.includes("repair")) return "under_repair";
  if (lc.includes("enhance")) return "enhance";
  if (lc.includes("replace")) return "replace";
  if (lc.includes("warranty")) return "warranty";
  if (lc.includes("insurance")) return "insurance";

  return null;
};

const getModeLabelFromEvent = (ev) => {
  const key =
    normalizeModeKey(ev?.context?.mode) ||
    normalizeModeKey(ev?.context?.mode_label);
  return key ? MODE_LABELS[key] : null;
};

const HomeSystemsScreen = ({ route, navigation }) => {
  const { homeId, homeName } = route?.params || {};
  const homeLabel = homeName || "Home";

  const [systems, setSystems] = useState([]); // merged rows keyed by foundation systems.id
  const [systemsLoading, setSystemsLoading] = useState(false);
  const [loadError, setLoadError] = useState(null);

  // service history per system: { [systemId]: { lastDate, count } }
  const [serviceMeta, setServiceMeta] = useState({});

  // add-custom-system input
  const [newSystemName, setNewSystemName] = useState("");
  const [creatingSystem, setCreatingSystem] = useState(false);

  // filter/search
  const [systemSearch, setSystemSearch] = useState("");

  // add system modal (clear separation from search)
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

  // MODE -> EVENT flow
  const [modeModalVisible, setModeModalVisible] = useState(false);
  const [modeTargetSystem, setModeTargetSystem] = useState(null);
  const [creatingEvent, setCreatingEvent] = useState(false);
  const [draftBySystemId, setDraftBySystemId] = useState({}); // { [system_id]: eventRow }

  const MODES = useMemo(
    () => [
      { key: "under_repair", label: "Under Repair", icon: "medkit-outline" },
      { key: "enhance", label: "Enhance / Update", icon: "create-outline" },
      {
        key: "replace",
        label: "Time to Replace",
        icon: "swap-horizontal-outline",
      },
      {
        key: "warranty",
        label: "Warranty Claim",
        icon: "shield-checkmark-outline",
      },
      {
        key: "insurance",
        label: "Insurance Claim",
        icon: "document-text-outline",
      },
    ],
    []
  );

  const starterPackTemplates = useMemo(
    () =>
      Array.isArray(homeKsc)
        ? homeKsc.filter((t) => t?.starter_pack)
        : [],
    []
  );

  // Navigation helpers needed by listHeader
  const handleViewHomeStory = () => {
    if (!homeId) return;
    navigation.navigate("HomeStory", { homeId });
  };

  const openStarterPack = () => setStarterModalVisible(true);

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

  const listHeader = (
    <View>
      <View style={styles.overviewCard}>
        <View style={{ flex: 1 }}>
          <Text style={styles.overviewTitle}>Systems overview</Text>
          <Text style={styles.overviewBody}>
            Track each major system in your home, add service
            records, and see how everything comes together in your
            home's story.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.overviewButton}
          onPress={handleViewHomeStory}
        >
          <Ionicons
            name="book-outline"
            size={16}
            color={colors.accentBlue}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.overviewButtonText}>
            View home story
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.sectionHeaderRow}>
        <View>
          <Text style={styles.sectionLabel}>
            SYSTEMS FOR {homeLabel.toUpperCase()}
          </Text>
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
          onPress={() => {
            setAddSystemDraft("");
            setAddSystemModalVisible(true);
          }}
        >
          <Ionicons
            name="add-circle-outline"
            size={18}
            color={colors.brandWhite}
            style={{ marginRight: 8 }}
          />
          <Text style={styles.addSystemCtaText}>Add system</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.starterPackButton}
          onPress={openStarterPack}
        >
          <Ionicons
            name="sparkles-outline"
            size={16}
            color={colors.accentBlue}
            style={{ marginRight: 6 }}
          />
          <Text style={styles.starterPackText}>Starter pack</Text>
        </TouchableOpacity>
      </View>

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
          Use Starter pack to add the most common home systems, or add your own custom systems below.
        </Text>
      </View>
    );
  };


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

  const mergeFoundationAndHome = (foundationRows, homeRows) => {
    const bySystemId = {};
    (homeRows || []).forEach((h) => {
      if (h?.system_id) bySystemId[h.system_id] = h;
    });

    return (foundationRows || []).map((s) => {
      const ext = bySystemId[s.id];

      return {
        // canonical identity used across app (attachments, service_records, reporting)
        id: s.id,
        asset_id: s.asset_id,

        // foundation
        name: s.name,
        system_type: s.system_type || ext?.system_type || "general",
        status: s.status || ext?.status || "ok",
        source_type: s.source_type || "manual",
        ksc_code: s.ksc_code,
        metadata: s.metadata || {},

        // home extension
        home_row_id: ext?.id || null,
        location_hint: ext?.location_hint || null,
        tags: ext?.tags || [],
        // prefer foundation playbook, fall back to extension if older data lives there
        playbook: (s.playbook ?? ext?.playbook) || null,
      };
    });
  };

  const loadDraftModes = useCallback(
    async (systemsList) => {
      if (!homeId) return;

      try {
        // Build a lookup: home_systems row id -> canonical systems.id
        const homeRowToSystemId = {};
        (systemsList || []).forEach((s) => {
          if (s?.home_row_id) homeRowToSystemId[s.home_row_id] = s.id;
        });

        const { data, error } = await supabase
          .from(EVENT_INBOX_TABLE)
          .select(
            "id, system_id, home_system_id, status, context, created_at, title"
          )
          .eq("asset_id", homeId)
          .eq("status", "draft")
          // allow drafts tied by either system_id OR home_system_id
          .or("system_id.not.is.null,home_system_id.not.is.null")
          .order("created_at", { ascending: false });

        if (error) {
          console.error("HomeSystemsScreen: error loading draft modes", error);
          setDraftBySystemId({});
          return;
        }

        const map = {};
        (data || []).forEach((row) => {
          const canonicalSystemId =
            row.system_id ||
            (row.home_system_id
              ? homeRowToSystemId[row.home_system_id]
              : null);

          if (!canonicalSystemId) return;

          // keep the most recent draft per system (we ordered desc)
          if (!map[canonicalSystemId]) map[canonicalSystemId] = row;
        });

        setDraftBySystemId(map);
      } catch (err) {
        console.error(
          "HomeSystemsScreen: unexpected loadDraftModes error",
          err
        );
        setDraftBySystemId({});
      }
    },
    [homeId]
  );

  const loadSystems = useCallback(async () => {
    if (!homeId) return;

    setSystemsLoading(true);
    setLoadError(null);

    try {
      // 1) Foundation rows (canonical IDs)
      const { data: foundation, error: fErr } = await supabase
        .from(SYSTEMS_TABLE)
        .select(
          "id, asset_id, ksc_code, name, lod, status, metadata, system_type, source_type, playbook, created_at, updated_at"
        )
        .eq("asset_id", homeId)
        .order("name", { ascending: true });

      if (fErr) {
        console.error(
          "HomeSystemsScreen: error loading foundation systems",
          fErr
        );
        setLoadError("Could not load home systems.");
        setSystems([]);
        setSystemsLoading(false);
        return;
      }

      // 2) Home extension rows (by asset_id is simplest; FK already exists)
      const { data: homeExt, error: hErr } = await supabase
        .from(HOME_SYSTEMS_TABLE)
        .select(
          "id, asset_id, name, system_type, location_hint, status, tags, playbook, system_id"
        )
        .eq("asset_id", homeId);

      if (hErr) {
        console.error(
          "HomeSystemsScreen: error loading home extension systems",
          hErr
        );
        // still show foundation list
        const merged = mergeFoundationAndHome(foundation || [], []);
        setSystems(merged);
        await loadDraftModes(merged);
      } else {
        // merge
        const merged = mergeFoundationAndHome(foundation || [], homeExt || []);
        setSystems(merged);
        await loadDraftModes(merged);
      }
    } catch (err) {
      console.error("HomeSystemsScreen: unexpected loadSystems error", err);
      setLoadError("Could not load home systems.");
      setSystems([]);
    } finally {
      setSystemsLoading(false);
    }
  }, [homeId, loadDraftModes]);

  const loadServiceMeta = useCallback(async () => {
    if (!homeId) return;

    try {
      const { data, error } = await supabase
        .from("service_records")
        .select("id, system_id, performed_at")
        .eq("asset_id", homeId)
        .order("performed_at", { ascending: false });

      if (error) {
        console.error("HomeSystemsScreen: error loading service meta", error);
        setServiceMeta({});
        return;
      }

      const grouped = {};
      (data || []).forEach((row) => {
        if (!row.system_id) return;
        const existing = grouped[row.system_id];
        if (!existing)
          grouped[row.system_id] = { lastDate: row.performed_at, count: 1 };
        else existing.count += 1;
      });

      setServiceMeta(grouped);
    } catch (err) {
      console.error("HomeSystemsScreen: unexpected meta error", err);
      setServiceMeta({});
    }
  }, [homeId]);

  useFocusEffect(
    useCallback(() => {
      loadSystems();
      loadServiceMeta();
    }, [loadSystems, loadServiceMeta])
  );

  /* ----------------- NAV HELPERS (handleViewHomeStory moved before listHeader) ----------------- */

  const handleViewSystemStory = (system) => {
    if (!system?.id || !homeId) return;
    navigation.navigate("HomeSystemStory", {
      homeId,
      systemId: system.id, // canonical
      systemName: getDisplayName(system),
      homeName: homeLabel,
    });
  };

  const handleEditSystemEnrichment = (system) => {
    if (!system?.id || !homeId) return;
    navigation.navigate("EditSystemEnrichment", {
      assetId: homeId,
      assetName: homeLabel,
      assetType: "home",
      systemId: system.id,
      systemName: getDisplayName(system),
      systemKey: system.id,
    });
  };


  const handleOpenSystemAttachments = (system) => {
    if (!system?.id) return;
    navigation.navigate("AssetAttachments", {
      assetId: homeId,
      assetName: homeLabel,
      targetType: "system",
      targetId: system.id,
      targetRole: "other",
    });
  };

  const handleAddServiceForSystem = (system) => {
    if (!system?.id || !homeId) return;

    navigation.navigate("AddTimelineRecord", {
      source: "homeSystem",
      assetId: homeId,
      assetName: homeLabel,
      systemId: system.id,
      systemName: getDisplayName(system),
      defaultCategory: "service",
      defaultTitle: getDisplayName(system)
        ? `${getDisplayName(system)} service`
        : "Service",
    });
  };

  /* ----------------- SHARED CONFIRM (WEB) ----------------- */

  const confirmWeb = (title, message) => {
    if (!IS_WEB) return false;
    if (typeof window === "undefined") return false;
    return window.confirm(`${title}\n\n${message}`);
  };

  /* ----------------- CREATE SYSTEM (FOUNDATION + EXTENSION) ----------------- */

  const createHomeSystem = async ({
    name,
    system_type,
    location_hint,
    source_type,
  }) => {
    if (!homeId) throw new Error("Missing homeId");
    const sysName = String(name || "").trim();
    const sysType =
      String(system_type || "general").trim() || "general";
    const src = String(source_type || "manual");

    // 1) foundation insert (NO location_hint)
    const foundationPayload = {
      asset_id: homeId,
      name: sysName,
      system_type: sysType,
      ksc_code: sysType || "general", // systems.ksc_code is NOT NULL
      source_type: src,
      status: "ok",
      metadata: {},
    };

    const { data: foundationRow, error: fErr } = await supabase
      .from(SYSTEMS_TABLE)
      .insert(foundationPayload)
      .select(
        "id, asset_id, ksc_code, name, lod, status, metadata, system_type, source_type, playbook, created_at, updated_at"
      )
      .single();

    if (fErr) throw fErr;

    // 2) home extension insert
    const homePayload = {
      asset_id: homeId,
      system_id: foundationRow.id,
      name: sysName,
      system_type: sysType,
      location_hint: location_hint || null,
      status: "healthy",
    };

    const { data: homeRow, error: hErr } = await supabase
      .from(HOME_SYSTEMS_TABLE)
      .insert(homePayload)
      .select(
        "id, system_id, location_hint, status, tags, playbook"
      )
      .single();

    if (hErr) {
      // rollback foundation so we don't create orphan systems rows
      await supabase.from(SYSTEMS_TABLE).delete().eq("id", foundationRow.id);
      throw hErr;
    }

    return {
      id: foundationRow.id,
      asset_id: foundationRow.asset_id,
      name: foundationRow.name,
      system_type: foundationRow.system_type || sysType,
      status: foundationRow.status || "ok",
      source_type: foundationRow.source_type || src,
      ksc_code: foundationRow.ksc_code,
      metadata: foundationRow.metadata || {},
      home_row_id: homeRow.id,
      location_hint: homeRow.location_hint || null,
      tags: homeRow.tags || [],
      playbook: foundationRow.playbook || homeRow.playbook || null,
    };
  };

  const handleCreateSystem = async () => {
    const trimmed = (newSystemName || "").trim();
    if (!trimmed || !homeId || creatingSystem) return;

    const exists = systems.some(
      (s) =>
        String(s.name || "")
          .trim()
          .toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      Alert.alert("Already added", "That system is already on your list.");
      return;
    }

    setCreatingSystem(true);

    try {
      const mergedRow = await createHomeSystem({
        name: trimmed,
        system_type: "general",
        location_hint: null,
        source_type: "manual",
      });

      setSystems((prev) =>
        [...prev, mergedRow].sort((a, b) =>
          String(a.name).localeCompare(String(b.name))
        )
      );
      setNewSystemName("");
      Keyboard.dismiss();
    } catch (error) {
      console.error(
        "HomeSystemsScreen: error creating system",
        error
      );
      const msg = String(error?.message || "");
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
    if (!trimmed || !homeId || creatingSystem) return;

    const exists = systems.some(
      (s) =>
        String(getDisplayName(s) || s.name || "")
          .trim()
          .toLowerCase() === trimmed.toLowerCase()
    );
    if (exists) {
      Alert.alert("Already added", "That system is already on your list.");
      return;
    }

    setCreatingSystem(true);
    try {
      const mergedRow = await createHomeSystem({
        name: trimmed,
        system_type: "general",
        location_hint: null,
        source_type: "manual",
      });

      setSystems((prev) =>
        [...prev, mergedRow].sort((a, b) =>
          String(getDisplayName(a) || a.name).localeCompare(
            String(getDisplayName(b) || b.name)
          )
        )
      );

      closeAddSystemModal();
      Keyboard.dismiss();
    } catch (error) {
      console.error("HomeSystemsScreen: error creating system", error);
      const msg = String(error?.message || "");
      if (msg.includes(PLAN_LIMIT_TRIGGER)) {
        showWebSafeAlert(
          "Plan limit reached",
          "Starter allows up to 5 systems per asset. Upgrade to add more systems."
        );
      } else {
        showWebSafeAlert("Could not add system", "Please try again.");
      }
    } finally {
      setCreatingSystem(false);
    }
  };


  /* ----------------- DELETE SYSTEM (EXTENSION FIRST, THEN FOUNDATION) ----------------- */

  const handleDeleteSystem = (system) => {
    if (!system?.id) return;

    const title = "Delete this system?";
    const msg =
      "This will not delete existing service records, but you will no longer see this system in your list.";

    const doDelete = async () => {
      try {
        // delete extension row first (if present)
        await supabase
          .from(HOME_SYSTEMS_TABLE)
          .delete()
          .eq("system_id", system.id);

        // then delete foundation row
        const { error } = await supabase
          .from(SYSTEMS_TABLE)
          .delete()
          .eq("id", system.id);

        if (error) {
          console.error(
            "HomeSystemsScreen: delete foundation error",
            error
          );
          Alert.alert(
            "Could not delete",
            "There was a problem deleting this system."
          );
          return;
        }

        setSystems((prev) => prev.filter((s) => s.id !== system.id));
      } catch (err) {
        console.error(
          "HomeSystemsScreen: unexpected delete error",
          err
        );
        Alert.alert(
          "Could not delete",
          "Unexpected error deleting this system."
        );
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

  /* ----------------- STARTER PACK (FOUNDATION + EXTENSION) ----------------- */

  const closeStarterPack = () => {
    setStarterModalVisible(false);
    setAddingTemplateId(null);
  };

  const isTemplateAlreadyAdded = (tpl) => {
    const name = String(tpl?.name || "").trim().toLowerCase();
    if (!name) return false;
    return systems.some(
      (s) =>
        String(s.name || "")
          .trim()
          .toLowerCase() === name
    );
  };

  const handleAddTemplateSystem = async (template) => {
    if (!homeId || !template) return;

    if (isTemplateAlreadyAdded(template)) {
      showWebSafeAlert("Already added", "That system is already on your list.");
      return;
    }

    setAddingTemplateId(template.name);

    try {
      const mergedRow = await createHomeSystem({
        name: template.name,
        system_type: template.system_type || "general",
        location_hint: template.location_hint || null,
        source_type: "starter_pack",
      });

      setSystems((prev) =>
        [...prev, mergedRow].sort((a, b) =>
          String(a.name).localeCompare(String(b.name))
        )
      );
    } catch (error) {
      console.error(
        "HomeSystemsScreen: error creating system from template",
        error
      );
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
    } finally {
      setAddingTemplateId(null);
    }
  };

  /* ----------------- PLAYBOOK (SAVE ON FOUNDATION; MIRROR TO EXTENSION BEST-EFFORT) ----------------- */

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

  const handleSavePlaybook = async () => {
    if (!activePlaybookSystem?.id) return;
    if (savingPlaybook) return;

    const nextPlaybook = (playbookDraft || "").trim();
    setSavingPlaybook(true);

    try {
      // 1) update foundation (canonical)
      const { data: sysRow, error } = await supabase
        .from(SYSTEMS_TABLE)
        .update({ playbook: nextPlaybook || null })
        .eq("id", activePlaybookSystem.id)
        .select(
          "id, asset_id, ksc_code, name, lod, status, metadata, system_type, source_type, playbook, created_at, updated_at"
        )
        .single();

      if (error) {
        console.error("HomeSystemsScreen: playbook save error", error);
        Alert.alert(
          "Could not save playbook",
          "There was a problem saving this playbook."
        );
        return;
      }

      // 2) best-effort mirror into home extension (keeps legacy reads happy)
      await supabase
        .from(HOME_SYSTEMS_TABLE)
        .update({ playbook: nextPlaybook || null })
        .eq("system_id", activePlaybookSystem.id);

      // 3) update local list
      if (sysRow) {
        setSystems((prev) =>
          prev
            .map((s) =>
              s.id === sysRow.id
                ? { ...s, playbook: sysRow.playbook }
                : s
            )
            .sort((a, b) =>
              String(a.name).localeCompare(String(b.name))
            )
        );
        setActivePlaybookSystem((prev) =>
          prev ? { ...prev, playbook: sysRow.playbook } : prev
        );
      }

      closePlaybook(true);
    } catch (err) {
      console.error(
        "HomeSystemsScreen: unexpected playbook save error",
        err
      );
      Alert.alert(
        "Could not save playbook",
        "Unexpected error while saving this playbook."
      );
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

  // WEB print bug fix: use a clean doc skeleton + timeout before print
  const handlePrintPlaybook = () => {
    const text = (playbookDraft || "").trim();
    if (!text) return;
    if (!IS_WEB) return;

    if (typeof window !== "undefined") {
      const title = `Playbook for ${
        activePlaybookSystem?.name || "system"
      }`;
      const safeTitle = String(title)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
      const safeBody = text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\n/g, "<br/>");

      const popup = window.open("", "_blank", "noopener,noreferrer");
      if (!popup) return;

      popup.document.open();
      popup.document.write(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px; }
      h2 { margin: 0 0 12px 0; }
      .box { white-space: normal; line-height: 1.4; font-size: 14px; }
    </style>
  </head>
  <body>
    <h2>${safeTitle}</h2>
    <div class="box">${safeBody}</div>
  </body>
</html>`);
      popup.document.close();

      popup.focus();
      setTimeout(() => {
        try {
          popup.print();
        } catch (e) {
          console.warn("Print failed", e);
        }
      }, 200);
    }
  };

  /* ----------------- RENAME (title / display name) ----------------- */

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
      const currentMeta =
        sys.metadata && typeof sys.metadata === "object"
          ? { ...sys.metadata }
          : {};
      if (trimmed) currentMeta.display_name = trimmed;
      else delete currentMeta.display_name;

      const { data, error } = await supabase
        .from(SYSTEMS_TABLE)
        .update({ metadata: currentMeta })
        .eq("id", sys.id)
        .select(
          "id, asset_id, ksc_code, name, lod, status, metadata, system_type, source_type, playbook, created_at, updated_at"
        )
        .single();

      if (error) throw error;

      // best-effort mirror into home_systems.name to keep things visually aligned in other contexts
      try {
        await supabase
          .from(HOME_SYSTEMS_TABLE)
          .update({ name: trimmed || sys.name })
          .eq("system_id", sys.id);
      } catch (e) {
        console.warn(
          "HomeSystemsScreen: could not mirror rename into home_systems",
          e
        );
      }

      if (data) {
        setSystems((prev) =>
          prev.map((s) =>
            s.id === data.id
              ? { ...s, name: data.name, metadata: data.metadata }
              : s
          )
        );
      }

      closeRename();
    } catch (e) {
      console.error(
        "HomeSystemsScreen: error renaming system",
        e
      );
      Alert.alert(
        "Could not update title",
        e?.message || "Please try again."
      );
    } finally {
      setSavingRename(false);
    }
  };

  /* ----------------- MODE -> EVENT INBOX ----------------- */

  const openMode = (system) => {
    setModeTargetSystem(system);
    setModeModalVisible(true);
  };

  const closeMode = (force = false) => {
    if (creatingEvent && !force) return;
    setModeModalVisible(false);
    setModeTargetSystem(null);
  };

  const clearDraftForSystem = async () => {
    if (!homeId) return;
    if (!modeTargetSystem?.id) return;
    if (creatingEvent) return;

    const existing = draftBySystemId[modeTargetSystem.id];
    if (!existing?.id) {
      // already "Good to Go"
      closeMode(true);
      return;
    }

    const title = "Clear this draft?";
    const msg =
      "This will remove the draft event and set this system back to Good to Go.";

    const doClear = async () => {
      setCreatingEvent(true);
      try {
        const { error } = await supabase
          .from(EVENT_INBOX_TABLE)
          .delete()
          .eq("id", existing.id)
          .eq("status", "draft");

        if (error) throw error;

        await loadDraftModes(systems);
        closeMode(true);
      } catch (e) {
        console.error(
          "HomeSystemsScreen: clearDraftForSystem error",
          e
        );
        Alert.alert(
          "Could not clear draft",
          e?.message || "Please try again."
        );
      } finally {
        setCreatingEvent(false);
      }
    };

    if (IS_WEB) {
      const ok = confirmWeb(title, msg);
      if (ok) doClear();
      return;
    }

    Alert.alert(title, msg, [
      { text: "Cancel", style: "cancel" },
      { text: "Clear", style: "destructive", onPress: doClear },
    ]);
  };

  const createOrOpenDraftEventForMode = (mode) => {
    if (!homeId) return;
    if (!modeTargetSystem?.id) return;
    if (!mode?.key) return;

    const sys = modeTargetSystem;
    const sysName = getDisplayName(sys);

    // If we already have a draft for this system, reuse it.
    const existingDraft = draftBySystemId[sys.id] || null;

    // Shared prefill contract for CreateEventScreen
    const basePrefill = {
      assetId: homeId,
      systemId: sys.id,
      homeSystemId: sys.home_row_id || null,
      modeKey: mode.key,
      modeLabel: mode.label,
      source: "home_system_mode",
      title: `${mode.label}: ${sysName}`,
    };

    // Close the mode modal so the UX feels snappy
    closeMode(true);

    if (existingDraft?.id) {
      // Open existing draft with updated intent in prefill
      navigation.navigate("CreateEvent", {
        eventId: existingDraft.id,
        prefill: basePrefill,
      });
    } else {
      // No draft yet → let CreateEvent create the event on Save
      navigation.navigate("CreateEvent", {
        prefill: basePrefill,
      });
    }
  };

  /* ----------------- RENDER ----------------- */

  const renderSystemItem = ({ item: system }) => {
    const meta = serviceMeta[system.id];
    const hasRecords = !!meta;

    const countLabel = !meta
      ? "No records"
      : meta.count === 1
      ? "1 record"
      : `${meta.count} records`;
    const lastService = meta?.lastDate
      ? formatDateUS(meta.lastDate)
      : null;
    const hasPlaybook = !!system.playbook;
    const draftEvent = draftBySystemId[system.id] || null;
    const modeLabel = draftEvent ? getModeLabelFromEvent(draftEvent) : null;
    const modeButtonLabel = modeLabel || "Good to Go";

    return (
      
      <View style={styles.systemCard}>
        <View style={styles.systemHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.systemName}>
              {getDisplayName(system)}
            </Text>
            {!!system.location_hint && (
              <Text style={styles.systemLocation}>
                {system.location_hint}
              </Text>
            )}
          </View>

          <View style={styles.systemHeaderActions}>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => handleEditSystemEnrichment(system)}
            >
              <Ionicons
                name="create-outline"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => openRename(system)}
            >
              <Ionicons
                name="text-outline"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => handleOpenSystemAttachments(system)}
            >
              <Ionicons
                name="attach-outline"
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.iconButton}
              onPress={() => handleDeleteSystem(system)}
            >
              <Ionicons
                name="trash-outline"
                size={16}
                color="#B91C1C"
              />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.systemMetaRow}>
          <Text style={styles.systemMetaLabel}>Status: </Text>
          <Text style={styles.systemMetaValue}>
            {system.status || "ok"}
          </Text>
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
            style={[
              styles.chipButton,
              hasPlaybook && styles.chipButtonPlaybookFilled,
            ]}
            onPress={() => openPlaybook(system)}
          >
            <Ionicons
              name={
                hasPlaybook
                  ? "document-text"
                  : "document-text-outline"
              }
              size={14}
              color={
                hasPlaybook
                  ? colors.brandWhite
                  : colors.accentBlue
              }
              style={{ marginRight: 4 }}
            />
            <Text
              style={[
                styles.chipButtonText,
                hasPlaybook &&
                  styles.chipButtonPlaybookTextFilled,
              ]}
            >
              Playbook
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.chipButton}
            onPress={() => openMode(system)}
          >
            <Ionicons
              name={
                modeLabel
                  ? "alert-circle-outline"
                  : "checkmark-circle-outline"
              }
              size={14}
              color={colors.accentBlue}
              style={{ marginRight: 4 }}
            />
            <Text style={styles.chipButtonText}>
              {modeButtonLabel}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.chipButton}
            onPress={() => handleAddServiceForSystem(system)}
          >
            <Ionicons
              name="construct-outline"
              size={14}
              color={colors.accentBlue}
              style={{ marginRight: 4 }}
            />
            <Text style={styles.chipButtonText}>Add service</Text>
          </TouchableOpacity>
                    <TouchableOpacity
            style={styles.chipButton}
            onPress={() => handleViewSystemStory(system)}
          >
            <Ionicons
              name="book-outline"
              size={14}
              color={colors.accentBlue}
              style={{ marginRight: 4 }}
            />
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
            <Ionicons
              name="chevron-back"
              size={22}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>{homeLabel}</Text>
            <Text style={styles.screenSubtitle}>
              Systems and subsystems that keep {homeLabel} running.
            </Text>
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
                Track each major system in your home, add service
                records, and see how everything comes together in your
                home's story.
              </Text>
            </View>

            <TouchableOpacity
              style={styles.overviewButton}
              onPress={handleViewHomeStory}
            >
              <Ionicons
                name="book-outline"
                size={16}
                color={colors.accentBlue}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.overviewButtonText}>
                View home story
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionLabel}>
                SYSTEMS FOR {homeLabel.toUpperCase()}
              </Text>
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
              onPress={() => {
                setAddSystemDraft("");
                setAddSystemModalVisible(true);
              }}
            >
              <Ionicons
                name="add-circle-outline"
                size={18}
                color={colors.brandWhite}
                style={{ marginRight: 8 }}
              />
              <Text style={styles.addSystemCtaText}>Add system</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.starterPackButton}
              onPress={openStarterPack}
            >
              <Ionicons
                name="sparkles-outline"
                size={16}
                color={colors.accentBlue}
                style={{ marginRight: 6 }}
              />
              <Text style={styles.starterPackText}>Starter pack</Text>
            </TouchableOpacity>
          </View>

          {systemsLoading && !filteredSystems.length ? (
            <View style={styles.centered}>
              <ActivityIndicator size="small" />
              <Text style={styles.loadingText}>
                Loading systems…
              </Text>
            </View>
          ) : loadError ? (
            <View style={styles.centered}>
              <Text style={styles.errorText}>{loadError}</Text>
            </View>
          ) : !filteredSystems.length ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No systems yet</Text>
              <Text style={styles.emptyBody}>
                Use Starter pack to add the most common home systems, or
                add your own custom systems below.
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredSystems}
              keyExtractor={(item) => item.id}
              renderItem={renderSystemItem}
              scrollEnabled={false}
              ItemSeparatorComponent={() => (
                <View style={{ height: spacing.sm }} />
              )}
              contentContainerStyle={{
                paddingTop: spacing.sm,
              }}
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
            <Pressable style={[styles.modalCard, { maxWidth: 420 }]} onPress={() => {}}>
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
                placeholder="System name (e.g., Furnace, Generator)"
                style={styles.modalInput}
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
                  style={[styles.modalActionBtn, styles.modalActionBtnPrimary, (!addSystemDraft.trim() || creatingSystem) && { opacity: 0.6 }]}
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

        {/* Starter pack modal */}
        <Modal
          visible={starterModalVisible}
          transparent
          animationType="fade"
          onRequestClose={closeStarterPack}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>
                  Starter pack systems
                </Text>

                <TouchableOpacity
                  onPress={closeStarterPack}
                  hitSlop={{
                    top: 8,
                    bottom: 8,
                    left: 8,
                    right: 8,
                  }}
                >
                  <Ionicons
                    name="close-outline"
                    size={22}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingBottom: spacing.md,
                }}
              >
                <Text style={styles.modalSectionLabel}>
                  Core systems
                </Text>

                {starterPackTemplates.map((tpl) => {
                  const isAdded = isTemplateAlreadyAdded(tpl);

                  return (
                    <View
                      key={tpl.name}
                      style={styles.templateRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.templateName}>
                          {tpl.name}
                        </Text>
                        {!!tpl.location_hint && (
                          <Text style={styles.templateHint}>
                            {tpl.location_hint}
                          </Text>
                        )}
                      </View>

                      <TouchableOpacity
                        style={[
                          styles.templateButton,
                          isAdded &&
                            styles.templateButtonDisabled,
                        ]}
                        disabled={
                          isAdded ||
                          addingTemplateId === tpl.name
                        }
                        onPress={() =>
                          handleAddTemplateSystem(tpl)
                        }
                      >
                        {addingTemplateId === tpl.name ? (
                          <ActivityIndicator
                            size="small"
                            color="#fff"
                          />
                        ) : (
                          <Text
                            style={[
                              styles.templateButtonText,
                              isAdded && {
                                color: colors.textMuted,
                              },
                            ]}
                          >
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
        <Modal
          visible={renameModalVisible}
          transparent
          animationType="fade"
          onRequestClose={closeRename}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={closeRename}
          >
            <Pressable
              style={styles.modalCard}
              onPress={() => {}}
            >
              <Text style={styles.modalTitle}>Edit title</Text>
              <Text style={styles.modalSubtitle}>
                This updates how the system is shown in Keepr.
              </Text>

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
                <TouchableOpacity
                  style={[
                    styles.modalActionBtn,
                    styles.modalActionBtnGhost,
                  ]}
                  onPress={closeRename}
                  disabled={savingRename}
                >
                  <Text style={styles.modalActionTextGhost}>
                    Cancel
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalActionBtn,
                    styles.modalActionBtnPrimary,
                  ]}
                  onPress={saveRename}
                  disabled={savingRename}
                >
                  <Text style={styles.modalActionTextPrimary}>
                    {savingRename ? "Saving..." : "Save"}
                  </Text>
                </TouchableOpacity>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        {/* Mode modal */}
        <Modal
          visible={modeModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => closeMode(true)}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => closeMode(true)}
          >
            <Pressable
              style={[styles.modalCard, { maxWidth: 460 }]}
              onPress={() => {}}
            >
              <View style={styles.modalHeaderRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>
                    Create an event
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    Pick a mode to start an Inbox Event for{" "}
                    <Text
                      style={{
                        fontWeight: "700",
                        color: colors.textPrimary,
                      }}
                    >
                      {modeTargetSystem
                        ? getDisplayName(modeTargetSystem)
                        : "this system"}
                    </Text>
                    . Add proof, then promote it to the
                    timeline.
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => closeMode(true)}
                  hitSlop={{
                    top: 8,
                    bottom: 8,
                    left: 8,
                    right: 8,
                  }}
                  disabled={creatingEvent}
                >
                  <Ionicons
                    name="close-outline"
                    size={22}
                    color={colors.textMuted}
                  />
                </TouchableOpacity>
              </View>

              <View style={{ marginTop: spacing.sm }}>
                <TouchableOpacity
                  style={styles.modeRow}
                  onPress={clearDraftForSystem}
                  disabled={creatingEvent}
                >
                  <View style={styles.modeIcon}>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={18}
                      color={colors.accentBlue}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modeTitle}>
                      Good to Go
                    </Text>
                    <Text style={styles.modeHint}>
                      Clears any draft event and returns this
                      system to the default state.
                    </Text>
                  </View>

                  {creatingEvent ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={colors.textMuted}
                    />
                  )}
                </TouchableOpacity>

                {MODES.map((m) => (
                  <TouchableOpacity
                    key={m.key}
                    style={styles.modeRow}
                    onPress={() =>
                      createOrOpenDraftEventForMode(m)
                    }
                    disabled={creatingEvent}
                  >
                    <View style={styles.modeIcon}>
                      <Ionicons
                        name={m.icon}
                        size={18}
                        color={colors.accentBlue}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.modeTitle}>
                        {m.label}
                      </Text>
                      <Text style={styles.modeHint}>
                        Creates a draft Inbox Event you can add
                        proof to.
                      </Text>
                    </View>

                    {creatingEvent ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={colors.textMuted}
                      />
                    )}
                  </TouchableOpacity>
                ))}
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
              <View
                style={[
                  styles.modalCard,
                  styles.playbookModalCardWeb,
                ]}
              >
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>
                    Playbook for{" "}
                    {activePlaybookSystem?.name || "system"}
                  </Text>

                  <TouchableOpacity
                    onPress={() => closePlaybook(true)}
                    hitSlop={{
                      top: 8,
                      bottom: 8,
                      left: 8,
                      right: 8,
                    }}
                    disabled={savingPlaybook}
                  >
                    <Ionicons
                      name="close-outline"
                      size={22}
                      color={colors.textMuted}
                    />
                  </TouchableOpacity>
                </View>

                <View style={styles.playbookBodyWeb}>
                  <Text style={styles.playbookHintText}>
                    Paste your playbook here, or jot down steps
                    like:
                    {"\n\n"}1. Annual inspection steps{"\n"}2.
                    Seasonal checks{"\n"}3. Things to watch for or
                    replace
                  </Text>

                  <TextInput
                    style={[
                      styles.playbookInput,
                      styles.playbookInputWeb,
                    ]}
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
                        style={[
                          styles.playbookButton,
                          styles.playbookDelete,
                        ]}
                        onPress={handleDeletePlaybook}
                        disabled={savingPlaybook}
                      >
                        <Text
                          style={styles.playbookDeleteText}
                        >
                          Delete
                        </Text>
                      </TouchableOpacity>
                    )}

                    {playbookDraft.trim().length > 0 && (
                      <TouchableOpacity
                        style={[
                          styles.playbookButton,
                          styles.playbookPrint,
                        ]}
                        onPress={handlePrintPlaybook}
                        disabled={savingPlaybook}
                      >
                        <Text
                          style={styles.playbookPrintText}
                        >
                          Print
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  <TouchableOpacity
                    style={[
                      styles.playbookButton,
                      styles.playbookSave,
                    ]}
                    onPress={handleSavePlaybook}
                    disabled={savingPlaybook}
                  >
                    {savingPlaybook ? (
                      <ActivityIndicator
                        size="small"
                        color="#fff"
                      />
                    ) : (
                      <Text style={styles.playbookSaveText}>
                        Save
                      </Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ) : (
            <Pressable
              style={styles.modalBackdrop}
              onPress={Keyboard.dismiss}
            >
              <KeyboardAvoidingView
                behavior={
                  Platform.OS === "ios" ? "padding" : "height"
                }
                style={{ width: "100%", alignItems: "center" }}
                keyboardVerticalOffset={
                  Platform.OS === "ios" ? 48 : 0
                }
              >
                <Pressable
                  onPress={() => {}}
                  style={[styles.modalCard, { maxWidth: 420 }]}
                >
                  <View style={styles.modalHeaderRow}>
                    <Text style={styles.modalTitle}>
                      Playbook for{" "}
                      {activePlaybookSystem?.name || "system"}
                    </Text>

                    <TouchableOpacity
                      onPress={() => closePlaybook(true)}
                      hitSlop={{
                        top: 8,
                        bottom: 8,
                        left: 8,
                        right: 8,
                      }}
                      disabled={savingPlaybook}
                    >
                      <Ionicons
                        name="close-outline"
                        size={22}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    style={{ flexGrow: 0 }}
                    contentContainerStyle={{
                      paddingBottom: spacing.md,
                    }}
                    keyboardShouldPersistTaps="always"
                    showsVerticalScrollIndicator={false}
                  >
                    <Text style={styles.playbookHintText}>
                      Paste your playbook here, or jot down steps
                      like:
                      {"\n\n"}1. Annual inspection steps{"\n"}2.
                      Seasonal checks{"\n"}3. Things to watch for
                      or replace
                    </Text>

                    <TextInput
                      style={[
                        styles.playbookInput,
                        { height: playbookInputHeight },
                      ]}
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
                        const nextHeight =
                          e.nativeEvent.contentSize.height;
                        const clamped = Math.max(
                          minHeight,
                          Math.min(maxHeight, nextHeight)
                        );
                        setPlaybookInputHeight(clamped);
                      }}
                    />
                  </ScrollView>

                  <View style={styles.playbookActionsRow}>
                    <View style={styles.playbookLeftActions}>
                      {!!activePlaybookSystem?.playbook && (
                        <TouchableOpacity
                          style={[
                            styles.playbookButton,
                            styles.playbookDelete,
                          ]}
                          onPress={handleDeletePlaybook}
                          disabled={savingPlaybook}
                        >
                          <Text
                            style={styles.playbookDeleteText}
                          >
                            Delete
                          </Text>
                        </TouchableOpacity>
                      )}
                    </View>

                    <TouchableOpacity
                      style={[
                        styles.playbookButton,
                        styles.playbookSave,
                      ]}
                      onPress={handleSavePlaybook}
                      disabled={savingPlaybook}
                    >
                      {savingPlaybook ? (
                        <ActivityIndicator
                          size="small"
                          color="#fff"
                        />
                      ) : (
                        <Text style={styles.playbookSaveText}>
                          Save
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </Pressable>
              </KeyboardAvoidingView>
            </Pressable>
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

export default HomeSystemsScreen;

/* ---- STYLES ---- */

const styles = StyleSheet.create({
contentWrap: {
  width: "100%",
  maxWidth: CONTENT_MAX_WIDTH,
  alignSelf: "center",
},

  screen: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  scrollContent: {
    paddingBottom: spacing.xl,
  },
  listContent: { paddingBottom: spacing.xl, paddingTop: 0 },
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
    alignItems: "center",
    marginBottom: spacing.xs,
  },
  systemName: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  systemLocation: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
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
    flexWrap: "wrap",
    gap: spacing.xs,
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
    backgroundColor:
      colors.chipBackground || colors.surfaceSubtle,
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
  // WEB: column layout, input flex
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
  // rename modal styles
  modalSubtitle: {
    marginTop: 6,
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
  },
  modalInput: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.textPrimary,
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
    borderColor: colors.borderSubtle,
  },
  modalActionBtnPrimary: {
    backgroundColor: colors.accentBlue,
  },
  modalActionTextGhost: {
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  modalActionTextPrimary: {
    fontSize: 14,
    fontWeight: "600",
    color: "#fff",
  },
  // mode modal rows
  modeRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surface,
  },
  modeIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  modeTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  modeHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
});
