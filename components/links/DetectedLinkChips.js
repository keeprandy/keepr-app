import React, { useMemo } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import SmartLink from "./SmartLink";
import { classifyUrl, normalizeUrl, tokenizeWithUrls } from "./linkUtils";
import { colors, spacing, radius } from "../../styles/theme";

/**
 * DetectedLinkChips
 * Renders compact, Keepr-styled chips for URLs found within a text blob.
 *
 * - Ionicons only
 * - Keepr theme colors only
 * - Provider-aware (YouTube/Vimeo) but subtle
 */
export default function DetectedLinkChips({ text }) {
  const links = useMemo(() => {
    const tokens = tokenizeWithUrls(text || "");
    const raw = (tokens || []).filter((t) => t.type === "url").map((t) => t.value);

    // Normalize + de-dupe (preserve order)
    const seen = new Set();
    const out = [];
    for (const u of raw) {
      const nu = normalizeUrl(u);
      if (!nu) continue;
      if (seen.has(nu)) continue;
      seen.add(nu);
      out.push(nu);
    }
    return out;
  }, [text]);

  const items = useMemo(() => {
    return links.map((url) => {
      const meta = classifyUrl(url);
      const host = meta.host ? meta.host.replace(/^www\./i, "") : "";
      const lower = (meta.kind || "").toLowerCase();

      // Semantic icon (Keepr-consistent)
      let icon = "link-outline";
      let label = "Link";
      let sublabel = host || "";

      if (lower === "youtube" || lower === "vimeo") {
        icon = "play-circle-outline";
        label = "Video";
        sublabel = lower === "youtube" ? "YouTube" : "Vimeo";
      } else if (url.toLowerCase().includes(".pdf")) {
        icon = "document-text-outline";
        label = "PDF";
        sublabel = host || "Document";
      } else if (host) {
        // Use host as sublabel when useful
        sublabel = host;
      }

      // Provider icon (subtle)
      let providerIcon = null;
      if (lower === "youtube") providerIcon = "logo-youtube";
      if (lower === "vimeo") providerIcon = "logo-vimeo";

      return { url, icon, label, sublabel, providerIcon };
    });
  }, [links]);

  if (!items.length) return null;

  return (
    <View>
      <Text style={styles.title}>Links</Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {items.map((it) => (
          <SmartLink key={it.url} url={it.url} style={styles.chip}>
            <View style={styles.chipInner}>
              <Ionicons name={it.icon} size={14} color={colors.textSecondary} />
              <Text style={styles.chipText}>{it.label}</Text>

              {it.providerIcon ? (
                <Ionicons
                  name={it.providerIcon}
                  size={14}
                  color={colors.textSecondary}
                  style={{ marginLeft: 6 }}
                />
              ) : null}

              {it.sublabel ? (
                <Text style={styles.sublabel} numberOfLines={1}>
                  {it.sublabel}
                </Text>
              ) : null}
            </View>
          </SmartLink>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  title: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textSecondary,
    marginBottom: 6,
  },
  row: {
    gap: 8,
    paddingRight: spacing.md,
  },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  chipInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 260,
  },
  chipText: {
    fontSize: 12,
    fontWeight: "900",
    color: colors.textPrimary,
  },
  sublabel: {
    marginLeft: 8,
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
    maxWidth: 140,
  },
});
