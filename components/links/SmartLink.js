import React, { useCallback, useMemo } from "react";
import { Linking, Platform, Pressable, Text } from "react-native";

import {
  classifyUrl,
  normalizeUrl,
  openExternalUrl,
} from "./linkUtils";

/**
 * SmartLink
 * - Centralizes URL behavior (YouTube/Vimeo aware, internal app links optional)
 * - Production-safe: no hard dependency on WebView/modals
 *
 * Props:
 * - url (string) required
 * - children (node) optional; if omitted, renders the URL as text
 * - style / textStyle optional
 * - onOpenVideo(url, meta) optional: if provided, SmartLink will call this for youtube/vimeo
 *   so a screen can open a modal/embed instead of external navigation.
 * - onOpenInternal(url) optional: for future Keepr deep links (kpr:// or https://app/...)
 * - disabled (bool)
 */
export default function SmartLink({
  url,
  children,
  style,
  textStyle,
  onOpenVideo,
  onOpenInternal,
  disabled = false,
  accessibilityLabel,
}) {
  const normalized = useMemo(() => normalizeUrl(url), [url]);

  const meta = useMemo(() => classifyUrl(normalized), [normalized]);

  const handlePress = useCallback(async () => {
    if (disabled) return;
    if (!normalized) return;

    // Internal links (future-ready)
    if (meta.kind === "internal" && typeof onOpenInternal === "function") {
      onOpenInternal(normalized);
      return;
    }

    // Video providers: allow screen-level modal behavior if desired
    if ((meta.kind === "youtube" || meta.kind === "vimeo") && typeof onOpenVideo === "function") {
      onOpenVideo(normalized, meta);
      return;
    }

    // Default: open externally (mobile: Linking; web: window.open fallback)
    await openExternalUrl(normalized);
  }, [disabled, normalized, meta, onOpenInternal, onOpenVideo]);

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="link"
      accessibilityLabel={accessibilityLabel || "Open link"}
      style={style}
    >
      {children ? (
        children
      ) : (
        <Text
          style={[
            { textDecorationLine: "underline" },
            textStyle,
          ]}
          selectable
        >
          {normalized}
        </Text>
      )}
    </Pressable>
  );
}
