const CONFIG_SECTION_KEY = "section.configuration";

export const MODEL_CATALOG_TABS = [
  { key: "overview", label: "Overview", icon: "boat-outline" },
  { key: "media", label: "Media", icon: "images-outline" },
  { key: "exterior", label: "Exterior", icon: "sunny-outline" },
  { key: "interior", label: "Interior", icon: "bed-outline" },
  { key: "electronics", label: "Helm & Electronics", icon: "speedometer-outline" },
  { key: "systems", label: "Systems", icon: "cog-outline" },
  { key: "options", label: "Options", icon: "options-outline" },
  { key: "specifications", label: "Specifications", icon: "analytics-outline" },
  { key: "care", label: "Care", icon: "checkbox-outline" },
  { key: "resources", label: "Resources", icon: "document-text-outline" },
];

export const PRIME_MODEL_FACTS = [
  { key: "spec.loa", label: "LOA", aliases: ["l.o.a.", "loa", "l.o.a. w/ integrated platform"] },
  { key: "spec.beam", label: "Beam", aliases: ["beam"] },
  { key: "spec.max_hp", label: "Max HP", aliases: ["maximum horsepower", "max hp"] },
  { key: "spec.fuel_capacity", label: "Fuel", aliases: ["fuel capacity"] },
  { key: "spec.water_capacity", label: "Water", aliases: ["water capacity", "fresh water capacity"] },
];

const SECTION_TAB_RULES = [
  { match: ["specification", "specifications"], tabs: ["specifications"] },
  { match: ["system", "systems", "propulsion", "mechanical", "electrical", "generator", "fresh water", "waste", "sanitation"], tabs: ["systems"] },
  { match: ["hull", "deck", "hardtop", "foredeck", "transom", "aft cockpit", "paint", "exterior"], tabs: ["exterior"] },
  { match: ["interior", "stateroom", "head", "cabin", "upholstery", "surface"], tabs: ["interior"] },
  { match: ["helm", "electronics", "instrumentation", "radar", "navigation", "starlink"], tabs: ["electronics"] },
  { match: ["option", "options", "module", "modules", "package", "packages", "selection", "selections", "international"], tabs: ["options"] },
  { match: ["care", "maintenance", "warranty", "service", "winterization"], tabs: ["care"] },
  { match: ["resource", "resources", "manual", "manuals", "source", "sources", "document", "documents"], tabs: ["resources"] },
];

const CONFIG_ITEM_TYPES = new Set(["configuration_item", "choice", "option", "component", "system"]);
const CONFIG_GROUP_TYPES = new Set(["configuration_group"]);
const PROJECTABLE_ITEM_TYPES = new Set(["configuration_item", "component", "system"]);
const NON_CONFIGURATION_SECTION_KEYS = new Set([
  "section.specifications",
  "section.media",
  "section.resources",
  "section.care",
  "section.systems",
]);

function compact(parts) {
  return parts.filter(Boolean).join(" · ");
}

export function labelize(value) {
  return String(value || "").replace(/_/g, " ");
}

export function valueText(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.map(valueText).filter(Boolean).join(", ");
  if (typeof value === "object" && Object.keys(value).length === 0) return null;
  if (value.value !== undefined) return compact([valueText(value.value), value.unit]);
  if (value.model_expectation !== undefined) return valueText(value.model_expectation);
  if (value.description) return String(value.description);
  if (value.summary) return String(value.summary);
  if (value.label) return String(value.label);
  if (value.name) return String(value.name);
  if (value.text) return String(value.text);
  return null;
}

export function resourceUrl(resource) {
  const metadata = resource?.metadata && typeof resource.metadata === "object" ? resource.metadata : {};
  return (
    metadata.attachment_signed_url ||
    metadata.attachment_storage_signed_url ||
    metadata.attachment_url ||
    resource?.attachment_signed_url ||
    resource?.attachment_url ||
    resource?.url ||
    resource?.source_url ||
    metadata.url ||
    metadata.source_url ||
    null
  );
}

export function itemSourceLabel(item, resources = []) {
  const source = resources.find((resource) => resource.id === item?.source_resource_id);
  if (source?.title) return source.title;
  if (item?.metadata?.source_document_title) return item.metadata.source_document_title;
  if (item?.metadata?.source_context) return item.metadata.source_context;
  return item?.source_resource_id ? "Linked source" : "Needs source";
}

