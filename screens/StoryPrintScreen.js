// screens/StoryPrintScreen.js
import React from "react";
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

export default function StoryPrintScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const story = route.params?.story || {};

  const {
    title,
    subtitle,
    heroUri,
    context,
    purchaseDate,
    purchasePrice,
    estimatedValue,
    location,
    timeline = [],
  } = story;

  const hasTimeline = Array.isArray(timeline) && timeline.length > 0;

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
        {/* Brand row */}
        <View style={styles.brandRow}>
          <View style={styles.brandLeft}>
            <View style={styles.brandLogoRow}>
              <View style={styles.brandLogoCircle}>
                <Ionicons
                  name="shield-checkmark"
                  size={14}
                  color={colors.surface || "#FFFFFF"}
                />
              </View>
              <View>
                <Text style={styles.brandTitle}>Keepr</Text>
                <Text style={styles.brandSubtitle}>
                  Asset Lifecycle Intelligence
                </Text>
              </View>
            </View>
            <Text style={styles.brandUrl}>https://www.keeprhome.com</Text>
          </View>

          <Text style={styles.topRightLabel}>STORY SHEET</Text>
        </View>

        {/* Hero */}
        {heroUri ? (
          <View style={styles.heroWrapper}>
            <Image
              source={{ uri: heroUri }}
              style={styles.heroImage}
              resizeMode="cover"
            />
          </View>
        ) : null}

        {/* Title + meta */}
        <View style={styles.titleBlock}>
          {title ? <Text style={styles.assetTitle}>{title}</Text> : null}
          <View style={styles.metaRow}>
            {purchaseDate ? (
              <Text style={styles.metaText}>{formatDate(purchaseDate)}</Text>
            ) : null}
            {subtitle ? (
              <>
                {purchaseDate ? <Text style={styles.metaDot}>•</Text> : null}
                <Text style={styles.metaText}>{subtitle}</Text>
              </>
            ) : null}
            {estimatedValue ? (
              <>
                {(purchaseDate || subtitle) && (
                  <Text style={styles.metaDot}>•</Text>
                )}
                <Text style={styles.metaText}>
                  {formatMoney(estimatedValue)}
                </Text>
              </>
            ) : null}
          </View>
          {location ? (
            <Text style={styles.metaSubText}>{location}</Text>
          ) : null}
        </View>

        {/* Context / notes */}
        {context ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Context</Text>
            <Text style={styles.sectionBody}>{context}</Text>
          </View>
        ) : null}

        {/* Purchase */}
        {(purchasePrice || purchaseDate) && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Purchase</Text>
            {purchasePrice ? (
              <Text style={styles.sectionBody}>
                Price: {formatMoney(purchasePrice)}
              </Text>
            ) : null}
            {purchaseDate ? (
              <Text style={styles.sectionBody}>
                Date: {formatDate(purchaseDate)}
              </Text>
            ) : null}
          </View>
        )}

        {/* Timeline */}
        {hasTimeline && (
          <View style={[styles.section, { marginTop: spacing.lg }]}>
            <Text style={styles.sectionLabel}>Timeline</Text>

            {timeline.map((item) => {
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
                  key={item.id || Math.random()}
                  style={styles.timelineRow}
                >
                  <View style={styles.timelineDateCol}>
                    <Text style={styles.timelineDate}>
                      {formatDate(item.date)}
                    </Text>
                    <Text style={styles.timelineKind}>{kindLabel}</Text>
                  </View>

                  <View style={styles.timelineMainCol}>
                    {item.title ? (
                      <Text style={styles.timelineTitle}>{item.title}</Text>
                    ) : null}
                    {item.description ? (
                      <Text style={styles.timelineBody}>
                        {item.description}
                      </Text>
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
            Generated by Keepr • {formatDate(new Date().toISOString())}
          </Text>
        </View>
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
                /* Let the ScrollView container expand so all pages print */
                #keepr-print-scroll {
                  overflow: visible !important;
                  height: auto !important;
                  max-height: none !important;
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
    maxWidth: 720,
    backgroundColor: colors.surface || "#FFFFFF",
    borderRadius: radius.xl || 16,
    padding: spacing.xl,
    shadowColor: "#000",
    shadowOpacity: 0.06,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
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
    marginTop: spacing.md,
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
    width: 120,
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
