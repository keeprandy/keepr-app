import { supabase } from "./supabaseClient";
import { listAttachmentsForTarget } from "./attachmentsApi";

export const DEFAULT_TRANSFER_PREVIEW = {
  transfers: [
    "Boat identity and history",
    "Systems, components, and model context",
    "Manuals, documents, and asset records",
    "Transferable service and timeline history",
    "Warranty and care evidence tied to the asset",
    "Showcase photos and asset-context evidence",
  ],
  remains_private: [
    "Personal notes",
    "Personal communications",
    "Payment/private financial context",
    "Records or attachments explicitly marked private",
  ],
  counts: {},
};

async function countRows(query) {
  const { count, error } = await query;
  if (error) return null;
  return typeof count === "number" ? count : null;
}

export async function buildAssetTransferPreview({ assetId }) {
  if (!assetId) return DEFAULT_TRANSFER_PREVIEW;

  const [
    assetResult,
    systemCount,
    serviceCount,
    timelineCount,
    attachmentRows,
  ] = await Promise.all([
    supabase
      .from("assets")
      .select("id, name, type, make, model, year, kac_id, extra_metadata")
      .eq("id", assetId)
      .maybeSingle()
      .then(({ data }) => data || null)
      .catch(() => null),
    countRows(
      supabase
        .from("systems")
        .select("id", { count: "exact", head: true })
        .eq("asset_id", assetId)
    ),
    countRows(
      supabase
        .from("service_records")
        .select("id", { count: "exact", head: true })
        .eq("asset_id", assetId)
    ),
    countRows(
      supabase
        .from("timeline_records")
        .select("id", { count: "exact", head: true })
        .eq("asset_id", assetId)
    ),
    listAttachmentsForTarget("asset", assetId).catch(() => []),
  ]);

  const assetMeta = assetResult?.extra_metadata || {};
  const kac =
    assetResult?.kac_id ||
    assetMeta?.kac_id ||
    assetMeta?.keepr_code ||
    null;
  const attachmentList = Array.isArray(attachmentRows) ? attachmentRows : [];
  const isPhotoAttachment = (attachment) =>
    attachment?.kind === "photo" ||
    String(attachment?.mime_type || "").toLowerCase().startsWith("image/");
  const showcasePhotos = attachmentList.filter(
    (attachment) => attachment?.is_showcase && isPhotoAttachment(attachment)
  ).length;
  const documents = attachmentList.filter(
    (attachment) => !isPhotoAttachment(attachment)
  ).length;

  return {
    ...DEFAULT_TRANSFER_PREVIEW,
    asset: {
      id: assetResult?.id || assetId,
      name: assetResult?.name || null,
      type: assetResult?.type || null,
      year: assetResult?.year || null,
      make: assetResult?.make || null,
      model: assetResult?.model || null,
      kac,
    },
    counts: {
      systems: systemCount,
      service_records: serviceCount,
      timeline_records: timelineCount,
      showcase_photos: showcasePhotos,
      documents,
    },
    projection_note:
      "This boat's history stays with the boat. When ownership changes, Keepr updates access without starting over.",
  };
}
