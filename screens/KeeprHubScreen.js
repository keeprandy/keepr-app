// screens/KeeprHubScreen.js
import React, { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Image,
  Alert,
  useWindowDimensions,
  ActivityIndicator,
  Platform,
  Linking,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useRoute } from "@react-navigation/native";

import { layoutStyles } from "../styles/layout";
import { colors, shadows } from "../styles/theme";

import { pickAssetHeroUri } from "../lib/assetImageResolver";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabaseClient";

import {
  fetchPublicHubBySlug,
  fetchHubStoryLinks,
  fetchHub,
} from "../lib/hubsApi";
import PublicHubShell from "../components/hubs/PublicHubShell";
import InternalHubShell from "../components/hubs/InternalHubShell";

  const PROJECT_REF = "jjzjuqxysucqutgjnrkk";
  const FUNCTIONS_BASE = `https://${PROJECT_REF}.supabase.co/functions/v1`;
  const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

const SORT_OPTIONS = [
  { key: "created_desc", label: "Newest" },
  { key: "name_asc", label: "Name" },
];

function getMd(asset) {
  return asset?.extra_metadata && typeof asset.extra_metadata === "object"
    ? asset.extra_metadata
    : {};
}

function daysSince(dateStrOrIso) {
  if (!dateStrOrIso) return null;
  const d = new Date(dateStrOrIso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function safeTitle(asset) {
  return asset?.name || "Untitled Story";
}

function safeSubtitle(asset) {
  const md = getMd(asset);

  const year = md.year || md.model_year || asset?.year;
  const make = md.make || asset?.make;
  const model = md.model || asset?.model;
  const generation = md.generation || md.trim || md.series;


  const vehicleLine = [year, make, model, generation].filter(Boolean).join(" ");
  if (vehicleLine) return vehicleLine;

  const line1 = md.address_line1 || md.address || md.street || "";
  const city = md.city || "";
  const state = md.state || "";
  const zip = md.zip || "";
  const addressLine = [line1, [city, state, zip].filter(Boolean).join(", ")]
    .filter(Boolean)
    .join(" • ");

  return addressLine || asset?.location || asset?.type || "";
}

function storyModeLabel(asset) {
  const md = getMd(asset);
  return (
    md.story_mode ||
    md.public_mode ||
    md.mode ||
    md.lifecycle_state ||
    "Current Story"
  );
}



function normalizeLinks(rows) {
  return (rows || [])
    .map((row) => {
      const asset = row.asset || row.assets || row;
      if (!asset?.id) return null;

      const ownerProfile = row.ownerProfile || row.owner_profile || null;
      const ownerName =
        ownerProfile?.display_name ||
        ownerProfile?.full_name ||
        ownerProfile?.inbox_name ||
        ownerProfile?.username ||
        ownerProfile?.email ||
        null;

      return {
        ...asset,
        ownerProfile,
        owner_name: ownerName,
        _hubLinkId: row.id,
        _featured: Boolean(row.featured),
        _linkedAt: row.created_at || asset.created_at,
      };
    })
    .filter(Boolean);
}

function safeOwner(asset) {
  const md = getMd(asset);
  const p = asset?.ownerProfile || asset?.owner_profile;

  return (
    asset?.owner_name ||
    md.owner_name ||
    md.owner ||
    p?.display_name ||
    p?.full_name ||
    p?.inbox_name ||
    p?.username ||
    p?.email ||
    asset?.owner ||
    null
  );
}
async function fetchPublicStoryMedia(kac) {
  if (!kac || !ANON_KEY) return [];

  const res = await fetch(`${FUNCTIONS_BASE}/public-story-media`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      Authorization: `Bearer ${ANON_KEY}`,
    },
    body: JSON.stringify({ kac }),
  });

  const json = await res.json();

  if (!res.ok) {
    console.log("HUB PUBLIC STORY MEDIA ERROR:", kac, json);
    return [];
  }

  return Array.isArray(json?.media) ? json.media : [];
}

