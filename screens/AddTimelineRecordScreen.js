// screens/AddTimelineRecordScreen.js
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
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

import LinkifiedText from "../components/links/LinkifiedText";
import { tokenizeWithUrls } from "../components/links/linkUtils";

import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import { colors, radius, shadows, spacing } from "../styles/theme";

/* ---------------- helpers ---------------- */

function getTodayISO() {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isoToUS(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return "";
  }
}

function usToISO(value) {
  const raw = String(value || "").trim();
  if (!raw) return getTodayISO();

  // accept MM/DD/YYYY or MM-DD-YYYY or YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parts = raw.split(/[-/]/).map((p) => p.trim());
  if (parts.length !== 3) return null;

  let mm = parts[0], dd = parts[1], yyyy = parts[2];
  if (mm.length === 4) {
    yyyy = parts[0];
    mm = parts[1];
    dd = parts[2];
  }

  const m = Number(mm);
  const d = Number(dd);
  const y = Number(yyyy);
  if (!Number.isInteger(m) || !Number.isInteger(d) || !Number.isInteger(y)) return null;
  if (y < 1900 || y > 2100) return null;
  if (m < 1 || m > 12) return null;
  if (d < 1 || d > 31) return null;

  return `${String(y)}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function safeMoney(raw) {
  if (raw == null) return null;
  const cleaned = String(raw).replace(/[^0-9.,-]/g, "");
  if (!cleaned) return null;
  const normalized = cleaned.replace(/,/g, "");
  const n = Number(normalized);
  if (Number.isNaN(n)) return null;
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


function systemLabel(row) {
  return row?.name || row?.title || row?.label || "System";
}

async function safeSelect(table, queryFn) {
  try {
    const q = queryFn(supabase.from(table).select("*"));
    const { data, error } = await q;
    if (error) return [];
    return data || [];
  } catch {
    return [];
  }
}

async function loadSystemsForAsset(assetId) {
  if (!assetId) return [];

  const tables = ["systems", "home_systems", "vehicle_systems", "boat_systems"];
  for (const t of tables) {
    const rows = await safeSelect(t, (q) =>
      q.eq("asset_id", assetId).order("name", { ascending: true })
    );
    if (rows?.length) {
      return rows.map((r) => ({
        ...r,
        __table: t,
        __label: systemLabel(r),
      }));
    }
  }
  return [];
}

/* ---------------- screen ---------------- */

export default function AddTimelineRecordScreen({ route, navigation }) {
  const {
    assetId,
    assetName,
    systemId: initialSystemId,
    systemName,
    backTo,
    origin,
  } = route?.params || {};

  // Origin-aware navigation: callers can pass { backTo: {name, params} } or { origin: {name, params} }
  const resolvedBackTo = useMemo(() => {
    if (backTo?.name) return backTo;
    if (origin?.name) return origin;
    return null;
  }, [backTo, origin]);

  const [serviceType, setServiceType] = useState("moment"); // moment | diy | pro
  const [date, setDate] = useState(() => isoToUS(getTodayISO()));
  const [title, setTitle] = useState("");
  const [provider, setProvider] = useState("");
  const [location, setLocation] = useState("");
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");

  const [systems, setSystems] = useState([]);
  const [pros, setPros] = useState([]);
  const [selectedSystemId, setSelectedSystemId] = useState(initialSystemId || null);
  const [selectedKeeprProId, setSelectedKeeprProId] = useState(null);
  const [selectedKeeprProLabel, setSelectedKeeprProLabel] = useState("");

  const [showSystemModal, setShowSystemModal] = useState(false);
  const [showProModal, setShowProModal] = useState(false);

  const [showQuickSystemModal, setShowQuickSystemModal] = useState(false);
  const [quickSystemName, setQuickSystemName] = useState("");
  const [creatingQuickSystem, setCreatingQuickSystem] = useState(false);
  const [quickSystemError, setQuickSystemError] = useState(null);

  const [showQuickProModal, setShowQuickProModal] = useState(false);
  const [quickProName, setQuickProName] = useState("");
  const [creatingQuickPro, setCreatingQuickPro] = useState(false);

  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [loadingLookups, setLoadingLookups] = useState(true);

  const contextLabel = useMemo(() => {
    if (assetName && systemName) return `${assetName} · ${systemName}`;
    if (assetName) return assetName;
    if (systemName) return systemName;
    return "Asset";
  }, [assetName, systemName]);

  const selectedSystem = useMemo(
    () => (selectedSystemId ? systems.find((s) => s.id === selectedSystemId) : null),
    [selectedSystemId, systems]
  );

  

const notesHasUrls = useMemo(() => {
  try {
    const tokens = tokenizeWithUrls(notes || "");
    return (tokens || []).some((t) => t.type === "url");
  } catch {
    return false;
  }
}, [notes]);

  const selectedPro = useMemo(
    () => (selectedKeeprProId ? pros.find((p) => p.id === selectedKeeprProId) : null),
    [selectedKeeprProId, pros]
  );

  const back = () => {
    try {
      if (navigation?.canGoBack?.()) return navigation.goBack();
    } catch {}
    try {
      navigation.navigate("Dashboard");
    } catch {
      Alert.alert("Navigation", "No back route available.");
    }
  };

  useEffect(() => {
    let isActive = true;

    (async () => {
      try {
        if (!assetId) {
          setSystems([]);
        } else {
          const sys = await loadSystemsForAsset(assetId);
          if (isActive) setSystems(sys);
        }

        // Keepr Pros (same model as EditTimelineRecordScreen)
        let rows = await safeSelect("keepr_pros", (q) =>
          q.select("id, name, location").order("name", { ascending: true })
        );

        // Fallback for older naming
        if (!rows || rows.length === 0) {
          rows = await safeSelect("service_providers", (q) =>
            q.select("id, name, location").order("name", { ascending: true })
          );
        }

        if (isActive) setPros(rows || []);
      } finally {
        if (isActive) setLoadingLookups(false);
      }
    })();

    return () => {
      isActive = false;
    };
  }, [assetId]);

  const handleSelectSystem = (id) => {
    setSelectedSystemId(id === selectedSystemId ? null : id);
  };

  const openQuickAddSystem = () => {
    setQuickSystemName("");
    setQuickSystemError(null);
    setShowQuickSystemModal(true);
  };

  const handleCreateQuickSystem = async () => {
    const name = (quickSystemName || "").trim();
    if (!name) {
      if (Platform.OS === "web") setQuickSystemError("Enter a system name.");
      else Alert.alert("Name required", "Enter a system name.");
      return;
    }

    try {
      if (creatingQuickSystem) return;
      setCreatingQuickSystem(true);

      // Prefer the canonical systems table; use a safe placeholder KSC code
      const payload = {
        asset_id: assetId,
        name,
        ksc_code: "custom",
        source_type: "manual",
        status: "ok",
        lifecycle_status: "active",
      };

      const { data, error } = await supabase
        .from("systems")
        .insert([payload])
        .select("*")
        .single();

      if (error) throw error;

      // Refresh system list and select the new one
      const sys = await loadSystemsForAsset(assetId);
      setSystems(sys);
      if (data?.id) setSelectedSystemId(data.id);

      setShowQuickSystemModal(false);
      setShowSystemModal(false);
    } catch (e) {
      console.error("Quick add system error:", e);
      const msg = String(e?.message || "");
      if (msg.includes("plan_limit_systems_per_asset")) {
        const friendly =
          "Starter allows up to 5 systems per asset. Upgrade to add more systems.";
        if (Platform.OS === "web") setQuickSystemError(friendly);
        else Alert.alert("Plan limit reached", friendly);
      } else {
        const friendly = msg || "Please try again.";
        if (Platform.OS === "web") setQuickSystemError(friendly);
        else Alert.alert("Could not add system", friendly);
      }
    } finally {
      setCreatingQuickSystem(false);
    }
  };


  const handleSelectPro = (pro) => {
    if (!pro) {
      setSelectedKeeprProId(null);
      setSelectedKeeprProLabel("");
      return;
    }
    setSelectedKeeprProId(pro.id);
    setSelectedKeeprProLabel(buildKeeprProLabel(pro));
  };

  const openQuickAddPro = () => {
    setQuickProName("");
    setShowQuickProModal(true);
  };

  const handleCreateQuickPro = async () => {
    const name = (quickProName || "").trim();
    if (!name) {
      Alert.alert("Name required", "Enter a name for this Keepr Pro.");
      return;
    }

    try {
      if (creatingQuickPro) return;
      setCreatingQuickPro(true);

      const { data: userData, error: userError } = await safeGetUser();
      if (userError) throw userError;
      const user = userData?.user;

      if (!user) {
        Alert.alert("Sign in required", "Please sign in to add a Keepr Pro.");
        setCreatingQuickPro(false);
        return;
      }

      const payload = {
        user_id: user.id,
        name,
        category: "other",
        is_favorite: false,
        source: "manual_quick",
      };

      const { data, error } = await supabase
        .from("keepr_pros")
        .insert([payload])
        .select("*")
        .single();

      if (error) throw error;

      const newPro = data || { id: null, name };
      setPros((prev) => {
        const next = [...(prev || [])];
        // If DB returned, use it; else keep minimal.
        if (newPro?.id && next.some((p) => p.id === newPro.id)) return next;
        next.push(newPro);
        next.sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")));
        return next;
      });

      if (newPro?.id) {
        handleSelectPro(newPro);
      } else {
        // fall back: do not select if id missing
        setSelectedKeeprProLabel(name);
      }

      setShowQuickProModal(false);
      // Keep the pro picker open so user sees it selected; or close both for speed.
      setShowProModal(false);
    } catch (e) {
      console.error("Quick add Keepr Pro error:", e);
      Alert.alert("Could not add Keepr Pro", e?.message || "Please try again.");
    } finally {
      setCreatingQuickPro(false);
    }
  };


  const handleSave = async () => {
    Keyboard.dismiss();
    if (saving) return;

    setSaving(true);
    setSubmitError(null);

    if (!assetId) {
      setSubmitError("This record must be linked to an asset.");
      setSaving(false);
      return;
    }

    const dateIso = usToISO(date);
    if (!dateIso) {
      setSaving(false);
      setSubmitError("Invalid date. Use MM/DD/YYYY.");
      return;
    }

    const payload = {
      asset_id: assetId,
      title: title?.trim() || "Story moment",
      notes: notes?.trim() || null,
      service_type: serviceType === "moment" ? "moment" : serviceType,
      performed_at: dateIso,
      location: location?.trim?.() || null,
      provider: provider?.trim?.() || null,
      cost: safeMoney(cost),
      system_id: selectedSystemId || null,
      keepr_pro_id: selectedKeeprProId || null,
      source_type: "manual",
      verification_status: "verified",
    };

    let recordId = null;

    try {
      // Some schemas may not have a provider column; try gracefully.
      let { data, error } = await supabase
        .from("service_records")
        .insert(payload)
        .select("*")
        .single();

      if (error && String(error.message || "").toLowerCase().includes("provider")) {
        const fallback = { ...payload };
        delete fallback.provider;
        const res2 = await supabase
          .from("service_records")
          .insert(fallback)
          .select("*")
          .single();
        error = res2.error;
        data = res2.data;
      }

      if (error) throw error;
      recordId = data?.id;
    } catch (e) {
      console.error("Create timeline record error:", e);
      setSubmitError(e?.message || "Could not save this record.");
      setSaving(false);
      return;
    }

    setSaving(false);

    // Navigate to the story view for this new record
    if (recordId) {
      try {
        navigation.replace("TimelineRecord", {
          recordId,
          timelineRecordId: recordId,
          serviceRecordId: recordId,
          // Start in "proof mode" after create
          mode: "add_proof",
          // Ensure Back returns to where the user started
          backTo: resolvedBackTo || undefined,
        });
        return;
      } catch {}
    }

    // Fallback
    try {
      back();
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={64}
      >
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.iconButton} onPress={back}>
              <Ionicons name="chevron-back-outline" size={20} />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>New story moment</Text>
              <Text style={styles.headerSubtitle}>{contextLabel}</Text>
            </View>

            <TouchableOpacity
              style={[styles.headerSaveBtn, saving && { opacity: 0.7 }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <>
                  <Ionicons name="checkmark-outline" size={18} color="#fff" />
                  <Text style={styles.headerSaveText}>Create</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing.xl }}
            keyboardShouldPersistTaps="handled"
            onScrollBeginDrag={Keyboard.dismiss}
          >
            {/* Basics */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Basics</Text>

              <View style={styles.toggleRow}>
                <TouchableOpacity
                  style={[styles.togglePill, serviceType === "moment" && styles.toggleActivePrimary]}
                  onPress={() => setServiceType("moment")}
                >
                  <Ionicons
                    name={serviceType === "moment" ? "sparkles" : "sparkles-outline"}
                    size={14}
                    color={serviceType === "moment" ? colors.brandWhite : colors.textMuted}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.toggleText, serviceType === "moment" && styles.toggleTextActive]}>
                    Moment
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.togglePill, serviceType === "diy" && styles.toggleActiveSoft]}
                  onPress={() => setServiceType("diy")}
                >
                  <Ionicons
                    name={serviceType === "diy" ? "construct" : "construct-outline"}
                    size={14}
                    color={serviceType === "diy" ? colors.accentBlue : colors.textMuted}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.toggleText, serviceType === "diy" && styles.toggleTextSoftActive]}>
                    DIY
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.togglePill, serviceType === "pro" && styles.toggleActivePrimary]}
                  onPress={() => setServiceType("pro")}
                >
                  <Ionicons
                    name={serviceType === "pro" ? "briefcase" : "briefcase-outline"}
                    size={14}
                    color={serviceType === "pro" ? colors.brandWhite : colors.textMuted}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={[styles.toggleText, serviceType === "pro" && styles.toggleTextActive]}>
                    Pro
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.row}>
                <View style={{ flex: 1.5 }}>
                  <Text style={styles.label}>Title</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Winterized, upgrade, perfect day on the water…"
                    value={title}
                    onChangeText={setTitle}
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Date</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="MM/DD/YYYY"
                    value={date}
                    onChangeText={setDate}
                    placeholderTextColor={colors.textMuted}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Cost</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="$0"
                    value={cost}
                    onChangeText={setCost}
                    placeholderTextColor={colors.textMuted}
                    keyboardType="decimal-pad"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Location</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Optional"
                    value={location}
                    onChangeText={setLocation}
                    placeholderTextColor={colors.textMuted}
                  />
                </View>
              </View>
            </View>

            {/* Associations */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Associations</Text>

              <Text style={styles.label}>System (optional)</Text>
              {loadingLookups ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.inlineLoadingText}>Loading systems…</Text>
                </View>
              ) : (
                <View>
                  <TouchableOpacity style={styles.selector} onPress={() => setShowSystemModal(true)}>
                  <Text style={selectedSystem ? styles.selectorText : styles.selectorPlaceholder} numberOfLines={1}>
                    {selectedSystem ? (selectedSystem.__label || systemLabel(selectedSystem)) : "Whole asset"}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </TouchableOpacity>

                  <View style={{ height: 8 }} />

                  <TouchableOpacity
                    style={styles.quickAddRow}
                    onPress={openQuickAddSystem}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={colors.brandBlue} />
                    <Text style={styles.quickAddText}>Quick add System</Text>
                  </TouchableOpacity>
                </View>
              )
              }

              <View style={{ height: spacing.md }} />

              <Text style={styles.label}>Keepr Pro (optional)</Text>
              {loadingLookups ? (
                <View style={styles.inlineLoading}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.inlineLoadingText}>Loading Keepr Pros…</Text>
                </View>
              ) : (
                <TouchableOpacity style={styles.selector} onPress={() => setShowProModal(true)}>
                  <Text style={selectedPro ? styles.selectorText : styles.selectorPlaceholder} numberOfLines={1}>
                    {selectedPro ? (selectedKeeprProLabel || buildKeeprProLabel(selectedPro)) : "Not linked"}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={colors.textSecondary} />
                </TouchableOpacity>
              )}

              <View style={{ height: spacing.md }} />

              <Text style={styles.label}>Provider / Who</Text>
              <TextInput
                style={styles.input}
                placeholder="MSM Painting / Samir"
                value={provider}
                onChangeText={setProvider}
                placeholderTextColor={colors.textMuted}
              />
            </View>

            {/* Context */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Context</Text>
              <Text style={styles.helper}>
                Write it like you’re explaining it to a future buyer (or future you).
              </Text>
              <TextInput
                style={[styles.input, styles.multiline]}
                placeholder="Tell the story… products used, prep notes, part numbers, where things are stored…"
                value={notes}
                onChangeText={setNotes}
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={6}
                textAlignVertical="top"
              />
            
              {notesHasUrls ? (
                <View style={{ marginTop: spacing.sm }}>
                  <Text style={styles.linkPreviewLabel}>Links detected in notes</Text>
                  <LinkifiedText
                    text={notes}
                    style={styles.linkPreviewText}
                    linkStyle={styles.linkPreviewLink}
                    selectable
                  />
                </View>
              ) : null}
</View>

            {/* Proof helper */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Proof</Text>
              <Text style={styles.helper}>
                Once you save this story moment, you can attach photos, files, and links as proof from the story view.
              </Text>
            </View>

            {submitError ? <Text style={styles.errorText}>{submitError}</Text> : null}
          </ScrollView>

          {/* System picker */}
          <Modal
            visible={showSystemModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowSystemModal(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Link to a system</Text>
                  <TouchableOpacity onPress={() => setShowSystemModal(false)} style={styles.modalCloseBtn}>
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <ScrollView>
                  <TouchableOpacity
                    style={styles.modalOptionRow}
                    onPress={() => {
                      handleSelectSystem(null);
                      setShowSystemModal(false);
                    }}
                  >
                    <Text style={selectedSystemId == null ? styles.modalOptionTextActive : styles.modalOptionText}>
                      Whole asset
                    </Text>
                  </TouchableOpacity>
                  {systems.map((sys) => (
                    <TouchableOpacity
                      key={sys.id}
                      style={styles.modalOptionRow}
                      onPress={() => {
                        handleSelectSystem(sys.id);
                        setShowSystemModal(false);
                      }}
                    >
                      <Text
                        style={
                          selectedSystemId === sys.id ? styles.modalOptionTextActive : styles.modalOptionText
                        }
                        numberOfLines={1}
                      >
                        {sys.__label || systemLabel(sys)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          </Modal>

          {/* Keepr Pro picker */}
          <Modal
            visible={showProModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowProModal(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.modalCard}>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Link a Keepr Pro</Text>
                  <TouchableOpacity onPress={() => setShowProModal(false)} style={styles.modalCloseBtn}>
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>
                <ScrollView>
                  <TouchableOpacity
                    style={styles.modalOptionRow}
                    onPress={() => {
                      handleSelectPro(null);
                      setShowProModal(false);
                    }}
                  >
                    <Text style={!selectedKeeprProId ? styles.modalOptionTextActive : styles.modalOptionText}>
                      Not linked
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.quickAddRow}
                    onPress={openQuickAddPro}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="add-circle-outline" size={16} color={colors.brandBlue} />
                    <Text style={styles.quickAddText}>Quick add Keepr Pro</Text>
                  </TouchableOpacity>
                  {pros.map((pro) => (
                    <TouchableOpacity
                      key={pro.id}
                      style={styles.modalOptionRow}
                      onPress={() => {
                        handleSelectPro(pro);
                        setShowProModal(false);
                      }}
                    >
                      <Text
                        style={
                          selectedKeeprProId === pro.id ? styles.modalOptionTextActive : styles.modalOptionText
                        }
                        numberOfLines={1}
                      >
                        {buildKeeprProLabel(pro)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            </View>
          </Modal>
          <Modal
            visible={showQuickProModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowQuickProModal(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.quickAddCard}>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Quick add Keepr Pro</Text>
                  <TouchableOpacity
                    onPress={() => setShowQuickProModal(false)}
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.quickAddHint}>
                  Name only for now — you can enrich the full profile later.
                </Text>

                <TextInput
                  style={styles.quickAddInput}
                  value={quickProName}
                  onChangeText={setQuickProName}
                  placeholder="Name or company"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />

                <View style={styles.quickAddButtonsRow}>
                  <TouchableOpacity
                    style={[styles.quickAddBtn, styles.quickAddBtnSecondary]}
                    onPress={() => setShowQuickProModal(false)}
                    disabled={creatingQuickPro}
                  >
                    <Text style={styles.quickAddBtnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.quickAddBtn, styles.quickAddBtnPrimary]}
                    onPress={handleCreateQuickPro}
                    disabled={creatingQuickPro}
                  >
                    <Text style={styles.quickAddBtnPrimaryText}>
                      {creatingQuickPro ? "Adding..." : "Add"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>
          <Modal
            visible={showQuickSystemModal}
            transparent
            animationType="fade"
            onRequestClose={() => setShowQuickSystemModal(false)}
          >
            <View style={styles.modalBackdrop}>
              <View style={styles.quickAddCard}>
                <View style={styles.modalHeaderRow}>
                  <Text style={styles.modalTitle}>Quick add System</Text>
                  <TouchableOpacity
                    onPress={() => setShowQuickSystemModal(false)}
                    style={styles.modalCloseBtn}
                  >
                    <Ionicons name="close" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                </View>

                <Text style={styles.quickAddHint}>
                  Name only for now — you can enrich details later.
                </Text>

                <TextInput
                  style={styles.quickAddInput}
                  value={quickSystemName}
                  onChangeText={(t) => {
                    setQuickSystemName(t);
                    if (quickSystemError) setQuickSystemError(null);
                  }}
                  placeholder="System name"
                  placeholderTextColor={colors.textMuted}
                  autoFocus
                />

                {!!quickSystemError && (
                  <View style={styles.inlineErrorBox}>
                    <Text style={styles.inlineErrorText}>{quickSystemError}</Text>
                  </View>
                )}

                <View style={styles.quickAddButtonsRow}>
                  <TouchableOpacity
                    style={[styles.quickAddBtn, styles.quickAddBtnSecondary]}
                    onPress={() => setShowQuickSystemModal(false)}
                    disabled={creatingQuickSystem}
                  >
                    <Text style={styles.quickAddBtnSecondaryText}>Cancel</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.quickAddBtn, styles.quickAddBtnPrimary]}
                    onPress={handleCreateQuickSystem}
                    disabled={creatingQuickSystem}
                  >
                    <Text style={styles.quickAddBtnPrimaryText}>
                      {creatingQuickSystem ? "Adding..." : "Add"}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          </Modal>



        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ---------------- styles ---------------- */

const styles = StyleSheet.create({
  container: { flex: 1, paddingHorizontal: spacing.lg, paddingTop: spacing.lg },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  headerTitle: { fontSize: 18, fontWeight: "900", color: colors.textPrimary },
  headerSubtitle: { marginTop: 2, fontSize: 13, color: colors.textSecondary, fontWeight: "700" },

  headerSaveBtn: {
    marginLeft: spacing.sm,
    paddingHorizontal: 12,
    height: 36,
    borderRadius: 12,
    backgroundColor: colors.accentBlue,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
  },
  headerSaveText: { color: "#fff", fontWeight: "900", fontSize: 13 },

  card: {
    borderRadius: radius.xl,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    marginBottom: spacing.lg,
    ...(shadows?.sm || {}),
  },
  cardTitle: { fontSize: 15, fontWeight: "900", color: colors.textPrimary },

  label: { fontSize: 12, color: colors.textSecondary, marginBottom: 4, marginTop: spacing.md, fontWeight: "700" },
  helper: { marginTop: spacing.sm, fontSize: 12, color: colors.textMuted, fontWeight: "700" },

  input: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
    fontSize: 13,
    color: colors.textPrimary,
  },
  multiline: { minHeight: 140 },

  row: { flexDirection: "row", gap: spacing.md, marginTop: spacing.md },

  toggleRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.md },
  togglePill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    backgroundColor: colors.surfaceSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
  },
  toggleActivePrimary: { backgroundColor: colors.accentBlue, borderColor: colors.accentBlue },
  toggleActiveSoft: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft },
  toggleText: { fontSize: 12, color: colors.textSecondary, fontWeight: "800" },
  toggleTextActive: { color: colors.brandWhite },
  toggleTextSoftActive: { color: colors.accentBlue },

  inlineLoading: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  inlineLoadingText: { marginLeft: spacing.sm, fontSize: 12, color: colors.textSecondary },

  selector: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  selectorText: { fontSize: 13, color: colors.textPrimary, fontWeight: "800" },
  selectorPlaceholder: { fontSize: 13, color: colors.textMuted, fontWeight: "800" },

  errorText: { marginTop: spacing.sm, color: colors.accentRed, fontSize: 13 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxHeight: "70%",
    borderRadius: radius.xl,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...(shadows?.lg || {}),
  },
  modalHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  modalTitle: { fontSize: 15, fontWeight: "900", color: colors.textPrimary },
  modalCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  modalOptionRow: {
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderSubtle,
  },
  modalOptionText: { fontSize: 13, color: colors.textSecondary, fontWeight: "700" },
  modalOptionTextActive: { fontSize: 13, color: colors.accentBlue, fontWeight: "900" },
  quickAddRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginBottom: 10,
  },
  quickAddText: {
    marginLeft: 8,
    fontSize: 13,
    color: colors.textPrimary,
    fontWeight: "700",
  },
  quickAddCard: {
    width: "92%",
    maxWidth: 460,
    borderRadius: 16,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...(shadows?.sm || {}),
  },
  quickAddHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: 10,
    lineHeight: 18,
  },
  quickAddInput: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
  },
  inlineErrorBox: {
    marginTop: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
  },
  inlineErrorText: {
    fontSize: 12,
    color: colors.textPrimary,
    lineHeight: 16,
    fontWeight: "700",
  },
  quickAddButtonsRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.md,
  },
  quickAddBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },
  quickAddBtnSecondary: {
    backgroundColor: colors.surfaceSubtle,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  quickAddBtnSecondaryText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  quickAddBtnPrimary: {
    marginLeft: 8,
    backgroundColor: colors.brandBlue,
  },
  quickAddBtnPrimaryText: {
    color: colors.brandWhite,
    fontSize: 12,
    fontWeight: "900",
  },

});
