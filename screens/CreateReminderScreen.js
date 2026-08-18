// screens/CreateReminderScreen.js
import React, {
  useEffect,
  useMemo,
  useState,
  useCallback,
} from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
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
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { useWorkspace } from "../context/WorkspaceContext";
import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, shadows } from "../styles/theme";
import KeeprDateField from "../components/KeeprDateField";
import { getKeeprSpaceOrgConfig } from "../lib/keeprspaceApi";
import { createServiceRecordWithStoryEvent } from "../lib/serviceRecordsService";
import {
  buildKeeprProAssignmentOptions,
  buildTeamAssignmentOption,
  buildTeamMemberAssignmentOption,
  cancelReminderPushNotification,
  completeSharedCoordinationAction,
  createReminderWebNotifications,
  ensureNextReminderOccurrence,
  extractSystemKeeprProIds,
  fetchCoordinationAction,
  getReminderVisibilityScope,
  isSameAssignmentTarget,
  normalizeReminderAssignment,
  normalizeReminderProvider,
  scheduleReminderPushNotification,
} from "../lib/teamActions";
import { loadMyKeeprProsForPicker } from "../lib/kpcApi";

/* ------------------------------------------------------------- */
/* Date helpers                                                  */
/* ------------------------------------------------------------- */

const pad2 = (n) => String(n).padStart(2, "0");

const todayISO = () => {
  const d = new Date();
  const yyyy = String(d.getFullYear());
  const mm = pad2(d.getMonth() + 1);
  const dd = pad2(d.getDate());
  return `${yyyy}-${mm}-${dd}`;
};

const listFromValue = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
};

const serviceTemplateLabel = (service) =>
  service?.owner_facing_label || service?.name || "Service";

const buildServiceTemplateSnapshot = (service) => {
  if (!service) return null;
  const template = service.metadata?.service_template || service.metadata || {};
  const serviceItems = Array.isArray(template.service_items)
    ? template.service_items
    : Array.isArray(template.checklist_items)
    ? template.checklist_items
    : Array.isArray(service.service_items)
    ? service.service_items
    : [];
  return {
    id: service.id || null,
    slug: service.slug || null,
    key: service.service_key || service.key || service.slug || service.id || null,
    name: service.name || service.owner_facing_label || "Service",
    label: serviceTemplateLabel(service),
    service_type: service.service_type || null,
    asset_system_type: service.asset_system_type || template.asset_system_type || null,
    brand_applicability: service.brand_applicability || template.brand_applicability || null,
    interval_trigger: service.interval_trigger || template.interval_trigger || null,
    owner_facing_description: service.owner_facing_description || service.description || null,
    service_items: serviceItems
      .map((item) => {
        if (typeof item === "string") return { label: item };
        if (item && typeof item === "object") {
          return {
            ...item,
            label: item.label || item.title || item.name || "",
          };
        }
        return null;
      })
      .filter((item) => item?.label),
    relationship_purposes: listFromValue(service.relationship_purposes),
    supported_asset_types: listFromValue(service.supported_asset_types),
    status: service.status || "active",
  };
};


/* ------------------------------------------------------------- */

