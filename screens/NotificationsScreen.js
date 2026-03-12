// screens/NotificationsScreen.js
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Image,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useFocusEffect } from "@react-navigation/native";

import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";
import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, shadows } from "../styles/theme";

/* --------------------------- helpers --------------------------- */

function localDateKey(d) {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;

  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function formatDateTimeUS(d) {
  try {
    if (!d) return "";
    const dt = new Date(d);
    return dt.toLocaleString("en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function formatDateLabel(d) {
  try {
    if (!d) return "";
    const dt = new Date(d);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(dt);
    target.setHours(0, 0, 0, 0);

    const diffDays = Math.round(
      (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Tomorrow";
    if (diffDays === -1) return "Yesterday";

    return dt.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function formatMoneyFromCents(cents) {
  if (cents == null) return null;
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return `$${(n / 100).toFixed(2)}`;
}

function isProbablyImage(mime) {
  const m = String(mime || "").toLowerCase();
  return m.startsWith("image/");
}

// Mode labels (V1)
// Store stable keys on events (recommended):
//   under_repair | replace | warranty | insurance
// We also tolerate already-human labels so this is non-breaking.
const MODE_LABELS = {
  under_repair: "Under Repair",
  replace: "Time to Replace",
  warranty: "Warranty Claim",
  insurance: "Insurance Claim",
};

function normalizeModeKey(raw) {
  const v = String(raw || "").trim();
  if (!v) return null;

  // If it's already one of our stable keys, keep it.
  const k = v.toLowerCase().replace(/\s+/g, "_");
  if (MODE_LABELS[k]) return k;

  // Tolerate human labels stored in context.mode.
  const compact = v.toLowerCase().replace(/[^a-z]/g, "");
  if (compact.includes("under") && compact.includes("repair")) return "under_repair";
  if (compact.includes("replace")) return "replace";
  if (compact.includes("warranty")) return "warranty";
  if (compact.includes("insurance")) return "insurance";

  return null;
}

function getEventModeLabel(ev) {
  const raw = ev?.context?.mode;
  const key = normalizeModeKey(raw);
  return key ? MODE_LABELS[key] : null;
}

async function confirmDestructive(title, message) {
  if (Platform.OS === "web") {
    try {
      return window.confirm(`${title}\n\n${message}`);
    } catch {
      return false;
    }
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
      { text: "Delete", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}
function getOriginLabel(ev) {
  const t = String(ev?.origin_type || "").toLowerCase();

  switch (t) {
    case "portal":
      return "Portal Intake";
    case "email":
      return "Email Intake";
    case "owner":
      return "Owner Entry";
    case "reminder":
      return "Reminder";
    case "team":
      return "Team Activity";
    default:
      return null;
  }
}

function getSourceLabel(ev) {
  const t = String(ev?.source_type || "").toLowerCase();

  switch (t) {
    case "quick_log":
      return "Quick Log";
    case "question":
      return "Question";
    case "manual_entry":
      return "Manual Entry";
    case "email":
      return "Email";
    case "reminder":
      return "Reminder";
    case "task":
      return "Task";
    case "invoice":
      return "Invoice";
    case "service_update":
      return "Service Update";
    default:
      return null;
  }
}

/**
 * Resolve an attachment’s URL.
 * - legacy: public_url
 * - newer: url + storage_path in asset-photos / asset-files
 *
 * NOTE: For private buckets, this will return a public URL that may not work.
 * We now sign URLs on-demand in the attachment tap handler.
 */
function resolveAttachmentUrl(att) {
  if (!att) return null;
  if (att.public_url) return att.public_url;
  if (att.url) return att.url;

  if (att.storage_path) {
    try {
      const { data } = supabase.storage
        .from("asset-files")
        .getPublicUrl(att.storage_path);
      return data?.publicUrl || null;
    } catch {
      return null;
    }
  }

  return null;
}

/* --------------------------- component --------------------------- */

export default function NotificationsScreen({ navigation, route }) {
  const { user } = useAuth();
  const ownerId = user?.id || null;

  // Context if Notifications is opened from an asset/system/record
  const contextAssetId = route?.params?.assetId || null;
  const contextSystemId = route?.params?.systemId || null;
  const contextRecordId = route?.params?.recordId || null;

    const [profileUsername, setProfileUsername] = useState(null);

const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Event inbox (event_inbox)
  const [events, setEvents] = useState([]);
  const [attachmentsByEvent, setAttachmentsByEvent] = useState({});
  const [attachmentUrlMap, setAttachmentUrlMap] = useState({});
  const [selectedEventId, setSelectedEventId] = useState(null);
  const [viewer, setViewer] = useState({
    visible: false,
    url: null,
    mime: null,
    name: null,
  });
  const [busyDelete, setBusyDelete] = useState(false);
  const [filter, setFilter] = useState("all"); // all | draft | submitted

  // Reminders (reminders)
  const [reminders, setReminders] = useState([]);
  const [reminderFilter, setReminderFilter] = useState("open"); // open | completed
  const [reminderViewMode, setReminderViewMode] = useState("list"); // list | schedule

  // Transfer requests (inbox_items)
  const [transferItems, setTransferItems] = useState([]);
  const [transferBusyId, setTransferBusyId] = useState(null);

  // lookups
  const [assetNameById, setAssetNameById] = useState({});
  const [systemNameById, setSystemNameById] = useState({});
  const [homeSystemNameById, setHomeSystemNameById] = useState({});

  // Add choice modal (Event vs Reminder)
  const [showAddChoice, setShowAddChoice] = useState(false);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) || null,
    [selectedEventId, events]
  );
  const selectedAttachments = useMemo(
    () => attachmentsByEvent[selectedEventId] || [],
    [selectedEventId, attachmentsByEvent]
  );

  const selectedEventPublicSender = useMemo(() => {
    const ctx = selectedEvent?.context || {};
    const publicAction = ctx?.public_action || {};
    const contact =
      publicAction?.contact ||
      ctx?.contact || {
        name:
          publicAction?.contact_name ||
          ctx?.contact_name ||
          null,
        email:
          publicAction?.contact_email ||
          ctx?.contact_email ||
          null,
        phone:
          publicAction?.contact_phone ||
          ctx?.contact_phone ||
          null,
      };

    const isPublic =
      ctx?.source?.channel === "public" ||
      !!publicAction?.type ||
      !!contact?.name ||
      !!contact?.email ||
      !!contact?.phone;

    return {
      isPublic: !!isPublic,
      name: contact?.name || null,
      email: contact?.email || null,
      phone: contact?.phone || null,
      actionType: publicAction?.type || null,
    };
  }, [selectedEvent]);


  const draftEvents = useMemo(
    () =>
      events.filter(
        (ev) => String(ev?.status || "draft").toLowerCase() === "draft"
      ),
    [events]
  );

  const submittedEvents = useMemo(
    () =>
      events.filter(
        (ev) => String(ev?.status || "").toLowerCase() === "submitted"
      ),
    [events]
  );

  const visibleEvents = useMemo(() => {
    switch (filter) {
      case "draft":
        return draftEvents;
      case "submitted":
        return submittedEvents;
      case "all":
      default:
        return events;
    }
  }, [events, draftEvents, submittedEvents, filter]);

  // Reminders sorted & grouped for schedule view
  const sortedReminders = useMemo(() => {
    if (!reminders) return [];
    return [...reminders].sort((a, b) => {
      const da = a?.due_at ? new Date(a.due_at).getTime() : 0;
      const db = b?.due_at ? new Date(b.due_at).getTime() : 0;
      return da - db;
    });
  }, [reminders]);

const remindersByDate = useMemo(() => {
  const map = {};
  sortedReminders.forEach((r) => {
    const key = localDateKey(r?.due_at);
    if (!key) return;
    if (!map[key]) map[key] = [];
    map[key].push(r);
  });
  return map;
}, [sortedReminders]);

  const reminderDateKeys = useMemo(
    () => Object.keys(remindersByDate).sort(),
    [remindersByDate]
  );

  const loadEverything = useCallback(
    async (opts = { silent: false }) => {
      // On web, auth can hydrate after first render. Don't leave the screen stuck.
      if (!ownerId) {
        if (!opts.silent) setLoading(false);
        return;
      }
      if (!opts.silent) setLoading(true);

      try {
        /* --------- 0. Profile (username for inbox email) --------- */
        try {
          const { data: prof, error: pErr } = await supabase
            .from("profiles")
            .select("username")
            .eq("id", ownerId)
            .maybeSingle();

          if (!pErr) setProfileUsername(prof?.username || null);
        } catch (_) {
          // ignore
        }

        /* --------- 1. Event inbox (event_inbox + attachments) --------- */
        const { data: evRows, error: evErr } = await supabase
          .from("event_inbox")
          .select("*")
          .eq("owner_id", ownerId)
          .order("created_at", { ascending: false });

        if (evErr) throw evErr;

        const evs = evRows || [];
        setEvents(evs);

        let attachmentsMap = {};
        if (evs.length > 0) {
          const eventIds = evs.map((e) => e.id);

          const { data: attRows, error: attErr } = await supabase
            .from("event_inbox_attachments")
            .select("*")
            .in("event_id", eventIds)
            .order("created_at", { ascending: false });

          if (attErr) throw attErr;

          attachmentsMap = {};
          (attRows || []).forEach((a) => {
            if (!a?.event_id) return;
            if (!attachmentsMap[a.event_id]) attachmentsMap[a.event_id] = [];
            attachmentsMap[a.event_id].push(a);
          });
        }
        setAttachmentsByEvent(attachmentsMap);

        /* --------- 1b. Reminders (reminders) --------- */
        const { data: remRows, error: remErr } = await supabase
          .from("reminders")
          .select("*")
          .eq("owner_id", ownerId)
          .in(
            "status",
            reminderFilter === "completed" ? ["completed"] : ["open"]
          )
          .order("due_at", { ascending: true });

        if (remErr) throw remErr;
        const rems = remRows || [];
        setReminders(rems);

        // Lookups for asset / system labels
        const assetIds = Array.from(
          new Set(
            [
              ...evs.map((e) => e.asset_id),
              ...(rems || []).map((r) => r.asset_id),
            ].filter(Boolean)
          )
        );
        const systemIds = Array.from(
          new Set(
            [
              ...evs.map((e) => e.system_id),
              ...(rems || []).map((r) => r.system_id),
            ].filter(Boolean)
          )
        );
        const homeSystemIds = Array.from(
          new Set(evs.map((e) => e.home_system_id).filter(Boolean))
        );

        if (assetIds.length > 0) {
          const { data: aRows, error: aErr } = await supabase
            .from("assets")
            .select("id, name")
            .in("id", assetIds);

          if (!aErr) {
            const m = {};
            (aRows || []).forEach((r) => {
              if (!r?.id) return;
              m[r.id] = r.name || "Asset";
            });
            setAssetNameById(m);
          }
        } else {
          setAssetNameById({});
        }

        if (systemIds.length > 0) {
          const { data: sRows, error: sErr } = await supabase
            .from("systems")
            .select("id, name")
            .in("id", systemIds);

          if (!sErr) {
            const m = {};
            (sRows || []).forEach((r) => {
              if (!r?.id) return;
              m[r.id] = r.name || "System";
            });
            setSystemNameById(m);
          }
        } else {
          setSystemNameById({});
        }

        if (homeSystemIds.length > 0) {
          const { data: hsRows, error: hsErr } = await supabase
            .from("home_systems")
            .select("id, name")
            .in("id", homeSystemIds);

          if (!hsErr) {
            const m = {};
            (hsRows || []).forEach((r) => {
              if (!r?.id) return;
              m[r.id] = r.name || "Home system";
            });
            setHomeSystemNameById(m);
          }
        } else {
          setHomeSystemNameById({});
        }

        /* --------- 2. Transfer requests (inbox_items) --------- */
        const { data: inboxRows, error: inboxErr } = await supabase
          .from("inbox_items")
          .select("*")
          .eq("to_user_id", ownerId)
          .eq("status", "pending")
          .order("created_at", { ascending: false });

        if (inboxErr) throw inboxErr;
        setTransferItems(inboxRows || []);
      } catch (e) {
        console.log("Notifications load error:", e);
      } finally {
        if (!opts.silent) setLoading(false);
      }
    },
    [ownerId, reminderFilter]
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadEverything({ silent: true });
    } finally {
      setRefreshing(false);
    }
  }, [loadEverything]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        await loadEverything({ silent: false });

        const reopenId = route?.params?.reopenEventId || null;
        if (reopenId) {
          setSelectedEventId(reopenId);
          // clear the param so it doesn't re-open forever
          try {
            navigation.setParams({ reopenEventId: null });
          } catch {}
        }

        const reopenReminderId = route?.params?.reopenReminderId || null;
        if (reopenReminderId) {
          try {
            navigation.navigate("CreateReminder", {
              reminderId: reopenReminderId,
              afterSave: "Notifications",
            });
            navigation.setParams({ reopenReminderId: null });
          } catch {}
        }
      })();
    }, [loadEverything, route, navigation])
  );

  const closeModal = () => setSelectedEventId(null);
  const closeViewer = () =>
    setViewer({ visible: false, url: null, mime: null, name: null });

  const openUrl = async (rawUrl) => {
    if (!rawUrl) return;

    // If the attachment is in a private bucket, the "public_url" won't work.
    // We sign it here if needed and cache it so repeated opens are instant.
    try {
      let url = rawUrl;

      const alreadySigned = String(url).includes("?token=");
      if (!alreadySigned) {
        const cached = attachmentUrlMap[url];
        if (cached) {
          url = cached;
        } else {
          const att = selectedAttachments.find(
            (a) => resolveAttachmentUrl(a) === rawUrl
          );

          if (att?.storage_path) {
            const { data, error } = await supabase.storage
              .from("asset-files")
              .createSignedUrl(att.storage_path, 60 * 60); // 1 hour
            if (!error && data?.signedUrl) {
              url = data.signedUrl;
              setAttachmentUrlMap((prev) => ({ ...prev, [rawUrl]: url }));
            }
          }
        }
      }

      const can = await Linking.canOpenURL(url);
      if (!can) {
        Alert.alert("Can’t open link", "Your device can’t open this link.");
        return;
      }
      await Linking.openURL(url);
    } catch (e) {
      Alert.alert("Couldn’t open", e?.message || "Please try again.");
    }
  };

  const openAttachmentFromEventModal = async (eventRow, attachment) => {
    try {
      if (!attachment) return;

      const status = String(eventRow?.status || "draft").toLowerCase();
      const mime = attachment?.mime_type || attachment?.content_type || "";
      const isImg = isProbablyImage(mime);

      console.log("ATT STORAGE PATH", attachment.storage_path);
      // Prefer a signed URL when we have a storage_path.
      let url = resolveAttachmentUrl(attachment);
      if (attachment?.storage_path) {
        const { data, error } = await supabase.storage
          .from("asset-files")
          .createSignedUrl(attachment.storage_path, 60 * 60); // 1 hour
        if (!error && data?.signedUrl) {
          url = data.signedUrl;
        }
      }

      // Drafts: preview in inbox flow (not in asset drawer yet).
      if (status === "draft") {
        setViewer({
          visible: true,
          url,
          mime,
          name: attachment?.file_name || "Attachment",
        });
        return;
      }

      // Submitted: asset drawer is the source of truth.
      openInAssetAttachments(eventRow, attachment, url, isImg);
    } catch (e) {
      console.log("openAttachmentFromEventModal error", e);
      const fallback = resolveAttachmentUrl(attachment);
      if (fallback) openUrl(fallback);
    }
  };

  // Phase 1: delegate attachment viewing to AssetAttachmentsScreen (Enablement Authority)
  const openInAssetAttachments = (eventRow, attachment, url, isImg) => {
    try {
      if (!attachment) return;

      // If we don't have asset context yet, fall back to direct open.
      if (!eventRow?.asset_id) {
        if (url) openUrl(url);
        return;
      }

      const assetId = eventRow.asset_id;
      const assetName = assetNameById[assetId] || "Asset";

      closeModal();

      navigation.navigate("AssetAttachments", {
        assetId,
        assetName,
        initialTab: isImg ? "photo" : "file",
        focusBucket: "asset-files",
        focusPath: attachment?.storage_path || null,
        focusUrl: url || null,
        sourceEventId: eventRow?.id || null,
        sourceAttachmentId: attachment?.id || null,
        returnTo: "Notifications",
      });
    } catch (e) {
      console.log("openInAssetAttachments error", e);
      if (url) openUrl(url);
    }
  };

  const goToEditEvent = (eventRow, intent = "enrich") => {
    if (!eventRow?.id) return;
    closeModal();
    navigation.navigate("CreateEvent", {
      eventId: eventRow.id,
      afterSave: "Notifications",
      mode: "enrich",
      intent, // "enrich" | "submit"
    });
  };

  const deleteAttachment = async (attachment) => {
    if (!attachment?.id) return;

    const ok = await confirmDestructive(
      "Delete attachment?",
      "This will remove the file from this event and can’t be undone."
    );
    if (!ok) return;

    setBusyDelete(true);
    try {
      if (attachment.storage_path) {
        try {
          await supabase.storage
            .from("asset-files")
            .remove([attachment.storage_path]);
        } catch (err) {
          console.log("Storage removal error (attachment):", err);
        }
      }

      const { error: delErr } = await supabase
        .from("event_inbox_attachments")
        .delete()
        .eq("id", attachment.id);

      if (delErr) throw delErr;

      await loadEverything({ silent: true });
    } catch (e) {
      console.log("Delete attachment error:", e);
      Alert.alert("Couldn’t delete", e?.message || "Please try again.");
    } finally {
      setBusyDelete(false);
    }
  };

  const deleteEvent = async (eventRow) => {
    if (!eventRow?.id) return;

    const ok = await confirmDestructive(
      "Delete draft?",
      "This will delete the event draft and its attachments."
    );
    if (!ok) return;

    setBusyDelete(true);
    try {
      const atts = attachmentsByEvent[eventRow.id] || [];
      const paths = atts.map((a) => a.storage_path).filter(Boolean);
      if (paths.length > 0) {
        try {
          await supabase.storage.from("asset-files").remove(paths);
        } catch (err) {
          console.log("Storage removal error (event):", err);
        }
      }

      await supabase
        .from("event_inbox_attachments")
        .delete()
        .eq("event_id", eventRow.id);

      const { error } = await supabase
        .from("event_inbox")
        .delete()
        .eq("id", eventRow.id);

      if (error) throw error;

      closeModal();
      await loadEverything({ silent: true });
    } catch (e) {
      console.log("Delete event error:", e);
      Alert.alert("Couldn’t delete", e?.message || "Please try again.");
    } finally {
      setBusyDelete(false);
    }
  };

  const submitEventToTimeline = async (eventRow) => {
    if (!eventRow?.id) return;
    if (!ownerId) return;

    if (!eventRow?.asset_id) {
      Alert.alert(
        "Needs context",
        "Add an Asset to this draft before saving it to the timeline."
      );
      return;
    }

    const ok = await confirmDestructive(
      "Save to timeline?",
      "This will file this event into the asset timeline and remove it from your draft inbox."
    );
    if (!ok) return;

    setBusyDelete(true);
    try {
      const { error } = await supabase.rpc("promote_event_to_service_record", {
        p_event_id: eventRow.id,
        p_owner_id: ownerId,
      });

      if (error) throw error;

      // promote_event_to_service_record deletes the inbox row when successful.
      closeModal();
      await loadEverything({ silent: true });

      if (Platform.OS === "web") {
        try {
          window.alert("Added to the timeline.");
        } catch {}
      } else {
        Alert.alert("Saved", "Added to the timeline.");
      }
    } catch (e) {
      console.log("submitEventToTimeline error", e);
      const msg = e?.message || "Please try again.";
      if (Platform.OS === "web") {
        try {
          window.alert(`Couldn’t save to timeline\n\n${msg}`);
        } catch {}
      } else {
        Alert.alert("Couldn’t save to timeline", msg);
      }
    } finally {
      setBusyDelete(false);
    }
  };

  /* ------------------------- transfer handlers ------------------------- */

  const handleAcceptTransfer = async (item) => {
    if (!item || !ownerId) return;

    const ok = await confirmDestructive(
      "Accept this KeeprStory?",
      `You'll become the steward of “${item.asset_name || "this asset"}”.`
    );
    if (!ok) return;

    setTransferBusyId(item.id);
    try {
      const { error } = await supabase.rpc("accept_asset_transfer", {
        p_inbox_item_id: item.id,
        p_user_id: ownerId,
      });

      if (error) {
        console.error("accept_asset_transfer error", error);
        throw error;
      }

      await loadEverything({ silent: true });

      Alert.alert(
        "Torch received 🔦",
        item.asset_name
          ? `You now carry the KeeprStory for “${item.asset_name}”.`
          : "You now carry this KeeprStory. Handle it with care."
      );
    } catch (e) {
      console.error("handleAcceptTransfer error", e);
      Alert.alert(
        "Couldn't accept transfer",
        e.message || "Something went wrong. Please try again."
      );
    } finally {
      setTransferBusyId(null);
    }
  };

  const handleDeclineTransfer = async (item) => {
    if (!item || !ownerId) return;

    const ok = await confirmDestructive(
      "Decline this transfer?",
      "No changes will be made to the original owner."
    );
    if (!ok) return;

    setTransferBusyId(item.id);
    try {
      const { error } = await supabase.rpc("decline_asset_transfer", {
        p_inbox_item_id: item.id,
        p_user_id: ownerId,
      });

      if (error) {
        console.error("decline_asset_transfer error", error);
        throw error;
      }

      await loadEverything({ silent: true });
    } catch (e) {
      console.error("handleDeclineTransfer error", e);
      Alert.alert(
        "Couldn't decline transfer",
        e.message || "Something went wrong. Please try again."
      );
    } finally {
      setTransferBusyId(null);
    }
  };

  /* ------------------------- render helpers ------------------------- */

  const badgeForStatus = (statusRaw) => {
    const s = String(statusRaw || "draft").toLowerCase();
    if (s === "submitted") {
      return (
        <View style={[styles.statusPill, styles.statusSubmitted]}>
          <Text style={[styles.statusText, styles.statusTextSubmitted]}>
            SUBMITTED
          </Text>
        </View>
      );
    }
    return (
      <View style={[styles.statusPill, styles.statusDraft]}>
        <Text style={[styles.statusText, styles.statusTextDraft]}>DRAFT</Text>
      </View>
    );
  };

  const renderEventCard = (ev) => {
    const isSelected = ev?.id === selectedEventId;
    const attCount = (attachmentsByEvent[ev.id] || []).length;
    const assetName = ev.asset_id ? assetNameById[ev.asset_id] : null;
    const originLabel = getOriginLabel(ev);
    const sourceLabel = getSourceLabel(ev);
    const intakeLine = [originLabel, sourceLabel].filter(Boolean).join(" • ");

    const ctxBits = [];
    if (assetName) ctxBits.push(assetName);
    if (ev.system_id && systemNameById[ev.system_id])
      ctxBits.push(systemNameById[ev.system_id]);
    const ctxLine = ctxBits.join(" • ");

    return (
      <TouchableOpacity
        key={ev.id}
        style={[styles.card, isSelected && styles.cardSelected]}
        activeOpacity={0.9}
        onPress={() => setSelectedEventId(ev.id)}
      >
        <View style={styles.cardHeaderRow}>
          <View style={styles.cardIconWrap}>
            <Ionicons
              name="sparkles-outline"
              size={18}
              color={colors.textSecondary}
            />
          </View>

          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle} numberOfLines={2}>
              {ev.title || "Event"}
            </Text>

            {intakeLine ? (
              <Text style={styles.cardOriginLine} numberOfLines={1}>
                {intakeLine}
              </Text>
            ) : null}

            <Text style={styles.cardMeta} numberOfLines={1}>
              {formatDateTimeUS(ev.created_at)}
              {ev.status ? ` · ${String(ev.status).toUpperCase()}` : ""}
            </Text>
          </View>

          <View style={{ alignItems: "flex-end" }}>
            {getEventModeLabel(ev) ? (
              <View style={[styles.statusPill, styles.statusDraft]}>
                <Text style={[styles.statusText, styles.statusTextDraft]}>
                  {getEventModeLabel(ev)}
                </Text>
              </View>
            ) : null}

            <View style={{ marginTop: getEventModeLabel(ev) ? 6 : 0 }}>
              {badgeForStatus(ev.status)}
            </View>
          </View>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.cardSubtle} numberOfLines={1}>
            {ctxLine || "No context yet · file this into a KeeprStory"}
          </Text>

          <Text style={styles.cardNotes} numberOfLines={3}>
            {ev.notes || ev.title || "—"}
          </Text>

          <View style={styles.cardFooterRow}>
            <Text style={styles.tipText} numberOfLines={1}>
              Tip: tap to enrich, add context, then save into the asset story.
            </Text>

            {attCount > 0 ? (
              <View style={styles.attachmentPill}>
                <Ionicons
                  name="attach-outline"
                  size={14}
                  color={colors.textSecondary}
                />
                <Text style={styles.attachmentPillText}>{attCount}</Text>
              </View>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const renderTransferCard = (item) => {
    const payload = item?.payload || {};
    const assetName =
      payload?.asset_name || item?.payload?.assetName || "Asset";
    const fromName =
      payload?.from_name ||
      payload?.fromEmail ||
      payload?.from ||
      item?.from_email ||
      "Someone";

    return (
      <View key={item.id} style={styles.transferCard}>
        <View style={styles.transferHeaderRow}>
          <View style={styles.transferIcon}>
            <Ionicons name="swap-horizontal" size={18} color="#2563EB" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.transferTitle} numberOfLines={2}>
              {assetName}
            </Text>
            <Text style={styles.transferMeta} numberOfLines={1}>
              From: {fromName}
            </Text>
          </View>

          {item?.status === "pending" ? (
            <View
              style={[styles.transferStatusPill, styles.transferStatusPending]}
            >
              <Text style={styles.transferStatusText}>PENDING</Text>
            </View>
          ) : item?.status === "accepted" ? (
            <View
              style={[styles.transferStatusPill, styles.transferStatusAccepted]}
            >
              <Text style={styles.transferStatusText}>ACCEPTED</Text>
            </View>
          ) : (
            <View
              style={[styles.transferStatusPill, styles.transferStatusDeclined]}
            >
              <Text style={styles.transferStatusText}>DECLINED</Text>
            </View>
          )}
        </View>

        <Text style={styles.transferBody}>
          Someone sent you ownership for this asset. Accept it to bring the
          KeeprStory, history, and proof of care into your portfolio.
        </Text>

        <View style={styles.transferActionsRow}>
          <TouchableOpacity
            style={[
              styles.transferSecondaryBtn,
              transferBusyId === item.id && { opacity: 0.6 },
            ]}
            onPress={() => handleDeclineTransfer(item)}
            disabled={transferBusyId === item.id}
            activeOpacity={0.9}
          >
            <Ionicons name="close-circle-outline" size={16} color="#DC2626" />
            <Text style={styles.transferSecondaryText}>Decline</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.transferPrimaryBtn,
              transferBusyId === item.id && { opacity: 0.6 },
            ]}
            onPress={() => handleAcceptTransfer(item)}
            disabled={transferBusyId === item.id}
            activeOpacity={0.9}
          >
            {transferBusyId === item.id ? (
              <ActivityIndicator color="#FFF" />
            ) : (
              <>
                <Ionicons
                  name="checkmark-circle-outline"
                  size={16}
                  color="#FFF"
                />
                <Text style={styles.transferPrimaryText}>Accept</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const TransferEmptyState = () => (
    <View style={styles.emptyRow}>
      <Ionicons
        name="swap-horizontal-outline"
        size={18}
        color={colors.textMuted}
      />
      <Text style={styles.emptyText}>
        No incoming transfers yet. When someone passes you the torch for an
        asset, the KeeprStory will land here.
      </Text>
    </View>
  );

  const EventEmptyState = () => (
    <View style={styles.emptyRow}>
      <Ionicons name="mail-outline" size={18} color={colors.textMuted} />
      <Text style={styles.emptyText}>
        Nothing in your event inbox yet. Create a quick event or forward an
        email to your Keepr intake address to start capturing the story.
      </Text>
    </View>
  );

  const renderReminderRow = (r) => {
    const assetName = r.asset_id ? assetNameById[r.asset_id] : null;
    const systemName = r.system_id ? systemNameById[r.system_id] : null;
    const ctx = [assetName, systemName].filter(Boolean).join(" • ");
    const overdue =
      r.status === "open" && r.due_at && new Date(r.due_at) < new Date();

    return (
      <TouchableOpacity
        key={r.id}
        style={styles.reminderCard}
        activeOpacity={0.9}
        onPress={() =>
          navigation.navigate("CreateReminder", {
            reminderId: r.id,
            afterSave: "Notifications",
          })
        }
      >
        <View style={{ flex: 1 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Text style={styles.reminderTitle} numberOfLines={1}>
              {r.title}
            </Text>
            {r.is_urgent ? (
              <View style={[styles.badge, styles.badgeOrange]}>
                <Text style={styles.badgeText}>Urgent</Text>
              </View>
            ) : null}
            {overdue ? (
              <View style={[styles.badge, styles.badgeRed]}>
                <Text style={styles.badgeText}>Overdue</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.reminderMeta} numberOfLines={1}>
            {formatDateTimeUS(r.due_at)}
            {ctx ? ` • ${ctx}` : ""}
          </Text>
        </View>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textMuted}
        />
      </TouchableOpacity>
    );
  };

  /* --------------------------- UI --------------------------- */

  if (!ownerId) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <Text style={{ color: colors.textPrimary, fontSize: 16 }}>
            Please sign in.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
          activeOpacity={0.9}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        <View style={styles.headerTextWrap}>
          <Text style={styles.title}>Notifications & Inbox</Text>
          <Text style={styles.subtitle}>
            Transfer requests, reminders, and quick-capture events all land
            here. This is your staging area before moments become part of a
            verified KeeprStory.
          </Text>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.wrap}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >

        {/* ---------------- Email Intake ---------------- */}
        {profileUsername ? (
          <View style={styles.intakeCard}>
            <View style={styles.intakeIconWrap}>
              <Ionicons name="mail-outline" size={18} color="rgb(45, 125, 227)" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.intakeTitle}>
                {profileUsername}@inbox.keeprhome.com
              </Text>
              <Text style={styles.intakeSub}>
                Forward invoices and receipts here — they’ll appear below as drafts.
              </Text>
            </View>

            <TouchableOpacity
              onPress={async () => {
                try {
                  await Clipboard.setStringAsync(`${profileUsername}@inbox.keeprhome.com`);
                  Alert.alert("Copied", "Inbox address copied to clipboard");
                } catch (e) {
                  Alert.alert("Copy failed", "Could not copy the inbox address.");
                }
              }}
            >
              <Text style={styles.intakeAction}>Copy</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.intakeCard}
            onPress={() => navigation.navigate("Profile")}
          >
            <View style={styles.intakeIconWrap}>
              <Ionicons name="at-outline" size={18} color="rgb(45, 125, 227)" />
            </View>

            <View style={{ flex: 1 }}>
              <Text style={styles.intakeTitle}>Set up your Keepr inbox</Text>
              <Text style={styles.intakeSub}>
                Choose a username to enable forwarding from email.
              </Text>
            </View>

            <Ionicons
              name="chevron-forward"
              size={18}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        )}

        {/* ---------------- Transfer requests ---------------- */}
        <Text style={styles.sectionTitle}>Transfer requests</Text>

        {transferItems.length === 0 ? (
          <TransferEmptyState />
        ) : (
          <View style={{ gap: spacing.md }}>
            {transferItems.map(renderTransferCard)}
          </View>
        )}

        {/* ---------------- Reminders ---------------- */}
        <View style={{ height: spacing.xl }} />

        <Text style={styles.sectionTitle}>Reminders</Text>
        <Text style={styles.subtitle}>
          Set follow-ups and maintenance tasks that jump you straight back into
          the right asset or system when they fire.
        </Text>

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[
              styles.filterChip,
              reminderFilter === "open" && styles.filterChipActive,
            ]}
            onPress={() => setReminderFilter("open")}
            activeOpacity={0.9}
          >
            <Text
              style={[
                styles.filterChipText,
                reminderFilter === "open" && styles.filterChipTextActive,
              ]}
            >
              Open
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              reminderFilter === "completed" && styles.filterChipActive,
            ]}
            onPress={() => setReminderFilter("completed")}
            activeOpacity={0.9}
          >
            <Text
              style={[
                styles.filterChipText,
                reminderFilter === "completed" && styles.filterChipTextActive,
              ]}
            >
              Completed
            </Text>
          </TouchableOpacity>

          <View style={{ flex: 1 }} />

          <TouchableOpacity
            style={styles.smallAction}
            activeOpacity={0.9}
            onPress={() =>
              navigation.navigate("CreateReminder", {
                afterSave: "Notifications",
              })
            }
          >
            <Ionicons name="add" size={16} color={colors.textPrimary} />
            <Text style={styles.smallActionText}>New</Text>
          </TouchableOpacity>
        </View>

        {/* View mode toggle: List vs Schedule */}
        <View style={styles.viewModeRow}>
          <Text style={styles.viewModeLabel}>View as</Text>
          <View style={styles.viewModeChips}>
            <TouchableOpacity
              style={[
                styles.viewModeChip,
                reminderViewMode === "list" && styles.viewModeChipActive,
              ]}
              onPress={() => setReminderViewMode("list")}
              activeOpacity={0.9}
            >
              <Text
                style={[
                  styles.viewModeChipText,
                  reminderViewMode === "list" && styles.viewModeChipTextActive,
                ]}
              >
                List
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.viewModeChip,
                reminderViewMode === "schedule" && styles.viewModeChipActive,
              ]}
              onPress={() => setReminderViewMode("schedule")}
              activeOpacity={0.9}
            >
              <Text
                style={[
                  styles.viewModeChipText,
                  reminderViewMode === "schedule" &&
                    styles.viewModeChipTextActive,
                ]}
              >
                Schedule
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ gap: spacing.sm }}>
          {reminders.length === 0 ? (
            <View style={styles.emptyRow}>
              <Ionicons
                name="alarm-outline"
                size={18}
                color={colors.textMuted}
              />
              <Text style={styles.emptyText}>
                {reminderFilter === "completed"
                  ? "No completed reminders yet. As you close out work, Keepr will keep the receipts for future you."
                  : "No open reminders. Add one for the next filter change, renewal, or recurring task you never want to forget."}
              </Text>
            </View>
          ) : reminderViewMode === "list" ? (
            sortedReminders.map(renderReminderRow)
          ) : (
            reminderDateKeys.map((key) => {
              const items = remindersByDate[key] || [];
              if (!items.length) return null;
              const label = formatDateLabel(key);
              return (
                <View key={key} style={styles.reminderDayBlock}>
                  <Text style={styles.reminderDayLabel}>{label}</Text>
                  <View style={{ gap: spacing.sm }}>
                    {items.map(renderReminderRow)}
                  </View>
                </View>
              );
            })
          )}
        </View>

        {/* ---------------- Event inbox ---------------- */}
        <View style={{ height: spacing.xl }} />

        <Text style={styles.sectionTitle}>Event inbox</Text>
        <Text style={styles.subtitle}>
          Draft emails, links, and quick captures waiting to be enriched into
          verified timeline records.
        </Text>

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[
              styles.filterChip,
              filter === "all" && styles.filterChipActive,
            ]}
            onPress={() => setFilter("all")}
            activeOpacity={0.9}
          >
            <Text
              style={[
                styles.filterChipText,
                filter === "all" && styles.filterChipTextActive,
              ]}
            >
              All
            </Text>
            <View
              style={[
                styles.countPill,
                filter === "all" && styles.countPillActive,
              ]}
            >
              <Text
                style={[
                  styles.countText,
                  filter === "all" && styles.countTextActive,
                ]}
              >
                {events.length}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              filter === "draft" && styles.filterChipActive,
            ]}
            onPress={() => setFilter("draft")}
            activeOpacity={0.9}
          >
            <Text
              style={[
                styles.filterChipText,
                filter === "draft" && styles.filterChipTextActive,
              ]}
            >
              Drafts
            </Text>
            <View
              style={[
                styles.countPill,
                filter === "draft" && styles.countPillActive,
              ]}
            >
              <Text
                style={[
                  styles.countText,
                  filter === "draft" && styles.countTextActive,
                ]}
              >
                {draftEvents.length}
              </Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterChip,
              filter === "submitted" && styles.filterChipActive,
            ]}
            onPress={() => setFilter("submitted")}
            activeOpacity={0.9}
          >
            <Text
              style={[
                styles.filterChipText,
                filter === "submitted" && styles.filterChipTextActive,
              ]}
            >
              Submitted
            </Text>
            <View
              style={[
                styles.countPill,
                filter === "submitted" && styles.countPillActive,
              ]}
            >
              <Text
                style={[
                  styles.countText,
                  filter === "submitted" && styles.countTextActive,
                ]}
              >
                {submittedEvents.length}
              </Text>
            </View>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={{ paddingTop: spacing.xl }}>
            <ActivityIndicator />
          </View>
        ) : visibleEvents.length === 0 ? (
          <EventEmptyState />
        ) : (
          <View style={{ gap: spacing.md }}>
            {visibleEvents.map(renderEventCard)}
          </View>
        )}

        <View style={{ height: spacing.xl * 3 }} />
      </ScrollView>

      {/* Add chooser: Event or Reminder */}
      <Modal
        visible={showAddChoice}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddChoice(false)}
      >
        <View style={styles.addChoiceOverlay}>
          <TouchableOpacity
            style={{ flex: 1 }}
            activeOpacity={1}
            onPress={() => setShowAddChoice(false)}
          />
          <View style={styles.addChoiceCard}>
            <Text style={styles.addChoiceTitle}>
              What would you like to add?
            </Text>

            <View style={styles.addChoiceButtons}>
              <TouchableOpacity
                style={styles.addChoiceBtn}
                activeOpacity={0.9}
                onPress={() => {
                  setShowAddChoice(false);
                  navigation.navigate("CreateEvent", {
                    assetId: contextAssetId,
                    systemId: contextSystemId,
                    recordId: contextRecordId,
                    afterSave: "Notifications",
                  });
                }}
              >
                <Ionicons
                  name="sparkles-outline"
                  size={18}
                  color={colors.textPrimary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.addChoiceBtnText}>Quick event - Not a Record yet, but could be soon.</Text>
                  <Text style={styles.addChoiceBtnSub}>
                    Quick way to Capture a visit, repair, or note for your timeline before you make it official.
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.addChoiceBtn}
                activeOpacity={0.9}
                onPress={() => {
                  setShowAddChoice(false);
                  navigation.navigate("CreateReminder", {
                    prefill: {
                      asset_id: contextAssetId,
                      system_id: contextSystemId,
                      record_id: contextRecordId,
                      status: "open",
                    },
                    afterSave: "Notifications",
                  });
                }}
              >
                <Ionicons
                  name="alarm-outline"
                  size={18}
                  color={colors.textPrimary}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.addChoiceBtnText}>Reminder</Text>
                  <Text style={styles.addChoiceBtnSub}>
                    Set a follow-up, renewal, or maintenance reminder.
                  </Text>
                </View>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.addChoiceCancel}
              onPress={() => setShowAddChoice(false)}
              activeOpacity={0.9}
            >
              <Text style={styles.addChoiceCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Floating add */}
      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.9}
        onPress={() => setShowAddChoice(true)}
      >
        <Ionicons name="add" size={22} color="#FFF" />
        <Text style={styles.fabText}>Add</Text>
      </TouchableOpacity>

      {/* Event modal */}
      <Modal
        visible={!!selectedEvent}
        animationType="fade"
        transparent
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={styles.modalScrollContent}
              showsVerticalScrollIndicator
            >
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle} numberOfLines={2}>
                    {selectedEvent?.title || "Event"}
                  </Text>
                  <Text style={styles.modalMeta}>
                    {(selectedEvent?.asset_id
                      ? assetNameById[selectedEvent.asset_id] || "No asset yet"
                      : "No asset yet") +
                      " • " +
                      formatDateTimeUS(selectedEvent?.created_at)}
                  </Text>

                  <View style={styles.modalBadgeRow}>
                    <View style={[styles.statusPill, styles.statusDraft]}>
                      <Text style={[styles.statusText, styles.statusTextDraft]}>
                        {String(selectedEvent?.status || "draft").toUpperCase()}
                      </Text>
                    </View>

                    {selectedEventPublicSender?.isPublic ? (
                      <View style={styles.modalSourcePill}>
                        <Text style={styles.modalSourcePillText}>PUBLIC</Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                <TouchableOpacity
                  onPress={closeModal}
                  style={styles.modalCloseBtn}
                  activeOpacity={0.85}
                >
                  <Ionicons name="close" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <View style={styles.modalBody}>
                {selectedEventPublicSender?.isPublic ? (
                  <>
                    <View style={styles.modalSection}>
                      <Text style={styles.modalSectionLabel}>PUBLIC SENDER</Text>
                      <View style={styles.senderCard}>
                        <View style={styles.senderRow}>
                          <Text style={styles.senderLabel}>Name</Text>
                          <Text style={styles.senderValue}>
                            {selectedEventPublicSender?.name || "Unknown"}
                          </Text>
                        </View>

                        <View style={styles.senderRow}>
                          <Text style={styles.senderLabel}>Email</Text>
                          <Text style={styles.senderValue}>
                            {selectedEventPublicSender?.email || "—"}
                          </Text>
                        </View>

                        <View style={styles.senderRow}>
                          <Text style={styles.senderLabel}>Phone</Text>
                          <Text style={styles.senderValue}>
                            {selectedEventPublicSender?.phone || "—"}
                          </Text>
                        </View>

                        <View style={styles.senderRow}>
                          <Text style={styles.senderLabel}>Action</Text>
                          <Text style={styles.senderValue}>
                            {selectedEventPublicSender?.actionType
                              ? String(selectedEventPublicSender.actionType)
                                  .replace(/_/g, " ")
                                  .replace(/\b\w/g, (c) => c.toUpperCase())
                              : "Public action"}
                          </Text>
                        </View>

                        {selectedEventPublicSender?.email ? (
                          <TouchableOpacity
                            style={styles.replyLinkBtn}
                            activeOpacity={0.85}
                            onPress={() =>
                              Linking.openURL(
                                `mailto:${selectedEventPublicSender.email}`
                              ).catch(() => {
                                Alert.alert(
                                  "Can’t open email",
                                  selectedEventPublicSender.email
                                );
                              })
                            }
                          >
                            <Ionicons
                              name="mail-outline"
                              size={14}
                              color="rgb(45, 125, 227)"
                            />
                            <Text style={styles.replyLinkText}>
                              Reply by email
                            </Text>
                          </TouchableOpacity>
                        ) : null}
                      </View>
                    </View>

                    <View style={styles.modalDivider} />
                  </>
                ) : null}

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionLabel}>NOTES</Text>
                  <Text
                    style={
                      selectedEvent?.notes
                        ? styles.modalBodyText
                        : styles.modalBodyTextMuted
                    }
                  >
                    {selectedEvent?.notes || "No notes added yet."}
                  </Text>
                </View>

                <View style={styles.modalDivider} />

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionLabel}>ATTACHMENTS</Text>

                  {selectedAttachments.length === 0 ? (
                    <Text style={styles.modalBodyTextMuted}>
                      No attachments yet. Add photos or PDFs when enriching this
                      into the asset story.
                    </Text>
                  ) : (
                    <View style={{ marginTop: spacing.sm }}>
                      {selectedAttachments.map((a) => {
                        const url = resolveAttachmentUrl(a);
                        const mime = a.mime_type || a.content_type || "unknown";
                        const isImg = isProbablyImage(mime);

                        return (
                          <View key={a.id} style={styles.attachmentRow}>
                            <View style={styles.attachmentIcon}>
                              <Ionicons
                                name={
                                  isImg
                                    ? "image-outline"
                                    : "document-text-outline"
                                }
                                size={16}
                                color={colors.textSecondary}
                              />
                            </View>

                            <TouchableOpacity
                              style={{ flex: 1 }}
                              activeOpacity={0.85}
                              onPress={() =>
                                openAttachmentFromEventModal(selectedEvent, a)
                              }
                            >
                              <Text
                                style={styles.attachmentName}
                                numberOfLines={1}
                              >
                                {a.file_name || "Attachment"}
                              </Text>
                              <Text
                                style={styles.attachmentMeta}
                                numberOfLines={1}
                              >
                                {mime} {url ? "· tap to open" : ""}
                              </Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                              onPress={() => deleteAttachment(a)}
                              activeOpacity={0.85}
                              hitSlop={10}
                              disabled={busyDelete}
                            >
                              <Ionicons
                                name="trash-outline"
                                size={18}
                                color={colors.textMuted}
                              />
                            </TouchableOpacity>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>

                <View style={styles.modalDivider} />

                <View style={styles.modalSection}>
                  <Text style={styles.modalSectionLabel}>CONTEXT</Text>

                  <View style={styles.contextGrid}>
                    <Text style={styles.contextGridKey}>Asset</Text>
                    <Text style={styles.contextGridValue}>
                      {selectedEvent?.asset_id
                        ? assetNameById[selectedEvent.asset_id] || "None assigned"
                        : "None assigned"}
                    </Text>

                    <Text style={styles.contextGridKey}>Home system</Text>
                    <Text style={styles.contextGridValue}>
                      {selectedEvent?.home_system_id
                        ? homeSystemNameById[selectedEvent.home_system_id] || "None assigned"
                        : "None assigned"}
                    </Text>

                    <Text style={styles.contextGridKey}>System</Text>
                    <Text style={styles.contextGridValue}>
                      {selectedEvent?.system_id
                        ? systemNameById[selectedEvent.system_id] || "None assigned"
                        : "None assigned"}
                    </Text>
                  </View>
                </View>
              </View>

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={[
                    styles.commitBtnLarge,
                    !selectedEvent?.asset_id && styles.commitBtnDisabled,
                    busyDelete && { opacity: 0.7 },
                  ]}
                  onPress={() => submitEventToTimeline(selectedEvent)}
                  disabled={busyDelete || !selectedEvent?.asset_id}
                  activeOpacity={0.9}
                >
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={16}
                    color="#FFFFFF"
                  />
                  <Text style={styles.primaryText}>Save to Timeline</Text>
                </TouchableOpacity>

                <View style={styles.modalSecondaryActions}>
                  <TouchableOpacity
                    style={[
                      styles.secondaryBtn,
                      busyDelete && { opacity: 0.7 },
                    ]}
                    onPress={() => goToEditEvent(selectedEvent, "enrich")}
                    disabled={busyDelete}
                    activeOpacity={0.9}
                  >
                    <Ionicons
                      name="create-outline"
                      size={16}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.secondaryText}>Edit</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.secondaryBtn,
                      busyDelete && { opacity: 0.7 },
                    ]}
                    onPress={() => {
                      if (!selectedEvent) return;
                      closeModal();
                      navigation.navigate("CreateReminder", {
                        prefill: {
                          title: selectedEvent?.title
                            ? `Follow up: ${selectedEvent.title}`
                            : "Follow up",
                          notes: selectedEvent?.notes || "",
                          due_at: new Date(
                            Date.now() + 1000 * 60 * 60 * 24 * 30
                          ).toISOString(),
                          has_time: true,
                          is_urgent: false,
                          repeat_rule: null,
                          status: "open",
                          asset_id: selectedEvent?.asset_id || null,
                          system_id: selectedEvent?.system_id || null,
                          record_id: null,
                          event_id: selectedEvent?.id || null,
                          extra_metadata: {
                            source: "event_inbox_modal",
                          },
                        },
                        afterSave: "Notifications",
                      });
                    }}
                    disabled={busyDelete}
                    activeOpacity={0.9}
                  >
                    <Ionicons
                      name="alarm-outline"
                      size={16}
                      color={colors.textPrimary}
                    />
                    <Text style={styles.secondaryText}>Reminder</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.dangerBtnOutline,
                      busyDelete && { opacity: 0.6 },
                    ]}
                    onPress={() => deleteEvent(selectedEvent)}
                    disabled={busyDelete}
                    activeOpacity={0.9}
                  >
                    {busyDelete ? (
                      <ActivityIndicator color="#DC2626" />
                    ) : (
                      <>
                        <Ionicons
                          name="trash-outline"
                          size={16}
                          color="#DC2626"
                        />
                        <Text style={styles.dangerTextOutline}>Delete</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>

                <Text style={styles.modalHelperText}>
                  Draft event. Save to timeline when ready.
                </Text>
                {!selectedEvent?.asset_id ? (
                  <Text style={styles.modalHelperText}>
                    Add an Asset before filing this moment into a KeeprStory.
                  </Text>
                ) : null}
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Attachment viewer (draft preview) */}
      <Modal
        visible={!!viewer.visible}
        animationType="fade"
        transparent
        onRequestClose={closeViewer}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.viewerModal}>
            <View style={styles.viewerTopBar}>
              <View style={{ flex: 1 }}>
                <Text style={styles.viewerTitle} numberOfLines={1}>
                  {viewer.name || "Attachment"}
                </Text>
                <Text style={styles.viewerSubtitle} numberOfLines={1}>
                  Draft attachment · waiting to join the story
                </Text>
              </View>

              <TouchableOpacity
                onPress={closeViewer}
                style={styles.viewerCloseBtn}
                activeOpacity={0.85}
              >
                <Ionicons name="close" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <View style={styles.viewerStage}>
              {!viewer.url ? (
                <View style={styles.viewerEmpty}>
                  <Ionicons
                    name="warning-outline"
                    size={28}
                    color={colors.textSecondary}
                  />
                  <Text style={styles.viewerEmptyText}>
                    No preview available yet.
                  </Text>
                  <Text style={styles.viewerEmptySubtext}>
                    Save the draft again or re-attach the file, then try
                    opening it from here.
                  </Text>
                </View>
              ) : String(viewer.mime || "")
                  .toLowerCase()
                  .startsWith("image/") ? (
                <Image
                  source={{ uri: viewer.url }}
                  style={styles.viewerImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={styles.viewerDoc}>
                  <View style={styles.viewerDocIcon}>
                    <Ionicons
                      name="document-text-outline"
                      size={22}
                      color={colors.textSecondary}
                    />
                  </View>

                  <Text style={styles.viewerDocName} numberOfLines={2}>
                    {viewer.name || "File"}
                  </Text>
                  <Text style={styles.viewerDocMeta} numberOfLines={1}>
                    {viewer.mime || "document"}
                  </Text>

                  <TouchableOpacity
                    style={styles.viewerPrimaryBtn}
                    onPress={() => {
                      const u = viewer.url;
                      closeViewer();
                      if (u) openUrl(u);
                    }}
                    activeOpacity={0.9}
                    disabled={!viewer.url}
                  >
                    <Ionicons
                      name="open-outline"
                      size={16}
                      color="#FFFFFF"
                    />
                    <Text style={styles.viewerPrimaryText}>Open file</Text>
                  </TouchableOpacity>

                  <Text style={styles.viewerDocHint}>
                    Inline preview will get richer over time. For now, Keepr
                    opens the source file safely while keeping you anchored in
                    the draft flow.
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.viewerBottomBar}>
              <TouchableOpacity
                style={styles.viewerSecondaryBtn}
                onPress={closeViewer}
                activeOpacity={0.9}
              >
                <Ionicons
                  name="arrow-back-outline"
                  size={16}
                  color={colors.textPrimary}
                />
                <Text style={styles.viewerSecondaryText}>Back</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.viewerSecondaryBtn}
                onPress={() => {
                  closeViewer();
                  if (selectedEvent?.id) {
                    navigation.navigate("CreateEvent", {
                      eventId: selectedEvent.id,
                      afterSave: "Notifications",
                      mode: "edit",
                    });
                  }
                }}
                activeOpacity={0.9}
              >
                <Ionicons
                  name="create-outline"
                  size={16}
                  color={colors.textPrimary}
                />
                <Text style={styles.viewerSecondaryText}>Edit draft</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

/* --------------------------- styles --------------------------- */

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },

  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
    gap: spacing.md,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTextWrap: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  emptyRow: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    alignItems: "flex-start",
  },
  emptyText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },

  /* ---------------- filters ---------------- */

  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  filterChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  filterChipActive: {
    backgroundColor: "rgb(45, 125, 227)",
    borderColor: "rgb(45, 125, 227)",
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: "#FFFFFF",
  },
  countPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  countPillActive: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderColor: "rgba(255,255,255,0.28)",
  },
  countText: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textSecondary,
  },
  countTextActive: {
    color: "#FFFFFF",
  },

  /* ---------------- cards ---------------- */
