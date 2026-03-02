// components/BoatCard.js
import React from "react";
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { spacing, radius, colors, shadows } from "../styles/theme";

export default function BoatCard({ boat, onPress, onAddPhoto }) {
  const hasImage = !!boat.image;

  return (
    <TouchableOpacity activeOpacity={0.9} style={styles.card} onPress={onPress}>
      {/* Boat image area */}
      <View style={styles.imageContainer}>
        {hasImage ? (
          <Image source={boat.image} style={styles.image} />
        ) : (
          <View style={styles.noImage}>
            <Ionicons name="image-outline" size={36} color={colors.textMuted} />
            <Text style={styles.noImageText}>No photo yet</Text>

            {onAddPhoto && (
              <TouchableOpacity
                style={styles.addPhotoButton}
                onPress={(e) => {
                  e.stopPropagation();
                  onAddPhoto(boat);
                }}
              >
                <Ionicons name="camera" size={18} color="#fff" />
                <Text style={styles.addPhotoText}>Add Photo</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>

      {/* Status badge */}
      <View
        style={[
          styles.badge,
          {
            backgroundColor:
              boat.status === "In Season" ? "#22c55e" : "#64748b",
          },
        ]}
      >
        <Text style={styles.badgeText}>{boat.status}</Text>
      </View>

      {/* Boat name + specs */}
      <Text style={styles.name}>{boat.name}</Text>
      <Text style={styles.specs}>
        {boat.year} • {boat.specs?.length} • {boat.engine}
      </Text>

      {/* Chevron */}
      <Ionicons
        name="chevron-forward"
        size={20}
        color={colors.textMuted}
        style={styles.chevron}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginBottom: spacing.md,
    overflow: "hidden",
    ...shadows.subtle,
    paddingBottom: spacing.md,
    position: "relative",
  },
 imageContainer: {
  width: "100%",
  aspectRatio: 4/3,
  backgroundColor: colors.surfaceSubtle,
  overflow: "hidden",
  alignSelf: "stretch",     // <-- Ensures aspectRatio resolves correctly on web/tablet
},
image: {
  width: "100%",
  height: "100%",
  resizeMode: "cover",   // <-- Keeps content proportional inside container
},
  noImage: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  noImageText: {
    color: colors.textMuted,
    marginTop: 6,
    fontSize: 12,
  },
  addPhotoButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.accentBlue,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.lg,
    marginTop: spacing.sm,
  },
  addPhotoText: {
    color: "#fff",
    marginLeft: 6,
    fontWeight: "600",
    fontSize: 12,
  },
  badge: {
    position: "absolute",
    top: 12,
    left: 12,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: radius.lg,
  },
  badgeText: {
    color: "white",
    fontSize: 12,
    fontWeight: "600",
  },
  name: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginHorizontal: spacing.md,
  },
  specs: {
    color: colors.textSecondary,
    marginTop: 4,
    fontSize: 13,
    marginHorizontal: spacing.md,
  },
  chevron: {
    position: "absolute",
    right: spacing.md,
    bottom: spacing.md,
  },
});