export default function KeeprHubScreen({ navigation }) {
  const route = useRoute();
  const { width: windowWidth } = useWindowDimensions();

const hubId = route?.params?.hubId || route?.params?.hub?.id || null;

const hubSlug =
  route?.params?.slug ||
  route?.params?.hubSlug ||
  route?.params?.hub?.slug ||
  null;

const isInternal =
  route?.name === "KeeprHubInternal";

  const [hub, setHub] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stories, setStories] = useState([]);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("created_desc");
  const [containerWidth, setContainerWidth] = useState(null);
  const [activeChip, setActiveChip] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  
  
  const effectiveWidth = containerWidth || windowWidth;
  const cardGap = 14;
  const listSidePadding = 24;

  const numColumns = useMemo(() => {
    if (effectiveWidth >= 1024) return 3;
    if (effectiveWidth >= 720) return 2;
    return 1;
  }, [effectiveWidth]);

  const cardWidth = useMemo(() => {
    const inner = Math.max(0, Math.floor(effectiveWidth - listSidePadding * 2));
    const totalGaps = cardGap * (numColumns - 1);
    const w = Math.floor((inner - totalGaps) / numColumns);
    return Math.max(260, w);
  }, [effectiveWidth, numColumns]);

  const heroHeight = useMemo(
    () => Math.round((cardWidth * 9) / 16),
    [cardWidth]
  );

const enrichHeroImages = useCallback(async (assetList) => {
  const heroByAssetId = {};

  for (const asset of assetList || []) {
    try {
      const kac = asset?.kac_id;
      if (!kac) continue;

      const mediaRows = await fetchPublicStoryMedia(kac);

      const heroPlacement =
        mediaRows.find(
          (x) => String(x.placement_id) === String(asset.hero_placement_id)
        ) ||
        mediaRows.find((x) => x.role === "hero") ||
        null;

      const heroUrl = heroPlacement?.image_url || null;

      if (heroUrl) {
        heroByAssetId[asset.id] = heroUrl;
      }
    } catch (e) {
      console.log("Hub public media hero failed:", asset?.name, e?.message || e);
    }
  }

  setStories((prev) =>
    prev.map((p) =>
      heroByAssetId[p.id]
        ? {
          ...p,
          public_hero_url: heroByAssetId[p.id],
          primary_attachment_url: heroByAssetId[p.id],
        }
        : p
    )
  );
}, []);

  function metadataValue(asset, key) {
  const md = getMd(asset);

  if (key === "year") return md.year || md.model_year || asset?.year;
  if (key === "make") return md.make || asset?.make;
  if (key === "model") return md.model || asset?.model;
  if (key === "owner") return safeOwner(asset);

  return null;
}

