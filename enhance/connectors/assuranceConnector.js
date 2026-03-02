// enhance/connectors/assuranceConnector.js
import { supabase } from "../../lib/supabaseClient";

// Helper: ensure object
function asObj(v) {
  return v && typeof v === "object" ? v : {};
}

export const assuranceConnector = {
  id: "assurance",
  label: "Warranty / Contract",

  runEnrich: async ({ assetId, attachmentId, attachment }) => {
    if (!assetId) throw new Error("Missing assetId");
    if (!attachmentId) throw new Error("Missing attachmentId");

    const name = (attachment?.title || attachment?.file_name || "").toLowerCase();
    const tags = Array.isArray(attachment?.tags)
      ? attachment.tags.join(",").toLowerCase()
      : String(attachment?.tags || "").toLowerCase();

    const looksLikeWarranty =
      name.includes("warranty") ||
      name.includes("contract") ||
      name.includes("service") ||
      tags.includes("warranty") ||
      tags.includes("contract");

    // V1 draft (goes into extracted jsonb)
    const assuranceDraft = {
      assurance_type: "extended_warranty",
      provider: "Gold Standard Automotive Network",
      plan_name: "10K x 10K Plus",
      agreement_number: null,
      effective_date: "2023-11-20",
      deductible_amount: 100,
      currency: "USD",
      authorization_required: true,
      compliance_rules: [
        { rule_type: "oil_change", interval_miles: 6000, interval_months: 6, documentation_required: true },
      ],
      coverage_hints: [
        { system_key: "engine", coverage: "conditional", notes: "Covered if maintenance cadence is met." },
        { system_key: "drivetrain", coverage: "covered", notes: "Major drivetrain components covered per plan." },
        { system_key: "cooling", coverage: "covered", notes: "Cooling system components included per plan summary." },
        { system_key: "electrical", coverage: "conditional", notes: "Many electrical components included; verify exclusions." },
      ],
      source: { attachment_id: attachmentId },
      inferred: { looksLikeWarranty },
    };

    return {
      run_id: `assurance_${Date.now()}`,
      detected: looksLikeWarranty ? "Warranty / Contract" : "Unknown",
      proposed_actions: 1,
      summary: "Creates an Assurance Record and annotates relevant systems with coverage + compliance rules.",
      assurance_draft: assuranceDraft,
    };
  },

  applyEnrichRun: async ({ assetId, attachmentId, enrichPayload }) => {
    if (!assetId) throw new Error("Missing assetId");
    if (!attachmentId) throw new Error("Missing attachmentId");

    const draft = enrichPayload?.assurance_draft;
    if (!draft) throw new Error("Missing assurance draft to apply");

    // IMPORTANT: owner_id must match auth.uid() for your RLS policy
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;

    const ownerId = authData?.user?.id;
    if (!ownerId) throw new Error("Not authenticated (ownerId missing)");

    // 1) Insert assurance record (ONLY columns that exist)
    const insertRow = {
      owner_id: ownerId,
      asset_id: assetId,
      attachment_id: attachmentId,
      provider: draft.provider || null,
      plan_name: draft.plan_name || null,
      agreement_number: draft.agreement_number || null,
      assurance_type: draft.assurance_type || "extended_warranty",
      extracted: {
        ...asObj(enrichPayload),
        applied_at: new Date().toISOString(),
      },
    };

    const { data: ins, error: insErr } = await supabase
      .from("assurance_records")
      .insert(insertRow)
      .select("id")
      .single();

    if (insErr) throw insErr;
    const assuranceId = ins?.id;

    // 2) Fetch systems for asset
    const { data: systems, error: sysErr } = await supabase
      .from("systems")
      .select("id,name,metadata")
      .eq("asset_id", assetId);

    if (sysErr) throw sysErr;

    // 3) Annotate matching systems (in systems.metadata.assurance)
    const hints = Array.isArray(draft.coverage_hints) ? draft.coverage_hints : [];

    const pickHintForSystem = (sysName) => {
      const n = String(sysName || "").toLowerCase();
      if (n.includes("engine")) return hints.find((h) => h.system_key === "engine");
      if (n.includes("drive") || n.includes("transmission") || n.includes("drivetrain"))
        return hints.find((h) => h.system_key === "drivetrain");
      if (n.includes("cool")) return hints.find((h) => h.system_key === "cooling");
      if (n.includes("elect")) return hints.find((h) => h.system_key === "electrical");
      return null;
    };

    const updates = [];
    for (const s of systems || []) {
      const hint = pickHintForSystem(s.name);
      if (!hint) continue;

      const baseMeta = asObj(s.metadata);
      const nextMeta = {
        ...baseMeta,
        assurance: {
          assurance_id: assuranceId,
          assurance_type: insertRow.assurance_type,
          coverage: hint.coverage,
          notes: hint.notes,
        },
      };

      updates.push(supabase.from("systems").update({ metadata: nextMeta }).eq("id", s.id));
    }

    const results = await Promise.all(updates);
    const anyErr = results.find((r) => r.error)?.error;
    if (anyErr) throw anyErr;

    return { assurance_id: assuranceId, systems_updated: updates.length };
  },
};
