// enhance/connectors/carfaxConnector.js
import { supabase } from "../../lib/supabaseClient";

export const carfaxConnector = {
  id: "carfax",
  label: "CARFAX",

  /**
   * Run CARFAX enrichment on a PDF attachment
   */
  runEnrich: async ({ assetId, attachmentId, attachment }) => {
    if (!assetId) throw new Error("Missing assetId");
    if (!attachmentId) throw new Error("Missing attachmentId");
    if (!attachment) throw new Error("Missing attachment object");
    if (!attachment.storage_path) {
      throw new Error("Attachment missing storage_path");
    }

    const bucket = attachment.bucket || "asset-files";
    const storagePath = attachment.storage_path;

    // 1) Create signed URL
    const { data: signed, error: signErr } =
      await supabase.storage
        .from(bucket)
        .createSignedUrl(storagePath, 60 * 10);

    if (signErr) throw signErr;
    if (!signed?.signedUrl) {
      throw new Error("Failed to create signed URL");
    }

    // 2) Invoke edge function
    const { data, error } = await supabase.functions.invoke(
      "carfax_enrich_run",
      {
        body: {
          asset_id: assetId,
          attachment_id: attachmentId,
          file_url: signed.signedUrl,
          object_type_key: "attachment",
        },
      }
    );

    if (error) {
      throw new Error(error.message || "CARFAX enrich failed");
    }

    return data; // { run_id, proposals }
  },

  /**
   * Apply intentionally deferred
   */
  applyEnrichRun: async () => {
    throw new Error("Apply not implemented yet");
  },
};