export function activeModelItems(items = []) {
  return (items || [])
    .filter((item) => item && item.authority_state !== "retired" && item.status !== "retired")
    .sort(sortByOrder);
}

function sortByOrder(a, b) {
  const order = (a.sort_order || 0) - (b.sort_order || 0);
  if (order !== 0) return order;
  return String(a.label || "").localeCompare(String(b.label || ""));
}

function makeChildrenByParent(items = []) {
  return items.reduce((acc, item) => {
    if (!item.parent_item_id) return acc;
    acc[item.parent_item_id] = acc[item.parent_item_id] || [];
    acc[item.parent_item_id].push(item);
    acc[item.parent_item_id].sort(sortByOrder);
    return acc;
  }, {});
}

function normalizeKey(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function chapterTabsFor(item) {
  const canonicalKey = String(item?.canonical_key || "").toLowerCase();
  const label = String(item?.label || "").toLowerCase();
  const haystack = `${canonicalKey} ${label}`;
  const tabs = new Set();

  SECTION_TAB_RULES.forEach((rule) => {
    if (rule.match.some((term) => haystack.includes(term))) {
      rule.tabs.forEach((tab) => tabs.add(tab));
    }
  });

  if (canonicalKey.startsWith("brochure.specifications") || canonicalKey.startsWith("spec.")) tabs.add("specifications");
  if (canonicalKey.includes("propulsion") || canonicalKey.includes("mechanical")) tabs.add("systems");
  if (canonicalKey.includes("configuration")) tabs.add("options");

  if (!tabs.size) tabs.add("overview");
  return Array.from(tabs);
}

function cloneWithProjection(item, projection = {}) {
  return {
    ...item,
    metadata: {
      ...(item?.metadata || {}),
      projection,
    },
  };
}

function isSpecItem(item) {
  const key = String(item?.canonical_key || "").toLowerCase();
  if (key.startsWith("spec.")) return true;
  if (key.includes(".spec.")) return true;
  if (item?.item_type === "spec") return true;
  return false;
}

function isConfigurationSection(item) {
  const key = String(item?.canonical_key || "").toLowerCase();
  if (item?.item_type !== "section") return false;
  if (NON_CONFIGURATION_SECTION_KEYS.has(key)) return false;
  if (key === CONFIG_SECTION_KEY) return true;
  return key.startsWith("brochure.") || key.startsWith("section.");
}

function isConfigurationGroup(item) {
  return CONFIG_GROUP_TYPES.has(item?.item_type);
}

function isBuildEligibleItem(item) {
  if (!item) return false;
  if (item.item_type === "section" || item.item_type === "configuration_group") return false;
  if (isSpecItem(item)) return false;
  return CONFIG_ITEM_TYPES.has(item.item_type) || String(item.canonical_key || "").startsWith("brochure.");
}

function isSystemProjectionItem(item) {
  if (!item) return false;
  if (item.item_type === "section" || item.item_type === "configuration_group") return false;
  if (isSpecItem(item)) return false;

  const type = String(item.item_type || "").toLowerCase();
  const key = String(item.canonical_key || "").toLowerCase();
  const projection = cleanProjection(item?.metadata?.projection);
  return projection.kind === "system" || ["system", "component"].includes(type) || key.startsWith("system.");
}

function sourceDialect(item) {
  const key = String(item?.canonical_key || "");
  if (key.startsWith("brochure.")) return "legacy_brochure";
  if (key.startsWith("section.configuration") || item?.item_type?.startsWith("configuration")) return "configuration";
  if (item?.item_type === "section") return "section";
  return "model_item";
}

function buildConfigurationGroups(items, childrenByParent) {
  const explicitGroups = items
    .filter(isConfigurationGroup)
    .map((group) => ({
      group: cloneWithProjection(group, { dialect: sourceDialect(group), role: "configuration_group" }),
      children: (childrenByParent[group.id] || [])
        .filter(isBuildEligibleItem)
        .map((child) => cloneWithProjection(child, { dialect: sourceDialect(child), role: "configuration_item" })),
    }));

  const explicitChildIds = new Set(explicitGroups.flatMap(({ children }) => children.map((child) => child.id)));
  const explicitGroupIds = new Set(explicitGroups.map(({ group }) => group.id));

  const legacyGroups = items
    .filter(isConfigurationSection)
    .filter((section) => !explicitGroupIds.has(section.id))
    .map((section) => ({
      group: cloneWithProjection(section, { dialect: sourceDialect(section), role: "legacy_configuration_group" }),
      children: (childrenByParent[section.id] || [])
        .filter((child) => !explicitChildIds.has(child.id))
        .filter(isBuildEligibleItem)
        .map((child) => cloneWithProjection(child, { dialect: sourceDialect(child), role: "legacy_configuration_item" })),
    }))
    .filter(({ children }) => children.length);

  const groupedChildIds = new Set(
    [...explicitGroups, ...legacyGroups].flatMap(({ children }) => children.map((child) => child.id))
  );
  const orphanSystemItems = items
    .filter((item) => !groupedChildIds.has(item.id))
    .filter(isSystemProjectionItem)
    .map((item) => {
      const projection = normalizeTemplateItemProjection(item);
      return cloneWithProjection(item, {
        ...projection,
        dialect: projection.dialect || sourceDialect(item),
        role: projection.role || "reusable_system",
      });
    })
    .sort(sortByOrder);
  const projectedSystemGroups = orphanSystemItems.length
    ? [
        {
          group: cloneWithProjection(
            {
              id: "projection-reusable-systems",
              item_type: "configuration_group",
              canonical_key: "section.systems",
              label: "Systems",
              sort_order: 60,
              expected_value: {},
              applicability: {},
              metadata: {},
            },
            { dialect: "projection", role: "system_group" }
          ),
          children: orphanSystemItems,
        },
      ]
    : [];

  return [...explicitGroups, ...legacyGroups, ...projectedSystemGroups].sort((a, b) => sortByOrder(a.group, b.group));
}

function modelMediaFromResources(resources = []) {
  return (resources || [])
    .filter((resource) => {
      const type = String(resource.resource_type || resource.kind || resource.metadata?.kind || "").toLowerCase();
      const url = resourceUrl(resource);
      return type === "photo" || type === "image" || /\.(png|jpe?g|webp|gif)(\?|$)/i.test(String(url || ""));
    })
    .map((resource, index) => {
      const metadata = resource?.metadata && typeof resource.metadata === "object" ? resource.metadata : {};
      const placements = metadata.placements && typeof metadata.placements === "object" ? metadata.placements : {};
      const isHero = placements.hero === true || metadata.is_hero === true || metadata.hero === true || metadata.role === "hero";
      const isShowcase = placements.showcase === true || metadata.is_showcase === true || metadata.showcase === true || metadata.role === "showcase";
      const attachmentId = resource.attachment_id || metadata.attachment_id || null;
      const bucket = resource.bucket || metadata.attachment_bucket || metadata.storage_bucket || null;
      const storagePath = resource.storage_path || metadata.attachment_storage_path || metadata.storage_path || null;
      const url = resourceUrl(resource);

      return {
        id: resource.id || `resource-media-${index}`,
        resource_id: resource.id || null,
        source_resource_id: resource.id || null,
        attachment_id: attachmentId,
        title: resource.title || resource.name || metadata.attachment_title || `Model media ${index + 1}`,
        role: isHero ? "hero" : isShowcase ? "showcase" : metadata.role || metadata.showcase_role || "gallery",
        is_hero: isHero,
        is_showcase: isShowcase,
        placements: {
          ...placements,
          hero: isHero,
          showcase: isShowcase,
        },
        url,
        attachment_url: metadata.attachment_url || null,
        attachment_signed_url: metadata.attachment_signed_url || metadata.attachment_storage_signed_url || null,
        bucket,
        storage_path: storagePath,
        file_name: metadata.file_name || metadata.attachment_title || storagePath?.split("/")?.pop?.() || null,
        mime_type: metadata.mime_type || null,
        source_name: resource.source_name || null,
        source_platform: resource.source_platform || null,
        source_url: resource.source_url || resource.url || null,
        authority_state: resource.authority_state || null,
        rights_status: resource.rights_status || null,
        source_context: {
          provenance: "model_template",
          provenance_label: "Model/catalog media",
          provenance_detail: "Model/template media; available to exact boats but not exact-hull evidence.",
          source_resource_id: resource.id || null,
          template_id: resource.applies_to_id || metadata.template_id || null,
          template_key: metadata.template_key || null,
          source_name: resource.source_name || null,
          source_url: resource.source_url || resource.url || null,
          not_exact_hull_media: true,
        },
        is_inherited_model_media: true,
        is_exact_asset_media: false,
        metadata: {
          ...metadata,
          attachment_id: attachmentId,
          attachment_bucket: bucket,
          attachment_storage_path: storagePath,
          source_resource_id: resource.id || null,
          source_document_title: resource.title || resource.source_name || "Model media",
          provenance_label: "Model/catalog media",
          provenance_detail: "Model/template media; available to exact boats but not exact-hull evidence.",
          not_exact_hull_media: true,
          media_source: "asset_resources",
          placements: {
            ...placements,
            hero: isHero,
            showcase: isShowcase,
          },
        },
      };
    });
}

function normalizeMedia(detail = {}, resources = []) {
  const explicitMedia = Array.isArray(detail?.showcase_media) ? detail.showcase_media : [];
  const resourceMedia = modelMediaFromResources(resources);
  const byId = new Map();

  const mergeMedia = (existing = {}, incoming = {}) => {
    const metadata = {
      ...(existing.metadata && typeof existing.metadata === "object" ? existing.metadata : {}),
      ...(incoming.metadata && typeof incoming.metadata === "object" ? incoming.metadata : {}),
    };
    const placements = {
      ...(existing.placements && typeof existing.placements === "object" ? existing.placements : {}),
      ...(incoming.placements && typeof incoming.placements === "object" ? incoming.placements : {}),
      ...(metadata.placements && typeof metadata.placements === "object" ? metadata.placements : {}),
    };
    const isHero = Boolean(incoming.is_hero || existing.is_hero || placements.hero || metadata.role === "hero");
    const isShowcase = Boolean(incoming.is_showcase || existing.is_showcase || placements.showcase || metadata.role === "showcase");

    return {
      ...existing,
      ...incoming,
      url: incoming.url || existing.url || null,
      attachment_url: incoming.attachment_url || existing.attachment_url || metadata.attachment_url || null,
      attachment_signed_url:
        incoming.attachment_signed_url ||
        incoming.attachment_storage_signed_url ||
        existing.attachment_signed_url ||
        existing.attachment_storage_signed_url ||
        metadata.attachment_signed_url ||
        metadata.attachment_storage_signed_url ||
        null,
      attachment_storage_signed_url:
        incoming.attachment_storage_signed_url ||
        incoming.attachment_signed_url ||
        existing.attachment_storage_signed_url ||
        existing.attachment_signed_url ||
        metadata.attachment_storage_signed_url ||
        metadata.attachment_signed_url ||
        null,
      bucket: incoming.bucket || existing.bucket || metadata.attachment_bucket || metadata.storage_bucket || null,
      storage_path: incoming.storage_path || existing.storage_path || metadata.attachment_storage_path || metadata.storage_path || null,
      attachment_id: incoming.attachment_id || existing.attachment_id || metadata.attachment_id || null,
      local_asset_key: incoming.local_asset_key || existing.local_asset_key || metadata.local_asset_key || null,
      is_hero: isHero,
      is_showcase: isShowcase,
      role: isHero ? "hero" : isShowcase ? "showcase" : incoming.role || existing.role || metadata.role || "gallery",
      placements: {
        ...placements,
        hero: isHero,
        showcase: isShowcase,
      },
      metadata: {
        ...metadata,
        placements: {
          ...placements,
          hero: isHero,
          showcase: isShowcase,
        },
      },
    };
  };

  [...explicitMedia, ...resourceMedia].forEach((media, index) => {
    const id = media.source_resource_id || media.resource_id || media.id || media.url || `media-${index}`;
    byId.set(id, byId.has(id) ? mergeMedia(byId.get(id), media) : mergeMedia({}, media));
  });
  const items = Array.from(byId.values()).sort((a, b) => {
    const order = (a.metadata?.sort_order || a.sort_order || 0) - (b.metadata?.sort_order || b.sort_order || 0);
    if (order !== 0) return order;
    return String(a.title || "").localeCompare(String(b.title || ""));
  });
  return {
    items,
    hero: items.find((media) => media.is_hero || media.role === "hero" || media.metadata?.role === "hero") || items[0] || null,
    showcase: items.filter((media) =>
      media.is_showcase ||
      media.is_hero ||
      ["hero", "showcase", "gallery"].includes(media.role || media.metadata?.role || "gallery")
    ),
  };
}

function normalizeSpecItem(item, resources) {
  const expected = item?.expected_value || {};
  const rawValue = expected.value !== undefined ? expected : expected?.model_expectation || expected;
  return {
    ...item,
    source_label: itemSourceLabel(item, resources),
    display_value: valueText(rawValue),
  };
}

function normalizeSpecifications(items, resources) {
  return items
    .filter(isSpecItem)
    .map((item) => normalizeSpecItem(item, resources))
    .sort(sortByOrder);
}

function factMatches(item, definition) {
  const key = normalizeKey(item?.canonical_key);
  if (key === normalizeKey(definition.key)) return true;
  const label = normalizeKey(item?.label);
  return definition.aliases.some((alias) => label === normalizeKey(alias));
}

function primeFactsFromSpecs(specifications) {
  return PRIME_MODEL_FACTS
    .map((definition) => ({
      definition,
      item: specifications.find((item) => factMatches(item, definition)) || null,
    }))
    .filter(({ item }) => item);
}

function buildCatalogSections(items, configurationGroups, specifications) {
  const sections = new Map();

  function addSection(tab, section, children) {
    if (!section || !children?.length) return;
    const id = `${tab}:${section.id}`;
    if (sections.has(id)) return;
    sections.set(id, { tab, section, children });
  }

  configurationGroups.forEach(({ group, children }) => {
    const tabs = chapterTabsFor(group);
    tabs.forEach((tab) => addSection(tab, group, children));
  });

  if (specifications.length) {
    const section = cloneWithProjection({
      id: "projection-specifications",
      item_type: "section",
      canonical_key: "section.specifications",
      label: "Specifications",
      sort_order: 20,
      expected_value: {},
      applicability: {},
      metadata: {},
    }, { dialect: "projection", role: "specifications" });
    addSection("specifications", section, specifications);
  }

  return Array.from(sections.values()).reduce((acc, entry) => {
    acc[entry.tab] = acc[entry.tab] || [];
    acc[entry.tab].push({ section: entry.section, children: entry.children });
    if (entry.tab !== "overview" && ["exterior", "interior", "electronics", "systems", "options"].includes(entry.tab)) {
      acc.overview = acc.overview || [];
      if (!acc.overview.some((group) => group.section.id === entry.section.id)) {
        acc.overview.push({ section: entry.section, children: entry.children });
      }
    }
    return acc;
  }, MODEL_CATALOG_TABS.reduce((acc, tab) => ({ ...acc, [tab.key]: [] }), {}));
}

function itemElementList(item, key) {
  const downstream = item?.metadata?.downstream_elements || {};
  const expectedValue = item?.expected_value?.value || {};
  const value = item?.metadata?.[key] || downstream[key] || item?.expected_value?.[key] || expectedValue[key] || [];
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string") return value.split(/\n|,/).map((part) => part.trim()).filter(Boolean);
  return [];
}

function itemElementListAny(item, keys = []) {
  const values = keys.flatMap((key) => itemElementList(item, key));
  return [...new Set(values.filter(Boolean))];
}

function itemMappingStatus(item) {
  return item?.metadata?.mapping_status || item?.applicability?.mapping_status || "unmapped";
}

function cleanProjection(projection) {
  return projection && typeof projection === "object" && !Array.isArray(projection) ? projection : {};
}

export function normalizeTemplateItemProjection(item, group = null) {
  const explicit = cleanProjection(item?.metadata?.projection);
  const explicitKind = String(explicit.kind || "").trim();
  const mappingStatus = itemMappingStatus(item);

  if (explicitKind) {
    return {
      ...explicit,
      kind: explicitKind,
      mapping_status: explicit.mapping_status || mappingStatus,
    };
  }

  if (item?.item_type === "configuration_group") {
    return {
      kind: "system_group",
      name: item.label,
      mapping_status: mappingStatus,
    };
  }

  if (!["mapped", "partially_mapped"].includes(mappingStatus)) {
    return {
      kind: "none",
      reason: mappingStatus,
      mapping_status: mappingStatus,
    };
  }

  if (PROJECTABLE_ITEM_TYPES.has(item?.item_type)) {
    return {
      kind: "system",
      name: item.label,
      group: group?.metadata?.projection?.name || group?.metadata?.projection?.group || group?.label || null,
      quantity: item?.expected_value?.quantity || item?.metadata?.quantity || 1,
      mapping_status: mappingStatus,
    };
  }

  return {
    kind: "none",
    reason: "no_explicit_projection",
    mapping_status: mappingStatus,
  };
}

function linkedTemplateItemIds(resource) {
  const metadata = resource?.metadata && typeof resource.metadata === "object" ? resource.metadata : {};
  return [
    metadata.template_item_id,
    metadata.model_template_item_id,
    ...(Array.isArray(metadata.linked_template_item_ids) ? metadata.linked_template_item_ids : []),
    ...(Array.isArray(metadata.template_item_ids) ? metadata.template_item_ids : []),
  ].filter(Boolean);
}

function itemLinkedResources(item, resources = []) {
  return resources
    .filter((resource) => linkedTemplateItemIds(resource).includes(item?.id))
    .map((resource) => ({
      id: resource.id || null,
      title: resource.title || resource.source_name || "Reusable resource",
      resource_type: resource.resource_type || resource.kind || null,
      url: resourceUrl(resource),
      source_url: resource.source_url || resource.url || null,
      provenance: "model_template_item",
      provenance_label: "Reusable model knowledge",
      not_exact_hull_evidence: true,
    }));
}

function buildEligibleConfiguration(configurationGroups, resources = []) {
  return configurationGroups.flatMap(({ group, children }) => children.map((item) => {
    const projection = normalizeTemplateItemProjection(item, group);
    return {
      key: item.id || item.canonical_key,
      templateItemId: item.id,
      template_item_id: item.id,
      group_id: group.id,
      group: group.label,
      label: item.label,
      source_code: item.metadata?.source_code || item.expected_value?.source_code || item.canonical_key || "",
      mode: item.metadata?.selection_mode || group.metadata?.selection_mode || (item.item_type === "choice" ? "single" : "multi"),
      locked: item.applicability?.standard_state === "standard" || item.metadata?.locked === true,
      selected: item.applicability?.standard_state === "standard" || item.applicability?.standard_state === "selected",
      quantity: item.expected_value?.quantity || item.metadata?.quantity || projection.quantity || 1,
      value: item.expected_value?.value || item.expected_value || {},
      projection,
      systems: itemElementListAny(item, ["systems", "systems_created"]),
      resources: [
        ...itemElementListAny(item, ["resources", "resources_needed"]),
        ...itemLinkedResources(item, resources).map((resource) => resource.title),
      ],
      resourceRefs: itemLinkedResources(item, resources),
      playbooks: itemElementListAny(item, ["playbooks", "playbooks_created"]),
      requirements: itemElementListAny(item, ["requirements", "verification_fields"]),
      item,
    };
  }));
}

export function projectModelTemplateDetail(detail = {}) {
  const template = detail?.template || {};
  const resources = Array.isArray(detail?.resources) ? detail.resources : [];
  const items = activeModelItems(detail?.items || []);
  const childrenByParent = makeChildrenByParent(items);
  const specifications = normalizeSpecifications(items, resources);
  const configurationGroups = buildConfigurationGroups(items, childrenByParent);
  const chaptersByKey = buildCatalogSections(items, configurationGroups, specifications);
  const media = normalizeMedia(detail, resources);
  const buildEligibleItems = buildEligibleConfiguration(configurationGroups, resources);

  return {
    template,
    identity: {
      id: template.id || null,
      template_key: template.template_key || detail?.template_key || null,
      manufacturer: template.manufacturer || null,
      model: template.model || null,
      model_year: template.model_year || null,
    },
    lifecycle: {
      lifecycle_state: template.lifecycle_state || template.metadata?.lifecycle_state || template.metadata?.lifecycle || "active",
      publication_state: template.publication_status || template.definition_status || template.authority_state || template.status || "published",
    },
    resources,
    items,
    childrenByParent,
    media,
    specifications,
    primeFacts: primeFactsFromSpecs(specifications),
    configuration: {
      section: items.find((item) => item.canonical_key === CONFIG_SECTION_KEY) || null,
      groups: configurationGroups,
      buildEligibleItems,
    },
    catalog: {
      chaptersByKey,
      resources,
      media,
      specifications,
    },
    reusableSystems: buildEligibleItems.filter((item) => ["system", "component"].includes(item.item?.item_type)),
    options: buildEligibleItems.filter((item) => ["option", "choice", "configuration_item"].includes(item.item?.item_type)),
    care: chaptersByKey.care || [],
  };
}
