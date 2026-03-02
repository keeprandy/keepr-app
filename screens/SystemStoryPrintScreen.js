// screens/SystemStoryPrintScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { publicResolve } from "../lib/publicQrApi";

const IS_WEB = Platform.OS === "web";

function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatMaybe(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function deriveWarrantyStatus(expires) {
  if (!expires) return null;
  const d = new Date(expires);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  // Normalize to date-only comparison
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return d < today ? "Expired" : "Active";
}

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    const decoded = decodeURIComponent(String(raw));
    // legacy bad URL: "[object Object]"
    if (decoded === "[object Object]") return null;
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function getWebQueryParam(name) {
  if (!IS_WEB) return null;
  try {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  } catch {
    return null;
  }
}

function resolveAttachmentUrl(a) {
  // Prefer signed_url if you add it later; else url; else null.
  return a?.signed_url || a?.url || null;
}

function isImageLike(mime, fileName) {
  const m = (mime || "").toLowerCase();
  if (m.startsWith("image/")) return true;
  const fn = (fileName || "").toLowerCase();
  return (
    fn.endsWith(".jpg") ||
    fn.endsWith(".jpeg") ||
    fn.endsWith(".png") ||
    fn.endsWith(".webp") ||
    fn.endsWith(".heic")
  );
}


function flattenMetadata(obj, prefix = "") {
  const out = [];
  if (!obj || typeof obj !== "object") return out;
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out.push(...flattenMetadata(v, key));
    } else if (Array.isArray(v)) {
      // keep arrays compact
      out.push([key, v.length ? v.join(", ") : "—"]);
    } else {
      out.push([key, v === null || v === undefined || v === "" ? "—" : String(v)]);
    }
  }
  return out;
}

// Supports both legacy metadata (identity/warranty at top level)
// and the newer metadata.standard shape used by EditSystemEnrichment.
function getStandardMeta(systemRow) {
  const meta = systemRow?.metadata || systemRow?.extra_metadata || {};
  const standard = meta?.standard && typeof meta.standard === "object" ? meta.standard : null;

  if (standard) {
    return {
      identity: standard.identity || {},
      warranty: standard.warranty || {},
      story: standard.story || {},
      relationships: standard.relationships || {},
    };
  }

  return {
    identity: meta.identity || {},
    warranty: meta.warranty || {},
    story: meta.story || {},
    relationships: meta.relationships || {},
  };
}

function pickFirst(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    return v;
  }
  return null;
}

