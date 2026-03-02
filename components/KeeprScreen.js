// components/KeeprScreen.js
import React from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { View, ScrollView, StyleSheet, Text } from "react-native";

import { colors, spacing, radius, typography } from "../styles/theme";

/**
 * KeeprScreen
 * Lightweight layout shell:
 * - Optional header (title + subtitle)
 * - Optional scrollable content
 */
export default function KeeprScreen({
  title,
  subtitle,
  scrollable = true,
  children,
}) {
  const Container = scrollable ? ScrollView : View;

  const containerProps = scrollable
    ? {
        style: styles.container,
        contentContainerStyle: styles.content,
        showsVerticalScrollIndicator: false,
      }
    : { style: [styles.container, styles.content] };

  return (
    <SafeAreaView style={styles.safeArea}>
      <Container {...containerProps}>
        {title ? (
          <View style={styles.header}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? (
              <Text style={styles.subtitle}>{subtitle}</Text>
            ) : null}
          </View>
        ) : null}

        {children}
      </Container>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  header: {
    marginBottom: spacing.md,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: 2,
  },
});