const loadHub = useCallback(async () => {
  setLoading(true);

  const { data: authData } = await supabase.auth.getUser();
  setCurrentUserId(authData?.user?.id || null);


  try {
    const hubRecord = hubId
      ? await fetchHub(hubId)
      : await fetchPublicHubBySlug(hubSlug || "rally-sport-region");

    const { data: memberRow, error: memberError } = await supabase
      .from("hub_members")
      .select("id, role, user_id")
      .eq("hub_id", hubRecord.id)
      .eq("user_id", authData?.user?.id)
      .maybeSingle();

    if (memberError) {
      console.log("Hub member lookup failed:", memberError);
    }

    setHub({
      ...hubRecord,
      currentMember: memberRow || null,
    });

    const linkRows = await fetchHubStoryLinks(hubRecord.id);
    const assetStories = normalizeLinks(linkRows);

    setStories(assetStories);
    await enrichHeroImages(assetStories);
    setLoading(false);

  } catch (e) {
    console.error(e);
    Alert.alert("Hub unavailable", e?.message || "Failed to load hub.");
    setStories([]);
    setLoading(false);
  }
}, [hubId, hubSlug, enrichHeroImages]);

  useFocusEffect(
    useCallback(() => {
      loadHub();
    }, [loadHub])
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();

    let list = (stories || []).filter((asset) => {
      if (!q) return true;

      const title = safeTitle(asset).toLowerCase();
      const subtitle = safeSubtitle(asset).toLowerCase();
      const owner = String(safeOwner(asset) || "").toLowerCase();

      const mode = storyModeLabel(asset).toLowerCase();
      const md = JSON.stringify(getMd(asset)).toLowerCase();

      return (
        title.includes(q) ||
        subtitle.includes(q) ||
        owner.includes(q) ||
        mode.includes(q) ||
        md.includes(q)
      );
    });

    switch (sortKey) {
      case "name_asc":
        list.sort((a, b) => safeTitle(a).localeCompare(safeTitle(b)));
        break;
      case "created_desc":
      default:
        list.sort(
          (a, b) =>
            new Date(b._linkedAt || b.created_at || 0) -
            new Date(a._linkedAt || a.created_at || 0)
        );
        break;
    }

    return list;
  }, [stories, query, sortKey]);

      const assetChips = useMemo(() => {
    const values = [];

    (stories || []).forEach((asset) => {
      ["make", "model", "year"].forEach((key) => {
        const value = metadataValue(asset, key);
        if (value) values.push(String(value));
      });
    });

    return Array.from(new Set(values)).slice(0, 14);
  }, [stories]);

  const metadataChips = useMemo(() => {
  const values = [];

  (stories || []).forEach((asset) => {
    ["make", "model", "year", "owner"].forEach((key) => {
      const value = metadataValue(asset, key);
      if (value) values.push(String(value));
    });
  });

  return Array.from(new Set(values)).slice(0, 14);
}, [stories]);

  const ownerChips = useMemo(() => {
    const values = [];

    (stories || []).forEach((asset) => {
      const owner = safeOwner(asset);
      if (owner) values.push(String(owner));
    });

    return Array.from(new Set(values)).slice(0, 10);
  }, [stories]);

  const makeCount = useMemo(() => {
  return new Set(
    (stories || [])
      .map((s) => metadataValue(s, "make"))
      .filter(Boolean)
  ).size;
}, [stories]);

  const openPublicStory = useCallback(
    (asset) => {
      const kac = asset?.kac_id;
      if (!kac) {
        Alert.alert("Story unavailable", "This asset does not have a public Keepr Story URL yet.");
        return;
      }

      if (Platform.OS === "web" && typeof window !== "undefined") {
        const originQuery = hub?.slug
        ? `?hub=${encodeURIComponent(hub.slug)}&hubName=${encodeURIComponent(hub.name || "Hub")}`
        : "";

      window.location.href = `/k/${kac}${originQuery}`;
        return;
      }

      // Native fallback. If your navigator uses a different public-story route,
      // update this route name in one place.
      try {
      navigation.navigate("KeeprStoryInternal", {
        assetId: item.id,
        kac: item.kac_id,
        hubId: hub?.id,
        hubSlug: hub?.slug,
        hubName: hub?.name,
        mode: "internal",
      });
      } catch (e) {
        Linking.openURL(`https://app.keeprhome.com/k/${kac}`);
      }
      },
      [navigation, hub]
      );

  const renderCard = ({ item }) => {

    const heroUri =
    item.primary_attachment_url ||
    item.public_hero_url ||
    item.hero_thumb_url ||
    item.hero_image_url ||
    pickAssetHeroUri(item);
    const mode = storyModeLabel(item);
    const owner = safeOwner(item);

    return (
      <TouchableOpacity
        onPress={() => {
          if (isInternal) {
          navigation.navigate("KeeprStoryInternal", {
            assetId: item.id,
            kac: item.kac_id,
            hubId: hub?.id,
            hubSlug: hub?.slug,
            hubName: hub?.name,
            mode: "internal",
          });
          } else {
            openPublicStory(item);
          }
        }}
        activeOpacity={0.9}
        style={[
          styles.card,
          {
            width: cardWidth,
            marginBottom: cardGap,
          },
        ]}
      >
      
        <View style={[styles.heroWrap, { height: heroHeight }]}>
          {heroUri ? (
            <Image
              source={{ uri: heroUri }}
              style={[
                styles.hero,
              ]}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.heroPlaceholder}>
              <Ionicons name="image-outline" size={28} color={colors.textMuted} />
              <Text style={styles.heroPlaceholderText}>No photo</Text>
            </View>
          )}

          <View style={styles.statePill}>
            <Text style={styles.statePillText}>{mode}</Text>
          </View>
        </View>

        <View style={styles.cardBody}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            {safeTitle(item)}
          </Text>

          <Text style={styles.cardSubtitle} numberOfLines={2}>
            {safeSubtitle(item)}
          </Text>
          {owner ? (
          <Text style={styles.cardOwner} numberOfLines={1}>
            Owned by {owner}
          </Text>
        ) : null}
          <View style={styles.cardTagRow}>
            <View style={styles.cardTag}>
              <Text style={styles.cardTagText}>Keepr Story</Text>
            </View>

            {item._featured ? (
              <View style={styles.cardTagMuted}>
                <Text style={styles.cardTagMutedText}>Featured</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.metaRow}>
            <Text style={styles.metaText}>
              {item._linkedAt ? `Added ${daysSince(item._linkedAt)}d ago` : ""}
            </Text>

            {item.kac_id ? (
              <Text style={styles.metaText} numberOfLines={1}>
                {item.kac_id}
              </Text>
            ) : null}
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const header = (
    <View style={styles.top}>

      <View style={styles.searchRow}>
        <Ionicons name="search-outline" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search stories…"
          placeholderTextColor={colors.textMuted}
          style={styles.searchInput}
          autoCapitalize="none"
        />

        <TouchableOpacity
          style={styles.sortBtn}
          onPress={() => {
            const idx = SORT_OPTIONS.findIndex((s) => s.key === sortKey);
            const next = SORT_OPTIONS[(idx + 1) % SORT_OPTIONS.length].key;
            setSortKey(next);
          }}
          activeOpacity={0.85}
        >
          <Ionicons name="swap-vertical" size={18} color={colors.textPrimary} />
          <Text style={styles.sortText}>
            {SORT_OPTIONS.find((s) => s.key === sortKey)?.label}
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.filterLabel}>Explore the Collection</Text>
      <View style={styles.chipRow}>
        <TouchableOpacity
          style={[styles.chip, !activeChip && styles.chipActive]}
          onPress={() => {
            setActiveChip(null);
            setQuery("");
          }}
        >
          <Text style={[styles.chipText, !activeChip && styles.chipTextActive]}>
            All
          </Text>
        </TouchableOpacity>

        {assetChips.map((chip) => {
          const active = activeChip === chip;
          return (
            <TouchableOpacity
              key={chip}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                setActiveChip(chip);
                setQuery(chip);
              }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {chip}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.filterLabel}>Owners</Text>
      <View style={styles.chipRow}>
        {ownerChips.map((chip) => {
          const active = activeChip === chip;
          return (
            <TouchableOpacity
              key={chip}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => {
                setActiveChip(chip);
                setQuery(chip);
              }}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]}>
                {chip}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.summaryRow}>
        <Text style={styles.summaryText}>
          Ownership stories shared with this Hub
        </Text>

        <TouchableOpacity onPress={loadHub} style={styles.refreshBtn} activeOpacity={0.85}>
          <Ionicons name="refresh" size={18} color={colors.textPrimary} />
          <Text style={styles.refreshText}>Refresh</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const currentMember =
    hub?.members?.find((m) => String(m.user_id) === String(currentUserId)) ||
    hub?.currentMember ||
    null;

  const memberRole = currentMember?.role;

  const canManageHub = memberRole === "owner" || memberRole === "admin";
  const canManageStories = canManageHub;

  const canInviteMembers =
    canManageHub || hub?.settings?.members_can_invite === true;
  
const hubActions = isInternal ? (
  <View style={styles.hubActions}>
    {canManageHub ? (
      <TouchableOpacity
        style={styles.primaryHubAction}
        onPress={() =>
          navigation.navigate("HubDetail", {
            hubId: hub?.id,
            hub,
          })
        }
      >
        <Ionicons name="settings-outline" size={16} color="#fff" />
        <Text style={styles.primaryHubActionText}>Manage Hub</Text>
      </TouchableOpacity>
    ) : null}

    <TouchableOpacity
      style={styles.secondaryHubAction}
      onPress={() => {
        if (!hub?.slug) return;

        if (Platform.OS === "web" && typeof window !== "undefined") {
          window.open(`/h/${hub.slug}`, "_blank", "noopener,noreferrer");
          return;
        }

        navigation.navigate("KeeprHub", { slug: hub.slug });
      }}
    >
      <Ionicons name="globe-outline" size={16} color={colors.textPrimary} />
      <Text style={styles.secondaryHubActionText}>Launch the Public Hub</Text>
    </TouchableOpacity>

    {canManageStories ? (
      <TouchableOpacity
        style={styles.secondaryHubAction}
        onPress={() =>
          navigation.navigate("ManageHubStories", {
            hubId: hub?.id,
            hub,
          })
        }
      >
        <Ionicons name="albums-outline" size={16} color={colors.textPrimary} />
        <Text style={styles.secondaryHubActionText}>Manage Stories</Text>
      </TouchableOpacity>
    ) : null}

    {canInviteMembers ? (
      <TouchableOpacity
        style={styles.secondaryHubAction}
        onPress={() =>
          navigation.navigate("InviteHubMembers", {
            hubId: hub?.id,
            hub,
          })
        }
      >
        <Ionicons name="person-add-outline" size={16} color={colors.textPrimary} />
        <Text style={styles.secondaryHubActionText}>Invite Members</Text>
      </TouchableOpacity>
    ) : null}
  </View>
) : null;

const hubContent = (
  <View
    style={[layoutStyles?.container, { flex: 1, width: "100%" }]}
    onLayout={(e) => {
      const w = e?.nativeEvent?.layout?.width;
      if (w && Math.abs(w - (containerWidth || 0)) > 1) {
        setContainerWidth(w);
      }
    }}
  >

    {hubActions}
    {header}

    {loading ? (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.loadingText}>Loading hub…</Text>
      </View>
    ) : filtered.length === 0 ? (
      <View style={styles.empty}>
        <Ionicons name="albums-outline" size={34} color={colors.textMuted} />
        <Text style={styles.emptyTitle}>No stories yet</Text>
        <Text style={styles.emptyText}>
          Add public Keepr Story links to make this Hub come alive.
        </Text>
      </View>
    ) : (
      <View style={styles.grid}>
        {filtered.map((item) => (
          <View key={item._hubLinkId || item.id} style={styles.cardShell}>
            {renderCard({ item })}
          </View>
        ))}
      </View>
    )}
  </View>
);

const shellProps = {
  hub,
  stats: {
    stories: filtered.length,
    owners: ownerChips.length,
    makes: makeCount,
  },
  logoUrl: hub?.logo_url || hub?.photo_url || hub?.hero_image_url,
};

if (isInternal) {
  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <InternalHubShell {...shellProps}>
        {hubContent}
      </InternalHubShell>
    </SafeAreaView>
  );
}

return (
  <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
    <PublicHubShell {...shellProps}>
      {hubContent}
    </PublicHubShell>
  </SafeAreaView>
);
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },

  top: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 12 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  h1: { fontSize: 22, fontWeight: "700", color: colors.textPrimary },
  h2: { marginTop: 2, color: colors.textMuted, fontSize: 13 },
  description: {
    marginTop: 8,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  cardOwner: {
  marginTop: 4,
  color: colors.textMuted,
  fontSize: 12,
  fontWeight: "700",
},

  hubType: {
  marginTop: 4,
  fontSize: 11,
  fontWeight: "800",
  letterSpacing: 1,
  color: colors.textMuted,
},

hubActions: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 10,
  marginBottom: 18,
},

primaryHubAction: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  backgroundColor: "#111827",
  borderRadius: 999,
  paddingHorizontal: 16,
  paddingVertical: 10,
},