function buildSystemStoryFromPackage(pkg, assetNameFallback = null) {
  const system = pkg?.system || {};
  const readiness = pkg?.readiness || {};
  const proof = Array.isArray(pkg?.proof) ? pkg.proof : [];

  // Standardized metadata captured via EditSystemEnrichmentScreen.
  // We prefer these when present, and fall back to legacy `readiness` fields.
  const std = getStandardMeta(system);
  const idn = std?.identity || {};
  const war = std?.warranty || {};

  const hero = proof.find((p) => p?.is_showcase && isImageLike(p?.mime_type, p?.file_name)) || proof.find((p) => isImageLike(p?.mime_type, p?.file_name));
  const heroUri = hero ? resolveAttachmentUrl(hero) : null;

  const counts = proof.reduce(
    (acc, p) => {
      const k = p?.kind;
      if (k === "photo") acc.photos += 1;
      else if (k === "file") acc.files += 1;
      else if (k === "link") acc.links += 1;
      return acc;
    },
    { photos: 0, files: 0, links: 0 }
  );

  return {
    assetName: assetNameFallback || pkg?.asset?.name || "Asset",
    systemName: system?.name || "System",
    heroUri,
    keyFacts: {
      whenAdded: system?.created_at || pkg?.created_at,
      systemType: system?.system_type || readiness?.system_type || system?.ksc_code || null,
      installedOn: pickFirst(
        readiness?.installed_at,
        readiness?.installed_on,
        idn?.installed_on,
        idn?.installedOn,
        idn?.installed,
        idn?.installed_date,
        idn?.installedDate
      ),
      brand: pickFirst(
        readiness?.manufacturer,
        readiness?.brand,
        idn?.manufacturer,
        idn?.brand,
        system?.manufacturer,
        system?.brand
      ),
      model: pickFirst(readiness?.model, idn?.model, system?.model),
      brandModel: readiness?.brand_model || null,
      serial: pickFirst(
        readiness?.serial_number,
        idn?.serial_number,
        idn?.serial,
        system?.serial_number,
        system?.serial
      ),
      year: pickFirst(readiness?.year, idn?.year, system?.year),
      hours: pickFirst(readiness?.hours, idn?.hours, system?.hours),
      location: pickFirst(readiness?.location, idn?.location, system?.location, system?.metadata?.location),
      lifecycleStatus: system?.lifecycle_status || null,
    },
    warranty: {
      status: pickFirst(
        readiness?.warranty_status,
        war?.status,
        deriveWarrantyStatus(
          pickFirst(
            readiness?.warranty_end,
            readiness?.warranty_expires,
            war?.expires,
            war?.end,
            war?.expires_on,
            war?.end_date
          )
        )
      ),
      start: pickFirst(readiness?.warranty_start, war?.starts, war?.start, war?.starts_on, war?.start_date),
      end: pickFirst(readiness?.warranty_end, war?.expires, war?.end, war?.expires_on, war?.end_date),
      provider: pickFirst(readiness?.warranty_provider, war?.provider),
      policyRef: pickFirst(readiness?.warranty_policy_ref, war?.policy_number, war?.policy, war?.reference),
    },
    service: {
      lastService: readiness?.last_service_date || system?.last_service_date || null,
      lastVendor: readiness?.last_vendor || readiness?.service_provider || null,
      intervalMonths: readiness?.interval_months || system?.interval_months || null,
      intervalHours: readiness?.interval_hours || system?.interval_hours || null,
      nextDue: readiness?.next_due || system?.next_service_date || null,
    },
    additionalMetadata: flattenMetadata({ system: system?.metadata || {}, readiness: readiness || {} }),
    readinessSnapshot: {
      fuel: readiness?.fuel_type || null,
      outletWithin10ft: readiness?.outlet_within_10ft,
      breakerDistanceFt: readiness?.breaker_distance_ft,
      recircPump: readiness?.has_recirc_pump,
    },
    attachments: counts,
    proofItems: proof,
    timeline: Array.isArray(pkg?.timeline) ? pkg.timeline : [],
  };
}

