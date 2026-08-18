function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function clean(value) {
  return typeof value === "string" ? value.trim() : value || null;
}

function firstPresent(...values) {
  for (const value of values) {
    const next = clean(value);
    if (next) return next;
  }
  return null;
}

export function normalizeContributionMetadata({
  metadata = {},
  userId = null,
  orgId = null,
  assetRelationshipId = null,
  stewardshipId = null,
  contributionContext = null,
  authorityState = null,
} = {}) {
  return {
    ...asObject(metadata),
    contributed_by_user_id: firstPresent(userId, metadata.contributed_by_user_id),
    contributed_by_org_id: firstPresent(orgId, metadata.contributed_by_org_id),
    asset_relationship_id: firstPresent(assetRelationshipId, metadata.asset_relationship_id),
    stewardship_id: firstPresent(stewardshipId, metadata.stewardship_id),
    contribution_context: firstPresent(contributionContext, metadata.contribution_context),
    authority_state: firstPresent(authorityState, metadata.authority_state),
  };
}

export function getContributionMetadata(row = {}) {
  return {
    ...asObject(row.source_context),
    ...asObject(row.extra_metadata),
    ...asObject(row.ai_metadata?.source_context),
  };
}

export function formatContributionAttribution(row = {}, options = {}) {
  const metadata = {
    ...getContributionMetadata(row),
    ...asObject(options.metadata),
  };
  const meta = {
    ...metadata,
    contributed_by_user_id: firstPresent(row.contributed_by_user_id, metadata.contributed_by_user_id),
    contributed_by_org_id: firstPresent(row.contributed_by_org_id, metadata.contributed_by_org_id),
    contributed_by_user_label: firstPresent(row.contributed_by_user_label, metadata.contributed_by_user_label),
    contributed_by_org_label: firstPresent(row.contributed_by_org_label, metadata.contributed_by_org_label),
    contribution_context: firstPresent(row.contribution_context, metadata.contribution_context),
    authority_state: firstPresent(row.authority_state, metadata.authority_state),
  };

  const context = String(
    firstPresent(meta.contribution_context, meta.source_type, row.source_type, row.source_context) || ""
  ).toLowerCase();
  const sourceSystem = firstPresent(meta.source_system, meta.external_system, meta.import_source);
  if (context.includes("import") || sourceSystem) {
    return `Imported from ${String(sourceSystem || "external source").toUpperCase()}`;
  }

  const userLabel = firstPresent(
    meta.contributed_by_user_label,
    meta.completed_by_label,
    meta.shared_by_label,
    meta.actor_label
  );
  const orgLabel = firstPresent(
    meta.contributed_by_org_label,
    meta.completed_by_org_label,
    meta.shared_by_org_label,
    meta.actor_org_label
  );

  if (userLabel && orgLabel && userLabel !== orgLabel) return `Added by ${userLabel} · ${orgLabel}`;
  if (orgLabel) return `Added by ${orgLabel}`;
  if (userLabel) return `Added by ${userLabel}`;

  return null;
}