export default function CreateReminderScreen({ navigation, route }) {
  const { user } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const ownerId = user?.id || null;

  const reminderIdFromRoute = route?.params?.reminderId ?? null;
  const isEdit = !!reminderIdFromRoute;

  const prefillTitle = route?.params?.prefillTitle || "";
  const prefillNotes = route?.params?.prefillNotes || "";
  

  const prefill = {
  ...(route?.params?.prefill || {}),
  title:
    route?.params?.prefill?.title ||
    prefillTitle ||
    "",
  notes:
    route?.params?.prefill?.notes ||
    prefillNotes ||
    "",
};
  const afterSave = route?.params?.afterSave || "Notifications";
  const afterSaveParams = route?.params?.afterSaveParams || null;


  const contextAssetId = prefill.asset_id ?? route?.params?.assetId ?? null;
  const contextSystemId = prefill.system_id ?? route?.params?.systemId ?? null;
  const contextRecordId = prefill.record_id ?? route?.params?.recordId ?? null;
  const contextEventId = prefill.event_id ?? route?.params?.eventId ?? null;

  const initialISO = prefill.due_at
    ? new Date(prefill.due_at).toISOString().slice(0, 10)
    : todayISO();

  const initialExtraMeta =
    (prefill.extra_metadata && typeof prefill.extra_metadata === "object"
      ? prefill.extra_metadata
      : {}) || {};

  const [loading, setLoading] = useState(!!isEdit);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState(prefill.title || "");
  const [notes, setNotes] = useState(prefill.notes || "");

  const [dueDateISO, setDueDateISO] = useState(initialISO);
  const [timeText, setTimeText] = useState("09:00");
  const [scheduleTouched, setScheduleTouched] = useState(false);

  const [hasTime, setHasTime] = useState(
    typeof prefill.has_time === "boolean" ? prefill.has_time : true
  );
  const [isUrgent, setIsUrgent] = useState(
    typeof prefill.is_urgent === "boolean" ? prefill.is_urgent : false
  );
  const [repeatRule, setRepeatRule] = useState(prefill.repeat_rule || "");
  const [status, setStatus] = useState(prefill.status || "open");
  const [reminderOwnerId, setReminderOwnerId] = useState(ownerId || null);
  const [visibilityScope, setVisibilityScope] = useState(() =>
    getReminderVisibilityScope({
      asset_id: contextAssetId,
      system_id: contextSystemId,
      extra_metadata: initialExtraMeta,
    })
  );
  const [visibilityTouched, setVisibilityTouched] = useState(false);
  const [coordinationOrg, setCoordinationOrg] = useState(null);
  const [teamAssignmentOptions, setTeamAssignmentOptions] = useState([]);

  const [assetId, setAssetId] = useState(contextAssetId);
  const [systemId, setSystemId] = useState(contextSystemId);
  const [recordId] = useState(contextRecordId);
  const [eventId] = useState(contextEventId);

  const [assetName, setAssetName] = useState("");
  const [systemName, setSystemName] = useState("");

  // Assignment is the responsible party; provider involvement is tracked separately.
  const [baseExtraMeta, setBaseExtraMeta] = useState(initialExtraMeta);
  const initialAssignment = normalizeReminderAssignment(initialExtraMeta);
  const initialProvider = normalizeReminderProvider(initialExtraMeta);
  const initialServiceSnapshot =
    initialExtraMeta.service_template_snapshot ||
    initialExtraMeta.serviceTemplateSnapshot ||
    null;
  const [actionType, setActionType] = useState(
    initialServiceSnapshot || initialExtraMeta.action_type === "service"
      ? "service"
      : "general"
  );
  const [serviceTemplates, setServiceTemplates] = useState([]);
  const [serviceTemplatesLoading, setServiceTemplatesLoading] = useState(false);
  const [serviceTemplateError, setServiceTemplateError] = useState(null);
  const [selectedServiceKey, setSelectedServiceKey] = useState(
    initialServiceSnapshot?.key ||
      initialServiceSnapshot?.id ||
      initialExtraMeta.service_template_id ||
      initialExtraMeta.service_template_key ||
      ""
  );
  const [assignedTo, setAssignedTo] = useState(initialAssignment.assignedTo);
  const [assignmentTarget, setAssignmentTarget] = useState(
    initialAssignment.assignmentTarget
  );
  const [assignmentOptions, setAssignmentOptions] = useState(() =>
    [
      buildTeamAssignmentOption({
        orgId: null,
      assetId: contextAssetId,
      systemId: contextSystemId,
      }),
    ]
  );
  const [providerTarget, setProviderTarget] = useState(
    initialProvider.providerTarget
  );
  const [providerOptions, setProviderOptions] = useState([]);
  const [providerPickerOpen, setProviderPickerOpen] = useState(false);
  const [providerSearch, setProviderSearch] = useState("");
  const [assignmentLoading, setAssignmentLoading] = useState(false);
  const [completionPickerOpen, setCompletionPickerOpen] = useState(false);
  const [completionMode, setCompletionMode] = useState("complete");
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionCandidates, setCompletionCandidates] = useState([]);
  const [selectedCompletionRecordId, setSelectedCompletionRecordId] =
    useState(null);
  const [completionRecordSearch, setCompletionRecordSearch] = useState("");
  const [workCompletedOn, setWorkCompletedOn] = useState(todayISO());
  const [actionContext, setActionContext] = useState({
    loading: false,
    recentRecordCount: 0,
    proofAttachmentCount: 0,
    reminderAttachmentCount: 0,
    latestRecordTitle: null,
    errors: [],
  });

  // Link modal
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [assets, setAssets] = useState([]);
  const [systems, setSystems] = useState([]);
  const [assetSearch, setAssetSearch] = useState("");
  const [systemSearch, setSystemSearch] = useState("");

  /* ---------------- load existing reminder when editing --------------- */

  useEffect(() => {
    if (!isEdit || !ownerId || !reminderIdFromRoute) return;

    let mounted = true;

    async function loadReminder() {
      setLoading(true);
      try {
        const data = await fetchCoordinationAction(reminderIdFromRoute, {
          ownerId,
        });
        if (!data?.id) throw new Error("Action not found or not authorized.");
        if (!mounted || !data) return;

        setReminderOwnerId(data.owner_id || ownerId || null);
        setTitle(data.title || "");
        setNotes(data.notes || "");

        const iso = data.due_at
          ? new Date(data.due_at).toISOString().slice(0, 10)
          : todayISO();

        setDueDateISO(iso);
        setScheduleTouched(false);

                const existingTime = data.due_at
          ? new Date(data.due_at)
          : null;

        if (existingTime) {
          setTimeText(
            `${pad2(existingTime.getHours())}:${pad2(existingTime.getMinutes())}`
          );
        }

        setHasTime(
          typeof data.has_time === "boolean" ? data.has_time : true
        );
        setIsUrgent(
          typeof data.is_urgent === "boolean" ? data.is_urgent : false
        );
        setRepeatRule(data.repeat_rule || "");
        setStatus(data.status || "open");
        setVisibilityScope(getReminderVisibilityScope(data));
        setVisibilityTouched(true);

        setAssetId(data.asset_id || null);
        setSystemId(data.system_id || null);

        const em =
          (data.extra_metadata &&
            typeof data.extra_metadata === "object" &&
            data.extra_metadata) ||
          {};
        const assignment = normalizeReminderAssignment(em);
        const provider = normalizeReminderProvider(em);
        const existingServiceSnapshot =
          em.service_template_snapshot || em.serviceTemplateSnapshot || null;
        setBaseExtraMeta(em);
        setActionType(
          existingServiceSnapshot || em.action_type === "service"
            ? "service"
            : "general"
        );
        setSelectedServiceKey(
          existingServiceSnapshot?.key ||
            existingServiceSnapshot?.id ||
            em.service_template_id ||
            em.service_template_key ||
            ""
        );
        setAssignedTo(assignment.assignedTo);
        setAssignmentTarget(assignment.assignmentTarget);
        setProviderTarget(provider.providerTarget);
      } catch (e) {
        console.log("Load reminder error:", e);
        Alert.alert(
          "Couldn’t load reminder",
          e?.message || "Please try again."
        );
        navigation.goBack();
      } finally {
        if (mounted) setLoading(false);
      }
    }

    loadReminder();
    return () => {
      mounted = false;
    };
  }, [isEdit, ownerId, reminderIdFromRoute, navigation]);

  useEffect(() => {
    if (!ownerId) return;
    let mounted = true;

    function memberLabel(profile, fallbackId) {
      return (
        profile?.display_name ||
        profile?.full_name ||
        profile?.username ||
        profile?.email ||
        fallbackId ||
        "Team member"
      );
    }

    async function loadCoordinationTeam() {
      try {
        let orgRow = null;

        if (assetId) {
          const { data: assetStewards, error: stewardErr } = await supabase
            .from("asset_stewardships")
            .select("org_id")
            .eq("asset_id", assetId)
            .eq("active", true)
            .not("org_id", "is", null);

          if (stewardErr) throw stewardErr;

          const stewardOrgIds = Array.from(
            new Set((assetStewards || []).map((row) => row.org_id).filter(Boolean))
          );

          if (stewardOrgIds.length > 0) {
            const { data: memberships, error: membershipErr } = await supabase
              .from("org_members")
              .select("org_id")
              .eq("user_id", ownerId)
              .in("org_id", stewardOrgIds);

            if (membershipErr) throw membershipErr;

            const memberOrgId = memberships?.[0]?.org_id || null;
            if (memberOrgId) {
              const { data: stewardOrg, error: stewardOrgErr } = await supabase
                .from("orgs")
                .select("id,owner_user_id,display_name,name,org_type")
                .eq("id", memberOrgId)
                .in("org_type", ["family", "team"])
                .maybeSingle();

              if (stewardOrgErr) throw stewardOrgErr;
              orgRow = stewardOrg || null;
            }
          }
        }

        if (!orgRow) {
          const { data: ownedOrg, error: ownedErr } = await supabase
            .from("orgs")
            .select("id,owner_user_id,display_name,name,org_type")
            .eq("owner_user_id", ownerId)
            .in("org_type", ["family", "team"])
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (ownedErr) throw ownedErr;
          orgRow = ownedOrg || null;
        }

        if (!orgRow) {
          const { data: membership, error: membershipErr } = await supabase
            .from("org_members")
            .select("org_id")
            .eq("user_id", ownerId)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();

          if (membershipErr) throw membershipErr;

          if (membership?.org_id) {
            const { data: memberOrg, error: memberOrgErr } = await supabase
              .from("orgs")
              .select("id,owner_user_id,display_name,name,org_type")
              .eq("id", membership.org_id)
              .in("org_type", ["family", "team"])
              .maybeSingle();
            if (memberOrgErr) throw memberOrgErr;
            orgRow = memberOrg || null;
          }
        }

        if (!orgRow?.id) {
          if (mounted) {
            setCoordinationOrg(null);
            setTeamAssignmentOptions([]);
          }
          return;
        }

        const { data: memberRows, error: memberErr } = await supabase
          .from("org_members")
          .select("org_id,user_id,member_role,created_at")
          .eq("org_id", orgRow.id)
          .order("created_at", { ascending: true });

        if (memberErr) throw memberErr;

        const memberIds = Array.from(
          new Set(
            [
              orgRow.owner_user_id,
              ...(memberRows || []).map((row) => row.user_id),
            ].filter(Boolean)
          )
        );
        const profilesById = {};

        if (memberIds.length > 0) {
          const { data: profileRows, error: profileErr } = await supabase
            .from("profiles")
            .select("id,email,display_name,full_name,username")
            .in("id", memberIds);
          if (profileErr) throw profileErr;
          (profileRows || []).forEach((profile) => {
            profilesById[profile.id] = profile;
          });
        }

        const options = memberIds
          .map((userId) =>
            buildTeamMemberAssignmentOption({
              userId,
              orgId: orgRow.id,
              label: memberLabel(profilesById[userId], userId),
              assetId,
              systemId,
            })
          )
          .filter(Boolean);

        if (mounted) {
          setCoordinationOrg(orgRow);
          setTeamAssignmentOptions(options);
        }
      } catch (error) {
        console.log("Coordination team lookup skipped:", error);
        if (mounted) {
          setCoordinationOrg(null);
          setTeamAssignmentOptions([]);
        }
      }
    }

    loadCoordinationTeam();
    return () => {
      mounted = false;
    };
  }, [assetId, ownerId, systemId]);

  useEffect(() => {
    if (isEdit || visibilityTouched) return;
    const launchedFromInbox = String(afterSave || "")
      .toLowerCase()
      .includes("notification");
    setVisibilityScope(
      coordinationOrg?.id && (assetId || launchedFromInbox) ? "team" : "private"
    );
  }, [afterSave, assetId, coordinationOrg?.id, isEdit, visibilityTouched]);

  const serviceOrgId =
    route?.params?.organizationId ||
    route?.params?.organization_id ||
    currentWorkspace?.organization_id ||
    currentWorkspace?.org_id ||
    baseExtraMeta?.visibility_org_id ||
    baseExtraMeta?.provider_target?.org_id ||
    null;

  useEffect(() => {
    let mounted = true;

    async function loadServiceTemplates() {
      if (!serviceOrgId) {
        setServiceTemplates([]);
        setServiceTemplateError(null);
        setServiceTemplatesLoading(false);
        return;
      }

      setServiceTemplatesLoading(true);
      setServiceTemplateError(null);
      try {
        const config = await getKeeprSpaceOrgConfig({ organizationId: serviceOrgId });
        const services = Array.isArray(config?.service_offerings)
          ? config.service_offerings
          : [];
        const activeServices = services.filter((service) => {
          const status = String(service?.status || "active").toLowerCase();
          return status !== "inactive" && status !== "archived";
        });
        if (mounted) setServiceTemplates(activeServices);
      } catch (error) {
        if (mounted) {
          setServiceTemplates([]);
          setServiceTemplateError(
            initialServiceSnapshot
              ? null
              : error?.message || "Could not load service templates."
          );
        }
      } finally {
        if (mounted) setServiceTemplatesLoading(false);
      }
    }

    loadServiceTemplates();
    return () => {
      mounted = false;
    };
  }, [serviceOrgId]);

  const selectedServiceTemplate = useMemo(() => {
    if (!selectedServiceKey) return null;
    return (
      serviceTemplates.find((service) => {
        const keys = [
          service.id,
          service.slug,
          service.service_key,
          service.key,
          service.name,
          service.owner_facing_label,
        ]
          .filter(Boolean)
          .map(String);
        return keys.includes(String(selectedServiceKey));
      }) || null
    );
  }, [selectedServiceKey, serviceTemplates]);

  const selectedServiceSnapshot = useMemo(
    () => buildServiceTemplateSnapshot(selectedServiceTemplate),
    [selectedServiceTemplate]
  );

  const effectiveServiceSnapshot = useMemo(() => {
    if (selectedServiceSnapshot) return selectedServiceSnapshot;
    if (actionType !== "service") return null;
    return (
      baseExtraMeta?.service_template_snapshot ||
      baseExtraMeta?.serviceTemplateSnapshot ||
      initialServiceSnapshot ||
      null
    );
  }, [actionType, baseExtraMeta, initialServiceSnapshot, selectedServiceSnapshot]);

  const selectServiceTemplate = useCallback(
    (service) => {
      const snapshot = buildServiceTemplateSnapshot(service);
      if (!snapshot) return;
      setActionType("service");
      setSelectedServiceKey(snapshot.key || snapshot.id || snapshot.name);
      setTitle((current) => current || snapshot.label || snapshot.name || "Service");
      setNotes((current) => current || snapshot.owner_facing_description || "");
      if (snapshot.interval_trigger && !repeatRule) {
        setRepeatRule(snapshot.interval_trigger);
      }
    },
    [repeatRule]
  );

  /* ---------------------- asset + system names ------------------------ */

  useEffect(() => {
    let mounted = true;

    async function fetchAssetName() {
      if (!ownerId || !assetId) {
        if (mounted) setAssetName("");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("assets")
          .select("id,name")
          .eq("id", assetId)
          .limit(1);

        if (!mounted) return;
        if (!error && data && data.length > 0) {
          setAssetName(data[0].name || "");
        }
      } catch (e) {
        if (mounted) console.log("fetchAssetName error:", e);
      }
    }

    fetchAssetName();
    return () => {
      mounted = false;
    };
  }, [ownerId, assetId]);

  useEffect(() => {
    let mounted = true;

    async function fetchSystemName() {
      if (!assetId || !systemId) {
        if (mounted) setSystemName("");
        return;
      }

      try {
        const { data, error } = await supabase
          .from("systems")
          .select("id,name")
          .eq("id", systemId)
          .limit(1);

        if (!mounted) return;
        if (!error && data && data.length > 0) {
          setSystemName(data[0].name || "");
        }
      } catch (e) {
        if (mounted) console.log("fetchSystemName error:", e);
      }
    }

    fetchSystemName();
    return () => {
      mounted = false;
    };
  }, [assetId, systemId]);

  /* ---------------------- open action context ------------------------- */

  useEffect(() => {
    let mounted = true;

    async function loadActionContext() {
      if (!ownerId || (!assetId && !systemId && !reminderIdFromRoute)) {
        if (mounted) {
          setActionContext({
            loading: false,
            recentRecordCount: 0,
            proofAttachmentCount: 0,
            reminderAttachmentCount: 0,
            latestRecordTitle: null,
            errors: [],
          });
        }
        return;
      }

      if (mounted) {
        setActionContext((prev) => ({ ...prev, loading: true, errors: [] }));
      }

      const errors = [];
      const safeCount = async (label, query) => {
        try {
          const { count, error } = await query;
          if (error) {
            errors.push(`${label}: ${error.message || String(error)}`);
            return 0;
          }
          return count || 0;
        } catch (error) {
          errors.push(`${label}: ${error?.message || String(error)}`);
          return 0;
        }
      };

      try {
        const serviceQuery = supabase
          .from("service_records")
          .select("id,title,performed_at,created_at", { count: "exact" })
          .order("performed_at", { ascending: false, nullsFirst: false })
          .order("created_at", { ascending: false })
          .limit(5);

        const scopedServiceQuery = systemId
          ? serviceQuery.eq("system_id", systemId)
          : assetId
          ? serviceQuery.eq("asset_id", assetId)
          : null;

        const servicePromise = scopedServiceQuery
          ? scopedServiceQuery
          : Promise.resolve({ data: [], count: 0, error: null });

        const proofTargets = [
          assetId ? { type: "asset", id: assetId } : null,
          systemId ? { type: "system", id: systemId } : null,
        ].filter(Boolean);

        const proofCountPromise = proofTargets.length
          ? Promise.all(
              proofTargets.map((target) =>
                safeCount(
                  `${target.type}_attachments`,
                  supabase
                    .from("attachment_placements")
                    .select("id", { count: "exact", head: true })
                    .eq("target_type", target.type)
                    .eq("target_id", target.id)
                )
              )
            ).then((counts) => counts.reduce((sum, count) => sum + count, 0))
          : Promise.resolve(0);

        const reminderAttachmentPromise = reminderIdFromRoute
          ? safeCount(
              "reminder_attachments",
              supabase
                .from("attachment_placements")
                .select("id", { count: "exact", head: true })
                .eq("target_type", "reminder")
                .eq("target_id", reminderIdFromRoute)
            )
          : Promise.resolve(0);

        const [
          { data: recentRecords, count: recentRecordCount, error: recordErr },
          proofAttachmentCount,
          reminderAttachmentCount,
        ] = await Promise.all([
          servicePromise,
          proofCountPromise,
          reminderAttachmentPromise,
        ]);

        if (recordErr) {
          errors.push(`service_records: ${recordErr.message || String(recordErr)}`);
        }

        if (mounted) {
          setActionContext({
            loading: false,
            recentRecordCount: recentRecordCount || recentRecords?.length || 0,
            proofAttachmentCount,
            reminderAttachmentCount,
            latestRecordTitle: recentRecords?.[0]?.title || null,
            errors,
          });
        }
      } catch (error) {
        if (mounted) {
          setActionContext({
            loading: false,
            recentRecordCount: 0,
            proofAttachmentCount: 0,
            reminderAttachmentCount: 0,
            latestRecordTitle: null,
            errors: [error?.message || String(error)],
          });
        }
      }
    }

    loadActionContext();
    return () => {
      mounted = false;
    };
  }, [ownerId, assetId, systemId, reminderIdFromRoute]);

  /* ---------------------- assignment options ------------------------- */

  useEffect(() => {
    let mounted = true;

    async function loadAssignmentOptions() {
      const baseOptions = [
        buildTeamAssignmentOption({
          orgId: coordinationOrg?.id || null,
          assetId,
          systemId,
        }),
        ...(teamAssignmentOptions || []),
      ];

      if (!ownerId) {
        if (mounted) {
          setAssignmentOptions(baseOptions);
          setProviderOptions([]);
        }
        return;
      }

      setAssignmentLoading(true);
      try {
        const systemPromise = systemId
          ? supabase
              .from("systems")
              .select("id,name,asset_id,metadata,extra_metadata")
              .eq("id", systemId)
              .limit(1)
              .maybeSingle()
          : Promise.resolve({ data: null, error: null });

        const prosPromise = loadMyKeeprProsForPicker()
          .then((data) => ({ data, error: null }))
          .catch((error) => ({ data: [], error }));

        const [
          { data: systemRow, error: systemErr },
          { data: proRows, error: prosErr },
        ] = await Promise.all([systemPromise, prosPromise]);

        if (systemErr) console.log("Assignment system lookup skipped:", systemErr);
        if (prosErr) console.log("Assignment KeeprPro lookup skipped:", prosErr);

        const systemKeeprProIds = systemErr
          ? []
          : extractSystemKeeprProIds(systemRow);
        const proOptions = prosErr
          ? []
          : buildKeeprProAssignmentOptions({
              keeprPros: proRows || [],
              systemKeeprProIds,
              assetId,
              systemId,
            });

        if (mounted) {
          setAssignmentOptions(baseOptions);
          setProviderOptions(proOptions);
        }
      } catch (e) {
        console.log("loadAssignmentOptions error:", e);
        if (mounted) {
          setAssignmentOptions(baseOptions);
          setProviderOptions([]);
        }
      } finally {
        if (mounted) setAssignmentLoading(false);
      }
    }

    loadAssignmentOptions();
    return () => {
      mounted = false;
    };
  }, [ownerId, assetId, systemId, coordinationOrg?.id, teamAssignmentOptions]);

  /* ---------------------- link modal loaders ------------------------- */

  const loadSystemsForAsset = useCallback(
    async (targetAssetId) => {
      if (!targetAssetId) {
        setSystems([]);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("systems")
          .select("id,name,asset_id")
          .eq("asset_id", targetAssetId)
          .order("name", { ascending: true });

        if (error) {
          console.log("loadSystemsForAsset error:", error);
          setSystems([]);
        } else {
          setSystems(data || []);
        }
      } catch (e) {
        console.log("loadSystemsForAsset error:", e);
        setSystems([]);
      }
    },
    []
  );

  const loadAssetsAndSystems = useCallback(async () => {
    if (!ownerId) return;

    setLinkLoading(true);
      try {
        const { data: aRows, error: aErr } = await supabase
          .from("assets")
          .select("id,name,type,status,deleted_at")
          .is("deleted_at", null)
          .not("status", "eq", "archived")
          .order("name", { ascending: true });

      if (aErr) throw aErr;
      setAssets(aRows || []);

      if (assetId) {
        await loadSystemsForAsset(assetId);
      } else {
        setSystems([]);
      }
    } catch (e) {
      console.log("CreateReminder load context error:", e);
      Alert.alert(
        "Couldn’t load assets",
        e?.message || "Please try again."
      );
    } finally {
      setLinkLoading(false);
    }
  }, [ownerId, assetId, loadSystemsForAsset]);

  const openLinkModal = useCallback(() => {
    setLinkModalOpen(true);
    loadAssetsAndSystems();
  }, [loadAssetsAndSystems]);

  const filteredAssets = useMemo(() => {
    const q = assetSearch.trim().toLowerCase();
    if (!q) return assets;
    return (assets || []).filter((a) =>
      String(a?.name || "").toLowerCase().includes(q)
    );
  }, [assets, assetSearch]);

  const filteredSystems = useMemo(() => {
    const q = systemSearch.trim().toLowerCase();
    if (!q) return systems;
    return (systems || []).filter((s) =>
      String(s?.name || "").toLowerCase().includes(q)
    );
  }, [systems, systemSearch]);

  const selectAsset = useCallback(
    (a) => {
      const newId = a?.id || null;
      setAssetId(newId);
      setAssetName(a?.name || "");
      setSystemId(null);
      setSystemName("");
      loadSystemsForAsset(newId);
    },
    [loadSystemsForAsset]
  );

  const selectSystem = useCallback((s) => {
    setSystemId(s?.id || null);
    setSystemName(s?.name || "");
  }, []);

  const selectAssignmentOption = useCallback((option) => {
    const target = option?.target || null;
    setAssignmentTarget(target);
    setAssignedTo(
      target?.type === "unassigned" ? "" : target?.label || option?.label || ""
    );
  }, []);

  const clearAssignment = useCallback(() => {
    setAssignmentTarget(null);
    setAssignedTo("");
  }, []);

  const updateManualAssignment = useCallback((value) => {
    setAssignmentTarget(null);
    setAssignedTo(value);
  }, []);

  const selectProviderOption = useCallback((option) => {
    setProviderTarget(option?.target || null);
    setProviderPickerOpen(false);
    setProviderSearch("");
  }, []);

  const clearProvider = useCallback(() => {
    setProviderTarget(null);
    setProviderPickerOpen(false);
    setProviderSearch("");
  }, []);

  const filteredProviderOptions = useMemo(() => {
    const q = providerSearch.trim().toLowerCase();
    if (!q) return providerOptions;
    return (providerOptions || []).filter((option) =>
      [option?.label, option?.detail]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [providerOptions, providerSearch]);

  const providerContextWarning = useMemo(() => {
    if (!assetId && !systemId) {
      return providerTarget
        ? "KeeprPro involvement is intended for asset or system Actions. Link an asset or system to keep this provider in context."
        : "";
    }
    if (!providerTarget) return "";

    const providerAssetId = providerTarget.asset_id || null;
    const providerSystemId = providerTarget.system_id || null;
    const tiedToDifferentAsset =
      providerAssetId && assetId && providerAssetId !== assetId;
    const tiedToDifferentSystem =
      providerSystemId && systemId && providerSystemId !== systemId;
    const missingFromContextOptions = !(providerOptions || []).some((option) => {
      const target = option?.target || {};
      return (
        target.type === providerTarget.type &&
        String(target.id || "") === String(providerTarget.id || "")
      );
    });

    if (tiedToDifferentAsset || tiedToDifferentSystem || missingFromContextOptions) {
      return "Selected provider is not tied to the current asset or system. You can keep it or choose another provider.";
    }

    return "";
  }, [assetId, providerOptions, providerTarget, systemId]);

  const assignmentSharingWarning = useMemo(() => {
    if (visibilityScope !== "team") return "";
    if (assetId || coordinationOrg?.id) return "";
    return "Create or join a Team to share this Action. Without a Team, this stays private.";
  }, [assetId, coordinationOrg?.id, visibilityScope]);

  const actionContextType = useMemo(() => {
    if (systemId) return "system";
    if (assetId) return "asset";
    return visibilityScope === "team" ? "household" : "personal";
  }, [assetId, systemId, visibilityScope]);

  const actionContextLabel = useMemo(() => {
    if (actionContextType === "system") return "System";
    if (actionContextType === "asset") return "Asset";
    if (actionContextType === "household") return "Team coordination";
    return "Personal";
  }, [actionContextType]);

  const isCompleted = String(status || "").toLowerCase() === "completed";
  const hasCompletionReviewContext =
    !!assetId ||
    !!systemId ||
    !!providerTarget ||
    visibilityScope === "team" ||
    assignmentTarget?.type === "team_member" ||
    assignmentTarget?.type === "team" ||
    String(assignedTo || "").trim().toLowerCase() === "team";

  const completionProofLabel = useMemo(() => {
    const meta = baseExtraMeta || {};
    if (String(status || "").toLowerCase() !== "completed") return null;
    if (meta.linked_service_record_id) {
      return meta.completion_source === "created_service_record"
        ? "Timeline entry created"
        : "Proof linked";
    }
    if (meta.completion_source === "manual_no_timeline") {
      return "Completed without timeline";
    }
    return "Completed";
  }, [baseExtraMeta, status]);

  const completionProofDetail = useMemo(() => {
    const meta = baseExtraMeta || {};
    const workDate = meta.work_completed_on || meta.actual_completed_date;
    const bits = [
      workDate ? `Work completed ${String(workDate).slice(0, 10)}` : null,
      meta.linked_timeline_record_title || null,
      meta.linked_record_proof_count
        ? `${meta.linked_record_proof_count} proof file${
            meta.linked_record_proof_count === 1 ? "" : "s"
          }`
        : null,
      meta.recurrence_next_due_at
        ? `Next due ${String(meta.recurrence_next_due_at).slice(0, 10)}`
        : meta.recurrence_status === "unparseable_repeat_rule"
        ? "Repeat needs review"
        : null,
      !workDate && meta.linked_timeline_record_date
        ? String(meta.linked_timeline_record_date).slice(0, 10)
        : null,
    ].filter(Boolean);
    return bits.join(" • ");
  }, [baseExtraMeta]);

  /* ---------------------- date helpers ------------------------------- */

  const applyQuickDue = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
      d.getDate()
    )}`;
    setDueDateISO(iso);
    setScheduleTouched(true);
  };

  const updateDueDateISO = (value) => {
    setDueDateISO(value);
    setScheduleTouched(true);
  };

  const updateTimeText = (value) => {
    setTimeText(value);
    setScheduleTouched(true);
  };

  const toggleHasTime = () => {
    setHasTime((v) => !v);
    setScheduleTouched(true);
  };

  const buildDueAtISO = () => {
  const isoDate = dueDateISO || todayISO();
  const [yyyy, mm, dd] = isoDate.split("-").map((x) => Number(x));
  const d = new Date();
  d.setFullYear(yyyy, mm - 1, dd);

  if (hasTime) {
    const normalized = normalizeTimeText(timeText) || "09:00";
    const [hh, min] = normalized.split(":").map(Number);
    d.setHours(hh, min, 0, 0);
  } else {
    d.setHours(0, 0, 0, 0);
  }

  return d.toISOString();
};

const normalizeTimeText = (value) => {
  const raw = String(value || "").trim().toLowerCase();

  let m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (m) {
    const hh = Number(m[1]);
    const mm = Number(m[2]);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${pad2(hh)}:${pad2(mm)}`;
    }
  }

  m = raw.match(/^(\d{3,4})$/);
  if (m) {
    const num = m[1];
    const hh = Number(num.slice(0, num.length - 2));
    const mm = Number(num.slice(-2));
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
      return `${pad2(hh)}:${pad2(mm)}`;
    }
  }

  m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m) {
    let hh = Number(m[1]);
    const mm = Number(m[2] || "0");
    const period = m[3];

    if (hh >= 1 && hh <= 12 && mm >= 0 && mm <= 59) {
      if (period === "pm" && hh !== 12) hh += 12;
      if (period === "am" && hh === 12) hh = 0;
      return `${pad2(hh)}:${pad2(mm)}`;
    }
  }

  return null;
};

