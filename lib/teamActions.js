import { createNotification } from "./hubsApi";
import {
  ensureNotificationPerms,
  scheduleReminderNotification,
} from "./remindersNotifications";
import { supabase } from "./supabaseClient";

function cleanString(value) {
  return String(value || "").trim();
}

function safeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function uniqByKey(items) {
  const seen = new Set();
  return (items || []).filter((item) => {
    const key = item?.key || `${item?.type}:${item?.id || item?.label}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function buildReminderAssignmentTarget({
  type,
  id = null,
  label,
  scope = null,
  assetId = null,
  systemId = null,
}) {
  const cleanLabel = cleanString(label);
  if (!type || !cleanLabel) return null;

  return {
    type,
    id: id || type,
    label: cleanLabel,
    scope: scope || null,
    asset_id: assetId || null,
    system_id: systemId || null,
  };
}

export function normalizeReminderAssignment(extraMetadata = {}) {
  const meta = safeObject(extraMetadata);
  const responsible = safeObject(meta.responsible_party);
  const target = safeObject(meta.assignment_target);
  const label = cleanString(
    responsible.label ||
      (responsible.type === "unassigned" ? "Unassigned" : "") ||
      target.label ||
      meta.assigned_to
  );

  if (responsible.type === "unassigned") {
    return {
      assignedTo: "",
      assignmentTarget: null,
      responsibleParty: {
        type: "unassigned",
        id: "unassigned",
        label: "Unassigned",
        org_id: responsible.org_id || null,
      },
    };
  }

  if (responsible.type === "team_member" && label) {
    return {
      assignedTo: label,
      assignmentTarget: {
        type: "team_member",
        id: responsible.id,
        label,
        scope: responsible.scope || null,
        org_id: responsible.org_id || null,
        asset_id: responsible.asset_id || null,
        system_id: responsible.system_id || null,
      },
      responsibleParty: {
        ...responsible,
        label,
      },
    };
  }

  if (target.type === "keepr_pro") {
    return {
      assignedTo: "",
      assignmentTarget: null,
      responsibleParty: null,
    };
  }

  if (target.type === "team") {
    return {
      assignedTo: "",
      assignmentTarget: null,
      responsibleParty: {
        type: "unassigned",
        id: "unassigned",
        label: "Unassigned",
        org_id: target.org_id || null,
      },
    };
  }

  if (target.type && label) {
    return {
      assignedTo: label,
      assignmentTarget: {
        ...target,
        label,
      },
      responsibleParty: null,
    };
  }

  return {
    assignedTo: label,
    assignmentTarget: null,
    responsibleParty: null,
  };
}

export function normalizeReminderProvider(extraMetadata = {}) {
  const meta = safeObject(extraMetadata);
  const provider = safeObject(meta.provider_target);
  const assignment = safeObject(meta.assignment_target);
  const target = provider.type ? provider : assignment.type === "keepr_pro" ? assignment : {};
  const label = cleanString(target.label || meta.provider || meta.keepr_pro_label);

  if (target.type && label) {
    return {
      providerLabel: label,
      providerTarget: {
        ...target,
        label,
      },
    };
  }

  return {
    providerLabel: label,
    providerTarget: null,
  };
}

export function getReminderResponsibilityLabel(reminderOrMeta = {}) {
  const meta = reminderOrMeta?.extra_metadata
    ? reminderOrMeta.extra_metadata
    : reminderOrMeta;
  const assignment = normalizeReminderAssignment(meta);
  return assignment.responsibleParty?.type === "unassigned"
    ? "Unassigned"
    : assignment.assignedTo;
}

export function getReminderProviderLabel(reminderOrMeta = {}) {
  const meta = reminderOrMeta?.extra_metadata
    ? reminderOrMeta.extra_metadata
    : reminderOrMeta;
  return normalizeReminderProvider(meta).providerLabel;
}

export function getReminderVisibilityScope(reminderOrMeta = {}) {
  const reminder = reminderOrMeta?.extra_metadata ? reminderOrMeta : null;
  const meta = reminder?.extra_metadata || reminderOrMeta || {};
  const explicit = cleanString(meta.visibility_scope).toLowerCase();
  if (explicit === "team") return "team";
  if (explicit === "private") return "private";

  const target = safeObject(meta.assignment_target);
  const legacyTeam =
    target.type === "team" ||
    target.type === "team_member" ||
    cleanString(meta.assigned_to).toLowerCase() === "team";
  return legacyTeam && (!reminder || reminder.asset_id) ? "team" : "private";
}

export function getReminderActionContext(reminderOrMeta = {}) {
  const reminder = reminderOrMeta?.extra_metadata ? reminderOrMeta : null;
  const meta = reminder?.extra_metadata || reminderOrMeta || {};
  const explicit = cleanString(meta.action_context).toLowerCase();
  if (["personal", "household", "asset", "system"].includes(explicit)) {
    return explicit;
  }

  const assetId = reminder?.asset_id || meta.asset_id || meta.completion_asset_id;
  const systemId = reminder?.system_id || meta.system_id || meta.completion_system_id;
  if (systemId) return "system";
  if (assetId) return "asset";
  return getReminderVisibilityScope(reminderOrMeta) === "team"
    ? "household"
    : "personal";
}

export function buildBaseAssignmentOptions({ ownerId, assetId, systemId }) {
  return [
    {
      key: "owner",
      label: "Owner",
      detail: "Responsible owner",
      target: buildReminderAssignmentTarget({
        type: "owner",
        id: ownerId || "owner",
        label: "Owner",
        scope: assetId || systemId ? "asset" : null,
        assetId,
        systemId,
      }),
    },
    {
      key: "team",
      label: "Team",
      detail: "Shared team action",
      target: buildReminderAssignmentTarget({
        type: "team",
        id: "team",
        label: "Team",
        scope: assetId || systemId ? "asset" : null,
        assetId,
        systemId,
      }),
    },
  ];
}

export function buildTeamAssignmentOption({
  orgId,
  assetId = null,
  systemId = null,
}) {
  return {
    key: orgId ? `team:${orgId}` : "team",
    label: "Unassigned",
    detail: "No one responsible yet",
    target: {
      ...buildReminderAssignmentTarget({
        type: "unassigned",
        id: "unassigned",
        label: "Unassigned",
        scope: assetId || systemId ? "asset" : null,
        assetId,
        systemId,
      }),
      org_id: orgId || null,
    },
  };
}

export function buildTeamMemberAssignmentOption({
  userId,
  orgId,
  label,
  assetId = null,
  systemId = null,
}) {
  const cleanLabel = cleanString(label) || "Team member";
  if (!userId || !orgId) return null;
  return {
    key: `team_member:${orgId}:${userId}`,
    label: cleanLabel,
    detail: "Team member",
    target: {
      ...buildReminderAssignmentTarget({
        type: "team_member",
        id: userId,
        label: cleanLabel,
        scope: assetId || systemId ? "asset" : null,
        assetId,
        systemId,
      }),
      org_id: orgId,
    },
  };
}

export function extractSystemKeeprProIds(systemRow) {
  const meta = safeObject(systemRow?.metadata || systemRow?.extra_metadata);
  const standard = safeObject(meta.standard);
  const relationships = safeObject(
    standard.relationships || meta.relationships
  );
  const raw =
    relationships.keepr_pro_ids ||
    relationships.keeprProIds ||
    relationships.keepr_pros ||
    [];

  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => (typeof item === "string" ? item : item?.id))
    .filter(Boolean);
}

export function buildKeeprProAssignmentOptions({
  keeprPros = [],
  systemKeeprProIds = [],
  assetId = null,
  systemId = null,
}) {
  const systemIds = new Set(systemKeeprProIds || []);
  const byId = new Map((keeprPros || []).map((pro) => [pro.id, pro]));

  const systemOptions = (systemKeeprProIds || [])
    .map((id) => byId.get(id))
    .filter(Boolean)
    .map((pro) => ({
      key: `keepr_pro:system:${pro.id}`,
      label: pro.name || pro.label || "KeeprPro",
      detail: "KeeprPro for this system",
      target: buildReminderAssignmentTarget({
        type: "keepr_pro",
        id: pro.id,
        label: pro.name || pro.label || "KeeprPro",
        scope: "system",
        assetId,
        systemId,
      }),
    }));

  const assetOptions = (keeprPros || [])
    .filter((pro) => pro?.id && !systemIds.has(pro.id))
    .map((pro) => ({
      key: `keepr_pro:asset:${pro.id}`,
      label: pro.name || pro.label || "KeeprPro",
      detail: systemId ? "KeeprPro for this asset" : "KeeprPro",
      target: buildReminderAssignmentTarget({
        type: "keepr_pro",
        id: pro.id,
        label: pro.name || pro.label || "KeeprPro",
        scope: systemId ? "asset" : assetId ? "asset" : null,
        assetId,
        systemId: null,
      }),
    }));

  return uniqByKey([...systemOptions, ...assetOptions]);
}

export function isSameAssignmentTarget(a, b) {
  if (!a || !b) return false;
  return (
    a.type === b.type &&
    String(a.id || "") === String(b.id || "") &&
    String(a.scope || "") === String(b.scope || "")
  );
}

export function buildReminderDeepLink(reminderId, afterSave = "Notifications") {
  if (!reminderId) return "keepr://inbox";
  const params = new URLSearchParams({
    reminderId: String(reminderId),
    afterSave,
  });
  return `keepr://CreateReminder?${params.toString()}`;
}

export function buildReminderWebLink(reminderId, afterSave = "Notifications") {
  if (!reminderId) return null;
  if (typeof window !== "undefined" && window?.location?.origin) {
    const url = new URL("/CreateReminder", window.location.origin);
    url.searchParams.set("reminderId", String(reminderId));
    url.searchParams.set("afterSave", afterSave);
    return url.toString();
  }
  return buildReminderDeepLink(reminderId, afterSave);
}

function isMissingCoordinationRpc(error) {
  return (
    error?.code === "PGRST202" ||
    String(error?.message || "").includes("get_coordination_action") ||
    String(error?.message || "").includes("get_coordination_actions") ||
    String(error?.message || "").includes("complete_coordination_action")
  );
}

export async function fetchCoordinationActions({
  statuses = null,
  ownerId = null,
} = {}) {
  const { data, error } = await supabase.rpc("get_coordination_actions", {
    p_statuses: statuses,
  });
  if (error) {
    if (!isMissingCoordinationRpc(error) || !ownerId) throw error;

    let fallback = supabase
      .from("reminders")
      .select("*")
      .eq("owner_id", ownerId);

    if (Array.isArray(statuses) && statuses.length > 0) {
      fallback = fallback.in("status", statuses);
    }

    const { data: fallbackData, error: fallbackError } = await fallback;
    if (fallbackError) throw fallbackError;
    return fallbackData || [];
  }
  return data || [];
}

export async function fetchCoordinationAction(reminderId, { ownerId = null } = {}) {
  if (!reminderId) return null;
  const { data, error } = await supabase.rpc("get_coordination_action", {
    p_reminder_id: reminderId,
  });
  if (error) {
    if (!isMissingCoordinationRpc(error) || !ownerId) throw error;

    const { data: fallbackData, error: fallbackError } = await supabase
      .from("reminders")
      .select("*")
      .eq("id", reminderId)
      .eq("owner_id", ownerId)
      .maybeSingle();
    if (fallbackError) throw fallbackError;
    return fallbackData || null;
  }
  return data || null;
}

export async function completeSharedCoordinationAction({
  reminderId,
  completionMetadata,
}) {
  if (!reminderId) return null;
  const { data, error } = await supabase.rpc("complete_coordination_action", {
    p_reminder_id: reminderId,
    p_completion_metadata: completionMetadata || {},
  });
  if (error) throw error;
  return data || null;
}

export async function createReminderWebNotifications({
  ownerId,
  reminderId,
  title,
  dueAtISO,
  assignmentTarget,
  assetName = null,
  systemName = null,
  shouldNotifyAssignment = true,
}) {
  if (!ownerId || !reminderId) return;

  const context = [assetName, systemName].filter(Boolean).join(" • ");
  // V0 only records assignment/change notifications on save. Timed web
  // "reminder due" notifications need a future scheduler/background job.
  const payload = {
    reminder_id: reminderId,
    assignment_target: assignmentTarget || null,
    asset_name: assetName || null,
    system_name: systemName || null,
    due_at: dueAtISO || null,
    deep_link: buildReminderWebLink(reminderId),
  };

  const writes = [];

  if (shouldNotifyAssignment && assignmentTarget?.label) {
    writes.push(
      createNotification({
        userId: ownerId,
        type: "reminder_assigned",
        title: `Reminder assigned: ${title || "Reminder"}`,
        body: [assignmentTarget.label, context].filter(Boolean).join(" • "),
        payload,
      })
    );
  }

  await Promise.all(
    writes.map((write) =>
      write.catch((error) => {
        console.log("Reminder notification write skipped:", error);
        return null;
      })
    )
  );
}

export async function scheduleReminderPushNotification({
  reminderId,
  title,
  body,
  dueAtISO,
}) {
  try {
    const perms = await ensureNotificationPerms();
    if (!perms?.granted) return null;
    return await scheduleReminderNotification({
      reminderId,
      title,
      body,
      dueAtISO,
    });
  } catch (error) {
    console.log("Reminder push scheduling skipped:", error);
    return null;
  }
}

const DAY_MS = 86400000;

function parseLocalDate(value) {
  if (!value) return null;
  const raw = String(value).slice(0, 10);
  const parts = raw.split("-").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  return new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0, 0);
}

function toDateOnly(value) {
  const parsed = parseLocalDate(value);
  if (!parsed) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(parsed.getDate()).padStart(2, "0")}`;
}

function addMonths(date, months) {
  const next = new Date(date);
  const originalDay = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(
    next.getFullYear(),
    next.getMonth() + 1,
    0
  ).getDate();
  next.setDate(Math.min(originalDay, lastDay));
  return next;
}

export function parseReminderRepeatRule(repeatRule) {
  const text = cleanString(repeatRule).toLowerCase();
  if (!text) return null;

  const everyMatch = text.match(
    /every\s+(\d+)?\s*(day|days|week|weeks|month|months|year|years)/
  );
  if (everyMatch) {
    const interval = Math.max(1, Number(everyMatch[1] || 1));
    const unit = everyMatch[2].replace(/s$/, "");
    return { interval, unit, label: repeatRule };
  }

  if (/\b(daily|day)\b/.test(text)) return { interval: 1, unit: "day", label: repeatRule };
  if (/\b(weekly|week)\b/.test(text)) return { interval: 1, unit: "week", label: repeatRule };
  if (/\b(monthly|month)\b/.test(text)) return { interval: 1, unit: "month", label: repeatRule };
  if (/\b(annual|annually|yearly|year)\b/.test(text)) {
    return { interval: 1, unit: "year", label: repeatRule };
  }

  return null;
}

export function buildNextReminderDueAt({ repeatRule, fromDate, fallbackDueAt }) {
  const parsedRule = parseReminderRepeatRule(repeatRule);
  if (!parsedRule) return null;

  const base =
    parseLocalDate(fromDate) ||
    parseLocalDate(fallbackDueAt) ||
    parseLocalDate(new Date().toISOString());
  if (!base) return null;

  let next;
  if (parsedRule.unit === "day") {
    next = new Date(base.getTime() + parsedRule.interval * DAY_MS);
  } else if (parsedRule.unit === "week") {
    next = new Date(base.getTime() + parsedRule.interval * 7 * DAY_MS);
  } else if (parsedRule.unit === "month") {
    next = addMonths(base, parsedRule.interval);
  } else if (parsedRule.unit === "year") {
    next = addMonths(base, parsedRule.interval * 12);
  }

  if (!next || Number.isNaN(next.getTime())) return null;
  next.setHours(9, 0, 0, 0);
  return next.toISOString();
}

export function buildRecurrenceOccurrenceKey({ reminderId, nextDueAt }) {
  if (!reminderId || !nextDueAt) return null;
  return `${reminderId}:${toDateOnly(nextDueAt) || String(nextDueAt).slice(0, 10)}`;
}

export async function ensureNextReminderOccurrence({
  ownerId,
  completedReminder,
  workCompletedOn,
}) {
  if (!ownerId || !completedReminder?.id || !completedReminder?.repeat_rule) {
    return { skipped: true, reason: "missing_required_fields" };
  }

  const meta = safeObject(completedReminder.extra_metadata);
  if (meta.recurrence_next_reminder_id) {
    return {
      skipped: true,
      reason: "already_linked",
      reminderId: meta.recurrence_next_reminder_id,
      occurrenceKey: meta.recurrence_occurrence_key || null,
    };
  }

  const nextDueAt = buildNextReminderDueAt({
    repeatRule: completedReminder.repeat_rule,
    fromDate: workCompletedOn || meta.work_completed_on || meta.actual_completed_date,
    fallbackDueAt: completedReminder.due_at,
  });
  const occurrenceKey = buildRecurrenceOccurrenceKey({
    reminderId: completedReminder.id,
    nextDueAt,
  });

  if (!nextDueAt || !occurrenceKey) {
    return { skipped: true, reason: "unparseable_repeat_rule" };
  }

  try {
    const { data: existingRows, error: lookupError } = await supabase
      .from("reminders")
      .select("id, extra_metadata")
      .eq("owner_id", ownerId)
      .contains("extra_metadata", {
        recurrence_source_reminder_id: completedReminder.id,
        recurrence_occurrence_key: occurrenceKey,
      })
      .limit(1);

    if (!lookupError && existingRows?.[0]?.id) {
      return {
        created: false,
        reminderId: existingRows[0].id,
        occurrenceKey,
        dueAt: nextDueAt,
      };
    }
  } catch (error) {
    console.log("Next reminder lookup skipped:", error);
  }

  const nextMeta = {
    ...safeObject(meta.recurrence_next_metadata),
    assigned_to: meta.assigned_to || null,
    assignment_target: meta.assignment_target || null,
    responsible_party: meta.responsible_party || null,
    visibility_scope: meta.visibility_scope || null,
    visibility_org_id: meta.visibility_org_id || null,
    action_context: meta.action_context || null,
    action_context_label: meta.action_context_label || null,
    provider_target: meta.provider_target || null,
    recurrence_source_reminder_id: completedReminder.id,
    recurrence_occurrence_key: occurrenceKey,
    recurrence_created_from_completed_at: meta.completed_at || null,
    recurrence_work_completed_on:
      workCompletedOn || meta.work_completed_on || meta.actual_completed_date || null,
  };

  const payload = {
    owner_id: ownerId,
    title: completedReminder.title,
    notes: completedReminder.notes || null,
    url: completedReminder.url || null,
    due_at: nextDueAt,
    has_time: !!completedReminder.has_time,
    is_urgent: !!completedReminder.is_urgent,
    repeat_rule: completedReminder.repeat_rule || null,
    status: "open",
    asset_id: completedReminder.asset_id || null,
    system_id: completedReminder.system_id || null,
    record_id: completedReminder.record_id || null,
    event_id: completedReminder.event_id || null,
    extra_metadata: nextMeta,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("reminders")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw error;

  return {
    created: true,
    reminderId: data?.id || null,
    occurrenceKey,
    dueAt: nextDueAt,
  };
}
