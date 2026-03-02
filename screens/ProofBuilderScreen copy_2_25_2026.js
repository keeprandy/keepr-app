// screens/ProofBuilderScreen.js
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { getSignedUrl } from "../lib/attachmentsApi";
import { supabase } from "../lib/supabaseClient";
import { colors, spacing, radius } from "../styles/theme";

const IS_WEB = Platform.OS === "web";
const PREVIEW_BUCKET_FALLBACK = "asset-files";

// UX gate
const MIN_RAW_CHARS = 120;

/**
 * Shared helpers, mirrored from EnhanceAttachmentModal for consistency
 * (safeStr, normalizeUrl, getExt, isImageLike, isPdfLike, inferName, shortId)
 */

function safeStr(v) {
  return typeof v === "string" ? v : "";
}

function normalizeUrl(raw) {
  const s = safeStr(raw).trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function getExt(name = "") {
  const base = (name || "").split("?")[0].split("#")[0];
  const parts = base.split(".");
  if (parts.length <= 1) return "";
  return (parts.pop() || "").toLowerCase();
}

function isImageLike(att) {
  if (!att) return false;
  const mime = safeStr(att.mime_type || "").toLowerCase();
  const ext = getExt(att.file_name || att.name || "");
  if (mime.startsWith("image/")) return true;
  const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "heic", "heif"];
  return IMAGE_EXTS.includes(ext);
}

function isPdfLike(att) {
  if (!att) return false;
  const mime = safeStr(att.mime_type || "").toLowerCase();
  const ext = getExt(att.file_name || att.name || "");
  return mime === "application/pdf" || ext === "pdf";
}

function inferName(att) {
  return (
    safeStr(att?.title) ||
    safeStr(att?.file_name) ||
    safeStr(att?.name) ||
    safeStr(att?.url) ||
    "Attachment"
  );
}

