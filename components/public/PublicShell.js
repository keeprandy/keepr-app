import React from "react";

import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  Platform,
  TouchableOpacity,
  StatusBar,
  useWindowDimensions,
} from "react-native";

const keeprLogo = require("../../assets/app_logo_icon.png");


export default function PublicShell({
  children,
  kac,
  scroll = true,
  showFooter = true,

  contextTitle,
  contextSubtitle,
  viewerLabel,
  primaryActionLabel,
  onPrimaryAction,
  onLogoPress,
}) {

  const { width } = useWindowDimensions();
const isMobile = width < 720;

  return (
    
  <View style={styles.screen}>
    <View style={styles.header}>
      <View style={styles.headerInner}>
        <TouchableOpacity
            onPress={() => {
            if (onLogoPress) {
              onLogoPress();
              return;
            }

            if (Platform.OS === "web" && typeof window !== "undefined") {
              window.location.href = "/";
            }
          }}
          style={styles.brandRow}
          activeOpacity={0.85}
        >
          <Image source={keeprLogo} style={styles.logo} resizeMode="contain" />

          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.title}>Keepr™</Text>
            <Text style={styles.subtitle}>Documented ownership continuity.</Text>
          </View>
        </TouchableOpacity>

          {contextTitle && !isMobile ? (
            <View style={styles.contextBlock}>
            <Text style={styles.contextTitle} numberOfLines={1}>
              {contextTitle}
            </Text>
            {!!contextSubtitle && (
              <Text style={styles.contextSubtitle} numberOfLines={1}>
                {contextSubtitle}
              </Text>
            )}
          </View>
        ) : null}

        
        <View style={styles.rightCluster}>
          {!!viewerLabel && !isMobile && (
            <View style={styles.viewerPill}>
              <Text style={styles.viewerLabel}>You are</Text>
              <Text style={styles.viewerValue}>{viewerLabel}</Text>
            </View>
          )}

          {!!kac && (
            <View style={styles.kacPill}>
              <Text style={styles.kacLabel}>KAC</Text>
              <Text numberOfLines={1} style={styles.kacValue}>
                {kac}
              </Text>
            </View>
          )}

          {!!primaryActionLabel && !!onPrimaryAction && !isMobile && (
            <TouchableOpacity style={styles.primaryAction} onPress={onPrimaryAction}>
              <Text style={styles.primaryActionText}>{primaryActionLabel}</Text>
            </TouchableOpacity>
          )}
        </View>
        
      </View>
    </View>

    {scroll ? (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.container}>{children}</View>
      {showFooter ? (
        <View style={styles.footer}>
          <Text style={styles.footerText}>
            Powered by Keepr™ — documented ownership continuity for the things that matter.
          </Text>
        </View>
        ) : null}
      </ScrollView>
    ) : (
      <View style={{ flex: 1 }}>
        <View style={styles.container}>{children}</View>
      </View>
    )}
  </View>
);
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F5F7FA",
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    paddingBottom: 40,
  },

  header: {
  width: "100%",
  backgroundColor: "#FFFFFF",
  borderBottomWidth: 1,
  borderBottomColor: "#E7EBF0",

paddingTop:
  Platform.OS === "web"
    ? 12
    : Platform.OS === "android"
    ? (StatusBar.currentHeight || 24) + 8
    : 44,
},

  headerInner: {
    width: "100%",
    maxWidth: 1400,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingTop: 0,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },

contextBlock: {
  flex: 1,
  minWidth: 0,
  paddingHorizontal: 14,
},

contextTitle: {
  fontSize: 13,
  fontWeight: "900",
  color: "#0F172A",
},

contextSubtitle: {
  marginTop: 2,
  fontSize: 11,
  fontWeight: "700",
  color: "#64748B",
},

rightCluster: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  flexShrink: 0,
  marginLeft: "auto",
},

viewerPill: {
  borderWidth: 1,
  borderColor: "#D8DEE8",
  borderRadius: 999,
  paddingHorizontal: 11,
  paddingVertical: 7,
  backgroundColor: "#F8FAFC",
},

viewerLabel: {
  fontSize: 9,
  fontWeight: "800",
  color: "#64748B",
  letterSpacing: 1,
  textTransform: "uppercase",
},

viewerValue: {
  marginTop: 2,
  fontSize: 11,
  fontWeight: "900",
  color: "#0F172A",
},

primaryAction: {
  borderRadius: 999,
  backgroundColor: "#111827",
  paddingHorizontal: 12,
  paddingVertical: 9,
},

primaryActionText: {
  color: "#fff",
  fontSize: 12,
  fontWeight: "900",
},
  

brandRow: {
  flexDirection: "row",
  alignItems: "center",
  minWidth: 0,
  flexShrink: 0,
},

  logo: {
    width: 34,
    height: 34,
    marginRight: 9,
    flexShrink: 0,
  },

  title: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
  },

  subtitle: {
    marginTop: 2,
    fontSize: 11,
    color: "#64748B",
  },

  kacPill: {
    maxWidth: 150,
    borderWidth: 1,
    borderColor: "#D8DEE8",
    borderRadius: 999,
    paddingHorizontal: 11,
    paddingVertical: 7,
    backgroundColor: "#FFFFFF",
    flexShrink: 0,
  },

  kacLabel: {
    fontSize: 9,
    fontWeight: "800",
    color: "#64748B",
    letterSpacing: 1,
  },

  kacValue: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: "800",
    color: "#0F172A",
  },

  container: {
    width: "100%",
    maxWidth: 1400,
    alignSelf: "center",
    paddingHorizontal: 14,
    paddingTop: 0,
  },

  footer: {
    width: "100%",
    maxWidth: 1400,
    alignSelf: "center",
    paddingHorizontal: 14,
    marginTop: 24,
  },

  footerText: {
    fontSize: 13,
    lineHeight: 18,
    color: "#64748B",
  },
});
