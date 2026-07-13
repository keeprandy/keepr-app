import type { ManifestAssociation } from "./kacManifestTypes.ts";
import type { CollectorResult, ResolvedAssetContext } from "./kacManifestCollectorUtils.ts";
import { compactMetadata, diagnostic, runQuery } from "./kacManifestCollectorUtils.ts";

interface AssetIdentifierRow {
  id: string;
  asset_id: string;
  kind: string;
  value: string;
  is_primary: boolean | null;
}

interface MasterAssetRow {
  id: string;
  kac: string;
  asset_type: string;
  manufacturer: string | null;
  model: string | null;
  model_year: number | null;
  vin: string | null;
  hin: string | null;
  serial_number: string | null;
  status: string | null;
}

const ASSET_IDENTITY_FIELDS = ["kac_id", "vin", "serial_number"] as const;

function identityKindFromAssetField(field: string) {
  if (field === "kac_id") return "kac";
  return field;
}

export async function collectAssetIdentityAssociations(
  admin: any,
  context: ResolvedAssetContext,
): Promise<CollectorResult> {
  const diagnostics: CollectorResult["diagnostics"] = [];
  const associations: ManifestAssociation[] = [];
  const asset = context.asset;

  associations.push({
    association_id: `asset:${asset.id}:identity`,
    object_id: asset.id,
    object_type: "asset",
    source_table: "assets",
    relationship_type: "canonical_manifest_asset",
    scope: "kac_specific",
    proof_state: "claimed",
    processing_status: "not_required",
    transfer_classification: "asset_persistent",
    safe_metadata: compactMetadata({
      canonical_asset_id: asset.id,
      kac_id: asset.kac_id,
      master_asset_id: asset.master_asset_id,
      type: asset.type,
      status: asset.status,
      lifecycle_state: asset.lifecycle_state,
      manifest_availability: asset.manifest_availability,
      asset_mode: asset.asset_mode,
    }),
    provenance: [{ table: "assets", row_id: asset.id }],
  });

  if (asset.manifest_availability === "admin_review_required") {
    diagnostics.push(
      diagnostic(
        "disputed_asset_requires_admin_review",
        "warning",
        "This asset requires admin review before normal asset-overview manifestation.",
        { source: "assets", object_type: "asset", object_id: asset.id },
      ),
    );
  }

  if (!asset.master_asset_id) {
    diagnostics.push(
      diagnostic(
        "missing_expected_relationship",
        "info",
        "Asset has no master asset link; Manifest v1 will use the legacy asset identity path.",
        { source: "assets.master_asset_id", object_type: "asset", object_id: asset.id },
      ),
    );
  }

  const identifierRows = await runQuery<AssetIdentifierRow>(diagnostics, "asset_identifiers", () =>
    admin
      .from("asset_identifiers")
      .select("id, asset_id, kind, value, is_primary")
      .eq("asset_id", asset.id)
  );

  const identifiersByKind = new Map<string, Set<string>>();
  for (const row of identifierRows) {
    const normalizedKind = String(row.kind || "unknown").toLowerCase();
    const value = String(row.value || "").trim();
    if (!value) continue;

    if (!identifiersByKind.has(normalizedKind)) identifiersByKind.set(normalizedKind, new Set());
    identifiersByKind.get(normalizedKind)?.add(value.toUpperCase());

    associations.push({
      association_id: `asset_identifier:${row.id}`,
      object_id: row.id,
      object_type: "asset_identifier",
      source_table: "asset_identifiers",
      relationship_type: "identifies_asset",
      scope: "kac_specific",
      proof_state: "claimed",
      processing_status: "not_required",
      transfer_classification: "asset_persistent",
      safe_metadata: compactMetadata({
        kind: normalizedKind,
        value,
        is_primary: row.is_primary,
      }),
      provenance: [{ table: "asset_identifiers", row_id: row.id }],
    });
  }

  for (const field of ASSET_IDENTITY_FIELDS) {
    const value = (asset as any)[field];
    if (!value) continue;

    const kind = identityKindFromAssetField(field);
    const knownValues = identifiersByKind.get(kind) || new Set();
    if (knownValues.size && !knownValues.has(String(value).toUpperCase())) {
      diagnostics.push(
        diagnostic(
          "conflicting_identity",
          "warning",
          "Asset identity fields and asset identifier rows disagree for the same identifier kind.",
          { source: "asset_identifiers", object_type: "asset", object_id: asset.id },
        ),
      );
    }
  }

  if (asset.master_asset_id) {
    const masters = await runQuery<MasterAssetRow>(diagnostics, "master_assets", () =>
      admin
        .from("master_assets")
        .select("id, kac, asset_type, manufacturer, model, model_year, vin, hin, serial_number, status")
        .eq("id", asset.master_asset_id)
    );
    const master = masters[0];

    if (!master) {
      diagnostics.push(
        diagnostic(
          "missing_expected_relationship",
          "warning",
          "Asset references a master asset that was not readable.",
          { source: "master_assets", object_type: "asset", object_id: asset.id },
        ),
      );
    } else {
      associations.push({
        association_id: `master_asset:${master.id}`,
        object_id: master.id,
        object_type: "master_asset",
        source_table: "master_assets",
        relationship_type: "master_identity",
        scope: "horizontal",
        proof_state: "claimed",
        processing_status: "not_required",
        transfer_classification: "asset_persistent",
        safe_metadata: compactMetadata({
          kac: master.kac,
          asset_type: master.asset_type,
          manufacturer: master.manufacturer,
          model: master.model,
          model_year: master.model_year,
          has_vin: Boolean(master.vin),
          has_hin: Boolean(master.hin),
          has_serial_number: Boolean(master.serial_number),
          status: master.status,
        }),
        provenance: [{ table: "master_assets", row_id: master.id }],
      });

      if (master.kac && asset.kac_id && master.kac !== asset.kac_id) {
        diagnostics.push(
          diagnostic(
            "conflicting_identity",
            "warning",
            "Asset KAC and master asset KAC disagree.",
            { source: "master_assets", object_type: "master_asset", object_id: master.id },
          ),
        );
      }
    }
  }

  return { associations, diagnostics };
}
