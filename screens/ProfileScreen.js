import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Modal,
  Image,
  Platform,
  InteractionManager,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";

import { supabase } from "../lib/supabaseClient";
import { uploadAttachmentFromUri } from "../lib/attachmentsUploader";
import { colors, radius, spacing } from "../styles/theme";


function firstNonEmpty(...values) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function initialsFromName(name, email) {
  const n = firstNonEmpty(name);
  if (n) {
    const parts = n.split(" ").filter(Boolean);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0] || ""}${parts[1][0] || ""}`.toUpperCase();
  }
  const prefix = firstNonEmpty(email).split("@")[0] || "K";
  return prefix.slice(0, 2).toUpperCase();
}

function sanitizeInboxHandle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^\.+|\.+$/g, "");
}
function formatBirthdayForInput(value) {
  const v = firstNonEmpty(value);
  if (!v) return "";

  const isoMatch = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, yyyy, mm, dd] = isoMatch;
    return `${mm}/${dd}/${yyyy}`;
  }

  return v.replace(/-/g, "/");
}

function normalizeBirthdayForSave(value) {
  const v = firstNonEmpty(value).replace(/-/g, "/");
  if (!v) return null;

  const usMatch = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (usMatch) {
    const [, mm, dd, yyyy] = usMatch;
    return `${yyyy}-${mm}-${dd}`;
  }

  return v;
}

export default function ProfileScreen({ navigation }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [userEmail, setUserEmail] = useState("");
  const [profileId, setProfileId] = useState(null);
  const [profileRow, setProfileRow] = useState(null);
  const [avatarUrl, setAvatarUrl] = useState(null);
  const [avatarViewerOpen, setAvatarViewerOpen] = useState(false);
  const [pendingPhotoPick, setPendingPhotoPick] = useState(false);
const [isPickingPhoto, setIsPickingPhoto] = useState(false);
const [showInboxModal, setShowInboxModal] = useState(false);
const [inboxDraft, setInboxDraft] = useState("");
const [savingInbox, setSavingInbox] = useState(false);
const [intakeToken, setIntakeToken] = useState(null);

  const [contactDraft, setContactDraft] = useState({
  fullName: "",
  displayName: "",
  email: "",
  phone: "",
  birthday: "",
  language: "English",
});

  const [placesDraft, setPlacesDraft] = useState({
    homeAddress: "",
    workAddress: "",
  });

  const [showContactModal, setShowContactModal] = useState(false);
  const [showPlacesModal, setShowPlacesModal] = useState(false);

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);

      const { data: authData, error: authError } = await supabase.auth.getUser();
      if (authError) throw authError;

      const user = authData?.user;
      if (!user?.id) throw new Error("Not signed in.");

      setProfileId(user.id);
      setUserEmail(user.email || "");

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (profileError) {
        throw profileError;
      }

      const { data: intakeRow, error: intakeError } = await supabase
        .from("email_intake_addresses")
        .select("token")
        .eq("owner_id", user.id)
        .maybeSingle();

      if (intakeError) {
        console.log("PROFILE INTAKE LOAD ERROR", intakeError);
      }

      setIntakeToken(intakeRow?.token || null);

const hydrateAvatarFromAttachmentId = async (attachmentId) => {
  try {
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

    const { data: signed, error: sErr } = await supabase.storage
      .from(data.bucket)
      .createSignedUrl(data.storage_path, 60 * 60 * 24 * 7);

    if (sErr) throw sErr;

    setAvatarUrl(signed?.signedUrl || null);
  } catch (e) {
    setAvatarUrl(null);
  }
};
      setProfileRow(profile || {});
      if (profile?.profile_photo_attachment_id) {
  await hydrateAvatarFromAttachmentId(profile.profile_photo_attachment_id);
}

setInboxDraft(
  firstNonEmpty(
    profile?.inbox_name,
    user.email?.split("@")[0]
  )
);

      setContactDraft({
      fullName: firstNonEmpty(profile?.full_name, profile?.name),
      displayName: firstNonEmpty(
        profile?.display_name,
        profile?.full_name,
        profile?.name,
        user.email?.split("@")[0]
      ),
      email: firstNonEmpty(user.email, profile?.email),
      phone: firstNonEmpty(profile?.phone),
      birthday: formatBirthdayForInput(profile?.birthday),
      language: firstNonEmpty(profile?.language, "English"),
    });

      setPlacesDraft({
        homeAddress: firstNonEmpty(
          profile?.home_address,
          profile?.home_address_1,
          profile?.address_home
        ),
        workAddress: firstNonEmpty(
          profile?.work_address,
          profile?.work_address_1,
          profile?.address_work
        ),
      });
    } catch (e) {
      Alert.alert("Profile error", e?.message || "Could not load profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const fullName = firstNonEmpty(contactDraft.fullName, contactDraft.displayName);
  const displayName = firstNonEmpty(contactDraft.displayName, contactDraft.fullName);
  const phone = firstNonEmpty(contactDraft.phone);
  const birthday = firstNonEmpty(contactDraft.birthday);
  const language = firstNonEmpty(contactDraft.language, "English");
  const homeAddress = firstNonEmpty(placesDraft.homeAddress);
  const workAddress = firstNonEmpty(placesDraft.workAddress);

  const suggestedInboxHandle = firstNonEmpty(
    userEmail.split("@")[0]
  );

const lockedInboxHandle = firstNonEmpty(profileRow?.inbox_name);
const inboxHandle = firstNonEmpty(lockedInboxHandle, intakeToken, suggestedInboxHandle);
const inboxClaimed = !!lockedInboxHandle;

  const inboxAddress = useMemo(() => {
    if (!inboxHandle) return "";
    return `${inboxHandle}@inbox.keeprhome.com`;
  }, [inboxHandle]);

  const badgeLabels = useMemo(() => {
    const labels = [];

    if (profileRow?.asset_mode === "commercial") {
      labels.push("Commercial");
    }

    if (profileRow?.role) {
      labels.push(profileRow.role);
    }

    // identity always last
    labels.push("I’m a keepr");

    return labels;
  }, [profileRow]);

  

const handleSaveContact = useCallback(async () => {
  if (!profileId) return;

  try {
    setSaving(true);

    const nextEmail = firstNonEmpty(contactDraft.email).toLowerCase();
    const currentEmail = firstNonEmpty(userEmail).toLowerCase();

    if (contactDraft.email && nextEmail !== currentEmail) {
      const { error: emailError } = await supabase.auth.updateUser({
        email: nextEmail,
      });
      if (emailError) throw emailError;
    }

    const payload = {
      full_name: contactDraft.fullName || null,
      display_name: contactDraft.displayName || null,
      phone: contactDraft.phone || null,
      birthday: normalizeBirthdayForSave(contactDraft.birthday),
      language: contactDraft.language || null,
    };

    const { error } = await supabase
      .from("profiles")
      .update(payload)
      .eq("id", profileId);

    if (error) throw error;

    setProfileRow((prev) => ({ ...(prev || {}), ...payload }));

    // do NOT update UI email until verified

    setShowContactModal(false);

    if (contactDraft.email && nextEmail !== currentEmail) {
      setContactDraft((prev) => ({
        ...prev,
        email: currentEmail,
      }));

      Platform.OS === "web"
        ? window.alert("Email update requested. Please verify the new email address.")
        : Alert.alert(
            "Verify your new email",
            "We sent a confirmation link to your new email address."
          );
    }
  } catch (e) {
    Alert.alert("Save failed", e?.message || "Could not save contact info.");
  } finally {
    setSaving(false);
  }
}, [contactDraft, profileId, userEmail]);

const handleSaveInbox = useCallback(async () => {
  if (!profileId) return;

  try {
    const clean = sanitizeInboxHandle(inboxDraft);

    if (!clean) {
      Platform.OS === "web"
        ? window.alert("Please enter an inbox name.")
        : Alert.alert("Inbox name required", "Please enter an inbox name.");
      return;
    }

    if (clean.length < 3) {
      Platform.OS === "web"
        ? window.alert("Use at least 3 characters.")
        : Alert.alert("Too short", "Use at least 3 characters.");
      return;
    }

    setSavingInbox(true);

    const { data: authCheck, error: authCheckErr } = await supabase.auth.getUser();
    console.log("SAVE INBOX AUTH", authCheck?.user?.id, authCheckErr);

    const { error: intakeError } = await supabase
      .from("email_intake_addresses")
      .upsert(
        {
          owner_id: profileId,
          token: clean,
        },
        { onConflict: "owner_id" }
      );

    if (intakeError) throw intakeError;

        const { error: profileError } = await supabase
      .from("profiles")
      .update({
        inbox_name: clean,
      })
      .eq("id", profileId);

    if (profileError) throw profileError;

    setIntakeToken(clean);
    setProfileRow((prev) => ({
      ...(prev || {}),
      inbox_name: clean,
    }));

    setInboxDraft(clean);
    setShowInboxModal(false);

    Platform.OS === "web"
      ? window.alert(`${clean}@inbox.keeprhome.com is now set.`)
      : Alert.alert("Keepr Inbox saved", `${clean}@inbox.keeprhome.com is now set.`);
  } catch (e) {
    console.log("handleSaveInbox failed:", e);

    Platform.OS === "web"
      ? window.alert(e?.message || "Could not save inbox name.")
      : Alert.alert("Save failed", e?.message || "Could not save inbox name.");
  } finally {
    setSavingInbox(false);
  }
}, [profileId, inboxDraft]);

const handleSelectPhoto = async () => {
  try {
    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr) throw authErr;
    const authUserId = user?.id;

    if (!authUserId) {
      Alert.alert("Not signed in", "Please sign in again.");
      return;
    }

    if (Platform.OS !== "web") {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "We need access to your photos.");
        return;
      }
    }

    const mediaTypes =
      ImagePicker?.MediaType?.Images
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

    // optimistic preview
    setAvatarUrl(asset.uri);

    const fileNameGuess = asset.fileName || `profile_${Date.now()}.jpg`;
    const mimeTypeGuess = asset.mimeType || "image/jpeg";

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
      placements: [],
    });

    const attachmentId = created?.attachment?.id;
    if (!attachmentId) {
      throw new Error("Upload succeeded but no attachment was created.");
    }

    const { error } = await supabase
      .from("profiles")
      .update({ profile_photo_attachment_id: attachmentId })
      .eq("id", authUserId);

    if (error) throw error;

    setProfileId(authUserId);
    setProfileRow((p) => ({
      ...(p || {}),
      profile_photo_attachment_id: attachmentId,
    }));

    const { data, error: attachmentError } = await supabase
      .from("attachments")
      .select("id, bucket, storage_path")
      .eq("id", attachmentId)
      .maybeSingle();

    if (attachmentError) throw attachmentError;
    if (!data?.bucket || !data?.storage_path) {
      throw new Error("Attachment uploaded but storage path is missing.");
    }

    const { data: signed, error: signedError } = await supabase.storage
      .from(data.bucket)
      .createSignedUrl(data.storage_path, 60 * 60 * 24 * 7);

    if (signedError) throw signedError;

    setAvatarUrl(signed?.signedUrl || asset.uri);
  } catch (e) {
    console.log("Profile photo upload failed:", e);
    Alert.alert("Upload failed", e?.message || "Could not update profile photo.");
  }
};

  const handleSavePlaces = useCallback(async () => {
    if (!profileId) return;

    try {
      setSaving(true);

      const payload = {
        home_address: placesDraft.homeAddress || null,
        work_address: placesDraft.workAddress || null,
      };

      const { error } = await supabase
        .from("profiles")
        .update(payload)
        .eq("id", profileId);

      if (error) throw error;

      setProfileRow((prev) => ({ ...(prev || {}), ...payload }));
      setShowPlacesModal(false);
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not save places.");
    } finally {
      setSaving(false);
    }
  }, [placesDraft, profileId]);

  const handleSignOut = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      Alert.alert("Sign out failed", e?.message || "Could not sign out.");
    }
  }, []);

const handleOpenSettings = useCallback(() => {
  navigation.navigate("AdminSettings");
}, [navigation]);

useEffect(() => {
  if (!pendingPhotoPick) return;
  if (avatarViewerOpen) return;
  if (isPickingPhoto) return;

  const t = setTimeout(async () => {
    try {
      setIsPickingPhoto(true);
      await handleSelectPhoto();
    } finally {
      setIsPickingPhoto(false);
      setPendingPhotoPick(false);
    }
  }, Platform.OS === "ios" ? 500 : 0);

  return () => clearTimeout(t);
}, [pendingPhotoPick, avatarViewerOpen, isPickingPhoto, handleSelectPhoto]);

  if (loading) {
    return (
      <SafeAreaView style={styles.screen} edges={["top"]}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator />
          <Text style={styles.loadingText}>Loading profile…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (navigation.canGoBack()) navigation.goBack();
            else navigation.navigate("RootTabs", { screen: "Dashboard" });
          }}
          style={styles.backButton}
        >
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>Profile</Text>

        <TouchableOpacity
          onPress={handleOpenSettings}
          style={styles.headerRight}
        >
          <Ionicons name="settings-outline" size={20} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
          <View style={styles.heroCard}>
          <View style={styles.heroTop}>
            <TouchableOpacity
              style={styles.avatar}
              onPress={() => {
                if (avatarUrl) setAvatarViewerOpen(true);
                else handleSelectPhoto();
              }}
            >
              {avatarUrl ? (
                <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>
                  {initialsFromName(fullName, userEmail)}
                </Text>
              )}

              <View style={styles.avatarEditBadge}>
                <Ionicons name="camera" size={12} color="#fff" />
              </View>
            </TouchableOpacity>

            <View style={styles.heroMeta}>
              <Text style={styles.nameText}>{fullName || "Your Name"}</Text>
              <Text style={styles.emailText}>{userEmail}</Text>

              <View style={styles.badgeRow}>
                {badgeLabels.map((label) => (
                  <View key={label} style={styles.badge}>
                    <Text style={styles.badgeText}>{label}</Text>
                  </View>
                ))}
              </View>
            </View>

            <TouchableOpacity
              onPress={() => setShowContactModal(true)}
              style={styles.editPill}
            >
              <Text style={styles.editPillText}>Edit</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.heroDetails}>
            <InfoLine icon="person-outline" text={displayName || "No display name"} />
            <InfoLine icon="call-outline" text={phone || "No phone added"} />
            <InfoLine
              icon="home-outline"
              text={homeAddress || "No home address added"}
            />
          </View>
        </View>

        <SectionCard
          title="Places"
          actionLabel="Edit"
          onAction={() => setShowPlacesModal(true)}
        >
          <InfoRow
            icon="home-outline"
            title="Home"
            value={homeAddress || "No home address added"}
          />
          <InfoRow
            icon="briefcase-outline"
            title="Work"
            value={workAddress || "No work address added"}
            hideBorder
          />
        </SectionCard>

        <SectionCard
            title="Your Keepr Inbox"
            actionLabel="Manage"
            onAction={() => {
              setInboxDraft(inboxHandle || "");
              setShowInboxModal(true);
            }}
          >
          <InfoRow
            icon="mail-outline"
            title={inboxAddress || "No inbox address"}
            value={
            inboxClaimed
              ? "This inbox is active. Forward records here."
              : "This inbox works now. You can change it once before locking it."
          }
          />
          <Text style={styles.helperNote}>
            {inboxClaimed
              ? "This inbox name is locked."
              : "Saving a new inbox name will lock it and your previous inbox will stop working."}
          </Text>
        </SectionCard>

        <SectionCard title="Trust & Privacy">
          <InfoRow
            icon="shield-checkmark-outline"
            title="You own what you put in"
            value="Keepr is owner-controlled infrastructure."
          />
          <InfoRow
            icon="lock-closed-outline"
            title="We do not share your data"
            value="No selling. No brokers."
          />
          <InfoRow
            icon="sparkles-outline"
            title="We do not train on your data"
            value="Your records are not used to train models."
            hideBorder
          />
        </SectionCard>

        <SectionCard title="Account">
          <NavRow
            icon="key-outline"
            title="Change password"
            subtitle="Update your login password"
            onPress={() => navigation.navigate("ChangePassword")}
          />
          <NavRow
            icon="globe-outline"
            title="Language"
            subtitle={language}
            onPress={() => setShowContactModal(true)}
          />
          <NavRow
            icon="calendar-outline"
            title="Birthday"
            subtitle={formatBirthdayForInput(birthday) || "Not set"}
            onPress={() => setShowContactModal(true)}
          />
          <NavRow
            icon="settings-outline"
            title="Settings"
            subtitle="App settings and account controls"
            onPress={handleOpenSettings}
          />
          <NavRow
            icon="log-out-outline"
            title="Sign out"
            subtitle="Log out of this device"
            onPress={handleSignOut}
            danger
            hideBorder
          />
        </SectionCard>
      </ScrollView>

      <EditCardModal
        visible={showContactModal}
        title="Edit Contact Card"
        saving={saving}
        onClose={() => setShowContactModal(false)}
        onSave={handleSaveContact}
      >
        <Field
          label="Name"
          value={contactDraft.fullName}
          onChangeText={(v) => setContactDraft((p) => ({ ...p, fullName: v }))}
          placeholder="Full name"
        />
        <Field
          label="Display name"
          value={contactDraft.displayName}
          onChangeText={(v) => setContactDraft((p) => ({ ...p, displayName: v }))}
          placeholder="Display name"
        />

        <Field
          label="Email"
          value={contactDraft.email}
          onChangeText={(v) => setContactDraft((p) => ({ ...p, email: v }))}
          placeholder="Email"
          keyboardType="email-address"
        />
        <Field
          label="Phone"
          value={contactDraft.phone}
          onChangeText={(v) => setContactDraft((p) => ({ ...p, phone: v }))}
          placeholder="Phone"
          keyboardType="phone-pad"
        />
        <Field
          label="Birthday"
          value={contactDraft.birthday}
          onChangeText={(v) => setContactDraft((p) => ({ ...p, birthday: v }))}
         placeholder="MM/DD/YYYY"
        />
        <Field
          label="Language"
          value={contactDraft.language}
          onChangeText={(v) => setContactDraft((p) => ({ ...p, language: v }))}
          placeholder="Language"
        />
      </EditCardModal>

      <EditCardModal
        visible={showPlacesModal}
        title="Edit Places"
        saving={saving}
        onClose={() => setShowPlacesModal(false)}
        onSave={handleSavePlaces}
      >
        <Field
          label="Home address"
          value={placesDraft.homeAddress}
          onChangeText={(v) => setPlacesDraft((p) => ({ ...p, homeAddress: v }))}
          placeholder="Home address"
          multiline
        />
        <Field
          label="Work address"
          value={placesDraft.workAddress}
          onChangeText={(v) => setPlacesDraft((p) => ({ ...p, workAddress: v }))}
          placeholder="Work address"
          multiline
        />
      </EditCardModal>

      <Modal
  visible={showInboxModal}
  transparent
  animationType="fade"
  onRequestClose={() => setShowInboxModal(false)}
>
  <View style={styles.avatarModalOverlay}>
    <TouchableOpacity
      style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      onPress={() => setShowInboxModal(false)}
    />
    <View style={styles.inboxModalCard}>
      <View style={styles.avatarModalHeader}>
        <Text style={styles.avatarModalTitle}>Manage Keepr Inbox</Text>
        <TouchableOpacity
          onPress={() => setShowInboxModal(false)}
          style={styles.avatarModalClose}
        >
          <Ionicons name="close" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <Text style={styles.helperNoteInline}>
      This is your Keepr Inbox address for forwarding receipts, invoices, and service emails.
      </Text>
      <Text style={[styles.helperNoteInline, { marginTop: 8 }]}>
         Your current inbox works now. You can change it one time before locking a new name.
      </Text>

      <View style={{ marginTop: 14 }}>
        <Field
          label="Inbox name"
          value={inboxDraft}
          onChangeText={(v) => setInboxDraft(sanitizeInboxHandle(v))}
          placeholder="yourname"
          editable={!inboxClaimed}
        />
      </View>

      <Text style={styles.inboxPreviewText}>
        {(sanitizeInboxHandle(inboxDraft || inboxHandle || "") || "yourname")}@inbox.keeprhome.com
      </Text>

      <Text style={styles.helperNote}>
  {inboxClaimed
    ? "This inbox name is locked."
    : "Save a new inbox name to lock it and retire the current one."}
      </Text>

      <View style={styles.avatarModalActions}>
        <TouchableOpacity
          onPress={() => setShowInboxModal(false)}
          style={[styles.avatarModalBtn, styles.avatarModalBtnSecondary]}
        >
          <Text style={styles.avatarModalBtnSecondaryText}>Close</Text>
        </TouchableOpacity>

        {!inboxClaimed ? (
          <TouchableOpacity
              onPress={handleSaveInbox}
              style={[
                styles.avatarModalBtn,
                styles.avatarModalBtnPrimary,
                savingInbox && { opacity: 0.6 },
              ]}
              disabled={savingInbox}
            >
            <Text style={styles.avatarModalBtnPrimaryText}>
              {savingInbox ? "Saving..." : "Save"}
            </Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  </View>
</Modal>

      <Modal
  visible={avatarViewerOpen}
  transparent
  animationType="fade"
  onRequestClose={() => setAvatarViewerOpen(false)}
>
    <View style={styles.avatarModalOverlay}>
      <TouchableOpacity
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        onPress={() => setAvatarViewerOpen(false)}
      />
      <View style={styles.avatarModalCard}>
      <View style={styles.avatarModalHeader}>
        <Text style={styles.avatarModalTitle}>Profile photo</Text>
        <TouchableOpacity
          onPress={() => setAvatarViewerOpen(false)}
          style={styles.avatarModalClose}
        >
          <Ionicons name="close" size={18} color={colors.textPrimary} />
        </TouchableOpacity>
      </View>

      <View style={styles.avatarModalImageWrap}>
        {avatarUrl ? (
          <Image
            source={{ uri: avatarUrl }}
            style={styles.avatarModalImage}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.avatarModalEmpty}>
            <Ionicons name="person-outline" size={40} color={colors.textSecondary} />
          </View>
        )}
      </View>

      <View style={styles.avatarModalActions}>
      <TouchableOpacity
        onPress={() => {
          if (Platform.OS === "web") {
            setAvatarViewerOpen(false);
            handleSelectPhoto();
            return;
          }

          if (isPickingPhoto) return;

          setPendingPhotoPick(true);
          setAvatarViewerOpen(false);
        }}
        style={[styles.avatarModalBtn, styles.avatarModalBtnPrimary]}
      >
        <Text style={styles.avatarModalBtnPrimaryText}>Change photo</Text>
      </TouchableOpacity>
      </View>
    </View>
  </View>
</Modal>
    </SafeAreaView>
  );
}

function SectionCard({ title, actionLabel, onAction, children }) {
  return (
    <View style={styles.sectionWrap}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {actionLabel ? (
          <TouchableOpacity onPress={onAction}>
            <Text style={styles.sectionAction}>{actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function InfoLine({ icon, text }) {
  return (
    <View style={styles.infoLine}>
      <Ionicons name={icon} size={14} color={colors.textSecondary} />
      <Text style={styles.infoLineText} numberOfLines={1}>
        {text}
      </Text>
    </View>
  );
}

function InfoRow({ icon, title, value, hideBorder = false }) {
  return (
    <View style={[styles.row, hideBorder && styles.rowNoBorder]}>
      <View style={styles.rowIcon}>
        <Ionicons name={icon} size={18} color={colors.textPrimary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{value}</Text>
      </View>
    </View>
  );
}

function NavRow({ icon, title, subtitle, onPress, danger = false, hideBorder = false }) {
  return (
    <TouchableOpacity
      style={[styles.row, hideBorder && styles.rowNoBorder]}
      onPress={onPress}
      activeOpacity={0.75}
    >
      <View style={[styles.rowIcon, danger && styles.rowIconDanger]}>
        <Ionicons
          name={icon}
          size={18}
          color={danger ? "#B42318" : colors.textPrimary}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={[styles.rowTitle, danger && styles.rowTitleDanger]}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

function EditCardModal({ visible, title, children, onClose, onSave, saving }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.modalBackdrop}>
        <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={onClose} />
        <View style={styles.modalCard}>
          <View style={styles.modalGrabber} />
          <View style={styles.modalHeader}>
            <TouchableOpacity onPress={onClose} style={styles.modalIconBtn}>
              <Ionicons name="close" size={20} color={colors.textPrimary} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>{title}</Text>
            <TouchableOpacity onPress={onSave} style={styles.modalSaveBtn} disabled={saving}>
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.modalSaveText}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
          <ScrollView
            contentContainerStyle={styles.modalContent}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType,
  multiline = false,
  editable = true,
}) {
  return (
    <View style={styles.fieldWrap}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textSecondary}
        keyboardType={keyboardType}
        multiline={multiline}
        editable={editable}
        style={[
          styles.fieldInput,
          multiline && styles.fieldInputMultiline,
          !editable && { opacity: 0.6 },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    marginTop: 10,
    color: colors.textSecondary,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  avatarImage: {
  width: "100%",
  height: "100%",
  borderRadius: 32,
},
avatarEditBadge: {
  position: "absolute",
  bottom: 0,
  right: 0,
  backgroundColor: colors.primary,
  width: 20,
  height: 20,
  borderRadius: 10,
  alignItems: "center",
  justifyContent: "center",
},
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  headerRight: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 130,
  },
  inboxModalCard: {
  width: "100%",
  maxWidth: 520,
  backgroundColor: colors.surface,
  borderRadius: 24,
  padding: 18,
},
  heroCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heroTop: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "800",
  },
  avatarModalOverlay: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.45)",
  justifyContent: "center",
  alignItems: "center",
  padding: 20,
},
avatarModalCard: {
  width: "100%",
  maxWidth: 520,
  backgroundColor: colors.surface,
  borderRadius: 24,
  padding: 18,
},
avatarModalHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 14,
},
avatarModalTitle: {
  fontSize: 18,
  fontWeight: "800",
  color: colors.textPrimary,
},
avatarModalClose: {
  width: 34,
  height: 34,
  borderRadius: 17,
  backgroundColor: colors.surfaceSubtle,
  alignItems: "center",
  justifyContent: "center",
},
avatarModalImageWrap: {
  alignItems: "center",
  justifyContent: "center",
},
avatarModalImage: {
  width: 320,
  height: 320,
  borderRadius: 20,
},
avatarModalEmpty: {
  width: 320,
  height: 320,
  borderRadius: 20,
  backgroundColor: colors.surfaceSubtle,
  alignItems: "center",
  justifyContent: "center",
},
avatarModalActions: {
  flexDirection: "row",
  justifyContent: "flex-end",
  marginTop: 16,
  gap: 10,
},
avatarModalBtn: {
  height: 42,
  borderRadius: 14,
  paddingHorizontal: 16,
  alignItems: "center",
  justifyContent: "center",
},
avatarModalBtnPrimary: {
  backgroundColor: colors.primary,
},
avatarModalBtnSecondary: {
  backgroundColor: colors.surfaceSubtle,
},
avatarModalBtnPrimaryText: {
  color: "#fff",
  fontWeight: "700",
},
avatarModalBtnSecondaryText: {
  color: colors.textPrimary,
  fontWeight: "700",
},
helperNoteInline: {
  fontSize: 12,
  color: colors.textSecondary,
  lineHeight: 18,
},

inboxPreviewText: {
  marginTop: 6,
  marginBottom: 6,
  fontSize: 15,
  fontWeight: "700",
  color: colors.textPrimary,
},
  heroMeta: {
    flex: 1,
    marginLeft: 14,
  },
  nameText: {
    fontSize: 24,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  emailText: {
    marginTop: 2,
    fontSize: 14,
    color: colors.textSecondary,
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 10,
  },
  badge: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginRight: 8,
    marginBottom: 8,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  editPill: {
    backgroundColor: colors.surfaceSubtle,
    borderRadius: radius.pill,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  editPillText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  heroDetails: {
    marginTop: 14,
  },
  infoLine: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
  },
  infoLineText: {
    marginLeft: 8,
    color: colors.textSecondary,
    fontSize: 13,
    flex: 1,
  },
  sectionWrap: {
    marginBottom: spacing.lg,
  },
  sectionHeader: {
    marginBottom: 8,
    paddingHorizontal: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  sectionAction: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.primary,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    overflow: "hidden",
  },
  row: {
    minHeight: 68,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
  },
  rowNoBorder: {
    borderBottomWidth: 0,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  rowIconDanger: {
    backgroundColor: "#FEE4E2",
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: colors.textPrimary,
  },
  rowTitleDanger: {
    color: "#B42318",
  },
  rowSub: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  helperNote: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    fontSize: 12,
    color: colors.textSecondary,
  },
modalBackdrop: {
  flex: 1,
  backgroundColor: "rgba(0,0,0,0.22)",
  justifyContent: Platform.OS === "web" ? "center" : "flex-end",
  alignItems: Platform.OS === "web" ? "center" : "stretch",
},

modalCard: {
  backgroundColor: colors.surface,
  borderRadius: Platform.OS === "web" ? 24 : 0,
  width: Platform.OS === "web" ? 520 : "100%",
  maxHeight: "86%",
  paddingTop: 12,
},
  modalGrabber: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: 12,
  },
  modalHeader: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modalIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: colors.textPrimary,
  },
  modalSaveBtn: {
    minWidth: 68,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  modalSaveText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
  },
  modalContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: 40,
  },
  fieldWrap: {
    marginBottom: 14,
  },
  fieldLabel: {
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "700",
    color: colors.textSecondary,
  },
  fieldInput: {
    minHeight: 48,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    paddingHorizontal: 14,
    color: colors.textPrimary,
    fontSize: 16,
  },
  fieldInputMultiline: {
    minHeight: 86,
    paddingTop: 12,
    textAlignVertical: "top",
  },
});