function applySystemRowEnrichment(story, systemRow, assignedProNames = []) {
  if (!story) return story;
  const sys = systemRow || {};
  const std = getStandardMeta(sys);
  const idn = std?.identity || {};
  const war = std?.warranty || {};
  const rel = std?.relationships || {};

  const playbookText = pickFirst(
    sys.playbook,
    std?.story?.playbook,
    std?.story?.maintenance_playbook,
    sys.metadata?.playbook,
    sys.metadata?.maintenance_playbook
  );

  const manufacturer = pickFirst(
    idn.manufacturer,
    idn.brand,
    sys.manufacturer,
    sys.brand,
    story?.keyFacts?.brand
  );
  const model = pickFirst(idn.model, sys.model, story?.keyFacts?.model);
  const serial = pickFirst(
    idn.serial_number,
    idn.serial,
    sys.serial_number,
    sys.serial,
    story?.keyFacts?.serial
  );
  const location = pickFirst(idn.location, sys.location, story?.keyFacts?.location);

  const warrantyProvider = pickFirst(
    war.provider,
    war.company,
    story?.warranty?.provider
  );
  const warrantyExpires = pickFirst(
    war.expires,
    war.expires_on,
    war.end,
    story?.warranty?.end
  );
  const warrantyStart = pickFirst(war.start, war.started, story?.warranty?.start);
  const warrantyPolicy = pickFirst(war.policy, war.policy_number, war.reference, story?.warranty?.policyRef);

  const intervalMonths = pickFirst(
    sys.interval_months,
    rel.interval_months,
    story?.service?.intervalMonths
  );
  const intervalHours = pickFirst(sys.interval_hours, rel.interval_hours, story?.service?.intervalHours);

  const assignedLine = Array.isArray(assignedProNames) && assignedProNames.length
    ? assignedProNames.join(", ")
    : pickFirst(rel.assigned_vendor, rel.vendor, null);

  return {
    ...story,
    keyFacts: {
      ...story.keyFacts,
      brand: manufacturer || story?.keyFacts?.brand || null,
      model: model || story?.keyFacts?.model || null,
      serial: serial || story?.keyFacts?.serial || null,
      location: location || story?.keyFacts?.location || null,
      systemType:
        story?.keyFacts?.systemType || sys.system_type || sys.ksc_code || story?.keyFacts?.systemType || null,
      lifecycleStatus: story?.keyFacts?.lifecycleStatus || sys.lifecycle_status || null,
    },
    warranty: {
      ...story.warranty,
      provider: warrantyProvider || null,
      start: warrantyStart || story?.warranty?.start || null,
      end: warrantyExpires || story?.warranty?.end || null,
      policyRef: warrantyPolicy || story?.warranty?.policyRef || null,
    },
    service: {
      ...story.service,
      intervalMonths: intervalMonths || story?.service?.intervalMonths || null,
      intervalHours: intervalHours || story?.service?.intervalHours || null,
      assignedPros: assignedLine || null,
    },
    playbook: playbookText || null,
  };
}

export default function SystemStoryPrintScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  // 1) Pull params from route OR from URL (web deep link)
  const routeSystemId =
  route.params?.systemId ||
  route.params?.system_id ||
  route.params?.id ||
  route.params?.system?.id ||
  route.params?.system?.system_id ||
  null;
const routeToken = route.params?.token || null;

  const webSystemId = getWebQueryParam("systemId");
  const webToken = getWebQueryParam("token");
  const webSystemStory = getWebQueryParam("systemStory");

  // systemStory may arrive via route params (native navigation) or URL (web)
  const routeSystemStory =
    typeof route.params?.systemStory === "string"
      ? safeJsonParse(route.params?.systemStory)
      : route.params?.systemStory || null;

  const urlSystemStory = safeJsonParse(webSystemStory);

  const systemIdFromStory =
  (routeSystemStory && (routeSystemStory.system_id || routeSystemStory.systemId)) ||
  (routeSystemStory?.system && (routeSystemStory.system.id || routeSystemStory.system.system_id)) ||
  (urlSystemStory && (urlSystemStory.system_id || urlSystemStory.systemId)) ||
  (urlSystemStory?.system && (urlSystemStory.system.id || urlSystemStory.system.system_id)) ||
  null;

