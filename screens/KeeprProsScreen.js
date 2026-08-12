// screens/KeeprProsScreen.js

import React, { useEffect, useMemo, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Contacts from "expo-contacts";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { KEEPR_PROS } from "../data/keeprPros";
import {
  getMyKpcRelationships,
  mapKpcToKeeprPro,
  resolveOrCreateOwnerKpc,
  searchKpcDirectory,
} from "../lib/kpcApi";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "marine", label: "Marine" },
  { id: "vehicles", label: "Vehicles" },
  { id: "home", label: "Home systems" },
  { id: "outdoor", label: "Outdoor" },
];

const categoryIcon = (category) => {
  switch (category) {
    case "marine":
      return { name: "boat-outline", tint: "#2563EB" };
    case "vehicles":
      return { name: "car-sport-outline", tint: "#f06b0c" };
    case "home":
      return { name: "home-outline", tint: "#7C3AED" };
    case "outdoor":
      return { name: "leaf-outline", tint: "#16A34A" };
    default:
      return { name: "person-outline", tint: colors.textSecondary };
  }
};

const categoryLabel = (category) => {
  switch (category) {
    case "marine":
      return "Marine";
    case "vehicles":
      return "Vehicles";
    case "home":
      return "Home systems";
    case "outdoor":
      return "Outdoor";
    default:
      return "Other";
  }
};

// DB row -> UI shape
const mapRowToPro = (row) => ({
  id: row.id,
  kpcId: row.kpc_id || null,
  organizationId: row.organization_id || null,
  keeprProId: row.keepr_pro_id || row.id,
  ownerKpcRelationshipId: row.owner_kpc_relationship_id || null,
  relationshipType: row.relationship_type || null,
  name: row.name,
  category: row.category || "other",
  kpcCategory: row.kpc_category || null,
  capabilities: row.capabilities || [],
  claimState: row.claimed_state || row.claim_state || null,
  profileStatus: row.profile_status || null,
  phone: row.phone || "",
  email: row.email || "",
  website: row.website || "",
  location: row.location || "",
  notes: row.notes || "",
  since: row.since_label || "",
  lastService: row.last_service || "",
  isFavorite: !!row.is_favorite,
  assets: row.assets || [],
  serviceHistory: row.service_history || [],
});

// UI -> DB payload
const mapProToInsertPayload = (userId, pro) => ({
  user_id: userId,
  name: pro.name,
  category: pro.category,
  phone: pro.phone || null,
  email: pro.email || null,
  website: pro.website || null,
  location: pro.location || null,
  notes: pro.notes || null,
  since_label: pro.since || null,
  last_service: pro.lastService || null,
  is_favorite: pro.isFavorite || false,
  assets: pro.assets || [],
  service_history: pro.serviceHistory || [],
  source: pro.source || null,
  contact_id: pro.contactId || null,
});

const loadLegacyKeeprPros = async (userId) => {
  const { data, error } = await supabase
    .from("keepr_pros")
    .select("*")
    .eq("user_id", userId)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data || []).map(mapRowToPro);
};

const kpcIdentityKey = (pro) =>
  pro?.organizationId || pro?.keeprProId || pro?.kpcId || pro?.id;

const mergeKpcResults = (...groups) => {
  const byIdentity = new Map();

  groups.flat().filter(Boolean).forEach((pro) => {
    const key = kpcIdentityKey(pro);
    if (!key) return;

    const existing = byIdentity.get(key);
    if (!existing) {
      byIdentity.set(key, pro);
      return;
    }

    byIdentity.set(key, {
      ...pro,
      ...existing,
      isFavorite: existing.isFavorite || pro.isFavorite,
      ownerKpcRelationshipId:
        existing.ownerKpcRelationshipId || pro.ownerKpcRelationshipId,
      relationshipType: existing.relationshipType || pro.relationshipType,
      source: existing.ownerKpcRelationshipId ? existing.source : pro.source,
    });
  });

  return Array.from(byIdentity.values());
};

