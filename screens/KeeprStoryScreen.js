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

  return (
    item.kind === "service" ||
    title.includes("install") ||
    title.includes("replace") ||
    title.includes("inspection") ||
    title.includes("repair")
  );
});

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
            Print
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
    Major investments, upgrades, service, and ownership milestones
    </Text>

    {majorTimeline.map((item) => {
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
          key={item.id ?? `${item.date}-${item.title}`}
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

    <Pressable style={styles.timelineToggle} onPress={() => setShowFull(!showFull)}>
  <Text style={styles.timelineToggleText}>
    {showFull ? "Hide full timeline" : "View full timeline"}
  </Text>
</Pressable>

    {showFull &&
      timeline.map((item) => {
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
            key={`full-${item.id ?? `${item.date}-${item.title}`}`}
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
    
      {IS_WEB && (
  <style
    dangerouslySetInnerHTML={{
      __html: `
       @media print {
        html, body {
            background: #fff !important;
        }

        /* Hide everything first */
        body * {
            visibility: hidden;
        }

        /* Only show story */
        #keepr-print-scroll,
        #keepr-print-scroll * {
            visibility: visible;
        }

        #keepr-print-scroll {
            position: absolute !important;
            left: 0 !important;
            top: 0 !important;
            width: 100% !important;
        }

        /* Force remove sidebar/nav if still present */
        aside,
        nav,
        [class*="sidebar"],
        [class*="nav"] {
            display: none !important;
        }
        }
      `,
    }}
  />
)}

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