const systemId = routeSystemId || webSystemId || systemIdFromStory || null;
const token = routeToken || webToken || null;

  // Prefer actual object if present
  const initialStory = routeSystemStory || urlSystemStory || null;

  const [loading, setLoading] = useState(!initialStory);
  const [error, setError] = useState("");
  const [systemStory, setSystemStory] = useState(initialStory);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // If we already have an object story, we’re done.
      if (initialStory) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError("");

      try {
        // 2) If token provided, resolve public context (today: asset/system names + mode)
        if (token) {
          const resolved = await publicResolve(token);
          if (cancelled) return;

          // If your public-resolve later returns a full package, this is where we’d use it.
          // For now, we at least populate names to avoid empty shell.
          setSystemStory({
            assetName: resolved?.asset?.name || "Asset",
            systemName: resolved?.system?.name || "System",
            heroUri: null,
            keyFacts: {},
            warranty: {},
            service: {},
            attachments: { photos: 0, files: 0, links: 0 },
            timeline: [],
            readinessSnapshot: {},
            proofItems: [],
          });
          setLoading(false);
          return;
        }

        // 3) Otherwise, require systemId and load internal system package
        if (!systemId) {
          setSystemStory(null);
          setError(
            "Missing systemId or token. Use ?systemId=<uuid> for internal print or ?token=<publicToken> for public print."
          );
          setLoading(false);
          return;
        }

        // Load package
        const { data: pkg, error: pkgErr } = await supabase.rpc(
          "get_system_package",
          { p_system_id: systemId }
        );

        if (pkgErr) throw pkgErr;
        if (!pkg) throw new Error("No system package returned.");

        // Attempt to fetch asset name if not already present in package
        let assetNameFallback = null;
        const assetId = pkg?.system?.asset_id || pkg?.asset_id;
        if (assetId) {
          const { data: aRow } = await supabase
            .from("assets")
            .select("name")
            .eq("id", assetId)
            .maybeSingle();
          assetNameFallback = aRow?.name || null;
        }

        // Fetch the latest system row so we can include EditSystemEnrichment fields (standard metadata + playbook)
        const { data: sysRow } = await supabase
          .from("systems")
          .select(
            "id, name, asset_id, ksc_code, system_type, status, lifecycle_status, metadata, playbook, interval_months, interval_hours, last_service_date, next_service_date"
          )
          .eq("id", systemId)
          .maybeSingle();

        // Resolve assigned Keepr Pros (if EditSystemEnrichment stored them in metadata.relationships)
        let assignedProNames = [];
        const rel = getStandardMeta(sysRow)?.relationships || {};
        const proIdsJson =
          rel?.keepr_pro_ids ||
          rel?.keeprProIds ||
          rel?.keepr_pro_ids_json ||
          rel?.keepr_pro_ids_jsonb;

        const proIds = Array.isArray(proIdsJson)
          ? proIdsJson
          : (proIdsJson && typeof proIdsJson === "string")
            ? (() => {
                try {
                  const parsed = JSON.parse(proIdsJson);
                  return Array.isArray(parsed) ? parsed : [];
                } catch {
                  return [];
                }
              })()
            : [];

        if (proIds.length) {
          const { data: pros } = await supabase
            .from("keepr_pros")
            .select("id, name")
            .in("id", proIds);
          assignedProNames = (pros || []).map((p) => p?.name).filter(Boolean);
        }

        if (cancelled) return;

        const baseStory = buildSystemStoryFromPackage(pkg, assetNameFallback);
        const story = applySystemRowEnrichment(baseStory, sysRow, assignedProNames);
        setSystemStory(story);
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || "Failed to load print package.");
        setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId, token]);

  const printedAt = useMemo(() => formatDate(new Date().toISOString()), []);
  const hasTimeline = Array.isArray(systemStory?.timeline) && systemStory.timeline.length > 0;

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

  const handlePrint = () => {
    if (!IS_WEB) return;
    try {
      window.print();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={[layoutStyles.screen, styles.root]}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={styles.centerText}>Loading print package…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!systemStory) {
    return (
      <SafeAreaView style={[layoutStyles.screen, styles.root]}>
        <View style={styles.center}>
          <Text style={styles.errorTitle}>Nothing to print</Text>
          <Text style={styles.centerText}>{error || "No data provided."}</Text>
          <Text onPress={handleBack} style={[styles.backLink, { marginTop: 12 }]}>
            ← Back to Keepr
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const {
    assetName,
    systemName,
    heroUri,
    keyFacts = {},
    warranty = {},
    service = {},
    playbook = null,
    attachments = {},
    timeline = [],
    readinessSnapshot = {},
    proofItems = [],
  } = systemStory;

  const Sheet = () => (
    <>
      <View style={styles.topBar}>
        <Text onPress={handleBack} style={styles.backLink}>
          ← Back to Keepr
        </Text>
        {IS_WEB && (
          <Text onPress={handlePrint} style={styles.printLink}>
            Print
          </Text>
        )}
      </View>

      <View style={styles.sheet}>
        <View style={styles.headerBlock}>
          <Text style={styles.assetTitle}>{systemName || "System"}</Text>
          <Text style={styles.assetSubtitle}>
            Asset: {assetName || "Asset"} · Printed {printedAt}
          </Text>
        </View>

        {heroUri ? (
          <View style={styles.heroWrapper}>
            <Image source={{ uri: heroUri }} style={styles.heroImage} resizeMode="cover" />
          </View>
        ) : (
          <View style={[styles.heroWrapper, styles.heroPlaceholder]}>
            <Text style={styles.heroPlaceholderTitle}>{systemName || "System"}</Text>
            <Text style={styles.heroPlaceholderSub}>No photos yet • Proof will appear here</Text>
          </View>
        )}

        <View style={styles.cardGrid}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Key facts</Text>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>When added to Keepr</Text>
              <Text style={styles.kvVal}>{formatMaybe(formatDate(keyFacts.whenAdded))}</Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>System type</Text>
              <Text style={styles.kvVal}>{formatMaybe(keyFacts.systemType)}</Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Brand / model</Text>
              <Text style={styles.kvVal}>
                {formatMaybe(keyFacts.brandModel || [keyFacts.brand, keyFacts.model].filter(Boolean).join(" "))}
              </Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Serial</Text>
              <Text style={styles.kvVal}>{formatMaybe(keyFacts.serial)}</Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Installed</Text>
              <Text style={styles.kvVal}>{formatMaybe(formatDate(keyFacts.installedOn))}</Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Year / hours</Text>
              <Text style={styles.kvVal}>
                {formatMaybe(
                  [keyFacts.year ? `Year ${keyFacts.year}` : null, keyFacts.hours ? `${keyFacts.hours} hrs` : null]
                    .filter(Boolean)
                    .join(" · ")
                )}
              </Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Lifecycle status</Text>
              <Text style={styles.kvVal}>{formatMaybe(keyFacts.lifecycleStatus)}</Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Location</Text>
              <Text style={styles.kvVal}>{formatMaybe(keyFacts.location)}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Readiness snapshot</Text>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Fuel</Text>
              <Text style={styles.kvVal}>{formatMaybe(readinessSnapshot.fuel)}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Outlet within 10ft</Text>
              <Text style={styles.kvVal}>{formatMaybe(readinessSnapshot.outletWithin10ft)}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Breaker distance (ft)</Text>
              <Text style={styles.kvVal}>{formatMaybe(readinessSnapshot.breakerDistanceFt)}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Recirc pump</Text>
              <Text style={styles.kvVal}>{formatMaybe(readinessSnapshot.recircPump)}</Text>
            </View>
          </View>
        </View>

        <View style={styles.cardGrid}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Warranty</Text>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Status</Text>
              <Text style={styles.kvVal}>{formatMaybe(warranty.status)}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Start</Text>
              <Text style={styles.kvVal}>{formatMaybe(formatDate(warranty.start))}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>End</Text>
              <Text style={styles.kvVal}>{formatMaybe(formatDate(warranty.end))}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Provider</Text>
              <Text style={styles.kvVal}>{formatMaybe(warranty.provider)}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Policy / reference</Text>
              <Text style={styles.kvVal}>{formatMaybe(warranty.policyRef)}</Text>
            </View>
          </View>


          <View style={styles.card}>
            <Text style={styles.cardTitle}>Service</Text>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Last service</Text>
              <Text style={styles.kvVal}>{formatMaybe(formatDate(service.lastService))}</Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Last vendor</Text>
              <Text style={styles.kvVal}>{formatMaybe(service.lastVendor)}</Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Assigned Keepr Pro</Text>
              <Text style={styles.kvVal}>{formatMaybe(service.assignedPros)}</Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Interval</Text>
              <Text style={styles.kvVal}>
                {formatMaybe(
                  [
                    service.intervalMonths ? `${service.intervalMonths} mo` : null,
                    service.intervalHours ? `${service.intervalHours} hrs` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")
                )}
              </Text>
            </View>

            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Next due</Text>
              <Text style={styles.kvVal}>{formatMaybe(formatDate(service.nextDue))}</Text>
            </View>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Proof</Text>
            {proofItems?.length ? (
              <>
                <Text style={styles.tipText}>
                  {proofItems.length} item{proofItems.length === 1 ? "" : "s"} attached
                </Text>
                <View style={{ marginTop: 6 }}>
                  {proofItems.slice(0, 6).map((p) => (
                    <View
                      key={p.attachment_id || p.id || `${p.title}-${p.created_at}`}
                      style={styles.proofRow}
                    >
                      <Text style={styles.proofDot}>•</Text>
                      <Text style={styles.proofText} numberOfLines={1}>
                        {p.label ? `${p.label}: ` : ""}{p.title || p.file_name || "Attachment"}
                      </Text>
                    </View>
                  ))}
                  {proofItems.length > 6 ? (
                    <Text style={[styles.tipText, { marginTop: 6 }]}>
                      +{proofItems.length - 6} more…
                    </Text>
                  ) : null}
                </View>
              </>
            ) : (
              <Text style={styles.emptyTimelineText}>No proof attached yet.</Text>
            )}

            <View style={[styles.kvRow, { marginTop: 10 }]}>
              <Text style={styles.kvKey}>Photos</Text>
              <Text style={styles.kvVal}>{attachments.photos ?? 0}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Files</Text>
              <Text style={styles.kvVal}>{attachments.files ?? 0}</Text>
            </View>
            <View style={styles.kvRow}>
              <Text style={styles.kvKey}>Links</Text>
              <Text style={styles.kvVal}>{attachments.links ?? 0}</Text>
            </View>
          </View>
        </View>

        <View style={[styles.card, { marginBottom: spacing.md, marginRight: 0 }]}>
          <Text style={styles.cardTitle}>Maintenance playbook</Text>
          {playbook ? (
            <View style={styles.playbookBox}>
              {String(playbook)
                .split(/\r?\n/)
                .filter((l) => l.trim() !== "")
                .slice(0, 120)
                .map((line, idx) => (
                  <Text key={`${idx}-${line}`} style={styles.playbookLine}>
                    {line}
                  </Text>
                ))}
            </View>
          ) : (
            <Text style={styles.emptyTimelineText}>
              No playbook yet. Add one in System Enrichment to print it here.
            </Text>
          )}
        </View>


        <View style={[styles.card, { marginBottom: spacing.md, marginRight: 0 }]}>
          <Text style={styles.cardTitle}>Additional metadata</Text>
          {Array.isArray(systemStory?.additionalMetadata) && systemStory.additionalMetadata.length ? (
            systemStory.additionalMetadata.slice(0, 24).map(([k, v]) => (
              <View key={k} style={styles.kvRow}>
                <Text style={styles.kvKey}>{k}</Text>
                <Text style={styles.kvVal}>{formatMaybe(v)}</Text>
              </View>
            ))
          ) : (
            <Text style={styles.emptyTimelineText}>No metadata captured yet.</Text>
          )}
        </View>

        <View style={[styles.card, styles.timelineCard]}>
          <Text style={styles.cardTitle}>Timeline</Text>
          {hasTimeline ? (
            timeline.map((row) => (
              <View
                key={row.id || `${row.date || ""}-${row.title || ""}`}
                style={styles.timelineRow}
              >
                <View style={styles.timelineDateCol}>
                  <Text style={styles.timelineDate}>{formatDate(row.date)}</Text>
                </View>
                <View style={styles.timelineMainCol}>
                  <Text style={styles.timelineTitle}>{row.title || "Timeline entry"}</Text>
                  {row.notes ? <Text style={styles.timelineNotes}>{row.notes}</Text> : null}
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyTimelineText}>No timeline entries yet for this system.</Text>
          )}
        </View>

        <View style={styles.footerRow}>
          <Text style={styles.footerText}>Generated by Keepr • {printedAt}</Text>
        </View>
      </View>
    </>
  );

  return (
    <SafeAreaView style={[layoutStyles.screen, styles.root]}>
      {IS_WEB && (
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @media print {
                body { margin: 0 !important; }
                body * { visibility: hidden; }
                #keepr-system-print-scroll,
                #keepr-system-print-scroll * { visibility: visible; }
                #keepr-system-print-scroll {
                  overflow: visible !important;
                  height: auto !important;
                  max-height: none !important;
                  position: absolute !important;
                  inset: 0 !important;
                }
              }
            `,
          }}
        />
      )}

      <ScrollView
        nativeID={IS_WEB ? "keepr-system-print-scroll" : undefined}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <Sheet />
      </ScrollView>

      {!!error && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: colors.background || "#F3F4F6" },
  scrollContent: { padding: spacing.lg, alignItems: "center" },

  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  centerText: { marginTop: 10, color: colors.textMuted || "#6B7280", textAlign: "center" },
  errorTitle: { fontSize: 16, fontWeight: "800", color: colors.textPrimary || "#111827" },

  banner: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: "#111827",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    opacity: 0.95,
  },
  bannerText: { color: "#fff", fontSize: 12 },

  topBar: {
    width: "100%",
    maxWidth: 1080,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  backLink: { fontSize: 12, color: colors.textMuted || "#6B7280", textDecorationLine: "underline" },
  printLink: { fontSize: 12, color: colors.textPrimary || "#111827", textDecorationLine: "underline" },

  sheet: {
    width: "100%",
    maxWidth: 720,
    backgroundColor: colors.surface || "#FFFFFF",
    borderRadius: radius.xl || 16,
    padding: spacing.xl,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },

  headerBlock: { marginBottom: spacing.md },
  assetTitle: { fontSize: 20, fontWeight: "800", color: colors.textPrimary || "#111827", marginBottom: 4 },
  assetSubtitle: { fontSize: 12, color: colors.textMuted || "#6B7280" },

  heroWrapper: { borderRadius: radius.lg || 16, overflow: "hidden", marginBottom: spacing.lg },
  heroImage: { width: "100%", aspectRatio: 4 / 3 },

  cardGrid: { flexDirection: "row", marginBottom: spacing.md },
  card: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginRight: spacing.md,
  },

  cardTitle: {
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.08,
    color: "#6B7280",
    marginBottom: 6,
  },

  kvRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 4 },
  kvKey: { fontSize: 12, color: "#374151", flex: 1, paddingRight: 8 },
  kvVal: { fontSize: 12, color: "#111827", fontWeight: "600", textAlign: "right", maxWidth: 220 },

  tipText: { marginTop: 8, fontSize: 11, color: "#6B7280" },

  proofRow: { flexDirection: "row", alignItems: "center", marginTop: 4 },
  proofDot: { marginRight: 6, color: "#111827" },
  proofText: { fontSize: 12, color: "#111827", flex: 1 },

  playbookBox: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    backgroundColor: "#FFFFFF",
  },
  playbookLine: {
    fontSize: 12,
    color: "#111827",
    lineHeight: 18,
  },

  timelineCard: { marginRight: 0 },
  timelineRow: { flexDirection: "row", paddingVertical: 8, borderTopWidth: 1, borderTopColor: "#F3F4F6" },
  timelineDateCol: { width: 90 },
  timelineDate: { fontSize: 11, color: "#6B7280" },
  timelineMainCol: { flex: 1 },
  timelineTitle: { fontSize: 12, fontWeight: "700", color: "#111827" },
  timelineNotes: { fontSize: 12, color: "#374151", marginTop: 2 },
  emptyTimelineText: { fontSize: 12, color: "#6B7280" },

  footerRow: { marginTop: spacing.md, alignItems: "flex-end" },
  footerText: { fontSize: 11, color: "#6B7280" },
});
