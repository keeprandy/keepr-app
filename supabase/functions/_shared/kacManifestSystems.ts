import type { ManifestAssociation } from "./kacManifestTypes.ts";
import type { CollectorResult, ResolvedAssetContext } from "./kacManifestCollectorUtils.ts";
import { addNotVisibleDiagnostic, compactMetadata, diagnostic, finalizeCollectorResult, runQuery } from "./kacManifestCollectorUtils.ts";

interface SystemRow {
  id: string;
  asset_id: string;
  ksc_code: string | null;
  name: string;
  status: string | null;
  system_type: string | null;
  source_type: string | null;
  lifecycle_status: string | null;
  lifecycle_phase: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ExtensionRow {
  id: string;
  asset_id: string;
  system_id: string | null;
  system_type: string | null;
  name: string | null;
  manufacturer?: string | null;
  model?: string | null;
  serial_number?: string | null;
  year?: number | null;
  hours?: number | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  location_hint?: string | null;
}

const FORBIDDEN_METADATA_KEYS = new Set([
  "extracted_text",
  "signed_url",
  "signedUrl",
  "storage_path",
  "email",
  "phone",
  "address",
  "dealer_phone",
  "dealer_address",
  "access_token",
  "refresh_token",
  "secret",
  "service_role",
]);

function safeObject(input: unknown): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (FORBIDDEN_METADATA_KEYS.has(key)) continue;
    if (/url$/i.test(key) || /phone/i.test(key) || /address/i.test(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    if (key === "playbook") {
      out.playbook_present = true;
      continue;
    }
    if (typeof value === "object" && !Array.isArray(value)) {
      const nested = safeObject(value);
      if (nested && Object.keys(nested).length) out[key] = nested;
    } else if (Array.isArray(value)) {
      out[key] = value
        .filter((item) => item !== undefined && item !== null && item !== "")
        .map((item) => typeof item === "object" ? safeObject(item) : item)
        .filter((item) => item !== undefined);
    } else {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function systemMetadata(row: SystemRow) {
  const metadata = safeObject(row.metadata);
  return compactMetadata({
    options: metadata?.options,
    summary: metadata?.summary,
    origin: metadata?.origin,
    playbook_present: metadata?.playbook_present,
    source_semantics: metadata ? "systems_metadata_reported_or_configured_context" : undefined,
  });
}

function systemAssociation(row: SystemRow): ManifestAssociation {
  return {
    association_id: `system:${row.id}`,
    object_id: row.id,
    object_type: "system",
    source_table: "systems",
    relationship_type: "installed_system_instance",
    scope: "kac_specific",
    affected_system_id: row.id,
    proof_state: "claimed",
    processing_status: "not_required",
    transfer_classification: "asset_persistent",
    created_at: row.created_at,
    updated_at: row.updated_at,
    safe_metadata: compactMetadata({
      name: row.name,
      ksc_code: row.ksc_code,
      system_type: row.system_type,
      status: row.status,
      source_type: row.source_type,
      lifecycle_status: row.lifecycle_status,
      lifecycle_phase: row.lifecycle_phase,
      ...systemMetadata(row),
    }),
    provenance: [{ table: "systems", row_id: row.id }],
  };
}

function systemOptionAssociations(row: SystemRow): ManifestAssociation[] {
  const options = safeObject(row.metadata)?.options;
  const list = Array.isArray(options) ? options : options ? [options] : [];
  return list.map((option, index) => ({
    association_id: `system:${row.id}:configured_option:${index}`,
    object_id: row.id,
    object_type: "configured_system_option",
    source_table: "systems",
    relationship_type: "configured_system_option",
    scope: "kac_specific" as const,
    affected_system_id: row.id,
    proof_state: "claimed" as const,
    processing_status: "not_required" as const,
    transfer_classification: "asset_persistent" as const,
    created_at: row.created_at,
    updated_at: row.updated_at,
    safe_metadata: compactMetadata({
      name: typeof option === "object" ? (option as Record<string, unknown>).name || (option as Record<string, unknown>).label || row.name : option,
      value: option,
      classification: "configured_or_provisional_system_option",
      source_semantics: "systems_metadata_options_not_verified_installed_component",
    }),
    provenance: [{ table: "systems", row_id: row.id, field: `metadata.options.${index}` }],
  }));
}

function extensionAssociation(table: string, row: ExtensionRow): ManifestAssociation {
  return {
    association_id: `${table}:${row.id}`,
    object_id: row.id,
    object_type: table.slice(0, -1),
    source_table: table,
    relationship_type: row.system_id ? "system_extension" : "legacy_system_instance",
    scope: "kac_specific",
    affected_system_id: row.system_id,
    proof_state: "claimed",
    processing_status: "not_required",
    transfer_classification: "asset_persistent",
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    safe_metadata: compactMetadata({
      name: row.name,
      system_type: row.system_type,
      manufacturer: row.manufacturer,
      model: row.model,
      serial_number: row.serial_number,
      year: row.year,
      hours: row.hours,
      status: row.status,
      location_hint: row.location_hint,
      classification: row.serial_number || row.model || row.hours !== undefined ? "probable_or_verified_installed_component" : "probable_installed_component",
      source_semantics: "extension_row_kac_specific_installed_component_context",
    }),
    provenance: [{ table, row_id: row.id }],
  };
}

export async function collectSystemAssociations(
  admin: any,
  context: ResolvedAssetContext,
): Promise<CollectorResult> {
  const diagnostics: CollectorResult["diagnostics"] = [];
  const associations: ManifestAssociation[] = [];
  const assetId = context.asset.id;

  const systems = await runQuery<SystemRow>(diagnostics, "systems", () =>
    admin
      .from("systems")
      .select("id, asset_id, ksc_code, name, status, system_type, source_type, lifecycle_status, lifecycle_phase, metadata, created_at, updated_at")
      .eq("asset_id", assetId)
  );
  const systemIds = new Set(systems.map((system) => system.id));
  associations.push(...systems.map(systemAssociation));
  associations.push(...systems.flatMap(systemOptionAssociations));

  const extensionTables = [
    {
      table: "vehicle_systems",
      select: "id, asset_id, system_id, system_type, name, manufacturer, model, serial_number, year, hours, created_at",
    },
    {
      table: "boat_systems",
      select: "id, asset_id, system_id, system_type, name, manufacturer, model, serial_number, year, hours, created_at, updated_at",
    },
    {
      table: "home_systems",
      select: "id, asset_id, system_id, system_type, name, location_hint, status, created_at",
    },
  ];

  for (const config of extensionTables) {
    const rows = await runQuery<ExtensionRow>(diagnostics, config.table, () =>
      admin.from(config.table).select(config.select).eq("asset_id", assetId)
    );

    for (const row of rows) {
      if (row.system_id && !systemIds.has(row.system_id)) {
        diagnostics.push(
          diagnostic(
            "unresolved_system_reference",
            "warning",
            "System extension references a system that was not collected.",
            { source: config.table, object_type: config.table.slice(0, -1), object_id: row.id },
          ),
        );
      }
      associations.push(extensionAssociation(config.table, row));
    }
  }

  if (context.access === "direct_steward" && !associations.length) {
    addNotVisibleDiagnostic(diagnostics, "systems", assetId);
  }
  if (context.access === "org_steward" && !associations.some((a) => ["vehicle_systems", "boat_systems", "home_systems"].includes(a.source_table || ""))) {
    addNotVisibleDiagnostic(diagnostics, "systems", assetId);
  }
  if (context.association_visibility === "admin_identity_only" && !associations.length) {
    addNotVisibleDiagnostic(diagnostics, "systems", assetId);
  }

  return finalizeCollectorResult(associations, diagnostics);
}
