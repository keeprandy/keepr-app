// screens/KeeprStoryScreen.js copied from StoryPrint
import React, { useState } from "react";
import {
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useRoute } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius } from "../styles/theme";
import { formatKeeprDate } from "../lib/dateFormat";

import { Pressable } from "react-native";

const IS_WEB = Platform.OS === "web";


function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "";
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return String(value);
  return num.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function SnapshotCard({ label, value }) {
  return (
    <View style={{ marginRight: 14, marginBottom: 6, minWidth: 78 }}>
      <Text style={{ fontSize: 10, color: "#6B7280" }}>{label}</Text>
      <Text style={{ fontSize: 15, fontWeight: "700" }}>
        {value || "—"}
      </Text>
    </View>
  );
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderPrintTimelineRows(items = []) {
  return items
    .map((item) => {
      const kindLabel =
        item.kind === "service"
          ? item.serviceType === "pro"
            ? "PRO SERVICE"
            : item.serviceType === "diy"
            ? "DIY"
            : "SERVICE"
          : "STORY";

      return `
        <div class="timeline-row">
          <div class="timeline-date-col">
            <div class="timeline-date">${escapeHtml(
              formatKeeprDate(String(item.date || "").slice(0, 10))
            )}</div>
            <div class="timeline-kind">${escapeHtml(kindLabel)}</div>
          </div>

          <div class="timeline-main-col">
            ${item.title ? `<div class="timeline-title">${escapeHtml(item.title)}</div>` : ""}
            ${item.description ? `<div class="timeline-body">${escapeHtml(item.description)}</div>` : ""}
            <div class="timeline-meta-row">
              ${item.systemName ? `<span class="timeline-meta-text">System: ${escapeHtml(item.systemName)}</span>` : ""}
              ${item.provider ? `<span class="timeline-meta-text">Provider: ${escapeHtml(item.provider)}</span>` : ""}
              ${
                item.cost !== null && item.cost !== undefined && item.cost !== ""
                  ? `<span class="timeline-meta-text">Cost: ${escapeHtml(formatMoney(item.cost))}</span>`
                  : ""
              }
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function buildPrintHtml({
  title,
  subtitle,
  heroUri,
  purchaseDate,
  estimatedValue,
  documentedSpend,
  location,
  systems = [],
  proofPhotos = [],
  timeline = [],
}) {
  const showcase = proofPhotos
    .map((item) => (typeof item === "string" ? { uri: item } : item))
    .filter((item) => item?.uri && item.uri !== heroUri)
    .slice(0, 4);

  const topSystems = systems.slice(0, 9);

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeHtml(title || "Keepr Story")}</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
            margin: 0;
            padding: 24px;
            background: #fff;
            color: #111827;
          }

          .sheet {
            max-width: 1024px;
            margin: 0 auto;
          }

          .topbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            font-size: 12px;
            color: #6B7280;
          }

          .story-top {
            display: flex;
            gap: 20px;
            align-items: flex-start;
            margin-bottom: 20px;
          }

          .hero-pane {
            flex: 1.6;
          }

          .hero-image {
            width: 100%;
            aspect-ratio: 4 / 3;
            object-fit: cover;
            border-radius: 16px;
            background: #E5E7EB;
            display: block;
          }

          .info-pane {
            flex: 1.05;
          }

          .asset-title {
            font-size: 30px;
            font-weight: 800;
            margin: 0 0 8px 0;
            color: #111827;
          }

          .asset-subtitle {
            margin: 0 0 12px 0;
            font-size: 15px;
            color: #4B5563;
            line-height: 22px;
          }

          .trust-row,
          .snapshot-row,
          .showcase-grid,
          .systems-grid {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 12px;
          }

          .trust-row {
            margin-bottom: 14px;
          }

          .trust-pill {
            padding: 6px 10px;
            border-radius: 999px;
            background: #F3F4F6;
            border: 1px solid #E5E7EB;
            font-size: 12px;
          }

          .snapshot-row {
            margin-bottom: 16px;
          }

          .snapshot-card {
            min-width: 90px;
          }

          .snapshot-label {
            font-size: 10px;
            color: #6B7280;
          }

          .snapshot-value {
            font-size: 15px;
            font-weight: 700;
            color: #111827;
          }

          .section {
            width: 100%;
            box-sizing: border-box;
            margin-top: 20px;
            padding: 20px;
            border: 1px solid #E5E7EB;
            border-radius: 16px;
            background: #fff;
          }

          .section-title {
            font-size: 15px;
            font-weight: 800;
            color: #111827;
            margin-bottom: 6px;
          }

          .section-subtle {
            font-size: 11px;
            color: #6B7280;
            margin-bottom: 10px;
          }

          .showcase-grid {
            margin-top: 8px;
          }

          .showcase-image {
            width: calc(50% - 6px);
            height: 110px;
            object-fit: cover;
            border-radius: 10px;
            background: #E5E7EB;
            display: block;
          }

          .systems-grid {
            justify-content: space-between;
          }

          .system-card {
            width: calc(33.333% - 8px);
            min-height: 100px;
            box-sizing: border-box;
            padding: 12px;
            border-radius: 12px;
            border: 1px solid #E5E7EB;
            background: #fff;
          }

          .system-title {
            font-size: 12px;
            font-weight: 800;
            color: #111827;
            line-height: 16px;
            margin-bottom: 4px;
          }

          .system-meta {
            margin-top: 2px;
            font-size: 10px;
            color: #6B7280;
            line-height: 14px;
          }

          .timeline-row {
            display: flex;
            border-top: 1px solid #E5E7EB;
            padding-top: 10px;
            margin-top: 10px;
          }

          .timeline-date-col {
            width: 140px;
            padding-right: 16px;
            box-sizing: border-box;
          }

          .timeline-date {
            font-size: 11px;
            color: #4B5563;
          }

          .timeline-kind {
            margin-top: 2px;
            font-size: 10px;
            font-weight: 700;
            color: #6B7280;
            text-transform: uppercase;
          }

          .timeline-main-col {
            flex: 1;
          }

          .timeline-title {
            font-size: 13px;
            font-weight: 700;
            color: #111827;
          }

          .timeline-body {
            margin-top: 2px;
            font-size: 12px;
            color: #4B5563;
            line-height: 18px;
          }

          .timeline-meta-row {
            margin-top: 4px;
          }

          .timeline-meta-text {
            font-size: 11px;
            color: #6B7280;
            margin-right: 12px;
          }

          .footer {
            margin-top: 24px;
            border-top: 1px solid #E5E7EB;
            padding-top: 10px;
            text-align: right;
            font-size: 10px;
            color: #6B7280;
          }

          @media print {
            body {
              padding: 0;
            }

            .topbar {
              display: none;
            }
          }
        </style>
        <script>
          window.onafterprint = () => {
            try { window.close(); } catch (e) {}
          };
        </script>
      </head>

      <body>
        <div class="sheet">
          <div class="topbar">
            <div>
            <strong>Keepr Story Report</strong><br />
            <span style="font-size:12px;color:#6B7280;">Print preview</span>
          </div>
            <div>Generated ${escapeHtml(
              formatKeeprDate(new Date().toISOString().slice(0, 10))
            )}</div>
          </div>

          <div class="story-top">
            <div class="hero-pane">
              ${heroUri ? `<img src="${escapeHtml(heroUri)}" class="hero-image" />` : ""}
            </div>

            <div class="info-pane">
              <div class="asset-title">${escapeHtml(title)}</div>
              <div class="asset-subtitle">${escapeHtml(
                subtitle || "A documented story of care, upgrades, and ownership over time."
              )}</div>

              <div class="trust-row">
                <div class="trust-pill">${timeline.length > 8 ? "Well Documented" : "Growing Record"}</div>
                <div class="trust-pill">${timeline.length} Records</div>
                <div class="trust-pill">Proof Attached</div>
              </div>

              <div class="snapshot-row">
                <div class="snapshot-card">
                  <div class="snapshot-label">Owned Since</div>
                  <div class="snapshot-value">${escapeHtml(formatKeeprDate(purchaseDate) || "—")}</div>
                </div>
                <div class="snapshot-card">
                  <div class="snapshot-label">Records</div>
                  <div class="snapshot-value">${escapeHtml(String(timeline.length))}</div>
                </div>
                <div class="snapshot-card">
                  <div class="snapshot-label">Documented Spend</div>
                  <div class="snapshot-value">${escapeHtml(formatMoney(documentedSpend) || "—")}</div>
                </div>
                <div class="snapshot-card">
                  <div class="snapshot-label">Est. Value</div>
                  <div class="snapshot-value">${escapeHtml(formatMoney(estimatedValue) || "—")}</div>
                </div>
                <div class="snapshot-card">
                  <div class="snapshot-label">Location</div>
                  <div class="snapshot-value">${escapeHtml(location || "—")}</div>
                </div>
              </div>

              ${
                showcase.length
                  ? `
                <div class="section-title">Proof Showcase</div>
                <div class="section-subtle">Selected images from the ownership story</div>
                <div class="showcase-grid">
                  ${showcase
                    .map(
                      (item) =>
                        `<img src="${escapeHtml(item.uri)}" class="showcase-image" />`
                    )
                    .join("")}
                </div>
              `
                  : ""
              }
            </div>
          </div>

          <div class="section">
            <div class="section-title">Key Systems With History</div>
            <div class="section-subtle">Systems with documented upgrades, service, or maintenance activity</div>
            <div class="systems-grid">
              ${topSystems
                .map(
                  (system) => `
                <div class="system-card">
                  <div class="system-title">${escapeHtml(system.name)}</div>
                  ${system.lastEventTitle ? `<div class="system-meta">${escapeHtml(system.lastEventTitle)}</div>` : ""}
                  ${system.lastEventDate ? `<div class="system-meta">Last activity: ${escapeHtml(formatKeeprDate(String(system.lastEventDate).slice(0, 10)))}</div>` : ""}
                  ${system.spend > 0 ? `<div class="system-meta">Documented spend: ${escapeHtml(formatMoney(system.spend))}</div>` : ""}
                  ${system.proofCount > 0 ? `<div class="system-meta">${escapeHtml(String(system.proofCount))} proof item${system.proofCount === 1 ? "" : "s"}</div>` : ""}
                </div>
              `
                )
                .join("")}
            </div>
          </div>

          <div class="section">
            <div class="section-title">Key History</div>
            <div class="section-subtle">Complete timeline of service, ownership, and story records</div>
            ${renderPrintTimelineRows(timeline)}
          </div>

          <div class="footer">
            Generated by Keepr • ${escapeHtml(
              formatKeeprDate(new Date().toISOString().slice(0, 10))
            )}
          </div>
        </div>
      </body>
    </html>
  `;
}

export default function KeeprStoryScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const story = route.params?.story || {};

  console.log("STORY PAYLOAD:", story);

const {
  title,
  subtitle,
  heroUri,
  context,
  purchaseDate,
  purchasePrice,
  estimatedValue,
  documentedSpend,
  location,
  timeline = [],
  highlights = [],
} = story;

  const systems = story.systems || [];
const proofPhotos = story.proofPhotos || [];

  const [showFull, setShowFull] = useState(false);

  const hasTimeline = Array.isArray(timeline) && timeline.length > 0;

const majorTimeline = timeline.filter((item) => {
  const title = item.title?.toLowerCase() || "";
  const description = item.description?.toLowerCase() || "";

  const isMajorByKeyword =
    title.includes("install") ||
    title.includes("replace") ||
    title.includes("inspection") ||
    title.includes("repair") ||
    title.includes("upgrade") ||
    title.includes("renew") ||
    title.includes("winterize") ||
    title.includes("engine") ||
    title.includes("roof") ||
    title.includes("hvac") ||
    description.includes("replace") ||
    description.includes("repair") ||
    description.includes("upgrade");

  const isStoryMoment = item.kind === "story";

  return isStoryMoment || isMajorByKeyword;
});

  const handleBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
  };

const handlePrint = async () => {
  if (!IS_WEB) return;

  try {
    const html = buildPrintHtml({
      title,
      subtitle,
      heroUri,
      purchaseDate,
      estimatedValue,
      documentedSpend,
      location,
      systems,
      proofPhotos,
      timeline,
    });

    const w = window.open("", "_blank");
    if (!w) return;

    w.document.open();
    w.document.write(html);
    w.document.close();

    await new Promise((resolve) => {
      w.onload = resolve;
      setTimeout(resolve, 350);
    });

    w.focus();
    w.print();
  } catch (e) {
    console.log("KeeprStory print failed", e);
  }
};


  // Shared sheet layout
  const Sheet = () => (
    <>
      {/* Top bar */}
      <View style={styles.topBar}>
        <Text onPress={handleBack} style={styles.backLink}>
          ← Back to Keepr
        </Text>
        {IS_WEB && (
          <Text onPress={handlePrint} style={styles.printLink}>
            Print Report
          </Text>
        )}
      </View>

      {/* Sheet */}
<View style={styles.sheet}>
  <View style={styles.storyTopCard}>
    <View style={styles.storyHeroPane}>
      {heroUri ? (
        <Image source={{ uri: heroUri }} style={styles.storyHeroImage} />
      ) : null}
    </View>

    <View style={styles.storyInfoPane}>
<Text style={styles.assetTitleLarge}>{title}</Text>

{proofPhotos.length > 1 && (
  <View style={styles.storyShowcaseBlock}>
    <Text style={styles.sectionTitle}>Proof Showcase</Text>
    <Text style={styles.sectionSubtle}>
      Selected images from the ownership story
    </Text>

    <View style={styles.showcaseGrid}>
      {proofPhotos
        .map((item) => (typeof item === "string" ? { uri: item } : item))
        .filter((item) => item?.uri && item.uri !== heroUri)
        .map((item, index) => (
          <Image
            key={`${item.uri}-${index}`}
            source={{ uri: item.uri }}
            style={styles.showcaseGridImage}
          />
        ))}
    </View>
  </View>
)}

<View style={styles.heroOverlay}>
  <Text style={styles.assetSubtitleLarge}>
    A documented story of care, upgrades, and ownership over time.
  </Text>

        <View style={styles.trustRow}>
          <View style={styles.trustPill}>
            <Text>{timeline.length > 8 ? "Well Documented" : "Growing Record"}</Text>
          </View>
          <View style={styles.trustPill}>
            <Text>{timeline.length} Records</Text>
          </View>
          <View style={styles.trustPill}>
            <Text>Proof Attached</Text>
          </View>
        </View>
      </View>

      <View style={styles.snapshotRow}>
        <SnapshotCard label="Owned Since" value={formatKeeprDate(purchaseDate)} />
        <SnapshotCard label="Records" value={timeline.length} />
        <SnapshotCard
          label="Documented Spend"
          value={formatMoney(documentedSpend)}
        />
        <SnapshotCard label="Est. Value" value={formatMoney(estimatedValue)} />
        <SnapshotCard label="Location" value={location} />
      </View>
    </View>
  </View>

  {/* Systems BELOW top card */}
  <View style={styles.systemsCard}>
    <Text style={styles.sectionTitle}>Key Systems With History</Text>
    <Text style={styles.sectionSubtle}>
      Systems with documented upgrades, service, or maintenance activity
    </Text>

<View style={styles.systemsGrid}>
  {systems.slice(0, 9).map((system) => (
    <View key={system.id} style={styles.systemCard}>
      <Text style={styles.systemTitle}>{system.name}</Text>

      {system.lastEventTitle ? (
        <Text style={styles.systemMeta}>{system.lastEventTitle}</Text>
      ) : null}

      {system.lastEventDate ? (
        <Text style={styles.systemMeta}>
          Last activity:{" "}
          {formatKeeprDate(String(system.lastEventDate).slice(0, 10))}
        </Text>
      ) : null}

      {system.spend > 0 ? (
        <Text style={styles.systemMeta}>
          Documented spend: {formatMoney(system.spend)}
        </Text>
      ) : null}

      {system.proofCount > 0 ? (
        <Text style={styles.systemMeta}>
          {system.proofCount} proof item
          {system.proofCount === 1 ? "" : "s"}
        </Text>
      ) : null}
    </View>
  ))}
</View>

    {systems.length > 8 ? (
      <Text style={styles.sectionSubtle}>
        Showing top {Math.min(8, systems.length)} systems
      </Text>
    ) : null}
  </View>
</View>

        {/* Timeline */}
{hasTimeline && (
  <View style={styles.timelineCard}>
    <Text style={styles.sectionTitle}>Key History</Text>
    <Text style={styles.sectionSubtle}>
      {showFull
        ? "Complete timeline of service, ownership, and story records"
        : "Major investments, upgrades, service, and ownership milestones"}
    </Text>

{(showFull ? timeline : majorTimeline).map((item, index) => {
  const kindLabel =
    item.kind === "service"
      ? item.serviceType === "pro"
        ? "PRO SERVICE"
        : item.serviceType === "diy"
        ? "DIY"
        : "SERVICE"
      : "STORY";

  return (
    <View
      key={`${showFull ? "full" : "major"}-${item.id ?? `${item.date}-${item.title}`}-${index}`}
      style={styles.timelineRow}
    >
      <View style={styles.timelineDateCol}>
        <Text style={styles.timelineDate}>
          {formatKeeprDate(String(item.date).slice(0, 10))}
        </Text>
        <Text style={styles.timelineKind}>{kindLabel}</Text>
      </View>

      <View style={styles.timelineMainCol}>
        {item.title ? (
          <Text style={styles.timelineTitle}>{item.title}</Text>
        ) : null}
        {item.description ? (
          <Text style={styles.timelineBody}>{item.description}</Text>
        ) : null}

        <View style={styles.timelineMetaRow}>
          {item.systemName ? (
            <Text style={styles.timelineMetaText}>
              System: {item.systemName}
            </Text>
          ) : null}
          {item.provider ? (
            <Text style={styles.timelineMetaText}>
              Provider: {item.provider}
            </Text>
          ) : null}
          {item.cost !== null &&
          item.cost !== undefined &&
          item.cost !== "" ? (
            <Text style={styles.timelineMetaText}>
              Cost: {formatMoney(item.cost)}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
})}
<Pressable
  style={styles.timelineToggle}
  onPress={() => setShowFull(!showFull)}
>
  <Text style={styles.timelineToggleText}>
    {showFull ? "Hide full timeline" : "View full timeline"}
  </Text>
</Pressable>
  </View>
)}
        {/* Footer */}
        <View style={styles.footerRow}>
          <Text style={styles.footerText}>
            Generated by Keepr • {formatKeeprDate(new Date().toISOString().slice(0, 10))}
          </Text>
        </View>
    </>
  );

  return (
    <>
    
      <SafeAreaView style={[layoutStyles.screen, styles.root]}>
        <ScrollView
          nativeID={IS_WEB ? "keepr-print-scroll" : undefined}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Sheet />
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.background || "#F3F4F6",
  },
  scrollContent: {
    padding: spacing.lg,
    alignItems: "center",
  },
  topBar: {
    width: "100%",
    maxWidth: 1080,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  backLink: {
    fontSize: 12,
    color: colors.textMuted,
    textDecorationLine: "underline",
  },
  printLink: {
    fontSize: 12,
    color: colors.textPrimary,
    textDecorationLine: "underline",
  },

  sheet: {
    width: "100%",
    maxWidth: 1024,
    backgroundColor: colors.surface || "#FFFFFF",
    borderRadius: radius.xl || 16,
    padding: spacing.xl,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },

  timelineCard: {
    width: "100%",
    marginTop: spacing.lg,
    maxWidth: 1024,
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    backgroundColor: "#FFFFFF",
    },

    statRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  marginTop: 12,
},

statItem: {
  width: "48%",
},

systemsGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  justifyContent: "space-between",
  gap: 12,
},

systemCard: {
  width: "32%",
  minHeight: 120,
  padding: 12,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: "#E5E7EB",
  backgroundColor: "#FFFFFF",
  marginBottom: 12,
  shadowColor: "#000",
  shadowOpacity: 0.03,
  shadowRadius: 8,
  shadowOffset: { width: 0, height: 2 },
},

storyTopCard: {
  width: "100%",
  maxWidth: 1024,
  flexDirection: "row",
  gap: 20,
  alignItems: "flex-start",
  marginBottom: spacing.lg,
},

storyHeroPane: {
  flex: 1.6,
},

storyHeroImage: {
  width: "100%",
  aspectRatio: 4 / 3,
  borderRadius: 16,
  backgroundColor: "#E5E7EB",
},

storyInfoPane: {
  flex: 1.05,
  justifyContent: "flex-start",
  paddingTop: 4,
},

storyShowcaseBlock: {
  marginBottom: spacing.sm,
},

showcaseGrid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

showcaseGridImage: {
  width: "48%",
  height: 110,
  borderRadius: 10,
  objectFit: "cover",
},

  heroContainer: {
  marginBottom: spacing.lg,
},
heroOverlay: {
  marginTop: spacing.sm,
  marginBottom: spacing.sm,
},

assetTitleLarge: {
  fontSize: 30,
  fontWeight: "800",
  color: colors.textPrimary,
},

assetSubtitleLarge: {
  marginTop: 6,
  fontSize: 15,
  color: colors.textSecondary,
  lineHeight: 22,
},
trustRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  marginTop: 12,
  gap: 8,
},
trustPill: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: "#F3F4F6",
  borderWidth: 1,
  borderColor: "#E5E7EB",
},
snapshotRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 12,
  marginBottom: spacing.lg,
},

sectionTitle: {
  fontSize: 15,
  fontWeight: "800",
  color: colors.textPrimary,
  marginBottom: 6,
},

systemTitle: {
  fontSize: 12,
  fontWeight: "800",
  color: colors.textPrimary,
  lineHeight: 16,
},
systemMeta: {
  marginTop: 2,
  fontSize: 10,
  color: colors.textMuted,
  lineHeight: 14,
},
proofImage: {
  width: 180,
  height: 120,
  borderRadius: 12,
  marginRight: 10,
  backgroundColor: "#E5E7EB",
},
proofImageLarge: {
  width: 260,
  height: 170,
},
sectionSubtle: {
  fontSize: 11,
  color: colors.textMuted,
  marginBottom: 6,
},

proofRow: {
  paddingRight: 8,
},

timelineToggle: {
  marginTop: 12,
  alignSelf: "flex-start",
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "#E5E7EB",
  backgroundColor: "#F9FAFB",
},

timelineToggleText: {
  fontSize: 12,
  fontWeight: "700",
  color: colors.textPrimary,
},

  /* Brand / header */
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.lg,
    alignItems: "flex-start",
  },
  brandLeft: {
    flexShrink: 1,
  },
  brandLogoRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 4,
  },
  brandLogoCircle: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: colors.brand || colors.textPrimary,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  brandSubtitle: {
    fontSize: 11,
    color: colors.textMuted,
  },
  brandUrl: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  topRightLabel: {
    fontSize: 11,
    color: colors.textMuted,
    letterSpacing: 1,
  },

  heroWrapper: {
    borderRadius: radius.lg || 16,
    overflow: "hidden",
    marginBottom: spacing.lg,
  },
  heroImage: {
    width: "100%",
    
    aspectRatio: 4 / 3,
  },

  titleBlock: {
    marginBottom: spacing.lg,
  },
  assetTitle: {
    fontSize: 20,
    fontWeight: "800",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
  },
  metaText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  metaDot: {
    marginHorizontal: 6,
    fontSize: 10,
    color: colors.textSecondary,
  },
  metaSubText: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },

  section: {
    marginTop: spacing.sm,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
    marginBottom: 4,
  },
  sectionBody: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  timelineRow: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: spacing.sm,
    marginTop: spacing.sm,
  },
  timelineDateCol: {
    width: 140,
    paddingRight: spacing.md,
  },
  timelineDate: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  timelineKind: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
  },
  timelineMainCol: {
    flex: 1,
  },
  timelineTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  timelineBody: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  timelineMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
  },
  timelineMetaText: {
    fontSize: 11,
    color: colors.textMuted,
    marginRight: 12,
  },

  footerRow: {
    marginTop: spacing.xl,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: spacing.sm,
    alignItems: "flex-end",
  },
  footerText: {
    fontSize: 10,
    color: colors.textMuted,
  },
});
