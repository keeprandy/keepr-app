import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors, spacing, radius, typography, shadows } from "../styles/theme";

function Bullet({ children }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={styles.bulletText}>{children}</Text>
    </View>
  );
}

function Section({ title, subtitle, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {!!subtitle && <Text style={styles.sectionSub}>{subtitle}</Text>}
      <View style={styles.card}>{children}</View>
    </View>
  );
}

export default function PrivacyTrustScreen({ navigation }) {
  const goBack = () => {
    if (navigation?.canGoBack?.()) navigation.goBack();
    else Alert.alert("Back", "No previous screen.");
  };

  const openPrivacyContract = () => {
    // V1: placeholder until you publish the contract URL + consent flow.
    Alert.alert(
      "Privacy contract",
      "Coming next: a short, plain-English privacy contract you can review and agree to."
    );
  };

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.content}
      >
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={goBack}
            style={styles.backButton}
            activeOpacity={0.8}
            accessibilityLabel="Back"
          >
            <Ionicons
              name="chevron-back-outline"
              size={22}
              color={colors.textPrimary}
            />
          </TouchableOpacity>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Privacy & trust</Text>
            <Text style={styles.subtitle}>Private by design.</Text>
          </View>
        </View>

        <Section
          title="Keepr privacy promise"
          subtitle="Simple rules we operate by."
        >
          <Bullet>
            You own your data. We don’t sell it, share it, or use it to train models.
          </Bullet>
          <Bullet>
            Files are never public. Attachments live in private storage.
          </Bullet>
          <Bullet>
            Links expire. When you open a file, Keepr generates a short-lived secure
            link.
          </Bullet>
          <Bullet>
            Permissions are enforced at the database level, not just the UI.
          </Bullet>
          <Bullet>
            You stay in control: delete attachments, export your data, delete your
            account.
          </Bullet>
        </Section>

        <Section title="How file access works">
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name="time-outline"
                size={18}
                color={colors.textPrimary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Short‑lived secure links</Text>
              <Text style={styles.rowSub}>
                Keepr signs a temporary link when you view a file. The link expires
                automatically. If you refresh later, Keepr issues a new one.
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name="lock-closed-outline"
                size={18}
                color={colors.textPrimary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Private storage buckets</Text>
              <Text style={styles.rowSub}>
                Attachments are stored privately. There are no permanent public URLs
                to copy or index.
              </Text>
            </View>
          </View>
        </Section>

        <Section title="Security controls">
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name="key-outline"
                size={18}
                color={colors.textPrimary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Authentication</Text>
              <Text style={styles.rowSub}>
                Supabase Auth issues user‑scoped sessions. Service keys are never
                shipped to client apps.
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name="shield-checkmark-outline"
                size={18}
                color={colors.textPrimary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Authorization</Text>
              <Text style={styles.rowSub}>
                Row Level Security (RLS) enforces who can read and write data. Access
                is based on asset ownership and explicit sharing.
              </Text>
            </View>
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Ionicons
                name="cloud-outline"
                size={18}
                color={colors.textPrimary}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>Encryption</Text>
              <Text style={styles.rowSub}>
                Data is encrypted in transit (TLS). Storage and database encryption
                at rest are managed by Supabase.
              </Text>
            </View>
          </View>
        </Section>

        <TouchableOpacity
          onPress={openPrivacyContract}
          style={styles.contractBtn}
          activeOpacity={0.85}
        >
          <Ionicons
            name="document-text-outline"
            size={18}
            color={colors.textPrimary}
          />
          <Text style={styles.contractBtnText}>View privacy contract</Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>

        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Keepr is built for sensitive ownership records.
          </Text>
          <Text style={styles.footerTextMuted}>
            If you share an asset with family or a KeeprPro, access is always
            explicit and permissioned.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg || "#F5F6F8",
  },
  content: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: spacing.xl,
    maxWidth: 920,
    alignSelf: "center",
    width: "100%",
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    backgroundColor: colors.surfaceSubtle,
  },
  title: {
    ...(typography?.title || {}),
    fontSize: typography?.title?.fontSize ?? 22,
    fontWeight: typography?.title?.fontWeight ?? "700",
    color: colors.textPrimary,
  },
  subtitle: {
    ...(typography?.subtitle || {}),
    fontSize: typography?.subtitle?.fontSize ?? 12,
    color: colors.textSecondary,
    marginTop: 2,
  },

  section: {
    marginTop: 12,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 6,
    paddingHorizontal: 2,
  },
  sectionSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    ...(shadows?.subtle || {}),
  },

  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 7,
  },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.textPrimary,
    marginTop: 7,
    marginRight: 10,
    opacity: 0.7,
  },
  bulletText: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },

  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 10,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 10,
    backgroundColor: colors.surfaceSubtle,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  rowSub: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 17,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle || "#E5E7EB",
    marginLeft: 44,
  },

  contractBtn: {
    marginTop: 14,
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    paddingVertical: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    ...(shadows?.subtle || {}),
  },
  contractBtnText: {
    flex: 1,
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  footer: {
    marginTop: 14,
    paddingHorizontal: 2,
  },
  footerText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  footerTextMuted: {
    marginTop: 4,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
});