// Normalizes both:
// - { data: { user: null }, error: AuthSessionMissingError }
// - thrown AuthSessionMissingError
const safeGetUser = async () => {
  try {
    const result = await supabase.auth.getUser();

    // If getUser returns an AuthSessionMissingError, treat as "no user"
    if (result?.error && result.error.name === "AuthSessionMissingError") {
      return { data: { user: null }, error: null };
    }

    return result; // { data: { user }, error }
  } catch (e) {
    if (e.name === "AuthSessionMissingError") {
      // Same: no user, no error
      return { data: { user: null }, error: null };
    }
    throw e;
  }
};

export default function KeeprProsScreen({ navigation }) {
  // Start with local demo pros so the screen always has something to show
  const [pros, setPros] = useState(KEEPR_PROS);
  const [directoryPros, setDirectoryPros] = useState([]);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [savingDirectoryKpcId, setSavingDirectoryKpcId] = useState(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchFromCloudOrSeed = useCallback(async () => {
    try {
      setLoading(true);

      const { data: userData, error: userError } = await safeGetUser();
      if (userError) throw userError;

      const user = userData?.user;

      if (!user) {
        setPros(KEEPR_PROS);
        setLoading(false);
        return;
      }

      let mapped = [];
      try {
        const directory = await getMyKpcRelationships();
        mapped = (directory.results || []).map(mapKpcToKeeprPro).filter(Boolean);
      } catch (resolverError) {
        console.warn(
          "KPC relationship resolver unavailable, using legacy Keepr Pros:",
          resolverError?.message || resolverError
        );
        mapped = await loadLegacyKeeprPros(user.id);
      }
      setPros(mapped);
      setLoading(false);
    } catch (err) {
      console.error("Error loading Keepr Pros:", err);
      // Quietly fall back to local data
      setPros(KEEPR_PROS);
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    let isMounted = true;
    (async () => {
      if (!isMounted) return;
      await fetchFromCloudOrSeed();
    })();
    return () => {
      isMounted = false;
    };
  }, [fetchFromCloudOrSeed]);

  useEffect(() => {
    const term = search.trim();
    let cancelled = false;

    if (term.length < 2) {
      setDirectoryPros([]);
      setDirectoryLoading(false);
      return undefined;
    }

    setDirectoryLoading(true);
    const timer = setTimeout(async () => {
      try {
        const directory = await searchKpcDirectory({
          query: term,
          filters: {},
          limit: 12,
        });

        if (cancelled) return;
        setDirectoryPros(
          (directory.results || []).map(mapKpcToKeeprPro).filter(Boolean)
        );
      } catch (resolverError) {
        if (!cancelled) {
          console.warn(
            "KPC directory search unavailable:",
            resolverError?.message || resolverError
          );
          setDirectoryPros([]);
        }
      } finally {
        if (!cancelled) setDirectoryLoading(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [search]);

  // Refresh list when returning from Add/Edit screens
  useEffect(() => {
    const unsub = navigation.addListener("focus", () => {
      // Don’t show spinner every time; do a quiet refresh.
      onRefresh(true);
    });
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation]);

  const onRefresh = async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const { data: userData, error: userError } = await safeGetUser();
      if (userError) throw userError;

      const user = userData?.user;

      if (!user) {
        setPros(KEEPR_PROS);
        return;
      }

      let mapped = [];
      try {
        const directory = await getMyKpcRelationships();
        mapped = (directory.results || []).map(mapKpcToKeeprPro).filter(Boolean);
      } catch (resolverError) {
        console.warn(
          "KPC relationship resolver unavailable, using legacy Keepr Pros:",
          resolverError?.message || resolverError
        );
        mapped = await loadLegacyKeeprPros(user.id);
      }
      setPros(mapped);
    } catch (err) {
      console.error("Error refreshing Keepr Pros:", err);
      setPros(KEEPR_PROS);
    } finally {
      if (!quiet) setRefreshing(false);
    }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return pros
      .filter((pro) => {
        if (activeFilter !== "all" && pro.category !== activeFilter) {
          return false;
        }
        if (!term) return true;
        const haystack = [
          pro.name,
          pro.location,
          pro.notes,
          ...(pro.assets || []),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(term);
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [pros, search, activeFilter]);

  const directoryMatches = useMemo(() => {
    const savedKeys = new Set(pros.map(kpcIdentityKey).filter(Boolean));
    return directoryPros
      .filter((pro) => !savedKeys.has(kpcIdentityKey(pro)))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [directoryPros, pros]);

  const handleAddManually = () => {
    navigation.navigate("KeeprProDetail", {
      mode: "create",
    });
  };

  const handleImportFromContacts = async () => {
    try {
      const available = await Contacts.isAvailableAsync();
      if (!available) {
        Alert.alert(
          "Contacts unavailable",
          "This device does not support accessing contacts."
        );
        return;
      }

      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert(
          "Permission needed",
          "We need access to your contacts to import a Keepr Pro."
        );
        return;
      }

      // Native OS picker so you can choose a contact
      const contact = await Contacts.presentContactPickerAsync();
      if (!contact) {
        // User cancelled
        return;
      }

      const phone =
        contact.phoneNumbers && contact.phoneNumbers[0]
          ? contact.phoneNumbers[0].number
          : "";
      const email =
        contact.emails && contact.emails[0] ? contact.emails[0].email : "";
      const website =
        contact.urlAddresses && contact.urlAddresses[0]
          ? contact.urlAddresses[0].url
          : "";

      const { data: userData, error: userError } = await safeGetUser();
      if (userError) throw userError;
      const user = userData?.user;

      // Prefer the person's name; if empty (business contact), fall back to company
      const displayName =
        (contact.name && contact.name.trim()) ||
        (contact.company && contact.company.trim()) ||
        "Unnamed contact";

      const basePro = {
        name: displayName,
        category: "home",
        phone,
        email,
        website,
        // For now we’ll keep company as “location/label” so you still see it on the card
        location: contact.company || "",
        notes:
          "Imported from your phone contacts. You can refine this Keepr Pro later.",
        since: "Keepr setup",
        lastService: "",
        isFavorite: false,
        assets: [],
        serviceHistory: [],
        source: "contact_import",
        contactId: contact.id,
      };

      // If not signed in yet, store locally only
      if (!user) {
        const localPro = {
          ...basePro,
          id: `local-${contact.id}`,
        };

        setPros((prev) => {
          if (prev.some((p) => p.id === localPro.id)) return prev;
          return [...prev, localPro];
        });

        Alert.alert(
          "Keepr Pro added",
          `Imported "${localPro.name}" locally. Sign in later to sync to the cloud.`
        );
        return;
      }

      // Signed-in path: resolve against the canonical KPC directory first.
      let savedPro;
      try {
        const resolved = await resolveOrCreateOwnerKpc(
          mapProToInsertPayload(user.id, basePro)
        );
        savedPro = mapKpcToKeeprPro(resolved?.kpc);
      } catch (resolverError) {
        console.warn(
          "KPC resolve-first unavailable, using legacy Keepr Pro insert:",
          resolverError?.message || resolverError
        );
        const payload = mapProToInsertPayload(user.id, basePro);
        const { data: inserted, error } = await supabase
          .from("keepr_pros")
          .insert([payload])
          .select("*")
          .single();

        if (error) throw error;
        savedPro = mapRowToPro(inserted);
      }

      if (!savedPro) throw new Error("KPC resolve did not return a provider.");

      setPros((prev) => {
        if (prev.some((p) => p.id === savedPro.id)) return prev;
        return [...prev, savedPro];
      });

      Alert.alert(
        "Keepr Pro added",
        `Imported "${savedPro.name}" from your contacts as a Keepr Pro.`
      );
    } catch (err) {
      console.error("Error importing contact:", err);
      Alert.alert(
        "Import error",
        "Something went wrong while importing from contacts."
      );
    }
  };

  const handleAddDirectoryPro = async (item) => {
    const identity = kpcIdentityKey(item);
    try {
      setSavingDirectoryKpcId(identity);

      const { data: userData, error: userError } = await safeGetUser();
      if (userError) throw userError;

      if (!userData?.user) {
        Alert.alert(
          "Sign in required",
          "Sign in to add this Keepr Pro to your Blackbook."
        );
        return;
      }

      const resolved = await resolveOrCreateOwnerKpc({
        name: item.name,
        display_name: item.name,
        category: item.category,
        phone: item.phone || null,
        email: item.email || null,
        website: item.website || null,
        location: item.location || null,
        notes: item.notes || null,
        source: "kpc_directory",
      });
      const savedPro = mapKpcToKeeprPro(resolved?.kpc);
      if (!savedPro) throw new Error("KPC resolve did not return a provider.");

      setPros((prev) => mergeKpcResults(prev, [savedPro]));
      setDirectoryPros((prev) =>
        prev.map((pro) =>
          kpcIdentityKey(pro) === identity
            ? {
                ...pro,
                ...savedPro,
                ownerKpcRelationshipId: savedPro.ownerKpcRelationshipId,
                relationshipType: savedPro.relationshipType,
                source: savedPro.source,
              }
            : pro
        )
      );
      await onRefresh(true);
      setDirectoryPros((prev) =>
        prev.filter((pro) => kpcIdentityKey(pro) !== identity)
      );

      Alert.alert(
        "Keepr Pro added",
        `${savedPro.name} is now in your KeeprPro Blackbook.`
      );
    } catch (err) {
      console.error("Error adding KPC from directory:", err);
      Alert.alert(
        "Could not add Keepr Pro",
        "Keepr could not add this directory result to your Blackbook."
      );
    } finally {
      setSavingDirectoryKpcId(null);
    }
  };

  const renderFilterChip = (filter) => {
    const isActive = filter.id === activeFilter;
    return (
      <TouchableOpacity
        key={filter.id}
        style={[styles.filterChip, isActive && styles.filterChipActive]}
        activeOpacity={0.85}
        onPress={() => setActiveFilter(filter.id)}
      >
        <Text
          style={[
            styles.filterChipText,
            isActive && styles.filterChipTextActive,
          ]}
        >
          {filter.label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderPro = ({ item }) => {
    const { name, tint } = categoryIcon(item.category);
    const catLabel = categoryLabel(item.category);

    return (
      <TouchableOpacity
        style={styles.proCard}
        activeOpacity={0.9}
        onPress={() => navigation.navigate("KeeprProDetail", { pro: item })}
      >
        <View style={styles.proIconWrap}>
          <Ionicons name={name} size={30} color={tint} />
        </View>
        <View style={styles.proContent}>
          <View style={styles.proHeaderRow}>
            <Text style={styles.proName} numberOfLines={1}>
              {item.name}
            </Text>
            {item.isFavorite && (
              <Ionicons
                name="star"
                size={14}
                color="#FACC15"
                style={{ marginLeft: 4 }}
              />
            )}
          </View>
          <Text style={styles.proCategory}>{catLabel}</Text>
          {item.lastService ? (
            <Text style={styles.proMeta} numberOfLines={1}>
              Last service: {item.lastService}
            </Text>
          ) : null}
          {item.location ? (
            <Text style={styles.proLocation} numberOfLines={1}>
              {item.location}
            </Text>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    );
  };

  const renderDirectoryPro = ({ item }) => {
    const { name, tint } = categoryIcon(item.category);
    const catLabel = categoryLabel(item.category);
    const identity = kpcIdentityKey(item);
    const isSavingDirectoryPro = savingDirectoryKpcId === identity;

    return (
      <View style={styles.proCard}>
        <View style={styles.proIconWrap}>
          <Ionicons name={name} size={30} color={tint} />
        </View>
        <View style={styles.proContent}>
          <View style={styles.proHeaderRow}>
            <Text style={styles.proName} numberOfLines={1}>
              {item.name}
            </Text>
          </View>
          <Text style={styles.proCategory}>{catLabel}</Text>
          {item.location ? (
            <Text style={styles.proLocation} numberOfLines={1}>
              {item.location}
            </Text>
          ) : null}
          <View style={styles.directoryResultMeta}>
            <Ionicons
              name="search-outline"
              size={12}
              color={colors.brandBlue}
            />
            <Text style={styles.directoryResultText}>
              KeeprPro directory result
            </Text>
          </View>
        </View>
        <TouchableOpacity
          style={styles.addDirectoryButton}
          onPress={() => handleAddDirectoryPro(item)}
          activeOpacity={0.85}
          disabled={isSavingDirectoryPro}
        >
          {isSavingDirectoryPro ? (
            <ActivityIndicator size="small" color={colors.brandWhite} />
          ) : (
            <>
              <Ionicons
                name="add-circle-outline"
                size={14}
                color={colors.brandWhite}
              />
              <Text style={styles.addDirectoryButtonText}>
                Add to KeeprPros
              </Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    );
  };

  const renderListHeader = () => {
    if (!search.trim() || directoryMatches.length === 0) return null;

    return (
      <View style={styles.directorySection}>
        <Text style={styles.directorySectionEyebrow}>
          Add from KeeprPro directory
        </Text>
        <Text style={styles.directorySectionHint}>
          These are global KeeprPro results. Add one to save it into your
          Blackbook.
        </Text>
        {directoryMatches.map((item) => (
          <View key={kpcIdentityKey(item)} style={styles.directorySectionItem}>
            {renderDirectoryPro({ item })}
          </View>
        ))}
        <Text style={styles.myKeeprProsLabel}>My KeeprPros</Text>
      </View>
    );
  };

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTitleRow}>
            {navigation.canGoBack() && (
              <TouchableOpacity
                onPress={() => navigation.goBack()}
                style={styles.backButton}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <Ionicons
                  name="chevron-back"
                  size={22}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>
            )}
            <Text style={styles.appTitle}>Keepr™ Pros</Text>
          </View>
          <Text style={styles.appSubtitle}>
            Your little black book of the people who keep your boats, garage,
            and home running — tied directly to the assets they Keepr™.
          </Text>
        </View>

        {/* Smart intro / AI flavor */}
        <View style={styles.summaryCard}>
          <View style={styles.summaryHeaderRow}>
            <View style={styles.summaryTitleRow}>
              <Ionicons
                name="shield-checkmark-outline"
                size={18}
                color={colors.brandBlue}
              />
              <Text style={styles.summaryTitle}>Trusted network</Text>
            </View>
            <View style={styles.summaryBadge}>
              <Ionicons
                name="sparkles-outline"
                size={12}
                color={colors.brandWhite}
              />
              <Text style={styles.summaryBadgeText}>Keepr™ aware</Text>
            </View>
          </View>
          <Text style={styles.summaryBody}>
            Every time you log a service, Keepr™ remembers who did the work.
            Over time, this becomes your personal network of pros: easy to
            call, easy to share, and easy to invite into the ecosystem. You can also assign them to individual systems so that they are only one click away.
          </Text>
        </View>

        {/* Search + actions */}
        <View style={styles.searchRow}>
          <View style={styles.searchWrap}>
            <Ionicons
              name="search-outline"
              size={16}
              color={colors.textMuted}
              style={{ marginRight: 4 }}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search my KeeprPros or the KeeprPro directory…"
              placeholderTextColor={colors.textMuted}
              value={search}
              onChangeText={setSearch}
            />
          </View>

          <TouchableOpacity
            style={styles.addManualButton}
            onPress={handleAddManually}
            activeOpacity={0.85}
          >
            <Ionicons
              name="add-circle-outline"
              size={16}
              color={colors.textPrimary}
            />
            <Text style={styles.addManualButtonText}>Add Manually</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.importButton}
            onPress={handleImportFromContacts}
            activeOpacity={0.85}
          >
            <Ionicons
              name="person-add-outline"
              size={16}
              color={colors.brandWhite}
            />
            <Text style={styles.importButtonText}>Add from Contacts</Text>
          </TouchableOpacity>
        </View>

        {directoryLoading ? (
          <Text style={styles.directorySearchText}>
            Searching the Keepr Pro directory…
          </Text>
        ) : null}

        {/* Filters */}
        <View style={styles.filtersRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingRight: spacing.lg }}
          >
            {FILTERS.map(renderFilterChip)}
          </ScrollView>
        </View>

        {/* List */}
        {loading ? (
          <View
            style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
          >
            <ActivityIndicator size="small" color={colors.brandBlue} />
            <Text style={styles.loadingText}>Loading your Keepr Pros…</Text>
          </View>
        ) : (
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={renderPro}
            ListHeaderComponent={renderListHeader}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => (
              <View style={{ height: spacing.md }} />
            )}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                No Keepr Pros yet. Search the KeeprPro directory, add one from
                contacts, or add one manually.
              </Text>
            }
            refreshing={refreshing}
            onRefresh={() => onRefresh(false)}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
  },

  header: {
    marginBottom: spacing.md,
  },
  headerTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  backButton: {
    marginRight: spacing.sm,
    paddingRight: spacing.sm,
    paddingVertical: 4,
  },
  appTitle: {
    ...typography.title,
  },
  appSubtitle: {
    ...typography.subtitle,
    marginTop: 4,
  },

  summaryCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  summaryHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  summaryTitleRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  summaryTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
    marginLeft: 6,
  },
  summaryBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandBlueDeep,
    borderRadius: radius.pill,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  summaryBadgeText: {
    fontSize: 11,
    color: colors.brandWhite,
    marginLeft: 4,
    fontWeight: "600",
  },
  summaryBody: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 4,
    lineHeight: 18,
  },

  searchRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    flexWrap: "wrap",
  },
  searchWrap: {
    flex: 1,
    minWidth: 220,
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.surfaceSubtle,
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    paddingVertical: 8,
  },

  addManualButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginLeft: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  addManualButtonText: {
    fontSize: 11,
    color: colors.textPrimary,
    fontWeight: "600",
    marginLeft: 4,
  },

  importButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginLeft: spacing.xs,
  },
  importButtonText: {
    fontSize: 11,
    color: colors.brandWhite,
    fontWeight: "600",
    marginLeft: 4,
  },

  filtersRow: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  directorySearchText: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: spacing.xs,
    marginLeft: spacing.sm,
  },
  directorySection: {
    marginBottom: spacing.md,
  },
  directorySectionEyebrow: {
    fontSize: 11,
    color: colors.brandBlue,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
    marginBottom: 2,
  },
  directorySectionHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: spacing.sm,
  },
  directorySectionItem: {
    marginBottom: spacing.sm,
  },
  myKeeprProsLabel: {
    fontSize: 11,
    color: colors.textMuted,
    fontWeight: "800",
    letterSpacing: 0,
    textTransform: "uppercase",
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
  },
  filterChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.chipBorder,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginRight: spacing.xs,
    backgroundColor: colors.chipBackground,
  },
  filterChipActive: {
    borderColor: colors.accentBlue,
    backgroundColor: "#EFF6FF",
  },
  filterChipText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  filterChipTextActive: {
    color: colors.textPrimary,
    fontWeight: "600",
  },

  listContent: {
    paddingTop: spacing.xs,
    paddingBottom: spacing.lg,
  },

  proCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  proIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.sm,
  },
  proContent: {
    flex: 1,
  },
  proHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  proName: {
    flex: 1,
    fontSize: 14,
    fontWeight: "600",
    color: colors.textPrimary,
  },
  proCategory: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 2,
  },
  proMeta: {
    fontSize: 13,
    color: colors.textSecondary,
    marginTop: 2,
  },
  proLocation: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
  },
  directoryResultMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
  },
  directoryResultText: {
    fontSize: 11,
    color: colors.brandBlue,
    fontWeight: "600",
    marginLeft: 4,
  },
  addDirectoryButton: {
    minWidth: 128,
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginLeft: spacing.sm,
  },
  addDirectoryButtonText: {
    fontSize: 11,
    color: colors.brandWhite,
    fontWeight: "700",
    marginLeft: 4,
  },

  emptyText: {
    fontSize: 14,
    color: colors.textMuted,
    textAlign: "center",
    marginTop: spacing.lg,
  },
  loadingText: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
});
