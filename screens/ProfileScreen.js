// screens/ProfileScreen.js
import React, { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Image,
  Platform,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { layoutStyles } from "../styles/layout";
import { colors, spacing, radius, typography, shadows } from "../styles/theme";
import { supabase } from "../lib/supabaseClient";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";

const FIELD_LABELS = {
  full_name: "Name",
  display_name: "Display name",
  phone: "Phone",
  birthday: "Birthday",
  language: "Language",
  home_address: "Home address",
  work_address: "Work address",
};

const isValidISODate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());

function formatBytesMB(mb) {
  if (mb === null || mb === undefined || Number.isNaN(Number(mb))) return "0 MB";
  const n = Number(mb);
  if (n >= 1024) return `${(n / 1024).toFixed(2)} GB`;
  return `${n.toFixed(2)} MB`;
}

function safeValue(v) {
  const s = (v ?? "").toString().trim();
  return s.length ? s : null;
}

function toDisplayDate(v) {
  if (!v) return null;
  // Accept "YYYY-MM-DD" or ISO timestamp
  const s = String(v).slice(0, 10);
  return isValidISODate(s) ? s : null;
}

export default function ProfileScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);

  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarBusy, setAvatarBusy] = useState(false);

  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);

  const [ach, setAch] = useState(null);
  const [achLoading, setAchLoading] = useState(true);

  const [editVisible, setEditVisible] = useState(false);
  const [draft, setDraft] = useState({
    full_name: "",
    display_name: "",
    phone: "",
    birthday: "",
    language: "",
    home_address: "",
    work_address: "",
  });
  const [draftSaving, setDraftSaving] = useState(false);

  // Keepr Inbox username (used for email intake)
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState("idle");
  // idle | editing | checking | available | taken | invalid | locked
  const [usernameSaving, setUsernameSaving] = useState(false);

  // Login email change (Supabase Auth)
  const [emailModalVisible, setEmailModalVisible] = useState(false);
  const [newEmail, setNewEmail] = useState("");
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailNotice, setEmailNotice] = useState(null);

  const email = user?.email || profile?.email || "";

  const INBOX_DOMAIN = "inbox.keeprhome.com";
  const inboxEmail = username ? `${username}@${INBOX_DOMAIN}` : "";

  const normalizeUsername = (v) => String(v || "").toLowerCase().trim();
  const isValidUsername = (v) => {
    const s = normalizeUsername(v);
    if (s.length < 3 || s.length > 20) return false;
    return /^[a-z0-9]+$/.test(s);
  };

  const isValidEmail = (v) => {
    const s = String(v || "").trim().toLowerCase();
    if (!s || s.length > 254) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
  };

  const openEmailModal = () => {
    setEmailNotice(null);
    setNewEmail(String(user?.email || profile?.email || "").trim());
    setEmailModalVisible(true);
  };

  const submitEmailChange = async () => {
    const current = String(user?.email || "").trim().toLowerCase();
    const next = String(newEmail || "").trim().toLowerCase();

    if (!next) {
      Alert.alert("Enter an email", "Please enter the email address you want to use for login.");
      return;
    }
    if (!isValidEmail(next)) {
      Alert.alert("Invalid email", "Please enter a valid email address.");
      return;
    }
    if (current && next == current) {
      Alert.alert("No change", "That is already your current login email.");
      return;
    }

    setEmailSaving(true);
    setEmailNotice(null);
    try {
      const { data, error } = await supabase.auth.updateUser({ email: next });
      if (error) throw error;

      setEmailNotice(
        "Confirmation sent. Check your email to complete the change. With secure email change enabled, you may need to confirm from both your old and new addresses."
      );

      // Note: auth email won't update until confirmation completes
      await loadProfile({ silent: true });
    } catch (e) {
      Alert.alert("Could not update email", e?.message || String(e));
    } finally {
      setEmailSaving(false);
    }
  };

  const checkUsernameAvailability = async (value) => {
    const clean = normalizeUsername(value);

    if (!clean) {
      setUsernameStatus("idle");
      return;
    }

    if (!isValidUsername(clean)) {
      setUsernameStatus("invalid");
      return;
    }

    // If username is already locked, do not re-check.
    if (profile?.username && clean === String(profile.username).toLowerCase()) {
      setUsernameStatus("locked");
      return;
    }

    setUsernameStatus("checking");

    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, username")
        .eq("username", clean)
        .limit(1)
        .maybeSingle();

      if (error) {
        // If RLS blocks this check, we will still validate on save.
        setUsernameStatus("available");
        return;
      }

      if (data?.id && data.id !== user?.id) {
        setUsernameStatus("taken");
      } else {
        setUsernameStatus("available");
      }
    } catch (e) {
      setUsernameStatus("available");
    }
  };

  const saveUsername = async () => {
    const clean = normalizeUsername(username);

    if (!isValidUsername(clean)) {
      setUsernameStatus("invalid");
      return;
    }

    if (!user?.id) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }

    try {
      setUsernameSaving(true);

      const { error } = await supabase
        .from("profiles")
        .update({ username: clean })
        .eq("id", user.id);

      if (error) {
        // Unique violation
        if (String(error.code) === "23505") {
          setUsernameStatus("taken");
          Alert.alert("Username taken", "Try another username.");
          return;
        }
        Alert.alert("Could not save username", error.message);
        return;
      }

      setUsername(clean);
      setUsernameStatus("locked");
      setProfile((p) => (p ? { ...p, username: clean } : p));
    } finally {
      setUsernameSaving(false);
    }
  };

  const badges = useMemo(() => {
    const plan = (profile?.plan || "free").toLowerCase();
    const role = (profile?.role || "consumer").toLowerCase();
    const keeprHuman = "I’m a keepr"; // identity state (human)
    const planLabel = plan === "free" ? "Free" : plan[0].toUpperCase() + plan.slice(1);
    const roleLabel = role === "consumer" ? "Owner" : role;
    return [planLabel, roleLabel, keeprHuman];
  }, [profile?.plan, profile?.role]);

  const loadProfile = async ({ silent } = {}) => {
    try {
      if (!silent) setLoading(true);

      const { data: userRes, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;
      const u = userRes?.user || null;
      setUser(u);

      if (!u?.id) {
        setProfile(null);
        return;
      }

      const { data: prof, error: profErr } = await supabase
        .from("profiles")
        .select(
          "id, email, full_name, display_name, role, plan, onboarding_state, onboarding_asset_id, profile_photo_attachment_id, phone, birthday, language, home_address, work_address, username"
        )
        .eq("id", u.id)
        .maybeSingle();

      if (profErr) throw profErr;

      setProfile(prof || null);

      // hydrate inbox username
      if (prof?.username) {
        setUsername(String(prof.username).toLowerCase());
        setUsernameStatus("locked");
      } else {
        setUsername("");
        setUsernameStatus("idle");
      }

      if (prof?.profile_photo_attachment_id) {
        await hydrateAvatarFromAttachmentId(prof.profile_photo_attachment_id);
      } else {
        setAvatarUrl(null);
      }
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadAchievements = async () => {
    try {
      setAchLoading(true);
      const { data, error } = await supabase.rpc("get_my_achievements");
      if (error) throw error;
      // rpc returns array or object depending on SQL; normalize
      const row = Array.isArray(data) ? data[0] : data;
      setAch(row || null);
    } finally {
      setAchLoading(false);
    }
  };

  const hydrateAvatarFromAttachmentId = async (attachmentId) => {
    try {
      // Minimal fetch: attachment row should have bucket + storage_path
      const { data, error } = await supabase
        .from("attachments")
        .select("id, bucket, storage_path")
        .eq("id", attachmentId)
        .maybeSingle();

      if (error) throw error;
      if (!data?.bucket || !data?.storage_path) {
        setAvatarUrl(null);
        return;
      }

      // Signed URL (private buckets safe)
      const { data: signed, error: sErr } = await supabase.storage
        .from(data.bucket)
        .createSignedUrl(data.storage_path, 60 * 60 * 24 * 7);

      if (sErr) throw sErr;
      setAvatarUrl(signed?.signedUrl || null);
    } catch (e) {
      // Soft fail: don't block profile
      setAvatarUrl(null);
    }
  };

  useEffect(() => {
    loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user?.id) loadAchievements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (usernameStatus === "locked") return;

    if (!username) {
      if (usernameStatus !== "idle") setUsernameStatus("idle");
      return;
    }

    const t = setTimeout(() => {
      checkUsernameAvailability(username);
    }, 450);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  
  const openEditProfile = () => {
    setDraft({
      full_name: profile?.full_name ?? "",
      display_name: profile?.display_name ?? "",
      phone: profile?.phone ?? "",
      birthday: profile?.birthday ?? "",
      language: profile?.language ?? "",
      home_address: profile?.home_address ?? "",
      work_address: profile?.work_address ?? "",
    });
    setEditVisible(true);
  };

  const saveProfileEdits = async () => {
    try {
      const birthday = (draft.birthday || "").trim();
      if (birthday && !isValidISODate(birthday)) {
        Alert.alert("Birthday format", "Use YYYY-MM-DD (example: 1964-04-12).");
        return;
      }

      setDraftSaving(true);

      const updates = {
        full_name: (draft.full_name || "").trim() || null,
        display_name: (draft.display_name || "").trim() || null,
        phone: (draft.phone || "").trim() || null,
        birthday: birthday || null,
        language: (draft.language || "").trim() || null,
        home_address: (draft.home_address || "").trim() || null,
        work_address: (draft.work_address || "").trim() || null,
      };

      const { error } = await supabase.from("profiles").update(updates).eq("id", user.id);
      if (error) throw error;

      setEditVisible(false);
      await loadProfile();
    } catch (e) {
      console.error(e);
      Alert.alert("Update failed", e?.message || "Could not update your profile.");
    } finally {
      setDraftSaving(false);
    }
  };

  const pickAndUploadAvatar = async () => {
    if (!user?.id) return;

    setAvatarBusy(true);
    // ✅ Always use the authenticated session id for avatar uploads (RLS-safe)
    const { data: authData, error: authErr } = await supabase.auth.getUser();
    if (authErr) throw authErr;
    const authUserId = authData?.user?.id;
    if (!authUserId) throw new Error("No authenticated session");
    const prevAvatar = avatarUrl;
    try {
      // Web doesn’t need permissions; native does.
      if (Platform.OS !== "web") {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Allow photo access to choose a profile picture.");
          return;
        }
      }

      const mediaTypes =
        ImagePicker.MediaType?.Images
          ? [ImagePicker.MediaType.Images]
          : ImagePicker.MediaTypeOptions.Images;

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes,
        quality: 0.9,
        allowsEditing: true,
        aspect: [1, 1],
      });

      if (result.canceled) return;

      const asset = result.assets?.[0];
      if (!asset?.uri) return;

      // Optimistic preview
      setAvatarUrl(asset.uri);

      const fileNameGuess = asset.fileName || `profile_${Date.now()}.jpg`;
      const mimeTypeGuess = asset.mimeType || "image/jpeg";

// Always use the authenticated user id for RLS-safe inserts
const { data: authData, error: authErr } = await supabase.auth.getUser();
if (authErr) throw authErr;
const authUserId = authData?.user?.id;
if (!authUserId) throw new Error("No authenticated user session");

// (Optional) If you want to be strict, detect mismatch and surface it
// if (user?.id && user.id !== authUserId) {
//   throw new Error("Profile state user mismatch with auth session. Please relogin.");
// }

const created = await uploadAttachmentFromUri({
  userId: authUserId,
  ownerUserId: authUserId,
  owner_user_id: authUserId,
  kind: "photo",
  fileUri: asset.uri,
  fileName: fileNameGuess,
  mimeType: mimeTypeGuess,
  title: "Profile photo",
  sourceContext: "profile",
  placements: [], // no asset placement
});
      const attachmentId = created?.attachment?.id;
      if (!attachmentId) throw new Error("Upload succeeded but no attachment was created.");

      const { error } = await supabase
        .from("profiles")
        .update({ profile_photo_attachment_id: attachmentId })
        .eq("id", user.id);

      if (error) throw error;

      setProfile((p) => ({ ...(p || {}), profile_photo_attachment_id: attachmentId }));

      await hydrateAvatarFromAttachmentId(attachmentId);
      await loadProfile({ silent: true });
    } catch (e) {
      console.log("pickAndUploadAvatar error:", e);
      Alert.alert("Upload failed", e?.message || String(e));
      setAvatarUrl(prevAvatar || null);
    } finally {
      setAvatarBusy(false);
    }
  };
const navigateToTab = (tabName) => {
  // ProfileScreen is on RootStack, so we must target RootTabs
  return navigation.navigate("RootTabs", { screen: tabName });
};

const goToDashboard = () => navigateToTab("Dashboard");
const goToSettings = () => navigateToTab("Settings");

  const openAvatar = async () => {
    if (avatarBusy) return;

    const attId = profile?.profile_photo_attachment_id;

    // If we have a saved photo (attachment id), prefer showing the viewer.
    if (attId) {
      // Ensure we have a usable URL for the viewer.
      if (!avatarUrl) {
        try {
          await hydrateAvatarFromAttachmentId(attId);
        } catch (e) {
          console.warn("[Profile] hydrate avatar failed:", e);
        }
      }
      return setAvatarViewerOpen(true);
    }

    // No saved photo yet → pick one
    return pickAndUploadAvatar();
  };

  const changeAvatar = () => {
    setAvatarViewerOpen(false);
    // small defer so modal closes cleanly before picker opens
    setTimeout(() => pickAndUploadAvatar(), 250);
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  const journeyRows = useMemo(() => {
    const assetCount = Number(ach?.asset_count || 0);
    const photoDone = !!profile?.profile_photo_attachment_id;

    const achievementsLine = ach
      ? `${ach.asset_count || 0} assets · ${ach.system_count || 0} systems · ${ach.service_record_count || 0} records · ${ach.attachment_count || 0} attachments · ${formatBytesMB(ach.attachment_mb || 0)}`
      : null;

    const keepItUp =
      ach && Number(ach.service_records_30d || 0) > 0
        ? `Keep it up — ${ach.service_records_30d} records added in the last 30 days.`
        : "Keep going — your story gets stronger with every record.";

    return [
      {
        id: "journey-start",
        title: "Start your keepr",
        subtitle: "A quick intro to the method: story, proof, and care.",
        done: true,
        onPress: null,
      },

{
  id: "journey-password",
  title: "Change password",
  subtitle: "Update your login password",
  done: false,
  onPress: () => navigation.navigate("ResetPassword"),
},

      {
        id: "journey-assets",
        title: "Add your first asset",
        subtitle: assetCount > 0 ? `${assetCount} in your library` : "Create a home, garage item, or boat to begin.",
        done: assetCount > 0,
        onPress: goToDashboard,
      },
      {
        id: "journey-photo",
        title: "Add a profile photo",
        subtitle: "This makes your keepr feel real instantly.",
        done: photoDone,
        onPress: openAvatar,
      },
      {
        id: "journey-ach",
        title: "Achievements",
        subtitle: achievementsLine || "Story stats will show up here as you add proof and records.",
        done: !!ach,
        onPress: goToDashboard,
        footer: keepItUp,
      },
    ];
  }, [ach, profile?.profile_photo_attachment_id]);

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.center}>
          <ActivityIndicator />
          <Text style={{ color: colors.textMuted, marginTop: 8 }}>Loading profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const headerName = profile?.display_name || profile?.full_name || "Your profile";

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <View style={styles.contentWrapper}>
        <View style={styles.container}>
          {/* Header row */}
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.iconButton} onPress={() => navigation?.goBack?.()} activeOpacity={0.85}>
              <Ionicons name="chevron-back-outline" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Profile</Text>
            <View style={{ width: 32 }} />
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: spacing.xl }}>
            {/* Profile card */}
            <View style={styles.profileCard}>
              <View style={styles.profileTopRow}>
                <TouchableOpacity style={styles.avatarWrap} onPress={openAvatar} activeOpacity={0.85}>
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatarImg} />
                  ) : (
                    <View style={styles.avatarPlaceholder}>
                      <Ionicons name="person-outline" size={22} color={colors.textMuted} />
                    </View>
                  )}
                  {avatarBusy && (
                    <View style={styles.avatarBusy}>
                      <ActivityIndicator size="small" color={colors.brandWhite} />
                    </View>
                  )}
                </TouchableOpacity>

                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={styles.profileName}>{headerName}</Text>
                  <Text style={styles.profileEmail}>{email}</Text>
                  <View style={styles.badgesRow}>
                    {badges.map((b) => (
                      <View key={b} style={styles.badge}>
                        <Text style={styles.badgeText}>{b}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                <TouchableOpacity style={styles.gearButton} onPress={goToSettings} activeOpacity={0.85}>
                  <Ionicons name="settings-outline" size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <Text style={styles.profileHint}>
                Tap your photo to upload. Keep your name and contact info up to date — it helps when you share a story or upgrade your plan.
              </Text>
            </View>

            {/* Personal info (Google-style rows) */}
            <View style={styles.sectionCard}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Personal info</Text>
                <TouchableOpacity onPress={openEditProfile} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={styles.sectionAction}>Edit</Text>
                </TouchableOpacity>
              </View>

              <InfoRow
                icon="camera-outline"
                label="Profile picture"
                value={avatarUrl ? "Tap to view / change" : "Add photo"}
                rightAccessory={
                  avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.avatarThumb} />
                  ) : null
                }
                onPress={openAvatar}
              />

              <InfoRow
                icon="person-outline"
                label={FIELD_LABELS.full_name}
                value={profile?.full_name || ""}
                onPress={openEditProfile}
              />

              <InfoRow
                icon="id-card-outline"
                label={FIELD_LABELS.display_name}
                value={profile?.display_name || ""}
                onPress={openEditProfile}
              />
              <InfoRow
                icon="mail-outline"
                label="Login email"
                value={email}
                onPress={openEmailModal}
              />

              <InfoRow
                icon="call-outline"
                label={FIELD_LABELS.phone}
                value={profile?.phone || ""}
                onPress={openEditProfile}
              />

              <InfoRow
                icon="calendar-outline"
                label={FIELD_LABELS.birthday}
                value={toDisplayDate(profile?.birthday) || ""}
                onPress={openEditProfile}
                hint="YYYY-MM-DD"
              />

              <InfoRow
                icon="globe-outline"
                label={FIELD_LABELS.language}
                value={profile?.language || ""}
                onPress={openEditProfile}
              />

              <InfoRow
                icon="home-outline"
                label={FIELD_LABELS.home_address}
                value={profile?.home_address || ""}
                onPress={openEditProfile}
                multiline
              />

              <InfoRow
                icon="briefcase-outline"
                label={FIELD_LABELS.work_address}
                value={profile?.work_address || ""}
                onPress={openEditProfile}
                multiline
              />
            </View>

            {/* Journey */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Your Keepr Journey</Text>

              {journeyRows.map((row, idx) => (
                <View key={row.id}>
                  <TouchableOpacity
                    style={styles.journeyRow}
                    onPress={row.onPress || undefined}
                    activeOpacity={row.onPress ? 0.85 : 1}
                    disabled={!row.onPress}
                  >
                    <View style={[styles.journeyIcon, row.done ? styles.journeyIconDone : styles.journeyIconTodo]}>
                      {row.done ? (
                        <Ionicons name="checkmark" size={14} color={colors.brandWhite} />
                      ) : (
                        <Ionicons name="ellipse-outline" size={14} color={colors.textMuted} />
                      )}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.journeyLabel}>{row.title}</Text>
                      <Text style={styles.journeyHint}>{row.subtitle}</Text>
                      {idx === journeyRows.length - 1 && row.footer ? (
                        <Text style={styles.journeyFooter}>{row.footer}</Text>
                      ) : null}
                    </View>
                    {row.rightAccessory ? <View style={styles.rightAccessory}>{row.rightAccessory}</View> : null}
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
                  </TouchableOpacity>

                  {idx !== journeyRows.length - 1 ? <View style={styles.divider} /> : null}
                </View>
              ))}

              <TouchableOpacity style={styles.inlineLink} onPress={goToDashboard} activeOpacity={0.85}>
                <Text style={styles.inlineLinkText}>View dashboard</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.brandBlue} />
              </TouchableOpacity>
            </View>

            {/* Keepr Inbox */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Your Keepr Inbox</Text>

              {usernameStatus === "locked" ? (
                <>
                  <Text style={styles.infoValue}>{inboxEmail}</Text>
                  <Text style={styles.infoHint}>Forward receipts and invoices here.</Text>
                  <Text style={styles.infoHint}>Username is locked once claimed.</Text>
                </>
              ) : (
                <>
                  <Text style={styles.infoHint}>Choose a username (letters and numbers only).</Text>

                  <TextInput
                    value={username}
                    onChangeText={(v) => {
                      const clean = String(v || "")
                        .toLowerCase()
                        .replace(/[^a-z0-9]/g, "")
                        .slice(0, 20);
                      setUsername(clean);
                      setUsernameStatus(clean ? "editing" : "idle");
                    }}
                    placeholder="chooseusername"
                    autoCapitalize="none"
                    autoCorrect={false}
                    style={[styles.fieldInput, { marginTop: 10 }]}
                  />

                  {!!username ? (
                    <Text style={styles.infoValue}>{`${username}@${INBOX_DOMAIN}`}</Text>
                  ) : null}

                  {usernameStatus === "checking" ? (
                    <Text style={styles.infoHint}>Checking availability…</Text>
                  ) : null}

                  {usernameStatus === "available" ? (
                    <Text style={[styles.infoHint, { color: "#16A34A" }]}>Available</Text>
                  ) : null}

                  {usernameStatus === "taken" ? (
                    <Text style={[styles.infoHint, { color: "#DC2626" }]}>Already taken</Text>
                  ) : null}

                  {usernameStatus === "invalid" ? (
                    <Text style={[styles.infoHint, { color: "#DC2626" }]}>
                      Use 3–20 letters and numbers only
                    </Text>
                  ) : null}

                  <TouchableOpacity
                    onPress={saveUsername}
                    activeOpacity={0.85}
                    disabled={usernameSaving || usernameStatus === "invalid" || !username}
                    style={[
                      styles.modalButton,
                      styles.modalButtonPrimary,
                      { marginTop: 12, opacity: usernameSaving ? 0.7 : 1 },
                    ]}
                  >
                    {usernameSaving ? (
                      <ActivityIndicator color={colors.brandWhite} />
                    ) : (
                      <Text style={styles.modalButtonPrimaryText}>Claim username</Text>
                    )}
                  </TouchableOpacity>

                  <Text style={styles.infoHint}>We will confirm availability when you claim it.</Text>
                </>
              )}
            </View>

            {/* Trust & privacy */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Trust & privacy</Text>

              <TrustRow
                icon="shield-checkmark-outline"
                title="You own what you put in"
                subtitle="Keepr is owner-controlled infrastructure."
              />
              <View style={styles.divider} />
              <TrustRow icon="lock-closed-outline" title="We do not share your data" subtitle="No selling. No brokers." />
              <View style={styles.divider} />
              <TrustRow icon="sparkles-outline" title="We do not train on your data" subtitle="Your records are not used to train models." />
            </View>

            {/* Account */}
            <View style={styles.sectionCard}>
              <Text style={styles.sectionTitle}>Account</Text>

                            <ActionRow
                icon="mail-outline"
                title="Login email"
                subtitle={email || "—"}
                onPress={openEmailModal}
              />
              <View style={styles.divider} />
<ActionRow icon="home-outline" title="Go to dashboard" subtitle="Pick up where you left off." onPress={goToDashboard} />
              <View style={styles.divider} />
              <ActionRow icon="settings-outline" title="Settings" subtitle="Notifications, privacy, and account controls" onPress={goToSettings} />
              <View style={styles.divider} />
              <ActionRow icon="log-out-outline" title="Sign out" subtitle="Log out of this device" onPress={signOut} danger />
            </View>
          </ScrollView>
        </View>
      </View>

      
      {/* Avatar viewer */}
      <Modal
        visible={avatarViewerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAvatarViewerOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { maxWidth: 520, padding: 18 }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Profile photo</Text>
              <TouchableOpacity onPress={() => setAvatarViewerOpen(false)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={{ alignItems: "center", marginTop: 12 }}>
              {avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={{ width: 320, height: 320, borderRadius: 18 }}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={{
                    width: 320,
                    height: 320,
                    borderRadius: 18,
                    backgroundColor: colors.surfaceSubtle,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: colors.borderSubtle,
                  }}
                >
                  <Ionicons name="person-outline" size={40} color={colors.textMuted} />
                </View>
              )}
            </View>

            <View style={[styles.modalFooter, { paddingHorizontal: 0, paddingBottom: 0, marginTop: 14 }]}>
              <TouchableOpacity
                onPress={() => setAvatarViewerOpen(false)}
                style={[styles.modalButton, styles.modalButtonSecondary]}
              >
                <Text style={styles.modalButtonSecondaryText}>Done</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={changeAvatar}
                disabled={avatarBusy}
                style={[styles.modalButton, styles.modalButtonPrimary, avatarBusy && { opacity: 0.6 }]}
              >
                <Text style={styles.modalButtonPrimaryText}>
                  {avatarBusy ? "Working..." : "Change photo"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>


      {/* Edit modal */}
      
      <Modal visible={editVisible} transparent animationType="fade" onRequestClose={() => setEditVisible(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit profile</Text>
              <TouchableOpacity onPress={() => setEditVisible(false)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
              <View style={styles.modalAvatarRow}>
                <TouchableOpacity onPress={openAvatar} style={styles.modalAvatarButton}>
                  {avatarUrl ? (
                    <Image source={{ uri: avatarUrl }} style={styles.modalAvatarImage} />
                  ) : (
                    <View style={styles.modalAvatarPlaceholder}>
                      <Text style={styles.modalAvatarPlaceholderText}>+</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalAvatarLabel}>Profile photo</Text>
                  <Text style={styles.modalAvatarHint}>Tap to upload or change.</Text>
                </View>
              </View>

              <Text style={styles.fieldLabel}>Name</Text>
              <TextInput
                value={draft.full_name}
                onChangeText={(v) => setDraft((d) => ({ ...d, full_name: v }))}
                placeholder="Your name"
                placeholderTextColor="#9CA3AF"
                style={styles.fieldInput}
              />

              <Text style={styles.fieldLabel}>Display name</Text>
              <TextInput
                value={draft.display_name}
                onChangeText={(v) => setDraft((d) => ({ ...d, display_name: v }))}
                placeholder="How you show up in Keepr"
                placeholderTextColor="#9CA3AF"
                style={styles.fieldInput}
              />

              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput value={email} editable={false} style={[styles.fieldInput, styles.fieldInputDisabled]} />
              <Text style={styles.fieldHint}>Email is managed by your sign-in provider.</Text>

              <Text style={styles.fieldLabel}>Phone</Text>
              <TextInput
                value={draft.phone}
                onChangeText={(v) => setDraft((d) => ({ ...d, phone: v }))}
                placeholder="Phone number"
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
                style={styles.fieldInput}
              />

              <Text style={styles.fieldLabel}>Birthday</Text>
              <TextInput
                value={draft.birthday}
                onChangeText={(v) => setDraft((d) => ({ ...d, birthday: v }))}
                placeholder="YYYY-MM-DD"
                placeholderTextColor="#9CA3AF"
                autoCapitalize="none"
                style={styles.fieldInput}
              />

              <Text style={styles.fieldLabel}>Language</Text>
              <TextInput
                value={draft.language}
                onChangeText={(v) => setDraft((d) => ({ ...d, language: v }))}
                placeholder="English (United States)"
                placeholderTextColor="#9CA3AF"
                style={styles.fieldInput}
              />

              <Text style={styles.fieldLabel}>Home address</Text>
              <TextInput
                value={draft.home_address}
                onChangeText={(v) => setDraft((d) => ({ ...d, home_address: v }))}
                placeholder="Street, city, state"
                placeholderTextColor="#9CA3AF"
                style={[styles.fieldInput, styles.fieldInputMultiline]}
                multiline
              />

              <Text style={styles.fieldLabel}>Work address</Text>
              <TextInput
                value={draft.work_address}
                onChangeText={(v) => setDraft((d) => ({ ...d, work_address: v }))}
                placeholder="Street, city, state"
                placeholderTextColor="#9CA3AF"
                style={[styles.fieldInput, styles.fieldInputMultiline]}
                multiline
              />
            </ScrollView>

            <View style={styles.modalFooter}>
              <TouchableOpacity
                onPress={() => setEditVisible(false)}
                disabled={draftSaving}
                style={[styles.modalButton, styles.modalButtonSecondary, draftSaving && { opacity: 0.6 }]}
              >
                <Text style={styles.modalButtonSecondaryText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={saveProfileEdits}
                disabled={draftSaving}
                style={[styles.modalButton, styles.modalButtonPrimary, draftSaving && { opacity: 0.6 }]}
              >
                <Text style={styles.modalButtonPrimaryText}>{draftSaving ? "Saving..." : "Save"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Change login email modal */}
      <Modal
        visible={emailModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setEmailModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Change login email</Text>
              <TouchableOpacity onPress={() => setEmailModalVisible(false)} style={styles.modalClose}>
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <Text style={styles.infoHint}>
                This changes the email you use to sign in. For security, you’ll confirm via email.
              </Text>

              <View style={{ height: 10 }} />

              <Text style={styles.fieldLabel}>New login email</Text>
              <TextInput
                value={newEmail}
                onChangeText={(v) => setNewEmail(String(v || "").trim())}
                placeholder="you@keeprhome.com"
                autoCapitalize="none"
                keyboardType="email-address"
                autoCorrect={false}
                style={styles.fieldInput}
              />

              {emailNotice ? (
                <Text style={[styles.infoHint, { marginTop: 10 }]}>{emailNotice}</Text>
              ) : null}

              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonSecondary]}
                  onPress={() => setEmailModalVisible(false)}
                  disabled={emailSaving}
                >
                  <Text style={styles.modalButtonSecondaryText}>Close</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButton, styles.modalButtonPrimary]}
                  onPress={submitEmailChange}
                  disabled={emailSaving}
                >
                  <Text style={styles.modalButtonPrimaryText}>
                    {emailSaving ? "Sending…" : "Send confirmation"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>
      </Modal>



      {/* Achievements load spinner (non-blocking) */}
      {achLoading && (
        <View style={styles.floatingLoad}>
          <ActivityIndicator size="small" />
        </View>
      )}
    </SafeAreaView>
  );
}

function InfoRow({ icon, label, value, rightAccessory, onPress, hint, multiline, disabled }) {
  const hasValue = !!(value && String(value).trim().length);
  return (
    <TouchableOpacity
      style={[styles.infoRow, disabled && { opacity: 0.6 }]}
      onPress={onPress || undefined}
      activeOpacity={onPress ? 0.85 : 1}
      disabled={!onPress || disabled}
    >
      <View style={styles.infoIconWrap}>
        <Ionicons name={icon} size={16} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text style={[styles.infoValue, !hasValue && styles.infoValueMuted]} numberOfLines={multiline ? 3 : 1}>
          {hasValue ? value : "Not set"}
        </Text>
        {hint ? <Text style={styles.infoHint}>{hint}</Text> : null}
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

function TrustRow({ icon, title, subtitle }) {
  return (
    <View style={styles.trustRow}>
      <View style={styles.trustIcon}>
        <Ionicons name={icon} size={18} color={colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.trustTitle}>{title}</Text>
        <Text style={styles.trustSubtitle}>{subtitle}</Text>
      </View>
    </View>
  );
}

function ActionRow({ icon, title, subtitle, onPress, danger }) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} activeOpacity={0.85}>
      <View style={[styles.actionIcon, danger ? styles.actionIconDanger : null]}>
        <Ionicons name={icon} size={18} color={danger ? "#B91C1C" : colors.textSecondary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.actionTitle, danger && { color: "#B91C1C" }]}>{title}</Text>
        <Text style={styles.actionSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </TouchableOpacity>
  );
}

/* ======================== STYLES ======================== */

const styles = StyleSheet.create({
  contentWrapper: { flex: 1, alignItems: "center" },
  container: {
    flex: 1,
    width: "100%",
    maxWidth: 980,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },

  headerRow: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surfaceSubtle,
  },
  headerTitle: { flex: 1, textAlign: "center", ...typography.title },

  profileCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
    marginBottom: spacing.md,
  },
  profileTopRow: { flexDirection: "row", alignItems: "center" },
  avatarWrap: { width: 72, height: 72, borderRadius: 36, overflow: "hidden" },
  avatarImg: { width: 72, height: 72, borderRadius: 36 },
  avatarThumb: { width: 28, height: 28, borderRadius: 14 },
  rightAccessory: { marginLeft: 10 },
  avatarPlaceholder: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  avatarBusy: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "rgba(17,24,39,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  profileName: { fontSize: 18, fontWeight: "800", color: colors.textPrimary },
  profileEmail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },

  badgesRow: { flexDirection: "row", flexWrap: "wrap", marginTop: spacing.xs },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    backgroundColor: colors.surfaceSubtle,
    marginRight: spacing.xs,
    marginTop: 6,
  },
  badgeText: { fontSize: 11, fontWeight: "600", color: colors.textPrimary },

  gearButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },

  profileHint: { marginTop: spacing.sm, fontSize: 12, color: colors.textSecondary, lineHeight: 18 },

  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    ...shadows.subtle,
    marginBottom: spacing.md,
  },
  sectionTitle: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, marginBottom: spacing.sm },

  divider: { height: 1, backgroundColor: colors.borderSubtle, marginVertical: spacing.xs },

  infoRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10 },
  infoIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  infoLabel: { fontSize: 12, fontWeight: "700", color: colors.textPrimary },
  infoValue: { fontSize: 12, color: colors.textSecondary, marginTop: 2, lineHeight: 16 },
  infoValueMuted: { color: colors.textMuted },
  infoHint: { marginTop: 4, fontSize: 11, color: colors.textMuted },

  journeyRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 10 },
  journeyIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    marginTop: 2,
  },
  journeyIconDone: { backgroundColor: colors.brandBlue },
  journeyIconTodo: { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.borderSubtle },
  journeyLabel: { fontSize: 14, fontWeight: "800", color: colors.textPrimary },
  journeyHint: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },
  journeyFooter: { fontSize: 12, color: colors.textMuted, marginTop: 8, lineHeight: 16 },

  inlineLink: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  inlineLinkText: { fontSize: 12, fontWeight: "700", color: colors.brandBlue, marginRight: 4 },

  trustRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  trustIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  trustTitle: { fontSize: 13, fontWeight: "800", color: colors.textPrimary },
  trustSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  actionRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  actionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  actionIconDanger: { backgroundColor: "#FEE2E2", borderColor: "#FECACA" },
  actionTitle: { fontSize: 13, fontWeight: "800", color: colors.textPrimary },
  actionSubtitle: { fontSize: 12, color: colors.textSecondary, marginTop: 2 },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },
  modalCard: {
    width: "100%",
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 16, fontWeight: "800", color: colors.textPrimary },
  modalHint: { marginTop: 8, fontSize: 12, color: colors.textMuted },

  input: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceSubtle,
  },
  inputMultiline: { minHeight: 90, textAlignVertical: "top" },

  modalButtonsRow: { flexDirection: "row", justifyContent: "flex-end", marginTop: spacing.lg },
  btn: { borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: 10, marginLeft: spacing.sm },
  btnGhost: { backgroundColor: colors.surfaceSubtle, borderWidth: 1, borderColor: colors.borderSubtle },
  btnGhostText: { fontSize: 13, fontWeight: "700", color: colors.textPrimary },
  btnPrimary: { backgroundColor: colors.brandBlue },
  btnPrimaryText: { fontSize: 13, fontWeight: "800", color: colors.brandWhite },

  floatingLoad: {
    position: "absolute",
    right: spacing.lg,
    bottom: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    ...shadows.subtle,
  },
  // Section header action
  sectionHeaderRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionAction: { color: "#2563EB", fontWeight: "700" },

  // Unified edit modal (aliases / additions)
  modalOverlay: { flex: 1, backgroundColor: "rgba(17, 24, 39, 0.45)", justifyContent: "center", alignItems: "center", padding: 16 },
  modalClose: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, backgroundColor: "#F3F4F6" },
  modalCloseText: { color: "#111827", fontWeight: "800" },
  modalBody: { paddingHorizontal: 16, paddingBottom: 14 },
  modalFooter: { padding: 16, paddingTop: 10, flexDirection: "row", justifyContent: "flex-end", gap: 10 },

  modalAvatarRow: { flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14, marginTop: 4 },
  modalAvatarButton: { width: 56, height: 56, borderRadius: 28, overflow: "hidden", backgroundColor: "#F3F4F6", alignItems: "center", justifyContent: "center" },
  modalAvatarImage: { width: 56, height: 56 },
  modalAvatarPlaceholder: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center" },
  modalAvatarPlaceholderText: { fontSize: 24, fontWeight: "800", color: "#6B7280" },
  modalAvatarLabel: { fontSize: 14, fontWeight: "800", color: "#111827" },
  modalAvatarHint: { fontSize: 12, color: "#6B7280", marginTop: 2 },

  fieldLabel: { fontSize: 12, fontWeight: "800", color: "#374151", marginTop: 10, marginBottom: 6 },
  fieldInput: { borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, color: "#111827", backgroundColor: "#FFFFFF" },
  fieldInputDisabled: { backgroundColor: "#F9FAFB", color: "#6B7280" },
  fieldInputMultiline: { minHeight: 70, textAlignVertical: "top" },
  fieldHint: { fontSize: 12, color: "#6B7280", marginTop: 6 },

  modalButton: { height: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: "center", justifyContent: "center" },
  modalButtonPrimary: { backgroundColor: "#2563EB" },
  modalButtonSecondary: { backgroundColor: "#F3F4F6" },
  modalButtonPrimaryText: { color: "#FFFFFF", fontWeight: "800" },
  modalButtonSecondaryText: { color: "#111827", fontWeight: "800" },

});
