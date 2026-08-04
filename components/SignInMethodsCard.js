import React from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { colors, radius, spacing } from "../styles/theme";

const PROVIDERS = [
  {
    id: "email",
    title: "Email/password",
    icon: "mail-outline",
    connectable: false,
  },
  {
    id: "google",
    title: "Google",
    icon: "logo-google",
    connectable: true,
  },
  {
    id: "apple",
    title: "Apple",
    icon: "logo-apple",
    connectable: true,
  },
];

function providerEmail(identity, fallback = "") {
  return (
    identity?.identity_data?.email ||
    identity?.identity_data?.email_address ||
    identity?.email ||
    fallback ||
    ""
  );
}

function notify(title, message) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    window.alert(message ? `${title}\n\n${message}` : title);
    return;
  }
  Alert.alert(title, message);
}

function confirmDanger(title, message) {
  if (Platform.OS === "web" && typeof window !== "undefined") {
    return window.confirm(`${title}\n\n${message}`);
  }
  return null;
}

function getSettingsRedirectTo(provider) {
  if (Platform.OS !== "web" || typeof window === "undefined") return undefined;
  try {
    const url = new URL("/settings", window.location.origin);
    url.searchParams.set("identity_link", provider);
    return url.toString();
  } catch (_) {
    return "http://localhost:8081/settings";
  }
}

function identityKey(identity) {
  return identity?.identity_id || identity?.id || null;
}

function isEmailPasswordIdentity(identity) {
  const provider = String(identity?.provider || "").toLowerCase();
  return provider === "email" || provider === "password";
}

function isManualLinkingDisabled(error) {
  const message = String(error?.message || error?.code || error || "").toLowerCase();
  return message.includes("manual linking") || message.includes("manual_linking_disabled");
}

function manualLinkingMessage() {
  return "Enable manual identity linking in Supabase Authentication settings, then retry. Existing sign-ins still work.";
}

function providerSubtitle({ connected, email, provider, manualLinkingDisabled }) {
  if (connected) return email || "Connected to this Keepr user";
  if (!provider.connectable) return "Primary email/password access";
  if (manualLinkingDisabled) return "Enable manual identity linking in Supabase Auth first.";
  if (provider.id === "apple") return "Connect after Apple is configured in Supabase.";
  return "Connect while signed in to preserve this Keepr user id.";
}

