import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { supabase } from "../lib/supabaseClient";
import { colors, radius, spacing } from "../styles/theme";

export default function MoreScreen({ navigation }) {
  const handleSignOut = async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      Alert.alert("Sign out failed", e?.message || "Could not sign out.");
    }
  };

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
<View style={styles.header}>
  <View style={styles.headerTop}>
    <TouchableOpacity
      onPress={() => navigation.goBack()}
      style={styles.backButton}
    >
      <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
    </TouchableOpacity>

    <Text style={styles.title}>More</Text>

    {/* spacer to balance layout */}
    <View style={{ width: 40 }} />
  </View>

  <Text style={styles.subtitle}>
    Account, team, billing, and settings.
  </Text>
</View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Section title="Account">
          <Item
            icon="person-outline"
            label="Profile"
            onPress={() => navigation.navigate("Profile")}
          />
          <Item
            icon="settings-outline"
            label="Settings"
            onPress={() => navigation.navigate("Settings")}
          />
        </Section>

        <Section title="Workspace">
          <Item
            icon="card-outline"
            label="Plan & Upgrade"
            onPress={() => navigation.navigate("PlanUpgrade")}
          />
          <Item
            icon="people-outline"
            label="Team"
            onPress={() => navigation.navigate("Team")}
          />
            <Item
            icon="albums-outline"
            label="KeeprHubs"
            onPress={() => navigation.navigate("MyHubs")}
          />
          <Item
            icon="shield-checkmark-outline"
            label="Keepr Pros"
            onPress={() => navigation.navigate("KeeprPros")}
          />
        </Section>

        <Section title="Session">
          <Item
            icon="log-out-outline"
            label="Sign Out"
            onPress={handleSignOut}
            danger
          />
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Item({ icon, label, onPress, danger }) {
  return (
    <TouchableOpacity style={styles.item} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.itemLeft}>
        <View style={styles.iconWrap}>
          <Ionicons
            name={icon}
            size={18}
            color={danger ? "#b91c1c" : colors.textPrimary}
          />
        </View>
        <Text style={[styles.text, danger && styles.danger]}>{label}</Text>
      </View>

      <Ionicons
        name="chevron-forward"
        size={18}
        color={colors.textSecondary}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: {
    fontSize: 28,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  subtitle: {
    marginTop: 4,
    fontSize: 14,
    color: colors.textSecondary,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 120,
  },
  section: {
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    marginBottom: 8,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 0.4,
    color: colors.textSecondary,
    textTransform: "uppercase",
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  item: {
    minHeight: 60,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  itemLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  text: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  danger: {
    color: "#b91c1c",
  },
  headerTop: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
},

backButton: {
  width: 40,
  height: 40,
  borderRadius: 20,
  backgroundColor: colors.surfaceSubtle,
  alignItems: "center",
  justifyContent: "center",
},
});