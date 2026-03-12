// screens/EditSystemEnrichmentScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Modal,
  Platform,
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
import { useOperationFeedback } from "../context/OperationFeedbackContext";
import { layoutStyles } from "../styles/layout";
import { colors, radius, spacing } from "../styles/theme";
import KeeprDateField from "../components/KeeprDateField";

const IS_WEB = Platform.OS === "web";
const SYSTEMS_TABLE = "systems";

const Card = ({ title, children, footer }) => (
  <View style={styles.card}>
    <View style={styles.cardHeaderRow}>
      <Text style={styles.cardTitle}>{title}</Text>
      {footer ? <View>{footer}</View> : null}
    </View>
    <View style={{ marginTop: spacing.sm }}>{children}</View>
  </View>
);

const Field = ({
  label,
  value,
  onChange,
  placeholder,
  keyboardType = "default",
  multiline = false,
  rows = 3,
}) => (
  <View style={styles.fieldRow}>
    <Text style={styles.fieldLabel}>{label}</Text>
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      keyboardType={keyboardType}
      multiline={multiline}
      numberOfLines={rows}
      style={[styles.fieldInput, multiline && styles.fieldInputMultiline]}
      textAlignVertical={multiline ? "top" : "center"}
      autoCapitalize="sentences"
    />
  </View>
);

const Pill = ({ active, label, onPress }) => (
  <TouchableOpacity
    onPress={onPress}
    style={[styles.pill, active && styles.pillActive]}
  >
    <Text style={[styles.pillText, active && styles.pillTextActive]}>
      {label}
    </Text>
  </TouchableOpacity>
);

const SectionTitle = ({ label }) => (
  <Text style={styles.sectionTitle}>{label}</Text>
);

function safeStr(v) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}



function toNumberOrNull(s) {
  const raw = safeStr(s).trim();
  if (!raw) return null;
  const n = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  return n;
}


function buildKeeprProLabel(row) {
  const name = row?.name || "";
  const location = row?.location || "";
  if (name && location) return `${name} · ${location}`;
  return name || location || "Keepr Pro";
}

async function safeGetUser() {
  try {
    const result = await supabase.auth.getUser();
    if (result?.error && result.error.name === "AuthSessionMissingError") {
      return { data: { user: null }, error: null };
    }
    return result; // { data: { user }, error }
  } catch (e) {
    if (e?.name === "AuthSessionMissingError") {
      return { data: { user: null }, error: null };
    }
    throw e;
  }
}

