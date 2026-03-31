import React, { useEffect, useRef, useState } from "react";
import {
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { colors, spacing } from "../styles/theme";


export default function LightboxModal({
  visible,
  photos, // [{ uri }]
  initialIndex = 0,
  onClose,
}) {
  const listRef = useRef(null);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);

  const safePhotos = Array.isArray(photos) ? photos.filter((p) => !!p?.uri) : [];

  useEffect(() => {
    if (!visible) return;

    const nextIndex = Math.max(
      0,
      Math.min(Number(initialIndex || 0), Math.max(safePhotos.length - 1, 0))
    );

    setCurrentIndex(nextIndex);

    if (listRef.current && safePhotos.length > 0) {
      requestAnimationFrame(() => {
        try {
          listRef.current?.scrollToIndex({
            index: nextIndex,
            animated: false,
          });
        } catch (_) {}
      });
    }
  }, [visible, initialIndex, safePhotos.length]);

  const handleMomentumScrollEnd = (e) => {
    const offsetX = e?.nativeEvent?.contentOffset?.x || 0;
    const nextIndex = Math.round(offsetX / Math.max(width, 1));
    setCurrentIndex(nextIndex);
  };

  const handleScrollToIndexFailed = (info) => {
    requestAnimationFrame(() => {
      try {
        listRef.current?.scrollToOffset({
          offset: info.index * width,
          animated: false,
        });
      } catch (_) {}
    });
  };

  if (!safePhotos.length) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <View
          style={[
            styles.topBar,
            {
              top: insets.top + 12,
              paddingHorizontal: spacing.lg,
            },
          ]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            onPress={onClose}
            style={styles.closeButton}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Close photo viewer"
          >
            <Ionicons name="close" size={22} color={colors.brandWhite} />
          </TouchableOpacity>

          <View style={styles.counterPill}>
            <Text style={styles.counterText}>
              {currentIndex + 1} / {safePhotos.length}
            </Text>
          </View>
        </View>

        <FlatList
          ref={listRef}
          data={safePhotos}
          keyExtractor={(_, index) => String(index)}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={Math.max(
            0,
            Math.min(Number(initialIndex || 0), Math.max(safePhotos.length - 1, 0))
          )}
          getItemLayout={(_, index) => ({
            length: width,
            offset: width * index,
            index,
          })}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          onScrollToIndexFailed={handleScrollToIndexFailed}
          renderItem={({ item }) => (
            <View style={[styles.slide, { width, height }]}>
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
    left: 0,
    right: 0,
    zIndex: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(15,23,42,0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  counterPill: {
    minWidth: 64,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 16,
    backgroundColor: "rgba(15,23,42,0.8)",
    alignItems: "center",
    justifyContent: "center",
  },
  counterText: {
    color: colors.brandWhite,
    fontSize: 13,
    fontWeight: "700",
  },
  slide: {
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  image: {
    width: "100%",
    height: "100%",
  },
});