import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import KeeprDateField from "../components/KeeprDateField";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  activateKeeprSpacePlaybook,
  deactivateKeeprSpacePlaybook,
  deleteKeeprSpacePlaybook,
  getKeeprSpaceOrgConfig,
  getKeeprSpacePortfolio,
  listKeeprSpacePlaybooks,
  upsertKeeprSpacePlaybook,
} from "../lib/keeprspaceApi";
import { fetchAssetHeroUris, getCachedAssetHeroUris } from "../lib/assetHeroResolver";
import { assetProjectionSemantics } from "../lib/assetProjectionSemantics";
import { supabase } from "../lib/supabaseClient";
import { colors, radius, shadows, spacing } from "../styles/theme";

const DEFAULT_RESPONSIBLE_OPTIONS = ["Owner", "Service Provider", "Service Team"];
const PLAYBOOK_HERO_OPTIONS = {
  transform: { width: 720, quality: 80 },
  expiresIn: 60 * 60 * 24,
};

function workspaceDisplayName(workspace, config) {
  return (
    config?.profile?.display_name ||
    workspace?.display_name ||
    workspace?.name ||
    workspace?.label ||
    "KeeprSpace"
  );
}

function workspaceServiceTeamName(workspaceName) {
  const name = String(workspaceName || "").trim();
  return name ? `${name} Service` : "Service Team";
}

function compact(parts, separator = " • ") {
  return parts.filter(Boolean).join(separator);
}

function assetName(boat) {
  const identity = boat?.identity || {};
  const title = compact([
    identity.year || boat?.year,
    identity.make || boat?.make,
    identity.model || boat?.model,
  ]);
  return boat?.asset_name || boat?.name || title || boat?.kac_id || "Connected boat";
}

function assetSubtitle(boat) {
  const identity = boat?.identity || {};
  return compact([
    identity.year || boat?.year,
    identity.make || boat?.make,
    identity.model || boat?.model,
    boat?.kac_id,
  ]);
}

function assetIdForBoat(boat) {
  return boat?.asset_id || boat?.id || boat?.asset?.id || null;
}

function assetKac(boat, route) {
  return boat?.kac_id || boat?.kac || boat?.asset?.kac_id || route?.params?.kac || null;
}

function assetHeroUrl(boat) {
  const asset = boat?.asset || {};
  const media = boat?.media || {};
  return (
    boat?.hero_url ||
    boat?.heroUrl ||
    boat?.image_url ||
    boat?.imageUrl ||
    boat?.primary_image_url ||
    boat?.primaryImageUrl ||
    asset?.hero_url ||
    asset?.heroUrl ||
    asset?.image_url ||
    asset?.imageUrl ||
    asset?.primary_image_url ||
    asset?.primaryImageUrl ||
    media?.hero_url ||
    media?.heroUrl ||
    media?.image_url ||
    media?.imageUrl ||
    null
  );
}

function normalizeStep(step = {}, index = 0) {
  const metadata = step.metadata || {};
  return {
    localId: step.id || step.localId || `step-${Date.now()}-${index}`,
    id: step.id || null,
    position: step.position || index + 1,
    title: step.title || "",
    step_type: step.step_type || "action",
    service_offering_id: step.service_offering_id || null,
    responsible_party: step.responsible_party || "",
    due_date: step.due_date || "",
    due_time: step.due_time || metadata.due_time || "",
    status: step.status || "planned",
    action_id: step.action_id || null,
    metadata,
  };
}

function isTemplatePlaybook(playbook) {
  const metadata = playbook?.metadata || {};
  return Boolean(
    metadata.is_template ||
      metadata.template === true ||
      metadata.playbook_kind === "template" ||
      playbook?.created_by_type === "template"
  );
}

