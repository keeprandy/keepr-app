// screens/TimelineCostPackagePrintScreen.js
import React, { useEffect, useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { supabase } from "../lib/supabaseClient";
import { exportToXlsx } from "../utils/exportPackageToXlsx";

/**
 * Timeline Cost Report (single table)
 * - Loads a generated package (packages + package_rows)
 * - Uses only "detail" rows from package_rows (row.section === 'detail')
 * - Computes year totals client-side and renders a single table grouped by year.
 */

function formatReportDate(value) {
  const s = String(value || "").trim();
  if (!s) return "";

  const raw = s.slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;

  const [, yyyy, mm, dd] = m;
  return `${mm}/${dd}/${yyyy}`;
}
export default function TimelineCostPackagePrintScreen({ route, navigation }) {
  const packageId = route?.params?.packageId || null;
  const isWeb = Platform.OS === "web";

  const [pkg, setPkg] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

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
          .select("id, asset_id, title, status, generated_at, totals, snapshot_meta")
          .eq("id", packageId)
          .single();

        if (pkgErr) throw pkgErr;

        const { data: rowData, error: rowErr } = await supabase
          .from("package_rows")
          .select("row_index, row")
          .eq("package_id", packageId)
          .order("row_index", { ascending: true });

        if (rowErr) throw rowErr;

        if (!cancelled) {
          setPkg(pkgData || null);
          setRows(rowData || []);
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

  const fmtMoney = (n) => {
    const val = Number(n ?? 0);
    if (!Number.isFinite(val)) return "$0.00";
    return val.toLocaleString(undefined, { style: "currency", currency: "USD" });
  };

  const { grouped, header } = useMemo(() => {
    const assetName = pkg?.snapshot_meta?.asset_name || "Asset";
    const generatedAt = pkg?.generated_at ? new Date(pkg.generated_at) : null;

    // Only consume detail rows from package_rows (ignore year_rollup rows).
    const detailRows = [];
    for (const r of rows) {
      const row = r.row || {};
      if (row.section === "detail") detailRows.push(row);
    }

    const byYear = new Map();

    for (const r of detailRows) {
      const year =
        typeof r.performed_at === "string" && r.performed_at.length >= 4
          ? Number(r.performed_at.slice(0, 4))
          : null;

      const y = Number.isFinite(year) ? year : 0;

      if (!byYear.has(y)) {
        byYear.set(y, {
          year: y,
          total_cost: 0,
          record_count: 0,
          proof_items: 0,
          rows: [],
        });
      }

      const bucket = byYear.get(y);
      bucket.total_cost += Number(r.cost ?? 0) || 0;
      bucket.record_count += 1;
      bucket.proof_items += Number(r.proof_count ?? 0) || 0;
      bucket.rows.push(r);
    }

    const grouped = Array.from(byYear.values()).sort((a, b) => b.year - a.year);

    // Sort rows newest -> oldest within each year group
    grouped.forEach((g) => {
      g.rows.sort((a, b) => String(b.performed_at || "").localeCompare(String(a.performed_at || "")));
    });

    const totalAllYears = grouped.reduce((sum, g) => sum + (Number(g.total_cost) || 0), 0);

    return {
      grouped,
      header: {
        assetName,
        generatedLabel: generatedAt ? generatedAt.toLocaleString() : "",
        totalCost: totalAllYears,
      },
    };
  }, [pkg, rows]);

  const onPrint = () => {
    if (!isWeb) return;
    setTimeout(() => window.print(), 50);
  };

  const onExportExcel = async () => {
    // Build a flat ledger for accountants/owners
    const detailRows = (rows || [])
      .map((r) => r.row || {})
      .filter((r) => r.section === "detail");

    const excelRows = detailRows.map((r) => ({
      Year: typeof r.performed_at === "string" ? r.performed_at.slice(0, 4) : "",
      Date: r.performed_at || "",
      Title: r.title || "",
      System: r.system_name || "",
      Category: r.category || "",
      KeeprPro: r.keepr_pro_name || "",
      Cost: Number(r.cost ?? 0) || 0,
      ProofCount: Number(r.proof_count ?? 0) || 0,
    }));

    const assetName = pkg?.snapshot_meta?.asset_name || "Asset";
    const title = pkg?.title || "Timeline Cost Report";

    await exportToXlsx({
      fileName: `${assetName} - ${title}`,
      sheets: [{ name: "Timeline Cost", rows: excelRows }],
    });
  };

  if (loading) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Timeline Cost Report</Text>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  if (err) {
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Timeline Cost Report</Text>
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {isWeb ? (
        <style>{`
          @media print {
            /* Hide app chrome (sidebar / nav / headers) */
            nav, aside, header, footer,
            [role="navigation"],
            [data-sidebar],
            .sidebar, .SidebarNav, .sidebar-nav, .app-sidebar, .leftNav, .left-nav {
              display: none !important;
              visibility: hidden !important;
            }

            /* Hide any elements we explicitly mark */
            .no-print { display: none !important; }

            /* Expand document so printing can paginate beyond viewport */
            html, body, #root {
              height: auto !important;
              overflow: visible !important;
            }

            /* Prevent RN Web scroll containers from clipping */
            * { overflow: visible !important; }

            /* Improve page breaks for tables / cards */
            .card, .table, .tr,
            tr, thead, tbody {
              break-inside: avoid;
              page-break-inside: avoid;
            }

            /* Keep background colors when printing */
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

            @page { margin: 12mm; }
          }
        `}</style>
      ) : null}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{pkg?.title || "Timeline Cost Report"}</Text>
        <Text style={styles.metaText}>
          {header.assetName}
          {header.generatedLabel ? ` • Generated ${header.generatedLabel}` : ""}
        </Text>

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
        </View>
      </View>

      {/* Single section table */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Timeline cost</Text>
        <Text style={styles.cardSub}>Total (all years): {fmtMoney(header.totalCost)}</Text>

        <View style={styles.table}>
          <View style={[styles.tr, styles.trHead]}>
            <Text style={[styles.th, styles.colDate]}>Date</Text>
            <Text style={[styles.th, styles.colTitle]}>Title</Text>
            <Text style={[styles.th, styles.colSystem]}>System</Text>
            <Text style={[styles.th, styles.colSmall]}>Cat</Text>
            <Text style={[styles.th, styles.colPro]}>KeeprPro</Text>
            <Text style={[styles.th, styles.colMoney]}>Cost</Text>
            <Text style={[styles.th, styles.colNum]}>Proof</Text>
          </View>

          {grouped.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.muted}>No cost records found for this asset.</Text>
            </View>
          ) : (
            grouped.map((g) => (
              <React.Fragment key={`year-${g.year}`}>
                <View style={styles.yearRow}>
                  <Text style={styles.yearRowText}>
                    {(g.year && g.year !== 0 ? g.year : "Unknown") +
                      ` • Total ${fmtMoney(g.total_cost)} • ${g.record_count} records • ${g.proof_items} proof`}
                  </Text>
                </View>

                {g.rows.map((r, idx) => (
                  <View key={`${g.year}-${r.performed_at}-${idx}`} style={styles.tr}>
                    <Text style={[styles.td, styles.colDate]} numberOfLines={1}>
                      {formatReportDate(r.performed_at)}
                    </Text>
                    <Text style={[styles.td, styles.colTitle]} numberOfLines={2}>
                      {r.title || ""}
                    </Text>
                    <Text style={[styles.td, styles.colSystem]} numberOfLines={2}>
                      {r.system_name || ""}
                    </Text>
                    <Text style={[styles.td, styles.colSmall]} numberOfLines={1}>
                      {r.category || ""}
                    </Text>
                    <Text style={[styles.td, styles.colPro]} numberOfLines={2}>
                      {r.keepr_pro_name || ""}
                    </Text>
                    <Text style={[styles.td, styles.colMoney]} numberOfLines={1}>
                      {fmtMoney(r.cost)}
                    </Text>
                    <Text style={[styles.td, styles.colNum]} numberOfLines={1}>
                      {r.proof_count ?? 0}
                    </Text>
                  </View>
                ))}
              </React.Fragment>
            ))
          )}
        </View>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Generated from Keepr™</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#fff" },
  content: { padding: 16, paddingBottom: 40 },

  header: { marginBottom: 14 },
  title: { fontSize: 22, fontWeight: "700" },
  metaText: { marginTop: 6, fontSize: 12, opacity: 0.75 },

  actionsRow: { marginTop: 12, flexDirection: "row", gap: 10 },
  btn: { backgroundColor: "#111", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  btnSecondary: { backgroundColor: "#eee" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  btnSecondaryText: { color: "#111" },
  noPrint: {},

  card: {
    borderWidth: 1,
    borderColor: "#e5e5e5",
    borderRadius: 12,
    padding: 14,
    marginBottom: 14,
    backgroundColor: "#fff",
  },
  cardTitle: { fontSize: 14, fontWeight: "700" },
  cardSub: { marginTop: 6, fontSize: 11, opacity: 0.65 },

  table: { marginTop: 10, borderWidth: 1, borderColor: "#eee", borderRadius: 12, overflow: "hidden" },
  tr: { flexDirection: "row", borderTopWidth: 1, borderTopColor: "#eee", paddingVertical: 10, paddingHorizontal: 10 },
  trHead: { borderTopWidth: 0, backgroundColor: "#fafafa" },

  th: { fontSize: 12, fontWeight: "700", opacity: 0.85 },
  td: { fontSize: 12, opacity: 0.9 },

  yearRow: {
    backgroundColor: "#f7f7f7",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },
  yearRowText: {
    fontSize: 12,
    fontWeight: "700",
    opacity: 0.85,
  },

  emptyWrap: {
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderTopColor: "#eee",
  },

  colDate: { flex: 0.9, paddingRight: 10 },
  colTitle: { flex: 1.8, paddingRight: 10 },
  colSystem: { flex: 1.2, paddingRight: 10 },
  colSmall: { flex: 0.7, paddingRight: 10 },
  colPro: { flex: 1.2, paddingRight: 10 },
  colMoney: { flex: 0.8, paddingRight: 10 },
  colNum: { flex: 0.5 },

  muted: { fontSize: 13, opacity: 0.7 },

  footer: { marginTop: 8 },
  footerText: { fontSize: 11, opacity: 0.6 },
});