const getCompletionRecordDate = (record) =>
  record?.performed_at || record?.created_at || null;

const getCompletionRecordDateISO = (record) => {
  const raw = getCompletionRecordDate(record);
  if (!raw) return todayISO();
  return String(raw).slice(0, 10);
};

const getCompletionRecordContext = (record, fallbackAssetName, fallbackSystemName) => {
  const bits = [];
  if (record?._assetLabel || fallbackAssetName) {
    bits.push(record?._assetLabel || fallbackAssetName);
  }
  if (record?._systemLabel || (record?.system_id && fallbackSystemName)) {
    bits.push(record?._systemLabel || fallbackSystemName);
  }
  return bits.join(" • ");
};

const formatCompletionRecordDate = (record) => {
  const raw = getCompletionRecordDate(record);
  if (!raw) return "";
  try {
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) return String(raw).slice(0, 10);
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return String(raw).slice(0, 10);
  }
};

const buildCompletionMetadata = useCallback(
  ({
    source,
    record = null,
    preserveCompleted = false,
    workDate = null,
  } = {}) => {
    const existing = preserveCompleted ? baseExtraMeta || {} : {};
    const actualWorkDate =
      workDate ||
      (record ? getCompletionRecordDateISO(record) : null) ||
      existing.work_completed_on ||
      todayISO();
    return {
      completed_by_user_id: existing.completed_by_user_id || ownerId,
      completed_by_label:
        existing.completed_by_label ||
        user?.email ||
        user?.user_metadata?.name ||
        "Owner",
      completed_at: existing.completed_at || new Date().toISOString(),
      proof_updated_at: preserveCompleted ? new Date().toISOString() : null,
      completion_source: source || "manual_no_timeline",
      completion_record_type: record?.id ? "service_record" : null,
      linked_source_type: record?.id ? "service_record" : null,
      linked_source: record?.id
        ? {
            sourceType: "service_record",
            serviceRecordId: record.id,
          }
        : null,
      linked_service_record_id: record?.id || null,
      linked_timeline_record_id: record?.id || null,
      linked_timeline_record_title: record?.title || null,
      linked_timeline_record_date: getCompletionRecordDate(record),
      linked_record_asset_id: record?.asset_id || null,
      linked_record_system_id: record?.system_id || null,
      linked_record_proof_count: record?._proofCount || null,
      work_completed_on: actualWorkDate,
      actual_completed_date: actualWorkDate,
      asset_id: assetId || null,
      system_id: systemId || null,
      assignment_target: assignmentTarget || null,
      provider_target: providerTarget || null,
    };
  },
  [
    baseExtraMeta,
    ownerId,
    user,
    assetId,
    systemId,
    assignmentTarget,
    providerTarget,
  ]
);