function cloneTemplateStep(step = {}, index = 0) {
  const cloned = normalizeStep(step, index);
  return {
    ...cloned,
    localId: `template-step-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    id: null,
    action_id: null,
    status: "planned",
    metadata: {
      ...(cloned.metadata || {}),
      cloned_from_step_id: step.id || step.localId || null,
    },
  };
}

function normalizeTime(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return raw;
  const hour = Math.max(0, Math.min(23, Number(match[1])));
  const minute = Math.max(0, Math.min(59, Number(match[2])));
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function TimeField({ value, onChange, disabled }) {
  const [localValue, setLocalValue] = useState(value || "");

  useEffect(() => {
    setLocalValue(value || "");
  }, [value]);

  if (Platform.OS === "web") {
    return (
      <input
        type="time"
        value={value || ""}
        disabled={disabled}
        onChange={(event) => onChange?.(event?.target?.value || "")}
        style={{
          height: 42,
          borderRadius: 10,
          border: "1px solid #D1D5DB",
          background: disabled ? "#F3F4F6" : "#F8FAFC",
          padding: "0 12px",
          color: "#111827",
          fontWeight: 800,
          minWidth: 116,
        }}
      />
    );
  }

  return (
    <TextInput
      value={localValue}
      editable={!disabled}
      onChangeText={setLocalValue}
      onBlur={() => onChange?.(normalizeTime(localValue))}
      placeholder="HH:MM"
      placeholderTextColor={colors.textMuted}
      keyboardType="numbers-and-punctuation"
      autoCapitalize="none"
      autoCorrect={false}
      style={[styles.timeInput, disabled && styles.timeInputDisabled]}
    />
  );
}

function PlaybookConfirmationModal({ confirmation, onCancel }) {
  if (!confirmation) return null;

  const confirm = () => {
    const action = confirmation.onConfirm;
    onCancel?.();
    action?.();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.confirmBackdrop}>
        <View style={styles.confirmCard}>
          <Text style={styles.confirmTitle}>{confirmation.title}</Text>
          <Text style={styles.confirmMessage}>{confirmation.message}</Text>
          <View style={styles.confirmActions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={onCancel}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={confirmation.destructive ? styles.secondaryDangerButton : styles.primaryButton}
              onPress={confirm}
            >
              <Text style={confirmation.destructive ? styles.dangerButtonText : styles.primaryButtonText}>
                {confirmation.confirmLabel || "Confirm"}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function buildServiceLabel(service) {
  return service?.owner_facing_label || service?.name || "Service";
}

function playbookProgress(playbook) {
  const steps = Array.isArray(playbook?.steps) ? playbook.steps : [];
  const total = steps.length;
  if (!total) return "No steps yet";
  const done = steps.filter((step) => isStepComplete(step)).length;
  const activated = steps.filter((step) => step.status === "activated" || step.action_id).length;
  return `${done} complete · ${activated} activated · ${total} steps`;
}

function isStepComplete(step) {
  const stepStatus = String(step?.status || "").toLowerCase();
  const actionStatus = String(step?.metadata?.action_status || "").toLowerCase();
  return stepStatus === "complete" || actionStatus === "completed" || actionStatus === "complete";
}

function isActivePlaybook(playbook) {
  return ["active", "activated", "in_progress"].includes(String(playbook?.status || "").toLowerCase());
}

function playbookDedupeKey(playbook) {
  return String(playbook?.name || "").trim().toLowerCase() || String(playbook?.id || "");
}

function prioritizePlaybooks(playbookRows = []) {
  const activeKeys = new Set(playbookRows.filter(isActivePlaybook).map(playbookDedupeKey));
  return playbookRows
    .filter((playbook) => {
      const status = String(playbook?.status || "").toLowerCase();
      return !(status === "draft" && activeKeys.has(playbookDedupeKey(playbook)));
    })
    .sort((a, b) => {
      const activeDelta = Number(isActivePlaybook(b)) - Number(isActivePlaybook(a));
      if (activeDelta) return activeDelta;
      return String(b?.updated_at || b?.created_at || "").localeCompare(String(a?.updated_at || a?.created_at || ""));
    });
}

function playbookRunStatus(playbook, steps = [], hasAnchorDate = false) {
  const total = steps.length;
  const complete = steps.filter((step) => isStepComplete(step)).length;
  if (total > 0 && complete >= total) return "Complete";
  if (isActivePlaybook(playbook)) return "In Progress";
  if (hasAnchorDate) return "Scheduled";
  return String(playbook?.status || "draft").replace(/_/g, " ");
}

function stepExecutionLabel(step) {
  if (isStepComplete(step)) return "DONE";
  if (step?.action_id) return "ACTION LINKED";
  return String(step?.status || "planned").toUpperCase();
}

function formatScheduleLabel(step) {
  if (!step?.due_date) return "No estimated date";
  const date = new Date(`${step.due_date}T12:00:00`);
  const label = Number.isNaN(date.getTime())
    ? String(step.due_date)
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return step.due_time ? `${label} · ${step.due_time}` : label;
}

async function hydratePlaybookActionStatuses(playbookRows = []) {
  const actionIds = Array.from(
    new Set(
      playbookRows
        .flatMap((playbook) => playbook?.steps || [])
        .map((step) => step?.action_id)
        .filter(Boolean)
    )
  );

  if (!actionIds.length) return playbookRows;

  const { data, error } = await supabase
    .from("reminders")
    .select("id,status,completed_at")
    .in("id", actionIds);

  if (error) {
    console.warn("Playbook action status hydration unavailable:", error.message || error);
    return playbookRows;
  }

  const statusById = new Map((data || []).map((row) => [String(row.id), row]));
  return playbookRows.map((playbook) => ({
    ...playbook,
    steps: (playbook?.steps || []).map((step) => {
      const action = step?.action_id ? statusById.get(String(step.action_id)) : null;
      if (!action) return step;
      const actionStatus = String(action.status || "").toLowerCase();
      return {
        ...step,
        status: actionStatus === "completed" ? "complete" : step.status,
        metadata: {
          ...(step.metadata || {}),
          action_status: action.status || null,
          action_completed_at: action.completed_at || null,
        },
      };
    }),
  }));
}

export default function KeeprSpacePlaybooksScreen({ navigation, route }) {
  const { currentWorkspace } = useWorkspace();
  const organizationId = currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
  const routeAssetId = route?.params?.assetId || route?.params?.asset_id || null;
  const routeSystemId = route?.params?.systemId || route?.params?.system_id || null;
  const isBoatScoped = Boolean(routeAssetId);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [playbookMutating, setPlaybookMutating] = useState(false);
  const [completingStepId, setCompletingStepId] = useState(null);
  const [activationStatus, setActivationStatus] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState(null);
  const [portfolio, setPortfolio] = useState(null);
  const [config, setConfig] = useState(null);
  const [playbooks, setPlaybooks] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [selectedAssetId, setSelectedAssetId] = useState(routeAssetId);
  const [selectedPlaybookId, setSelectedPlaybookId] = useState(null);
  const [sourcePlaybookId, setSourcePlaybookId] = useState(null);
  const [heroUrls, setHeroUrls] = useState({});
  const [name, setName] = useState("");
  const [playbookStartDate, setPlaybookStartDate] = useState("");
  const [playbookStartTime, setPlaybookStartTime] = useState("");
  const [steps, setSteps] = useState([]);
  const [editingStructure, setEditingStructure] = useState(false);

  const workspaceName = workspaceDisplayName(currentWorkspace, config);
  const allBoats = useMemo(() => portfolio?.boats || [], [portfolio]);
  const boats = useMemo(
    () =>
      allBoats.filter((boat) =>
        assetProjectionSemantics({
          asset: { ...boat, ...(boat?.identity || {}) },
          relationship: boat?.service_relationship || boat?.dealer_relationship || boat,
          workspace: currentWorkspace,
          providerName: workspaceName,
        }).showPlaybooks
      ),
    [allBoats, currentWorkspace, workspaceName]
  );
  const selectedBoat = useMemo(() => {
    const match = boats.find((boat) => String(assetIdForBoat(boat)) === String(selectedAssetId || routeAssetId));
    if (match) return match;
    const ineligibleMatch = allBoats.find((boat) => String(assetIdForBoat(boat)) === String(selectedAssetId || routeAssetId));
    if (ineligibleMatch) return ineligibleMatch;
    if (isBoatScoped && routeAssetId) {
      return {
        id: routeAssetId,
        asset_id: routeAssetId,
        name: route?.params?.assetName || "Selected boat",
        kac_id: route?.params?.kac || null,
      };
    }
    return boats[0] || null;
  }, [allBoats, boats, isBoatScoped, route?.params?.assetName, route?.params?.kac, routeAssetId, selectedAssetId]);
  const selectedBoatId = selectedBoat ? assetIdForBoat(selectedBoat) : selectedAssetId || routeAssetId || null;
  const selectedBoatSemantics = useMemo(
    () =>
      selectedBoat
        ? assetProjectionSemantics({
            asset: { ...selectedBoat, ...(selectedBoat?.identity || {}) },
            relationship: selectedBoat?.service_relationship || selectedBoat?.dealer_relationship || selectedBoat,
            workspace: currentWorkspace,
            providerName: workspaceName,
          })
        : null,
    [currentWorkspace, selectedBoat, workspaceName]
  );
  const playbooksAllowed = Boolean(selectedBoatSemantics?.showPlaybooks);
  const selectedBoatHeroUrl = (selectedBoatId && heroUrls[selectedBoatId]) || assetHeroUrl(selectedBoat);
  const activeServices = useMemo(
    () => (config?.service_offerings || []).filter((service) => String(service.status || "active").toLowerCase() === "active"),
    [config]
  );
  const selectedPlaybook = useMemo(
    () => playbooks.find((playbook) => String(playbook.id) === String(selectedPlaybookId)) || null,
    [playbooks, selectedPlaybookId]
  );
  const selectedPlaybookStatus = String(selectedPlaybook?.status || "draft").toLowerCase();
  const activePlaybookSelected = isActivePlaybook(selectedPlaybook);
  const structureLocked = activePlaybookSelected && !editingStructure;
  const canEditStructure = !structureLocked;
  const selectedRunStatus = playbookRunStatus(selectedPlaybook, steps, Boolean(playbookStartDate));
  const requestConfirmation = useCallback((nextConfirmation) => {
    setConfirmation(nextConfirmation);
  }, []);

  useEffect(() => {
    if (!selectedBoatId) return undefined;
    const cached = getCachedAssetHeroUris([selectedBoatId], PLAYBOOK_HERO_OPTIONS, { allowAnySize: true });
    if (cached[selectedBoatId]) {
      setHeroUrls((prev) => ({ ...prev, [selectedBoatId]: cached[selectedBoatId] }));
    }

    let mounted = true;
    fetchAssetHeroUris([selectedBoatId], PLAYBOOK_HERO_OPTIONS)
      .then((urls) => {
        if (!mounted || !urls?.[selectedBoatId]) return;
        setHeroUrls((prev) => ({ ...prev, [selectedBoatId]: urls[selectedBoatId] }));
      })
      .catch((err) => {
        console.warn("Playbook boat hero unavailable:", err?.message || err);
      });
    return () => {
      mounted = false;
    };
  }, [selectedBoatId]);

  const load = useCallback(async () => {
    if (!organizationId) {
      setError("This workspace does not have an organization id.");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [nextPortfolio, nextConfig] = await Promise.all([
        getKeeprSpacePortfolio({ organizationId, limit: 100 }),
        getKeeprSpaceOrgConfig({ organizationId }),
      ]);
      const nextBoats = nextPortfolio?.boats || [];
      const eligibleBoats = nextBoats.filter((boat) =>
        assetProjectionSemantics({
          asset: { ...boat, ...(boat?.identity || {}) },
          relationship: boat?.service_relationship || boat?.dealer_relationship || boat,
          workspace: currentWorkspace,
          providerName: workspaceDisplayName(currentWorkspace, nextConfig),
        }).showPlaybooks
      );
      const routeBoatEligible = eligibleBoats.some((boat) => String(assetIdForBoat(boat)) === String(routeAssetId));
      const selectedBoatEligible = eligibleBoats.some((boat) => String(assetIdForBoat(boat)) === String(selectedAssetId));
      const nextAssetId =
        routeAssetId && routeBoatEligible
          ? routeAssetId
          : selectedAssetId && selectedBoatEligible
          ? selectedAssetId
          : assetIdForBoat(eligibleBoats[0]) || routeAssetId || null;
      setPortfolio(nextPortfolio);
      setConfig(nextConfig);
      setSelectedAssetId(nextAssetId);

      if (nextAssetId && (routeBoatEligible || selectedBoatEligible || eligibleBoats.some((boat) => String(assetIdForBoat(boat)) === String(nextAssetId)))) {
        const [nextPlaybooks, nextOrgPlaybooks] = await Promise.all([
          listKeeprSpacePlaybooks({
            organizationId,
            assetId: nextAssetId,
            systemId: routeSystemId,
          }),
          listKeeprSpacePlaybooks({
            organizationId,
            assetId: null,
            systemId: null,
          }),
        ]);
        const rows = prioritizePlaybooks(await hydratePlaybookActionStatuses(
          (nextPlaybooks?.playbooks || []).filter((playbook) => !isTemplatePlaybook(playbook))
        ));
        const templateRows = await hydratePlaybookActionStatuses(
          (nextOrgPlaybooks?.playbooks || []).filter(isTemplatePlaybook)
        );
        setPlaybooks(rows);
        setTemplates(templateRows);
        const first =
          rows.find((playbook) => String(playbook.id) === String(selectedPlaybookId)) ||
          rows.find(isActivePlaybook) ||
          rows[0] ||
          null;
        if (first) {
          const meta = first.metadata && typeof first.metadata === "object" ? first.metadata : {};
          setSelectedPlaybookId(first.id);
          setSourcePlaybookId(first.source_playbook_id || meta.source_playbook_id || null);
          setName(first.name || "");
          setPlaybookStartDate(meta.playbook_start_date || "");
          setPlaybookStartTime(meta.playbook_start_time || "");
          setSteps((first.steps || []).map(normalizeStep));
          setEditingStructure(false);
        } else if (!selectedPlaybookId) {
          setSourcePlaybookId(null);
        }
      }
      if (!eligibleBoats.length || (routeAssetId && !routeBoatEligible)) {
        setPlaybooks([]);
        setTemplates([]);
        setSelectedPlaybookId(null);
        setSourcePlaybookId(null);
        setName("");
        setSteps([]);
      }
    } catch (err) {
      setError(err?.message || "Could not load playbooks.");
    } finally {
      setLoading(false);
    }
  }, [currentWorkspace, organizationId, routeAssetId, routeSystemId, selectedAssetId]);

  useEffect(() => {
    load();
  }, [load]);

  const startNewPlaybook = useCallback(() => {
    setSelectedPlaybookId(null);
    setSourcePlaybookId(null);
    setName(selectedBoat ? `${assetName(selectedBoat)} Playbook` : `${workspaceName} Playbook`);
    setPlaybookStartDate("");
    setPlaybookStartTime("");
    setSteps([]);
    setEditingStructure(false);
  }, [selectedBoat, workspaceName]);

  const selectPlaybook = useCallback((playbook) => {
    const meta = playbook?.metadata && typeof playbook.metadata === "object" ? playbook.metadata : {};
    setSelectedPlaybookId(playbook?.id || null);
    setSourcePlaybookId(playbook?.source_playbook_id || meta.source_playbook_id || null);
    setName(playbook?.name || "");
    setPlaybookStartDate(meta.playbook_start_date || "");
    setPlaybookStartTime(meta.playbook_start_time || "");
    setSteps((playbook?.steps || []).map(normalizeStep));
    setEditingStructure(false);
  }, []);

  const startFromTemplate = useCallback((template) => {
    const meta = template?.metadata && typeof template.metadata === "object" ? template.metadata : {};
    setSelectedPlaybookId(null);
    setSourcePlaybookId(template?.id || null);
    setName(String(template?.name || "New Playbook").replace(/\s+Template$/i, ""));
    setPlaybookStartDate(meta.playbook_start_date || "");
    setPlaybookStartTime(meta.playbook_start_time || "");
    setSteps((template?.steps || []).map(cloneTemplateStep));
    setEditingStructure(false);
  }, []);

  const addActionStep = useCallback(() => {
    setSteps((prev) => [
      ...prev,
      normalizeStep({
        title: "New action",
        step_type: "action",
        responsible_party: "Owner",
      }, prev.length),
    ]);
  }, []);

  const addServiceStep = useCallback((service) => {
    setSteps((prev) => [
      ...prev,
      normalizeStep({
        title: buildServiceLabel(service),
        step_type: "service",
        service_offering_id: service?.id || null,
        responsible_party: workspaceServiceTeamName(workspaceName),
        metadata: {
          service_label: buildServiceLabel(service),
        },
      }, prev.length),
    ]);
  }, [workspaceName]);

  const updateStep = useCallback((localId, patch) => {
    setSteps((prev) =>
      prev.map((step) => (step.localId === localId ? { ...step, ...patch } : step))
    );
  }, []);

  const removeStep = useCallback((localId) => {
    setSteps((prev) => prev.filter((step) => step.localId !== localId));
  }, []);

  const moveStep = useCallback((localId, direction) => {
    setSteps((prev) => {
      const index = prev.findIndex((step) => step.localId === localId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(nextIndex, 0, item);
      return copy.map((step, idx) => ({ ...step, position: idx + 1 }));
    });
  }, []);

  const buildPayload = useCallback(() => {
    const assetId = assetIdForBoat(selectedBoat) || selectedAssetId;
    return {
      id: selectedPlaybookId || undefined,
      name: name.trim(),
      asset_id: assetId,
      system_id: routeSystemId || undefined,
      organization_id: organizationId,
      asset_relationship_id: selectedBoat?.asset_relationship_id || selectedBoat?.relationship_id || undefined,
      owner_user_id: selectedBoat?.owner_id || selectedBoat?.asset?.owner_id || undefined,
      status: selectedPlaybook?.status || "draft",
      created_by_type: "organization",
      source_playbook_id: sourcePlaybookId || undefined,
      metadata: {
        workspace_name: workspaceName,
        source_playbook_id: sourcePlaybookId || null,
        is_template: false,
        playbook_start_date: playbookStartDate || null,
        playbook_start_time: playbookStartDate && playbookStartTime ? normalizeTime(playbookStartTime) : null,
        playbook_schedule_state: playbookStartDate ? "anchored" : "unscheduled",
      },
      steps: steps.map((step, index) => ({
        id: step.id || undefined,
        position: index + 1,
        title: step.title,
        step_type: step.step_type,
        service_offering_id: step.service_offering_id || undefined,
        responsible_party: step.responsible_party || undefined,
        due_date: step.due_date || undefined,
        action_id: step.action_id || undefined,
        status: step.status || "planned",
        metadata: {
          ...(step.metadata || {}),
          due_time: step.due_date && step.due_time ? normalizeTime(step.due_time) : null,
          schedule_state: step.due_date ? "scheduled" : "unscheduled",
        },
      })),
    };
  }, [
    name,
    organizationId,
    playbookStartDate,
    playbookStartTime,
    routeSystemId,
    selectedAssetId,
    selectedBoat,
    selectedPlaybook,
    selectedPlaybookId,
    sourcePlaybookId,
    steps,
    workspaceName,
  ]);

  const saveDraft = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert("Name required", "Give this playbook a name before saving.");
      return null;
    }
    if (!selectedBoat && !selectedAssetId) {
      Alert.alert("Boat required", "Choose a boat for this playbook.");
      return null;
    }

    setSaving(true);
    try {
      const result = await upsertKeeprSpacePlaybook({ playbook: buildPayload() });
      await load();
      return result?.playbook?.id || selectedPlaybookId;
    } catch (err) {
      Alert.alert("Could not save playbook", err?.message || "Please try again.");
      return null;
    } finally {
      setSaving(false);
    }
  }, [buildPayload, load, name, selectedAssetId, selectedBoat, selectedPlaybookId]);

  const activate = useCallback(async () => {
    setActivationStatus(null);
    const savedId = selectedPlaybookId || (await saveDraft());
    if (!savedId) return;

    setActivating(true);
    setActivationStatus({ type: "info", message: "Activating playbook..." });
    try {
      await activateKeeprSpacePlaybook({ playbookId: savedId });
      await load();
      setActivationStatus({ type: "success", message: "Playbook activated. Planned steps are now linked to Keepr Actions." });
      Alert.alert("Playbook activated", "The planned steps are now linked to real Keepr Actions.");
    } catch (err) {
      setActivationStatus({ type: "error", message: err?.message || "Please try again." });
      Alert.alert("Could not activate playbook", err?.message || "Please try again.");
    } finally {
      setActivating(false);
    }
  }, [load, saveDraft, selectedPlaybookId]);

  const deactivate = useCallback(() => {
    if (!selectedPlaybookId || !selectedPlaybook) return;
    requestConfirmation({
      title: "Deactivate Playbook?",
      message: `This will stop "${selectedPlaybook.name || "this Playbook"}" as a working plan, archive its open linked Actions, and return unfinished steps to draft planning.`,
      confirmLabel: "Deactivate",
      destructive: true,
      onConfirm: async () => {
        setPlaybookMutating(true);
        setActivationStatus({ type: "info", message: "Deactivating playbook..." });
        try {
          await deactivateKeeprSpacePlaybook({ playbookId: selectedPlaybookId });
          await load();
          setActivationStatus({ type: "success", message: "Playbook deactivated." });
        } catch (err) {
          setActivationStatus({ type: "error", message: err?.message || "Please try again." });
          Alert.alert("Could not deactivate playbook", err?.message || "Please try again.");
        } finally {
          setPlaybookMutating(false);
        }
      },
    });
  }, [load, requestConfirmation, selectedPlaybook, selectedPlaybookId]);

  const deletePlaybook = useCallback(() => {
    if (!selectedPlaybookId || !selectedPlaybook) return;
    requestConfirmation({
      title: "Delete Playbook?",
      message: `Delete "${selectedPlaybook.name || "this Playbook"}"? This removes the Playbook and its steps. Any open linked Actions created by this Playbook will be archived.`,
      confirmLabel: "Delete",
      destructive: true,
      onConfirm: async () => {
        setPlaybookMutating(true);
        setActivationStatus({ type: "info", message: "Deleting playbook..." });
        try {
          await deleteKeeprSpacePlaybook({ playbookId: selectedPlaybookId });
          setSelectedPlaybookId(null);
          setSourcePlaybookId(null);
          setName(selectedBoat ? `${assetName(selectedBoat)} Playbook` : `${workspaceName} Playbook`);
          setPlaybookStartDate("");
          setPlaybookStartTime("");
          setSteps([]);
          setEditingStructure(false);
          await load();
          setActivationStatus({ type: "success", message: "Playbook deleted." });
        } catch (err) {
          setActivationStatus({ type: "error", message: err?.message || "Please try again." });
          Alert.alert("Could not delete playbook", err?.message || "Please try again.");
        } finally {
          setPlaybookMutating(false);
        }
      },
    });
  }, [load, requestConfirmation, selectedBoat, selectedPlaybook, selectedPlaybookId, workspaceName]);

  const saveAsTemplate = useCallback(async () => {
    if (!name.trim()) {
      Alert.alert("Name required", "Give this playbook a name before saving it as a template.");
      return;
    }
    if (!selectedBoat && !selectedAssetId) {
      Alert.alert("Boat required", "Choose a boat before saving a template.");
      return;
    }

    setSaving(true);
    try {
      const payload = buildPayload();
      await upsertKeeprSpacePlaybook({
        playbook: {
          ...payload,
          id: undefined,
          status: "draft",
          source_playbook_id: selectedPlaybookId || sourcePlaybookId || undefined,
          metadata: {
            ...(payload.metadata || {}),
            is_template: true,
            playbook_kind: "template",
            template_scope: "organization",
            template_asset_id: payload.asset_id,
            template_saved_from_playbook_id: selectedPlaybookId || null,
          },
          steps: (payload.steps || []).map((step) => ({
            ...step,
            id: undefined,
            action_id: undefined,
            status: "planned",
            metadata: {
              ...(step.metadata || {}),
              template_step: true,
              template_saved_from_step_id: step.id || null,
            },
          })),
        },
      });
      await load();
      Alert.alert("Template saved", "This playbook is now available under New from Template.");
    } catch (err) {
      Alert.alert("Could not save template", err?.message || "Please try again.");
    } finally {
      setSaving(false);
    }
  }, [buildPayload, load, name, selectedAssetId, selectedBoat, selectedPlaybookId, sourcePlaybookId]);

  const openLinkedAction = useCallback((step) => {
    if (!step?.action_id) return;
    navigation.navigate("KeeprProActionDetail", {
      actionId: step.action_id,
      organizationId,
      assetId: assetIdForBoat(selectedBoat) || selectedAssetId,
      parentRoute: "KeeprSpacePlaybooks",
    });
  }, [navigation, organizationId, selectedAssetId, selectedBoat]);

  const openBoat = useCallback(() => {
    const assetId = selectedBoatId || routeAssetId;
    if (!assetId) return;
    navigation.navigate("KeeprSpaceBoat", {
      assetId,
      kac: assetKac(selectedBoat, route),
      organizationId,
      stewardshipId:
        selectedBoat?.stewardship_id ||
        selectedBoat?.asset_relationship_id ||
        selectedBoat?.relationship_id ||
        route?.params?.stewardshipId ||
        null,
      parentRoute: "KeeprSpaceFleet",
      workspaceId: route?.params?.workspaceId || (organizationId ? `org:${organizationId}` : null),
    });
  }, [navigation, organizationId, route, routeAssetId, selectedBoat, selectedBoatId]);

  const markStepDone = useCallback((step) => {
    if (!step?.action_id || !step?.id || isStepComplete(step)) return;

    requestConfirmation({
      title: "Mark step done?",
      message: `Mark "${step.title || "this step"}" complete in this Playbook? The linked Action will also be completed.`,
      confirmLabel: "Mark Done",
      onConfirm: async () => {
        setCompletingStepId(step.localId);
        try {
          const completedAt = new Date().toISOString();
          const { error: reminderError } = await supabase
            .from("reminders")
            .update({
              status: "completed",
              completed_at: completedAt,
              updated_at: completedAt,
            })
            .eq("id", step.action_id);
          if (reminderError) throw reminderError;

          const { error: stepError } = await supabase
            .from("playbook_steps")
            .update({
              status: "complete",
              updated_at: completedAt,
            })
            .eq("id", step.id);
          if (stepError) throw stepError;

          setSteps((prev) =>
            prev.map((item) =>
              item.localId === step.localId
                ? { ...item, status: "complete" }
                : item
            )
          );
          await load();
        } catch (err) {
          Alert.alert("Could not complete step", err?.message || "Please open the Action and try again.");
        } finally {
          setCompletingStepId(null);
        }
      },
    });
  }, [load, requestConfirmation]);

  if (loading) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.brandBlue} />
          <Text style={styles.muted}>Loading playbooks...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <PlaybookConfirmationModal
        confirmation={confirmation}
        onCancel={() => setConfirmation(null)}
      />
      <ScrollView contentContainerStyle={styles.page}>
        <ActivatorBreadcrumb
          items={[
            { label: "Active Fleet", route: "KeeprSpaceFleet" },
            selectedBoatId
              ? {
                  label: assetName(selectedBoat),
                  route: "KeeprSpaceBoat",
                  params: {
                    assetId: selectedBoatId,
                    kac: assetKac(selectedBoat, route),
                    organizationId,
                    stewardshipId:
                      selectedBoat?.stewardship_id ||
                      selectedBoat?.asset_relationship_id ||
                      selectedBoat?.relationship_id ||
                      route?.params?.stewardshipId ||
                      null,
                    parentRoute: "KeeprSpaceFleet",
                    workspaceId: route?.params?.workspaceId || (organizationId ? `org:${organizationId}` : null),
                  },
                }
              : { label: "Playbooks" },
          ]}
          current={structureLocked ? "Active Playbook" : "Builder"}
          homeRoute="KeeprSpaceHome"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {selectedBoat && !playbooksAllowed ? (
          <View style={styles.header}>
            <View style={styles.headerCopy}>
              <Text style={styles.eyebrow}>KeeprSpace Playbooks</Text>
              <Text style={styles.title}>{selectedBoatSemantics?.playbookTitle || "Playbooks unavailable"}</Text>
              <Text style={styles.subtitle}>
                {selectedBoatSemantics?.playbookHint || "This relationship does not enable owner or service playbooks."}
              </Text>
              <View style={styles.headerBoatCard}>
                {selectedBoatHeroUrl ? (
                  <Image source={{ uri: selectedBoatHeroUrl }} style={styles.headerBoatImage} resizeMode="cover" />
                ) : (
                  <View style={styles.headerBoatFallback}>
                    <Ionicons name="boat-outline" size={22} color={colors.brandBlue} />
                  </View>
                )}
                <View style={styles.headerBoatCopy}>
                  <Text style={styles.headerBoatName}>{assetName(selectedBoat)}</Text>
                  <Text style={styles.headerBoatMeta} numberOfLines={1}>
                    {compact([assetSubtitle(selectedBoat), selectedBoatSemantics?.workspaceRoleLabel])}
                  </Text>
                </View>
                <TouchableOpacity style={styles.backToBoatButton} onPress={openBoat} activeOpacity={0.86}>
                  <Ionicons name="arrow-back-outline" size={15} color={colors.brandBlue} />
                  <Text style={styles.secondaryButtonText}>Back to Boat</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ) : null}

        {selectedBoat && !playbooksAllowed ? null : (
        <>
        <View style={styles.header}>
          <View style={styles.headerCopy}>
            <Text style={styles.eyebrow}>KeeprSpace Playbooks</Text>
            <Text style={styles.title}>
              {structureLocked ? "Active Playbook" : "Playbook Builder"}
            </Text>
            <Text style={styles.subtitle}>
              {structureLocked
                ? "Run the shared plan: schedule steps, open Actions, and mark completed work."
                : "Build, save, then explicitly activate work plans for a boat or system."}
            </Text>
            {isBoatScoped && selectedBoat ? (
              <View style={styles.headerBoatCard}>
                {selectedBoatHeroUrl ? (
                  <Image source={{ uri: selectedBoatHeroUrl }} style={styles.headerBoatImage} resizeMode="cover" />
                ) : (
                  <View style={styles.headerBoatFallback}>
                    <Ionicons name="boat-outline" size={22} color={colors.brandBlue} />
                  </View>
                )}
                <View style={styles.headerBoatCopy}>
                  <Text style={styles.headerBoatName}>{assetName(selectedBoat)}</Text>
                  <Text style={styles.headerBoatMeta} numberOfLines={1}>{assetSubtitle(selectedBoat)}</Text>
                </View>
                <TouchableOpacity style={styles.backToBoatButton} onPress={openBoat} activeOpacity={0.86}>
                  <Ionicons name="arrow-back-outline" size={15} color={colors.brandBlue} />
                  <Text style={styles.secondaryButtonText}>Back to Boat</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
          <View style={styles.headerActions}>
            <TouchableOpacity style={styles.secondaryButton} onPress={startNewPlaybook}>
              <Ionicons name="add-outline" size={17} color={colors.brandBlue} />
              <Text style={styles.secondaryButtonText}>New from Scratch</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={saveAsTemplate} disabled={saving}>
              <Ionicons name="copy-outline" size={16} color={colors.brandBlue} />
              <Text style={styles.secondaryButtonText}>Save as Template</Text>
            </TouchableOpacity>
            {activePlaybookSelected ? (
              <TouchableOpacity
                style={editingStructure ? styles.secondaryButton : styles.warningButton}
                onPress={() => {
                  if (editingStructure) {
                    setEditingStructure(false);
                    return;
                  }
                  requestConfirmation({
                    title: "Edit active Playbook?",
                    message: "This changes the live plan shared around this boat. Scheduling and completion stay available without editing structure.",
                    confirmLabel: "Edit Structure",
                    onConfirm: () => setEditingStructure(true),
                  });
                }}
              >
                <Ionicons
                  name={editingStructure ? "lock-closed-outline" : "create-outline"}
                  size={16}
                  color={editingStructure ? colors.brandBlue : "#92400E"}
                />
                <Text style={editingStructure ? styles.secondaryButtonText : styles.warningButtonText}>
                  {editingStructure ? "Done Editing" : "Edit Structure"}
                </Text>
              </TouchableOpacity>
            ) : null}
            {activePlaybookSelected ? (
              <TouchableOpacity
                style={styles.secondaryDangerButton}
                onPress={deactivate}
                disabled={playbookMutating || saving || activating}
              >
                <Ionicons name="pause-circle-outline" size={16} color={colors.danger} />
                <Text style={styles.dangerButtonText}>
                  {playbookMutating ? "Working..." : "Deactivate"}
                </Text>
              </TouchableOpacity>
            ) : null}
            {selectedPlaybookId ? (
              <TouchableOpacity
                style={styles.secondaryDangerButton}
                onPress={deletePlaybook}
                disabled={playbookMutating || saving || activating}
              >
                <Ionicons name="trash-outline" size={16} color={colors.danger} />
                <Text style={styles.dangerButtonText}>Delete</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={styles.primaryButton} onPress={saveDraft} disabled={saving}>
              <Ionicons name="save-outline" size={16} color={colors.onPrimary} />
              <Text style={styles.primaryButtonText}>
                {saving ? "Saving..." : activePlaybookSelected ? "Save Schedule" : "Save Draft"}
              </Text>
            </TouchableOpacity>
            {!activePlaybookSelected ? (
              <TouchableOpacity style={styles.darkButton} onPress={activate} disabled={activating || saving}>
                <Ionicons name="play-outline" size={16} color={colors.onPrimary} />
                <Text style={styles.primaryButtonText}>{activating ? "Activating..." : "Activate"}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>

        {activationStatus ? (
          <Text style={[
            styles.activationStatus,
            activationStatus.type === "error" && styles.activationStatusError,
            activationStatus.type === "success" && styles.activationStatusSuccess,
          ]}>
            {activationStatus.message}
          </Text>
        ) : null}

        <View style={styles.grid}>
          <View style={styles.sidePanel}>
            {isBoatScoped ? (
              <View style={styles.contextBoatPanel}>
                {selectedBoatHeroUrl ? (
                  <Image source={{ uri: selectedBoatHeroUrl }} style={styles.contextBoatImage} resizeMode="cover" />
                ) : (
                  <View style={styles.contextBoatFallback}>
                    <Ionicons name="boat-outline" size={28} color={colors.brandBlue} />
                  </View>
                )}
                <Text style={styles.panelTitle}>{assetName(selectedBoat)}</Text>
                <Text style={styles.assetMeta}>{assetSubtitle(selectedBoat)}</Text>
                <TouchableOpacity style={styles.secondaryButtonFull} onPress={openBoat} activeOpacity={0.86}>
                  <Ionicons name="arrow-back-outline" size={15} color={colors.brandBlue} />
                  <Text style={styles.secondaryButtonText}>Back to Boat</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <>
                <Text style={styles.panelTitle}>Boats</Text>
                {boats.map((boat) => {
                  const id = assetIdForBoat(boat);
                  const selected = String(id) === String(selectedAssetId || selectedBoatId);
                  return (
                    <TouchableOpacity
                      key={id}
                      style={[styles.assetRow, selected && styles.assetRowActive]}
                      onPress={() => {
                        setSelectedAssetId(id);
                        setSelectedPlaybookId(null);
                        setSteps([]);
                        setEditingStructure(false);
                      }}
                    >
                      <Text style={styles.assetTitle}>{assetName(boat)}</Text>
                      <Text style={styles.assetMeta} numberOfLines={1}>{assetSubtitle(boat)}</Text>
                    </TouchableOpacity>
                  );
                })}
                <View style={styles.divider} />
              </>
            )}

            <Text style={styles.panelTitle}>{isBoatScoped ? "This Boat's Playbooks" : "Playbooks"}</Text>
            {playbooks.length ? (
              playbooks.map((playbook) => (
                <TouchableOpacity
                  key={playbook.id}
                  style={[styles.playbookRow, String(playbook.id) === String(selectedPlaybookId) && styles.playbookRowActive]}
                  onPress={() => selectPlaybook(playbook)}
                >
                  <View style={styles.badge}>
                    <Text style={styles.badgeText}>{String(playbook.status || "draft").toUpperCase()}</Text>
                  </View>
                  <Text style={styles.playbookTitle}>{playbook.name}</Text>
                  <Text style={styles.assetMeta}>{playbookProgress(playbook)}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.emptyText}>No playbooks yet for this boat.</Text>
            )}

            <View style={styles.divider} />
            <Text style={styles.panelTitle}>New from Template</Text>
            {templates.length ? (
              templates.map((template) => (
                <TouchableOpacity
                  key={template.id}
                  style={styles.templateRow}
                  onPress={() => startFromTemplate(template)}
                >
                  <View style={styles.templateBadge}>
                    <Ionicons name="copy-outline" size={13} color={colors.brandBlue} />
                    <Text style={styles.templateBadgeText}>TEMPLATE</Text>
                  </View>
                  <Text style={styles.playbookTitle}>{template.name}</Text>
                  <Text style={styles.assetMeta}>{playbookProgress(template)}</Text>
                </TouchableOpacity>
              ))
            ) : (
              <Text style={styles.emptyText}>Save a Playbook as a Template to reuse it.</Text>
            )}
          </View>

          <View style={styles.mainPanel}>
            <View style={styles.formHeader}>
              <View style={styles.formTitleWrap}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Playbook name"
                  editable={canEditStructure}
                  style={[styles.nameInput, !canEditStructure && styles.inputLocked]}
                />
                <Text style={styles.subtitle}>
                  {selectedBoat ? assetSubtitle(selectedBoat) : "Choose a boat"}{routeSystemId ? " · System-scoped" : ""}
                  {sourcePlaybookId ? " · From template" : ""}
                </Text>
              </View>
              <View style={styles.statusPill}>
                <Text style={styles.statusPillText}>{selectedRunStatus.toUpperCase()}</Text>
              </View>
            </View>

            <View style={styles.anchorCard}>
              <View style={styles.anchorHeader}>
                <View>
                  <Text style={styles.scheduleLabel}>Playbook start / anchor</Text>
                  <Text style={styles.anchorHint}>
                    Optional. Use this for season start, spring commissioning, or the first agreed window.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.unscheduledButton, !playbookStartDate && styles.unscheduledButtonActive]}
                  onPress={() => {
                    setPlaybookStartDate("");
                    setPlaybookStartTime("");
                  }}
                >
                  <Ionicons
                    name="remove-circle-outline"
                    size={15}
                    color={!playbookStartDate ? colors.onPrimary : colors.textSecondary}
                  />
                  <Text style={[styles.unscheduledText, !playbookStartDate && styles.unscheduledTextActive]}>
                    {activePlaybookSelected ? selectedRunStatus : playbookStartDate ? selectedRunStatus : "Unscheduled"}
                  </Text>
                </TouchableOpacity>
              </View>
              <View style={styles.scheduleRow}>
                <KeeprDateField
                  value={playbookStartDate || null}
                  onChange={(date) => {
                    setPlaybookStartDate(date || "");
                    if (!date) setPlaybookStartTime("");
                  }}
                  placeholder="Optional start date"
                  style={styles.dateField}
                />
                <TimeField
                  value={playbookStartTime}
                  disabled={!playbookStartDate}
                  onChange={(time) => setPlaybookStartTime(normalizeTime(time))}
                />
              </View>
            </View>

            {canEditStructure ? (
              <View style={styles.toolbar}>
                <TouchableOpacity style={styles.secondaryButton} onPress={addActionStep}>
                  <Ionicons name="add-outline" size={17} color={colors.brandBlue} />
                  <Text style={styles.secondaryButtonText}>Add Action</Text>
                </TouchableOpacity>
                {activeServices.map((service) => (
                  <TouchableOpacity key={service.id} style={styles.secondaryButton} onPress={() => addServiceStep(service)}>
                    <Ionicons name="construct-outline" size={16} color={colors.brandBlue} />
                    <Text style={styles.secondaryButtonText}>Add {buildServiceLabel(service)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={styles.runModeNotice}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.brandBlue} />
                <Text style={styles.runModeNoticeText}>
                  Active execution mode. The plan is locked against accidental structure changes.
                </Text>
              </View>
            )}

            <View style={styles.stepsTable}>
              {steps.length ? (
                steps.map((step, index) => {
                  const complete = isStepComplete(step);
                  const linked = Boolean(step.action_id);
                  return (
                  <View key={step.localId} style={[styles.stepRow, complete && styles.stepRowComplete]}>
                    <View style={[styles.stepIndex, complete && styles.stepIndexComplete]}>
                      <Text style={styles.stepIndexText}>{index + 1}</Text>
                    </View>
                    <View style={styles.stepContent}>
                      <TextInput
                        value={step.title}
                        onChangeText={(text) => updateStep(step.localId, { title: text })}
                        editable={canEditStructure}
                        style={[styles.stepTitleInput, !canEditStructure && styles.inputLocked]}
                        placeholder="Step title"
                      />
                      <View style={styles.stepMetaRow}>
                        <TouchableOpacity
                          disabled={!canEditStructure}
                          style={[
                            styles.choicePill,
                            step.step_type === "service" && styles.choicePillActive,
                            !canEditStructure && styles.choicePillDisabled,
                          ]}
                          onPress={() => {
                            if (canEditStructure) {
                              updateStep(step.localId, { step_type: step.step_type === "service" ? "action" : "service" });
                            }
                          }}
                        >
                          <Text
                            style={[
                              styles.choicePillText,
                              step.step_type === "service" && styles.choicePillTextActive,
                              !canEditStructure && styles.choicePillTextDisabled,
                            ]}
                          >
                            {step.step_type === "service" ? "Service" : "Action"}
                          </Text>
                        </TouchableOpacity>
                        {DEFAULT_RESPONSIBLE_OPTIONS.map((option) => (
                          <TouchableOpacity
                            key={option}
                            disabled={!canEditStructure}
                            style={[
                              styles.choicePill,
                              step.responsible_party === option && styles.choicePillActive,
                              !canEditStructure && styles.choicePillDisabled,
                            ]}
                            onPress={() => {
                              if (canEditStructure) {
                                updateStep(step.localId, { responsible_party: option });
                              }
                            }}
                          >
                            <Text
                              style={[
                                styles.choicePillText,
                                step.responsible_party === option && styles.choicePillTextActive,
                                !canEditStructure && styles.choicePillTextDisabled,
                              ]}
                            >
                              {option}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                      <View style={styles.stepScheduleCard}>
                        <View style={styles.stepScheduleHeader}>
                          <Text style={styles.scheduleLabel}>Schedule</Text>
                          <View
                            style={[
                              styles.scheduleStatePill,
                              !step.due_date && styles.missingEstimatePill,
                              complete && styles.completePill,
                            ]}
                          >
                            <Ionicons
                              name={complete ? "checkmark-circle-outline" : step.due_date ? "calendar-outline" : "remove-circle-outline"}
                              size={14}
                              color={complete ? colors.onPrimary : colors.textSecondary}
                            />
                            <Text
                              style={[
                                styles.unscheduledText,
                                !step.due_date && styles.missingEstimateText,
                                complete && styles.unscheduledTextActive,
                              ]}
                            >
                              {complete ? "Done" : formatScheduleLabel(step)}
                            </Text>
                          </View>
                          {!complete ? (
                            <TouchableOpacity
                              style={styles.clearScheduleButton}
                              onPress={() => updateStep(step.localId, { due_date: "", due_time: "" })}
                            >
                              <Ionicons
                                name="remove-circle-outline"
                                size={14}
                                color={colors.textSecondary}
                              />
                              <Text style={styles.clearScheduleText}>Clear</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                        <View style={styles.scheduleRow}>
                          <KeeprDateField
                            value={step.due_date || null}
                            onChange={(date) =>
                              updateStep(step.localId, {
                                due_date: date || "",
                                due_time: date ? step.due_time : "",
                              })
                            }
                            placeholder="Optional date"
                            style={styles.dateField}
                          />
                          <TimeField
                            value={step.due_time}
                            disabled={!step.due_date}
                            onChange={(time) => updateStep(step.localId, { due_time: normalizeTime(time) })}
                          />
                        </View>
                      </View>
                    </View>
                    <View style={styles.stepActions}>
                      <Text style={[styles.stepStatus, complete && styles.stepStatusComplete]}>{stepExecutionLabel(step)}</Text>
                      {linked ? (
                        <TouchableOpacity style={styles.openActionButton} onPress={() => openLinkedAction(step)}>
                          <Ionicons name="open-outline" size={13} color={colors.brandBlue} />
                          <Text style={styles.openActionText}>Open Action</Text>
                        </TouchableOpacity>
                      ) : null}
                      {linked && !complete ? (
                        <TouchableOpacity
                          style={styles.doneButton}
                          onPress={() => markStepDone(step)}
                          disabled={completingStepId === step.localId}
                        >
                          <Ionicons name="checkmark-circle-outline" size={13} color={colors.onPrimary} />
                          <Text style={styles.doneButtonText}>
                            {completingStepId === step.localId ? "Saving..." : "Mark Done"}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                      {canEditStructure ? (
                        <View style={styles.iconRow}>
                          <TouchableOpacity onPress={() => moveStep(step.localId, -1)} style={styles.iconButton}>
                            <Ionicons name="arrow-up-outline" size={14} color={colors.textMuted} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => moveStep(step.localId, 1)} style={styles.iconButton}>
                            <Ionicons name="arrow-down-outline" size={14} color={colors.textMuted} />
                          </TouchableOpacity>
                          <TouchableOpacity onPress={() => removeStep(step.localId)} style={styles.iconButton}>
                            <Ionicons name="trash-outline" size={14} color={colors.danger} />
                          </TouchableOpacity>
                        </View>
                      ) : null}
                    </View>
                  </View>
                );
                })
              ) : (
                <View style={styles.emptyState}>
                  <Ionicons name="list-outline" size={28} color={colors.textMuted} />
                  <Text style={styles.emptyTitle}>Build the plan</Text>
                  <Text style={styles.emptyText}>Add simple owner actions and service work. Saving keeps a draft; activating creates the real Actions.</Text>
                </View>
              )}
            </View>
          </View>
        </View>
        </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: colors.background,
  },
  page: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
  },
  header: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    flexDirection: Platform.OS === "web" ? "row" : "column",
    justifyContent: "space-between",
    alignItems: Platform.OS === "web" ? "flex-start" : "stretch",
    gap: spacing.md,
    ...shadows.sm,
  },
  headerCopy: {
    flex: 1,
    minWidth: Platform.OS === "web" ? 320 : undefined,
  },
  eyebrow: {
    color: colors.brandBlue,
    fontWeight: "900",
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  title: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 28,
  },
  subtitle: {
    color: colors.textSecondary,
    fontWeight: "700",
  },
  headerBoatCard: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    maxWidth: Platform.OS === "web" ? 560 : "100%",
  },
  headerBoatImage: {
    width: 72,
    height: 52,
    borderRadius: radius.xs,
    backgroundColor: "#DBEAFE",
  },
  headerBoatFallback: {
    width: 72,
    height: 52,
    borderRadius: radius.xs,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  headerBoatCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerBoatName: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 16,
  },
  headerBoatMeta: {
    color: colors.textMuted,
    fontWeight: "800",
    marginTop: 2,
  },
  backToBoatButton: {
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    backgroundColor: "#EFF6FF",
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  activationStatus: {
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    color: colors.textSecondary,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontWeight: "800",
  },
  activationStatusError: {
    borderColor: "#FECACA",
    backgroundColor: "#FEF2F2",
    color: "#991B1B",
  },
  activationStatusSuccess: {
    borderColor: "#BBF7D0",
    backgroundColor: "#F0FDF4",
    color: "#166534",
  },
  headerActions: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-end",
    minWidth: Platform.OS === "web" ? 320 : undefined,
    maxWidth: Platform.OS === "web" ? 640 : undefined,
  },
  grid: {
    flexDirection: Platform.OS === "web" ? "row" : "column",
    gap: spacing.md,
  },
  sidePanel: {
    width: Platform.OS === "web" ? 310 : "100%",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.sm,
    ...shadows.sm,
  },
  mainPanel: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
    ...shadows.sm,
  },
  panelTitle: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 16,
  },
  assetRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: 2,
  },
  assetRowActive: {
    borderColor: colors.brandBlue,
    backgroundColor: "#EAF3FF",
  },
  assetTitle: {
    color: colors.textPrimary,
    fontWeight: "900",
  },
  assetMeta: {
    color: colors.textMuted,
    fontWeight: "700",
  },
  contextBoatPanel: {
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    backgroundColor: "#F8FBFF",
    padding: spacing.sm,
    gap: spacing.xs,
  },
  contextBoatImage: {
    width: "100%",
    height: 124,
    borderRadius: radius.sm,
    backgroundColor: "#DBEAFE",
  },
  contextBoatFallback: {
    width: "100%",
    height: 124,
    borderRadius: radius.sm,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryButtonFull: {
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    backgroundColor: "#EFF6FF",
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: spacing.xs,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  playbookRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  playbookRowActive: {
    borderColor: colors.brandBlue,
    backgroundColor: "#EAF3FF",
  },
  templateRow: {
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    padding: spacing.sm,
    gap: spacing.xs,
    backgroundColor: "#F8FBFF",
  },
  templateBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: "#EAF3FF",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  templateBadgeText: {
    color: colors.brandBlue,
    fontWeight: "900",
    fontSize: 10,
  },
  playbookTitle: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 15,
  },
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    backgroundColor: colors.brandNavy,
  },
  badgeText: {
    color: colors.onPrimary,
    fontWeight: "900",
    fontSize: 11,
  },
  formHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
    alignItems: "flex-start",
  },
  formTitleWrap: {
    flex: 1,
  },
  nameInput: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 24,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceSubtle,
  },
  statusPill: {
    backgroundColor: "#DCFCE7",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
  },
  statusPillText: {
    color: colors.accentGreen,
    fontWeight: "900",
    fontSize: 12,
  },
  anchorCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.md,
    gap: spacing.sm,
  },
  anchorHeader: {
    flexDirection: Platform.OS === "web" ? "row" : "column",
    justifyContent: "space-between",
    gap: spacing.sm,
    alignItems: Platform.OS === "web" ? "center" : "flex-start",
  },
  anchorHint: {
    color: colors.textMuted,
    fontWeight: "700",
    fontSize: 12,
    marginTop: 2,
  },
  scheduleLabel: {
    color: colors.textSecondary,
    fontWeight: "900",
    fontSize: 12,
    textTransform: "uppercase",
    letterSpacing: 0,
  },
  scheduleRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    alignItems: "center",
  },
  dateField: {
    minWidth: Platform.OS === "web" ? 190 : "100%",
    maxWidth: Platform.OS === "web" ? 240 : "100%",
  },
  timeInput: {
    minHeight: 42,
    minWidth: 110,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSubtle,
    color: colors.textPrimary,
    fontWeight: "800",
    paddingHorizontal: spacing.sm,
  },
  timeInputDisabled: {
    backgroundColor: "#F3F4F6",
    color: colors.textMuted,
  },
  unscheduledButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  scheduleStatePill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    maxWidth: 220,
  },
  clearScheduleButton: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  clearScheduleText: {
    color: colors.textSecondary,
    fontWeight: "900",
    fontSize: 12,
  },
  unscheduledButtonActive: {
    borderColor: colors.brandNavy,
    backgroundColor: colors.brandNavy,
  },
  missingEstimatePill: {
    borderColor: "#CBD5E1",
    backgroundColor: "#F8FAFC",
  },
  missingEstimateText: {
    color: colors.textSecondary,
  },
  completePill: {
    borderColor: colors.accentGreen,
    backgroundColor: colors.accentGreen,
  },
  unscheduledText: {
    color: colors.textSecondary,
    fontWeight: "900",
    fontSize: 12,
  },
  unscheduledTextActive: {
    color: colors.onPrimary,
  },
  toolbar: {
    flexDirection: "row",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  primaryButton: {
    backgroundColor: colors.brandBlue,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  darkButton: {
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontWeight: "900",
  },
  secondaryButton: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  secondaryButtonText: {
    color: colors.brandBlue,
    fontWeight: "900",
  },
  warningButton: {
    backgroundColor: "#FFFBEB",
    borderWidth: 1,
    borderColor: "#FCD34D",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  warningButtonText: {
    color: "#92400E",
    fontWeight: "900",
  },
  secondaryDangerButton: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  dangerButtonText: {
    color: colors.danger,
    fontWeight: "900",
  },
  confirmBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.42)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  confirmCard: {
    width: "100%",
    maxWidth: 460,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.md,
  },
  confirmTitle: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 20,
  },
  confirmMessage: {
    color: colors.textSecondary,
    fontWeight: "700",
    lineHeight: 20,
  },
  confirmActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: spacing.sm,
    flexWrap: "wrap",
  },
  runModeNotice: {
    borderWidth: 1,
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    backgroundColor: "#EFF6FF",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  runModeNoticeText: {
    color: colors.textSecondary,
    fontWeight: "800",
  },
  stepsTable: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    overflow: "hidden",
  },
  stepRow: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    alignItems: "center",
    backgroundColor: colors.surface,
  },
  stepRowComplete: {
    backgroundColor: "#F0FDF4",
  },
  stepIndex: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#EAF3FF",
  },
  stepIndexComplete: {
    backgroundColor: "#DCFCE7",
  },
  stepIndexText: {
    color: colors.brandBlue,
    fontWeight: "900",
  },
  stepContent: {
    flex: 1,
    gap: spacing.xs,
  },
  stepTitleInput: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 16,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceSubtle,
  },
  inputLocked: {
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  stepMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  stepScheduleCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceSubtle,
    padding: spacing.sm,
    gap: spacing.xs,
  },
  stepScheduleHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: spacing.sm,
  },
  choicePill: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.surface,
  },
  choicePillActive: {
    borderColor: colors.brandNavy,
    backgroundColor: colors.brandNavy,
  },
  choicePillDisabled: {
    opacity: 0.9,
  },
  choicePillText: {
    color: colors.textSecondary,
    fontWeight: "800",
    fontSize: 12,
  },
  choicePillTextActive: {
    color: colors.onPrimary,
  },
  choicePillTextDisabled: {
    fontWeight: "900",
  },
  stepActions: {
    width: 150,
    alignItems: "flex-end",
    gap: spacing.xs,
  },
  stepStatus: {
    color: colors.textMuted,
    fontWeight: "900",
    fontSize: 11,
  },
  stepStatusComplete: {
    color: colors.accentGreen,
  },
  openActionButton: {
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  openActionText: {
    color: colors.brandBlue,
    fontWeight: "900",
    fontSize: 12,
  },
  doneButton: {
    backgroundColor: colors.accentGreen,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  doneButtonText: {
    color: colors.onPrimary,
    fontWeight: "900",
    fontSize: 12,
  },
  iconRow: {
    flexDirection: "row",
    gap: spacing.xs,
  },
  iconButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  emptyState: {
    padding: spacing.xl,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
  },
  emptyTitle: {
    color: colors.textPrimary,
    fontWeight: "900",
    fontSize: 17,
  },
  emptyText: {
    color: colors.textSecondary,
    fontWeight: "700",
  },
  error: {
    color: colors.danger,
    fontWeight: "800",
  },
  muted: {
    color: colors.textMuted,
    fontWeight: "700",
  },
});