/* ---------------- intake banner ---------------- */

intakeCard: {
  flexDirection: "row",
  alignItems: "flex-start",
  gap: spacing.sm,
  padding: spacing.md,
  marginBottom: spacing.lg,
  borderRadius: radius.lg,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  backgroundColor: colors.surface,
  ...shadows.card,
},
intakeIconWrap: {
  width: 34,
  height: 34,
  borderRadius: 17,
  backgroundColor: "rgba(45, 125, 227, 0.08)",
  borderWidth: 1,
  borderColor: "rgba(45, 125, 227, 0.25)",
  alignItems: "center",
  justifyContent: "center",
},
intakeTitle: {
  fontSize: 13,
  fontWeight: "900",
  color: colors.textPrimary,
},
intakeSub: {
  marginTop: 4,
  fontSize: 12,
  lineHeight: 18,
  color: colors.textSecondary,
},
  intakeAction: {
  fontSize: 12,
  fontWeight: "700",
  color: "rgb(45, 125, 227)",
},

  card: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    overflow: "hidden",
    ...shadows.card,
  },
  cardSelected: {
    borderColor: "rgba(45, 125, 227, 0.7)",
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    gap: spacing.sm,
  },
  cardIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  cardOriginLine: {
  marginTop: 3,
  fontSize: 11,
  fontWeight: "800",
  color: colors.textSecondary,
},
  cardMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
  },
  cardBody: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  cardSubtle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  cardNotes: {
    marginTop: 6,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
  cardFooterRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  tipText: {
    flex: 1,
    fontSize: 11,
    color: colors.textMuted,
  },
  attachmentPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  attachmentPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
  },

  statusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  statusText: {
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  statusDraft: {
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  statusTextDraft: {
    color: colors.textSecondary,
  },
  statusSubmitted: {
    borderColor: "rgba(22, 163, 74, 0.35)",
    backgroundColor: "rgba(22, 163, 74, 0.08)",
  },
  statusTextSubmitted: {
    color: "#16A34A",
  },

  /* ---------------- transfers ---------------- */

  transferCard: {
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    padding: spacing.md,
    ...shadows.card,
  },
  transferHeaderRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  transferIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(37, 99, 235, 0.10)",
    borderWidth: 1,
    borderColor: "rgba(37, 99, 235, 0.25)",
  },
  transferTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  transferMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
  },
  transferStatusPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    alignSelf: "flex-start",
  },
  transferStatusPending: {
    borderColor: "rgba(37, 99, 235, 0.35)",
    backgroundColor: "rgba(37, 99, 235, 0.08)",
  },
  transferStatusAccepted: {
    borderColor: "rgba(22, 163, 74, 0.35)",
    backgroundColor: "rgba(22, 163, 74, 0.08)",
  },
  transferStatusDeclined: {
    borderColor: "#DC2626",
    backgroundColor: "rgba(220, 38, 38, 0.08)",
  },
  transferStatusText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  transferBody: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  transferActionsRow: {
    marginTop: spacing.sm,
    flexDirection: "row",
    gap: spacing.sm,
  },
  transferSecondaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#DC2626",
    backgroundColor: colors.surface,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  transferSecondaryText: {
    fontSize: 13,
    fontWeight: "700",
    color: "#DC2626",
  },
  transferPrimaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: radius.lg,
    backgroundColor: "rgb(45, 125, 227)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  transferPrimaryText: {
    fontSize: 13,
    fontWeight: "800",
    color: "#FFFFFF",
  },

  /* ---------------- floating add ---------------- */

  fab: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: "rgba(45, 124, 227, 0.8);",
    borderRadius: 999,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    ...shadows.card,
  },
  fabText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 14,
  },

  /* ---------------- modal ---------------- */