primaryHubActionText: {
  color: "#fff",
  fontSize: 13,
  fontWeight: "800",
},

secondaryHubAction: {
  flexDirection: "row",
  alignItems: "center",
  gap: 8,
  backgroundColor: colors.surface,
  borderRadius: 999,
  borderWidth: 1,
  borderColor: "#11182722",
  paddingHorizontal: 16,
  paddingVertical: 10,
},

secondaryHubActionText: {
  color: colors.textPrimary,
  fontSize: 13,
  fontWeight: "800",
},

grid: {
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 16,
},

cardShell: {
  width: 420,
  maxWidth: "100%",
},

  searchRow: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#11182722",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14 },

chipRow: {
  marginTop: 10,
  flexDirection: "row",
  flexWrap: "wrap",
  gap: 8,
},

chip: {
  paddingHorizontal: 10,
  paddingVertical: 6,
  borderRadius: 999,
  backgroundColor: colors.surface,
  borderWidth: 1,
  borderColor: "#11182722",
},

chipActive: {
  backgroundColor: "#111827",
  borderColor: "#111827",
},

chipText: {
  fontSize: 12,
  fontWeight: "800",
  color: colors.textMuted,
},

chipTextActive: {
  color: "#fff",
},

filterLabel: {
  marginTop: 12,
  fontSize: 11,
  fontWeight: "900",
  letterSpacing: 0.8,
  color: colors.textMuted,
  textTransform: "uppercase",
},

  sortBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  sortText: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },

  summaryRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryText: { color: colors.textMuted, fontSize: 12, fontWeight: "600", flex: 1 },

  refreshBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
  },
  refreshText: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },

  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: colors.textMuted },

  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 8,
  },
  emptyTitle: { color: colors.textPrimary, fontWeight: "800", fontSize: 17 },
  emptyText: {
    color: colors.textMuted,
    fontWeight: "600",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 18,
  },

  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: "#11182722",
    ...(shadows?.subtle || {}),
  },
  heroWrap: { position: "relative", width: "100%", backgroundColor: "#f2f3f5" },
  hero: { width: "100%", height: "100%" },
  heroPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#f2f3f5",
  },
  heroPlaceholderText: { color: colors.textMuted, fontWeight: "600" },

  statePill: {
    position: "absolute",
    top: 10,
    left: 10,
    backgroundColor: "rgba(0,0,0,0.65)",
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },
  statePillText: { color: "white", fontWeight: "800", fontSize: 11 },

  cardBody: { padding: 12 },
  cardTitle: { color: colors.textPrimary, fontWeight: "800", fontSize: 15 },
  cardSubtitle: {
    marginTop: 3,
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
  },

  cardTagRow: {
    marginTop: 10,
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  cardTag: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#111827",
  },
  cardTagText: {
    color: "white",
    fontSize: 11,
    fontWeight: "800",
  },
  cardTagMuted: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#f2f3f5",
    borderWidth: 1,
    borderColor: "#11182722",
  },
  cardTagMutedText: {
    color: colors.textPrimary,
    fontSize: 11,
    fontWeight: "700",
  },

  metaRow: { marginTop: 10, flexDirection: "row", justifyContent: "space-between", gap: 8 },
  metaText: { color: colors.textMuted, fontSize: 11, fontWeight: "700", flexShrink: 1 },
});