function uniqIds(arr) {
  const out = [];
  const seen = new Set();
  for (const v of arr || []) {
    if (!v) continue;
    const s = String(v);
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/**
 * Ensure we always have a sane metadata shape to write into.
 */
function ensureMetadataV1(src) {
  const base = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  const standard = base.standard && typeof base.standard === "object" ? base.standard : {};
  const extended = base.extended && typeof base.extended === "object" ? base.extended : {};

  return {
    ...base,
    standard: {
      identity: {
        manufacturer: standard?.identity?.manufacturer ?? null,
        model: standard?.identity?.model ?? null,
        serial_number: standard?.identity?.serial_number ?? null,
        year: standard?.identity?.year ?? null,
        installed_on: standard?.identity?.installed_on ?? null,
        installed_by: standard?.identity?.installed_by ?? null,
        location: standard?.identity?.location ?? null,
        notes: standard?.identity?.notes ?? null,
      },
      warranty: {
        provider: standard?.warranty?.provider ?? null,
        policy_number: standard?.warranty?.policy_number ?? null,
        starts_on: standard?.warranty?.starts_on ?? null,
        expires_on: standard?.warranty?.expires_on ?? null,
        coverage_notes: standard?.warranty?.coverage_notes ?? null,
        attachment_ids: Array.isArray(standard?.warranty?.attachment_ids) ? standard.warranty.attachment_ids : [],
      },
      service: {
        last_service_by: standard?.service?.last_service_by ?? null,
        last_service_notes: standard?.service?.last_service_notes ?? null,
      },
      value: {
        estimated_replacement_usd: standard?.value?.estimated_replacement_usd ?? null,
        verified_value_usd: standard?.value?.verified_value_usd ?? null,
        confidence_score: standard?.value?.confidence_score ?? null,
      },
      risk: {
        risk_level: standard?.risk?.risk_level ?? null,
        insurance_notes: standard?.risk?.insurance_notes ?? null,
      },
      story: {
        summary: standard?.story?.summary ?? null,
      },
      relationships: {
        // Keepr Pros associated with this system (manual assignment; no automation)
        keepr_pro_ids: Array.isArray(standard?.relationships?.keepr_pro_ids)
          ? standard.relationships.keepr_pro_ids
          : [],
      },
    },
    extended,
  };
}

export default function EditSystemEnrichmentScreen({ route, navigation }) {
  const systemId = route?.params?.systemId || route?.params?.id || null;
  const assetId = route?.params?.assetId || null;
  const assetName = route?.params?.assetName || "";
  const systemName = route?.params?.systemName || "";

  const assetType = route?.params?.assetType || "home"; // home | boat | vehicle | other
  const systemKey = route?.params?.systemKey || systemId || "system";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { runMutation, showError } = useOperationFeedback();
  const [systemRow, setSystemRow] = useState(null);

  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serial, setSerial] = useState("");
  const [year, setYear] = useState("");
  const [installedOn, setInstalledOn] = useState("");
  const [installedBy, setInstalledBy] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  const [wProvider, setWProvider] = useState("");
  const [wPolicy, setWPolicy] = useState("");
  const [wStarts, setWStarts] = useState("");
  const [wExpires, setWExpires] = useState("");
  const [wNotes, setWNotes] = useState("");

  const [lastServiceBy, setLastServiceBy] = useState("");
  const [lastServiceNotes, setLastServiceNotes] = useState("");

  const [replacementUsd, setReplacementUsd] = useState("");
  const [verifiedUsd, setVerifiedUsd] = useState("");
  const [confidence, setConfidence] = useState("");
  const [riskLevel, setRiskLevel] = useState("");
  const [insuranceNotes, setInsuranceNotes] = useState("");

  const [storySummary, setStorySummary] = useState("");


  // Keepr Pro association (manual assignment at the system level)
  const [pros, setPros] = useState([]);
  const [prosLoading, setProsLoading] = useState(true);
  const [prosError, setProsError] = useState(null);

  const [selectedProIds, setSelectedProIds] = useState([]);
  const [showProModal, setShowProModal] = useState(false);
  const [proSearch, setProSearch] = useState("");


  const [extendedJson, setExtendedJson] = useState("{}");
  const [extendedError, setExtendedError] = useState("");

  const [activeRiskLevel, setActiveRiskLevel] = useState(null);

  const effectiveAssetType = useMemo(() => {
    if (!assetType) return "home";
    const t = String(assetType).toLowerCase();
    if (["home", "boat", "vehicle"].includes(t)) return t;
    return "other";
  }, [assetType]);

  const title = useMemo(() => {
    if (systemName) return systemName;
    if (systemRow?.name) return systemRow.name;
    if (systemRow?.system_type && systemRow?.name) {
      return `${systemRow.system_type} • ${systemRow.name}`;
    }
    return systemRow?.system_type || "System";
  }, [systemName, systemRow]);


  const selectedPros = useMemo(() => {
    if (!selectedProIds?.length) return [];
    const set = new Set(selectedProIds);
    return pros.filter((p) => set.has(p.id));
  }, [selectedProIds, pros]);

  const filteredPros = useMemo(() => {
    const q = safeStr(proSearch).trim().toLowerCase();
    if (!q) return pros;
    return pros.filter((p) => {
      const hay = `${p.name || ""} ${p.category || ""} ${p.location || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [pros, proSearch]);


  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!systemId) {
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from(SYSTEMS_TABLE)
          .select("*")
          .eq("id", systemId)
          .single();

        if (error) throw error;
        if (cancelled) return;

        setSystemRow(data);

        const meta = ensureMetadataV1(data.metadata);
        const standard = meta.standard || {};
        const identity = standard.identity || {};
        const warranty = standard.warranty || {};
        const service = standard.service || {};
        const value = standard.value || {};
        const risk = standard.risk || {};
        const story = standard.story || {};

        setManufacturer(identity.manufacturer || "");
        setModel(identity.model || "");
        setSerial(identity.serial_number || "");
        setYear(identity.year != null ? String(identity.year) : "");
        setInstalledOn((identity.installed_on || "").slice(0, 10));
        setInstalledBy(identity.installed_by || "");
        setLocation(identity.location || "");
        setNotes(identity.notes || "");

        setWProvider(warranty.provider || "");
        setWPolicy(warranty.policy_number || "");
        setWStarts((warranty.starts_on || "").slice(0, 10));
       setWExpires((warranty.expires_on || "").slice(0, 10));
        setWNotes(warranty.coverage_notes || "");

        setLastServiceBy(service.last_service_by || "");
        setLastServiceNotes(service.last_service_notes || "");

        setReplacementUsd(
          value.estimated_replacement_usd != null
            ? String(value.estimated_replacement_usd)
            : ""
        );
        setVerifiedUsd(
          value.verified_value_usd != null ? String(value.verified_value_usd) : ""
        );
        setConfidence(
          value.confidence_score != null ? String(value.confidence_score) : ""
        );

        const rk = risk.risk_level || "";
        setRiskLevel(rk);
        setActiveRiskLevel(rk || null);
        setInsuranceNotes(risk.insurance_notes || "");

        setStorySummary(story.summary || "");

        setSelectedProIds(uniqIds(standard?.relationships?.keepr_pro_ids || []));

        const extended = meta.extended || {};
        const bucket = extended[effectiveAssetType] || {};
        const sys = bucket[systemKey] || {};

        try {
          setExtendedJson(JSON.stringify(sys, null, 2));
          setExtendedError("");
        } catch (e) {
          setExtendedJson("{}");
          setExtendedError("Unable to read extended metadata");
        }
      } catch (e) {
        if (!cancelled) {
          console.error("EditSystemEnrichmentScreen load failed", e);
          Alert.alert(
            "Could not load system",
            e?.message || "Please try again."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [systemId, effectiveAssetType, systemKey]);


  // Load Keepr Pros for this user (for pickers / quick actions)
  useEffect(() => {
    let cancelled = false;

    const loadPros = async () => {
      setProsLoading(true);
      setProsError(null);

      try {
        const { data: userData, error: userErr } = await safeGetUser();
        if (userErr) throw userErr;
        const user = userData?.user;

        if (!user?.id) {
          // not logged in (shouldn't happen inside the app, but keep safe)
          if (!cancelled) {
            setPros([]);
            setProsLoading(false);
          }
          return;
        }

        const { data, error } = await supabase
          .from("keepr_pros")
          .select("id,name,category,phone,email,website,location,is_favorite")
          .eq("user_id", user.id)
          .order("is_favorite", { ascending: false })
          .order("name", { ascending: true });

        if (error) throw error;

        if (!cancelled) {
          setPros(data || []);
          setProsLoading(false);
        }
      } catch (e) {
        console.error("EditSystemEnrichmentScreen loadPros failed", e);
        if (!cancelled) {
          setProsError(e?.message || "Failed to load Keepr Pros.");
          setPros([]);
          setProsLoading(false);
        }
      }
    };

    loadPros();
    return () => {
      cancelled = true;
    };
  }, []);


  const validateExtended = () => {
    const raw = safeStr(extendedJson).trim();
    if (!raw) return {};
    try {
      const obj = JSON.parse(raw);
      if (obj && typeof obj === "object" && !Array.isArray(obj)) {
        setExtendedError("");
        return obj;
      }
      setExtendedError("Extended JSON must be an object (not an array).");
      return null;
    } catch (e) {
      setExtendedError("Extended JSON is invalid.");
      return null;
    }
  };

  const handleRiskPill = (value) => {
    setActiveRiskLevel(value);
    setRiskLevel(value || "");
  };


  const toggleProId = (id) => {
    if (!id) return;
    setSelectedProIds((prev) => {
      const set = new Set(prev || []);
      if (set.has(id)) set.delete(id);
      else set.add(id);
      return Array.from(set);
    });
  };

  const clearPros = () => setSelectedProIds([]);

  const openKeeprProDetail = (pro) => {
    if (!pro?.id) return;
    navigation.navigate("KeeprProDetail", { pro });
  };


  const save = async () => {
    if (!systemId || saving) return;

    const inst = installedOn || null;
    const ws = wStarts || null;
    const we = wExpires || null;

    const extObj = validateExtended();
    if (extObj === null) return;

    setSaving(true);
    try {
      const saved = await runMutation({
        busyMessage: "Saving…",
        success: "Saved",
        error: "Could not save",
        action: async () => {

      const base = ensureMetadataV1(systemRow?.metadata);
      const next = ensureMetadataV1(base);

      next.standard.identity.manufacturer = manufacturer.trim() || null;
      next.standard.identity.model = model.trim() || null;
      next.standard.identity.serial_number = serial.trim() || null;
      next.standard.identity.year = year.trim() ? toNumberOrNull(year) : null;
      next.standard.identity.installed_on = inst;
      next.standard.identity.installed_by = installedBy.trim() || null;
      next.standard.identity.location = location.trim() || null;
      next.standard.identity.notes = notes.trim() || null;

      next.standard.warranty.provider = wProvider.trim() || null;
      next.standard.warranty.policy_number = wPolicy.trim() || null;
      next.standard.warranty.starts_on = ws;
      next.standard.warranty.expires_on = we;
      next.standard.warranty.coverage_notes = wNotes.trim() || null;

      next.standard.service.last_service_by = lastServiceBy.trim() || null;
      next.standard.service.last_service_notes = lastServiceNotes.trim() || null;

      next.standard.value.estimated_replacement_usd =
        replacementUsd.trim() ? toNumberOrNull(replacementUsd) : null;
      next.standard.value.verified_value_usd =
        verifiedUsd.trim() ? toNumberOrNull(verifiedUsd) : null;

      const conf = confidence.trim() ? toNumberOrNull(confidence) : null;
      if (conf != null && (conf < 0 || conf > 1)) {
        Alert.alert("Invalid confidence", "Confidence score must be between 0 and 1.");
        setSaving(false);
        return;
      }
      next.standard.value.confidence_score = conf;

      next.standard.risk.risk_level = riskLevel.trim() || null;
      next.standard.risk.insurance_notes = insuranceNotes.trim() || null;

      next.standard.story.summary = storySummary.trim() || null;

      next.standard.relationships.keepr_pro_ids = uniqIds(selectedProIds);

      const bucket = next.extended?.[effectiveAssetType] || {};
      bucket[systemKey] = extObj || {};
      next.extended[effectiveAssetType] = bucket;

      if (IS_WEB) {
        console.log("[EditSystemEnrichment] saving", {
          systemId,
          assetId,
          assetType: effectiveAssetType,
          systemKey,
        });
      }

      const { data, error } = await supabase
        .from(SYSTEMS_TABLE)
        .update({ metadata: next })
        .eq("id", systemId)
        .select("*")
        .single();

      if (IS_WEB) {
        console.log("[EditSystemEnrichment] save result", { data, error });
      }

      if (error) throw error;
          return data;
        },
      });

      if (saved) {
        setSystemRow(saved);
        Keyboard.dismiss();
      }
    } finally {
      setSaving(false);
    }
};

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
          <ActivityIndicator size="large" color={colors.textSecondary} />
        </View>
      </SafeAreaView>
    );
  }

  const openSystemAttachments = () => {
    if (!assetId || !systemId) {
      Alert.alert("Missing context", "Asset or system is missing.");
      return;
    }

    navigation.navigate("AssetAttachments", {
      assetId,
      assetName,
      targetType: "system",
      targetId: systemId,
      targetRole: "other",
      scopeTargetType: "system",
      scopeTargetId: systemId,
      scopeTargetName: title,
    });
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.screen}>
        <View style={styles.headerRow}>
          <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.screenTitle}>Edit System Story</Text>
            <Text style={styles.screenSubtitle}>
              {assetName ? `${assetName} • ` : ""}{title}
            </Text>
          </View>

          <TouchableOpacity style={styles.headerIconBtn} onPress={openSystemAttachments}>
            <Ionicons name="attach-outline" size={18} color={colors.textPrimary} />
          </TouchableOpacity>
        </View>

        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Card title="Identity">
            <Field label="Manufacturer" value={manufacturer} onChange={setManufacturer} placeholder="e.g., Garmin" />
            <Field label="Model" value={model} onChange={setModel} placeholder="e.g., GPSMAP 8616" />
            <Field label="Serial number" value={serial} onChange={setSerial} placeholder="e.g., ABC123" />
            <Field label="Year" value={year} onChange={setYear} placeholder="e.g., 2021" keyboardType="numeric" />
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Installed on</Text>
              <KeeprDateField
                value={installedOn}
                onChange={setInstalledOn}
              />
            </View>            <Field label="Installed by" value={installedBy} onChange={setInstalledBy} placeholder="Vendor or person" />
            <Field label="Location" value={location} onChange={setLocation} placeholder="Basement / Engine room / etc." />
            <Field
              label="Notes"
              value={notes}
              onChange={setNotes}
              placeholder="Anything you want to remember..."
              multiline
              rows={4}
            />
          </Card>

          <Card
            title="Warranty"
            footer={
              <TouchableOpacity style={styles.smallLinkBtn} onPress={openSystemAttachments}>
                <Text style={styles.smallLinkText}>Manage proof</Text>
              </TouchableOpacity>
            }
          >
            <Field
              label="Provider"
              value={wProvider}
              onChange={setWProvider}
              placeholder="Manufacturer / 3rd party"
            />
            <Field label="Policy #" value={wPolicy} onChange={setWPolicy} placeholder="Optional" />
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Starts</Text>
              <KeeprDateField
                value={wStarts}
                onChange={setWStarts}
              />
            </View>
            <View style={styles.fieldRow}>
              <Text style={styles.fieldLabel}>Expires</Text>
              <KeeprDateField
                value={wExpires}
                onChange={setWExpires}
              />
            </View>
            <Field
              label="Coverage notes"
              value={wNotes}
              onChange={setWNotes}
              placeholder="Anything unusual about coverage..."
              multiline
              rows={3}
            />
          </Card>


          <Card
            title="Keepr Pros"
            footer={
              <TouchableOpacity
                style={styles.smallLinkBtn}
                onPress={() => setShowProModal(true)}
              >
                <Text style={styles.smallLinkText}>Assign</Text>
              </TouchableOpacity>
            }
          >
            <Text style={styles.helperText}>
              Link one or more trusted providers to this system. These become
              one-tap actions on the system story screen.
            </Text>

            {prosLoading ? (
              <View style={styles.inlineRow}>
                <ActivityIndicator size="small" />
                <Text style={styles.inlineText}>Loading Keepr Pros…</Text>
              </View>
            ) : prosError ? (
              <Text style={styles.errorInline}>{prosError}</Text>
            ) : (
              <>
                {selectedPros.length === 0 ? (
                  <Text style={styles.emptyHint}>
                    No Keepr Pros linked yet. Tap “Assign” to pick one.
                  </Text>
                ) : (
                  <View style={styles.proChipsWrap}>
                    {selectedPros.map((p) => (
                      <TouchableOpacity
                        key={p.id}
                        style={styles.proChip}
                        activeOpacity={0.85}
                        onPress={() => openKeeprProDetail(p)}
                      >
                        <Ionicons
                          name="person-circle-outline"
                          size={18}
                          color={colors.textSecondary}
                          style={{ marginRight: 8 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.proChipTitle} numberOfLines={1}>
                            {buildKeeprProLabel(p)}
                          </Text>
                          {(p.category || p.phone || p.email) ? (
                            <Text
                              style={styles.proChipSub}
                              numberOfLines={1}
                            >
                              {[p.category, p.phone, p.email]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          ) : null}
                        </View>

                        <TouchableOpacity
                          onPress={() => toggleProId(p.id)}
                          style={styles.proChipRemove}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons
                            name="close-circle"
                            size={18}
                            color={colors.textMuted}
                          />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </Card>

          <Card title="Service history">
            <Field
              label="Last serviced by"
              value={lastServiceBy}
              onChange={setLastServiceBy}
              placeholder="Vendor / shop / person"
            />
            <Field
              label="Last service notes"
              value={lastServiceNotes}
              onChange={setLastServiceNotes}
              placeholder="What was done, any notes..."
              multiline
              rows={3}
            />
          </Card>

          <Card title="Value & risk">
            <SectionTitle label="Value" />
            <Field
              label="Estimated replacement (USD)"
              value={replacementUsd}
              onChange={setReplacementUsd}
              placeholder="e.g., 2500"
              keyboardType="numeric"
            />
            <Field
              label="Verified value (USD)"
              value={verifiedUsd}
              onChange={setVerifiedUsd}
              placeholder="If you have an invoice / appraisal..."
              keyboardType="numeric"
            />
            <Field
              label="Confidence score (0–1)"
              value={confidence}
              onChange={setConfidence}
              placeholder="e.g., 0.8"
              keyboardType="numeric"
            />

            <SectionTitle label="Risk" />
            <View style={styles.pillRow}>
              <Pill
                label="Low"
                active={activeRiskLevel === "low"}
                onPress={() => handleRiskPill(activeRiskLevel === "low" ? null : "low")}
              />
              <Pill
                label="Medium"
                active={activeRiskLevel === "medium"}
                onPress={() => handleRiskPill(activeRiskLevel === "medium" ? null : "medium")}
              />
              <Pill
                label="High"
                active={activeRiskLevel === "high"}
                onPress={() => handleRiskPill(activeRiskLevel === "high" ? null : "high")}
              />
            </View>
            <Field
              label="Insurance / risk notes"
              value={insuranceNotes}
              onChange={setInsuranceNotes}
              placeholder="Anything an insurer or future owner should know..."
              multiline
              rows={3}
            />
          </Card>

          <Card title="Story">
            <Field
              label="Short story of this system"
              value={storySummary}
              onChange={setStorySummary}
              placeholder="How you chose it, why it matters, anything that tells the story..."
              multiline
              rows={4}
            />
          </Card>

          <Card title="Extended (advanced)">
            <Text style={styles.extendedHint}>
              This is a flexible JSON bucket keyed by asset type and system. You can paste or edit advanced metadata
              here (OEM config, integration hints, etc.).
            </Text>
            <TextInput
              value={extendedJson}
              onChangeText={(text) => {
                setExtendedJson(text);
                if (extendedError) setExtendedError("");
              }}
              multiline
              numberOfLines={8}
              style={[styles.extendedInput, extendedError && styles.extendedInputError]}
              autoCapitalize="none"
              autoCorrect={false}
              textAlignVertical="top"
            />
            {extendedError ? (
              <Text style={styles.extendedErrorText}>{extendedError}</Text>
            ) : null}
          </Card>

          <View style={{ height: spacing.lg }} />
        </ScrollView>


        <Modal
          visible={showProModal}
          transparent
          animationType="fade"
          onRequestClose={() => setShowProModal(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeaderRow}>
                <Text style={styles.modalTitle}>Assign Keepr Pros</Text>
                <TouchableOpacity
                  onPress={() => setShowProModal(false)}
                  style={styles.modalCloseBtn}
                >
                  <Ionicons name="close" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalHint}>
                Pick the pros you’d call first for this system.
              </Text>

              <View style={styles.modalSearchRow}>
                <Ionicons
                  name="search-outline"
                  size={16}
                  color={colors.textMuted}
                  style={{ marginRight: 8 }}
                />
                <TextInput
                  value={proSearch}
                  onChangeText={setProSearch}
                  placeholder="Search by name, category, location…"
                  placeholderTextColor={colors.textMuted}
                  style={styles.modalSearchInput}
                  autoCapitalize="none"
                />
                {proSearch ? (
                  <TouchableOpacity onPress={() => setProSearch("")} style={styles.modalClearSearch}>
                    <Ionicons name="close-circle" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : null}
              </View>

              {prosLoading ? (
                <View style={styles.inlineRow}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.inlineText}>Loading…</Text>
                </View>
              ) : filteredPros.length === 0 ? (
                <Text style={styles.emptyHint}>No matches.</Text>
              ) : (
                <ScrollView style={{ maxHeight: 360 }}>
                  {filteredPros.map((p) => {
                    const active = selectedProIds.includes(p.id);
                    return (
                      <TouchableOpacity
                        key={p.id}
                        style={styles.modalOptionRow}
                        onPress={() => toggleProId(p.id)}
                        activeOpacity={0.85}
                      >
                        <Ionicons
                          name={active ? "checkbox-outline" : "square-outline"}
                          size={18}
                          color={active ? colors.brandBlue : colors.textMuted}
                          style={{ marginRight: 10 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={active ? styles.modalOptionTextActive : styles.modalOptionText}
                            numberOfLines={1}
                          >
                            {buildKeeprProLabel(p)}
                          </Text>
                          {(p.category || p.phone || p.email) ? (
                            <Text style={styles.modalOptionSub} numberOfLines={1}>
                              {[p.category, p.phone, p.email].filter(Boolean).join(" · ")}
                            </Text>
                          ) : null}
                        </View>

                        <TouchableOpacity
                          onPress={() => openKeeprProDetail(p)}
                          style={styles.modalOpenBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="open-outline" size={18} color={colors.textSecondary} />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              <View style={styles.modalFooterRow}>
                <TouchableOpacity
                  style={styles.modalSecondaryBtn}
                  onPress={clearPros}
                  disabled={!selectedProIds.length}
                >
                  <Text style={styles.modalSecondaryText}>Clear</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.modalPrimaryBtn}
                  onPress={() => setShowProModal(false)}
                >
                  <Text style={styles.modalPrimaryText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <View style={styles.footerBar}>
          <TouchableOpacity
            style={[styles.saveButton, saving && { opacity: 0.6 }]}
            onPress={save}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <>
                <Ionicons name="save-outline" size={18} color="#fff" />
                <Text style={styles.saveButtonText}>Save</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const SHADOW = Platform.select({
  web: { boxShadow: "0 2px 8px rgba(0,0,0,0.12)" },
  default: {
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
    ...SHADOW,
  },
  headerIconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: spacing.sm,
    ...SHADOW,
  },
  screenTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  screenSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xl * 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    marginBottom: spacing.md,
    ...SHADOW,
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  fieldRow: {
    marginTop: spacing.sm,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    marginBottom: 4,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
    color: colors.textPrimary,
    fontSize: 14,
  },
  fieldInputMultiline: {
    minHeight: 90,
  },
  sectionTitle: {
    marginTop: spacing.sm,
    fontSize: 12,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  pillRow: {
    flexDirection: "row",
    marginTop: spacing.sm,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    marginRight: 8,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  pillActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  pillText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  pillTextActive: {
    color: "#fff",
  },
  extendedHint: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 6,
  },
  extendedInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#0b1120",
    color: "#e5e7eb",
    fontFamily: Platform.select({
      ios: "Menlo",
      android: "monospace",
      default: "monospace",
    }),
    fontSize: 12,
    minHeight: 160,
  },
  extendedInputError: {
    borderColor: "#f97316",
  },
  extendedErrorText: {
    marginTop: 4,
    fontSize: 12,
    color: "#f97316",
  },
  smallLinkBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle,
  },
  smallLinkText: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  footerBar: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    backgroundColor: colors.surface,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: radius.lg,
    backgroundColor: colors.primary,
    ...SHADOW,
  },
  saveButtonText: {
    marginLeft: 8,
    fontSize: 14,
    fontWeight: "800",
    color: "#fff",
  },

  helperText: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 16,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.sm,
  },
  inlineText: {
    marginLeft: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
  },
  errorInline: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.danger,
  },
  emptyHint: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textSecondary,
  },

  proChipsWrap: {
    marginTop: spacing.sm,
  },
  proChip: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginTop: spacing.sm,
  },
  proChipTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  proChipSub: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
  },
  proChipRemove: {
    marginLeft: spacing.sm,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
    padding: spacing.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    ...SHADOW,
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  modalCloseBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  modalHint: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
  },
  modalSearchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalSearchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
  },
  modalClearSearch: {
    marginLeft: spacing.sm,
  },
  modalOptionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  modalOptionText: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  modalOptionTextActive: {
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "900",
  },
  modalOptionSub: {
    marginTop: 2,
    fontSize: 11,
    color: colors.textSecondary,
  },
  modalOpenBtn: {
    marginLeft: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  modalFooterRow: {
    marginTop: spacing.md,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  modalSecondaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    opacity: 1,
  },
  modalSecondaryText: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textSecondary,
  },
  modalPrimaryBtn: {
    paddingVertical: 10,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    backgroundColor: colors.brandBlue,
  },
  modalPrimaryText: {
    fontSize: 13,
    fontWeight: "900",
    color: "#fff",
  },

});