const loadCompletionCandidates = useCallback(async () => {
  if (!ownerId || !assetId) return [];

  const diagnostics = {
    reminder_id: reminderIdFromRoute || null,
    reminder_asset_id: assetId || null,
    reminder_system_id: systemId || null,
    provider_target: providerTarget || null,
    service_records_fetched: 0,
    same_asset_count: 0,
    same_system_count: 0,
    other_recent_count: 0,
    query_errors: [],
  };

  try {
    const fetchServiceRecords = async (sameAssetOnly = true) => {
      let query = supabase
      .from("service_records")
        .select("*")
        .order("performed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(sameAssetOnly ? 100 : 40);

      if (sameAssetOnly) query = query.eq("asset_id", assetId);
      const { data, error } = await query;
      if (error) {
        diagnostics.query_errors.push(
          `${sameAssetOnly ? "same_asset" : "other_recent"}: ${
            error.message || String(error)
          }`
        );
        return [];
      }
      return data || [];
    };

    let rows = await fetchServiceRecords(true);
    let includeOtherRecent = false;
    if (!rows.length) {
      includeOtherRecent = true;
      rows = await fetchServiceRecords(false);
    }
    diagnostics.service_records_fetched = rows.length;
    diagnostics.same_asset_count = rows.filter(
      (record) => record.asset_id === assetId
    ).length;
    diagnostics.same_system_count = rows.filter(
      (record) => systemId && record.system_id === systemId
    ).length;
    diagnostics.other_recent_count = includeOtherRecent
      ? rows.filter((record) => record.asset_id !== assetId).length
      : 0;

    const serviceIds = rows.map((record) => record.id).filter(Boolean);
    const systemIds = Array.from(
      new Set(rows.map((record) => record.system_id).filter(Boolean))
    );
    const assetIds = Array.from(
      new Set(rows.map((record) => record.asset_id).filter(Boolean))
    );

    const safeQuery = async (label, query) => {
      try {
        const result = await query;
        if (result?.error) {
          diagnostics.query_errors.push(
            `${label}: ${result.error.message || String(result.error)}`
          );
          return { data: [], error: result.error };
        }
        return result || { data: [], error: null };
      } catch (error) {
        diagnostics.query_errors.push(
          `${label}: ${error?.message || String(error)}`
        );
        return { data: [], error };
      }
    };

    const [storyRes, placementRes, systemsRes, assetsRes] = await Promise.all([
      serviceIds.length
        ? safeQuery(
            "story_events",
            supabase
              .from("story_events")
              .select("id,title,metadata,service_record_id,event_type,occurred_at,created_at")
              .in("service_record_id", serviceIds)
          )
        : Promise.resolve({ data: [], error: null }),
      serviceIds.length
        ? safeQuery(
            "attachment_placements",
            supabase
              .from("attachment_placements")
              .select("id,target_id")
              .eq("target_type", "service_record")
              .in("target_id", serviceIds)
          )
        : Promise.resolve({ data: [], error: null }),
      systemIds.length
        ? safeQuery(
            "systems",
            supabase.from("systems").select("id,name").in("id", systemIds)
          )
        : Promise.resolve({ data: [], error: null }),
      assetIds.length
        ? safeQuery(
            "assets",
            supabase.from("assets").select("id,name").in("id", assetIds)
          )
        : Promise.resolve({ data: [], error: null }),
    ]);

    const storyByServiceId = {};
    if (!storyRes.error) {
      (storyRes.data || []).forEach((story) => {
        const sid =
          story.service_record_id ||
          story.metadata?.service_record_id ||
          story.metadata?.serviceRecordId;
        if (sid && !storyByServiceId[sid]) storyByServiceId[sid] = story;
      });
    }

    const proofCountByRecordId = {};
    if (!placementRes.error) {
      (placementRes.data || []).forEach((placement) => {
        if (!placement.target_id) return;
        proofCountByRecordId[placement.target_id] =
          (proofCountByRecordId[placement.target_id] || 0) + 1;
      });
    }

    const systemLabelById = {};
    if (!systemsRes.error) {
      (systemsRes.data || []).forEach((system) => {
        if (system.id) systemLabelById[system.id] = system.name || "System";
      });
    }

    const assetLabelById = {};
    if (!assetsRes.error) {
      (assetsRes.data || []).forEach((asset) => {
        if (asset.id) assetLabelById[asset.id] = asset.name || "Asset";
      });
    }

    const providerId =
      providerTarget?.type === "keepr_pro" ? providerTarget.id : null;
    const providerLabel = String(providerTarget?.label || "").toLowerCase();
    const queryText = `${title || ""} ${notes || ""} ${providerLabel || ""} ${
      systemName || ""
    }`.toLowerCase();
    const targetDate = new Date(workCompletedOn || dueDateISO || todayISO());
    const targetTime = Number.isNaN(targetDate.getTime())
      ? Date.now()
      : targetDate.getTime();

    const ranked = (rows || [])
      .map((record) => {
        const story = storyByServiceId[record.id];
        const displayTitle = record.title || story?.title || "Timeline record";
        const proofCount = proofCountByRecordId[record.id] || 0;
        const sameSystem = !!systemId && record.system_id === systemId;
        const sameAsset = !!assetId && record.asset_id === assetId;
        const providerText = [
          record.provider,
          record.vendor,
          record.keepr_pro_name,
          record.performed_by,
          record.service_provider,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        let score = includeOtherRecent ? 0 : 1;
        if (sameSystem) score += 100;
        if (sameAsset) score += 50;
        if (providerId && record.keepr_pro_id === providerId) score += 25;
        if (
          providerLabel &&
          providerText &&
          providerText.includes(providerLabel)
        ) {
          score += 18;
        }

        const recordDate = new Date(getCompletionRecordDate(record) || "");
        if (!Number.isNaN(recordDate.getTime())) {
          const diffDays = Math.abs(
            Math.round((recordDate.getTime() - targetTime) / 86400000)
          );
          if (diffDays <= 7) score += 12;
          else if (diffDays <= 30) score += 8;
          else if (diffDays <= 90) score += 4;
        }

        const recordText = `${displayTitle || ""} ${record.notes || ""} ${
          story?.title || ""
        }`.toLowerCase();
        const titleWords = queryText
          .split(/\W+/)
          .filter((word) => word.length > 4)
          .slice(0, 10);
        score += titleWords.filter((word) => recordText.includes(word)).length * 3;
        if (proofCount > 0) score += 20;

        return {
          ...record,
          title: displayTitle,
          _assetLabel: assetLabelById[record.asset_id] || assetName || null,
          _systemLabel: systemLabelById[record.system_id] || null,
          _sourceLabel: "Service record",
          _proofCount: proofCount,
          _completionScore: score,
          _matchGroup: sameSystem
            ? "Best matches"
            : sameAsset
            ? "Same asset"
            : "Other recent records",
        };
      })
      .sort((a, b) => {
        if (b._completionScore !== a._completionScore) {
          return b._completionScore - a._completionScore;
        }
        return String(getCompletionRecordDate(b) || "").localeCompare(
          String(getCompletionRecordDate(a) || "")
        );
      })
      .slice(0, includeOtherRecent ? 40 : 100);

    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("Completion proof picker diagnostics", {
        ...diagnostics,
        ranked_count: ranked.length,
        top_records: ranked.slice(0, 5).map((record) => ({
          id: record.id,
          title: record.title,
          asset_id: record.asset_id,
          system_id: record.system_id,
          keepr_pro_id: record.keepr_pro_id,
          score: record._completionScore,
          group: record._matchGroup,
          proof_count: record._proofCount,
        })),
      });
    }

    return ranked;
  } catch (e) {
    console.log("Completion candidate lookup skipped:", e);
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.info("Completion proof picker diagnostics", {
        ...diagnostics,
        query_errors: [
          ...diagnostics.query_errors,
          e?.message || String(e),
        ],
      });
    }
    return [];
  }
}, [
  ownerId,
  assetId,
  systemId,
  providerTarget,
  title,
  notes,
  systemName,
  assetName,
  workCompletedOn,
  dueDateISO,
]);

  /* ---------------------- save / validate ---------------------------- */

