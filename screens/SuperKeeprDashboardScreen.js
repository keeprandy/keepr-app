// screens/SuperKeeprDashboardScreen.js
import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  Image,
  Modal,
  Alert,
  useWindowDimensions,
  ActivityIndicator,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";

import { layoutStyles } from "../styles/layout";
import { colors, shadows } from "../styles/theme";

import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

const LIFECYCLE_STATES = [
  "Under Contract",
  "Owned – Pre-Rehab",
  "Active Rehab",
  "Stabilized",
  "Leased",
  "For Sale / Wholesale",
  "Sold",
];

const SORT_OPTIONS = [
  { key: "created_desc", label: "Newest" },
  { key: "state_days_desc", label: "Days in state" },
  { key: "name_asc", label: "Name" },
];

function getMd(asset) {
  return asset?.extra_metadata && typeof asset.extra_metadata === "object"
    ? asset.extra_metadata
    : {};
}

function getLifecycleState(asset) {
  const md = getMd(asset);
  return md.lifecycle_state || "Owned – Pre-Rehab";
}

function daysSince(dateStrOrIso) {
  if (!dateStrOrIso) return null;
  const d = new Date(dateStrOrIso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function safeTitle(asset) {
  return asset?.name || "Untitled";
}

function safeSubtitle(asset) {
  const md = getMd(asset);
  const line1 = md.address_line1 || md.address || md.street || "";
  const city = md.city || "";
  const state = md.state || "";
  const zip = md.zip || "";
  const parts = [line1, [city, state, zip].filter(Boolean).join(", ")].filter(
    Boolean
  );
  return parts.join(" • ") || asset?.location || "";
}

function pickHeroUri(asset) {
  const md = getMd(asset);
  return (
    asset?.hero_image_url ||
    md.hero_url ||
    md.primary_photo_url ||
    md.image_url ||
    null
  );
}

function parseCsvLoose(csvText) {
  const lines = csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length < 2) return { headers: [], rows: [] };

  const headers = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map((line) => {
    const cols = splitCsvLine(line);
    const obj = {};
    headers.forEach((h, idx) => (obj[h] = (cols[idx] || "").trim()));
    return obj;
  });

  return { headers, rows };
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      const next = line[i + 1];
      if (inQuotes && next === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export default function SuperKeeprDashboardScreen({ navigation }) {
  const { width: windowWidth } = useWindowDimensions();
  const { user } = useAuth();

  const [assetClass, setAssetClass] = useState("homes"); // homes | boats | vehicles
  const [loading, setLoading] = useState(true);
  const [assets, setAssets] = useState([]);

  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("All");
  const [sortKey, setSortKey] = useState("created_desc");

  // ✅ Measure actual available content width (important on web w/ sidebar + maxWidth shells)
  const [containerWidth, setContainerWidth] = useState(null);
  const effectiveWidth = containerWidth || windowWidth;

  // CSV import
  const [importOpen, setImportOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [importDefaultState, setImportDefaultState] = useState(
    "Owned – Pre-Rehab"
  );

  const cardGap = 14;
  const listSidePadding = 24;

  // ✅ Cap at 3 columns max
  const numColumns = useMemo(() => {
    // Use effective width, not browser window width
    if (effectiveWidth >= 1024) return 3;
    if (effectiveWidth >= 720) return 2;
    return 1;
  }, [effectiveWidth]);

  const cardWidth = useMemo(() => {
    const inner = Math.max(
      0,
      Math.floor(effectiveWidth - listSidePadding * 2)
    );
    const totalGaps = cardGap * (numColumns - 1);
    const w = Math.floor((inner - totalGaps) / numColumns);
    return Math.max(260, w); // keep a sane minimum so cards don’t collapse
  }, [effectiveWidth, numColumns]);

  const heroHeight = useMemo(
    () => Math.round((cardWidth * 9) / 16),
    [cardWidth]
  );

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    try {
      let subtypes = ["home", "property", "rental"];
      if (assetClass === "boats") subtypes = ["boat", "marine"];
      if (assetClass === "vehicles")
        subtypes = ["vehicle", "car", "motorcycle", "rv"];

      const { data, error } = await supabase
        .from("assets")
        .select("*")
        .in("asset_subtype", subtypes)
        .order("created_at", { ascending: false });

      if (error) throw error;
      setAssets(data || []);
    } catch (e) {
      console.error(e);
      Alert.alert("Error", e?.message || "Failed to load portfolio.");
    } finally {
      setLoading(false);
    }
  }, [assetClass]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = (assets || []).filter((a) => {
      const state = getLifecycleState(a);
      if (stateFilter !== "All" && state !== stateFilter) return false;

      if (!q) return true;

      const t = safeTitle(a).toLowerCase();
      const s = safeSubtitle(a).toLowerCase();
      const md = JSON.stringify(getMd(a)).toLowerCase();
      return t.includes(q) || s.includes(q) || md.includes(q);
    });

    list = list.map((a) => {
      const md = getMd(a);
      const stateEnteredAt =
        md.lifecycle_state_entered_at || a.created_at || null;
      return { ...a, _stateDays: daysSince(stateEnteredAt) ?? 0 };
    });

    switch (sortKey) {
      case "state_days_desc":
        list.sort((a, b) => (b._stateDays || 0) - (a._stateDays || 0));
        break;
      case "name_asc":
        list.sort((a, b) => safeTitle(a).localeCompare(safeTitle(b)));
        break;
      case "created_desc":
      default:
        list.sort(
          (a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)
        );
        break;
    }

    return list;
  }, [assets, query, stateFilter, sortKey]);

  const openAsset = useCallback(
    (asset) => {
      navigation.navigate("HomeStory", {
        homeId: asset.id,
        homeName: asset.name,
      });
    },
    [navigation]
  );

  const updateLifecycleState = useCallback(
    async (assetId, newState) => {
      try {
        const asset = assets.find((a) => a.id === assetId);
        if (!asset) return;

        const nowIso = new Date().toISOString();
        const nextMd = {
          ...getMd(asset),
          lifecycle_state: newState,
          lifecycle_state_entered_at: nowIso,
        };

        const { error } = await supabase
          .from("assets")
          .update({ extra_metadata: nextMd })
          .eq("id", assetId);

        if (error) throw error;

        setAssets((prev) =>
          prev.map((a) =>
            a.id === assetId ? { ...a, extra_metadata: nextMd } : a
          )
        );
      } catch (e) {
        console.error(e);
        Alert.alert("Error", e?.message || "Failed to update state.");
      }
    },
    [assets]
  );

  const pickCsv = useCallback(async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "application/vnd.ms-excel",
        ],
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (res.canceled) return;
      const file = res.assets?.[0];
      if (!file?.uri) return;

      const text = await FileSystem.readAsStringAsync(file.uri);
      const parsed = parseCsvLoose(text);

      if (!parsed.rows.length) {
        Alert.alert("CSV", "No rows found. Please check the file format.");
        return;
      }

      setImportPreview(parsed);
    } catch (e) {
      console.error(e);
      Alert.alert("CSV import", e?.message || "Failed to read CSV.");
    }
  }, []);

  const createHomeAssetFromRow = useCallback(
    async (row) => {
      if (!user?.id) throw new Error("No user session");

      const address = row.address_line1 || row.address || row.street || "";
      const city = row.city || "";
      const st = row.state || "";
      const zip = row.zip || "";

      const name = row.name || address || "Imported Home";
      const location = [city, st, zip].filter(Boolean).join(" ");

      const purchasePrice = row.purchase_price
        ? Number(String(row.purchase_price).replace(/[^0-9.]/g, ""))
        : null;

      const md = {
        address_line1: address,
        city,
        state: st,
        zip,
        lifecycle_state: importDefaultState,
        lifecycle_state_entered_at: new Date().toISOString(),
        fit_type: row.fit_type || null,
        import_source: "csv",
      };

      const insertPayload = {
        owner_id: user.id,
        name,
        type: "home",
        asset_subtype: "home",
        location: location || null,
        purchase_date: row.purchase_date || null,
        purchase_price: purchasePrice,
        beds: row.beds ? Number(row.beds) : null,
        baths: row.baths ? Number(row.baths) : null,
        square_feet: row.sqft ? Number(row.sqft) : null,
        extra_metadata: md,
      };

      const { data, error } = await supabase
        .from("assets")
        .insert(insertPayload)
        .select("*")
        .single();

      if (error) throw error;
      return data;
    },
    [importDefaultState, user?.id]
  );

  const runImport = useCallback(async () => {
    if (!importPreview?.rows?.length) return;

    setImportLoading(true);
    try {
      const rows = importPreview.rows.slice(0, 500);

      const created = [];
      for (const row of rows) {
        const address = row.address_line1 || row.address || row.street || "";
        if (!address) continue;
        const asset = await createHomeAssetFromRow(row);
        created.push(asset);
      }

      setImportOpen(false);
      setImportPreview(null);

      await fetchAssets();
      Alert.alert("Import complete", `Created ${created.length} homes.`);
    } catch (e) {
      console.error(e);
      Alert.alert("Import failed", e?.message || "Failed to import homes.");
    } finally {
      setImportLoading(false);
    }
  }, [importPreview, createHomeAssetFromRow, fetchAssets]);

  const seedDemoHomes = useCallback(async () => {
    try {
      if (!user?.id) throw new Error("No user session");

      const nowIso = new Date().toISOString();

      const demo = [
        {
          name: "123 Maple St",
          md: {
            address_line1: "123 Maple St",
            city: "Cornelius",
            state: "NC",
            zip: "28031",
            lifecycle_state: "Under Contract",
            lifecycle_state_entered_at: nowIso,
            fit_type: "Repairs / updates",
          },
        },
        {
          name: "88 Oak Ave",
          md: {
            address_line1: "88 Oak Ave",
            city: "Huntersville",
            state: "NC",
            zip: "28078",
            lifecycle_state: "Owned – Pre-Rehab",
            lifecycle_state_entered_at: nowIso,
            fit_type: "Distressed",
          },
        },
        {
          name: "14 Lakeview Dr",
          md: {
            address_line1: "14 Lakeview Dr",
            city: "Mooresville",
            state: "NC",
            zip: "28117",
            lifecycle_state: "Active Rehab",
            lifecycle_state_entered_at: nowIso,
            fit_type: "As-is cash sale",
          },
        },
        {
          name: "702 Pine Ct",
          md: {
            address_line1: "702 Pine Ct",
            city: "Cornelius",
            state: "NC",
            zip: "28031",
            lifecycle_state: "Stabilized",
            lifecycle_state_entered_at: nowIso,
            fit_type: "Off-market",
          },
        },
      ];

      const payload = demo.map((d) => ({
        owner_id: user.id,
        name: d.name,
        type: "home",
        asset_subtype: "home",
        location: [d.md.city, d.md.state, d.md.zip].filter(Boolean).join(" "),
        extra_metadata: d.md,
      }));

      const { error } = await supabase.from("assets").insert(payload);
      if (error) throw error;

      await fetchAssets();
      Alert.alert("Seeded", "Demo homes created.");
    } catch (e) {
      console.error(e);
      Alert.alert("Seed failed", e?.message || "Could not seed demo homes.");
    }
  }, [user?.id, fetchAssets]);

  const renderCard = ({ item }) => {
    const heroUri = pickHeroUri(item);
    const state = getLifecycleState(item);

    return (
      <TouchableOpacity
        onPress={() => openAsset(item)}
        activeOpacity={0.9}
        style={[
          styles.card,
          {
            width: cardWidth,
            marginBottom: cardGap,
          },
        ]}
      >
        <View style={[styles.heroWrap, { height: heroHeight }]}>
          {heroUri ? (
            <Image source={{ uri: heroUri }} style={styles.hero} resizeMode="cover" />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="image-outline" size={28} color={colors.textMuted} />
              <Text style={styles.heroPlaceholderText}>No photo</Text>
            </View>
          )}

          <View style={styles.statePill}>
            <Text style={styles.statePillText}>{state}</Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {safeTitle(item)}
          </Text>
          <Text style={styles.cardSubtitle} numberOfLines={2}>
            {safeSubtitle(item)}
          </Text>

          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {item._stateDays != null ? `${item._stateDays}d in state` : ""}
            </Text>
            <Text style={styles.metaText}>
              {item.created_at ? `Created ${daysSince(item.created_at)}d ago` : ""}
            </Text>
          </View>

          <View style={styles.quickRow}>
            <TouchableOpacity
              onPress={(e) => {
                e.stopPropagation?.();
                const idx = Math.max(0, LIFECYCLE_STATES.indexOf(state));
                const next = LIFECYCLE_STATES[(idx + 1) % LIFECYCLE_STATES.length];
                updateLifecycleState(item.id, next);
              }}
              style={styles.quickBtn}
              activeOpacity={0.85}
            >
              <Ionicons name="swap-horizontal" size={16} color={colors.textPrimary} />
              <Text style={styles.quickBtnText}>Advance</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const header = (
    <View style={styles.top}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.h1}>SuperKeepr</Text>
          <Text style={styles.h2}>Portfolio stewardship dashboard</Text>
        </View>

        <TouchableOpacity
          style={styles.importBtn}
          onPress={() => {
            setImportOpen(true);
            setImportPreview(null);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="cloud-upload-outline" size={18} color={colors.brandWhite} />
          <Text style={styles.importBtnText}>Import CSV</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.assetClassRow}>
        {[
          { key: "homes", label: "Homes" },
          { key: "boats", label: "Boats" },
          { key: "vehicles", label: "Vehicles / RVs" },
        ].map((t) => {
          const active = assetClass === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              onPress={() => setAssetClass(t.key)}
              style={[styles.classPill, active ? styles.classPillActive : null]}
              activeOpacity={0.85}
            >
              <Text style={[styles.classPillText, active ? styles.classPillTextActive : null]}>
                {t.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search address, name, notes…"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => {
            const idx = SORT_OPTIONS.findIndex((s) => s.key === sortKey);
            const next = SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length].key;
            setSortKey(next);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="swap-vertical" size={18} color={colors.textPrimary} />
          <Text style={styles.sortText}>
            {SORT_OPTIONS.find((s) => s.key === sortKey)?.label}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.filterRow}>
        <TouchableOpacity
          onPress={() => setStateFilter("All")}
          style={[styles.filterPill, stateFilter === "All" ? styles.filterPillActive : null]}
          activeOpacity={0.85}
        >
          <Text style={[styles.filterText, stateFilter === "All" ? styles.filterTextActive : null]}>
            All
          </Text>
        </TouchableOpacity>

        {LIFECYCLE_STATES.map((s) => {
          const active = stateFilter === s;
          return (
            <TouchableOpacity
              key={s}
              onPress={() => setStateFilter(s)}
              style={[styles.filterPill, active ? styles.filterPillActive : null]}
              activeOpacity={0.85}
            >
              <Text style={[styles.filterText, active ? styles.filterTextActive : null]}>{s}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          {filtered.length} assets • {stateFilter === "All" ? "All states" : stateFilter}
        </Text>

        <View style={{ flexDirection: "row", gap: 10 }}>
          {filtered.length === 0 ? (
            <TouchableOpacity onPress={seedDemoHomes} style={styles.seedBtn} activeOpacity={0.85}>
              <Ionicons name="sparkles-outline" size={18} color={colors.textPrimary} />
              <Text style={styles.seedText}>Seed demo homes</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity onPress={fetchAssets} style={styles.refreshBtn} activeOpacity={0.85}>
            <Ionicons name="refresh" size={18} color={colors.textPrimary} />
            <Text style={styles.refreshText}>Refresh</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View
        style={[layoutStyles?.container, { flex: 1, width: "100%" }]}
        onLayout={(e) => {
          const w = e?.nativeEvent?.layout?.width;
          if (w && Math.abs(w - (containerWidth || 0)) > 1) setContainerWidth(w);
        }}
      >
        {header}

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>Loading portfolio…</Text>
          </View>
        ) : (
          <FlatList
            style={{ flex: 1, width: "100%" }}
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={renderCard}
            numColumns={numColumns}
            key={numColumns}
            contentContainerStyle={{
              paddingHorizontal: listSidePadding,
              paddingBottom: 36,
            }}
            columnWrapperStyle={
              numColumns > 1 ? { gap: cardGap } : null
            }
            showsVerticalScrollIndicator={false}
          />
        )}

        <Modal visible={importOpen} animationType="slide" transparent={true}>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Import Homes by CSV</Text>
                <TouchableOpacity
                  onPress={() => {
                    if (!importLoading) {
                      setImportOpen(false);
                      setImportPreview(null);
                    }
                  }}
                  style={styles.modalClose}
                  activeOpacity={0.85}
                >
                  <Ionicons name="close" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.modalHint}>
                Required: address (or address_line1/street), city, state, zip.
                Optional: name, beds, baths, sqft, purchase_price, purchase_date.
              </Text>

              <View style={styles.modalRow}>
                <Text style={styles.modalLabel}>Default lifecycle state</Text>
                <View style={styles.modalStateRow}>
                  {LIFECYCLE_STATES.slice(0, 4).map((s) => {
                    const active = importDefaultState === s;
                    return (
                      <TouchableOpacity
                        key={s}
                        onPress={() => setImportDefaultState(s)}
                        style={[styles.smallPill, active ? styles.smallPillActive : null]}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.smallPillText, active ? styles.smallPillTextActive : null]}>
                          {s}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity onPress={pickCsv} style={styles.secondaryBtn} activeOpacity={0.85}>
                  <Ionicons name="document-text-outline" size={18} color={colors.textPrimary} />
                  <Text style={styles.secondaryBtnText}>Choose CSV</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={runImport}
                  style={[
                    styles.primaryBtn,
                    !importPreview || importLoading ? styles.primaryBtnDisabled : null,
                  ]}
                  disabled={!importPreview || importLoading}
                  activeOpacity={0.85}
                >
                  {importLoading ? (
                    <ActivityIndicator color={colors.brandWhite} />
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={18} color={colors.brandWhite} />
                      <Text style={styles.primaryBtnText}>Create assets</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>

              {importPreview ? (
                <View style={styles.previewBox}>
                  <Text style={styles.previewTitle}>
                    Preview ({Math.min(importPreview.rows.length, 8)} of {importPreview.rows.length})
                  </Text>
                  {importPreview.rows.slice(0, 8).map((r, idx) => {
                    const address = r.address_line1 || r.address || r.street || "(missing)";
                    const city = r.city || "";
                    const st = r.state || "";
                    const zip = r.zip || "";
                    return (
                      <Text key={idx} style={styles.previewRow} numberOfLines={1}>
                        {address} • {[city, st, zip].filter(Boolean).join(" ")}
                      </Text>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.previewEmpty}>
                  <Ionicons name="cloud-upload-outline" size={22} color={colors.textMuted} />
                  <Text style={styles.previewEmptyText}>No file selected yet.</Text>
                </View>
              )}
            </View>
          </View>
        </Modal>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  top: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  h1: { fontSize: 22, fontWeight: "700", color: colors.textPrimary },
  h2: { marginTop: 2, color: colors.textMuted, fontSize: 13 },

  importBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.brandBlue,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
  },
  importBtnText: { color: colors.brandWhite, fontWeight: "700", fontSize: 13 },

  assetClassRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    flexWrap: "wrap",
  },
  classPill: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  classPillActive: { backgroundColor: colors.textPrimary },
  classPillText: { color: colors.textPrimary, fontWeight: "600", fontSize: 13 },
  classPillTextActive: { color: colors.brandWhite },

  searchRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#11182722",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14 },
  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  sortText: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },

  filterRow: { marginTop: 12, flexDirection: "row", gap: 8, flexWrap: "wrap" },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  filterPillActive: { backgroundColor: colors.brandBlue, borderColor: colors.brandBlue },
  filterText: { color: colors.textPrimary, fontWeight: "600", fontSize: 12 },
  filterTextActive: { color: colors.brandWhite },

  summaryRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  summaryText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },

  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  refreshText: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },

  seedBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: "#11182711",
  },
  seedText: { color: colors.textPrimary, fontSize: 13, fontWeight: "700" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: colors.textMuted },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#11182722",
    ...(shadows?.subtle || {}),
  },
  heroWrap: { position: "relative", width: "100%", backgroundColor: "#111" },
  hero: { width: "100%", height: "100%" },
  heroPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#f2f3f5",
  },
  heroPlaceholderText: { color: colors.textMuted, fontWeight: "600" },

  statePill: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statePillText: { color: "white", fontWeight: "800", fontSize: 11 },

  cardBody: { padding: 12 },
  cardTitle: { color: colors.textPrimary, fontWeight: "800", fontSize: 15 },
  cardSubtitle: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  metaRow: { marginTop: 10, flexDirection: "row", justifyContent: "space-between" },
  metaText: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },

  quickRow: { marginTop: 12, flexDirection: "row", gap: 10 },
  quickBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: "#f2f3f5",
  },
  quickBtnText: { fontWeight: "800", fontSize: 12, color: colors.textPrimary },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    width: "100%",
    maxWidth: 760,
    backgroundColor: colors.surface,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },
  modalClose: { padding: 8, borderRadius: 10 },

  modalHint: {
    marginTop: 10,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  modalRow: { marginTop: 12 },
  modalLabel: { color: colors.textPrimary, fontWeight: "800", fontSize: 12, marginBottom: 8 },
  modalStateRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },

  smallPill: { paddingHorizontal: 10, paddingVertical: 7, borderRadius: 999, backgroundColor: "#f2f3f5" },
  smallPillActive: { backgroundColor: colors.brandBlue },
  smallPillText: { fontSize: 11, fontWeight: "800", color: colors.textPrimary },
  smallPillTextActive: { color: colors.brandWhite },

  modalActions: { marginTop: 14, flexDirection: "row", gap: 10, justifyContent: "space-between" },
  secondaryBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#11182722",
  },
  secondaryBtnText: { fontWeight: "800", color: colors.textPrimary },

  primaryBtn: {
    flex: 1,
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: colors.brandBlue,
  },
  primaryBtnDisabled: { opacity: 0.45 },
  primaryBtnText: { fontWeight: "900", color: colors.brandWhite },

  previewBox: { marginTop: 14, backgroundColor: "#f7f8fa", borderRadius: 14, padding: 12 },
  previewTitle: { fontWeight: "900", color: colors.textPrimary, marginBottom: 8 },
  previewRow: { color: colors.textMuted, fontWeight: "700", fontSize: 12, marginBottom: 6 },

  previewEmpty: {
    marginTop: 14,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 22,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#11182722",
    borderStyle: "dashed",
  },
  previewEmptyText: { marginTop: 8, color: colors.textMuted, fontWeight: "700" },
});
