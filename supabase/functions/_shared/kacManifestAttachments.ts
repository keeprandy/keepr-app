import type { ManifestAssociation, ProcessingStatus, ProofState, TransferClassification } from "./kacManifestTypes.ts";
import type { CollectorResult, ResolvedAssetContext } from "./kacManifestCollectorUtils.ts";
import { compactMetadata, diagnostic, runQuery } from "./kacManifestCollectorUtils.ts";

interface AttachmentRow {
  id: string;
  asset_id: string | null;
  kind: string;
  bucket: string | null;
  file_name: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  title: string | null;
  created_at: string | null;
  deleted_at: string | null;
  tags: string[] | null;
  text_source: string | null;
  ocr_status: string | null;
  doc_type: string | null;
  extracted_at: string | null;
  extracted_error: string | null;
  privacy: string | null;
  derivatives_status: string | null;
}

interface PlacementRow {
  id: string;
  attachment_id: string;
  target_type: "asset" | "system" | "service_record" | "event";
  target_id: string;
  role: string | null;
  label: string | null;
  created_at: string | null;
  is_showcase: boolean | null;
}

interface AttachmentLinkRow {
  id: string;
  asset_id: string;
  system_id: string | null;
  service_record_id: string | null;
  title: string | null;
  link_type: string | null;
  provider: string | null;
  created_at: string | null;
  updated_at: string | null;
}

function processingStatus(row: AttachmentRow): ProcessingStatus {
  if (row.extracted_error) return "failed";
  if (row.ocr_status === "needs_review") return "needs_review";
  if (row.ocr_status === "processing") return "processing";
  if (row.ocr_status === "queued" || row.derivatives_status === "pending") return "queued";
  if (row.extracted_at || row.text_source === "ocr" || row.text_source === "manual") return "processed";
  if (row.ocr_status === "not_needed" || row.text_source === "none") return "not_required";
  return "unknown";
}

function evidenceRole(row: AttachmentRow) {
  if (row.kind === "photo") return "photo" as const;
  if (row.kind === "link") return "external_link" as const;
  if (row.doc_type === "receipt") return "receipt" as const;
  if (row.doc_type === "invoice") return "invoice" as const;
  if (row.doc_type === "manual") return "manual" as const;
  if (row.doc_type === "warranty") return "warranty" as const;
  return "unknown" as const;
}

function proofState(row: AttachmentRow): ProofState {
  if (row.deleted_at) return "none";
  if (row.kind === "photo" || row.kind === "file" || row.kind === "link") return "evidence_attached";
  return "unknown";
}

function transferClassification(row: AttachmentRow): TransferClassification {
  if (row.privacy === "moves_with_asset") return "asset_persistent";
  if (row.privacy === "owner_only") return "owner_private";
  return "unclassified";
}

function attachmentAssociation(row: AttachmentRow): ManifestAssociation {
  const role = evidenceRole(row);
  return {
    association_id: `attachment:${row.id}`,
    object_id: row.id,
    object_type: "attachment",
    source_table: "attachments",
    relationship_type: "source_document",
    scope: "kac_specific",
    evidence_role: role,
    evidence_roles: role === "unknown" ? undefined : [role],
    proof_state: proofState(row),
    processing_status: processingStatus(row),
    transfer_classification: transferClassification(row),
    created_at: row.created_at,
    safe_metadata: compactMetadata({
      kind: row.kind,
      bucket: row.bucket,
      file_name: row.file_name,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      title: row.title,
      tags: row.tags,
      text_source: row.text_source,
      ocr_status: row.ocr_status,
      doc_type: row.doc_type,
      extracted_at: row.extracted_at,
      privacy: row.privacy,
      derivatives_status: row.derivatives_status,
    }),
    provenance: [{ table: "attachments", row_id: row.id }],
  };
}

