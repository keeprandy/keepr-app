import { assetHin, assetKacId } from "./assetIdentity.js";

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

function fact(kind, label, detail = null, source = "asset") {
  return { kind, label, detail, source };
}

function proposedAction(key, title, reason, target, priority = 50) {
  return { key, title, reason, target, priority, status: "proposed" };
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
  const openActions = asArray(actions).filter((item) => String(item?.status || "open").toLowerCase() !== "completed");

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
    counts: {
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
    },
    known,
    inheritable,
    missing,
    conflicting,
    unresolved,
    proposed_actions: proposedActions,
  };
}
