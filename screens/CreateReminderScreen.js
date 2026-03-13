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
import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, shadows } from "../styles/theme";
import KeeprDateField from "../components/KeeprDateField";

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

/* ------------------------------------------------------------- */

export default function CreateReminderScreen({ navigation, route }) {
  const { user } = useAuth();
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

  const [hasTime, setHasTime] = useState(
    typeof prefill.has_time === "boolean" ? prefill.has_time : true
  );
  const [isUrgent, setIsUrgent] = useState(
    typeof prefill.is_urgent === "boolean" ? prefill.is_urgent : false
  );
  const [repeatRule, setRepeatRule] = useState(prefill.repeat_rule || "");
  const [status, setStatus] = useState(prefill.status || "open");

  const [assetId, setAssetId] = useState(contextAssetId);
  const [systemId, setSystemId] = useState(contextSystemId);
  const [recordId] = useState(contextRecordId);
  const [eventId] = useState(contextEventId);

  const [assetName, setAssetName] = useState("");
  const [systemName, setSystemName] = useState("");

  // Assignment (family / org / KeeprPro label)
  const [baseExtraMeta, setBaseExtraMeta] = useState(initialExtraMeta);
  const [assignedTo, setAssignedTo] = useState(
    initialExtraMeta.assigned_to || ""
  );

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
        const { data, error } = await supabase
          .from("reminders")
          .select("*")
          .eq("id", reminderIdFromRoute)
          .eq("owner_id", ownerId)
          .single();

        if (error) throw error;
        if (!mounted || !data) return;

        setTitle(data.title || "");
        setNotes(data.notes || "");

        const iso = data.due_at
          ? new Date(data.due_at).toISOString().slice(0, 10)
          : todayISO();

        setDueDateISO(iso);

        setHasTime(
          typeof data.has_time === "boolean" ? data.has_time : true
        );
        setIsUrgent(
          typeof data.is_urgent === "boolean" ? data.is_urgent : false
        );
        setRepeatRule(data.repeat_rule || "");
        setStatus(data.status || "open");

        setAssetId(data.asset_id || null);
        setSystemId(data.system_id || null);

        const em =
          (data.extra_metadata &&
            typeof data.extra_metadata === "object" &&
            data.extra_metadata) ||
          {};
        setBaseExtraMeta(em);
        setAssignedTo(em.assigned_to || "");
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
        .eq("owner_id", ownerId)
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

  /* ---------------------- date helpers ------------------------------- */

  const applyQuickDue = (days) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(
      d.getDate()
    )}`;
    setDueDateISO(iso);
  };

  const buildDueAtISO = () => {
    const isoDate = dueDateISO || todayISO();
    const [yyyy, mm, dd] = isoDate.split("-").map((x) => Number(x));
    const d = new Date();
    d.setFullYear(yyyy, mm - 1, dd);
    if (hasTime) {
      d.setHours(9, 0, 0, 0); // 9AM
    } else {
      d.setHours(0, 0, 0, 0);
    }
    return d.toISOString();
  };

  /* ---------------------- save / validate ---------------------------- */

const canSave = useMemo(
  () => !!title && !!ownerId && !!dueDateISO,
  [title, ownerId, dueDateISO]
);

  const validate = useCallback(() => {
    if (!ownerId) return "Not signed in.";
    if (!dueDateISO) return "Please select a date.";
    if (!title.trim()) return "Title is required.";
    return null;
  }, [ownerId, dueDateISO, title]);

  const onSave = useCallback(
    async (nextStatus) => {
      const msg = validate();
      if (msg) {
        Alert.alert("Check reminder", msg);
        return;
      }

      const dueAtISO = buildDueAtISO();

      setSaving(true);
      try {
        const extraMeta = {
          ...(baseExtraMeta || {}),
          assigned_to: assignedTo || undefined,
        };

        const payload = {
          owner_id: ownerId,
          title: title.trim(),
          notes: notes || null,
          url: prefill.url || null,
          due_at: dueAtISO,
          has_time: !!hasTime,
          is_urgent: !!isUrgent,
          repeat_rule: repeatRule || null,
          status: nextStatus || status || "open",
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
            .eq("owner_id", ownerId)
            .select("id")
            .single();

          if (error) throw error;
          savedId = data?.id;
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

        setStatus(nextStatus || status || "open");

        navigation.navigate(afterSave, {
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
      baseExtraMeta,
      assignedTo,
      ownerId,
      title,
      notes,
      prefill,
      hasTime,
      isUrgent,
      repeatRule,
      assetId,
      systemId,
      recordId,
      eventId,
      reminderIdFromRoute,
      afterSave,
      navigation,
      status,
    ]
  );

  const handleMarkComplete = useCallback(() => {
    if (saving) return;
    onSave("completed");
  }, [saving, onSave]);

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
    if (assetName && systemName) return `${assetName} • ${systemName}`;
    if (assetName) return assetName;
    if (systemName) return systemName;
    if (recordId) return "Linked to a record";
    return "No link yet";
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
            {isEdit ? "Edit reminder" : "New reminder"}
          </Text>

          <View style={{ width: 44 }} />
        </View>

        <ScrollView
          contentContainerStyle={styles.wrap}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.subtitle}>
            Set a reminder that can be linked to a Keepr asset or system. When
            it fires, you’ll jump straight back into this context.
          </Text>

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
              onChange={setDueDateISO}
            />
            <Text style={styles.help}>Stored as {dueDateISO || "—"}</Text>
            {hasTime ? (
            <>
              <Text style={styles.label}>Time</Text>
              <TextInput
                value={timeText}
                onChangeText={setTimeText}
                placeholder="08:00"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
              />
              <Text style={styles.help}>Use 24-hour time, e.g. 08:00 or 17:30</Text>
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
                onPress={() => setHasTime((v) => !v)}
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

          {/* Assigned to */}
          <View style={styles.card}>
            <Text style={styles.label}>Assigned to (optional)</Text>
            <TextInput
              value={assignedTo}
              onChangeText={setAssignedTo}
              placeholder="e.g., Spouse, Dockmaster, KeeprPro: Wilson Marine"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
            />
            <Text style={styles.help}>
              Use this when someone else in your circle is responsible for this
              task—family, org teammate, or KeeprPro.
            </Text>
          </View>

          {/* Linked context */}
          <View style={styles.card}>
            <Text style={styles.label}>Linked to</Text>
            <Text style={styles.contextMain} numberOfLines={2}>
              {linkedContextLabel()}
            </Text>

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
              If you create reminders from a story or system screen, Keepr can
              pre-fill these links so your future self lands in the right place.
            </Text>
          </View>

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

            {isEdit && (
              <TouchableOpacity
                style={[
                  styles.completeBtn,
                  saving && { opacity: 0.7 },
                ]}
                onPress={handleMarkComplete}
                disabled={saving}
                activeOpacity={0.9}
              >
                {saving && status === "completed" ? (
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
            )}

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

        {/* Link modal */}
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
