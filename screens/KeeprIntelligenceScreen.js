// screens/KeeprIntelligenceScreen.js
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { getSignedUrl } from "../lib/attachmentsApi";
import { colors, spacing, radius } from "../styles/theme";

// IMPORTANT: this import must resolve to .web.js on web and .native.js on native
import { extractPdfTextFromUrl } from "../lib/pdfTextExtract";

const IS_WEB = Platform.OS === "web";
const MIN_RAW_CHARS = 120;

function toNumberOrNull(v) {
  if (v == null) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

function toIsoDateOrNull(v) {
  const s = safeStr(v).trim();
  if (!s) return null;
  // Accept YYYY-MM or YYYY-MM-DD
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

function ensureMetadataV1(meta) {
  const base = meta && typeof meta === "object" ? JSON.parse(JSON.stringify(meta)) : {};
  if (!base.standard) base.standard = {};
  if (!base.extended) base.extended = {};

  const std = base.standard;
  if (!std.identity) std.identity = {};
  if (!std.warranty) std.warranty = {};
  if (!std.service) std.service = {};
  if (!std.value) std.value = {};
  if (!std.risk) std.risk = {};
  if (!std.story) std.story = {};
  if (!std.relationships) std.relationships = {};

  return base;
}

function cleanStrOrNull(v) {
  const s = safeStr(v).trim();
  return s ? s : null;
}

function pickFirstNonEmpty(...vals) {
  for (const v of vals) {
    const s = safeStr(v).trim();
    if (s) return s;
  }
  return "";
}

/**
 * V1 “KI Output Contract” (preferred):
 * {
 *   proposed_updates: { identity: {...}, warranty: {...}, value: {...}, evidence_role: ... },
 *   inventory_effects: {...},
 *   confidence: ...
 * }
 *
 * Back-compat: derives from older { extracted: { identity, warranty, value, ... } } shapes
 */
function buildProposedUpdatesFromKi(ki) {
  const r = ki || {};

  // Preferred V1 contract
  const proposed =
    r.proposed_updates && typeof r.proposed_updates === "object" ? r.proposed_updates : null;
  if (proposed) {
    // Deterministic v1_deterministic contract may return:
    //   proposed_updates: { system_patch: { "standard.identity.serial_number": "..." }, attachment_patch: { role: "receipt" } }
    // Map those dotted keys into the legacy draft shape so Apply (system metadata enrichment) still works.
    const systemPatch =
      proposed.system_patch && typeof proposed.system_patch === "object" ? proposed.system_patch : null;
    const attachmentPatch =
      proposed.attachment_patch && typeof proposed.attachment_patch === "object" ? proposed.attachment_patch : null;

    const mapped = { identity: {}, warranty: {}, value: {} };

    if (systemPatch) {
      for (const [k, v] of Object.entries(systemPatch)) {
        if (typeof k !== "string") continue;

        if (k.startsWith("standard.identity.")) {
          const field = k.replace("standard.identity.", "");
          mapped.identity[field] = v;
        } else if (k.startsWith("standard.warranty.")) {
          const field = k.replace("standard.warranty.", "");
          mapped.warranty[field] = v;
        } else if (k.startsWith("standard.value.")) {
          const field = k.replace("standard.value.", "");
          mapped.value[field] = v;
        }
      }
    }

    return {
      identity: proposed.identity || mapped.identity || {},
      warranty: proposed.warranty || mapped.warranty || {},
      value: proposed.value || mapped.value || {},
      evidence_role:
        proposed.evidence_role ||
        attachmentPatch?.role ||
        r.evidence_role ||
        null,
      inventory_effects: r.inventory_effects || null,

      // keep raw proposal for debugging / UI if needed
      _proposed: proposed,
    };
  }

  // Back-compat: try to derive from existing KI shapes
  const extracted = r.extracted && typeof r.extracted === "object" ? r.extracted : {};
  const id = extracted.identity && typeof extracted.identity === "object" ? extracted.identity : {};
  const w =
    extracted.warranty && typeof extracted.warranty === "object" ? extracted.warranty : {};
  const val = extracted.value && typeof extracted.value === "object" ? extracted.value : {};

  return {
    identity: {
      manufacturer: pickFirstNonEmpty(id.manufacturer, extracted.manufacturer),
      model: pickFirstNonEmpty(id.model, extracted.model, extracted.model_number),
      serial_number: pickFirstNonEmpty(id.serial_number, extracted.serial_number, extracted.serial),
      year: id.year ?? extracted.year ?? null,
      installed_on: pickFirstNonEmpty(
        id.installed_on,
        extracted.installed_on,
        extracted.manufactured_date
      ),
      installed_by: pickFirstNonEmpty(id.installed_by, extracted.installed_by),
      location: pickFirstNonEmpty(id.location, extracted.location),
      notes: pickFirstNonEmpty(id.notes, extracted.notes),
    },
    warranty: {
      provider: pickFirstNonEmpty(w.provider, extracted.warranty_provider),
      policy_number: pickFirstNonEmpty(w.policy_number, extracted.policy_number),
      starts_on: pickFirstNonEmpty(w.starts_on, extracted.warranty_start),
      expires_on: pickFirstNonEmpty(w.expires_on, extracted.warranty_expires, extracted.warranty_end),
      coverage_notes: pickFirstNonEmpty(w.coverage_notes, extracted.coverage_notes),
    },
    value: {
      estimated_replacement_usd:
        val.estimated_replacement_usd ?? extracted.estimated_replacement_usd ?? null,
      verified_value_usd: val.verified_value_usd ?? extracted.verified_value_usd ?? null,
      confidence_score: val.confidence_score ?? extracted.confidence_score ?? null,
    },
    evidence_role: r.evidence_role || null,
    inventory_effects: null,
  };
}

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function formatDateTime(iso) {
  const s = safeStr(iso);
  if (!s) return "";
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s;
  }
}

function normalizeUrl(u) {
  const s = safeStr(u).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function isPdfLike(mime, nameOrUrl) {
  const m = safeStr(mime).toLowerCase();
  const n = safeStr(nameOrUrl).toLowerCase();
  return m.includes("pdf") || n.endsWith(".pdf");
}

function isImageLike(mime, nameOrUrl) {
  const m = safeStr(mime).toLowerCase();
  const n = safeStr(nameOrUrl).toLowerCase();
  return (
    m.startsWith("image/") ||
    n.endsWith(".jpg") ||
    n.endsWith(".jpeg") ||
    n.endsWith(".png") ||
    n.endsWith(".webp")
  );
}

async function buildPreviewUrl(att) {
  if (!att) return "";

  // Links
  if (att.kind === "link" && att.url) return normalizeUrl(att.url);

  // Stored file (bucket + path)
  if (att.bucket && att.storage_path) {
    // Prefer signed URL so private buckets still preview
    try {
      const signed = await getSignedUrl(att.bucket, att.storage_path);
      if (signed) return signed;
    } catch {
      // fall back below
    }

    // fallback public url (may fail for private buckets)
    const { data } = supabase.storage.from(att.bucket).getPublicUrl(att.storage_path);
    return safeStr(data?.publicUrl);
  }

  // Direct URL fallback
  return normalizeUrl(att.url);
}

function prettyKV(title, rows = []) {
  return (
    <View style={styles.kvBox}>
      <Text style={styles.kvTitle}>{title}</Text>
      {rows.length ? (
        rows.map((r, idx) => (
          <View key={`${title}-${idx}`} style={styles.kvRow}>
            <Text style={styles.kvKey}>{r.k}</Text>
            <Text style={styles.kvVal}>{r.v}</Text>
          </View>
        ))
      ) : (
        <Text style={styles.muted}>—</Text>
      )}
    </View>
  );
}

export default function KeeprIntelligenceScreen({ navigation, route }) {
  const assetIdParam = route?.params?.assetId || null;
  const attachmentIdParam = route?.params?.attachmentId || null;
  const systemIdParam = route?.params?.systemId || route?.params?.targetId || null;
  const recordIdParam = route?.params?.recordId || null;

  const effectiveAssetId = assetIdParam || null;
  const effectiveAttachmentId = attachmentIdParam || null;
  const effectiveSystemId = systemIdParam || null;
  const effectiveRecordId = recordIdParam || null;

  const [loading, setLoading] = useState(false);
  const [errMsg, setErrMsg] = useState("");

  const [attachment, setAttachment] = useState(null);
  const [previewUrl, setPreviewUrl] = useState("");

  const [sourceText, setSourceText] = useState("");
  const [savingText, setSavingText] = useState(false);

  const [kiBusy, setKiBusy] = useState(false);
  const [kiError, setKiError] = useState("");
  const [kiResult, setKiResult] = useState(null);

  const [applyOpen, setApplyOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [applyDraft, setApplyDraft] = useState({
    identity: {},
    warranty: {},
    value: {},
    evidence_role: null,
  });

  const docTitle = useMemo(() => {
    return (
      safeStr(attachment?.title) ||
      safeStr(attachment?.file_name) ||
      safeStr(attachment?.storage_path) ||
      "Keepr Intelligence"
    );
  }, [attachment]);

  const canPreview = useMemo(() => !!previewUrl, [previewUrl]);
  const isPdf = useMemo(
    () => isPdfLike(attachment?.mime_type, attachment?.file_name || previewUrl),
    [attachment, previewUrl]
  );
  const isImg = useMemo(
    () => isImageLike(attachment?.mime_type, attachment?.file_name || previewUrl),
    [attachment, previewUrl]
  );

  const load = useCallback(async () => {
    if (!effectiveAttachmentId) return;
    console.log("[KI] load", { assetId: effectiveAssetId, attachmentId: effectiveAttachmentId });
    setLoading(true);
    setErrMsg("");

    try {
      const { data, error } = await supabase
        .from("attachments")
        .select(
          "id, asset_id, kind, bucket, storage_path, url, file_name, mime_type, title, notes, doc_type, ocr_status, text_source, extracted_text, extracted_at"
        )
        .eq("id", effectiveAttachmentId)
        .maybeSingle();

      if (error) throw error;

      setAttachment(data || null);

      const url = await buildPreviewUrl(data);
      setPreviewUrl(url);

      setSourceText(safeStr(data?.extracted_text));
    } catch (e) {
      console.error("KI load error", e);
      setErrMsg(e?.message || "Failed to load attachment");
      setAttachment(null);
      setPreviewUrl("");
    } finally {
      setLoading(false);
    }
  }, [effectiveAttachmentId, effectiveAssetId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveExtractedText = useCallback(async () => {
    if (!effectiveAttachmentId) {
      Alert.alert("Missing attachment", "No attachment selected.");
      return;
    }

    setSavingText(true);
    try {
      const text = safeStr(sourceText);

      const patch = {
        extracted_text: text,
        text_source: text ? "user_paste" : "none",
        ocr_status: text ? "done" : "not_needed",
        extracted_at: text ? new Date().toISOString() : null,
        doc_type:
          safeStr(attachment?.doc_type) && safeStr(attachment?.doc_type) !== "unknown"
            ? attachment?.doc_type
            : isPdf
            ? "pdf"
            : attachment?.doc_type || "unknown",
      };

      const { error } = await supabase.from("attachments").update(patch).eq("id", effectiveAttachmentId);
      if (error) throw error;

      // refresh local attachment state so header + chips stay accurate
      setAttachment((prev) => ({ ...(prev || {}), ...patch }));
      Alert.alert("Saved", "Source text saved on this attachment. You can run KI now, or come back later without re-pasting.");
    } catch (e) {
      console.error("Save extracted_text error", e);
      Alert.alert("Save failed", e?.message || "Could not save extracted text.");
    } finally {
      setSavingText(false);
    }
  }, [effectiveAttachmentId, sourceText, attachment, isPdf]);

  const extractPdfText = useCallback(async () => {
    if (!IS_WEB) {
      Alert.alert(
        "Web only",
        "PDF text extraction runs in the web app. On mobile, use scanner OCR or paste text."
      );
      return;
    }
    if (!previewUrl || !isPdf) {
      Alert.alert("No PDF", "This attachment does not look like a PDF preview.");
      return;
    }

    try {
      setSavingText(true);

      const text = await extractPdfTextFromUrl(previewUrl);
      if (!text || text.trim().length < 20) {
        Alert.alert("No text found", "This PDF may be image-only. Use scanner OCR and paste the text.");
        return;
      }

      setSourceText(text);

      // Optional: auto-save immediately (keeps sprint tight)
      await new Promise((r) => setTimeout(r, 50));
      await saveExtractedText();
    } catch (e) {
      console.error("PDF extract error", e);
      Alert.alert("Extract failed", e?.message || "Could not extract text from PDF.");
    } finally {
      setSavingText(false);
    }
  }, [previewUrl, isPdf, saveExtractedText]);

  const runKeeprIntelligence = useCallback(async () => {
    const text = safeStr(sourceText).trim();

    if (text.length < MIN_RAW_CHARS) {
      Alert.alert("Need more text", `Add at least ${MIN_RAW_CHARS} characters (paste OCR text or extract PDF text).`);
      return;
    }
    if (!effectiveAssetId) {
      Alert.alert("Missing asset", "Cannot run KI without an asset id.");
      return;
    }

    setKiBusy(true);
    setKiError("");

    try {
      const { data, error } = await supabase.functions.invoke("ki-invoke", {
        body: {
          asset_id: effectiveAssetId,
          attachment_id: effectiveAttachmentId || null,
          system_id: effectiveSystemId || null,
          record_id: effectiveRecordId || null,
          source_text: text,
        },
      });
      if (error) throw error;

      let parsed = data;
      if (typeof data === "string") {
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = { raw: data };
        }
      }

      const next = parsed || null;
      setKiResult(next);

      // Prepare commit-ready draft for Apply updates
      try {
        setApplyDraft(buildProposedUpdatesFromKi(next));
        setApplyError("");
      } catch {
        // ignore
      }
    } catch (e) {
      console.error("KI invoke failed", e);
      setKiError(e?.message || "Keepr Intelligence failed to run.");
      setKiResult(null);
    } finally {
      setKiBusy(false);
    }
  }, [effectiveAssetId, effectiveAttachmentId, sourceText]);

  const copyJson = useCallback(async () => {
    try {
      const txt = JSON.stringify(kiResult || {}, null, 2);

      if (IS_WEB && navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(txt);
      } else {
        Alert.alert("Copy", "On mobile, copy is not wired yet. Use web for Copy JSON.");
        return;
      }
      Alert.alert("Copied", "JSON copied to clipboard.");
    } catch (e) {
      Alert.alert("Copy failed", e?.message || "Could not copy.");
    }
  }, [kiResult]);

  const openPreview = useCallback(async () => {
    if (!previewUrl) return;
    try {
      await Linking.openURL(previewUrl);
    } catch (e) {
      Alert.alert("Open failed", e?.message || "Could not open link.");
    }
  }, [previewUrl]);

  const openApply = useCallback(() => {
    if (!kiResult) {
      Alert.alert("Run KI first", "Run KI so Keepr can propose updates.");
      return;
    }
    if (!effectiveSystemId) {
      Alert.alert("No system selected", "Open Keepr Intelligence from a System to apply updates.");
      return;
    }
    setApplyError("");
    setApplyOpen(true);
  }, [kiResult, effectiveSystemId]);

  const applyUpdates = useCallback(async () => {
    if (!effectiveSystemId) return;

    // Validate date strings if present
    const inst = applyDraft?.identity?.installed_on ? toIsoDateOrNull(applyDraft.identity.installed_on) : null;
    if (applyDraft?.identity?.installed_on && !inst) {
      Alert.alert("Invalid date", "Installed on must be YYYY-MM-DD (or YYYY-MM).");
      return;
    }
    const ws = applyDraft?.warranty?.starts_on ? toIsoDateOrNull(applyDraft.warranty.starts_on) : null;
    if (applyDraft?.warranty?.starts_on && !ws) {
      Alert.alert("Invalid date", "Warranty start must be YYYY-MM-DD (or YYYY-MM).");
      return;
    }
    const we = applyDraft?.warranty?.expires_on ? toIsoDateOrNull(applyDraft.warranty.expires_on) : null;
    if (applyDraft?.warranty?.expires_on && !we) {
      Alert.alert("Invalid date", "Warranty expires must be YYYY-MM-DD (or YYYY-MM).");
      return;
    }

    setApplyBusy(true);
    setApplyError("");
    try {
      const { data: sys, error: fetchErr } = await supabase
        .from("systems")
        .select("id, metadata")
        .eq("id", effectiveSystemId)
        .single();
      if (fetchErr) throw fetchErr;

      const next = ensureMetadataV1(sys?.metadata);

      const id = applyDraft?.identity || {};
      const w = applyDraft?.warranty || {};
      const v = applyDraft?.value || {};

      // Only write non-empty fields (do not wipe user data)
      if (cleanStrOrNull(id.manufacturer) != null) next.standard.identity.manufacturer = cleanStrOrNull(id.manufacturer);
      if (cleanStrOrNull(id.model) != null) next.standard.identity.model = cleanStrOrNull(id.model);
      if (cleanStrOrNull(id.serial_number) != null) next.standard.identity.serial_number = cleanStrOrNull(id.serial_number);
      if (id.year != null && String(id.year).trim() !== "") next.standard.identity.year = toNumberOrNull(id.year);
      if (inst) next.standard.identity.installed_on = inst;
      if (cleanStrOrNull(id.installed_by) != null) next.standard.identity.installed_by = cleanStrOrNull(id.installed_by);
      if (cleanStrOrNull(id.location) != null) next.standard.identity.location = cleanStrOrNull(id.location);
      if (cleanStrOrNull(id.notes) != null) next.standard.identity.notes = cleanStrOrNull(id.notes);

      if (cleanStrOrNull(w.provider) != null) next.standard.warranty.provider = cleanStrOrNull(w.provider);
      if (cleanStrOrNull(w.policy_number) != null) next.standard.warranty.policy_number = cleanStrOrNull(w.policy_number);
      if (ws) next.standard.warranty.starts_on = ws;
      if (we) next.standard.warranty.expires_on = we;
      if (cleanStrOrNull(w.coverage_notes) != null) next.standard.warranty.coverage_notes = cleanStrOrNull(w.coverage_notes);

      const rep = v.estimated_replacement_usd != null ? toNumberOrNull(v.estimated_replacement_usd) : null;
      if (rep != null) next.standard.value.estimated_replacement_usd = rep;
      const ver = v.verified_value_usd != null ? toNumberOrNull(v.verified_value_usd) : null;
      if (ver != null) next.standard.value.verified_value_usd = ver;
      const conf = v.confidence_score != null ? toNumberOrNull(v.confidence_score) : null;
      if (conf != null && conf >= 0 && conf <= 1) next.standard.value.confidence_score = conf;

      // Audit trail in extended
      const audit = {
        at: new Date().toISOString(),
        attachment_id: effectiveAttachmentId || null,
        ki_confidence: kiResult?.confidence ?? null,
        proposed: {
          identity: id,
          warranty: w,
          value: v,
        },
      };
      if (!next.extended.ki_runs) next.extended.ki_runs = [];
      if (Array.isArray(next.extended.ki_runs)) {
        next.extended.ki_runs.unshift(audit);
        next.extended.ki_runs = next.extended.ki_runs.slice(0, 20);
      }

      const { error: upErr } = await supabase.from("systems").update({ metadata: next }).eq("id", effectiveSystemId);
      if (upErr) throw upErr;

      setApplyOpen(false);
      Alert.alert("Applied", "System updated from evidence.");
    } catch (e) {
      console.error("Apply updates failed", e);
      const msg = e?.message || "Could not apply updates.";
      setApplyError(msg);
    } finally {
      setApplyBusy(false);
    }
  }, [effectiveSystemId, applyDraft, effectiveAttachmentId, kiResult]);

  // Human readable output view from KI result (proposal-first)
  const outputBlocks = useMemo(() => {
    const r = kiResult || {};
    const target = r.target && typeof r.target === "object" ? r.target : {};
    const intent = safeStr(r.intent) || "unknown";

    const facts = Array.isArray(r.verifiable_facts) ? r.verifiable_facts : [];
    const missing = Array.isArray(r.missing_inputs) ? r.missing_inputs : [];

    const proposed =
      r.proposed_updates && typeof r.proposed_updates === "object" ? r.proposed_updates : null;

    // Flatten proposed updates for readable preview
    const proposedRows = [];
    if (proposed) {
      for (const [section, payload] of Object.entries(proposed)) {
        if (payload && typeof payload === "object") {
          for (const [k, v] of Object.entries(payload)) {
            proposedRows.push({
              k: `${section}.${k}`,
              v:
                typeof v === "string" || typeof v === "number"
                  ? String(v)
                  : JSON.stringify(v),
            });
          }
        } else {
          proposedRows.push({ k: section, v: String(payload) });
        }
      }
    }

    const appliesTo = (() => {
      const rid = safeStr(target.record_id) || safeStr(effectiveRecordId);
      const sid = safeStr(target.system_id) || safeStr(effectiveSystemId);
      if (rid) return { k: "applies_to", v: `record:${rid}` };
      if (sid) return { k: "applies_to", v: `system:${sid}` };
      return { k: "applies_to", v: "— (select a target)" };
    })();

    // Back-compat: if older KI returns extracted/recommendations, keep them in debug only
    return {
      metaRows: [
        { k: "doc_type", v: safeStr(attachment?.doc_type) || "unknown" },
        { k: "ocr_status", v: safeStr(attachment?.ocr_status) || "unknown" },
        { k: "text_source", v: safeStr(attachment?.text_source) || "unknown" },
        { k: "confidence", v: String(r.confidence ?? "—") },
      ],
      intentRow: [{ k: "intent", v: intent }],
      appliesRow: [appliesTo],
      factsRows: facts.map((f) => ({
        k: safeStr(f?.k) || "fact",
        v: String(f?.v ?? ""),
      })),
      proposedRows,
      missingRows: missing.map((x) => ({ k: "missing", v: String(x) })),
    };
  }, [kiResult, attachment, effectiveSystemId, effectiveRecordId]);


  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Ionicons name="arrow-back" size={18} color={colors.textPrimary} />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        <View style={styles.headerTitles}>
          <Text style={styles.h1}>Keepr Intelligence</Text>
          <Text style={styles.h2} numberOfLines={1}>
            {docTitle}
          </Text>
        </View>

        <View style={{ width: 80 }} />
      </View>

      {errMsg ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{errMsg}</Text>
        </View>
      ) : null}

      <Modal
        visible={applyOpen}
        transparent
        animationType="fade"
        onRequestClose={() => (applyBusy ? null : setApplyOpen(false))}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => (applyBusy ? null : setApplyOpen(false))}
        >
          <Pressable style={styles.modalCard} onPress={() => {}}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Apply updates</Text>
              <TouchableOpacity
                onPress={() => (applyBusy ? null : setApplyOpen(false))}
                style={styles.modalClose}
                disabled={applyBusy}
              >
                <Ionicons name="close" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              Review what Keepr found. Only non-empty fields will be written.
            </Text>

            <ScrollView style={{ maxHeight: 440 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.modalSection}>Identity</Text>

              <View style={styles.modalGrid}>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Manufacturer</Text>
                  <TextInput
                    value={safeStr(applyDraft?.identity?.manufacturer)}
                    onChangeText={(t) =>
                      setApplyDraft((p) => ({
                        ...p,
                        identity: { ...(p.identity || {}), manufacturer: t },
                      }))
                    }
                    placeholder="e.g. LG"
                    style={styles.modalInput}
                  />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Model</Text>
                  <TextInput
                    value={safeStr(applyDraft?.identity?.model)}
                    onChangeText={(t) =>
                      setApplyDraft((p) => ({
                        ...p,
                        identity: { ...(p.identity || {}), model: t },
                      }))
                    }
                    placeholder="e.g. OLED65E8PUA"
                    style={styles.modalInput}
                  />
                </View>
              </View>

              <View style={styles.modalGrid}>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Serial #</Text>
                  <TextInput
                    value={safeStr(applyDraft?.identity?.serial_number)}
                    onChangeText={(t) =>
                      setApplyDraft((p) => ({
                        ...p,
                        identity: { ...(p.identity || {}), serial_number: t },
                      }))
                    }
                    placeholder="e.g. 804RMSS..."
                    style={styles.modalInput}
                  />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Year</Text>
                  <TextInput
                    value={applyDraft?.identity?.year != null ? String(applyDraft.identity.year) : ""}
                    onChangeText={(t) =>
                      setApplyDraft((p) => ({
                        ...p,
                        identity: { ...(p.identity || {}), year: t },
                      }))
                    }
                    placeholder="e.g. 2018"
                    keyboardType="numeric"
                    style={styles.modalInput}
                  />
                </View>
              </View>

              <View style={styles.modalGrid}>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Installed on</Text>
                  <TextInput
                    value={safeStr(applyDraft?.identity?.installed_on)}
                    onChangeText={(t) =>
                      setApplyDraft((p) => ({
                        ...p,
                        identity: { ...(p.identity || {}), installed_on: t },
                      }))
                    }
                    placeholder="YYYY-MM or YYYY-MM-DD"
                    style={styles.modalInput}
                  />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Location</Text>
                  <TextInput
                    value={safeStr(applyDraft?.identity?.location)}
                    onChangeText={(t) =>
                      setApplyDraft((p) => ({
                        ...p,
                        identity: { ...(p.identity || {}), location: t },
                      }))
                    }
                    placeholder="Living room"
                    style={styles.modalInput}
                  />
                </View>
              </View>

              <Text style={[styles.modalSection, { marginTop: 14 }]}>Warranty</Text>

              <View style={styles.modalGrid}>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Provider</Text>
                  <TextInput
                    value={safeStr(applyDraft?.warranty?.provider)}
                    onChangeText={(t) =>
                      setApplyDraft((p) => ({
                        ...p,
                        warranty: { ...(p.warranty || {}), provider: t },
                      }))
                    }
                    placeholder="Manufacturer / 3rd party"
                    style={styles.modalInput}
                  />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Policy #</Text>
                  <TextInput
                    value={safeStr(applyDraft?.warranty?.policy_number)}
                    onChangeText={(t) =>
                      setApplyDraft((p) => ({
                        ...p,
                        warranty: { ...(p.warranty || {}), policy_number: t },
                      }))
                    }
                    placeholder="Optional"
                    style={styles.modalInput}
                  />
                </View>
              </View>

              <View style={styles.modalGrid}>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Starts</Text>
                  <TextInput
                    value={safeStr(applyDraft?.warranty?.starts_on)}
                    onChangeText={(t) =>
                      setApplyDraft((p) => ({
                        ...p,
                        warranty: { ...(p.warranty || {}), starts_on: t },
                      }))
                    }
                    placeholder="YYYY-MM or YYYY-MM-DD"
                    style={styles.modalInput}
                  />
                </View>
                <View style={styles.modalField}>
                  <Text style={styles.modalLabel}>Expires</Text>
                  <TextInput
                    value={safeStr(applyDraft?.warranty?.expires_on)}
                    onChangeText={(t) =>
                      setApplyDraft((p) => ({
                        ...p,
                        warranty: { ...(p.warranty || {}), expires_on: t },
                      }))
                    }
                    placeholder="YYYY-MM or YYYY-MM-DD"
                    style={styles.modalInput}
                  />
                </View>
              </View>

              {!!applyError && <Text style={[styles.errorInline, { marginTop: 10 }]}>{applyError}</Text>}
              <View style={{ height: 10 }} />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnSecondary, applyBusy && { opacity: 0.6 }]}
                onPress={() => setApplyOpen(false)}
                disabled={applyBusy}
              >
                <Text style={styles.btnTextSecondary}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary, applyBusy && { opacity: 0.6 }]}
                onPress={applyUpdates}
                disabled={applyBusy}
              >
                {applyBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="checkmark" size={16} color="#fff" />
                )}
                <Text style={styles.btnTextPrimary}>{applyBusy ? "Applying…" : "Apply updates"}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <View style={styles.grid}>
        {/* LEFT: Evidence + Source Text */}
        <View style={styles.leftCol}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Evidence</Text>
              <View style={styles.cardHeaderRight}>
                {canPreview ? (
                  <TouchableOpacity style={styles.smallBtn} onPress={openPreview}>
                    <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
                    <Text style={styles.smallBtnText}>Open</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            <View style={styles.preview}>
              {loading ? (
                <ActivityIndicator />
              ) : !canPreview ? (
                <View style={styles.previewEmpty}>
                  <Ionicons name="document-outline" size={28} color={colors.textSecondary} />
                  <Text style={styles.muted}>No preview available</Text>
                </View>
              ) : isImg ? (
                <Image source={{ uri: previewUrl }} style={styles.previewImg} resizeMode="contain" />
              ) : (
                <View style={styles.previewEmpty}>
                  <Ionicons name="document-text-outline" size={28} color={colors.textSecondary} />
                  <Text style={styles.muted}>
                    {isPdf ? "PDF loaded. Use Open to view, or Extract on web." : "Preview not supported here."}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.metaLine}>
              <Text style={styles.metaText}>
                ocr_status: {safeStr(attachment?.ocr_status) || "—"} • text_source:{" "}
                {safeStr(attachment?.text_source) || "—"} • doc_type: {safeStr(attachment?.doc_type) || "—"}
              </Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Source text</Text>
            <Text style={styles.cardHint}>
              Keepr stores this extracted text on this attachment so KI can propose updates without you re‑pasting it.
            </Text>

            <TextInput
              value={sourceText}
              onChangeText={setSourceText}
              multiline
              placeholder="Paste extracted text here…"
              style={styles.textArea}
            />

            <View style={styles.savedMeta}>
              <Text style={styles.savedMetaText}>
                Saved on this attachment: {formatDateTime(attachment?.extracted_at) || "—"} • source: {safeStr(attachment?.text_source) || "—"} • chars: {String((safeStr(attachment?.extracted_text) || "").length)}
              </Text>
            </View>

            <View style={styles.row}>
              {IS_WEB ? (
                <TouchableOpacity
                  style={[styles.btn, styles.btnSecondary]}
                  onPress={extractPdfText}
                  disabled={savingText || !isPdf || !previewUrl}
                >
                  <Ionicons name="download-outline" size={16} color={colors.textPrimary} />
                  <Text style={styles.btnTextSecondary}>Extract PDF text</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity style={[styles.btn, styles.btnSecondary]} onPress={saveExtractedText} disabled={savingText}>
                {savingText ? (
                  <ActivityIndicator size="small" />
                ) : (
                  <Ionicons name="save-outline" size={16} color={colors.textPrimary} />
                )}
                <Text style={styles.btnTextSecondary}>Save</Text>
              </TouchableOpacity>

              <TouchableOpacity style={[styles.btn, styles.btnPrimary]} onPress={runKeeprIntelligence} disabled={kiBusy}>
                {kiBusy ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="flash-outline" size={16} color="#fff" />
                )}
                <Text style={styles.btnTextPrimary}>Run KI</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.applyHint}>
              {effectiveSystemId
                ? `Applies to: system enrichment fields (identity / warranty / value). If KI says “missing: target”, open KI from a System or Record.`
                : "Select a system to enable Apply."}
            </Text>

            {kiError ? <Text style={styles.errorInline}>{kiError}</Text> : null}
          </View>
        </View>

        {/* RIGHT: Output */}
        <View style={styles.rightCol}>
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <Text style={styles.cardTitle}>Output</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <TouchableOpacity
                  style={[styles.smallBtn, (!kiResult || !effectiveSystemId) && { opacity: 0.55 }]}
                  onPress={openApply}
                  disabled={!kiResult || !effectiveSystemId}
                >
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.smallBtnText}>Apply</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.smallBtn} onPress={copyJson} disabled={!kiResult}>
                  <Ionicons name="copy-outline" size={16} color={colors.textSecondary} />
                  <Text style={styles.smallBtnText}>Copy JSON</Text>
                </TouchableOpacity>
              </View>
            </View>

            {!kiResult ? (
              <Text style={styles.muted}>Run KI to generate structured insight and next actions.</Text>
            ) : (
              <ScrollView style={{ maxHeight: 520 }}>
                {prettyKV("Status", outputBlocks.metaRows)}

                {prettyKV("Intent", outputBlocks.intentRow)}

                {prettyKV("Applies to", outputBlocks.appliesRow)}

                {prettyKV("What Keepr found (verifiable)", outputBlocks.factsRows)}

                {prettyKV("Proposed changes", outputBlocks.proposedRows)}

                {prettyKV("Missing inputs", outputBlocks.missingRows)}

                <View style={{ height: 12 }} />

                <Text style={styles.kvTitle}>Raw (debug)</Text>
                <View style={styles.rawBox}>
                  <Text style={styles.rawText}>{JSON.stringify(kiResult, null, 2)}</Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
  },
  backText: { color: colors.textPrimary, fontWeight: "600" },
  headerTitles: { flex: 1 },
  h1: { fontSize: 18, fontWeight: "800", color: colors.textPrimary },
  h2: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },

  errorBox: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: "#ffe9e9",
  },
  errorText: { color: "#a10000" },
  errorInline: { color: "#a10000", marginTop: 8 },

  grid: { flex: 1, flexDirection: "row" },
  leftCol: { flex: 1, paddingHorizontal: spacing.lg, gap: spacing.md },
  rightCol: { flex: 1, paddingRight: spacing.lg },

  card: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e6e6ee",
    borderRadius: 16,
    padding: 16,
    marginBottom: spacing.md,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  cardHeaderRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  cardTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  cardHint: { color: colors.textSecondary, marginTop: 6, marginBottom: 10 },
  contextStrip: {
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  contextRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  contextTitle: { flex: 1, fontSize: 14, fontWeight: "700", color: colors.textPrimary },
  contextChips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 6 },
  contextChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    maxWidth: 320,
  },
  contextChipLabel: { fontSize: 11, color: colors.textSecondary, fontWeight: "700", textTransform: "lowercase" },
  contextChipValue: { fontSize: 11, color: colors.textPrimary, fontWeight: "700" },
  contextNote: { marginTop: 2, fontSize: 12, color: colors.textSecondary },
  savedMeta: { marginTop: -4, marginBottom: 10 },
  savedMetaText: { fontSize: 12, color: colors.textSecondary },
  applyHint: { marginTop: -6, marginBottom: 10, fontSize: 12, color: colors.textSecondary },

  smallBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e6e6ee",
    backgroundColor: colors.surface,
  },
  smallBtnText: { color: colors.textPrimary, fontWeight: "800", fontSize: 12 },

  preview: {
    height: 260,
    borderRadius: 12,
    backgroundColor: "#f6f6f8",
    borderWidth: 1,
    borderColor: "#ededf3",
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
  },
  previewEmpty: { alignItems: "center", gap: 10 },
  previewImg: { width: "100%", height: "100%" },

  metaLine: { marginTop: 10 },
  metaText: { color: colors.textSecondary, fontSize: 12 },

  textArea: {
    minHeight: 220,
    borderWidth: 1,
    borderColor: "#e6e6ee",
    borderRadius: 12,
    padding: 12,
    color: colors.textPrimary,
    textAlignVertical: "top",
    backgroundColor: "#fff",
  },

  row: { flexDirection: "row", gap: 10, marginTop: 12, flexWrap: "wrap" },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 12,
  },
  btnPrimary: { backgroundColor: colors.primary },
  btnSecondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: "#e6e6ee" },
  btnTextPrimary: { color: "#fff", fontWeight: "800" },
  btnTextSecondary: { color: colors.textPrimary, fontWeight: "800" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    padding: 16,
    justifyContent: "center",
  },
  modalCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: "#e6e6ee",
  },
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  modalTitle: { fontSize: 16, fontWeight: "900", color: colors.textPrimary },
  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#e6e6ee",
  },
  modalSub: { color: colors.textSecondary, marginBottom: 12 },
  modalSection: { fontWeight: "900", color: colors.textPrimary, marginBottom: 8 },
  modalGrid: { flexDirection: "row", gap: 10, flexWrap: "wrap" },
  modalField: { flex: 1, minWidth: 160, marginBottom: 10 },
  modalLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: "800", marginBottom: 6 },
  modalInput: {
    borderWidth: 1,
    borderColor: "#e6e6ee",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#fff",
    color: colors.textPrimary,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 12,
  },

  muted: { color: colors.textSecondary, marginTop: 6 },

  kvBox: {
    borderWidth: 1,
    borderColor: "#ececf2",
    backgroundColor: "#fbfbfd",
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  kvTitle: { fontWeight: "900", color: colors.textPrimary, marginBottom: 8 },
  kvRow: { flexDirection: "row", gap: 10, marginBottom: 6 },
  kvKey: { width: 130, color: colors.textSecondary, fontWeight: "800", fontSize: 12 },
  kvVal: { flex: 1, color: colors.textPrimary, fontSize: 12 },

  rawBox: {
    borderWidth: 1,
    borderColor: "#ececf2",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#fff",
  },
  rawText: { fontFamily: IS_WEB ? "monospace" : undefined, fontSize: 11, color: colors.textPrimary },
});