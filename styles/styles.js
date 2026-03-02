// styles/theme.js

export const colors = {
  background: "#F4F5F7",
  surface: "#FFFFFF",
  surfaceSubtle: "#F9FAFB",
  borderSubtle: "#E5E7EB",
  textPrimary: "#111827",
  textSecondary: "#4B5563",
  textMuted: "#6B7280",
  textOnDark: "#F9FAFB",

  brand: "#111827", // Keepr dark neutral
  brandSoft: "#1118270D",
  brandStrong: "#020617",

  accentBlue: "#3B82F6",
  accentGreen: "#16A34A",
  accentAmber: "#F59E0B",
  accentRed: "#DC2626",

  tabActive: "#111827",
  tabInactive: "#9CA3AF",

  chipBorder: "#D1D5DB",
  chipBackground: "#FFFFFF",
};

export const spacing = {
  xs: 4,
  sm: 6,   // matches your “6px” padding ask
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
    fontSize: 22,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  subtitle: {
    fontSize: 12,
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

export const shadows = {
  subtle: {
    shadowColor: "#000000",
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
};
