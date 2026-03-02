// styles/theme.js — Single source of truth (Production-safe)

export const colors = {
  // Keepr brand core (keep your current brand palette)
  brandNavy: "#131A44",
  brandBlue: "#2D7DE3",
  brandBlueLight: "#4BA3FF",
  brandBlueDeep: "#1F3F88",
  brandWhite: "#FFFFFF",

  // UI
  background: "#F4F5F7",
  surface: "#FFFFFF",
  surfaceSubtle: "#F9FAFB",

  // Borders
  border: "#E5E7EB",
  borderSubtle: "#E5E7EB",

  // Text
  textPrimary: "#111827",
  textSecondary: "#334155",
  textMuted: "#6B7280",
  textOnDark: "#FFFFFF",

  // Primary / semantic aliases (MOST IMPORTANT for “fix once”)
  primary: "#2D7DE3",        // used by buttons, tabs, chips
  onPrimary: "#FFFFFF",
  danger: "#DC2626",
  onDanger: "#FFFFFF",

  // Accents (status)
  accentBlue: "#2D7DE3",
  accentGreen: "#16A34A",
  accentAmber: "#F59E0B",
  accentRed: "#DC2626",

  // Tabs / chips
  tabActive: "#131A44",
  tabInactive: "#9CA3AF",
  chipBorder: "#D1D5DB",
  chipBackground: "#FFFFFF",
};

export const spacing = {
  xs: 4,
  sm: 6,
  md: 10,
  lg: 14,
  xl: 18,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
};

export const typography = {
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 14,
    color: colors.textMuted,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: colors.textMuted,
    textTransform: "uppercase",
    letterSpacing: 0.8,
  },
};

// Make sure screens can safely spread shadows.sm
export const shadows = {
  sm: {
    shadowColor: "#000000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  subtle: {
    shadowColor: "#000000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
};
