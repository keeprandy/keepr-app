// screens/OwnerSystemsPackagePrintScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "../lib/supabaseClient";
import { exportToXlsx } from "../utils/exportPackageToXlsx";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAvoidingView } from "react-native";

function MobileField({ label, value, editable = false, render = null }) {
  return (
    <View style={styles.mobileField}>
      <Text style={styles.mobileFieldLabel}>{label}</Text>
      {editable && typeof render === "function" ? (
        render()
      ) : (
        <Text style={styles.mobileFieldValue} numberOfLines={2}>
          {value || "—"}
        </Text>
      )}
    </View>
  );
}

/**
 * Owner Systems Inventory (Package Print + Editable)
 *
 * Date display standard: DD-MM-YYYY everywhere in THIS screen.
 * Storage: keep ISO (YYYY-MM-DD) in metadata; we normalize on save.
 *
 * REQUIRED row JSON (from generate_owner_systems_package):
 * - system_id (uuid)
 * - assigned_keepr_pro_id (uuid, optional but recommended)
 */
export default function OwnerSystemsPackagePrintScreen({ route, navigation }) {
  const packageId = route?.params?.packageId || null;
  const isWeb = Platform.OS === "web";

  const [pkg, setPkg] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // Edit mode
  const [editMode, setEditMode] = useState(false);
  const [draft, setDraft] = useState({}); // { [system_id]: { ...editable fields } }
  const [saving, setSaving] = useState(false);

  // KeeprPros picker (for assignment)
  const [keeprPros, setKeeprPros] = useState([]);
  const [pickForSystemId, setPickForSystemId] = useState(null);
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");


  // ---------------------------
  // Date helpers (MM-DD-YYYY UI)
  // ---------------------------
  const pad2 = (n) => String(n).padStart(2, "0");

  const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  const isDdMmYyyy = (s) => /^\d{2}-\d{2}-\d{4}$/.test(String(s || "").trim());

const formatDDMMYYYY = (value) => {
  const s = String(value || "").trim();
  if (!s) return "";

  if (isDdMmYyyy(s)) {
    const [d, m, y] = s.split("-");
    return `${m}/${d}/${y}`;
  }

  if (isIsoDate(s)) {
    const [y, m, d] = s.split("-");
    return `${m}/${d}/${y}`;
  }

  const raw = s.slice(0, 10);
  if (isIsoDate(raw)) {
    const [y, m, d] = raw.split("-");
    return `${m}/${d}/${y}`;
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s;

  return `${pad2(dt.getMonth() + 1)}/${pad2(dt.getDate())}/${dt.getFullYear()}`;
};

  const toIsoDateOrEmpty = (value) => {
    const s = String(value || "").trim();
    if (!s) return "";
    if (isIsoDate(s)) return s;
    if (isDdMmYyyy(s)) {
      const [d, m, y] = s.split("-");
      return `${y}-${m}-${d}`;
    }
    const dt = new Date(s);
    if (Number.isNaN(dt.getTime())) return ""; // invalid -> empty (we won't overwrite with junk)
    return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
  };

  const isValidDateInput = (value) => {
    const s = String(value || "").trim();
    if (!s) return true;
    if (isIsoDate(s) || isDdMmYyyy(s)) return true;
    const dt = new Date(s);
    return !Number.isNaN(dt.getTime());
  };

  const safeStr = (v) => (v == null ? "" : String(v));
  const isPresent = (v) => safeStr(v).trim().length > 0;

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!packageId) {
        setErr("Missing packageId.");
        setLoading(false);
        return;
      }

      setLoading(true);
      setErr("");

      try {
        const { data: pkgData, error: pkgErr } = await supabase
          .from("packages")
          .select("id, asset_id, package_type, title, status, generated_at, totals, snapshot_meta")
          .eq("id", packageId)
          .single();

        if (pkgErr) throw pkgErr;

        const { data: rowData, error: rowErr } = await supabase
          .from("package_rows")
          .select("row_index, row")
          .eq("package_id", packageId)
          .order("row_index", { ascending: true });

        if (rowErr) throw rowErr;

        const { data: proData, error: proErr } = await supabase
          .from("keepr_pros")
          .select("id, name")
          .order("name", { ascending: true });

        if (proErr) console.log("[OwnerSystemsInventory] keepr_pros load error:", proErr);

        if (!cancelled) {
          setPkg(pkgData || null);
          setRows(rowData || []);
          setKeeprPros(proData || []);
        }
      } catch (e) {
        if (!cancelled) setErr(e?.message || "Failed to load package.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [packageId]);

  const onPrint = () => {
    if (!isWeb) return;
    setTimeout(() => window.print(), 50);
  };

  const onExportExcel = async () => {
    const items = (rows || []).map((r) => r.row || {});
    const excelRows = items.map((r) => ({
      System: r.system_name || "",
      Type: r.system_type || "",
      Location: r.location || "",
      Brand: r.manufacturer || "",
      Model: r.model || "",
      Serial: r.serial_number || "",
      WarrantyProvider: r.warranty_provider || "",
      WarrantyExpires: formatDDMMYYYY(r.warranty_expires || ""),
      AssignedKeeprPro: r.assigned_keepr_pro || "",
      LastServiceDate: formatDDMMYYYY(r.last_service_date || ""),
      ServiceCount: Number(r.service_count ?? 0) || 0,
      ProofCount: Number(r.proof_count ?? 0) || 0,
      Status: r.status || "",
      Notes: r.notes || "",
    }));

    const assetName = pkg?.snapshot_meta?.asset_name || "Asset";
    const title = pkg?.title || "Owner Systems Inventory";

    await exportToXlsx({
      fileName: `${assetName} - ${title}`,
      sheets: [{ name: "Systems Inventory", rows: excelRows }],
    });
  };

  const computed = useMemo(() => {
    const items = rows.map((r) => r.row || {});
    const totals = pkg?.totals || {};

    const systemsCount = Number.isFinite(totals.row_count) ? totals.row_count : items.length;
    const proofTotal = Number.isFinite(totals.proof_count)
      ? totals.proof_count
      : items.reduce((sum, x) => sum + (Number(x.proof_count ?? 0) || 0), 0);

    const assignedCount = items.filter((x) => isPresent(x.assigned_keepr_pro)).length;

    const warrantyTrackedCount = items.filter(
      (x) => isPresent(x.warranty_expires) || isPresent(x.warranty_provider)
    ).length;

    const identityCompleteCount = items.filter(
      (x) => isPresent(x.manufacturer) && isPresent(x.model) && isPresent(x.serial_number)
    ).length;

const sorted = [...items].sort((a, b) =>
  safeStr(a.system_name).toLowerCase().localeCompare(
    safeStr(b.system_name).toLowerCase()
  )
);

    return {
      items: sorted,
      summary: {
        systemsCount,
        proofTotal,
        assignedCount,
        warrantyTrackedCount,
        identityCompleteCount,
      },
      header: {
        assetName: pkg?.snapshot_meta?.asset_name || "Asset",
        generatedLabel: pkg?.generated_at ? new Date(pkg.generated_at).toLocaleString() : "",
      },
    };
  }, [pkg, rows]);

const filteredItems = computed.items.filter((r) =>
  safeStr(r.system_name)
    .toLowerCase()
    .includes(query.toLowerCase())
);

  const enterEditMode = () => {
    const items = rows.map((r) => r.row || {});
    const d = {};
    for (const it of items) {
      if (!it.system_id) continue;
      d[it.system_id] = {
        system_id: it.system_id,
        location: safeStr(it.location),
        manufacturer: safeStr(it.manufacturer),
        model: safeStr(it.model),
        serial_number: safeStr(it.serial_number),
        warranty_provider: safeStr(it.warranty_provider),
        // Show in DD-MM-YYYY for edit UX
        warranty_expires: formatDDMMYYYY(it.warranty_expires),
        assigned_keepr_pro_id: it.assigned_keepr_pro_id || null,
        assigned_keepr_pro: safeStr(it.assigned_keepr_pro),
      };
    }
    setDraft(d);
    setEditMode(true);
  };

  const cancelEditMode = () => {
    setEditMode(false);
    setDraft({});
    setErr("");
    setPickForSystemId(null);
  };

  const setDraftField = (systemId, key, value) => {
    setDraft((prev) => ({
      ...prev,
      [systemId]: { ...(prev[systemId] || { system_id: systemId }), [key]: value },
    }));
  };

  const isRowDirty = (rowObj) => {
    const sid = rowObj.system_id;
    if (!sid) return false;
    const d = draft[sid];
    if (!d) return false;

    const cmp = (a, b) => safeStr(a).trim() !== safeStr(b).trim();

    const rowWarrantyDDMM = formatDDMMYYYY(rowObj.warranty_expires);

    return (
      cmp(d.location, rowObj.location) ||
      cmp(d.manufacturer, rowObj.manufacturer) ||
      cmp(d.model, rowObj.model) ||
      cmp(d.serial_number, rowObj.serial_number) ||
      cmp(d.warranty_provider, rowObj.warranty_provider) ||
      cmp(d.warranty_expires, rowWarrantyDDMM) ||
      (d.assigned_keepr_pro_id || null) !== (rowObj.assigned_keepr_pro_id || null)
    );
  };

  const dirtyCount = useMemo(() => {
    if (!editMode) return 0;
    const items = rows.map((r) => r.row || {});
    return items.filter((it) => it.system_id && isRowDirty(it)).length;
  }, [editMode, rows, draft]);

  const saveEdits = async () => {
    try {
      setSaving(true);
      setErr("");

      const items = rows.map((r) => r.row || {});
      const dirty = items.filter((it) => it.system_id && isRowDirty(it));

      if (dirty.length === 0) {
        setEditMode(false);
        setDraft({});
        return;
      }

      // Validate dates softly: we won't overwrite with an invalid date string
      for (const it of dirty) {
        const sid = it.system_id;
        const d = draft[sid] || {};
        if (!isValidDateInput(d.warranty_expires)) {
          throw new Error("Warranty Expires has an invalid date. Use DD-MM-YYYY (preferred) or YYYY-MM-DD.");
        }
      }

      const systemIds = dirty.map((d) => d.system_id);

      const { data: sysData, error: sysErr } = await supabase
        .from("systems")
        .select("id, metadata")
        .in("id", systemIds);

      if (sysErr) throw sysErr;

      const byId = {};
      (sysData || []).forEach((s) => {
        byId[s.id] = s.metadata || {};
      });

      for (const it of dirty) {
        const sid = it.system_id;
        const current = byId[sid] || {};
        const d = draft[sid] || {};

        const next = { ...(current || {}) };
        next.standard = { ...(next.standard || {}) };
        next.standard.identity = { ...(next.standard.identity || {}) };
        next.standard.warranty = { ...(next.standard.warranty || {}) };
        next.standard.relationships = { ...(next.standard.relationships || {}) };

        // Identity
        next.standard.identity.location = safeStr(d.location).trim();
        next.standard.identity.manufacturer = safeStr(d.manufacturer).trim();
        next.standard.identity.model = safeStr(d.model).trim();
        next.standard.identity.serial_number = safeStr(d.serial_number).trim();

        // Warranty (store ISO)
        next.standard.warranty.provider = safeStr(d.warranty_provider).trim();

        const iso = toIsoDateOrEmpty(d.warranty_expires);
        if (String(d.warranty_expires || "").trim() === "") {
          next.standard.warranty.expires = "";
        } else if (iso) {
          next.standard.warranty.expires = iso;
        }
        // If iso is empty (invalid), we already errored above.

        // Assignment (primary)
        const proId = d.assigned_keepr_pro_id || null;
        next.standard.relationships.keepr_pro_ids = proId ? [proId] : [];

        const { error: upErr } = await supabase.from("systems").update({ metadata: next }).eq("id", sid);
        if (upErr) throw upErr;
      }

      // Update visible table rows locally (keep package stable)
      const nextRows = rows.map((r) => {
        const rowObj = r.row || {};
        const sid = rowObj.system_id;
        if (!sid || !draft[sid]) return r;

        const d = draft[sid];
        const proName =
          d.assigned_keepr_pro_id && keeprPros.length
            ? keeprPros.find((p) => p.id === d.assigned_keepr_pro_id)?.name || ""
            : "";

        const iso = toIsoDateOrEmpty(d.warranty_expires);

        return {
          ...r,
          row: {
            ...rowObj,
            location: safeStr(d.location).trim(),
            manufacturer: safeStr(d.manufacturer).trim(),
            model: safeStr(d.model).trim(),
            serial_number: safeStr(d.serial_number).trim(),
            warranty_provider: safeStr(d.warranty_provider).trim(),
            // Keep ISO in row data for consistency with DB
            warranty_expires: String(d.warranty_expires || "").trim() === "" ? "" : (iso || rowObj.warranty_expires),
            assigned_keepr_pro_id: d.assigned_keepr_pro_id || null,
            assigned_keepr_pro: proName,
          },
        };
      });

      setRows(nextRows);
      setEditMode(false);
      setDraft({});
    } catch (e) {
      setErr(e?.message || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const selectKeeprPro = (systemId, proId) => {
    const proName = keeprPros.find((p) => p.id === proId)?.name || "";
    setDraftField(systemId, "assigned_keepr_pro_id", proId || null);
    setDraftField(systemId, "assigned_keepr_pro", proName);
    setPickForSystemId(null);
  };

  const clearKeeprPro = (systemId) => {
    setDraftField(systemId, "assigned_keepr_pro_id", null);
    setDraftField(systemId, "assigned_keepr_pro", "");
    setPickForSystemId(null);
  };

  const renderInput = (systemId, key, placeholder, opts = {}) => {
    const value = draft?.[systemId]?.[key] ?? "";
    const invalid = opts.kind === "date" && !isValidDateInput(value);
    return (
      <View style={{ gap: 4 }}>
        <TextInput
          value={value}
          onChangeText={(t) => setDraftField(systemId, key, t)}
          placeholder={placeholder}
          placeholderTextColor="#9aa0a6"
          style={[styles.input, value?.trim() ? null : styles.inputEmpty, invalid && styles.inputInvalid]}
        />
        {invalid ? <Text style={styles.hintBad}>Use MM/DD/YYYY</Text> : null}
      </View>
    );
  };

  if (loading) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Owner Systems Inventory</Text>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  if (err && !editMode) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Owner Systems Inventory</Text>
        <Text style={[styles.muted, { marginTop: 8 }]}>{err}</Text>

        <View style={{ marginTop: 16, flexDirection: "row", gap: 10 }}>
          <Pressable onPress={() => navigation.goBack?.()} style={styles.btn}>
            <Text style={styles.btnText}>Back</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
  <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>

      {isWeb ? (
        <style>{`
          @media print {
            nav, aside, header, footer,
            [role="navigation"],
            [data-sidebar],
            .sidebar, .SidebarNav, .sidebar-nav, .app-sidebar, .leftNav, .left-nav,
            .keepr-sidebar {
              display: none !important;
              visibility: hidden !important;
            }
            .no-print { display: none !important; }
            html, body, #root { height: auto !important; overflow: visible !important; }
            * { overflow: visible !important; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            @page { margin: 12mm; }
          }
        `}</style>
      ) : null}

      {/* Header */}
      <View style={styles.topChrome}>

      <View style={styles.header}>
        <Text style={styles.title}>{pkg?.title || "Owner Systems Inventory"}</Text>
        <Text style={styles.metaText}>
          {computed.header.assetName}
          {computed.header.generatedLabel ? ` • Generated ${computed.header.generatedLabel}` : ""}
        </Text>
        <View style={{ position: "relative" }}>
          <TextInput
            placeholder="Search systems…"
            value={query}
            onChangeText={setQuery}
            style={styles.searchInput}
            placeholderTextColor="#9CA3AF"
            returnKeyType="search"
          />

          {query.length > 0 && (
            <Pressable
              onPress={() => setQuery("")}
              style={{
                position: "absolute",
                right: 10,
                top: 10,
              }}
            >
              <Text style={{ fontSize: 16, color: "#6B7280" }}>✕</Text>
            </Pressable>
          )}
        </View>
        <View style={styles.actionsRow} className="no-print">
          <Pressable onPress={() => navigation.goBack?.()} style={[styles.btn, styles.btnSecondary]}>
            <Text style={[styles.btnText, styles.btnSecondaryText]}>Back</Text>
          </Pressable>

          <Pressable onPress={onExportExcel} style={styles.btn}>
            <Text style={styles.btnText}>Export Excel</Text>
          </Pressable>

          {isWeb ? (
            <Pressable onPress={onPrint} style={styles.btn}>
              <Text style={styles.btnText}>Print / Save PDF</Text>
            </Pressable>
          ) : null}

          {!editMode ? (
            <Pressable onPress={enterEditMode} style={[styles.btn, styles.btnPrimaryAlt]}>
              <Text style={styles.btnText}>Edit</Text>
            </Pressable>
          ) : (
            <>
              <Pressable
                onPress={saveEdits}
                disabled={saving || dirtyCount === 0}
                style={[
                  styles.btn,
                  styles.btnPrimaryAlt,
                  (saving || dirtyCount === 0) && styles.btnDisabled,
                ]}
              >
                <Text style={styles.btnText}>
                  {saving ? "Saving…" : dirtyCount > 0 ? `Save ${dirtyCount} change${dirtyCount > 1 ? "s" : ""}` : "No changes"}
                </Text>
              </Pressable>

              <Pressable
                onPress={cancelEditMode}
                disabled={saving}
                style={[styles.btn, styles.btnSecondary]}
              >
                <Text style={[styles.btnText, styles.btnSecondaryText]}>Cancel</Text>
              </Pressable>
            </>
          )}
        </View>

        {editMode && err ? <Text style={styles.errorText}>{err}</Text> : null}
      </View>
      </View>
      {/* Summary */}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: 120 }
        ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Inventory summary</Text>
        <View style={styles.summaryGrid}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Systems</Text>
            <Text style={styles.summaryValue}>{computed.summary.systemsCount}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Assigned KeeprPro</Text>
            <Text style={styles.summaryValue}>{computed.summary.assignedCount}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Warranty tracked</Text>
            <Text style={styles.summaryValue}>{computed.summary.warrantyTrackedCount}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Identity complete</Text>
            <Text style={styles.summaryValue}>{computed.summary.identityCompleteCount}</Text>
          </View>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryLabel}>Proof items</Text>
            <Text style={styles.summaryValue}>{computed.summary.proofTotal}</Text>
          </View>
        </View>

        <Text style={styles.summaryHint}>
          Dates are shown as DD-MM-YYYY. Edit mode fills gaps (serial #, warranty, assignment). Derived columns (Last/Svc/Proof) are locked.
        </Text>
      </View>

      {/* Report body */}
{isWeb ? (
  <View style={styles.table}>
    <View style={[styles.tr, styles.trHead]}>
      <Text style={[styles.th, styles.colSystem]}>System</Text>
      <Text style={[styles.th, styles.colType]}>Type</Text>
      <Text style={[styles.th, styles.colLocation]}>Location</Text>
      <Text style={[styles.th, styles.colBrand]}>Brand</Text>
      <Text style={[styles.th, styles.colModel]}>Model</Text>
      <Text style={[styles.th, styles.colSerial]}>Serial</Text>
      <Text style={[styles.th, styles.colWarranty]}>Warranty</Text>
      <Text style={[styles.th, styles.colAssigned]}>Assigned</Text>
      <Text style={[styles.th, styles.colLast]}>Last Service</Text>
      <Text style={[styles.th, styles.colNum]}>Services</Text>
      <Text style={[styles.th, styles.colNum]}>Proofs</Text>
    </View>

    {filteredItems.map((r, idx) => {
      const systemId = r.system_id || null;
      const canEditRow = editMode && !!systemId;
      const dirty = canEditRow ? isRowDirty(r) : false;

      return (
        <View
          key={`${safeStr(r.system_name)}-${idx}`}
          style={[styles.tr, dirty && styles.trDirty]}
        >
          <View style={[styles.colSystem, styles.rowCell]}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={styles.td} numberOfLines={2}>
                {safeStr(r.system_name)}
              </Text>
              {dirty ? <Text style={styles.pill}>Edited</Text> : null}
            </View>
          </View>

          <Text style={[styles.td, styles.colType]} numberOfLines={2}>
            {safeStr(r.system_type)}
          </Text>

          <View style={[styles.cell, styles.colLocation]}>
            {canEditRow ? (
              renderInput(systemId, "location", "Add location…")
            ) : (
              <Text style={styles.td} numberOfLines={2}>
                {safeStr(r.location)}
              </Text>
            )}
          </View>

          <View style={[styles.cell, styles.colBrand]}>
            {canEditRow ? (
              renderInput(systemId, "manufacturer", "Add brand…")
            ) : (
              <Text style={styles.td} numberOfLines={2}>
                {safeStr(r.manufacturer)}
              </Text>
            )}
          </View>

          <View style={[styles.cell, styles.colModel]}>
            {canEditRow ? (
              renderInput(systemId, "model", "Add model…")
            ) : (
              <Text style={styles.td} numberOfLines={2}>
                {safeStr(r.model)}
              </Text>
            )}
          </View>

          <View style={[styles.cell, styles.colSerial]}>
            {canEditRow ? (
              renderInput(systemId, "serial_number", "Add serial…")
            ) : (
              <Text style={styles.td} numberOfLines={2}>
                {safeStr(r.serial_number)}
              </Text>
            )}
          </View>

          <View style={[styles.cell, styles.colWarranty]}>
            {canEditRow ? (
              <View style={{ gap: 6 }}>
                {renderInput(systemId, "warranty_provider", "Provider…")}
                {renderInput(
                  systemId,
                  "warranty_expires",
                  "Expires (MM/DD/YYYY)…",
                  { kind: "date" }
                )}
              </View>
            ) : (
              <Text style={styles.td} numberOfLines={2}>
                {formatDDMMYYYY(r.warranty_expires) || safeStr(r.warranty_provider)}
              </Text>
            )}
          </View>

          <View style={[styles.cell, styles.colAssigned]}>
            {canEditRow ? (
              <Pressable
                onPress={() => setPickForSystemId(systemId)}
                style={[
                  styles.assignBtn,
                  draft?.[systemId]?.assigned_keepr_pro ? null : styles.assignBtnEmpty,
                ]}
              >
                <Text style={styles.assignText}>
                  {draft?.[systemId]?.assigned_keepr_pro || "Assign KeeprPro…"}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.td} numberOfLines={2}>
                {safeStr(r.assigned_keepr_pro)}
              </Text>
            )}
          </View>

          <Text style={[styles.td, styles.colLast]} numberOfLines={1}>
            {formatDDMMYYYY(r.last_service_date)}
          </Text>

          <Text style={[styles.td, styles.colNum]} numberOfLines={1}>
            {r.service_count ?? 0}
          </Text>

          <Text style={[styles.td, styles.colNum]} numberOfLines={1}>
            {r.proof_count ?? 0}
          </Text>
        </View>
      );
    })}
  </View>
) : (
  
<View style={styles.mobileList}>
  {filteredItems.map((r, idx) => {
    const systemId = r.system_id || null;
    const canEditRow = editMode && !!systemId;
    
    return (
      <View
        key={`${safeStr(r.system_name)}-${idx}`}
        style={styles.mobileCard}
      >
        <View style={styles.mobileCardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={styles.mobileSystemName}>
              {safeStr(r.system_name) || "System"}
            </Text>
            <Text style={styles.mobileSystemType}>
              {safeStr(r.system_type) || "—"}
            </Text>
          </View>

          <View style={styles.mobileBadge}>
            <Text style={styles.mobileBadgeText}>
              {formatDDMMYYYY(r.warranty_expires) || "No warranty date"}
            </Text>
          </View>
        </View>

        <View style={styles.mobileMetaGrid}>
          <MobileField
            label="Location"
            value={safeStr(r.location)}
            editable={canEditRow}
            render={() => renderInput(systemId, "location", "Add location…")}
          />

          <MobileField
            label="Brand"
            value={safeStr(r.manufacturer)}
            editable={canEditRow}
            render={() => renderInput(systemId, "manufacturer", "Add brand…")}
          />

          <MobileField
            label="Model"
            value={safeStr(r.model)}
            editable={canEditRow}
            render={() => renderInput(systemId, "model", "Add model…")}
          />

          <MobileField
            label="Serial"
            value={safeStr(r.serial_number)}
            editable={canEditRow}
            render={() => renderInput(systemId, "serial_number", "Add serial…")}
          />
          <MobileField
            label="Assigned"
            value={safeStr(r.assigned_keepr_pro || "Unassigned")}
            editable={canEditRow}
            render={() => (
              <Pressable
                onPress={() => setPickForSystemId(systemId)}
                style={[
                  styles.assignBtn,
                  draft?.[systemId]?.assigned_keepr_pro
                    ? null
                    : styles.assignBtnEmpty,
                ]}
              >
                <Text style={styles.assignText}>
                  {draft?.[systemId]?.assigned_keepr_pro || "Assign KeeprPro…"}
                </Text>
              </Pressable>
            )}
          />
          <MobileField
            label="Last service"
            value={formatDDMMYYYY(r.last_service_date)}
          />
        </View>

        <View style={styles.mobileFooterRow}>
          <View style={styles.countPill}>
            <Text style={styles.countPillText}>
              {safeStr(r.service_count ?? 0)} services
            </Text>
          </View>

          <View style={styles.countPill}>
            <Text style={styles.countPillText}>
              {safeStr(r.proof_count ?? 0)} proofs
            </Text>
          </View>
        </View>
      </View>
    );
  })}
</View>
)}
    <View style={styles.footer}>
      <Text style={styles.footerText}>Generated from Keepr™</Text>
    </View>
    </ScrollView>
    </KeyboardAvoidingView>
          <Modal
        visible={!!pickForSystemId}
        transparent
        animationType="fade"
        onRequestClose={() => setPickForSystemId(null)}
      >
        <View style={styles.pickerRoot}>
          {/* Backdrop */}
          <Pressable
            style={styles.pickerBackdrop}
            onPress={() => setPickForSystemId(null)}
          />

          {/* Bottom Sheet */}
          <View style={styles.pickerSheet}>
            <View style={styles.pickerHandle} />

            <View style={styles.pickerHeader}>
              <Text style={styles.pickerTitle}>Assign KeeprPro</Text>
              <Pressable onPress={() => setPickForSystemId(null)}>
                <Text style={styles.pickerClose}>Close</Text>
              </Pressable>
            </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 20 }}
                style={{ maxHeight: "100%" }}   // ensure it doesn't expand parent
              >
              <Pressable
                style={styles.pickerRow}
                onPress={() => clearKeeprPro(pickForSystemId)}
              >
                <Text style={styles.pickerRowTitle}>Unassigned</Text>
              </Pressable>

              {keeprPros.map((pro) => (
                <Pressable
                  key={pro.id}
                  style={styles.pickerRow}
                  onPress={() => selectKeeprPro(pickForSystemId, pro.id)}
                >
                  <Text style={styles.pickerRowTitle}>{pro.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
content: {
  padding: 16,
  flexGrow: 1,
},

topChrome: {
  backgroundColor: "#fff",
  zIndex: 10,
  paddingTop: 8,
  paddingHorizontal: 16,
  paddingBottom: 10,
  borderBottomWidth: 1,
  borderBottomColor: "#eee",
},

  header: { marginBottom: 10 },
  title: {
  fontSize: 20,
  fontWeight: "800",
  color: "#111827",
},

metaText: {
  marginTop: 4,
  fontSize: 12,
  color: "#6B7280",
},

  actionsRow: {
  marginTop: 10,
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},
  btn: {
  backgroundColor: "#111",
  paddingHorizontal: 12,
  paddingVertical: 9,
  borderRadius: 12,
},
  btnSecondary: { backgroundColor: "#eee" },
  btnPrimaryAlt: { backgroundColor: "#0b5fff" },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  btnSecondaryText: { color: "#111" },

  summaryCard: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    backgroundColor: "#fff",
  },
  summaryTitle: { fontSize: 14, fontWeight: "700", marginBottom: 10 },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  summaryItem: {
    borderWidth: 1,
    borderColor: "#eee",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minWidth: 160,
  },
  summaryLabel: { fontSize: 11, opacity: 0.7 },
  summaryValue: { fontSize: 18, fontWeight: "700", marginTop: 4 },
  summaryHint: { marginTop: 10, fontSize: 11, opacity: 0.65 },

  table: { borderWidth: 1, borderColor: "#e5e5e5", borderRadius: 12, overflow: "hidden" },
  tr: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#eee",
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: "flex-start",
  },
  trDirty: { backgroundColor: "rgba(11,95,255,0.06)" },
  trHead: { borderTopWidth: 0, backgroundColor: "#fafafa", paddingVertical: 10 },

  th: { fontSize: 12, fontWeight: "700", opacity: 0.85 },
  td: { fontSize: 12, opacity: 0.9 },
  cell: { justifyContent: "flex-start" },
  rowCell: { justifyContent: "flex-start", paddingRight: 10 },

  pill: {
    fontSize: 11,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(11,95,255,0.12)",
    color: "#0b5fff",
    fontWeight: "700",
  },
  pickerRoot: {
  flex: 1,
  justifyContent: "flex-end",
},

pickerBackdrop: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: "rgba(0,0,0,0.4)",
},

pickerSheet: {
  backgroundColor: "#FFFFFF",
  borderTopLeftRadius: 20,
  borderTopRightRadius: 20,
  paddingTop: 10,
  paddingHorizontal: 16,
  paddingBottom: 40,
  maxHeight: "75%",
  shadowColor: "#000",
shadowOpacity: 0.08,
shadowRadius: 10,
elevation: 6,
},

pickerHandle: {
  alignSelf: "center",
  width: 36,
  height: 4,
  borderRadius: 2,
  backgroundColor: "#D1D5DB",
  marginBottom: 10,
},

pickerHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 12,
},

pickerTitle: {
  fontSize: 16,
  fontWeight: "800",
  color: "#111827",
},

pickerClose: {
  fontSize: 13,
  fontWeight: "600",
  color: "#6B7280",
},

pickerRow: {
  paddingVertical: 14,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: "#E5E7EB",
},

pickerRowTitle: {
  fontSize: 15,
  fontWeight: "600",
  color: "#111827",
},

  // Column widths
  colSystem: { flex: 1.5, paddingRight: 10 },
  colType: { flex: 1.0, paddingRight: 10 },
  colLocation: { flex: 1.0, paddingRight: 10 },
  colBrand: { flex: 1.0, paddingRight: 10 },
  colModel: { flex: 1.0, paddingRight: 10 },
  colSerial: { flex: 1.0, paddingRight: 10 },
  colWarranty: { flex: 0.9, paddingRight: 10 },
  colAssigned: { flex: 1.1, paddingRight: 10 },
  colLast: { flex: 0.8, paddingRight: 10 },
  colNum: { flex: 0.7 },

  input: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    fontSize: 12,
    backgroundColor: "#fff",
    minHeight: 34,
  },
  inputEmpty: { backgroundColor: "rgba(11,95,255,0.03)" },
  inputInvalid: { borderColor: "rgba(176,0,32,0.5)" },
  hintBad: { fontSize: 10, color: "#b00020", opacity: 0.9 },

  assignBtn: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    backgroundColor: "#fff",
    minHeight: 34,
    justifyContent: "center",
  },
  assignBtnEmpty: { backgroundColor: "rgba(11,95,255,0.03)" },
  assignText: { fontSize: 12, opacity: 0.9 },

  muted: { fontSize: 13, opacity: 0.7 },
  errorText: { marginTop: 10, color: "#b00020", fontSize: 12 },

  footer: { marginTop: 18 },
  footerText: { fontSize: 11, opacity: 0.6 },

  pickerCard: {
    width: Platform.OS === "web" ? 520 : "92%",
    backgroundColor: "#fff",
    borderRadius: 14,
    padding: 14,
  },

mobileCard: {
  borderWidth: 1,
  borderColor: "#E5E7EB",
  borderRadius: 16,
  backgroundColor: "#FFFFFF",
  padding: 14,
  marginBottom: 12,
},

mobileCardHeader: {
  flexDirection: "row",
  alignItems: "flex-start",
  justifyContent: "space-between",
  marginBottom: 12,
  gap: 10,
},

mobileSystemName: {
  fontSize: 16,
  fontWeight: "800",
  color: "#111827",
},

mobileSystemType: {
  marginTop: 2,
  fontSize: 12,
  color: "#6B7280",
  fontWeight: "600",
},

mobileBadge: {
  paddingHorizontal: 10,
  paddingVertical: 5,
  borderRadius: 999,
  backgroundColor: "#FEF3C7",
},

mobileBadgeText: {
  fontSize: 11,
  fontWeight: "700",
  color: "#92400E",
},

mobileMetaGrid: {
  gap: 10,
},

mobileField: {
  marginBottom: 12,
},

mobileFieldLabel: {
  fontSize: 11,
  color: "#6B7280",
  fontWeight: "700",
  marginBottom: 2,
},

mobileFieldValue: {
  fontSize: 14,
  color: "#111827",
},
input: {
  borderWidth: 1,
  borderColor: "#D1D5DB",
  borderRadius: 10,
  paddingHorizontal: 10,
  paddingVertical: 8,
  fontSize: 14,
  backgroundColor: "#fff",
},

mobileFooterRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 14,
},

countPill: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: "#F3F4F6",
  borderWidth: 1,
  borderColor: "#E5E7EB",
},

countPillText: {
  fontSize: 11,
  fontWeight: "700",
  color: "#374151",
},

actionsRowMobile: {
  marginTop: 12,
  gap: 10,
},

btnMobile: {
  width: "100%",
},
searchInput: {
  marginTop: 10,
  marginBottom: 6,
  backgroundColor: "#F9FAFB",
  borderWidth: 1,
  borderColor: "#E5E7EB",
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  fontSize: 14,
  color: "#111827",
},
});
