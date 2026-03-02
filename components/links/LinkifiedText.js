import React, { useMemo } from "react";
import { Text } from "react-native";
import SmartLink from "./SmartLink";
import { tokenizeWithUrls, normalizeUrl, classifyUrl } from "./linkUtils";

/**
 * LinkifiedText
 * - Renders a string with clickable URLs
 * - Uses SmartLink to centralize URL behavior (YouTube/Vimeo aware)
 *
 * Props:
 * - text (string) OR children (string)
 * - style (Text style)
 * - linkStyle (Text style for URL segments)
 * - onOpenVideo(url, meta) optional (pass-through to SmartLink)
 */
export default function LinkifiedText({
  text,
  children,
  style,
  linkStyle,
  onOpenVideo,
  selectable = true,
  numberOfLines,
}) {
  const raw = typeof text === "string" ? text : (typeof children === "string" ? children : "");

  const tokens = useMemo(() => tokenizeWithUrls(raw), [raw]);

  if (!tokens.length) {
    return (
      <Text style={style} selectable={selectable} numberOfLines={numberOfLines}>
        {raw}
      </Text>
    );
  }

  return (
    <Text style={style} selectable={selectable} numberOfLines={numberOfLines}>
      {tokens.map((t, i) => {
        if (t.type === "text") return <Text key={`t-${i}`}>{t.value}</Text>;

        const normalized = normalizeUrl(t.value);
        const meta = classifyUrl(normalized);

        return (
          <SmartLink
            key={`u-${i}`}
            url={normalized}
            onOpenVideo={onOpenVideo}
          >
            <Text
              style={[
                { textDecorationLine: "underline" },
                linkStyle,
              ]}
            >
              {t.value}
            </Text>
          </SmartLink>
        );
      })}
    </Text>
  );
}
