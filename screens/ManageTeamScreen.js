import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabaseClient";

function initials(str) {
  if (!str) return "?";
  const parts = str.trim().split(" ");
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function getMemberLabel(p) {
  if (!p) return "";
  const display = String(p.display_name || "").trim();
  if (display) return display;

  const full = String(p.full_name || "").trim();
  if (full) return full;

  const first = String(p.first_name || "").trim();
  const last = String(p.last_name || "").trim();
  const fl = `${first} ${last}`.trim();
  if (fl) return fl;

  const username = String(p.username || "").trim();
  if (username) return username;

  const email = String(p.email || "").trim();
  if (email) return email;

  return "";
}

function normalizeMembersWithOwner({ org, members, ownerProfile }) {
  if (!org?.owner_user_id) return members || [];

  const list = Array.isArray(members) ? [...members] : [];
  const hasOwner = list.some((m) => m?.user_id === org.owner_user_id);
  if (hasOwner) return list;

  // Inject a virtual owner row so UI is never "0/5"
  return [
    {
      org_id: org.id,
      user_id: org.owner_user_id,
      member_role: "owner",
      profiles: ownerProfile || null,
      __virtual: true,
    },
    ...list,
  ];
}

export default function ManageTeamScreen({ navigation, route }) {
  const [loading, setLoading] = useState(true);
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [profile, setProfile] = useState(null);

  const [assets, setAssets] = useState([]);
  const [sharedAssetIds, setSharedAssetIds] = useState([]);
  const [assetPickerOpen, setAssetPickerOpen] = useState(false);
  const [savingAssets, setSavingAssets] = useState(false);

  const [editingLogo, setEditingLogo] = useState(false);
  const [logoUrl, setLogoUrl] = useState("");

  const orgId = route?.params?.orgId || null;
  const [editingName, setEditingName] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [emailInput, setEmailInput] = useState("");
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);

    const { data: auth } = await supabase.auth.getUser();
    const uid = auth?.user?.id;
    if (!uid) {
      setLoading(false);
      return;
    }

    const { data: prof } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", uid)
      .single();

    setProfile(prof);

    let orgRow = null;

    if (orgId) {
      const { data: orgById, error: orgByIdErr } = await supabase
        .from("orgs")
        .select("*")
        .eq("id", orgId)
        .maybeSingle();

      if (orgByIdErr) throw orgByIdErr;
      orgRow = orgById || null;
    } else {
      const { data: orgOwned, error: orgOwnedErr } = await supabase
        .from("orgs")
        .select("*")
        .eq("owner_user_id", uid)
        .eq("org_type", "family")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (orgOwnedErr) throw orgOwnedErr;
      orgRow = orgOwned || null;
    }

    if (orgRow) {
      setOrg(orgRow);
      setTeamName(orgRow.display_name || orgRow.name || "Our Team");
      setLogoUrl(orgRow.photo_url || "");

      const { data: memberRows, error: memErr } = await supabase
        .from("org_members")
        .select("org_id, user_id, member_role, created_at")
        .eq("org_id", orgRow.id)
        .order("created_at", { ascending: true });

      if (memErr) throw memErr;

      const ids = (memberRows || []).map((r) => r.user_id).filter(Boolean);
      const profilesById = {};

      if (ids.length > 0) {
        const { data: profRows, error: profErr } = await supabase
          .from("profiles")
          .select("id, email, display_name, full_name, first_name, last_name, username")
          .in("id", ids);

        if (profErr) throw profErr;

        (profRows || []).forEach((p) => {
          profilesById[p.id] = p;
        });
      }

      const combined = (memberRows || []).map((m) => ({
        ...m,
        profiles: profilesById[m.user_id] || null,
      }));

      const ownerProfile =
        profilesById[orgRow.owner_user_id] || (uid === orgRow.owner_user_id ? prof : null);

      const normalized = normalizeMembersWithOwner({
        org: orgRow,
        members: combined,
        ownerProfile,
      });

      setMembers(normalized);

      // Assets for sharing
      const { data: aRows, error: aErr } = await supabase
        .from("assets")
        .select("id,name,type,deleted_at")
        .is("deleted_at", null)
        .eq("owner_id", uid)
        .order("created_at", { ascending: false });

      if (aErr) throw aErr;
      setAssets(aRows || []);

      const { data: sRows, error: sErr } = await supabase
        .from("asset_stewardships")
        .select("id,asset_id,active")
        .eq("org_id", orgRow.id);

      if (sErr) throw sErr;

      const activeIds = (sRows || [])
        .filter((r) => r?.active)
        .map((r) => r.asset_id)
        .filter(Boolean);

      setSharedAssetIds(Array.from(new Set(activeIds)));
    }

    setLoading(false);
  }

  async function saveTeamName() {
    if (!teamName.trim()) return;

    if (!org?.id) {
      Alert.alert("Error", "Team not found. Please reload and try again.");
      return;
    }

    const { error } = await supabase
      .from("orgs")
      .update({ display_name: teamName.trim() })
      .eq("id", org.id);

    if (error) {
      Alert.alert("Save failed", error.message);
      return;
    }

    setEditingName(false);
    await load();
  }

  async function saveLogo() {
    if (!org?.id) {
      Alert.alert("Error", "Team not found. Please reload and try again.");
      return;
    }

    const next = String(logoUrl || "").trim();
    const { error } = await supabase
      .from("orgs")
      .update({ photo_url: next || null })
      .eq("id", org.id);

    if (error) {
      Alert.alert("Save failed", error.message);
      return;
    }

    setEditingLogo(false);
    await load();
  }

  const isOwner = profile?.id === org?.owner_user_id;

  async function addMember() {
    const email = String(emailInput || "").trim().toLowerCase();
    if (!email) return;

    if (!org?.id) {
      Alert.alert("Error", "Team not found. Please reload and try again.");
      return;
    }

    if (!isOwner) {
      Alert.alert("Not allowed", "Only the team owner can add members.");
      return;
    }

    if ((members?.length || 0) >= 5) {
      Alert.alert("Team full", "Your Team plan supports up to 5 members.");
      return;
    }

    setAdding(true);
    try {
      const { data: userId, error: lookupErr } = await supabase.rpc(
        "keepr_profile_id_by_email",
        { p_email: email }
      );

      if (lookupErr) {
        console.error("AddMember: email lookup rpc error", lookupErr);
        Alert.alert("Error", lookupErr.message);
        return;
      }

      if (!userId) {
        Alert.alert("User not found", "That email does not have a Keepr account yet.");
        return;
      }

      const already = (members || []).some((m) => m?.user_id === userId);
      if (already) {
        Alert.alert("Already added", "That user is already on your team.");
        return;
      }

      const { error: insErr } = await supabase.from("org_members").insert({
        org_id: org.id,
        user_id: userId,
        member_role: "member",
      });

      if (insErr) {
        console.error("AddMember: insert error", insErr);
        Alert.alert("Error", insErr.message);
        return;
      }

      setEmailInput("");
      await load();
    } catch (e) {
      console.error("AddMember: unexpected", e);
      Alert.alert("Error", String(e?.message || e));
    } finally {
      setAdding(false);
    }
  }

  async function removeMember(member) {
    if (member.member_role === "owner") return;

    Alert.alert(
      "Remove member?",
      "This revokes access to any shared assets. If you add them back later, you may need to re-share assets.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            const { error } = await supabase
              .from("org_members")
              .delete()
              .eq("org_id", org.id)
              .eq("user_id", member.user_id);
            if (error) {
              Alert.alert("Remove failed", error.message);
              return;
            }
            load();
          },
        },
      ]
    );
  }

  const toggleAsset = (assetId) => {
    setSharedAssetIds((prev) => {
      const set = new Set(prev || []);
      if (set.has(assetId)) set.delete(assetId);
      else set.add(assetId);
      return Array.from(set);
    });
  };

  const saveSharedAssets = async () => {
    if (!org?.id) return;
    if (!isOwner) {
      Alert.alert("Not allowed", "Only the team owner can change shared assets.");
      return;
    }

    setSavingAssets(true);
    try {
      const { data: existing, error: exErr } = await supabase
        .from("asset_stewardships")
        .select("id,asset_id,active")
        .eq("org_id", org.id);
      if (exErr) throw exErr;

      const byAsset = new Map();
      (existing || []).forEach((r) => {
        if (r?.asset_id) byAsset.set(r.asset_id, r);
      });

      const toInsert = [];
      const toActivateIds = [];
      (sharedAssetIds || []).forEach((aid) => {
        const row = byAsset.get(aid);
        if (!row) {
          toInsert.push({
            asset_id: aid,
            org_id: org.id,
            user_id: null,
            access_role: "steward",
            active: true,
          });
        } else if (!row.active) {
          toActivateIds.push(row.id);
        }
      });

      if (toActivateIds.length > 0) {
        const { error } = await supabase
          .from("asset_stewardships")
          .update({ active: true })
          .in("id", toActivateIds);
        if (error) throw error;
      }

      if (toInsert.length > 0) {
        const { error } = await supabase.from("asset_stewardships").insert(toInsert);
        if (error) throw error;
      }

      const toDeactivateIds = (existing || [])
        .filter((r) => r?.active && r?.asset_id && !sharedAssetIds.includes(r.asset_id))
        .map((r) => r.id);

      if (toDeactivateIds.length > 0) {
        const { error } = await supabase
          .from("asset_stewardships")
          .update({ active: false })
          .in("id", toDeactivateIds);
        if (error) throw error;
      }

      setAssetPickerOpen(false);
      await load();
    } catch (e) {
      Alert.alert("Save failed", e?.message || "Could not update shared assets.");
    } finally {
      setSavingAssets(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.headerRow}>
          <Pressable
            onPress={() =>
              navigation.canGoBack?.() ? navigation.goBack() : navigation.navigate("Team")
            }
          >
            <Ionicons name="chevron-back-outline" size={22} />
          </Pressable>
          <Text style={styles.headerTitle}>Manage Team</Text>
        </View>

        {/* Team Identity */}
        <View style={styles.identityCard}>
          <Pressable
            style={styles.teamAvatar}
            onPress={() => {
              if (!isOwner) return;
              setEditingLogo((v) => !v);
            }}
          >
            {org?.photo_url ? (
              <Image
                source={{ uri: org.photo_url }}
                style={styles.teamAvatarImg}
                resizeMode="cover"
              />
            ) : (
              <Text style={styles.teamAvatarText}>{initials(teamName)}</Text>
            )}
          </Pressable>

          {editingLogo && isOwner && (
            <View style={{ width: "100%", marginTop: 10 }}>
              <Text style={styles.smallLabel}>Team logo URL (optional)</Text>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
                <TextInput
                  value={logoUrl}
                  onChangeText={setLogoUrl}
                  placeholder="https://..."
                  autoCapitalize="none"
                  style={[styles.input, { marginBottom: 0, flex: 1 }]}
                />
                <Pressable onPress={saveLogo} style={styles.iconBtn}>
                  <Ionicons name="checkmark" size={18} />
                </Pressable>
              </View>
            </View>
          )}

          {editingName ? (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput value={teamName} onChangeText={setTeamName} style={styles.nameInput} />
              <Pressable onPress={saveTeamName}>
                <Ionicons name="checkmark" size={20} />
              </Pressable>
            </View>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={styles.teamName}>{teamName}</Text>
              {isOwner && (
                <Pressable onPress={() => setEditingName(true)}>
                  <Ionicons name="pencil-outline" size={16} />
                </Pressable>
              )}
            </View>
          )}

          <Text style={styles.meta}>Owner: {profile?.full_name || profile?.email}</Text>
          <Text style={styles.meta}>{members.length} / 5 Members · Team Plan</Text>
        </View>

        {/* Members */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Members</Text>
          <Text style={styles.sectionHint}>
            Owner can add/remove members. Asset sharing is controlled below.
          </Text>

          {members.length === 0 ? (
            <View style={styles.whiteCard}>
              <Text style={styles.muted}>
                No org members found for this team.
              </Text>
              <Text style={[styles.muted, { marginTop: 6 }]}>
                org_id: {org?.id || "—"}
              </Text>
            </View>
          ) : (
            members.map((m) => {
              const display = getMemberLabel(m.profiles) || m.user_id;
              const role = String(m.member_role || "member");

              return (
                <View key={m.user_id} style={styles.memberCard}>
                  <View style={styles.memberAvatar}>
                    <Text style={styles.memberAvatarText}>{initials(display)}</Text>
                  </View>

                  <View style={{ flex: 1 }}>
                    <Text style={styles.memberName}>{display}</Text>

                    {/* ✅ FIX: no View inside Text */}
                    <View style={styles.memberMetaRow}>
                      {role === "owner" ? (
                        <View style={styles.ownerBadge}>
                          <Text style={styles.ownerBadgeText}>Owner</Text>
                        </View>
                      ) : (
                        <Text style={styles.memberMetaText}>{role}</Text>
                      )}

                      {!!m.__virtual && (
                        <Text style={styles.virtualHint}>virtual</Text>
                      )}
                    </View>
                  </View>

                  {role !== "owner" && isOwner && (
                    <Pressable onPress={() => removeMember(m)}>
                      <Ionicons name="remove-circle-outline" size={20} color="#DC2626" />
                    </Pressable>
                  )}
                </View>
              );
            })
          )}
        </View>

        {/* Add Member */}
        {isOwner && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Add Member</Text>
            <TextInput
              placeholder="Enter email"
              value={emailInput}
              onChangeText={setEmailInput}
              style={styles.input}
              autoCapitalize="none"
            />
            <Pressable style={styles.addBtn} onPress={addMember} disabled={adding}>
              <Text style={styles.addBtnText}>{adding ? "Adding..." : "Add Member"}</Text>
            </Pressable>
          </View>
        )}

        {/* Shared assets */}
        <View style={styles.section}>
          <View style={styles.rowBetweenTight}>
            <Text style={styles.sectionTitle}>Shared assets</Text>
            {isOwner && (
              <Pressable style={styles.pillBtn} onPress={() => setAssetPickerOpen(true)}>
                <Text style={styles.pillBtnText}>Choose</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.sectionHint}>
            Members see everything attached to shared assets. Deletes are owner-only.
          </Text>

          {sharedAssetIds.length === 0 ? (
            <View style={styles.whiteCard}>
              <Text style={styles.muted}>No shared assets yet.</Text>
            </View>
          ) : (
            <View style={styles.whiteCard}>
              {(assets || [])
                .filter((a) => sharedAssetIds.includes(a.id))
                .slice(0, 8)
                .map((a) => (
                  <View key={a.id} style={styles.assetRowMini}>
                    <Text style={styles.assetNameMini} numberOfLines={1}>
                      {a.name}
                    </Text>
                    <Text style={styles.assetTypeMini}>{a.type}</Text>
                  </View>
                ))}
              {sharedAssetIds.length > 8 && (
                <Text style={styles.muted}>+ {sharedAssetIds.length - 8} more</Text>
              )}
            </View>
          )}
        </View>

        <Text style={styles.footerNote}>
          Tip: if something looks "missing" for a member, confirm the asset is shared here.
        </Text>

        <Modal
          visible={assetPickerOpen}
          animationType="slide"
          onRequestClose={() => setAssetPickerOpen(false)}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: "#F5F6F8" }}>
            <View style={styles.modalHeader}>
              <Pressable onPress={() => setAssetPickerOpen(false)} style={styles.iconBtn}>
                <Ionicons name="close" size={20} />
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Choose shared assets</Text>
                <Text style={styles.modalSub}>
                  Members will see systems, records, and attachments for these assets.
                </Text>
              </View>
            </View>

            <FlatList
              data={assets || []}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 14, paddingBottom: 120 }}
              ListEmptyComponent={
                <View style={styles.whiteCard}>
                  <Text style={styles.muted}>No assets found.</Text>
                </View>
              }
              renderItem={({ item }) => {
                const checked = sharedAssetIds.includes(item.id);
                return (
                  <Pressable
                    onPress={() => toggleAsset(item.id)}
                    style={[styles.assetPickRow, checked && styles.assetPickRowOn]}
                  >
                    <View style={styles.checkWrap}>
                      <Ionicons
                        name={checked ? "checkbox" : "square-outline"}
                        size={20}
                        color={checked ? "#0F172A" : "#6B7280"}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.assetPickName} numberOfLines={1}>
                        {item.name}
                      </Text>
                      <Text style={styles.assetPickMeta}>{item.type}</Text>
                    </View>
                  </Pressable>
                );
              }}
            />

            <View style={styles.modalFooter}>
              <Pressable
                style={[styles.addBtn, savingAssets && { opacity: 0.7 }]}
                onPress={saveSharedAssets}
                disabled={savingAssets}
              >
                <Text style={styles.addBtnText}>
                  {savingAssets ? "Saving..." : "Save shared assets"}
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#F5F6F8" },
  content: { padding: 24 },
  center: { flex: 1, justifyContent: "center", alignItems: "center" },

  identityCard: {
    alignItems: "center",
    padding: 24,
    borderRadius: 20,
    backgroundColor: "#FFF",
    marginBottom: 24,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    marginBottom: 20,
  },
  headerTitle: { fontSize: 18, fontWeight: "800" },

  ownerBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "#E0F2FE",
  },
  ownerBadgeText: {
    fontSize: 10,
    fontWeight: "800",
    color: "#0369A1",
    textTransform: "uppercase",
  },

  teamAvatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  teamAvatarText: { fontSize: 28, fontWeight: "800" },
  teamName: { fontSize: 22, fontWeight: "800" },
  meta: { fontSize: 13, color: "#6B7280", marginTop: 4 },
  nameInput: { borderBottomWidth: 1, borderColor: "#CCC", fontSize: 18 },

  section: { marginBottom: 28 },
  sectionTitle: { fontSize: 14, fontWeight: "800", marginBottom: 12 },

  memberCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#FFF",
    marginBottom: 10,
  },
  memberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
  },
  memberAvatarText: { fontSize: 14, fontWeight: "800" },
  memberName: { fontSize: 14, fontWeight: "800" },

  // ✅ new meta row styles (no View inside Text)
  memberMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 4,
  },
  memberMetaText: { fontSize: 12, color: "#6B7280" },
  virtualHint: { fontSize: 11, color: "#9CA3AF", fontWeight: "700" },

  sectionHint: {
    fontSize: 12,
    color: "#6B7280",
    marginTop: -6,
    marginBottom: 10,
    lineHeight: 16,
  },

  rowBetweenTight: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  pillBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: "#E5E7EB",
  },
  pillBtnText: { fontSize: 12, fontWeight: "800" },

  whiteCard: {
    backgroundColor: "#FFF",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  muted: { fontSize: 13, color: "#6B7280" },

  assetRowMini: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E7EB",
  },
  assetNameMini: { flex: 1, fontSize: 13, fontWeight: "800", marginRight: 10 },
  assetTypeMini: { fontSize: 12, color: "#6B7280" },

  modalHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    backgroundColor: "#FFF",
  },
  modalTitle: { fontSize: 16, fontWeight: "900" },
  modalSub: { fontSize: 12, color: "#6B7280", marginTop: 4, lineHeight: 16 },
  modalFooter: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    backgroundColor: "#FFF",
  },
  assetPickRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 10,
  },
  assetPickRowOn: { borderColor: "#0F172A" },
  checkWrap: { width: 24, alignItems: "center" },
  assetPickName: { fontSize: 14, fontWeight: "900" },
  assetPickMeta: { fontSize: 12, color: "#6B7280", marginTop: 2 },

  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#E5E7EB",
    alignItems: "center",
    justifyContent: "center",
  },
  smallLabel: { fontSize: 12, fontWeight: "800", marginBottom: 6, color: "#334155" },

  input: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    paddingHorizontal: 12,
    marginBottom: 12,
    backgroundColor: "#FFF",
  },
  addBtn: {
    height: 44,
    borderRadius: 999,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { color: "#FFF", fontWeight: "800" },

  footerNote: { fontSize: 12, color: "#6B7280", textAlign: "center" },

  teamAvatarImg: { width: 96, height: 96, borderRadius: 48 },
});