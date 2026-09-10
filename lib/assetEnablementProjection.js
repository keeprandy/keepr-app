import { assetHin, assetKacId } from "./assetIdentity.js";
import { getActionScheduledDueAt } from "./playbookSchedule.js";

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function firstPresent(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  return asArray(items).filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function contextBody(contextProjection) {
  const root = asObject(contextProjection);
  return asObject(root.projection || root);
}

function contextSystems(contextProjection) {
  const body = contextBody(contextProjection);
  return asArray(body.systems || contextProjection?.systems);
}

function contextResources(contextProjection) {
  const body = contextBody(contextProjection);
  return asArray(
    body.applicable_resources ||
      body.resources ||
      contextProjection?.applicable_resources ||
      contextProjection?.resources
  );
}

function contextModelBindings(contextProjection) {
  const body = contextBody(contextProjection);
  return asArray(body.parent_relationships || body.models || contextProjection?.models).filter(Boolean);
}

function contextKnowledgeGaps(contextProjection) {
  const body = contextBody(contextProjection);
  return asArray(body.knowledge_gaps || contextProjection?.knowledge_gaps);
}

function hasSystemTemplate(system) {
  return Boolean(system?.system_template_id || system?.system_template?.id || system?.canonical_system_template_id);
}

function hasSupplier(system) {
  const template = asObject(system?.system_template);
  return Boolean(system?.supplier_org_id || template.supplier_org_id || template.supplier?.id);
}

function resourceLabel(resource) {
  return firstPresent(resource?.title, resource?.label, resource?.file_name, resource?.url, resource?.source_url);
}

function resourceKind(resource) {
  return String(
    resource?.resource_type ||
      resource?.kind ||
      resource?.role ||
      resource?.attachment_role ||
      resource?.category ||
      resource?.type ||
      ""
  ).toLowerCase();
}

function resourceKindCounts(resources = []) {
  return asArray(resources).reduce(
    (acc, resource) => {
      const kind = resourceKind(resource);
      if (/manual/.test(kind) || /manual/i.test(resourceLabel(resource))) acc.manuals += 1;
      else if (/warranty/.test(kind) || /warranty/i.test(resourceLabel(resource))) acc.warranties += 1;
      else if (/photo|image|hero/.test(kind)) acc.photos += 1;
      else if (/receipt|invoice|proof|evidence/.test(kind)) acc.evidence += 1;
      else acc.other += 1;
      return acc;
    },
    { manuals: 0, warranties: 0, photos: 0, evidence: 0, other: 0 }
  );
}

function fact(kind, label, detail = null, source = "asset") {
  return { kind, label, detail, source };
}

function proposedAction(key, title, reason, target, priority = 50) {
  return { key, title, reason, target, priority, status: "proposed" };
}

function pluralize(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function textIncludes(value, pattern) {
  return pattern.test(String(value || ""));
}

function eventTitle(event) {
  return firstPresent(event?.title, event?.name, event?.summary, event?.description, event?.notes);
}

function latestDated(items) {
  return asArray(items)
    .map((item) => ({
      item,
      time: new Date(
        item?.date ||
          item?.service_date ||
          item?.event_date ||
          item?.completed_at ||
          item?.created_at ||
          item?.updated_at ||
          0
      ).getTime(),
    }))
    .filter((entry) => Number.isFinite(entry.time) && entry.time > 0)
    .sort((a, b) => b.time - a.time)[0]?.item || null;
}

function actionTitle(action) {
  return firstPresent(action?.title, action?.name, action?.summary, "Continue this action");
}

function actionPlanName(action) {
  const meta = asObject(action?.extra_metadata);
  const context = asObject(action?.what_next || action?.playbook_context);
  return firstPresent(
    context.playbook_name,
    meta.playbook_name,
    meta.service_template_name,
    meta.project,
    meta.project_target
  );
}

function actionProviderName(action) {
  const meta = asObject(action?.extra_metadata);
  return firstPresent(
    action?.provider_name,
    action?.organization_name,
    action?.assigned_provider_name,
    meta.provider_name,
    meta.keepr_pro_name,
    meta.organization_name
  );
}

function actionDueSummary(action) {
  const dueAt = getActionScheduledDueAt(action);
  if (!dueAt) return null;
  const date = new Date(dueAt);
  if (!Number.isFinite(date.getTime())) return null;
  const now = new Date();
  const dateText = date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return date < now ? `Overdue since ${dateText}` : `Due ${dateText}`;
}

function relationshipLabels(contextProjection, actions = [], systems = []) {
  const context = contextBody(contextProjection);
  const relationships = [
    ...asArray(context.relationships),
    ...asArray(context.asset_relationships),
    ...asArray(context.provider_relationships),
    ...asArray(context.stewardship),
  ];
  const fromContext = relationships
    .filter((item) => {
      const marker = [
        item?.type,
        item?.relationship_type,
        item?.role,
        item?.relationship_role,
        item?.category,
        item?.source,
        item?.authority_type,
      ].join(" ");
      return /keepr ?pro|provider|service|steward|dealer/i.test(marker);
    })
    .map((item) =>
      firstPresent(
        item?.provider_name,
        item?.organization_name,
        item?.name,
        item?.label,
        item?.provider?.name,
        item?.organization?.name
      )
    )
    .filter(Boolean);
  const fromActions = asArray(actions).map(actionProviderName).filter(Boolean);
  const fromSystems = asArray(systems)
    .map((system) =>
      firstPresent(
        system?.keepr_pro_name,
        system?.provider_name,
        system?.service_provider_name,
        system?.metadata?.keepr_pro?.name,
        system?.metadata?.provider?.name
      )
    )
    .filter(Boolean);
  return uniqueBy([...fromContext, ...fromActions, ...fromSystems], (label) => String(label).toLowerCase());
}

function systemNames(systems) {
  return uniqueBy(
    asArray(systems)
      .map((system) => firstPresent(system?.name, system?.label, system?.system_type, system?.metadata?.standard?.identity?.name))
      .filter(Boolean),
    (label) => String(label).toLowerCase()
  );
}

function buildNeedsAttention({
  asset = {},
  projectedActions,
  missing = [],
  serviceRecords = [],
  storyEvents = [],
}) {
  const items = [];
  const nextAction = projectedActions.visibleActions?.[0] || projectedActions.actions?.[0] || null;
  if (nextAction) {
    const planName = actionPlanName(nextAction);
    const due = actionDueSummary(nextAction);
    items.push({
      kind: "action",
      label: actionTitle(nextAction),
      detail: [planName && `From ${planName}`, due].filter(Boolean).join(". "),
      target: "actions",
      source: "actions",
    });
  }

  const overdueCount = asArray(projectedActions.actions).filter((action) => {
    const dueAt = getActionScheduledDueAt(action);
    return action?.status === "open" && dueAt && new Date(dueAt) < new Date();
  }).length;
  if (overdueCount > 0) {
    items.push({
      kind: "overdue",
      label: `${pluralize(overdueCount, "open action")} need timing attention`,
      detail: "Review the care items Keepr already has in motion.",
      target: "actions",
      source: "actions",
    });
  }

  const history = [...asArray(serviceRecords), ...asArray(storyEvents)];
  const vehicleHistoryText = history.map(eventTitle).join(" ");
  const isVehicle = textIncludes(asset?.asset_type || asset?.type || asset?.source_type, /vehicle|car|auto/i);
  const latestOil = latestDated(history.filter((item) => textIncludes(eventTitle(item), /oil change|oil service|vehicle health report|service required/i)));
  if (isVehicle && latestOil) {
    const title = eventTitle(latestOil);
    items.push({
      kind: "service",
      label: textIncludes(title, /service required/i) ? "Service requirement is documented" : "Oil/service history is documented",
      detail: title,
      target: "timeline",
      source: "history",
    });
  } else if (isVehicle && textIncludes(vehicleHistoryText, /oil|service/i)) {
    items.push({
      kind: "service",
      label: "Review vehicle service timing",
      detail: "Keepr has service history that can help decide what is due next.",
      target: "timeline",
      source: "history",
    });
  }

  const registration = latestDated(history.filter((item) => textIncludes(eventTitle(item), /registration|renewal|plate/i)));
  if (registration) {
    items.push({
      kind: "registration",
      label: "Registration context is present",
      detail: eventTitle(registration),
      target: "timeline",
      source: "history",
    });
  }

  if (items.length < 3 && missing.length) {
    const meaningful = missing.find((item) => !/canonical system template|supplier\/provider/i.test(item.label || "")) || missing[0];
    items.push({
      kind: "gap",
      label: meaningful.label,
      detail: meaningful.detail || "This missing context may limit what Keepr can help with.",
      target: meaningful.source === "timeline" ? "timeline" : meaningful.source === "systems" ? "systems" : "attachments",
      source: meaningful.source,
    });
  }

  return uniqueBy(items, (item) => `${item.kind}:${item.label}`).slice(0, 4);
}

function isNextPlaybookAction(action) {
  const meta = asObject(action?.extra_metadata);
  const context = asObject(action?.what_next || action?.playbook_context);
  return Boolean(
    context.is_next_playbook_step ||
      meta.is_next_playbook_step ||
      meta.next_playbook_step
  );
}

function dueSortValue(action) {
  const dueAt = getActionScheduledDueAt(action);
  if (!dueAt) return Number.POSITIVE_INFINITY;
  const time = new Date(dueAt).getTime();
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
}

function projectOwnerActions(actions, assetId) {
  const scoped = asArray(actions).filter(
    (action) =>
      String(action?.status || "open").toLowerCase() !== "completed" &&
      (!assetId || String(action?.asset_id || "") === String(assetId))
  );
  const sorted = scoped.sort((a, b) => {
    const aDue = dueSortValue(a);
    const bDue = dueSortValue(b);
    const aOverdue = aDue < Date.now();
    const bOverdue = bDue < Date.now();
    if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
    if (isNextPlaybookAction(a) !== isNextPlaybookAction(b)) return isNextPlaybookAction(a) ? -1 : 1;
    if (aDue !== bDue) return aDue - bDue;
    return new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime();
  });
  return {
    actions: sorted,
    visibleActions: sorted.slice(0, 5),
  };
}

function buildOwnerIntelligence({
  asset = {},
  contextProjection = null,
  systems = [],
  resources = [],
  serviceRecords = [],
  storyEvents = [],
  actions = [],
  known = [],
  missing = [],
  counts = {},
  kac = null,
  hin = null,
}) {
  const projectedActions = projectOwnerActions(actions, asset?.id);
  const names = systemNames(systems).slice(0, 4);
  const providerLabels = relationshipLabels(contextProjection, projectedActions.actions, systems);
  const historyCount = counts.service_records + counts.story_events;
  const proofCount = counts.exact_resources || counts.resources || asArray(resources).length;
  const latestHistory = latestDated([...asArray(serviceRecords), ...asArray(storyEvents)]);
  const latestHistoryTitle = latestHistory ? eventTitle(latestHistory) : null;
  const nextAction = projectedActions.visibleActions?.[0] || projectedActions.actions?.[0] || null;
  const resourceCounts = resourceKindCounts(resources);
  const resourceSummary = [
    resourceCounts.manuals ? pluralize(resourceCounts.manuals, "manual") : null,
    resourceCounts.warranties ? pluralize(resourceCounts.warranties, "warranty", "warranties") : null,
    resourceCounts.evidence ? pluralize(resourceCounts.evidence, "proof/evidence item") : null,
    resourceCounts.photos ? pluralize(resourceCounts.photos, "photo") : null,
    resourceCounts.other ? pluralize(resourceCounts.other, "other resource") : null,
  ].filter(Boolean).join(", ");

  const knows = [
    kac && {
      kind: "identity",
      label: "Keepr knows this exact asset",
      detail: [kac, hin].filter(Boolean).join(" · "),
      source: "identity",
    },
    names.length && {
      kind: "systems",
      label: `${pluralize(counts.systems || names.length, "installed system")} represented`,
      detail: names.join(", "),
      source: "systems",
    },
    providerLabels.length && {
      kind: "relationships",
      label: `${pluralize(providerLabels.length, "service/provider relationship")} connected`,
      detail: providerLabels.slice(0, 3).join(", "),
      source: "relationships",
    },
    historyCount && {
      kind: "history",
      label: `${pluralize(historyCount, "history record")} in the story`,
      detail: latestHistoryTitle ? `Latest: ${latestHistoryTitle}` : null,
      source: "history",
    },
    counts.resources && {
      kind: "resources",
      label: `${pluralize(counts.resources, "resource/evidence item")} available`,
      detail: proofCount ? `${pluralize(proofCount, "asset-specific evidence item")} connected` : null,
      source: "resources",
    },
  ].filter(Boolean);

  if (!knows.length && known.length) {
    knows.push(...known.slice(0, 3).map((item) => ({ ...item, detail: item.detail || item.source })));
  }

  const needsAttention = buildNeedsAttention({
    asset,
    projectedActions,
    missing,
    serviceRecords,
    storyEvents,
  });

  const canHelp = [
    nextAction && {
      kind: "action",
      label: "Continue the next care step",
      detail: actionTitle(nextAction),
      target: "actions",
    },
    {
      kind: "keeprlink",
      label: "Open the KeeprLINK / AI context",
      detail: "See the governed context Keepr can share with people and AI.",
      target: "ai_context",
    },
    {
      kind: "ask",
      label: "Ask KAI about this asset",
      detail: "Use the current KeeprLINK context, history, systems, resources, and evidence.",
      target: "ask_kai",
    },
    counts.systems ? {
      kind: "systems",
      label: "Review the systems Keepr understands",
      detail: `${pluralize(counts.systems, "system")} currently connected.`,
      target: "systems",
    } : null,
    counts.resources ? {
      kind: "evidence",
      label: "Use the proof and resources already attached",
      detail: resourceSummary || `${pluralize(counts.resources, "resource")} available for service, ownership, or resale context.`,
      target: "attachments",
    } : {
      kind: "evidence",
      label: "Add useful proof when it matters",
      detail: "Receipts, manuals, photos, warranties, and notes make Keepr more helpful.",
      target: "attachments",
    },
  ].filter(Boolean).slice(0, 4);

  const summary = knows.length
    ? `Keepr understands this asset through ${[
        counts.systems ? pluralize(counts.systems, "system") : null,
        providerLabels.length ? pluralize(providerLabels.length, "relationship") : null,
        historyCount ? pluralize(historyCount, "history record") : null,
        counts.resources ? pluralize(counts.resources, "resource") : null,
      ].filter(Boolean).join(", ")}.`
    : "Keepr can start building useful intelligence from this asset's identity, systems, history, resources, and proof.";

  return {
    summary,
    knows,
    needs_attention: needsAttention,
    can_help: canHelp,
    next_action: nextAction,
    provider_labels: providerLabels,
    action_count: projectedActions.actions?.length || 0,
    resource_counts: resourceCounts,
  };
}

export function projectAssetEnablement({
  asset = {},
  contextProjection = null,
  systems = [],
  resources = [],
  serviceRecords = [],
  storyEvents = [],
  actions = [],
} = {}) {
  const context = contextBody(contextProjection);
  const identity = asObject(context.identity);
  const knownSystems = uniqueBy([...asArray(systems), ...contextSystems(contextProjection)], (system) => system?.id || system?.name);
  const knownResources = uniqueBy([...asArray(resources), ...contextResources(contextProjection)], (resource) => resource?.id || resource?.attachment_id || resourceLabel(resource));
  const modelBindings = contextModelBindings(contextProjection);
  const gaps = contextKnowledgeGaps(contextProjection);
  const kac = assetKacId(asset) || context?.object?.kac_id || null;
  const hin = assetHin(asset) || identity.serial_number || identity.hin || null;
  const modelLabel = firstPresent(
    modelBindings[0]?.template?.template_key,
    modelBindings[0]?.template_key,
    identity.model && `${identity.model_year || asset?.year || ""} ${identity.make || asset?.make || ""} ${identity.model}`.trim(),
    asset?.model
  );

  const resolvedTemplateSystems = knownSystems.filter(hasSystemTemplate);
  const unresolvedTemplateSystems = knownSystems.filter((system) => !hasSystemTemplate(system));
  const supplierResolvedSystems = knownSystems.filter(hasSupplier);
  const supplierUnresolvedSystems = knownSystems.filter((system) => !hasSupplier(system));
  const exactResources = knownResources.filter((resource) => {
    const scope = String(resource?.scope || resource?.target_type || resource?.applies_to_type || "").toLowerCase();
    return scope === "asset" || scope === "system";
  });
  const inheritedResources = knownResources.filter((resource) => {
    const scope = String(resource?.scope || resource?.target_type || resource?.applies_to_type || "").toLowerCase();
    return scope.includes("template") || scope === "organization" || scope === "org";
  });
  const openActions = asArray(actions).filter(
    (item) =>
      String(item?.status || "open").toLowerCase() !== "completed" &&
      (!asset?.id || String(item?.asset_id || "") === String(asset.id))
  );

  const known = [
    kac && fact("identity", "Canonical KAC assigned", kac, "asset"),
    hin && fact("identity", "HIN / serial known", hin, "asset"),
    modelLabel && fact("model", "Model resolution present", modelLabel, "model_template"),
    knownSystems.length && fact("systems", "Installed systems represented", `${knownSystems.length} systems`, "asset_systems"),
    resolvedTemplateSystems.length && fact("systems", "Systems linked to reusable templates", `${resolvedTemplateSystems.length} resolved`, "system_templates"),
    supplierResolvedSystems.length && fact("organizations", "Supplier/provider links present", `${supplierResolvedSystems.length} systems`, "organization_graph"),
    knownResources.length && fact("resources", "Applicable resources attached", `${knownResources.length} resources`, "attachments"),
    asArray(serviceRecords).length && fact("history", "Service/history evidence exists", `${asArray(serviceRecords).length} records`, "service_records"),
  ].filter(Boolean);

  const inheritable = [
    modelBindings.length && fact("model", "Model-level ownership intelligence can apply", `${modelBindings.length} model binding${modelBindings.length === 1 ? "" : "s"}`, "keeprlink_self_service"),
    resolvedTemplateSystems.length && fact("systems", "System Template knowledge can apply by reference", `${resolvedTemplateSystems.length} system template link${resolvedTemplateSystems.length === 1 ? "" : "s"}`, "system_templates"),
    inheritedResources.length && fact("resources", "Reusable model/system resources can be inherited", `${inheritedResources.length} inherited resource${inheritedResources.length === 1 ? "" : "s"}`, "attachments"),
  ].filter(Boolean);

  const missing = [
    !kac && fact("identity", "Canonical KAC missing", "Assign or resolve the durable Keepr identity.", "asset"),
    !hin && fact("identity", "HIN / serial missing", "Capture a verified serial/HIN photo or source.", "asset"),
    !modelBindings.length && fact("model", "Model match not established", "Resolve this asset to a reusable Model Template when evidence supports it.", "model_resolution"),
    !knownSystems.length && fact("systems", "Installed systems are not represented", "Add the ownership-relevant systems that keep this asset operating.", "systems"),
    unresolvedTemplateSystems.length && fact("systems", "Some systems lack canonical System Template links", `${unresolvedTemplateSystems.length} unresolved system${unresolvedTemplateSystems.length === 1 ? "" : "s"}.`, "system_templates"),
    supplierUnresolvedSystems.length && fact("organizations", "Some systems lack supplier/provider links", `${supplierUnresolvedSystems.length} unresolved supplier link${supplierUnresolvedSystems.length === 1 ? "" : "s"}.`, "organization_graph"),
    !knownResources.length && fact("resources", "No governed resources are attached", "Add manuals, warranties, specs, receipts, or proof with AI Context metadata.", "attachments"),
    knownSystems.length && !exactResources.length && fact("resources", "No exact-asset/system evidence is attached", "Keep inherited model resources separate from exact-asset proof.", "attachments"),
    !asArray(serviceRecords).length && fact("history", "No service or ownership history yet", "Add delivery, commissioning, registration, warranty, or first-service records.", "timeline"),
  ].filter(Boolean);

  const conflicting = gaps
    .filter((gap) => /conflict|mismatch|disagree/i.test(JSON.stringify(gap)))
    .map((gap) => fact("conflict", firstPresent(gap.title, gap.label, gap.type, "Potential conflict"), firstPresent(gap.detail, gap.description, gap.reason), "keeprlink"));

  const unresolved = [
    ...gaps
      .filter((gap) => !/conflict|mismatch|disagree/i.test(JSON.stringify(gap)))
      .map((gap) => fact("gap", firstPresent(gap.title, gap.label, gap.type, "Unresolved knowledge"), firstPresent(gap.detail, gap.description, gap.reason), "keeprlink")),
    ...unresolvedTemplateSystems.slice(0, 6).map((system) => fact("system_template", "System Template unresolved", system?.name || system?.label || "Unnamed system", "systems")),
    ...supplierUnresolvedSystems.slice(0, 6).map((system) => fact("supplier", "Supplier/provider unresolved", system?.name || system?.label || "Unnamed system", "organization_graph")),
  ];

  const proposedActions = [
    !kac && proposedAction("resolve-kac", "Resolve Keepr identity", "Give this asset a durable KAC so its knowledge can travel.", "edit_asset", 10),
    !hin && proposedAction("capture-hin", "Capture HIN / serial", "Exact identity improves ownership, warranty, service, and resale context.", "edit_asset", 15),
    !modelBindings.length && proposedAction("resolve-model", "Resolve model match", "Attach reusable model intelligence only after evidence supports the match.", "edit_asset", 20),
    (!knownSystems.length || unresolvedTemplateSystems.length) && proposedAction("review-systems", "Review installed systems", "Systems bridge asset ownership to supplier knowledge and playbooks.", "systems", 25),
    (!knownResources.length || !exactResources.length) && proposedAction("add-resources", "Add ownership evidence", "Manuals, warranties, receipts, photos, and commissioning proof make the asset agent useful.", "attachments", 30),
    !asArray(serviceRecords).length && proposedAction("add-history", "Add first ownership record", "Delivery, commissioning, warranty, or first-service records establish operational history.", "timeline", 35),
    proposedAction("ask-kai", "Ask KAI what is missing", "Use this asset as the scope and let KAI propose the next evidence to collect.", "ask_kai", 40),
  ].filter(Boolean).sort((a, b) => a.priority - b.priority);

  const counts = {
    systems: knownSystems.length,
    system_templates_resolved: resolvedTemplateSystems.length,
    suppliers_resolved: supplierResolvedSystems.length,
    resources: knownResources.length,
    inherited_resources: inheritedResources.length,
    exact_resources: exactResources.length,
    service_records: asArray(serviceRecords).length,
    story_events: asArray(storyEvents).length,
    open_actions: openActions.length,
    missing: missing.length,
    conflicting: conflicting.length,
    unresolved: unresolved.length,
  };

  return {
    contract: "keepr.asset.enablement.v1",
    asset_id: asset?.id || context?.object?.id || null,
    kac,
    hin,
    status: {
      identity: kac && hin ? "established" : kac || hin ? "partial" : "missing",
      model_resolution: modelBindings.length ? "resolved" : "unresolved",
      systems: knownSystems.length ? "represented" : "missing",
      system_templates: !knownSystems.length ? "not_started" : unresolvedTemplateSystems.length ? "partial" : "resolved",
      suppliers: !knownSystems.length ? "not_started" : supplierUnresolvedSystems.length ? "partial" : "resolved",
      resources: knownResources.length ? "represented" : "missing",
      history: asArray(serviceRecords).length || asArray(storyEvents).length ? "started" : "missing",
      open_actions: openActions.length ? "active" : "none",
    },
    counts,
    known,
    inheritable,
    missing,
    conflicting,
    unresolved,
    proposed_actions: proposedActions,
    owner: buildOwnerIntelligence({
      asset,
      contextProjection,
      systems: knownSystems,
      resources: knownResources,
      serviceRecords,
      storyEvents,
      actions: openActions,
      known,
      missing,
      counts,
      kac,
      hin,
    }),
  };
}