const canSave = useMemo(
  () => !!title && !!ownerId && !!dueDateISO,
  [title, ownerId, dueDateISO]
);

  const validate = useCallback(() => {
    if (!ownerId) return "Not signed in.";
    if (!dueDateISO) return "Please select a date.";
    if (actionType === "service" && !effectiveServiceSnapshot) {
      return "Please select a Service template.";
    }
    if (!title.trim()) return "Title is required.";
    if (hasTime && !normalizeTimeText(timeText)) {
      return "Please enter time as HH:MM in 24-hour format.";
    }
    return null;
  }, [ownerId, dueDateISO, actionType, effectiveServiceSnapshot, title, hasTime, timeText]);

  const onSave = useCallback(
    async (nextStatus, completionMetadata = null) => {
      const msg = validate();
      if (msg) {
        Alert.alert("Check reminder", msg);
        return;
      }

      const dueAtISO = buildDueAtISO();
      const effectiveStatus = nextStatus || status || "open";

      setSaving(true);
      try {
        const extraMeta = {
          ...(baseExtraMeta || {}),
        };

        const effectiveVisibility =
          visibilityScope === "team" && coordinationOrg?.id
            ? "team"
            : "private";
        extraMeta.visibility_scope = effectiveVisibility;
        extraMeta.visibility_org_id =
          effectiveVisibility === "team" ? coordinationOrg?.id || null : null;
        extraMeta.action_context =
          systemId
            ? "system"
            : assetId
            ? "asset"
            : effectiveVisibility === "team"
            ? "household"
            : "personal";
        extraMeta.action_context_label =
          extraMeta.action_context === "household"
            ? "Team coordination"
            : extraMeta.action_context;

        if (actionType === "service" && effectiveServiceSnapshot) {
          extraMeta.action_type = "service";
          extraMeta.service_action = true;
          extraMeta.service_template_id = effectiveServiceSnapshot.id || null;
          extraMeta.service_template_key = effectiveServiceSnapshot.key || null;
          extraMeta.service_template_name = effectiveServiceSnapshot.name || null;
          extraMeta.service_template_label = effectiveServiceSnapshot.label || null;
          extraMeta.service_template_snapshot = effectiveServiceSnapshot;
          extraMeta.service_template_org_id = serviceOrgId || null;
        } else {
          if (extraMeta.action_type === "service") delete extraMeta.action_type;
          delete extraMeta.service_action;
          delete extraMeta.service_template_id;
          delete extraMeta.service_template_key;
          delete extraMeta.service_template_name;
          delete extraMeta.service_template_label;
          delete extraMeta.service_template_snapshot;
          delete extraMeta.service_template_org_id;
        }

        if (assignmentTarget?.type === "team_member") {
          const responsible = {
            ...assignmentTarget,
            label: assignedTo || assignmentTarget.label,
            org_id: assignmentTarget.org_id || coordinationOrg?.id || null,
            asset_id: assetId || assignmentTarget.asset_id || null,
            system_id:
              assignmentTarget.scope === "system"
                ? systemId || assignmentTarget.system_id || null
                : assignmentTarget.system_id || null,
          };
          extraMeta.responsible_party = responsible;
          extraMeta.assignment_target = responsible;
          extraMeta.assigned_to = responsible.label;
        } else if (assignmentTarget?.type === "unassigned" || !assignedTo) {
          extraMeta.responsible_party = {
            type: "unassigned",
            id: "unassigned",
            label: "Unassigned",
            org_id: coordinationOrg?.id || null,
            asset_id: assetId || null,
            system_id: systemId || null,
          };
          delete extraMeta.assignment_target;
          delete extraMeta.assigned_to;
        } else if (assignedTo) {
          extraMeta.assigned_to = assignedTo;
          extraMeta.responsible_party = {
            type: "manual",
            id: "manual",
            label: assignedTo,
            scope: assetId || systemId ? "asset" : null,
            asset_id: assetId || null,
            system_id: systemId || null,
          };
          extraMeta.assignment_target = {
            type: "manual",
            id: "manual",
            label: assignedTo,
            scope: assetId || systemId ? "asset" : null,
            asset_id: assetId || null,
            system_id: systemId || null,
          };
        }

        if (providerTarget) {
          extraMeta.provider_target = {
            ...providerTarget,
            asset_id: assetId || providerTarget.asset_id || null,
            system_id:
              providerTarget.scope === "system"
                ? systemId || providerTarget.system_id || null
                : providerTarget.system_id || null,
          };
        } else {
          delete extraMeta.provider_target;
        }

        const pendingPlaceholderDate = extraMeta.playbook_due_date_placeholder
          ? String(extraMeta.playbook_due_date_placeholder).slice(0, 10)
          : null;
        const hasChangedFromPendingPlaceholder =
          (extraMeta.playbook_due_date_pending === true ||
            extraMeta.playbook_due_date_pending === "true") &&
          pendingPlaceholderDate &&
          dueDateISO &&
          pendingPlaceholderDate !== dueDateISO;
        const isPlaybookAction =
          extraMeta.source === "keeprspace_playbook" ||
          extraMeta.playbook_id ||
          extraMeta.playbook_step_id;
        const normalizedScheduledTime = hasTime
          ? normalizeTimeText(timeText) || "09:00"
          : null;
        const shouldSyncPlaybookSchedule =
          Boolean(
            isPlaybookAction &&
              dueDateISO &&
              (scheduleTouched || hasChangedFromPendingPlaceholder)
          );

        if (shouldSyncPlaybookSchedule) {
          extraMeta.playbook_due_date_pending = false;
          delete extraMeta.playbook_due_date_placeholder;
          extraMeta.playbook_scheduled_date = dueDateISO;
          extraMeta.playbook_scheduled_time = normalizedScheduledTime;
          extraMeta.playbook_has_time = !!hasTime;
          extraMeta.schedule_state = "scheduled";
          extraMeta.due_time = normalizedScheduledTime;
        }

        if (effectiveStatus === "completed") {
          const completion =
            completionMetadata ||
            (baseExtraMeta?.completed_at
              ? {
                  completed_by_user_id:
                    baseExtraMeta.completed_by_user_id || ownerId,
                  completed_by_label:
                    baseExtraMeta.completed_by_label ||
                    user?.email ||
                    user?.user_metadata?.name ||
                    "Owner",
                  completed_at: baseExtraMeta.completed_at,
                  proof_updated_at: baseExtraMeta.proof_updated_at || null,
                  completion_source:
                    baseExtraMeta.completion_source || "manual_no_timeline",
                  completion_record_type:
                    baseExtraMeta.completion_record_type ||
                    (baseExtraMeta.linked_service_record_id
                      ? "service_record"
                      : null),
                  linked_source_type:
                    baseExtraMeta.linked_source_type ||
                    (baseExtraMeta.linked_service_record_id
                      ? "service_record"
                      : null),
                  linked_source:
                    baseExtraMeta.linked_source ||
                    (baseExtraMeta.linked_service_record_id
                      ? {
                          sourceType: "service_record",
                          serviceRecordId: baseExtraMeta.linked_service_record_id,
                        }
                      : null),
                  linked_service_record_id:
                    baseExtraMeta.linked_service_record_id || null,
                  linked_timeline_record_id:
                    baseExtraMeta.linked_timeline_record_id || null,
                  linked_timeline_record_title:
                    baseExtraMeta.linked_timeline_record_title || null,
                  linked_timeline_record_date:
                    baseExtraMeta.linked_timeline_record_date || null,
                  linked_record_proof_count:
                    baseExtraMeta.linked_record_proof_count || null,
                  work_completed_on:
                    baseExtraMeta.work_completed_on ||
                    baseExtraMeta.actual_completed_date ||
                    (baseExtraMeta.completed_at
                      ? String(baseExtraMeta.completed_at).slice(0, 10)
                      : null),
                  actual_completed_date:
                    baseExtraMeta.actual_completed_date ||
                    baseExtraMeta.work_completed_on ||
                    (baseExtraMeta.completed_at
                      ? String(baseExtraMeta.completed_at).slice(0, 10)
                      : null),
                  asset_id: assetId || baseExtraMeta.completion_asset_id || null,
                  system_id:
                    systemId || baseExtraMeta.completion_system_id || null,
                  assignment_target:
                    assignmentTarget ||
                    baseExtraMeta.completion_assignment_target ||
                    null,
                  provider_target:
                    providerTarget ||
                    baseExtraMeta.completion_provider_target ||
                    null,
                }
              : buildCompletionMetadata());
          extraMeta.completed_by_user_id = completion.completed_by_user_id;
          extraMeta.completed_by_label = completion.completed_by_label;
          extraMeta.completed_at = completion.completed_at;
          extraMeta.completion_source = completion.completion_source;
          extraMeta.completion_record_type = completion.completion_record_type;
          extraMeta.linked_source_type = completion.linked_source_type;
          extraMeta.linked_source = completion.linked_source;
          extraMeta.linked_service_record_id = completion.linked_service_record_id;
          extraMeta.linked_timeline_record_id = completion.linked_timeline_record_id;
          extraMeta.linked_timeline_record_title =
            completion.linked_timeline_record_title;
          extraMeta.linked_timeline_record_date =
            completion.linked_timeline_record_date;
          extraMeta.linked_record_proof_count =
            completion.linked_record_proof_count;
          extraMeta.work_completed_on = completion.work_completed_on;
          extraMeta.actual_completed_date = completion.actual_completed_date;
          if (completion.proof_updated_at) {
            extraMeta.proof_updated_at = completion.proof_updated_at;
          }
          extraMeta.completion_asset_id = completion.asset_id;
          extraMeta.completion_system_id = completion.system_id;
          extraMeta.completion_assignment_target = completion.assignment_target;
          extraMeta.completion_provider_target = completion.provider_target;
          if (repeatRule && !extraMeta.recurrence_next_reminder_id) {
            extraMeta.recurrence_status = "pending_next_occurrence";
          }
        }

        const payload = {
          owner_id: reminderIdFromRoute ? reminderOwnerId || ownerId : ownerId,
          title: title.trim(),
          notes: notes || null,
          url: prefill.url || null,
          due_at: dueAtISO,
          has_time: !!hasTime,
          is_urgent: !!isUrgent,
          repeat_rule: repeatRule || null,
          status: effectiveStatus,
          asset_id: assetId || null,
          system_id: systemId || null,
          record_id: recordId || null,
          event_id: eventId || null,
          extra_metadata: extraMeta,
        };

        let savedId = reminderIdFromRoute;

        if (reminderIdFromRoute) {
          const { data, error } = await supabase
            .from("reminders")
            .update({
              ...payload,
              updated_at: new Date().toISOString(),
            })
            .eq("id", reminderIdFromRoute)
            .select("id")
            .single();

          if (error && effectiveStatus === "completed" && completionMetadata) {
            const completed = await completeSharedCoordinationAction({
              reminderId: reminderIdFromRoute,
              completionMetadata,
            });
            savedId = completed?.id || reminderIdFromRoute;
          } else if (error) {
            throw error;
          } else {
          savedId = data?.id;
          }
        } else {
          const { data, error } = await supabase
            .from("reminders")
            .insert({
              ...payload,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .select("id")
            .single();

          if (error) throw error;
          savedId = data?.id;
        }

        if (shouldSyncPlaybookSchedule && extraMeta.playbook_step_id) {
          const { data: stepRow, error: stepLookupError } = await supabase
            .from("playbook_steps")
            .select("metadata")
            .eq("id", extraMeta.playbook_step_id)
            .maybeSingle();

          if (stepLookupError) throw stepLookupError;

          const nextStepMetadata = {
            ...((stepRow?.metadata && typeof stepRow.metadata === "object"
              ? stepRow.metadata
              : {}) || {}),
            due_time: normalizedScheduledTime,
            schedule_state: "scheduled",
            scheduled_from_action_id: savedId || reminderIdFromRoute || null,
            scheduled_from_action_at: new Date().toISOString(),
          };

          const { error: stepUpdateError } = await supabase
            .from("playbook_steps")
            .update({
              due_date: dueDateISO,
              metadata: nextStepMetadata,
              updated_at: new Date().toISOString(),
            })
            .eq("id", extraMeta.playbook_step_id);

          if (stepUpdateError) throw stepUpdateError;
        }

        if (
          effectiveStatus === "completed" &&
          repeatRule &&
          (completionMetadata || String(status || "").toLowerCase() !== "completed")
        ) {
          try {
            const recurrenceResult = await ensureNextReminderOccurrence({
              ownerId,
              completedReminder: {
                id: savedId,
                ...payload,
                extra_metadata: extraMeta,
              },
              workCompletedOn:
                extraMeta.work_completed_on || extraMeta.actual_completed_date,
            });

            if (recurrenceResult?.reminderId) {
              const recurrenceMeta = {
                ...extraMeta,
                recurrence_status: recurrenceResult.created
                  ? "next_occurrence_created"
                  : "next_occurrence_reused",
                recurrence_next_reminder_id: recurrenceResult.reminderId,
                recurrence_occurrence_key:
                  recurrenceResult.occurrenceKey || null,
                recurrence_next_due_at: recurrenceResult.dueAt || null,
                recurrence_last_checked_at: new Date().toISOString(),
              };

              const { error: recurrenceUpdateError } = await supabase
                .from("reminders")
                .update({
                  extra_metadata: recurrenceMeta,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", savedId);

              if (!recurrenceUpdateError) {
                Object.assign(extraMeta, recurrenceMeta);
              } else {
                console.log(
                  "Reminder recurrence metadata update skipped:",
                  recurrenceUpdateError
                );
              }

              const nextPushBody = [
                assignedTo,
                providerTarget?.label,
                assetName,
                systemName,
              ]
                .filter(Boolean)
                .join(" • ");
              await scheduleReminderPushNotification({
                reminderId: recurrenceResult.reminderId,
                title: title.trim(),
                body: nextPushBody || "Tap to open in Keepr",
                dueAtISO: recurrenceResult.dueAt,
              });
            } else if (recurrenceResult?.reason) {
              const recurrenceMeta = {
                ...extraMeta,
                recurrence_status: recurrenceResult.reason,
                recurrence_last_checked_at: new Date().toISOString(),
              };
              await supabase
                .from("reminders")
                .update({
                  extra_metadata: recurrenceMeta,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", savedId)
                .then(({ error }) => {
                  if (error) {
                    console.log("Reminder recurrence note skipped:", error);
                    return;
                  }
                  Object.assign(extraMeta, recurrenceMeta);
                });
            }
          } catch (error) {
            console.log("Next reminder occurrence skipped:", error);
          }
        }

        if (effectiveStatus === "open") {
          const shouldNotifyAssignment =
            !!assignmentTarget &&
            (!isEdit ||
              !isSameAssignmentTarget(
                assignmentTarget,
                baseExtraMeta?.assignment_target
              ));

          await createReminderWebNotifications({
            ownerId,
            reminderId: savedId,
            title: title.trim(),
            dueAtISO,
            assignmentTarget: extraMeta.assignment_target || null,
            assetName,
            systemName,
            shouldNotifyAssignment,
          });

          const pushBody = [assignedTo, providerTarget?.label, assetName, systemName]
            .filter(Boolean)
            .join(" • ");
          await scheduleReminderPushNotification({
            reminderId: savedId,
            title: title.trim(),
            body: pushBody || "Tap to open in Keepr",
            dueAtISO,
          });
        } else if (savedId) {
          await cancelReminderPushNotification(savedId);
        }

        setStatus(effectiveStatus);

        navigation.navigate(afterSave, {
          ...(afterSaveParams || {}),
          reopenReminderId: savedId,
        });
      } catch (e) {
        console.log("Save reminder error:", e);
        Alert.alert(
          "Couldn’t save reminder",
          e?.message || "Please try again."
        );
      } finally {
        setSaving(false);
      }
    },
    [
      validate,
      buildDueAtISO,
      buildCompletionMetadata,
      ensureNextReminderOccurrence,
      baseExtraMeta,
      assignedTo,
      assignmentTarget,
      providerTarget,
      ownerId,
      reminderOwnerId,
      visibilityScope,
      coordinationOrg?.id,
      title,
      notes,
      prefill,
      dueDateISO,
      hasTime,
      timeText,
      scheduleTouched,
      isUrgent,
      repeatRule,
      assetId,
      systemId,
      recordId,
      eventId,
      reminderIdFromRoute,
      afterSave,
      afterSaveParams,
      navigation,
      status,
      isEdit,
      assetName,
      systemName,
      actionType,
      effectiveServiceSnapshot,
      serviceOrgId,
    ]
  );

  const handleMarkComplete = useCallback(() => {
    if (isCompleted) return;
    if (saving || completionLoading) return;

    (async () => {
      setCompletionLoading(true);
      try {
        const candidates = await loadCompletionCandidates();
        setCompletionCandidates(candidates);
        setSelectedCompletionRecordId(candidates[0]?.id || null);
        setCompletionRecordSearch("");
        setWorkCompletedOn(
          candidates[0] ? getCompletionRecordDateISO(candidates[0]) : todayISO()
        );
        setCompletionMode("complete");

        if (hasCompletionReviewContext) {
          setCompletionCandidates(candidates);
          setCompletionPickerOpen(true);
          return;
        }

        await onSave("completed", buildCompletionMetadata());
      } finally {
        setCompletionLoading(false);
      }
    })();
  }, [
    saving,
    isCompleted,
    completionLoading,
    loadCompletionCandidates,
    hasCompletionReviewContext,
    onSave,
    buildCompletionMetadata,
  ]);

  const selectedCompletionRecord = useMemo(
    () =>
      completionCandidates.find((record) => record.id === selectedCompletionRecordId) ||
      completionCandidates[0] ||
      null,
    [completionCandidates, selectedCompletionRecordId]
  );

  const filteredCompletionRecords = useMemo(() => {
    const q = completionRecordSearch.trim().toLowerCase();
    if (!q) return completionCandidates;
    return (completionCandidates || []).filter((record) =>
      [
        record?.title,
        record?.notes,
        record?.provider,
        record?._sourceLabel,
        record?._assetLabel,
        record?._systemLabel,
        record?.service_type,
        getCompletionRecordDate(record),
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(q))
    );
  }, [completionCandidates, completionRecordSearch]);

  const groupedCompletionRecords = useMemo(() => {
    const groups = [
      { key: "best", label: "Best matches", rows: [] },
      { key: "asset", label: "Same asset", rows: [] },
      { key: "other", label: "Other recent records", rows: [] },
    ];
    const byLabel = new Map(groups.map((group) => [group.label, group]));
    (filteredCompletionRecords || []).forEach((record) => {
      const group =
        byLabel.get(record?._matchGroup) ||
        byLabel.get(record?.asset_id === assetId ? "Same asset" : "Other recent records");
      group.rows.push(record);
    });
    return groups.filter((group) => group.rows.length > 0);
  }, [filteredCompletionRecords, assetId]);

  const selectCompletionRecord = useCallback((record) => {
    setSelectedCompletionRecordId(record?.id || null);
    if (record) setWorkCompletedOn(getCompletionRecordDateISO(record));
  }, []);

  const completeWithLinkedRecord = useCallback(async () => {
    if (!selectedCompletionRecord || saving) return;
    const enrich = completionMode === "enrich";
    setCompletionPickerOpen(false);
    await onSave(
      "completed",
      buildCompletionMetadata({
        source: "linked_service_record",
        record: selectedCompletionRecord,
        preserveCompleted: enrich,
        workDate: workCompletedOn,
      })
    );
  }, [
    selectedCompletionRecord,
    saving,
    completionMode,
    workCompletedOn,
    onSave,
    buildCompletionMetadata,
  ]);

  const completeWithoutTimeline = useCallback(async () => {
    if (saving) return;
    const enrich = completionMode === "enrich";
    setCompletionPickerOpen(false);
    await onSave(
      "completed",
      buildCompletionMetadata({
        source: "manual_no_timeline",
        preserveCompleted: enrich,
        workDate: workCompletedOn,
      })
    );
  }, [saving, completionMode, workCompletedOn, onSave, buildCompletionMetadata]);

  const findExistingCompletionServiceRecord = useCallback(async () => {
    if (!assetId) return null;

    const linkedId = baseExtraMeta?.linked_service_record_id;
    if (linkedId) {
      try {
        const { data, error } = await supabase
          .from("service_records")
          .select("*")
          .eq("id", linkedId)
          .limit(1)
          .maybeSingle();
        if (!error && data?.id) return data;
      } catch (error) {
        console.log("Linked completion record lookup skipped:", error);
      }
    }

    if (!reminderIdFromRoute) return null;

    try {
      let query = supabase
        .from("service_records")
        .select("*")
        .eq("asset_id", assetId)
        .ilike("notes", `%Created from completed reminder ${reminderIdFromRoute}.%`)
        .order("created_at", { ascending: false })
        .limit(1);

      if (systemId) query = query.eq("system_id", systemId);

      const { data, error } = await query;
      if (!error && data?.[0]?.id) return data[0];
    } catch (error) {
      console.log("Completion record duplicate lookup skipped:", error);
    }

    return null;
  }, [assetId, systemId, reminderIdFromRoute, baseExtraMeta]);

  const completeWithNewTimelineEntry = useCallback(async () => {
    if (saving) return;
    if (!assetId) {
      await completeWithoutTimeline();
      return;
    }

    setSaving(true);
    try {
      const existingRecord = await findExistingCompletionServiceRecord();
      const record = existingRecord || (await createServiceRecordWithStoryEvent({
        assetId,
        serviceType: providerTarget ? "pro" : "moment",
        title: title.trim() ? `Completed: ${title.trim()}` : "Reminder completed",
        performedAt: workCompletedOn || todayISO(),
        notes: [
          notes || null,
          reminderIdFromRoute
            ? `Created from completed reminder ${reminderIdFromRoute}.`
            : "Created from completed reminder.",
        ]
          .filter(Boolean)
          .join("\n\n"),
        systemId: systemId || null,
        systemName: systemName || null,
        keeprProId:
          providerTarget?.type === "keepr_pro" ? providerTarget.id : null,
        keeprProName: providerTarget?.label || null,
        assetName: assetName || null,
      }));

      setCompletionPickerOpen(false);
      await onSave(
        "completed",
        buildCompletionMetadata({
          source: existingRecord
            ? "linked_service_record"
            : "created_service_record",
          record,
          preserveCompleted: completionMode === "enrich",
          workDate: workCompletedOn,
        })
      );
    } catch (e) {
      console.log("Create completion timeline entry error:", e);
      Alert.alert(
        "Couldn’t create timeline entry",
        e?.message || "Please link an existing record or complete without a timeline."
      );
    } finally {
      setSaving(false);
    }
  }, [
    saving,
    assetId,
    providerTarget,
    title,
    notes,
    reminderIdFromRoute,
    systemId,
    systemName,
    assetName,
    onSave,
    buildCompletionMetadata,
    completeWithoutTimeline,
    completionMode,
    workCompletedOn,
    findExistingCompletionServiceRecord,
  ]);

  const openProofEnrichment = useCallback(() => {
    if (saving || completionLoading) return;

    (async () => {
      setCompletionLoading(true);
      try {
        const candidates = await loadCompletionCandidates();
        setCompletionCandidates(candidates);
        setCompletionRecordSearch("");
        setSelectedCompletionRecordId(
          baseExtraMeta?.linked_service_record_id ||
            candidates[0]?.id ||
            null
        );
        const existingRecord = candidates.find(
          (record) => record.id === baseExtraMeta?.linked_service_record_id
        );
        setWorkCompletedOn(
          baseExtraMeta?.work_completed_on ||
            baseExtraMeta?.actual_completed_date ||
            (existingRecord
              ? getCompletionRecordDateISO(existingRecord)
              : candidates[0]
              ? getCompletionRecordDateISO(candidates[0])
              : todayISO())
        );
        setCompletionMode("enrich");
        setCompletionPickerOpen(true);
      } finally {
        setCompletionLoading(false);
      }
    })();
  }, [
    saving,
    completionLoading,
    loadCompletionCandidates,
    baseExtraMeta?.linked_service_record_id,
  ]);

  const handleArchive = useCallback(() => {
    if (!isEdit || !reminderIdFromRoute || saving) return;

    // Web: use confirm instead of multi-button Alert
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        const ok = window.confirm(
          "Archive this reminder? It will no longer show as open, but you can still reference it."
        );
        if (!ok) return;
      }
      onSave("archived");
      return;
    }

    // Native: normal Alert with buttons
    Alert.alert(
      "Archive reminder?",
      "This will mark the reminder as archived so it no longer shows as open, but you can still reference it.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Archive",
          onPress: () => onSave("archived"),
        },
      ]
    );
  }, [isEdit, reminderIdFromRoute, saving, onSave]);

  const handleDelete = useCallback(() => {
    if (!isEdit || !reminderIdFromRoute || saving) return;

    // Web: confirm + delete directly
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") {
        const ok = window.confirm(
          "Delete this reminder permanently? This cannot be undone."
        );
        if (!ok) return;
      }
      (async () => {
        if (!ownerId) return;
        try {
          setSaving(true);
          const { error } = await supabase
            .from("reminders")
            .delete()
            .eq("id", reminderIdFromRoute)
            .eq("owner_id", ownerId);

          if (error) throw error;
          await cancelReminderPushNotification(reminderIdFromRoute);
          navigation.navigate(afterSave);
        } catch (e) {
          console.log("Delete reminder error:", e);
          Alert.alert(
            "Couldn’t delete reminder",
            e?.message || "Please try again."
          );
        } finally {
          setSaving(false);
        }
      })();
      return;
    }

    // Native: Alert with buttons
    Alert.alert(
      "Delete reminder?",
      "This will permanently remove this reminder.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            if (!ownerId) return;
            try {
              setSaving(true);
              const { error } = await supabase
                .from("reminders")
                .delete()
                .eq("id", reminderIdFromRoute)
                .eq("owner_id", ownerId);

              if (error) throw error;
              await cancelReminderPushNotification(reminderIdFromRoute);

              navigation.navigate(afterSave);
            } catch (e) {
              console.log("Delete reminder error:", e);
              Alert.alert(
                "Couldn’t delete reminder",
                e?.message || "Please try again."
              );
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }, [isEdit, reminderIdFromRoute, saving, ownerId, navigation, afterSave]);

  /* ---------------------- UI helpers --------------------------------- */

  const linkedContextLabel = () => {
    if (systemName) return systemName;
    if (assetName) return assetName;
    if (recordId) return "Linked to a record";
    return "No link yet";
  };

  const linkedParentContextLabel = () => {
    if (systemName && assetName) return assetName;
    return "";
  };

  const canGoBack = !!navigation?.canGoBack?.() && navigation.canGoBack();

  /* ---------------------- Render ------------------------------------- */

  if (!ownerId) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={styles.centeredText}>Please sign in.</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: spacing.sm, color: colors.textSecondary }}>
            Loading…
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={layoutStyles.screen}
      edges={["top", "left", "right"]}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          {canGoBack ? (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.topBtn}
              activeOpacity={0.85}
            >
              <Ionicons
                name="chevron-back-outline"
                size={22}
                color={colors.textPrimary}
              />
            </TouchableOpacity>
          ) : (
            <View style={{ width: 44 }} />
          )}

          <Text style={styles.topTitle}>
            {isEdit ? "Edit Action" : "New Action"}
          </Text>

          <View style={{ width: 44 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.wrap}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.subtitle}>
            Set an Action that can be linked to a Keepr asset or system. When
            it fires, you’ll jump straight back into this context.
          </Text>

          <View style={styles.card}>
            <Text style={styles.label}>Action type</Text>
            <View style={styles.actionTypeRow}>
              {[
                { key: "general", label: "General Action", icon: "checkbox-outline" },
                { key: "service", label: "Service", icon: "construct-outline" },
              ].map((option) => {
                const selected = actionType === option.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.actionTypeButton,
                      selected && styles.actionTypeButtonActive,
                    ]}
                    onPress={() => setActionType(option.key)}
                    activeOpacity={0.9}
                  >
                    <Ionicons
                      name={option.icon}
                      size={16}
                      color={selected ? "#FFFFFF" : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.actionTypeText,
                        selected && styles.actionTypeTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {actionType === "service" ? (
              <View style={styles.serviceTemplateBlock}>
                <View style={styles.contextHeaderRow}>
                  <Text style={styles.label}>Service template</Text>
                  {serviceTemplatesLoading ? (
                    <ActivityIndicator size="small" color={colors.textSecondary} />
                  ) : null}
                </View>
                {serviceTemplateError ? (
                  <Text style={styles.warningText}>{serviceTemplateError}</Text>
                ) : null}
                {serviceTemplates.length ? (
                  <View style={styles.choiceGrid}>
                    {serviceTemplates.map((service) => {
                      const snapshot = buildServiceTemplateSnapshot(service);
                      const key =
                        snapshot?.key ||
                        snapshot?.id ||
                        service.name ||
                        service.owner_facing_label;
                      const selected =
                        !!effectiveServiceSnapshot &&
                        (String(effectiveServiceSnapshot.key || "") === String(snapshot?.key || "") ||
                          String(effectiveServiceSnapshot.id || "") === String(snapshot?.id || "") ||
                          String(effectiveServiceSnapshot.label || "") === String(snapshot?.label || ""));
                      return (
                        <TouchableOpacity
                          key={key}
                          style={[
                            styles.choicePill,
                            selected && styles.choicePillActive,
                          ]}
                          onPress={() => selectServiceTemplate(service)}
                          activeOpacity={0.9}
                        >
                          <Ionicons
                            name={selected ? "checkmark-circle" : "construct-outline"}
                            size={17}
                            color={selected ? colors.brandBlue : colors.textMuted}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.choiceText}>
                              {snapshot?.label || snapshot?.name || "Service"}
                            </Text>
                            <Text style={styles.choiceDetail}>
                              {[
                                snapshot?.asset_system_type,
                                snapshot?.brand_applicability,
                                snapshot?.interval_trigger,
                              ].filter(Boolean).join(" · ") ||
                                snapshot?.owner_facing_description ||
                                "Service template"}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ) : serviceTemplatesLoading ? (
                  <Text style={styles.help}>Loading Services configured by this KeeprSpace...</Text>
                ) : (
                  <Text style={styles.help}>
                    No active Services are configured for this KeeprSpace yet.
                  </Text>
                )}
                {effectiveServiceSnapshot?.owner_facing_description ? (
                  <Text style={styles.serviceDescription}>
                    {effectiveServiceSnapshot.owner_facing_description}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          {/* Title */}
          <View style={styles.card}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="e.g., Change HVAC filter, renew boat registration"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
          </View>

          {/* Notes */}
          <View style={styles.card}>
            <Text style={styles.label}>Notes</Text>
            <TextInput
              value={notes}
              onChangeText={setNotes}
              placeholder="Any details for your future self (vendor, location, estimate, etc.)"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { height: 110, textAlignVertical: "top" }]}
              multiline
            />
          </View>

          {/* When */}
          <View style={styles.card}>
            <Text style={styles.label}>When</Text>
            <KeeprDateField
              value={dueDateISO}
              onChange={updateDueDateISO}
            />
            <Text style={styles.help}>Stored as {dueDateISO || "—"}</Text>
            {hasTime ? (
            <>
              <Text style={styles.label}>Time</Text>
              <TextInput
                value={timeText}
                onChangeText={updateTimeText}
                placeholder="08:00"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
              <Text style={styles.help}>Examples: 08:00, 17:30, 9am, or 1400</Text>
            </>
          ) : null}
            <View style={styles.chipRow}>
              <TouchableOpacity
                style={styles.chip}
                onPress={() => applyQuickDue(1)}
                activeOpacity={0.9}
              >
                <Text style={styles.chipText}>Tomorrow</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.chip}
                onPress={() => applyQuickDue(7)}
                activeOpacity={0.9}
              >
                <Text style={styles.chipText}>Next week</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.chip}
                onPress={() => applyQuickDue(30)}
                activeOpacity={0.9}
              >
                <Text style={styles.chipText}>In 30 days</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.toggleRow}>
              <TouchableOpacity
                style={[
                  styles.toggleBtn,
                  hasTime && styles.toggleBtnActive,
                ]}
                onPress={toggleHasTime}
                activeOpacity={0.9}
              >
                <Ionicons
                  name={hasTime ? "time" : "time-outline"}
                  size={16}
                  color={hasTime ? "#FFF" : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.toggleText,
                    hasTime && styles.toggleTextActive,
                  ]}
                >
                  Include time of day
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.toggleBtn,
                  isUrgent && styles.toggleBtnUrgent,
                ]}
                onPress={() => setIsUrgent((v) => !v)}
                activeOpacity={0.9}
              >
                <Ionicons
                  name="alert-circle-outline"
                  size={16}
                  color={isUrgent ? "#FFF" : colors.textSecondary}
                />
                <Text
                  style={[
                    styles.toggleText,
                    isUrgent && styles.toggleTextUrgent,
                  ]}
                >
                  Mark as urgent
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Visibility */}
          <View style={styles.card}>
            <Text style={styles.label}>Visibility</Text>
            <View style={styles.choiceGrid}>
              {[
                {
                  key: "team",
                  label: "Shared with Team",
                  detail: coordinationOrg?.display_name || coordinationOrg?.name || "Team-visible Action",
                },
                {
                  key: "private",
                  label: "Private to me",
                  detail: "Only you can see this Action",
                },
              ].map((option) => {
                const selected = visibilityScope === option.key;
                const disabled = option.key === "team" && !coordinationOrg?.id;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.choicePill,
                      selected && styles.choicePillActive,
                      disabled && { opacity: 0.55 },
                    ]}
                    onPress={() => {
                      if (disabled) return;
                      setVisibilityTouched(true);
                      setVisibilityScope(option.key);
                    }}
                    activeOpacity={0.9}
                    disabled={disabled}
                  >
                    <Ionicons
                      name={
                        selected
                          ? "checkmark-circle"
                          : option.key === "team"
                          ? "people-outline"
                          : "lock-closed-outline"
                      }
                      size={16}
                      color={selected ? colors.brandBlue : colors.textMuted}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.choiceText}>{option.label}</Text>
                      <Text style={styles.choiceDetail}>{option.detail}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            {!!assignmentSharingWarning && (
              <Text style={styles.warningText}>{assignmentSharingWarning}</Text>
            )}
            <Text style={styles.help}>
              Context: {actionContextLabel}. Responsibility is selected separately.
            </Text>
          </View>

          {/* Responsible party */}
          <View style={styles.card}>
            <Text style={styles.label}>Responsible party</Text>
            <View style={styles.assignmentGrid}>
              {assignmentOptions.map((option) => {
                const selected = isSameAssignmentTarget(
                  assignmentTarget,
                  option.target
                );
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[
                      styles.assignmentChip,
                      selected && styles.assignmentChipActive,
                    ]}
                    onPress={() => selectAssignmentOption(option)}
                    activeOpacity={0.9}
                  >
                    <Ionicons
                      name={
                        option.target?.type === "team"
                          ? "people-outline"
                          : "person-outline"
                      }
                      size={14}
                      color={selected ? "#FFF" : colors.textSecondary}
                    />
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[
                          styles.assignmentChipText,
                          selected && styles.assignmentChipTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {option.label}
                      </Text>
                      {!!option.detail && (
                        <Text
                          style={[
                            styles.assignmentChipDetail,
                            selected && styles.assignmentChipTextActive,
                          ]}
                          numberOfLines={1}
                        >
                          {option.detail}
                        </Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
            {assignmentLoading ? (
              <Text style={styles.help}>Loading assignment options…</Text>
            ) : null}
            {!!assignedTo && (
              <TouchableOpacity
                style={styles.clearAssignmentBtn}
                onPress={clearAssignment}
                activeOpacity={0.9}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={14}
                  color={colors.textSecondary}
                />
                <Text style={styles.clearAssignmentText}>Clear assignment</Text>
              </TouchableOpacity>
            )}
            <Text style={[styles.label, { marginTop: spacing.md }]}>
              Manual label
            </Text>
            <TextInput
              value={assignedTo}
              onChangeText={updateManualAssignment}
              placeholder="e.g., Dockmaster, marina office, family member"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <Text style={styles.help}>
              Choose who owns the action. Provider involvement is tracked
              separately below.
            </Text>
          </View>

          {/* Linked context */}
          <View style={styles.card}>
            <Text style={styles.label}>Linked to</Text>
            <Text style={styles.contextMain} numberOfLines={2}>
              {linkedContextLabel()}
            </Text>
            {!!linkedParentContextLabel() && (
              <Text style={styles.contextLine}>
                Parent asset: {linkedParentContextLabel()}
              </Text>
            )}

            <Text style={styles.contextLine}>
              Asset: {assetName || (assetId ? assetId : "—")}
            </Text>
            <Text style={styles.contextLine}>
              System: {systemName || (systemId ? systemId : "—")}
            </Text>

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={openLinkModal}
              activeOpacity={0.9}
            >
              <Ionicons
                name="sparkles-outline"
                size={16}
                color={colors.textPrimary}
              />
              <Text style={styles.secondaryText}>Edit link</Text>
            </TouchableOpacity>

            <Text style={styles.help}>
              Optional — connect this Action to an asset or system.
            </Text>
          </View>

          {/* Provider involvement */}
          <View style={styles.card}>
            <Text style={styles.label}>KeeprPro / Provider involvement</Text>
            <View style={styles.providerSummaryRow}>
              <View style={styles.providerIconWrap}>
                <Ionicons
                  name="briefcase-outline"
                  size={18}
                  color={colors.textSecondary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.providerSummaryLabel} numberOfLines={1}>
                  Provider
                </Text>
                <Text style={styles.providerSummaryValue} numberOfLines={2}>
                  {providerTarget?.label || "None selected"}
                </Text>
                {providerTarget?.scope ? (
                  <Text style={styles.providerSummaryMeta} numberOfLines={1}>
                    {providerTarget.scope === "system"
                      ? "System-level KeeprPro"
                      : "Asset-level KeeprPro"}
                  </Text>
                ) : null}
              </View>
            </View>

            <View style={styles.providerActionRow}>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => setProviderPickerOpen(true)}
                activeOpacity={0.9}
              >
                <Ionicons
                  name={providerTarget ? "swap-horizontal-outline" : "add"}
                  size={16}
                  color={colors.textPrimary}
                />
                <Text style={styles.secondaryText}>
                  {providerTarget ? "Change provider" : "Add KeeprPro"}
                </Text>
              </TouchableOpacity>
              {providerTarget ? (
                <TouchableOpacity
                  style={styles.providerClearBtn}
                  onPress={clearProvider}
                  activeOpacity={0.9}
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={14}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.clearAssignmentText}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {!!providerContextWarning && (
              <Text style={styles.warningText}>{providerContextWarning}</Text>
            )}
            <Text style={styles.help}>
              Optional — identify who may perform or support the work.
            </Text>
          </View>

          {(assetId || systemId || reminderIdFromRoute) ? (
            <View style={styles.card}>
              <View style={styles.contextHeaderRow}>
                <Text style={styles.label}>Action context</Text>
                {actionContext.loading ? (
                  <ActivityIndicator size="small" color={colors.textSecondary} />
                ) : null}
              </View>
              <View style={styles.contextMetricRow}>
                <View style={styles.contextMetric}>
                  <Text style={styles.contextMetricValue}>
                    {actionContext.recentRecordCount}
                  </Text>
                  <Text style={styles.contextMetricLabel}>Records</Text>
                </View>
                <View style={styles.contextMetric}>
                  <Text style={styles.contextMetricValue}>
                    {actionContext.proofAttachmentCount}
                  </Text>
                  <Text style={styles.contextMetricLabel}>Context files</Text>
                </View>
                <View style={styles.contextMetric}>
                  <Text style={styles.contextMetricValue}>
                    {actionContext.reminderAttachmentCount}
                  </Text>
                  <Text style={styles.contextMetricLabel}>Action files</Text>
                </View>
              </View>
              {actionContext.latestRecordTitle ? (
                <Text style={styles.help} numberOfLines={2}>
                  Latest record: {actionContext.latestRecordTitle}
                </Text>
              ) : (
                <Text style={styles.help}>
                  Context files and recent records will be available when this
                  action is completed or enriched with proof.
                </Text>
              )}
            </View>
          ) : null}

          {/* Repeat (free text for now) */}
          <View style={styles.card}>
            <Text style={styles.label}>Repeat (optional)</Text>
            <TextInput
              value={repeatRule}
              onChangeText={setRepeatRule}
              placeholder="e.g., every 6 months, yearly on renewal"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <Text style={styles.help}>
              Stored as free text for now; this can evolve into structured
              recurrence rules later.
            </Text>
          </View>

          <View style={{ height: spacing.lg }} />

          {isCompleted ? (
            <View style={styles.completionStatusCard}>
              <View style={styles.completionStatusHeader}>
                <Ionicons
                  name={
                    baseExtraMeta?.linked_service_record_id
                      ? "document-text-outline"
                      : "checkmark-done-outline"
                  }
                  size={18}
                  color={colors.textSecondary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.completionStatusTitle}>
                    {completionProofLabel || "Completed"}
                  </Text>
                  {completionProofDetail ? (
                    <Text style={styles.completionStatusMeta} numberOfLines={2}>
                      {completionProofDetail}
                    </Text>
                  ) : baseExtraMeta?.completed_at ? (
                    <Text style={styles.completionStatusMeta} numberOfLines={1}>
                      Completed {String(baseExtraMeta.completed_at).slice(0, 10)}
                    </Text>
                  ) : null}
                </View>
              </View>
              <TouchableOpacity
                style={styles.completionStatusAction}
                onPress={openProofEnrichment}
                disabled={saving || completionLoading}
                activeOpacity={0.9}
              >
                {completionLoading ? (
                  <ActivityIndicator size="small" color={colors.textPrimary} />
                ) : (
                  <Ionicons
                    name={
                      baseExtraMeta?.linked_service_record_id
                        ? "swap-horizontal-outline"
                        : "add-circle-outline"
                    }
                    size={16}
                    color={colors.textPrimary}
                  />
                )}
                <Text style={styles.secondaryText}>
                  {baseExtraMeta?.linked_service_record_id
                    ? "Change proof"
                    : "Add proof"}
                </Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* Footer */}
          <View style={styles.footerRow}>
            <TouchableOpacity
              style={[styles.secondaryBtnWide, saving && { opacity: 0.7 }]}
              onPress={() => navigation.goBack()}
              disabled={saving}
              activeOpacity={0.9}
            >
              <Text style={styles.secondaryText}>Cancel</Text>
            </TouchableOpacity>

            {isEdit && !isCompleted ? (
              <TouchableOpacity
                style={[
                  styles.completeBtn,
                  saving && { opacity: 0.7 },
                ]}
                onPress={handleMarkComplete}
                disabled={saving || completionLoading}
                activeOpacity={0.9}
              >
                {(saving && status === "completed") || completionLoading ? (
                  <ActivityIndicator color="#FFF" />
                ) : (
                  <>
                    <Ionicons
                      name="checkmark-circle-outline"
                      size={16}
                      color="#FFF"
                    />
                    <Text style={styles.completeText}>Mark complete</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : isEdit && isCompleted ? (
              <View style={styles.completedBtn}>
                <Ionicons
                  name="checkmark-done-outline"
                  size={16}
                  color="#16A34A"
                />
                <Text style={styles.completedBtnText}>Completed</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={[
                styles.primaryBtn,
                (!canSave || saving) && { opacity: 0.6 },
              ]}
              onPress={() => onSave()}
              disabled={!canSave || saving}
              activeOpacity={0.9}
            >
              {saving ? (
                <ActivityIndicator color="#FFF" />
              ) : (
                <Text style={styles.primaryText}>
                  {isEdit ? "Save changes" : "Save reminder"}
                </Text>
              )}
            </TouchableOpacity>
          </View>

          {/* Archive + Delete row */}
          {isEdit && (
            <View style={styles.archiveRow}>
              <TouchableOpacity
                onPress={handleArchive}
                style={styles.archiveBtn}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="archive-outline"
                  size={16}
                  color={colors.textSecondary}
                />
                <Text style={styles.archiveText}>Archive</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleDelete}
                style={styles.deleteBtn}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="trash-outline"
                  size={16}
                  color={colors.danger || "#DC2626"}
                />
                <Text style={styles.deleteLinkText}>Delete</Text>
              </TouchableOpacity>
            </View>
          )}

          <Text style={styles.statusHint}>
            Status: {String(status || "open").toUpperCase()}
          </Text>
        </ScrollView>

        <Modal
          visible={completionPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setCompletionPickerOpen(false)}
        >
          <View style={styles.backdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {completionMode === "enrich"
                    ? "Add proof"
                    : "Complete reminder"}
                </Text>
                <TouchableOpacity
                  onPress={() => setCompletionPickerOpen(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons
                    name="close-outline"
                    size={22}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView
                contentContainerStyle={{ padding: spacing.lg }}
                showsVerticalScrollIndicator={false}
              >
                <Text style={styles.completionIntro}>
                  {completionMode === "enrich"
                    ? "Link or create proof for this completed reminder. The responsibility stays closed."
                    : "Review how this reminder should close before Keepr marks it complete."}
                </Text>

                <View style={styles.completionContextBox}>
                  <Text style={styles.completionContextTitle} numberOfLines={2}>
                    {title || "Reminder"}
                  </Text>
                  <Text style={styles.completionContextMeta} numberOfLines={2}>
                    {[assetName, systemName].filter(Boolean).join(" • ") ||
                      "No asset/system link"}
                  </Text>
                  {providerTarget?.label ? (
                    <Text style={styles.completionContextMeta} numberOfLines={1}>
                      Provider: {providerTarget.label}
                    </Text>
                  ) : null}
                </View>

                <Text style={styles.sectionMini}>Work completed on</Text>
                <KeeprDateField
                  value={workCompletedOn}
                  onChange={setWorkCompletedOn}
                />
                <Text style={styles.help}>
                  This is the actual work date, separate from when the reminder
                  was closed in Keepr.
                </Text>

                <Text style={styles.sectionMini}>
                  Choose existing timeline record
                </Text>
                <TextInput
                  value={completionRecordSearch}
                  onChangeText={setCompletionRecordSearch}
                  placeholder="Find existing record…"
                  placeholderTextColor={colors.textMuted}
                  style={styles.modalInput}
                />

                {completionCandidates.length === 0 ? (
                  <View style={styles.completionEmptyBox}>
                    <Ionicons
                      name="search-outline"
                      size={18}
                      color={colors.textMuted}
                    />
                    <Text style={styles.completionEmptyText}>
                      No matching records found yet. If the timeline record is
                      visible elsewhere, refresh and check the proof picker
                      diagnostic in the console.
                    </Text>
                  </View>
                ) : filteredCompletionRecords.length === 0 ? (
                  <View style={styles.completionEmptyBox}>
                    <Ionicons
                      name="search-outline"
                      size={18}
                      color={colors.textMuted}
                    />
                    <Text style={styles.completionEmptyText}>
                      No records match that search.
                    </Text>
                  </View>
                ) : null}

                {groupedCompletionRecords.map((group) => (
                  <View key={group.key} style={styles.completionGroup}>
                    <Text style={styles.completionGroupLabel}>{group.label}</Text>
                    {group.rows.map((record) => {
                      const selected = selectedCompletionRecord?.id === record.id;
                      const contextLine = getCompletionRecordContext(
                        record,
                        assetName,
                        systemName
                      );
                      const bits = [
                        formatCompletionRecordDate(record),
                        contextLine,
                        record._sourceLabel,
                        record._proofCount
                          ? `${record._proofCount} proof file${
                              record._proofCount === 1 ? "" : "s"
                            }`
                          : null,
                      ].filter(Boolean);

                      return (
                        <TouchableOpacity
                          key={record.id}
                          style={[
                            styles.completionRecordRow,
                            selected && styles.pickRowActive,
                          ]}
                          onPress={() => selectCompletionRecord(record)}
                          activeOpacity={0.9}
                        >
                          <Ionicons
                            name={
                              selected
                                ? "checkmark-circle"
                                : "radio-button-off-outline"
                            }
                            size={18}
                            color={selected ? colors.brandBlue : colors.textMuted}
                          />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.pickTitle} numberOfLines={2}>
                              {record.title || "Timeline record"}
                            </Text>
                            <Text style={styles.pickMeta} numberOfLines={2}>
                              {bits.join(" • ") || "Recent service record"}
                            </Text>
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                ))}

                <View style={styles.completionActionStack}>
                  {completionCandidates.length > 0 ? (
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      !selectedCompletionRecord && { opacity: 0.6 },
                    ]}
                    onPress={completeWithLinkedRecord}
                    disabled={!selectedCompletionRecord || saving}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.primaryText}>
                      {completionMode === "enrich"
                        ? "Link selected record"
                        : "Complete and link record"}
                    </Text>
                  </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    style={styles.completionSecondaryBtn}
                    onPress={completeWithNewTimelineEntry}
                    disabled={saving}
                    activeOpacity={0.9}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={16}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.secondaryText}>
                      {completionMode === "enrich"
                        ? "Create timeline entry"
                        : "Complete and create timeline entry"}
                    </Text>
                  </TouchableOpacity>

                  {completionMode === "complete" ? (
                    <TouchableOpacity
                      style={styles.completionSecondaryBtn}
                      onPress={completeWithoutTimeline}
                      disabled={saving}
                      activeOpacity={0.9}
                    >
                      <Ionicons
                        name="checkmark-done-outline"
                        size={16}
                        color={colors.textPrimary}
                      />
                      <Text style={styles.secondaryText}>
                        Complete without timeline
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    style={styles.completionCancelBtn}
                    onPress={() => setCompletionPickerOpen(false)}
                    disabled={saving}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.clearAssignmentText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        {/* Link modal */}
        <Modal
          visible={providerPickerOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setProviderPickerOpen(false)}
        >
          <View style={styles.backdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Select KeeprPro / Provider</Text>
                <TouchableOpacity
                  onPress={() => setProviderPickerOpen(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons
                    name="close-outline"
                    size={22}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
              </View>

              <ScrollView
                contentContainerStyle={{ padding: spacing.lg }}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <TextInput
                  value={providerSearch}
                  onChangeText={setProviderSearch}
                  placeholder="Search KeeprPros…"
                  placeholderTextColor={colors.textMuted}
                  style={styles.modalInput}
                />

                <TouchableOpacity
                  style={[
                    styles.pickRow,
                    !providerTarget && styles.pickRowActive,
                  ]}
                  onPress={clearProvider}
                  activeOpacity={0.9}
                >
                  <Text style={styles.pickTitle}>No provider</Text>
                  <Text style={styles.pickMeta}>
                    Keep this as an owner/team action only.
                  </Text>
                </TouchableOpacity>

                {assignmentLoading ? (
                  <View style={styles.providerPickerLoading}>
                    <ActivityIndicator />
                    <Text style={styles.muted}>Loading KeeprPros…</Text>
                  </View>
                ) : filteredProviderOptions.length === 0 ? (
                  <Text style={styles.muted}>
                    No KeeprPros found for this context.
                  </Text>
                ) : (
                  filteredProviderOptions.map((option) => {
                    const selected = isSameAssignmentTarget(
                      providerTarget,
                      option.target
                    );
                    return (
                      <TouchableOpacity
                        key={option.key}
                        style={[
                          styles.pickRow,
                          selected && styles.pickRowActive,
                        ]}
                        onPress={() => selectProviderOption(option)}
                        activeOpacity={0.9}
                      >
                        <Text style={styles.pickTitle}>{option.label}</Text>
                        <Text style={styles.pickMeta}>
                          {option.detail || "KeeprPro"}
                        </Text>
                      </TouchableOpacity>
                    );
                  })
                )}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <Modal
          visible={linkModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setLinkModalOpen(false)}
        >
          <View style={styles.backdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Link to asset / system</Text>
                <TouchableOpacity
                  onPress={() => setLinkModalOpen(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons
                    name="close-outline"
                    size={22}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
              </View>

              {linkLoading ? (
                <View style={styles.centered}>
                  <ActivityIndicator />
                  <Text
                    style={{
                      marginTop: 10,
                      color: colors.textSecondary,
                    }}
                  >
                    Loading…
                  </Text>
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={{ padding: spacing.lg }}
                  showsVerticalScrollIndicator={false}
                >
                  <Text style={styles.sectionMini}>Asset</Text>
                  <TextInput
                    value={assetSearch}
                    onChangeText={setAssetSearch}
                    placeholder="Search assets…"
                    placeholderTextColor={colors.textMuted}
                    style={styles.modalInput}
                  />

                  {filteredAssets.length === 0 ? (
                    <Text style={styles.muted}>
                      No assets yet. Create an asset first, then link this
                      reminder.
                    </Text>
                  ) : (
                    filteredAssets.map((a) => (
                      <TouchableOpacity
                        key={a.id}
                        style={[
                          styles.pickRow,
                          assetId === a.id && styles.pickRowActive,
                        ]}
                        onPress={() => selectAsset(a)}
                        activeOpacity={0.9}
                      >
                        <Text style={styles.pickTitle}>{a.name}</Text>
                        <Text style={styles.pickMeta}>{a.type || ""}</Text>
                      </TouchableOpacity>
                    ))
                  )}

                  {!!assetId && (
                    <>
                      <View style={{ height: 16 }} />
                      <Text style={styles.sectionMini}>Systems</Text>
                      <TextInput
                        value={systemSearch}
                        onChangeText={setSystemSearch}
                        placeholder="Search systems…"
                        placeholderTextColor={colors.textMuted}
                        style={styles.modalInput}
                      />

                      {filteredSystems.length === 0 ? (
                        <Text style={styles.muted}>
                          No systems found for this asset.
                        </Text>
                      ) : (
                        filteredSystems.map((s) => (
                          <TouchableOpacity
                            key={s.id}
                            style={[
                              styles.pickRow,
                              systemId === s.id && styles.pickRowActive,
                            ]}
                            onPress={() => selectSystem(s)}
                            activeOpacity={0.9}
                          >
                            <Text style={styles.pickTitle}>{s.name}</Text>
                          </TouchableOpacity>
                        ))
                      )}
                    </>
                  )}

                  <View style={{ height: 18 }} />
                  <TouchableOpacity
                    style={styles.primaryBtn}
                    onPress={() => setLinkModalOpen(false)}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.primaryText}>Done</Text>
                  </TouchableOpacity>
                </ScrollView>
              )}
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------- */
/* Styles                                                        */
/* ------------------------------------------------------------- */

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  centeredText: {
    fontSize: 16,
    color: colors.textPrimary,
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  topBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  subtitle: {
    marginTop: spacing.lg,
    marginBottom: spacing.md,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.subtle,
  },

  label: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    marginBottom: 6,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },

  help: { marginTop: 6, fontSize: 11, color: colors.textMuted },

  chipRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: "wrap",
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textSecondary,
  },

  actionTypeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionTypeButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.md,
  },
  actionTypeButtonActive: {
    backgroundColor: colors.brandNavy,
    borderColor: colors.brandNavy,
  },
  actionTypeText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "900",
  },
  actionTypeTextActive: {
    color: "#FFFFFF",
  },
  serviceTemplateBlock: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  serviceDescription: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    padding: spacing.md,
  },

  assignmentGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  choiceGrid: {
    gap: spacing.sm,
  },
  choicePill: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  choicePillActive: {
    borderColor: colors.brandBlue,
    backgroundColor: "#EFF6FF",
  },
  choiceText: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  choiceDetail: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  warningText: {
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: "800",
    color: "#B45309",
  },
  assignmentChip: {
    width: "48%",
    minWidth: 150,
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  assignmentChipActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  assignmentChipText: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  assignmentChipDetail: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
    color: colors.textMuted,
  },
  assignmentChipTextActive: { color: "#FFF" },
  clearAssignmentBtn: {
    alignSelf: "flex-start",
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
  },
  clearAssignmentText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  providerSummaryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  providerIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  providerSummaryLabel: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  providerSummaryValue: {
    marginTop: 2,
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  providerSummaryMeta: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  providerActionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  providerClearBtn: {
    marginTop: spacing.sm,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  providerPickerLoading: {
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: spacing.lg,
  },
  completionIntro: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  completionContextBox: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  completionContextTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  completionContextMeta: {
    marginTop: 3,
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  completionEmptyBox: {
    marginTop: 8,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  completionEmptyText: {
    flex: 1,
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  completionRecordRow: {
    marginTop: 8,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  completionGroup: {
    marginTop: spacing.sm,
  },
  completionGroupLabel: {
    marginTop: spacing.sm,
    fontSize: 11,
    fontWeight: "900",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  completionActionStack: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  completionSecondaryBtn: {
    minHeight: 46,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  completionCancelBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
  },

  toggleRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    flexWrap: "wrap",
  },
  toggleBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: colors.background,
  },
  toggleBtnActive: {
    backgroundColor: colors.brandBlue,
    borderColor: colors.brandBlue,
  },
  toggleBtnUrgent: {
    backgroundColor: colors.danger || "#DC2626",
    borderColor: colors.danger || "#DC2626",
  },
  toggleText: {
    fontSize: 11,
    fontWeight: "900",
    color: colors.textSecondary,
  },
  toggleTextActive: { color: "#FFF" },
  toggleTextUrgent: { color: "#FFF" },

  contextMain: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  contextLine: {
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 4,
  },
  contextHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  contextMetricRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  contextMetric: {
    flex: 1,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  contextMetricValue: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  contextMetricLabel: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "800",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },

  secondaryBtn: {
    marginTop: spacing.sm,
    height: 40,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryBtnWide: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryText: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  footerRow: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },

  primaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#FFF",
  },

  completeBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: "#16A34A",
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  completeText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#FFF",
  },
  completedBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#16A34A33",
    backgroundColor: "#F0FDF4",
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  completedBtnText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#16A34A",
  },
  completionStatusCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  completionStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  completionStatusTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  completionStatusMeta: {
    marginTop: 2,
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  completionStatusAction: {
    marginTop: spacing.md,
    minHeight: 42,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
  },

  // Archive + delete row
  archiveRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    marginTop: 4,
  },
  archiveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  archiveText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  deleteBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 8,
  },
  deleteLinkText: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.danger || "#DC2626",
  },

  statusHint: {
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },

  backdrop: {
    flex: 1,
    backgroundColor: "rgba(2,6,23,0.55)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  modalCard: {
    width: "100%",
    maxWidth: 560,
    maxHeight: "90%",
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.subtle,
  },
  modalHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontSize: 15,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  modalCloseBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalInput: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
  },
  pickRow: {
    marginTop: 8,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  pickRowActive: { borderColor: colors.brandBlue },
  pickTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  pickMeta: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
  },
  sectionMini: {
    marginTop: 6,
    fontSize: 12,
    fontWeight: "900",
    color: colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  muted: { marginTop: 6, fontSize: 12, color: colors.textMuted },
});