export default function SignInMethodsCard() {
  const [loading, setLoading] = React.useState(true);
  const [workingProvider, setWorkingProvider] = React.useState(null);
  const [manualLinkingDisabled, setManualLinkingDisabled] = React.useState(false);
  const [user, setUser] = React.useState(null);
  const [identities, setIdentities] = React.useState([]);

  const loadIdentities = React.useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.getUser();
      if (error) throw error;
      setUser(data?.user || null);
      const { data: identityData, error: identitiesError } = await supabase.auth.getUserIdentities();
      if (identitiesError) throw identitiesError;
      setIdentities(identityData?.identities || data?.user?.identities || []);
    } catch (error) {
      Alert.alert("Could not load sign-in methods", error?.message || "Try again.");
      setUser(null);
      setIdentities([]);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadIdentities();
  }, [loadIdentities]);

  const connectedIdentities = identities.filter((identity) => identity?.id && identity?.provider);
  const connectedCount = connectedIdentities.length;

  const identityByProvider = PROVIDERS.reduce((acc, provider) => {
    acc[provider.id] =
      provider.id === "email"
        ? identities.find((identity) => isEmailPasswordIdentity(identity)) || null
        : identities.find((identity) => identity.provider === provider.id) || null;
    return acc;
  }, {});

  const handleConnect = async (provider) => {
    if (Platform.OS !== "web") {
      Alert.alert(
        "Use Keepr Web",
        "Google and Apple sign-in linking are available on Keepr Web in this pass."
      );
      return;
    }

    try {
      setWorkingProvider(provider);
      const { data, error } = await supabase.auth.linkIdentity({
        provider,
        options: {
          redirectTo: getSettingsRedirectTo(provider),
          skipBrowserRedirect: true,
        },
      });
      if (error) throw error;
      if (data?.url && Platform.OS === "web" && typeof window !== "undefined") {
        window.location.assign(data.url);
        return;
      }
      await loadIdentities();
    } catch (error) {
      if (isManualLinkingDisabled(error)) {
        setManualLinkingDisabled(true);
        notify("Identity linking is disabled", manualLinkingMessage());
        return;
      }
      notify(
        "Could not connect sign-in method",
        provider === "apple"
          ? error?.message || "Apple sign-in may not be configured yet."
          : error?.message || "Try again."
      );
    } finally {
      setWorkingProvider(null);
    }
  };

  const handleUnlink = async (provider, identity) => {
    const removableIdentityId = identityKey(identity);
    if (!removableIdentityId) {
      notify("Could not remove sign-in method", "Keepr could not identify this linked sign-in method. Refresh Settings and try again.");
      return;
    }

    if (connectedCount <= 1) {
      notify(
        "Keep one sign-in method",
        "Add another sign-in method before removing this one so you do not get locked out."
      );
      return;
    }

    const message =
      "This removes only the sign-in method. Your Keepr assets, Hubs, teams, messages, and history stay attached to this Keepr user.";

    if (Platform.OS === "web") {
      if (!confirmDanger(`Remove ${provider.title}?`, message)) return;
      try {
        setWorkingProvider(provider.id);
        const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (!sessionData?.session) throw new Error("Your session expired. Sign in again, then remove this sign-in method.");
        const { error } = await supabase.auth.unlinkIdentity({
          ...identity,
          identity_id: removableIdentityId,
        });
        if (error) throw error;
        await loadIdentities();
        notify("Sign-in method removed", `${provider.title} is no longer connected to this Keepr account.`);
      } catch (error) {
        if (isManualLinkingDisabled(error)) {
          setManualLinkingDisabled(true);
          notify("Identity linking is disabled", manualLinkingMessage());
          return;
        }
        notify("Could not remove sign-in method", error?.message || "Try again.");
      } finally {
        setWorkingProvider(null);
      }
      return;
    }

    Alert.alert(
      `Remove ${provider.title}?`,
      message,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            try {
              setWorkingProvider(provider.id);
              const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
              if (sessionError) throw sessionError;
              if (!sessionData?.session) throw new Error("Your session expired. Sign in again, then remove this sign-in method.");
              const { error } = await supabase.auth.unlinkIdentity({
                ...identity,
                identity_id: removableIdentityId,
              });
              if (error) throw error;
              await loadIdentities();
            } catch (error) {
              if (isManualLinkingDisabled(error)) {
                setManualLinkingDisabled(true);
                notify("Identity linking is disabled", manualLinkingMessage());
                return;
              }
              notify("Could not remove sign-in method", error?.message || "Try again.");
            } finally {
              setWorkingProvider(null);
            }
          },
        },
      ]
    );
  };

  if (loading) {
    return (
      <View style={styles.card}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Sign-in methods</Text>
        <Text style={styles.caption}>
          Keep multiple sign-ins attached to this one Keepr account.
        </Text>
      </View>

      {PROVIDERS.map((provider, index) => {
        const identity = identityByProvider[provider.id];
        const connected = Boolean(identity);
        const email = providerEmail(identity);
        const working = workingProvider === provider.id;

        return (
          <View key={provider.id}>
            {index > 0 ? <View style={styles.divider} /> : null}
            <View style={styles.row}>
              <View style={styles.iconWrap}>
                <Ionicons name={provider.icon} size={18} color={colors.textPrimary} />
              </View>
              <View style={styles.rowBody}>
                <View style={styles.rowTitleLine}>
                  <Text style={styles.rowTitle}>{provider.title}</Text>
                  <View style={[styles.badge, connected ? styles.connectedBadge : styles.notConnectedBadge]}>
                    <Text style={[styles.badgeText, connected ? styles.connectedBadgeText : styles.notConnectedBadgeText]}>
                      {connected ? "Connected" : "Not connected"}
                    </Text>
                  </View>
                </View>
                <Text style={styles.rowSubtitle}>
                  {providerSubtitle({ connected, email, provider, manualLinkingDisabled })}
                </Text>
              </View>
              {provider.connectable ? (
                connected ? (
                  <TouchableOpacity
                    style={[
                      styles.secondaryButton,
                      manualLinkingDisabled ? styles.disabledButton : null,
                    ]}
                    onPress={() => handleUnlink(provider, identity)}
                    disabled={working || manualLinkingDisabled}
                    activeOpacity={0.85}
                  >
                    {working ? (
                      <ActivityIndicator size="small" />
                    ) : (
                      <Text style={styles.secondaryButtonText}>Unlink</Text>
                    )}
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[
                      styles.primaryButton,
                      manualLinkingDisabled ? styles.disabledButton : null,
                    ]}
                    onPress={() => handleConnect(provider.id)}
                    disabled={working || manualLinkingDisabled}
                    activeOpacity={0.85}
                  >
                    {working ? (
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    ) : (
                      <Text style={styles.primaryButtonText}>Connect</Text>
                    )}
                  </TouchableOpacity>
                )
              ) : null}
            </View>
          </View>
        );
      })}

      {manualLinkingDisabled ? (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            Identity linking is disabled in Supabase Auth settings. Enable manual linking before connecting or unlinking Google and Apple.
          </Text>
        </View>
      ) : null}

      <Text style={styles.footer}>
        Already have Keepr? Sign in first, then connect Google or Apple here. Keepr does not automatically merge different emails.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius?.lg ?? 16,
    padding: 12,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
  },
  header: {
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  caption: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: 10,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  rowTitle: {
    fontSize: 14,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textMuted,
  },
  badge: {
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  connectedBadge: {
    backgroundColor: "#DCFCE7",
  },
  notConnectedBadge: {
    backgroundColor: colors.surfaceSubtle,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
  },
  connectedBadgeText: {
    color: "#166534",
  },
  notConnectedBadgeText: {
    color: colors.textMuted,
  },
  primaryButton: {
    minHeight: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  secondaryButton: {
    minHeight: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.borderSubtle || "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
    backgroundColor: colors.surface,
  },
  disabledButton: {
    opacity: 0.5,
  },
  secondaryButtonText: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.borderSubtle || "#E5E7EB",
    marginLeft: 48,
  },
  warningBox: {
    marginTop: spacing.sm,
    borderRadius: radius?.md ?? 12,
    borderWidth: 1,
    borderColor: "#FBBF24",
    backgroundColor: "#FFFBEB",
    padding: 10,
  },
  warningText: {
    color: "#92400E",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  footer: {
    marginTop: spacing.sm,
    fontSize: 12,
    color: colors.textMuted,
    lineHeight: 17,
  },
});