modalOverlay: {
  ...Platform.select({
    web: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    default: {
      flex: 1,
    },
  }),
  backgroundColor: "rgba(0,0,0,0.35)",
  justifyContent: "center",
  alignItems: "center",
  padding: 24,
},
modalRoot: {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: "rgba(0,0,0,0.35)",
  justifyContent: "center",
  alignItems: "center",
  padding: spacing.lg,
},
modalCard: {
  width: "100%",
  maxWidth: 720,
  maxHeight: "90%",
  minHeight: 500,
  borderRadius: 16,
  backgroundColor: "#fff",
  overflow: "hidden",
  ...shadows.card,
},

  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  modalMeta: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
  },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  modalBody: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  modalScrollContent: {
    paddingBottom: spacing.lg,
  },
  modalSectionLabel: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textMuted,
    letterSpacing: 0.6,
  },
  modalSection: {
    marginTop: spacing.xs,
  },
  modalDivider: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  modalBadgeRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 10,
  },
  modalSourcePill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(45, 125, 227, 0.25)",
    backgroundColor: "rgba(45, 125, 227, 0.08)",
  },
  modalSourcePillText: {
    fontSize: 11,
    fontWeight: "900",
    color: "rgb(45, 125, 227)",
    letterSpacing: 0.4,
  },
  modalBodyText: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textPrimary,
  },
  modalBodyTextMuted: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
  },
  senderCard: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.lg,
    backgroundColor: colors.background,
    padding: spacing.md,
    gap: 8,
  },
  senderRow: {
    flexDirection: "row",
    gap: 8,
  },
  senderLabel: {
    width: 72,
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  senderValue: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
  },
  replyLinkBtn: {
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
  },
  replyLinkText: {
    fontSize: 12,
    fontWeight: "800",
    color: "rgb(45, 125, 227)",
  },
  contextGrid: {
    marginTop: 8,
    rowGap: 10,
  },
  contextGridKey: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  contextGridValue: {
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: 2,
  },

  attachmentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  attachmentIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  attachmentName: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  attachmentMeta: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
  },
  modalFooter: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
  },
  modalActionRow: {
    flexDirection: "column",
    gap: spacing.sm,
  },
  modalSecondaryActions: {
    marginTop: spacing.sm,
    flexDirection: Platform.OS === "web" ? "row" : "column",
    gap: spacing.sm,
  },
  secondaryBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 5,
  },
  secondaryText: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  dangerBtn: {
    flex: 1,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  dangerText: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.brandWhite || "#FFFFFF",
  },

  modalTripleRow: {
    width: "100%",
    flexDirection: Platform.OS === "web" ? "row" : "column",
    alignItems: "stretch",
    gap: spacing.sm,
  },

  primaryBtn: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: "rgb(45, 125, 227)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryText: {
    fontSize: 12,
    fontWeight: "700",
    color: "#FFFFFF",
  },

  commitBtn: {
    flex: 1.3,
    borderRadius: radius.lg,
    backgroundColor: "rgb(34, 197, 94)",
    paddingVertical: 8,
    paddingHorizontal: 8,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  commitBtnLarge: {
    width: "100%",
    borderRadius: radius.lg,
    backgroundColor: "rgb(34, 197, 94)",
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  commitBtnDisabled: {
    backgroundColor: "rgba(34, 197, 94, 0.35)",
  },
  commitText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  dangerBtnSmall: {
    flex: 0.8,
    borderRadius: radius.lg,
    backgroundColor: "#DC2626",
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerBtnOutline: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#DC2626",
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  dangerTextOutline: {
    fontSize: 13,
    fontWeight: "700",
    color: "#DC2626",
  },

  keepDraftLink: {
    marginTop: spacing.sm,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  keepDraftText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textMuted,
  },
  modalHelperText: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },

  /* ---------------- attachment viewer ---------------- */

  viewerModal: {
    width: "100%",
    maxWidth: 980,
    height: "86%",
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    overflow: "hidden",
    ...shadows.card,
  },
  viewerTopBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  viewerTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  viewerSubtitle: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
  },
  viewerCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerStage: {
    flex: 1,
    backgroundColor: colors.background,
  },
  viewerImage: {
    width: "100%",
    height: "100%",
  },
  viewerEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    gap: spacing.sm,
  },
  viewerEmptyText: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
    textAlign: "center",
  },
  viewerEmptySubtext: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: "center",
    lineHeight: 18,
  },
  viewerDoc: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  viewerDocIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
  },
  viewerDocName: {
    marginTop: spacing.md,
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
    textAlign: "center",
  },
  viewerDocMeta: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: "center",
  },
  viewerPrimaryBtn: {
    marginTop: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: "rgb(45, 125, 227)",
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  viewerPrimaryText: {
    fontSize: 12,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  viewerDocHint: {
    marginTop: spacing.md,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
    textAlign: "center",
    maxWidth: 420,
  },
  viewerBottomBar: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  viewerSecondaryBtn: {
    flex: 1,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
    paddingVertical: 10,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  viewerSecondaryText: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
  },

  // Reminders
  smallAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#11182722",
  },
  smallActionText: {
    fontWeight: "900",
    color: colors.textPrimary,
    fontSize: 12,
  },

  viewModeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    marginBottom: spacing.sm,
    gap: spacing.sm,
  },
  viewModeLabel: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textMuted,
  },
  viewModeChips: {
    flexDirection: "row",
    gap: 8,
  },
  viewModeChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  viewModeChipActive: {
    backgroundColor: "rgb(45, 125, 227)",
    borderColor: "rgb(45, 125, 227)",
  },
  viewModeChipText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  viewModeChipTextActive: {
    color: "#FFFFFF",
  },

  reminderCard: {
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: "#11182711",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    ...(shadows?.subtle || {}),
  },
  reminderTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
    flexShrink: 1,
  },
  reminderMeta: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    marginTop: 4,
  },

  reminderDayBlock: {
    marginTop: spacing.sm,
  },
  reminderDayLabel: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSecondary,
    marginBottom: 4,
  },

  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  badgeOrange: { backgroundColor: "#FFF7ED", borderColor: "#FDBA7422" },
  badgeRed: { backgroundColor: "#FEF2F2", borderColor: "#FCA5A522" },
  badgeText: { fontSize: 11, fontWeight: "900", color: colors.textPrimary },

  // Add choice bottom sheet
  addChoiceOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  addChoiceCard: {
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderTopWidth: 1,
    borderColor: colors.borderSubtle,
  },
  addChoiceTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  addChoiceButtons: {
    gap: spacing.sm,
  },
  addChoiceBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.background,
  },
  addChoiceBtnText: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  addChoiceBtnSub: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textMuted,
  },
  addChoiceCancel: {
    marginTop: spacing.md,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  addChoiceCancelText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textMuted,
  },
});