function placementAssociation(row: PlacementRow): ManifestAssociation {
  return {
    association_id: `attachment_placement:${row.id}`,
    object_id: row.id,
    object_type: "attachment_placement",
    source_table: "attachment_placements",
    relationship_type: "places_attachment",
    scope: "kac_specific",
    affected_system_id: row.target_type === "system" ? row.target_id : null,
    proof_state: "claimed",
    processing_status: "not_required",
    transfer_classification: "unclassified",
    created_at: row.created_at,
    safe_metadata: compactMetadata({
      attachment_id: row.attachment_id,
      target_type: row.target_type,
      target_id: row.target_id,
      role: row.role,
      label: row.label,
      is_showcase: row.is_showcase,
    }),
    provenance: [{ table: "attachment_placements", row_id: row.id }],
  };
}

function linkAssociation(row: AttachmentLinkRow): ManifestAssociation {
  return {
    association_id: `attachment_link:${row.id}`,
    object_id: row.id,
    object_type: "external_link",
    source_table: "attachment_links",
    relationship_type: "external_link",
    scope: "kac_specific",
    affected_system_id: row.system_id,
    evidence_role: "external_link",
    evidence_roles: ["external_link"],
    proof_state: "claimed",
    processing_status: "unprocessed",
    transfer_classification: "unclassified",
    created_at: row.created_at,
    updated_at: row.updated_at,
    safe_metadata: compactMetadata({
      title: row.title,
      link_type: row.link_type,
      provider: row.provider,
      service_record_id: row.service_record_id,
    }),
    provenance: [{ table: "attachment_links", row_id: row.id }],
  };
}

export async function collectAttachmentAssociations(
  admin: any,
  context: ResolvedAssetContext,
): Promise<CollectorResult> {
  const diagnostics: CollectorResult["diagnostics"] = [];
  const associations: ManifestAssociation[] = [];
  const assetId = context.asset.id;

  const [attachments, links] = await Promise.all([
    runQuery<AttachmentRow>(diagnostics, "attachments", () =>
      admin
        .from("attachments")
        .select("id, asset_id, kind, bucket, file_name, mime_type, size_bytes, title, created_at, deleted_at, tags, text_source, ocr_status, doc_type, extracted_at, extracted_error, privacy, derivatives_status")
        .eq("asset_id", assetId)
        .is("deleted_at", null)
    ),
    runQuery<AttachmentLinkRow>(diagnostics, "attachment_links", () =>
      admin
        .from("attachment_links")
        .select("id, asset_id, system_id, service_record_id, title, link_type, provider, created_at, updated_at")
        .eq("asset_id", assetId)
    ),
  ]);

  const attachmentIds = new Set(attachments.map((attachment) => attachment.id));
  const placementIds = new Set<string>();
  associations.push(...attachments.map(attachmentAssociation));
  associations.push(...links.map(linkAssociation));

  if (attachmentIds.size) {
    const placements = await runQuery<PlacementRow>(diagnostics, "attachment_placements", () =>
      admin
        .from("attachment_placements")
        .select("id, attachment_id, target_type, target_id, role, label, created_at, is_showcase")
        .in("attachment_id", [...attachmentIds])
    );

    for (const placement of placements) {
      if (!attachmentIds.has(placement.attachment_id)) {
        diagnostics.push(
          diagnostic(
            "orphaned_placement",
            "warning",
            "Attachment placement references an attachment that was not collected.",
            { source: "attachment_placements", object_type: "attachment_placement", object_id: placement.id },
          ),
        );
      }
      if (!placementIds.has(placement.id)) {
        placementIds.add(placement.id);
        associations.push(placementAssociation(placement));
      }
    }
  }

  const assetPlacements = await runQuery<PlacementRow>(diagnostics, "attachment_placements_asset_scope", () =>
    admin
      .from("attachment_placements")
      .select("id, attachment_id, target_type, target_id, role, label, created_at, is_showcase")
      .eq("target_type", "asset")
      .eq("target_id", assetId)
  );

  for (const placement of assetPlacements) {
    if (!attachmentIds.has(placement.attachment_id)) {
      diagnostics.push(
        diagnostic(
          "orphaned_placement",
          "warning",
          "Asset attachment placement references an attachment that was not collected.",
          { source: "attachment_placements", object_type: "attachment_placement", object_id: placement.id },
        ),
      );
      if (!placementIds.has(placement.id)) {
        placementIds.add(placement.id);
        associations.push(placementAssociation(placement));
      }
    }
  }

  return { associations, diagnostics };
}
