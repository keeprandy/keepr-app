import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Linking,
  Alert,
  ActivityIndicator,
  Modal,
  Share,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { useOperationFeedback } from "../context/OperationFeedbackContext";

const categoryIconName = (category) => {
  switch (category) {
    case "marine":
      return "boat-outline";
    case "vehicles":
      return "car-outline";
    case "home":
      return "home-outline";
    case "outdoor":
      return "leaf-outline";
    default:
      return "person-outline";
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

const CATEGORY_OPTIONS = [
  { id: "marine", label: "Marine" },
  { id: "vehicles", label: "Vehicles" },
  { id: "home", label: "Home systems" },
  { id: "outdoor", label: "Outdoor" },
  { id: "other", label: "Other" },
];

// Normalizes both:
// - { data: { user: null }, error: AuthSessionMissingError }
// - thrown AuthSessionMissingError
const safeGetUser = async () => {
  try {
    const result = await supabase.auth.getUser();
    if (result?.error && result.error.name === "AuthSessionMissingError") {
      return { data: { user: null }, error: null };
    }
    return result;
  } catch (e) {
    if (e?.name === "AuthSessionMissingError") {
      return { data: { user: null }, error: null };
    }
    throw e;
  }
};

// DB row -> UI shape
const mapRowToPro = (row) => ({
  id: row.id,
  name: row.name,
  category: row.category || "other",
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

  // Address fields
  address_line1: row.address_line1 || "",
  address_line2: row.address_line2 || "",
  city: row.city || "",
  state: row.state || "",
  postal_code: row.postal_code || "",
  country: row.country || "",
});

const formatDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${mm}-${dd}-${yyyy}`;
};

const blankDraft = () => ({
  name: "",
  phone: "",
  email: "",
  website: "",
  location: "",
  category: "other",
  notes: "",
  address_line1: "",
  address_line2: "",
  city: "",
  state: "",
  postal_code: "",
  country: "",
});

export default function KeeprProDetailScreen({ route, navigation }) {
  const isCreateMode =
    route?.params?.mode === "create" ||
    route?.params?.create === true ||
    route?.params?.isCreate === true;

  const initialPro = route.params?.pro || null;
  const keeprProId = route.params?.keeprProId || null;
  const [pro, setPro] = useState(initialPro || null);
  const [loading, setLoading] = useState(
    !isCreateMode && !!(initialPro?.id || keeprProId)
  );
  const [togglingFavorite, setTogglingFavorite] = useState(false);

  const [isEditing, setIsEditing] = useState(isCreateMode ? true : false);
  const [draft, setDraft] = useState(isCreateMode ? blankDraft() : null);
  const [savingProfile, setSavingProfile] = useState(false);

  const [helpVisible, setHelpVisible] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmVisible, setDeleteConfirmVisible] = useState(false);
  const { runMutation, showError } = useOperationFeedback();

  // Live relationship data
  const [serviceEvents, setServiceEvents] = useState([]);
  const [serviceLoading, setServiceLoading] = useState(isCreateMode ? false : true);
  const [serviceError, setServiceError] = useState(null);

  // If NOT create mode, load latest pro details by id
  useEffect(() => {
    let isMounted = true;

    const fetchPro = async () => {
      if (isCreateMode) {
        // Create mode: nothing to fetch
        setLoading(false);
        return;
      }

      const idToFetch = initialPro?.id || keeprProId;
      if (!idToFetch) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const { data: userData, error: userError } = await safeGetUser();
        if (userError) throw userError;
        const user = userData?.user;

        if (!user) {
          setLoading(false);
          return;
        }

        const { data, error } = await supabase
          .from("keepr_pros")
          .select("*")
          .eq("id", idToFetch)
          .eq("user_id", user.id)
          .single();

        if (error && error.code !== "PGRST116") {
          throw error;
        }

        if (!isMounted) return;

        if (data) {
          setPro(mapRowToPro(data));
        } else {
          setPro(initialPro);
        }
      } catch (err) {
        console.error("Error loading Keepr Pro detail:", err);
        if (isMounted) {
          Alert.alert(
            "Error",
            "We couldn't load the latest details for this Keepr Pro."
          );
          setPro(initialPro || null);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchPro();

    return () => {
      isMounted = false;
    };
  }, [initialPro, isCreateMode]);

  // Keep editable draft in sync with loaded Pro (non-create)
  useEffect(() => {
    if (isCreateMode) {
      // draft already seeded
      return;
    }
    if (!pro) {
      setDraft(null);
      return;
    }
    setDraft({
      name: pro.name,
      phone: pro.phone || "",
      email: pro.email || "",
      website: pro.website || "",
      location: pro.location || "",
      category: pro.category || "other",
      notes: pro.notes || "",
      address_line1: pro.address_line1 || "",
      address_line2: pro.address_line2 || "",
      city: pro.city || "",
      state: pro.state || "",
      postal_code: pro.postal_code || "",
      country: pro.country || "",
    });
  }, [pro, isCreateMode]);

  // Load live service_records + related assets for this Keepr Pro (non-create)
  useEffect(() => {
    let isMounted = true;

    const fetchRelationships = async () => {
      if (isCreateMode) {
        setServiceLoading(false);
        return;
      }

      if (!pro?.id) {
        setServiceLoading(false);
        return;
      }

      try {
        setServiceLoading(true);
        setServiceError(null);

        const { data: records, error: recordsErr } = await supabase
          .from("service_records")
          .select("id, asset_id, title, notes, service_type, performed_at, cost")
          .eq("keepr_pro_id", pro.id)
          .order("performed_at", { ascending: false });

        if (recordsErr) {
          console.error("Error loading service_records for Keepr Pro:", recordsErr);
          if (!isMounted) return;
          setServiceError("Could not load service history for this Keepr Pro.");
          setServiceEvents([]);
          return;
        }

        if (!records || records.length === 0) {
          if (!isMounted) return;
          setServiceEvents([]);
          return;
        }

        const assetIds = [
          ...new Set(records.map((r) => r.asset_id).filter((id) => !!id)),
        ];

        let assetById = {};
        if (assetIds.length > 0) {
          const { data: assets, error: assetsErr } = await supabase
            .from("assets")
            .select("id, name, type")
            .in("id", assetIds);

          if (assetsErr) {
            console.error("Error loading assets for Keepr Pro view:", assetsErr);
          } else if (assets) {
            assetById = assets.reduce((acc, a) => {
              acc[a.id] = a;
              return acc;
            }, {});
          }
        }

        if (!isMounted) return;

        const events = records.map((r) => {
          const asset = assetById[r.asset_id] || null;
          return {
            id: r.id,
            assetId: r.asset_id,
            assetName: asset?.name || "Asset",
            assetType: asset?.type || null,
            title:
              r.title ||
              (r.service_type === "diy" ? "DIY maintenance" : "Service"),
            notes: r.notes || "",
            cost: r.cost,
            date: r.performed_at,
          };
        });

        setServiceEvents(events);
      } catch (err) {
        console.error("Unexpected error loading Keepr Pro relationships:", err);
        if (!isMounted) return;
        setServiceError("Could not load service history for this Keepr Pro.");
        setServiceEvents([]);
      } finally {
        if (isMounted) setServiceLoading(false);
      }
    };

    fetchRelationships();

    return () => {
      isMounted = false;
    };
  }, [pro?.id, isCreateMode]);

  const assetChips = useMemo(() => {
    const map = new Map();
    serviceEvents.forEach((evt) => {
      if (!evt.assetId) return;
      if (!map.has(evt.assetId)) {
        map.set(evt.assetId, {
          assetId: evt.assetId,
          name: evt.assetName,
          type: evt.assetType,
        });
      }
    });
    return Array.from(map.values());
  }, [serviceEvents]);

  // If create mode and we haven't created yet, we still render the screen (draft-driven)
  if (!pro && !loading && !isCreateMode) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={{ padding: spacing.lg }}>
          <Text style={{ color: colors.textPrimary }}>
            No Keepr Pro data provided.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const normalizePhone = (raw) => {
    if (!raw) return "";
    return raw.replace(/[^+\d]/g, "");
  };

  const handleCall = () => {
    const phoneSrc = isCreateMode ? draft?.phone : pro?.phone;
    if (!phoneSrc) {
      Alert.alert("No phone number", "This Keepr Pro has no phone number set.");
      return;
    }
    const phone = normalizePhone(phoneSrc);
    Linking.openURL(`tel:${phone}`);
  };

  const handleText = () => {
    const phoneSrc = isCreateMode ? draft?.phone : pro?.phone;
    if (!phoneSrc) {
      Alert.alert("No phone number", "This Keepr Pro has no phone number set.");
      return;
    }
    const phone = normalizePhone(phoneSrc);
    Linking.openURL(`sms:${phone}`);
  };

  const handleWebsite = () => {
    const websiteSrc = isCreateMode ? draft?.website : pro?.website;
    if (!websiteSrc) {
      Alert.alert("No website", "This Keepr Pro does not have a website set yet.");
      return;
    }
    let url = websiteSrc.trim();
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    Linking.openURL(url);
  };

  const handleEmail = () => {
    const emailSrc = isCreateMode ? draft?.email : pro?.email;
    if (!emailSrc) {
      Alert.alert("No email", "This Keepr Pro does not have an email address set yet.");
      return;
    }
    Linking.openURL(`mailto:${emailSrc}`);
  };

  const buildAddressStringFrom = (obj) => {
    if (!obj) return "";
    const parts = [
      obj.address_line1,
      obj.address_line2,
      obj.city,
      obj.state,
      obj.postal_code,
      obj.country,
    ].filter(Boolean);

    if (parts.length === 0 && obj.location) {
      parts.push(obj.location);
    }

    return parts.join(", ");
  };

  const buildAddressString = () => {
    if (isCreateMode) return buildAddressStringFrom(draft);
    return buildAddressStringFrom(pro);
  };

  const handleDirections = () => {
    const addr = buildAddressString();
    if (!addr) {
      Alert.alert("No address", "This Keepr Pro doesn't have an address set yet.");
      return;
    }

    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      addr
    )}`;

    Linking.openURL(url).catch(() => {
      Alert.alert(
        "Unable to open maps",
        "We couldn't open your maps app on this device."
      );
    });
  };

  const handleShare = async () => {
    const obj = isCreateMode ? draft : pro;
    if (!obj) return;

    const addr = buildAddressString();
    const lines = [
      obj.name,
      addr,
      obj.phone && `Phone: ${obj.phone}`,
      obj.email && `Email: ${obj.email}`,
      obj.website && `Website: ${obj.website}`,
    ]
      .filter(Boolean)
      .join("\n");

    const message =
      lines.length > 0
        ? `${lines}\n\nShared from Keepr (your asset story & service hub).`
        : `Shared from Keepr: ${obj.name}`;

    try {
      await Share.share({
        message,
        title: `Keepr Pro: ${obj.name || "Keepr Pro"}`,
      });
    } catch (err) {
      console.error("Share error:", err);
    }
  };

  const handleToggleFavorite = async () => {
    if (!pro?.id) return;

    try {
      setTogglingFavorite(true);
      const next = !pro.isFavorite;

      setPro((prev) => (prev ? { ...prev, isFavorite: next } : prev));

      const { data: userData, error: userError } = await safeGetUser();
      if (userError) throw userError;
      const user = userData?.user;
      if (!user) throw new Error("Not signed in");

      const { error } = await supabase
        .from("keepr_pros")
        .update({ is_favorite: next })
        .eq("id", pro.id)
        .eq("user_id", user.id);

      if (error) {
        setPro((prev) => (prev ? { ...prev, isFavorite: !next } : prev));
        throw error;
      }
    } catch (err) {
      console.error("Error toggling favorite:", err);
      Alert.alert(
        "Update failed",
        "We couldn't update the favorite status. Please try again."
      );
    } finally {
      setTogglingFavorite(false);
    }
  };

  const mapDraftToInsertPayload = (userId, d) => ({
    user_id: userId,
    name: (d?.name || "").trim() || "Unnamed Keepr Pro",
    category: d?.category || "other",
    phone: d?.phone ? d.phone : null,
    email: d?.email ? d.email : null,
    website: d?.website ? d.website : null,
    location: d?.location ? d.location : null,
    notes: d?.notes ? d.notes : null,
    since_label: "Keepr setup",
    last_service: null,
    is_favorite: false,
    assets: [],
    service_history: [],
    address_line1: d?.address_line1 ? d.address_line1 : null,
    address_line2: d?.address_line2 ? d.address_line2 : null,
    city: d?.city ? d.city : null,
    state: d?.state ? d.state : null,
    postal_code: d?.postal_code ? d.postal_code : null,
    country: d?.country ? d.country : null,
    source: "manual",
    contact_id: null,
  });

  const handleCreatePro = async () => {
    if (!draft) return;

    const nameTrim = (draft.name || "").trim();
    if (!nameTrim) {
      Alert.alert("Missing name", "Please enter a name for this Keepr Pro.");
      return;
    }

    try {
      setSavingProfile(true);

      const { data: userData, error: userError } = await safeGetUser();
      if (userError) throw userError;
      const user = userData?.user;

      if (!user) {
        Alert.alert(
          "Sign in required",
          "To create a Keepr Pro, you need to be signed in."
        );
        return;
      }

      const payload = mapDraftToInsertPayload(user.id, draft);

      const { data: inserted, error } = await supabase
        .from("keepr_pros")
        .insert([payload])
        .select("*")
        .single();

      if (error) throw error;

      const saved = mapRowToPro(inserted);
      setPro(saved);
      setIsEditing(false);

      Alert.alert("Keepr Pro created", `"${saved.name}" is now in your Keepr Pros.`);
    } catch (err) {
      console.error("Error creating Keepr Pro:", err);
      Alert.alert(
        "Create failed",
        "We couldn't create this Keepr Pro. Please try again."
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleSaveProfile = async () => {
    // In create mode, Save = Create
    if (isCreateMode && !pro?.id) {
      await handleCreatePro();
      return;
    }

    if (!pro?.id || !draft) return;

    try {
      setSavingProfile(true);

      const { data: userData, error: userError } = await safeGetUser();
      if (userError) throw userError;
      const user = userData?.user;
      if (!user) throw new Error("Not signed in");

      const updates = {
        name: draft.name && draft.name.trim() ? draft.name.trim() : pro.name,
        phone: draft.phone || null,
        email: draft.email || null,
        website: draft.website || null,
        location: draft.location || null,
        category: draft.category || null,
        notes: draft.notes || null,
        address_line1: draft.address_line1 || null,
        address_line2: draft.address_line2 || null,
        city: draft.city || null,
        state: draft.state || null,
        postal_code: draft.postal_code || null,
        country: draft.country || null,
      };

      const { error } = await supabase
        .from("keepr_pros")
        .update(updates)
        .eq("id", pro.id)
        .eq("user_id", user.id);

      if (error) throw error;

      setPro((prev) => (prev ? { ...prev, ...updates } : prev));
      setIsEditing(false);
    } catch (err) {
      console.error("Error saving Keepr Pro profile:", err);
      Alert.alert("Save failed", "We couldn't save this Keepr Pro. Please try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  const handleDeletePro = async () => {
    if (!pro?.id) return;

    setDeleteConfirmVisible(false);

    const { ok } = await runMutation({
      busyMessage: "Deleting…",
      success: "KeeprPro deleted",
      error: "Couldn’t delete KeeprPro",
      action: async () => {
        setDeleting(true);
        try {
          const { data: userData, error: userError } = await safeGetUser();
          if (userError) throw userError;
          const user = userData?.user;
          if (!user) throw new Error("Not signed in");

          const { error } = await supabase
            .from("keepr_pros")
            .delete()
            .eq("id", pro.id)
            .eq("user_id", user.id);

          if (error) throw error;
        } finally {
          setDeleting(false);
        }
      },
    });

    if (ok) navigation.goBack();
  };

  const confirmDeletePro = () => {
    if (!pro?.id) return;
    setDeleteConfirmVisible(true);
  };

  const handleServicePress = (evt) => {
    if (!evt.assetId || !evt.assetType) {
      Alert.alert(
        "Asset not linked",
        "This service record is not fully linked to a Keepr asset yet."
      );
      return;
    }

    if (evt.assetType === "boat") {
      navigation.navigate("BoatStory", { boatId: evt.assetId });
    } else if (evt.assetType === "vehicle") {
      navigation.navigate("VehicleStory", { vehicleId: evt.assetId });
    } else {
      Alert.alert(
        "Coming soon",
        "Jumping to this asset's story from a Keepr Pro is coming soon for this asset type."
      );
    }
  };

  const displayName = isCreateMode ? draft?.name : pro?.name;
  const category = categoryLabel(isCreateMode ? draft?.category : pro?.category);
  const addressString = buildAddressString();

  const showFavorite = !isCreateMode && !!pro?.id;
  const showDetailSections = !isCreateMode && !!pro?.id;

  return (
    <SafeAreaView style={layoutStyles.screen}>
      {loading ? (
        <View
          style={{
            flex: 1,
            justifyContent: "center",
            alignItems: "center",
            padding: spacing.lg,
          }}
        >
          <ActivityIndicator size="small" color={colors.brandBlue} />
          <Text
            style={{
              fontSize: 12,
              color: colors.textMuted,
              marginTop: spacing.sm,
            }}
          >
            Loading Keepr Pro…
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.container}
          showsVerticalScrollIndicator={false}
        >
          {/* Top bar */}
          <View style={styles.topBar}>
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
            </TouchableOpacity>

            <Text style={styles.title}>
              {isCreateMode && !pro?.id ? "New Keepr™ Pro" : "Keepr™ Pro"}
            </Text>

            <TouchableOpacity
              style={styles.helpButton}
              onPress={() => setHelpVisible(true)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons
                name="help-circle-outline"
                size={20}
                color={colors.textSecondary}
              />
            </TouchableOpacity>

            {showFavorite && (
              <TouchableOpacity
                style={styles.favoritePill}
                onPress={handleToggleFavorite}
                activeOpacity={0.85}
                disabled={togglingFavorite}
              >
                <Ionicons
                  name={pro?.isFavorite ? "star" : "star-outline"}
                  size={16}
                  color={pro?.isFavorite ? "#FACC15" : colors.textSecondary}
                />
                <Text style={styles.favoritePillText}>
                  {pro?.isFavorite ? "Favorite" : "Make favorite"}
                </Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Hero card */}
          <View style={styles.heroCard}>
            <View style={styles.heroIconWrap}>
              <Ionicons
                name={categoryIconName(isCreateMode ? draft?.category : pro?.category)}
                size={26}
                color={colors.brandBlue}
              />
            </View>
            <View style={styles.heroTextWrap}>
              <Text style={styles.heroName}>
                {displayName && displayName.trim()
                  ? displayName.trim()
                  : isCreateMode
                  ? "Unnamed Keepr Pro"
                  : ""}
              </Text>
              <Text style={styles.heroCategory}>{category}</Text>

              {!isEditing && (
                <TouchableOpacity
                  onPress={() => setIsEditing(true)}
                  style={styles.heroEditLinkWrap}
                  activeOpacity={0.85}
                >
                  <Text style={styles.heroEditLinkText}>
                    {isCreateMode && !pro?.id ? "Enter details" : "Edit contact & tags"}
                  </Text>
                </TouchableOpacity>
              )}

              {/* Contact block (uses pro when saved; draft when creating) */}
              {(isCreateMode
                ? draft?.phone || draft?.email || draft?.website || addressString
                : pro?.phone || pro?.email || pro?.website || addressString) && (
                <View style={styles.heroContactBlock}>
                  {(isCreateMode ? draft?.phone : pro?.phone) ? (
                    <TouchableOpacity
                      style={styles.contactRow}
                      onPress={handleCall}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name="call-outline"
                        size={14}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.contactRowText}>
                        {isCreateMode ? draft.phone : pro.phone}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {(isCreateMode ? draft?.email : pro?.email) ? (
                    <TouchableOpacity
                      style={styles.contactRow}
                      onPress={handleEmail}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name="mail-outline"
                        size={14}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.contactRowText}>
                        {isCreateMode ? draft.email : pro.email}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {(isCreateMode ? draft?.website : pro?.website) ? (
                    <TouchableOpacity
                      style={styles.contactRow}
                      onPress={handleWebsite}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name="globe-outline"
                        size={14}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.contactRowText}>
                        {isCreateMode ? draft.website : pro.website}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  {addressString ? (
                    <TouchableOpacity
                      style={styles.contactRow}
                      onPress={handleDirections}
                      activeOpacity={0.8}
                    >
                      <Ionicons
                        name="location-outline"
                        size={14}
                        color={colors.textSecondary}
                      />
                      <Text style={styles.contactRowText} numberOfLines={2}>
                        {addressString}
                      </Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              )}
            </View>
          </View>

          {/* Editing / Create card */}
          {isEditing && draft && (
            <View style={styles.editCard}>
              <Text style={styles.sectionLabel}>
                {isCreateMode && !pro?.id ? "Create Keepr Pro" : "Edit Keepr Pro"}
              </Text>
              <Text style={styles.editHelpText}>
                {isCreateMode && !pro?.id
                  ? "Add contact details, address, and category. You can always refine later."
                  : "Update contact details, address, and category. These changes apply everywhere this Keepr Pro appears."}
              </Text>

              <Text style={styles.editLabel}>Name</Text>
              <TextInput
                style={styles.editInput}
                value={draft.name}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, name: text }))}
                placeholder="Name"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.editLabel}>Phone</Text>
              <TextInput
                style={styles.editInput}
                value={draft.phone}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, phone: text }))}
                keyboardType="phone-pad"
                placeholder="Phone"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.editLabel}>Email</Text>
              <TextInput
                style={styles.editInput}
                value={draft.email}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, email: text }))}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="Email"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.editLabel}>Website</Text>
              <TextInput
                style={styles.editInput}
                value={draft.website}
                onChangeText={(text) =>
                  setDraft((prev) => ({ ...prev, website: text }))
                }
                autoCapitalize="none"
                placeholder="Website"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.editLabel}>Location / label</Text>
              <TextInput
                style={styles.editInput}
                value={draft.location}
                onChangeText={(text) =>
                  setDraft((prev) => ({ ...prev, location: text }))
                }
                placeholder="City, area, or short label"
                placeholderTextColor={colors.textMuted}
              />

              {/* Address fields */}
              <Text style={styles.editLabel}>Street address</Text>
              <TextInput
                style={styles.editInput}
                value={draft.address_line1}
                onChangeText={(text) =>
                  setDraft((prev) => ({ ...prev, address_line1: text }))
                }
                placeholder="Street address"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.editLabel}>Street address line 2</Text>
              <TextInput
                style={styles.editInput}
                value={draft.address_line2}
                onChangeText={(text) =>
                  setDraft((prev) => ({ ...prev, address_line2: text }))
                }
                placeholder="Suite, unit, etc."
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.editLabel}>City</Text>
              <TextInput
                style={styles.editInput}
                value={draft.city}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, city: text }))}
                placeholder="City"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.editLabel}>State</Text>
              <TextInput
                style={styles.editInput}
                value={draft.state}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, state: text }))}
                placeholder="State"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.editLabel}>ZIP code</Text>
              <TextInput
                style={styles.editInput}
                value={draft.postal_code}
                onChangeText={(text) =>
                  setDraft((prev) => ({ ...prev, postal_code: text }))
                }
                placeholder="ZIP"
                placeholderTextColor={colors.textMuted}
                keyboardType="number-pad"
              />

              <Text style={styles.editLabel}>Country</Text>
              <TextInput
                style={styles.editInput}
                value={draft.country}
                onChangeText={(text) =>
                  setDraft((prev) => ({ ...prev, country: text }))
                }
                placeholder="Country"
                placeholderTextColor={colors.textMuted}
              />

              <Text style={styles.editLabel}>Category</Text>
              <View style={styles.editCategoryRow}>
                {CATEGORY_OPTIONS.map((opt) => {
                  const active = draft.category === opt.id;
                  return (
                    <TouchableOpacity
                      key={opt.id}
                      style={[
                        styles.editCategoryChip,
                        active && styles.editCategoryChipActive,
                      ]}
                      onPress={() => setDraft((prev) => ({ ...prev, category: opt.id }))}
                    >
                      <Text
                        style={[
                          styles.editCategoryChipText,
                          active && styles.editCategoryChipTextActive,
                        ]}
                      >
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.editLabel}>Notes</Text>
              <TextInput
                style={[styles.editInput, styles.editNotesInput]}
                value={draft.notes}
                onChangeText={(text) => setDraft((prev) => ({ ...prev, notes: text }))}
                placeholder="Add notes about this Keepr Pro"
                placeholderTextColor={colors.textMuted}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              <View style={styles.editButtonRow}>
                <TouchableOpacity
                  style={[styles.editButton, styles.editButtonSecondary]}
                  onPress={() => {
                    if (isCreateMode && !pro?.id) {
                      // In create flow, cancel just goes back
                      navigation.goBack();
                      return;
                    }

                    if (!pro) return;

                    setDraft({
                      name: pro.name,
                      phone: pro.phone || "",
                      email: pro.email || "",
                      website: pro.website || "",
                      location: pro.location || "",
                      category: pro.category || "other",
                      notes: pro.notes || "",
                      address_line1: pro.address_line1 || "",
                      address_line2: pro.address_line2 || "",
                      city: pro.city || "",
                      state: pro.state || "",
                      postal_code: pro.postal_code || "",
                      country: pro.country || "",
                    });
                    setIsEditing(false);
                  }}
                >
                  <Text style={styles.editButtonSecondaryText}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.editButton, styles.editButtonPrimary]}
                  onPress={handleSaveProfile}
                  disabled={savingProfile}
                >
                  <Text style={styles.editButtonPrimaryText}>
                    {savingProfile
                      ? isCreateMode && !pro?.id
                        ? "Creating..."
                        : "Saving..."
                      : isCreateMode && !pro?.id
                      ? "Create"
                      : "Save"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {/* Quick actions (only once created / on existing) */}
          {(!isCreateMode || !!pro?.id) && (
            <View style={styles.actionsRow}>
              <TouchableOpacity
                style={styles.actionButton}
                onPress={handleCall}
                activeOpacity={0.85}
              >
                <Ionicons name="call-outline" size={16} color={colors.brandWhite} />
                <Text style={styles.actionButtonText}>Call</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButtonSecondary}
                onPress={handleText}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="chatbubble-outline"
                  size={16}
                  color={colors.textPrimary}
                />
                <Text style={styles.actionButtonSecondaryText}>Text</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButtonSecondary}
                onPress={handleWebsite}
                activeOpacity={0.85}
              >
                <Ionicons name="globe-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.actionButtonSecondaryText}>Website</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButtonSecondary}
                onPress={handleEmail}
                activeOpacity={0.85}
              >
                <Ionicons name="mail-outline" size={16} color={colors.textPrimary} />
                <Text style={styles.actionButtonSecondaryText}>Email</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionButtonSecondary}
                onPress={handleDirections}
                activeOpacity={0.85}
              >
                <Ionicons
                  name="navigate-outline"
                  size={16}
                  color={colors.textPrimary}
                />
                <Text style={styles.actionButtonSecondaryText}>Directions</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Share / invite (only once created / on existing) */}
          {(!isCreateMode || !!pro?.id) && (
            <View style={styles.shareCard}>
              <View style={styles.shareHeaderRow}>
                <Text style={styles.shareTitle}>Share this Keepr Pro</Text>
                <TouchableOpacity onPress={handleShare}>
                  <Ionicons
                    name="share-social-outline"
                    size={18}
                    color={colors.textPrimary}
                  />
                </TouchableOpacity>
              </View>
              <Text style={styles.shareBody}>
                Share this card when someone asks who you use. They get the contact,
                and you both have the story in Keepr.
              </Text>
            </View>
          )}

          {/* Detail sections (hide in create) */}
          {showDetailSections && (
            <>
              {/* Assets and relationship */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Assets they Keepr for you</Text>
                {serviceLoading ? (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <ActivityIndicator size="small" />
                    <Text style={styles.mutedText}>
                      {"  "}
                      Loading linked assets…
                    </Text>
                  </View>
                ) : assetChips.length > 0 ? (
                  assetChips.map((asset) => (
                    <View key={asset.assetId} style={styles.assetRow}>
                      <Ionicons
                        name="shield-checkmark-outline"
                        size={14}
                        color={colors.brandBlue}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.assetText}>{asset.name}</Text>
                    </View>
                  ))
                ) : pro?.assets && pro.assets.length > 0 ? (
                  pro.assets.map((asset) => (
                    <View key={asset} style={styles.assetRow}>
                      <Ionicons
                        name="shield-checkmark-outline"
                        size={14}
                        color={colors.brandBlue}
                        style={{ marginRight: 6 }}
                      />
                      <Text style={styles.assetText}>{asset}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.mutedText}>
                    As you log services and tag this Keepr Pro, Keepr will attach
                    them to specific assets.
                  </Text>
                )}
              </View>

              {/* Service history */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Service history with you</Text>
                {serviceLoading ? (
                  <View style={{ flexDirection: "row", alignItems: "center" }}>
                    <ActivityIndicator size="small" />
                    <Text style={styles.mutedText}>
                      {"  "}
                      Loading service history…
                    </Text>
                  </View>
                ) : serviceError ? (
                  <Text style={styles.mutedText}>{serviceError}</Text>
                ) : serviceEvents.length > 0 ? (
                  serviceEvents.map((svc) => (
                    <TouchableOpacity
                      key={svc.id}
                      style={styles.timelineCard}
                      activeOpacity={0.9}
                      onPress={() => handleServicePress(svc)}
                    >
                      <View style={styles.timelineCardHeader}>
                        <View style={styles.timelineCardTitleRow}>
                          <Ionicons
                            name="time-outline"
                            size={14}
                            color={colors.accentBlue}
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.timelineCardTitle} numberOfLines={1}>
                            {svc.assetName}
                          </Text>
                        </View>
                        <View style={styles.timelineCardRightMeta}>
                          <Text style={styles.timelineCardDate}>
                            {formatDate(svc.date)}
                          </Text>
                          <Ionicons
                            name="chevron-forward"
                            size={16}
                            color={colors.textMuted}
                            style={{ marginLeft: 4 }}
                          />
                        </View>
                      </View>

                      <View style={styles.timelineCardBodyRow}>
                        <Text style={styles.timelineCardSummary} numberOfLines={2}>
                          {svc.title}
                        </Text>
                        {svc.cost != null && (
                          <Text style={styles.timelineCardCost}>
                            ${Number(svc.cost).toLocaleString()}
                          </Text>
                        )}
                      </View>
                    </TouchableOpacity>
                  ))
                ) : pro?.serviceHistory && pro.serviceHistory.length > 0 ? (
                  pro.serviceHistory.map((svc) => (
                    <View
                      key={svc.id ?? `${svc.date}-${svc.asset}`}
                      style={styles.timelineCard}
                    >
                      <View style={styles.timelineCardHeader}>
                        <View style={styles.timelineCardTitleRow}>
                          <Ionicons
                            name="time-outline"
                            size={14}
                            color={colors.accentBlue}
                            style={{ marginRight: 4 }}
                          />
                          <Text style={styles.timelineCardTitle} numberOfLines={1}>
                            {svc.asset}
                          </Text>
                        </View>
                        <Text style={styles.timelineCardDate}>{svc.date}</Text>
                      </View>
                      <Text style={styles.timelineCardSummary}>{svc.summary}</Text>
                    </View>
                  ))
                ) : (
                  <Text style={styles.mutedText}>
                    No services logged yet. When you add a service and tag it with this
                    Keepr Pro, it will appear here.
                  </Text>
                )}
              </View>

              {/* Notes */}
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Your notes</Text>
                {pro?.notes ? (
                  <Text style={styles.notesText}>{pro.notes}</Text>
                ) : (
                  <Text style={styles.mutedText}>No notes yet.</Text>
                )}
              </View>

              {/* Delete Keepr Pro */}
              <View style={styles.section}>
                <TouchableOpacity
                  style={styles.deleteButton}
                  onPress={confirmDeletePro}
                  activeOpacity={0.85}
                  disabled={deleting}
                >
                  <Ionicons
                    name="trash-outline"
                    size={16}
                    color="#B91C1C"
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.deleteButtonText}>
                    {deleting ? "Deleting…" : "Delete Keepr Pro"}
                  </Text>
                </TouchableOpacity>
                <Text style={styles.deleteHelpText}>
                  This removes the Keepr Pro profile from your Keepr. Existing service
                  records stay attached to your assets.
                </Text>
              </View>
            </>
          )}
        </ScrollView>
      )}

      {/* Help modal */}
      <Modal
        visible={helpVisible}
        animationType="fade"
        transparent
        onRequestClose={() => setHelpVisible(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          style={styles.helpModalBackdrop}
          onPress={() => setHelpVisible(false)}
        >
          <View style={styles.helpModalCard}>
            <Text style={styles.helpModalTitle}>Keepr Pro help</Text>
            <ScrollView style={{ marginTop: spacing.sm }}>
              <Text style={styles.helpModalSectionTitle}>What is a Keepr Pro?</Text>
              <Text style={styles.helpModalText}>
                A Keepr Pro is anyone who helps you keep your stuff running — marinas,
                pool companies, mechanics, handymen, and more. Keepr ties them to the
                assets and service records they touch.
              </Text>

              <Text style={styles.helpModalSectionTitle}>Contact and address</Text>
              <Text style={styles.helpModalText}>
                Store phone, email, website, and their physical location. Tap the
                buttons or rows on their card to call, text, email, open their site, or
                launch directions in your maps app.
              </Text>

              <Text style={styles.helpModalSectionTitle}>Service history</Text>
              <Text style={styles.helpModalText}>
                When you log a service record and tag a Keepr Pro, it appears in their
                history here and in the asset&apos;s story. Over time this becomes a
                timeline of the work they have done for you.
              </Text>

              <Text style={styles.helpModalSectionTitle}>Sharing</Text>
              <Text style={styles.helpModalText}>
                Use the Share button to send this Pro&apos;s details when someone asks
                who you use.
              </Text>
            </ScrollView>

            <TouchableOpacity
              style={styles.helpModalCloseButton}
              onPress={() => setHelpVisible(false)}
            >
              <Text style={styles.helpModalCloseText}>Close</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    
      {/* Confirm Delete (Keepr style, web-safe) */}
      <Modal
        visible={deleteConfirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmVisible(false)}
      >
        <View style={styles.confirmBackdrop}>
          <View style={styles.confirmCard}>
            <Text style={styles.confirmTitle}>Delete KeeprPro?</Text>
            <Text style={styles.confirmBody}>
              {serviceEvents.length > 0
                ? "This removes this KeeprPro profile and shortcuts. Your service records stay with your assets."
                : "This removes this KeeprPro profile from your Keepr."}
            </Text>

            <View style={styles.confirmRow}>
              <TouchableOpacity
                style={[styles.confirmBtn, styles.confirmBtnCancel]}
                onPress={() => setDeleteConfirmVisible(false)}
                disabled={deleting}
              >
                <Text style={styles.confirmBtnCancelText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmBtn, styles.confirmBtnDelete, deleting && { opacity: 0.6 }]}
                onPress={handleDeletePro}
                disabled={deleting}
              >
                <Text style={styles.confirmBtnDeleteText}>{deleting ? "Deleting…" : "Delete"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

</SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },

  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSubtle,
  },
  backButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginRight: spacing.sm,
  },
  title: {
    ...typography.title,
    fontSize: 18,
    textAlign: "left",
    flex: 1,
  },
  helpButton: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    marginRight: spacing.sm,
  },
  favoritePill: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    backgroundColor: colors.surfaceSubtle,
  },
  favoritePillText: {
    fontSize: 11,
    marginLeft: 4,
    color: colors.textSecondary,
  },

  heroCard: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  heroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.sm,
  },
  heroTextWrap: {
    flex: 1,
  },
  heroName: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  heroCategory: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  heroLocation: {
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  heroSince: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 4,
  },
  heroEditLinkWrap: {
    marginTop: 6,
  },
  heroEditLinkText: {
    fontSize: 11,
    color: colors.brandBlue,
    fontWeight: "600",
  },
  heroContactBlock: {
    marginTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.borderSubtle,
    paddingTop: spacing.xs,
  },

  actionsRow: {
    flexDirection: "row",
    marginTop: spacing.md,
    flexWrap: "wrap",
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.brandBlue,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: 8,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  actionButtonText: {
    fontSize: 12,
    color: colors.brandWhite,
    fontWeight: "600",
    marginLeft: 6,
  },
  actionButtonSecondary: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  actionButtonSecondaryText: {
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: "600",
    marginLeft: 6,
  },

  shareCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  shareHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  shareTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  shareBody: {
    marginTop: 6,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  section: {
    marginTop: spacing.lg,
  },
  sectionLabel: {
    ...typography.sectionLabel,
    marginBottom: 4,
  },
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 2,
  },
  assetText: {
    fontSize: 12,
    color: colors.textPrimary,
  },
  mutedText: {
    fontSize: 12,
    color: colors.textMuted,
  },

  notesText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },

  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 4,
  },
  contactRowText: {
    marginLeft: 6,
    fontSize: 12,
    color: colors.textPrimary,
    flex: 1,
  },

  editCard: {
    marginTop: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  editHelpText: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 2,
    marginBottom: spacing.sm,
  },
  editLabel: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: spacing.sm,
    marginBottom: 2,
  },
  editInput: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    fontSize: 12,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
  },
  editNotesInput: {
    minHeight: 72,
  },
  editCategoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 4,
  },
  editCategoryChip: {
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    marginRight: spacing.xs,
    marginBottom: spacing.xs,
  },
  editCategoryChipActive: {
    backgroundColor: colors.brandBlueSoft,
    borderColor: colors.brandBlue,
  },
  editCategoryChipText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  editCategoryChipTextActive: {
    color: colors.textPrimary,
    fontWeight: "600",
  },
  editButtonRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: spacing.md,
  },
  editButton: {
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    marginLeft: spacing.xs,
  },
  editButtonSecondary: {
    backgroundColor: colors.surfaceSubtle,
  },
  editButtonSecondaryText: {
    fontSize: 11,
    color: colors.textSecondary,
  },
  editButtonPrimary: {
    backgroundColor: colors.brandBlue,
  },
  editButtonPrimaryText: {
    fontSize: 11,
    color: colors.brandWhite,
    fontWeight: "600",
  },

  // Timeline-like cards (clickable)
  timelineCard: {
    marginTop: spacing.xs + 2,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
  },
  timelineCardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  timelineCardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: spacing.sm,
  },
  timelineCardTitle: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
    flex: 1,
  },
  timelineCardRightMeta: {
    flexDirection: "row",
    alignItems: "center",
  },
  timelineCardDate: {
    fontSize: 11,
    color: colors.textMuted,
  },
  timelineCardBodyRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    alignItems: "flex-start",
  },
  timelineCardSummary: {
    fontSize: 12,
    color: colors.textSecondary,
    flex: 1,
    paddingRight: spacing.sm,
    lineHeight: 18,
  },
  timelineCardCost: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },

  deleteButton: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
  },
  deleteButtonText: {
    fontSize: 12,
    color: "#B91C1C",
    fontWeight: "700",
  },
  deleteHelpText: {
    marginTop: 6,
    fontSize: 11,
    color: colors.textMuted,
    lineHeight: 16,
  },

  // Help modal styles
  helpModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.lg,
  },
  helpModalCard: {
    width: "100%",
    maxHeight: "80%",
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.subtle,
  },
  helpModalTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  helpModalSectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: colors.textPrimary,
    marginTop: spacing.md,
    marginBottom: 2,
  },
  helpModalText: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  helpModalCloseButton: {
    alignSelf: "flex-end",
    marginTop: spacing.md,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    backgroundColor: colors.brandBlue,
  },
  helpModalCloseText: {
    fontSize: 12,
    color: colors.brandWhite,
    fontWeight: "600",
  },

  // Confirm delete modal (Keepr style)
  confirmBackdrop: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
  },
  confirmCard: {
    width: "100%",
    maxWidth: 520,
    borderRadius: radius.xl,
    backgroundColor: "rgba(255, 255, 255, 1)",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    padding: spacing.lg,
    ...shadows.card,
  },
  confirmTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: colors.textPrimary,
    marginBottom: 8,
  },
  confirmBody: {
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
  },
  confirmRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  confirmBtn: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.lg,
    minWidth: 110,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmBtnCancel: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  confirmBtnCancelText: {
    color: colors.textPrimary,
    fontWeight: "700",
    fontSize: 13,
  },
  confirmBtnDelete: {
    backgroundColor: "#C2413A",
  },
  confirmBtnDeleteText: {
    color: "#FFFFFF",
    fontWeight: "800",
    fontSize: 13,
  },

});