function shortId(id) {
  const s = safeStr(id);
  if (!s) return "—";
  if (s.length <= 12) return s;
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

function pickFirstDateMaybe(row) {
  if (!row || typeof row !== "object") return null;
  // Best-effort across likely schema variants
  const candidates = [
    row.acquired_at,
    row.acquisition_date,
    row.purchased_at,
    row.purchase_date,
    row.bought_at,
    row.created_at,
  ];
  const found = candidates.find((d) => typeof d === "string" && d.trim());
  return found ? found.slice(0, 10) : null;
}

function toISODateMaybe(s) {
  const v = safeStr(s).trim();
  if (!v) return null;
  // Accept YYYY-MM-DD directly
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  // Try parse
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

// Simple “copy” helper: works on web; native falls back to showing in an alert.
async function copyTextBestEffort(text) {
  const t = safeStr(text);
  if (!t) return false;

  if (IS_WEB && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(t);
      return true;
    } catch {
      return false;
    }
  }

  // Native fallback: show text (user can select/copy depending on platform)
  Alert.alert("Copy", t.slice(0, 1200) + (t.length > 1200 ? "…" : ""));
  return true;
}

/**
 * Proof Builder V1 Screen
 *
 * route.params:
 * - assetId?: string
 * - attachmentId: string
 * - runId?: string        (optional enrich run)
 * - counts?: object       (optional enrich summary)
 * - rawText?: string      (optional initial extracted text)
 * - proof_mode?: "attach" | "create"
 */
export default function ProofBuilderScreen({ route, navigation }) {
  const { width } = useWindowDimensions();
  const isWide = width >= 980;

  const assetIdFromRoute = route?.params?.assetId || null;
  const attachmentIdFromRoute = route?.params?.attachmentId || null;
  const initialRunId = route?.params?.runId || null;
  const initialCounts = route?.params?.counts || null;
  const initialRawText = route?.params?.rawText || "";

  const [loading, setLoading] = useState(true);
  const [attachment, setAttachment] = useState(null);
  const [loadError, setLoadError] = useState("");

  const [pdfUrl, setPdfUrl] = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);

  const [rawText, setRawText] = useState(initialRawText);
  const rawTextRef = useRef(null);

  const [detectedType, setDetectedType] = useState(initialCounts?.detected || "");
  const [summaryCounts, setSummaryCounts] = useState(initialCounts || null);

  // One “primary proposal” as an array for UI consistency
  const [proposals, setProposals] = useState([]);

  // extracted facts/policy for display + ai_metadata
  const [extractedFacts, setExtractedFacts] = useState(null);
  const [edgePolicy, setEdgePolicy] = useState(null);

  const [busyGenerate, setBusyGenerate] = useState(false);
  const [busyCommit, setBusyCommit] = useState(false);
  const [commitError, setCommitError] = useState("");

  // --- KI (Keepr Intelligence) ---
  const [kiBusy, setKiBusy] = useState(false);
  const [kiError, setKiError] = useState("");
  const [kiResult, setKiResult] = useState(null);

  const MODE_CREATE = "create";
  const MODE_ATTACH = "attach";
  const [mode, setMode] = useState(
    route?.params?.proof_mode === "attach" ? MODE_ATTACH : MODE_CREATE
  );

  const [existingRecordId, setExistingRecordId] = useState(null);
  const [serviceRecords, setServiceRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [showRecordPicker, setShowRecordPicker] = useState(false);

  // Best-effort acquisition date (optional)
  const [assetAcquiredAt, setAssetAcquiredAt] = useState(null);

  const name = useMemo(() => inferName(attachment), [attachment]);

  // Derived meta (THE ONLY ONES WE USE)
  const effectiveAssetId = assetIdFromRoute || attachment?.asset_id || null;
  const effectiveAttachmentId = attachmentIdFromRoute || attachment?.id || null;

  const canGenerate = useMemo(() => {
    return rawText.trim().length >= MIN_RAW_CHARS && !busyGenerate;
  }, [rawText, busyGenerate]);

  const canRunKI = useMemo(() => {
    return rawText.trim().length >= MIN_RAW_CHARS && !kiBusy;
  }, [rawText, kiBusy]);

  // Autofocus raw text once screen is ready (web + native)
  useEffect(() => {
    if (loading) return;
    const t = setTimeout(() => {
      try {
        rawTextRef.current?.focus?.();
      } catch {}
    }, 0);
    return () => clearTimeout(t);
  }, [loading]);

  // Best-effort load asset acquisition date (do not fail screen if schema differs)
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!effectiveAssetId) {
        setAssetAcquiredAt(null);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("assets")
          .select("acquired_at,acquisition_date,purchased_at,purchase_date,bought_at,created_at")
          .eq("id", effectiveAssetId)
          .maybeSingle();

        if (error) throw error;

        if (!cancelled) {
          const v = pickFirstDateMaybe(data);
          setAssetAcquiredAt(v || null);
        }
      } catch {
        if (!cancelled) setAssetAcquiredAt(null);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [effectiveAssetId]);

  const ensureAttachmentPlacement = useCallback(
    async ({ attachmentId, targetType, targetId, role, label }) => {
      if (!attachmentId || !targetType || !targetId) {
        return { ok: false, error: "Missing placement inputs." };
      }

      try {
        let q = supabase
          .from("attachment_placements")
          .select("id")
          .eq("attachment_id", attachmentId)
          .eq("target_type", targetType)
          .eq("target_id", targetId);

        if (role == null) q = q.is("role", null);
        else q = q.eq("role", role);

        const { data: existing, error: selErr } = await q.maybeSingle();
        if (selErr) return { ok: false, error: selErr.message || String(selErr) };
        if (existing?.id) return { ok: true, id: existing.id, created: false };

        const payload = {
          attachment_id: attachmentId,
          target_type: targetType,
          target_id: targetId,
          role: role ?? null,
          label: label ?? null,
        };

        const { data: created, error: insErr } = await supabase
          .from("attachment_placements")
          .insert(payload)
          .select("id")
          .single();

        if (insErr) return { ok: false, error: insErr.message || String(insErr) };
        return { ok: true, id: created?.id || null, created: true };
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    },
    []
  );

  const loadServiceRecords = useCallback(async () => {
    if (!effectiveAssetId) return;

    setLoadingRecords(true);
    setRecordsError("");

    try {
      const { data, error } = await supabase
        .from("service_records")
        .select("id,title,performed_at,created_at,category,cost")
        .eq("asset_id", effectiveAssetId)
        .order("performed_at", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(75);

      if (error) {
        setRecordsError(error.message || "Failed to load records.");
        setServiceRecords([]);
        return;
      }

      setServiceRecords(data || []);
      if (!existingRecordId && data?.[0]?.id) setExistingRecordId(data[0].id);
    } catch (e) {
      setRecordsError(e?.message || "Failed to load records.");
      setServiceRecords([]);
    } finally {
      setLoadingRecords(false);
    }
  }, [effectiveAssetId, existingRecordId]);

  useEffect(() => {
    if (mode !== MODE_ATTACH) return;
    loadServiceRecords();
  }, [mode, loadServiceRecords]);

  // Load attachment by id
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!attachmentIdFromRoute) {
        setLoading(false);
        setLoadError("Missing attachment id.");
        return;
      }

      setLoading(true);
      setLoadError("");

      try {
        const { data, error } = await supabase
          .from("attachments")
          .select("*")
          .eq("id", attachmentIdFromRoute)
          .single();

        if (error) throw error;
        if (!cancelled) setAttachment(data || null);
      } catch (e) {
        if (!cancelled) {
          console.log("ProofBuilder load attachment failed", e?.message || e);
          setLoadError(e?.message || "Could not load attachment.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [attachmentIdFromRoute]);

  // Image preview URL
  const imagePreviewUrl = useMemo(() => {
    if (!attachment) return null;
    if (!isImageLike(attachment)) return null;

    if (attachment.storage_path) {
      try {
        const bucket = attachment.bucket || PREVIEW_BUCKET_FALLBACK;
        const { data } = supabase.storage.from(bucket).getPublicUrl(attachment.storage_path);
        return data?.publicUrl || null;
      } catch {
        return null;
      }
    }

    if (attachment.kind === "link" && attachment.url) return attachment.url;
    return null;
  }, [attachment]);

  // Signed URL for inline PDF preview on web
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!attachment || !isPdfLike(attachment) || !IS_WEB) {
        setPdfUrl(null);
        setPdfLoading(false);
        return;
      }
      if (!attachment.storage_path) {
        setPdfUrl(null);
        setPdfLoading(false);
        return;
      }

      setPdfLoading(true);
      try {
        const url = await getSignedUrl({
          bucket: attachment.bucket || PREVIEW_BUCKET_FALLBACK,
          path: attachment.storage_path,
          expiresIn: 60 * 30,
        });
        if (!cancelled) setPdfUrl(url || null);
      } catch (e) {
        if (!cancelled) {
          console.log("ProofBuilder PDF preview failed", e?.message || e);
          setPdfUrl(null);
        }
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [attachment]);

  const handleOpenAttachment = async () => {
    if (!attachment) return;

    try {
      if (attachment.kind === "link") {
        const raw = safeStr(attachment.url);
        if (!raw) return;
        const url = normalizeUrl(raw);
        const ok = await Linking.canOpenURL(url);
        if (!ok) throw new Error("Cannot open this URL on this device.");
        await Linking.openURL(url);
        return;
      }

      if (!attachment.storage_path) {
        Alert.alert("Open failed", "No file path available.");
        return;
      }

      const signed = await getSignedUrl({
        bucket: attachment.bucket || PREVIEW_BUCKET_FALLBACK,
        path: attachment.storage_path,
        expiresIn: 60 * 60,
      });

      if (!signed) {
        Alert.alert("Open failed", "Could not create a signed URL.");
        return;
      }

      const ok = await Linking.canOpenURL(signed);
      if (!ok) throw new Error("Cannot open this file on this device.");
      await Linking.openURL(signed);
    } catch (e) {
      Alert.alert("Open failed", e?.message || "Could not open attachment.");
    }
  };

  const getEditedFields = useCallback((p) => {
    const base = p?.__ai?.baseline || null;
    if (!base) return [];
    const fields = ["title", "notes", "date", "category", "odometer", "cost"];
    return fields.filter((f) => (p?.[f] ?? "") !== (base?.[f] ?? ""));
  }, []);

  const hasEdits = useCallback(
    (p) => {
      return getEditedFields(p).length > 0;
    },
    [getEditedFields]
  );

  /**
   * Edge-function generator (ONE primary record)
   * Keeps the existing “proposal edit” UI shape.
   */
  const generateProposals = async () => {
    const text = rawText.trim();

    if (text.length < MIN_RAW_CHARS) {
      Alert.alert(
        "Need more text",
        `Paste at least ${MIN_RAW_CHARS} characters to generate a reliable record.`
      );
      return;
    }

    if (!effectiveAssetId) {
      Alert.alert("Missing asset", "Cannot generate without an asset id.");
      return;
    }

    setBusyGenerate(true);
    setCommitError("");

    try {
      const { data, error } = await supabase.functions.invoke("proof-generate-proposal", {
        body: {
          asset_id: effectiveAssetId,
          attachment_id: effectiveAttachmentId || null,
          source_text: text,
        },
      });

      if (error) throw error;

      const primary = data?.primary_record || null;
      const facts = data?.extracted_facts || null;
      const policy = data?.policy || null;

      if (!primary) {
        Alert.alert("No record detected", "Try pasting a different section of text.");
        setProposals([]);
        setExtractedFacts(null);
        setEdgePolicy(null);
        return;
      }

      const baseline = {
        title: safeStr(primary.title) || "Service record",
        notes: safeStr(primary.summary) || safeStr(text),
        date: safeStr(primary.performed_at) || null,
        category: safeStr(primary.category) || "",
        odometer: primary.odometer != null ? String(primary.odometer) : "",
        cost: primary.cost != null ? String(primary.cost) : "",
      };

      const one = {
        id: `${Date.now()}-primary`,
        kind: safeStr(primary.service_type) || "service",
        title: baseline.title,
        notes: baseline.notes,
        date: baseline.date,
        category: baseline.category,
        location: safeStr(primary.location) || "",
        odometer: baseline.odometer,
        cost: baseline.cost,
        selected: true,
        __ai: {
          confidence: primary.confidence ?? null,
          system_hints: primary.system_hints || null,
          raw_primary_record: primary,
          baseline,
        },
      };

      const detected =
        safeStr(data?.detectedType) ||
        safeStr(primary.service_type) ||
        safeStr(primary.category) ||
        "AI";

      setDetectedType(detected);
      setSummaryCounts((prev) => ({
        ...(prev || {}),
        detected,
        proposed_timeline_items: 1,
      }));

      setProposals([one]);
      setExtractedFacts(facts);
      setEdgePolicy(policy);
    } catch (e) {
      console.log("ProofBuilder generate failed", e?.message || e);
      setCommitError(e?.message || "Could not generate a proposal.");
      setProposals([]);
      setExtractedFacts(null);
      setEdgePolicy(null);
    } finally {
      setBusyGenerate(false);
    }
  };

  /**
   * Keepr Intelligence (KI) — Advisory pass.
   * Non-destructive: does not replace Proof Builder proposals.
   */
  const runKeeprIntelligence = async () => {
    const text = rawText.trim();

    if (text.length < MIN_RAW_CHARS) {
      Alert.alert(
        "Need more text",
        `Paste at least ${MIN_RAW_CHARS} characters to run Keepr Intelligence.`
      );
      return;
    }

    if (!effectiveAssetId) {
      Alert.alert("Missing asset", "Cannot run Keepr Intelligence without an asset id.");
      return;
    }

    setKiBusy(true);
    setKiError("");
    // Keep kiResult visible until replaced, so UI doesn't flicker.

    try {
      const { data, error } = await supabase.functions.invoke("ki-invoke", {
        body: {
          asset_id: effectiveAssetId,
          attachment_id: effectiveAttachmentId || null,
          source_text: text,
        },
      });

      if (error) throw error;

      // Accept either already-parsed JSON or a JSON string
      let parsed = data;
      if (typeof data === "string") {
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = { raw: data };
        }
      }

      setKiResult(parsed || null);
    } catch (e) {
      console.log("KI invoke failed", e?.message || e);
      setKiError(e?.message || "Keepr Intelligence failed to run.");
      setKiResult(null);
    } finally {
      setKiBusy(false);
    }
  };

  const toggleProposalSelected = (id) => {
    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, selected: !p.selected } : p))
    );
  };

  const updateProposalField = (id, field, value) => {
    setProposals((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  };

  /**
   * Commit:
   * - A1: create a new service_record from the proposal fields
   * - A2: attach this attachment to an existing service_record
   */
  const commitProposals = async () => {
    if (busyCommit) return;

    setCommitError("");

    // Current primary proposal (your UI edits this object)
    const p = Array.isArray(proposals) ? proposals[0] : null;

    try {
      // A2: Attach current evidence to an existing record
      if (mode === MODE_ATTACH) {
        if (!effectiveAttachmentId) {
          Alert.alert("Missing attachment", "No attachment is selected.");
          return;
        }
        if (!existingRecordId) {
          Alert.alert("Pick a record", "Select the record you want to attach this proof to.");
          return;
        }

        setBusyCommit(true);

        const res = await ensureAttachmentPlacement({
          attachmentId: effectiveAttachmentId,
          targetType: "service_record",
          targetId: existingRecordId,
          role: "proof",
          label: "source",
        });

        if (!res.ok) {
          setCommitError(res.error || "Failed to attach proof.");
          return;
        }

        Alert.alert("Attached", "Proof attached to the selected record.");
        navigation?.goBack?.();
        return;
      }

      // A1: Create one new primary record from the proposal
      if (!effectiveAssetId) {
        Alert.alert("Missing asset", "No asset is selected.");
        return;
      }
      if (!p || !p.selected) {
        Alert.alert("Nothing to create", "Generate a proposal and keep it selected.");
        return;
      }

      setBusyCommit(true);

      // source_type must pass DB check: manual | document | photo | import | carfax
      const sourceType = effectiveAttachmentId ? "document" : "manual";

      const performedAtISO = toISODateMaybe(p.date);
      const acquiredAtISO = toISODateMaybe(assetAcquiredAt);

      const dedupeKey =
        effectiveAttachmentId && performedAtISO
          ? `${effectiveAttachmentId}|${performedAtISO}`
          : null;

      const recordScope =
        performedAtISO && acquiredAtISO && new Date(performedAtISO) < new Date(acquiredAtISO)
          ? "historical"
          : null;

      const editedFields = getEditedFields(p);

      const insertRow = {
        asset_id: effectiveAssetId,
        title: safeStr(p.title) || "Service record",
        notes: safeStr(p.notes) || null,
        service_type: safeStr(p.kind) || null,
        category: safeStr(p.category) || null,
        location: safeStr(p.location) || null,
        odometer: p.odometer ? Number(p.odometer) : null,
        cost: p.cost ? Number(p.cost) : null,
        source_type: sourceType,
        verification_status: "verified",

        // Store hardening + scope safely in metadata (avoid schema dependency)
        extra_metadata: {
          attachment_id: effectiveAttachmentId || null,
          proof_builder: {
            detected_type: detectedType || null,
            run_id: initialRunId || null,
            summary_counts: summaryCounts || null,
            dedupe_key: dedupeKey,
            record_scope: recordScope,
            asset_acquired_at: acquiredAtISO || null,
          },
          system_hints: p?.__ai?.system_hints || null,
        },

        // Telemetry: quiet but powerful
        ai_metadata: {
          confidence: p?.__ai?.confidence ?? null,
          edited_fields: editedFields,
          accepted: true,
          extracted_facts: extractedFacts || null,
          policy: edgePolicy || null,
          primary_record: p?.__ai?.raw_primary_record || null,
          source_text: rawText || null,
          dedupe_key: dedupeKey,
          record_scope: recordScope,
          asset_acquired_at: acquiredAtISO || null,
        },
      };

      // performed_at is NOT NULL with DEFAULT; only include if user provided a date
      if (performedAtISO) insertRow.performed_at = performedAtISO;

      const { data: created, error: insErr } = await supabase
        .from("service_records")
        .insert(insertRow)
        .select("id")
        .single();

      if (insErr) {
        setCommitError(insErr.message || "Failed to create record.");
        return;
      }

      // Link the attachment as proof to the new record
      if (effectiveAttachmentId && created?.id) {
        const placementRes = await ensureAttachmentPlacement({
          attachmentId: effectiveAttachmentId,
          targetType: "service_record",
          targetId: created.id,
          role: "proof",
          label: "source",
        });

        if (!placementRes.ok) {
          // Record created; soft warn in logs only.
          console.log("ATTACHMENT_PLACEMENT_ERROR:", placementRes.error);
        }
      }

      Alert.alert("Created", "Record created.");
      navigation?.goBack?.();
    } catch (e) {
      setCommitError(e?.message || "Failed to create record.");
    } finally {
      setBusyCommit(false);
    }
  };

  const placementSummary = () => {
    if (!attachment) return "Not attached";
    const t = attachment.target_type;
    const id = attachment.target_id;
    if (!t) return "Asset (default)";
    if (t === "asset") return "Asset (default)";
    if (t === "system") return `System • ${shortId(id)}`;
    if (t === "service_record") return `Record • ${shortId(id)}`;
    if (t === "event") return `Event • ${shortId(id)}`;
    return `${t} • ${shortId(id)}`;
  };

  const roleSummary = () => {
    if (!attachment?.role) return "other";
    return attachment.role;
  };

  // --- Render ---

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.centerFill}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  const primary = Array.isArray(proposals) ? proposals[0] : null;
  const primarySelected = !!primary?.selected;

  const canCommit =
    mode === MODE_ATTACH
      ? !!effectiveAttachmentId && !!existingRecordId
      : !!effectiveAssetId && !!primary && primarySelected;

  return (
    <SafeAreaView style={styles.screen}>
      {/* Header Bar */}
      <View style={styles.headerBar}>
        <View style={styles.headerLeft}>
          {navigation && navigation.canGoBack?.() && (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.headerIconBtn}
            >
              <Ionicons name="chevron-back" size={18} color={colors.textPrimary} />
            </TouchableOpacity>
          )}
          <Ionicons name="sparkles" size={18} color={colors.brand || colors.primary} />
          <Text style={styles.headerTitle}>Proof Builder</Text>
        </View>

        <View style={styles.headerMetaRow}>
          {effectiveAssetId && (
            <View style={styles.chip}>
              <Text style={styles.chipLabel}>Asset</Text>
              <Text style={styles.chipValue} numberOfLines={1}>
                {shortId(effectiveAssetId)}
              </Text>
            </View>
          )}
          {effectiveAttachmentId && (
            <View style={styles.chip}>
              <Text style={styles.chipLabel}>Attachment</Text>
              <Text style={styles.chipValue} numberOfLines={1}>
                {shortId(effectiveAttachmentId)}
              </Text>
            </View>
          )}
          {!!detectedType && (
            <View style={styles.chip}>
              <Text style={styles.chipLabel}>Detected</Text>
              <Text style={styles.chipValue}>{detectedType}</Text>
            </View>
          )}
        </View>
      </View>

      {!!loadError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      )}

      <View style={[styles.main, isWide ? styles.mainRow : styles.mainColumn]}>
        {/* Left Pane: Evidence */}
        <View style={[styles.pane, isWide ? styles.paneLeft : styles.paneFull]}>
          <ScrollView
            contentContainerStyle={styles.paneScrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.sectionTitle}>Evidence</Text>

            {/* Attachment preview */}
            {attachment && (
              <View style={styles.previewSection}>
                {attachment.kind === "link" ? (
                  <View style={styles.previewRow}>
                    <View style={styles.previewIcon}>
                      <Ionicons name="link-outline" size={18} color={colors.textPrimary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewTitle} numberOfLines={1}>
                        {safeStr(attachment.title) || safeStr(attachment.url)}
                      </Text>
                      <Text style={styles.previewSub} numberOfLines={1}>
                        {safeStr(attachment.url)}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={handleOpenAttachment} style={styles.previewOpenBtn}>
                      <Ionicons name="open-outline" size={16} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                ) : isImageLike(attachment) && imagePreviewUrl ? (
                  <TouchableOpacity
                    onPress={handleOpenAttachment}
                    activeOpacity={0.9}
                    style={styles.previewImageOuter}
                  >
                    <Image source={{ uri: imagePreviewUrl }} style={styles.previewImage} resizeMode="contain" />
                  </TouchableOpacity>
                ) : isPdfLike(attachment) && IS_WEB ? (
                  <View>
                    <View style={styles.previewRow}>
                      <View style={styles.previewIcon}>
                        <Ionicons name="document-text-outline" size={18} color={colors.textPrimary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.previewTitle} numberOfLines={1}>
                          {safeStr(attachment.file_name) || name}
                        </Text>
                        <Text style={styles.previewSub} numberOfLines={1}>
                          PDF document
                        </Text>
                      </View>
                      <TouchableOpacity onPress={handleOpenAttachment} style={styles.previewOpenBtn}>
                        <Ionicons name="open-outline" size={16} color={colors.textPrimary} />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.pdfFrameWrapper}>
                      {pdfLoading ? (
                        <View style={styles.pdfLoading}>
                          <ActivityIndicator />
                        </View>
                      ) : pdfUrl ? (
                        <iframe title="Attachment preview" src={pdfUrl} style={styles.pdfFrame} />
                      ) : (
                        <Text style={styles.previewSub}>
                          Preview not available. Use “Open” to view the file.
                        </Text>
                      )}
                    </View>
                  </View>
                ) : (
                  <View style={styles.previewRow}>
                    <View style={styles.previewIcon}>
                      <Ionicons name="document-outline" size={18} color={colors.textPrimary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.previewTitle} numberOfLines={1}>
                        {safeStr(attachment.file_name) || name}
                      </Text>
                      <Text style={styles.previewSub} numberOfLines={1}>
                        File attachment
                      </Text>
                    </View>
                    <TouchableOpacity onPress={handleOpenAttachment} style={styles.previewOpenBtn}>
                      <Ionicons name="open-outline" size={16} color={colors.textPrimary} />
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* Associations quick view */}
            {attachment && (
              <View style={styles.metaCard}>
                <Text style={styles.metaLabel}>Attached to</Text>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {placementSummary()}
                </Text>

                <Text style={[styles.metaLabel, { marginTop: spacing.xs }]}>Role</Text>
                <Text style={styles.metaValue} numberOfLines={1}>
                  {roleSummary()}
                </Text>

                {!!assetAcquiredAt && (
                  <>
                    <Text style={[styles.metaLabel, { marginTop: spacing.xs }]}>Asset acquired</Text>
                    <Text style={styles.metaValue} numberOfLines={1}>
                      {assetAcquiredAt}
                    </Text>
                  </>
                )}
              </View>
            )}

            {/* Paste / Extract text area */}
            <View style={styles.metaCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitleSmall}>Paste or refine source text</Text>
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <View style={styles.pill}>
                    <Text style={styles.pillText}>{detectedType || "not detected"}</Text>
                  </View>
                </View>
              </View>

              <Text style={styles.metaHint}>
                Paste invoice, email, or notes here. Proof Builder turns this into one primary record you can review and
                commit.
              </Text>

              {rawText.trim().length < MIN_RAW_CHARS && (
                <Text style={styles.metaHint}>
                  Paste at least {MIN_RAW_CHARS} characters to enable Generate and KI.
                </Text>
              )}

              <TextInput
                ref={rawTextRef}
                value={rawText}
                onChangeText={(t) => {
                  setRawText(t);
                  // do not clear KI automatically; let user compare
                }}
                multiline
                textAlignVertical="top"
                placeholder="Paste text here…"
                placeholderTextColor={colors.textMuted}
                style={styles.rawTextInput}
              />

              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[
                    styles.actionBtn,
                    (!canGenerate || busyGenerate) && { opacity: 0.55 },
                  ]}
                  onPress={generateProposals}
                  disabled={!canGenerate}
                >
                  {busyGenerate ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <>
                      <Ionicons name="sparkles-outline" size={16} color={colors.textPrimary} />
                      <Text style={styles.actionBtnText}>Generate record</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.kiBtn,
                    (!canRunKI || kiBusy) && { opacity: 0.55 },
                  ]}
                  onPress={runKeeprIntelligence}
                  disabled={!canRunKI}
                >
                  {kiBusy ? (
                    <ActivityIndicator size="small" />
                  ) : (
                    <>
                      <Ionicons name="flash-outline" size={16} color={colors.textPrimary} />
                      <Text style={styles.actionBtnText}>Engage KI</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {!!summaryCounts && (
                <View style={styles.summaryRow}>
                  <Text style={styles.summaryText}>
                    Proposed items: {summaryCounts.proposed_timeline_items ?? "—"}
                  </Text>
                </View>
              )}

              {!!kiError && <Text style={[styles.errorText, { marginTop: spacing.sm }]}>{kiError}</Text>}
            </View>
          </ScrollView>
        </View>

        {/* Right Pane: Proposals + KI Insights */}
        <View style={[styles.pane, isWide ? styles.paneRight : styles.paneFull]}>
          <ScrollView contentContainerStyle={styles.paneScrollContent} keyboardShouldPersistTaps="handled">
            {/* KI Insights (non-destructive) */}
            <View style={styles.kiCard}>
              <View style={styles.sectionHeaderRow}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="flash" size={16} color={colors.brand || colors.primary} />
                  <Text style={styles.sectionTitle} numberOfLines={1}>
                    Keepr Intelligence
                  </Text>
                </View>

                <TouchableOpacity
                  onPress={() => copyTextBestEffort(JSON.stringify(kiResult || {}, null, 2))}
                  style={styles.kiCopyBtn}
                  disabled={!kiResult}
                >
                  <Ionicons name="copy-outline" size={16} color={colors.textPrimary} />
                  <Text style={styles.kiCopyText}>Copy JSON</Text>
                </TouchableOpacity>
              </View>

              {!kiResult ? (
                <Text style={styles.emptyText}>
                  Run “Engage KI” to get advisory guidance from this document. It won’t create records automatically.
                </Text>
              ) : (
                <>
                  {/* Support both the expected shape and a raw fallback */}
                  {kiResult?.summary ? (
                    <>
                      <Text style={styles.kiLabel}>What this is</Text>
                      <Text style={styles.kiValue}>{safeStr(kiResult.summary.what) || "—"}</Text>

                      <Text style={[styles.kiLabel, { marginTop: spacing.sm }]}>Why it matters</Text>
                      <Text style={styles.kiValue}>{safeStr(kiResult.summary.why) || "—"}</Text>
                    </>
                  ) : kiResult?.raw ? (
                    <Text style={styles.kiValue}>{safeStr(kiResult.raw)}</Text>
                  ) : (
                    <Text style={styles.kiValue}>{JSON.stringify(kiResult)}</Text>
                  )}

                  <Text style={[styles.kiLabel, { marginTop: spacing.md }]}>Conditions</Text>
                  {Array.isArray(kiResult?.conditions) && kiResult.conditions.length ? (
                    kiResult.conditions.map((c, idx) => (
                      <Text key={`cond-${idx}`} style={styles.kiBullet}>
                        • {safeStr(c?.text) || "—"}{" "}
                        <Text style={styles.kiConfidence}>
                          ({safeStr(c?.confidence) || "medium"})
                        </Text>
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.kiValue}>—</Text>
                  )}

                  <Text style={[styles.kiLabel, { marginTop: spacing.md }]}>Proposals</Text>
                  {Array.isArray(kiResult?.proposals) && kiResult.proposals.length ? (
                    kiResult.proposals.map((p, idx) => (
                      <View key={`prop-${idx}`} style={styles.kiProposal}>
                        <Text style={styles.kiProposalTitle}>
                          {safeStr(p?.title) || safeStr(p?.type) || "Proposal"}
                        </Text>
                        <Text style={styles.kiValue}>{safeStr(p?.description) || "—"}</Text>
                        <TouchableOpacity
                          onPress={() => copyTextBestEffort(safeStr(p?.description) || safeStr(p?.title))}
                          style={styles.kiUseBtn}
                        >
                          <Ionicons name="clipboard-outline" size={16} color={colors.textPrimary} />
                          <Text style={styles.kiUseText}>Copy proposal</Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.kiValue}>—</Text>
                  )}
                </>
              )}
            </View>

            {/* Existing Proposed Entry UI */}
            <View style={styles.sectionHeaderRow}>
              <Text style={styles.sectionTitle}>Proposed entry</Text>
              <Text style={styles.sectionCounter}>
                {proposals.length} item{proposals.length === 1 ? "" : "s"}
              </Text>
            </View>

            <View style={styles.modeRow}>
              <TouchableOpacity
                style={[styles.modeBtn, mode === MODE_CREATE ? styles.modeBtnActive : null]}
                onPress={() => setMode(MODE_CREATE)}
              >
                <Text style={[styles.modeBtnText, mode === MODE_CREATE ? styles.modeBtnTextActive : null]}>
                  A1 • Create new
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.modeBtn, mode === MODE_ATTACH ? styles.modeBtnActive : null]}
                onPress={() => setMode(MODE_ATTACH)}
              >
                <Text style={[styles.modeBtnText, mode === MODE_ATTACH ? styles.modeBtnTextActive : null]}>
                  A2 • Attach to existing
                </Text>
              </TouchableOpacity>
            </View>

            {mode === MODE_ATTACH ? (
              <View style={styles.attachBox}>
                <Text style={styles.attachTitle}>Attach to an existing record</Text>
                {loadingRecords ? (
                  <Text style={styles.attachMeta}>Loading records…</Text>
                ) : recordsError ? (
                  <Text style={styles.attachMeta}>{recordsError}</Text>
                ) : serviceRecords.length === 0 ? (
                  <Text style={styles.attachMeta}>
                    No records found for this asset yet. Switch to A1 to create the first one.
                  </Text>
                ) : (
                  <>
                    <TouchableOpacity style={styles.recordPickerBtn} onPress={() => setShowRecordPicker(true)}>
                      <Ionicons name="list-outline" size={18} color={colors.textPrimary} />
                      <Text style={styles.recordPickerBtnText}>
                        {serviceRecords.find((r) => r.id === existingRecordId)?.title || "Choose a record"}
                      </Text>
                      <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
                    </TouchableOpacity>

                    <Text style={styles.attachHint}>
                      This will link the current attachment as proof (no new record created).
                    </Text>
                  </>
                )}
              </View>
            ) : null}

            {proposals.length === 0 ? (
              <Text style={styles.emptyText}>No proposal yet. Paste text and tap “Generate record”.</Text>
            ) : (
              proposals.map((p) => (
                <View key={p.id} style={styles.proposalCard}>
                  <View style={styles.proposalTopRow}>
                    <View style={styles.proposalHeaderRow}>
                      <TouchableOpacity style={styles.checkCircle} onPress={() => toggleProposalSelected(p.id)}>
                        <Ionicons
                          name={p.selected ? "checkmark-circle" : "ellipse-outline"}
                          size={20}
                          color={p.selected ? colors.brand || colors.primary : colors.textMuted}
                        />
                      </TouchableOpacity>

                      <TextInput
                        value={p.title}
                        onChangeText={(v) => updateProposalField(p.id, "title", v)}
                        placeholder="Title"
                        placeholderTextColor={colors.textMuted}
                        style={styles.proposalTitleInput}
                      />
                    </View>

                    {hasEdits(p) && (
                      <View style={styles.editedPill}>
                        <Ionicons name="pencil" size={12} color={colors.textPrimary} />
                        <Text style={styles.editedPillText}>Edited</Text>
                      </View>
                    )}
                  </View>

                  <TextInput
                    value={p.notes}
                    onChangeText={(v) => updateProposalField(p.id, "notes", v)}
                    placeholder="Notes / summary"
                    placeholderTextColor={colors.textMuted}
                    multiline
                    textAlignVertical="top"
                    style={styles.proposalNotesInput}
                  />

                  <View style={styles.proposalRow}>
                    <View style={styles.proposalField}>
                      <View style={styles.fieldLabelRow}>
                        <Text style={styles.fieldLabel}>Date</Text>
                        {!!p?.__ai?.baseline && getEditedFields(p).includes("date") && (
                          <Text style={styles.fieldEditedDot}>•</Text>
                        )}
                      </View>
                      <TextInput
                        value={p.date || ""}
                        onChangeText={(v) => updateProposalField(p.id, "date", v)}
                        placeholder="YYYY-MM-DD"
                        placeholderTextColor={colors.textMuted}
                        style={styles.fieldInput}
                      />
                    </View>

                    <View style={styles.proposalField}>
                      <View style={styles.fieldLabelRow}>
                        <Text style={styles.fieldLabel}>Category</Text>
                        {!!p?.__ai?.baseline && getEditedFields(p).includes("category") && (
                          <Text style={styles.fieldEditedDot}>•</Text>
                        )}
                      </View>
                      <TextInput
                        value={p.category}
                        onChangeText={(v) => updateProposalField(p.id, "category", v)}
                        placeholder="maintenance, ownership…"
                        placeholderTextColor={colors.textMuted}
                        style={styles.fieldInput}
                      />
                    </View>
                  </View>

                  <View style={styles.proposalRow}>
                    <View style={styles.proposalField}>
                      <View style={styles.fieldLabelRow}>
                        <Text style={styles.fieldLabel}>Odometer</Text>
                        {!!p?.__ai?.baseline && getEditedFields(p).includes("odometer") && (
                          <Text style={styles.fieldEditedDot}>•</Text>
                        )}
                      </View>
                      <TextInput
                        value={p.odometer?.toString() || ""}
                        onChangeText={(v) => updateProposalField(p.id, "odometer", v)}
                        placeholder="e.g. 45210"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="numeric"
                        style={styles.fieldInput}
                      />
                    </View>

                    <View style={styles.proposalField}>
                      <View style={styles.fieldLabelRow}>
                        <Text style={styles.fieldLabel}>Cost</Text>
                        {!!p?.__ai?.baseline && getEditedFields(p).includes("cost") && (
                          <Text style={styles.fieldEditedDot}>•</Text>
                        )}
                      </View>
                      <TextInput
                        value={p.cost?.toString() || ""}
                        onChangeText={(v) => updateProposalField(p.id, "cost", v)}
                        placeholder="e.g. 325.00"
                        placeholderTextColor={colors.textMuted}
                        keyboardType="numeric"
                        style={styles.fieldInput}
                      />
                    </View>
                  </View>

                  {!!p?.__ai?.confidence && (
                    <View style={{ marginTop: spacing.sm }}>
                      <Text style={styles.summaryText}>Confidence: {Math.round(p.__ai.confidence * 100)}%</Text>
                    </View>
                  )}
                </View>
              ))
            )}

            {!!extractedFacts && (
              <View style={[styles.metaCard, { marginTop: spacing.lg }]}>
                <Text style={styles.sectionTitleSmall}>Extracted facts</Text>
                {Object.entries(extractedFacts).map(([k, v]) => {
                  if (
                    v == null ||
                    v === "" ||
                    (typeof v === "object" && v && !Object.keys(v).length)
                  ) {
                    return null;
                  }
                  return (
                    <View key={k} style={{ marginTop: 6 }}>
                      <Text style={styles.metaLabel}>{k}</Text>
                      <Text style={styles.metaValue}>
                        {typeof v === "object" ? JSON.stringify(v) : String(v)}
                      </Text>
                    </View>
                  );
                })}
              </View>
            )}

            {!!commitError && <Text style={styles.errorText}>{commitError}</Text>}
          </ScrollView>

          {/* Commit bar */}
          <View style={styles.footerBar}>
            <Text style={styles.footerSummary}>{proposals.filter((p) => p.selected).length} selected</Text>
            <TouchableOpacity
              onPress={commitProposals}
              style={[styles.commitBtn, (busyCommit || !canCommit) && { opacity: 0.7 }]}
              disabled={busyCommit || !canCommit}
            >
              {busyCommit ? (
                <ActivityIndicator size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={16} color={colors.textPrimary} />
                  <Text style={styles.commitBtnText}>
                    {mode === MODE_ATTACH ? "Attach proof" : "Create record"}
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* A2 Record Picker */}
      <Modal
        visible={showRecordPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowRecordPicker(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setShowRecordPicker(false)}>
          <Pressable style={styles.pickerCard} onPress={() => {}}>
            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Select a record</Text>
              <TouchableOpacity
                onPress={() => setShowRecordPicker(false)}
                style={styles.pickerClose}
              >
                <Ionicons name="close" size={18} color={colors.textPrimary} />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ maxHeight: 420 }}>
              {serviceRecords.map((r) => {
                const isActive = r.id === existingRecordId;
                const date = r.performed_at || r.created_at?.slice(0, 10) || "";
                const cost =
                  r.cost != null && !Number.isNaN(Number(r.cost))
                    ? `$${Number(r.cost).toFixed(2)}`
                    : "";
                return (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.pickerRow, isActive ? styles.pickerRowActive : null]}
                    onPress={() => {
                      setExistingRecordId(r.id);
                      setShowRecordPicker(false);
                    }}
                  >
                    <View style={{ flex: 1 }}>
                      <Text
                        style={[styles.pickerRowTitle, isActive ? styles.pickerRowTitleActive : null]}
                        numberOfLines={1}
                      >
                        {r.title || "Untitled record"}
                      </Text>
                      <Text style={styles.pickerRowMeta} numberOfLines={1}>
                        {date}
                        {cost ? ` • ${cost}` : ""}
                      </Text>
                    </View>
                    {isActive ? (
                      <Ionicons name="checkmark-circle" size={18} color={colors.primary || "#2563EB"} />
                    ) : (
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerFill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.surface,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerIconBtn: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: "#F3F4F680",
  },
  headerTitle: {
    marginLeft: spacing.xs,
    fontSize: 16,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  headerMetaRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  chip: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.background,
  },
  chipLabel: {
    fontSize: 9,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  chipValue: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textPrimary,
  },

  errorBanner: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: "#FEE2E2",
    borderBottomWidth: 1,
    borderColor: "#FCA5A5",
  },
  errorText: {
    color: "#991B1B",
    fontSize: 12,
  },

  main: {
    flex: 1,
  },
  mainRow: {
    flexDirection: "row",
  },
  mainColumn: {
    flexDirection: "column",
  },

  pane: {
    flex: 1,
    borderColor: "#11182722",
  },
  paneLeft: {
    borderRightWidth: 1,
  },
  paneRight: {
    borderLeftWidth: 1,
  },
  paneFull: {
    borderTopWidth: 1,
  },
  paneScrollContent: {
    padding: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },

  sectionTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  sectionTitleSmall: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  sectionCounter: {
    fontSize: 12,
    color: colors.textMuted,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },

  previewSection: {
    marginBottom: spacing.lg,
    padding: spacing.sm,
    borderRadius: radius.lg || 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  previewRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  previewIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: colors.surfaceSubtle || colors.background,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
  },
  previewTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  previewSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
  },
  previewOpenBtn: {
    marginLeft: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle || colors.background,
    alignItems: "center",
    justifyContent: "center",
  },
  previewImageOuter: {
    borderRadius: radius.lg || 14,
    overflow: "hidden",
    backgroundColor: colors.surfaceSubtle || colors.background,
  },
  previewImage: {
    width: "100%",
    height: 200,
  },

  pdfFrameWrapper: {
    marginTop: spacing.sm,
    borderRadius: radius.md || 12,
    overflow: "hidden",
    backgroundColor: colors.background,
    minHeight: 160,
  },
  pdfFrame: {
    width: "100%",
    height: 220,
    borderWidth: 0,
  },
  pdfLoading: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.md,
  },

  metaCard: {
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg || 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  metaLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  metaValue: {
    fontSize: 13,
    color: colors.textPrimary,
    marginTop: 2,
  },
  metaHint: {
    fontSize: 11,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },

  rawTextInput: {
    minHeight: 140,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: radius.md || 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.background,
    marginTop: spacing.sm,
  },

  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.sm,
  },

  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md || 12,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.surface,
  },
  kiBtn: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md || 12,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: "#11182710",
  },
  actionBtnText: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  summaryRow: {
    marginTop: spacing.sm,
  },
  summaryText: {
    fontSize: 12,
    color: colors.textPrimary,
  },

  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  pillText: {
    fontSize: 11,
    color: colors.textPrimary,
    fontWeight: "700",
  },

  emptyText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.md,
  },

  // KI styles
  kiCard: {
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg || 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  kiCopyBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.background,
  },
  kiCopyText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  kiLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  kiValue: {
    marginTop: 2,
    fontSize: 13,
    color: colors.textPrimary,
  },
  kiBullet: {
    marginTop: 6,
    fontSize: 13,
    color: colors.textPrimary,
  },
  kiConfidence: {
    fontSize: 12,
    color: colors.textMuted,
  },
  kiProposal: {
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md || 12,
    borderWidth: 1,
    borderColor: "#11182714",
    backgroundColor: "#11182708",
  },
  kiProposalTitle: {
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  kiUseBtn: {
    marginTop: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.surface,
  },
  kiUseText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  proposalCard: {
    marginTop: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg || 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  proposalTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  proposalHeaderRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },
  checkCircle: {
    marginRight: spacing.sm,
  },
  proposalTitleInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: radius.md || 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 13,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },
  editedPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: "#11182710",
  },
  editedPillText: {
    fontSize: 11,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  proposalNotesInput: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: radius.md || 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    fontSize: 13,
    color: colors.textPrimary,
    minHeight: 70,
    backgroundColor: colors.background,
  },
  proposalRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },
  proposalField: {
    flex: 1,
    marginRight: spacing.sm,
  },
  fieldLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 2,
  },
  fieldLabel: {
    fontSize: 11,
    color: colors.textMuted,
  },
  fieldEditedDot: {
    fontSize: 14,
    lineHeight: 14,
    color: colors.textPrimary,
    opacity: 0.6,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: radius.md || 12,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    fontSize: 12,
    color: colors.textPrimary,
    backgroundColor: colors.background,
  },

  footerBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.surface,
  },
  footerSummary: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  modeRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  modeBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  modeBtnActive: {
    backgroundColor: "#11182710",
    borderColor: "#11182733",
  },
  modeBtnText: {
    color: colors.textMuted,
    fontWeight: "700",
    fontSize: 12,
  },
  modeBtnTextActive: {
    color: colors.textPrimary,
  },
  attachBox: {
    backgroundColor: "#11182708",
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#11182714",
    marginBottom: spacing.md,
  },
  attachTitle: {
    fontWeight: "800",
    color: colors.textPrimary,
    marginBottom: 6,
  },
  attachMeta: {
    color: colors.textMuted,
  },
  attachHint: {
    marginTop: 10,
    color: colors.textMuted,
    fontSize: 12,
  },
  recordPickerBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.surface,
    marginTop: spacing.sm,
  },
  recordPickerBtnText: {
    flex: 1,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  pickerCard: {
    width: "100%",
    maxWidth: 560,
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
    padding: spacing.md,
  },
  pickerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  pickerTitle: {
    fontWeight: "800",
    color: colors.textPrimary,
    fontSize: 16,
  },
  pickerClose: {
    padding: 6,
    borderRadius: 999,
    backgroundColor: "#11182710",
  },
  pickerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: "#11182714",
    marginBottom: 8,
  },
  pickerRowActive: {
    borderColor: (colors.primary || "#2563EB") + "55",
    backgroundColor: (colors.primary || "#2563EB") + "10",
  },
  pickerRowTitle: {
    color: colors.textPrimary,
    fontWeight: "800",
  },
  pickerRowTitleActive: {
    color: colors.textPrimary,
  },
  pickerRowMeta: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 12,
  },

  commitBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.md || 12,
    borderWidth: 1,
    borderColor: "#11182722",
    backgroundColor: colors.background,
  },
  commitBtnText: {
    marginLeft: 6,
    fontSize: 13,
    fontWeight: "900",
    color: colors.textPrimary,
  },
});
