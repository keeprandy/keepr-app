// components/LightboxModal.js
import React, { useRef, useEffect } from "react";
import {
  Dimensions,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors, radius, spacing } from "../styles/theme";

const { width, height } = Dimensions.get("window");

export default function LightboxModal({
  visible,
  photos, // [{ uri }]
  initialIndex = 0,
  onClose,
}) {
  const listRef = useRef(null);

  useEffect(() => {
    if (visible && listRef.current && initialIndex > 0) {
      // jump to tapped image when opening
      setTimeout(() => {
        listRef.current?.scrollToIndex({
          index: initialIndex,
          animated: false,
        });
      }, 0);
    }
  }, [visible, initialIndex]);

  if (!photos || photos.length === 0) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        {/* Top bar */}
        <View style={styles.topBar}>
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            activeOpacity={0.8}
          >
            <Ionicons name="close" size={22} color={colors.brandWhite} />
          </TouchableOpacity>

          <Text style={styles.counterText}>
            {initialIndex + 1} / {photos.length}
          </Text>
        </View>

        {/* Swipeable full-screen images */}
        <FlatList
          ref={listRef}
          data={photos}
          keyExtractor={(_, index) => String(index)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          renderItem={({ item }) => (
            <View style={styles.slide}>
              <Image
                source={{ uri: item.uri }}
                style={styles.image}
                resizeMode="contain"
              />
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.98)",
  },
  topBar: {
    position: "absolute",
    top: 40,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(15,23,42,0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  counterText: {
    color: colors.brandWhite,
    fontSize: 14,
  },
  slide: {
    width,
    height,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  image: {
    width: "100%",
    height: "100%",
  },
});
