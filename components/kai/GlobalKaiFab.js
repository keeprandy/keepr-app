import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../styles/theme";
import KaiOrb from "../../components/KaiOrb";
import { navigationRef } from "../../navigationRoot";
import { supabase } from "../../lib/supabaseClient";

function getKaiContext(currentRouteName) {
  const route = String(currentRouteName || "").toLowerCase();

  if (!route) {
    return {
      label: "Keepr",
      subtitle: "Ownership Assistant",
      suggestions: [
        "Add another asset",
        "Record your last service",
        "Upload proof for something recent",
      ],
    };
  }

  if (route.includes("dashboard")) {
    return {
      label: "Dashboard",
      subtitle: "Kai is here to help you know what to do next.",
      suggestions: [
        "Add another Asset",
        "Add Systems to your Assets",
        "Review the one system needing attention",
      ],
    };
  }

  if (route.includes("systemstory") || route.includes("system")) {
    return {
      label: "System",
      subtitle: "You’re looking at a system. Kai can help move it forward.",
      suggestions: [
        "Add a service record",
        "Create a reminder",
        "Upload proof or a receipt.",
      ],
    };
  }

  if (
    route.includes("home") ||
    route.includes("asset") ||
    route.includes("vehicle") ||
    route.includes("boat")
  ) {
    return {
      label: "Asset",
      subtitle: "Kai can help organize this asset a little at a time.",
      suggestions: [
        "Add a system - Look for Starter Pack",
        "Add a Quick Note",
        "Upload proof for something you already did",
      ],
    };
  }

  if (
    route.includes("notification") ||
    route.includes("inbox") ||
    route.includes("event")
  ) {
    return {
      label: "Inbox",
      subtitle: "Kai can help you decide what to do next.",
      suggestions: [
        "Convert an item into a record",
        "Add a quick event",
        "Set a follow-up reminder",
      ],
    };
  }

  return {
    label: "Keepr",
    subtitle: "What would you like to capture or work on?",
    suggestions: [
      "Add a reminder",
      "Add a quick event",
      "Capture a loose note",
    ],
  };
}

export default function GlobalKaiFab({ currentRouteName, role, kaiContext }) {
  const [open, setOpen] = useState(false);
  const [askKai, setAskKai] = useState("");
  const [notes, setNotes] = useState([]);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [editingNoteId, setEditingNoteId] = useState(null);
  const [loadingNotes, setLoadingNotes] = useState(false);

  const context = useMemo(
    () => getKaiContext(currentRouteName),
    [currentRouteName]
  );

  const scaleAnim = useRef(new Animated.Value(0.86)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const translateAnim = useRef(new Animated.Value(-18)).current;
  const orbPulse = useRef(new Animated.Value(1)).current;
  const idlePulse = useRef(new Animated.Value(1)).current;

// idle breathing pulse (Kai closed)
useEffect(() => {
  if (open) {
    idlePulse.setValue(1);
    return;
  }

  const loop = Animated.loop(
    Animated.sequence([
      Animated.timing(idlePulse, {
        toValue: 1.035,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
      Animated.timing(idlePulse, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ])
  );

  loop.start();
  return () => loop.stop();
}, [open]);


// active orb pulse (Kai open)
useEffect(() => {
  if (!open) {
    orbPulse.setValue(1);
    return;
  }

  const loop = Animated.loop(
    Animated.sequence([
      Animated.timing(orbPulse, {
        toValue: 1.06,
        duration: 700,
        useNativeDriver: true,
      }),
      Animated.timing(orbPulse, {
        toValue: 1,
        duration: 700,
        useNativeDriver: true,
      }),
    ])
  );
  
  loop.start();
  return () => loop.stop();
}, [open]);

useEffect(() => {
  if (!open) return;

  let active = true;

const loadNotes = async () => {
  setLoadingNotes(true);

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.id) {
    setNotes([]);
    setLoadingNotes(false);
    return;
  }

  const { data, error } = await supabase
    .from("loose_notes")
    .select(
      "id, note, created_at, updated_at, route_context, created_from_route, asset_id, asset_name, system_id, system_name"
    )
    .eq("user_id", user.id)
    .eq("route_context", "kai_global")
    .order("updated_at", { ascending: false });

  if (error) {
    console.log("Kai notes load error:", error.message);
    setNotes([]);
  } else {
    setNotes(data || []);
  }

  setLoadingNotes(false);
};

  loadNotes();

  return () => {
    active = false;
  };
}, [open, currentRouteName]);
const saveNote = async () => {
  const trimmed = noteText.trim();
  if (!trimmed) return;

  setSavingNote(true);

  if (editingNoteId) {
    const { data, error } = await supabase
      .from("loose_notes")
      .update({
        note: trimmed,
        updated_at: new Date().toISOString(),
      })
      .eq("id", editingNoteId)
      .select()
      .single();

    if (error) {
      console.log("Kai note update error:", error.message);
    } else if (data) {
      setNotes((prev) =>
        prev.map((n) => (n.id === data.id ? data : n))
      );
    }
  } else {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("loose_notes")
    .insert([
    {
      user_id: user?.id,
      note: trimmed,
      route_context: "kai_global",
      created_from_route: currentRouteName || "unknown",
      asset_id: kaiContext?.assetId || null,
      asset_name: kaiContext?.assetName || null,
      system_id: kaiContext?.systemId || null,
      system_name: kaiContext?.systemName || null,
    },
    ])
      .select()
      .single();

    if (error) {
      console.log("Kai note insert error:", error.message);
    } else if (data) {
      setNotes((prev) => [data, ...prev]);
    }
  }

  setNoteText("");
  setEditingNoteId(null);
  setSavingNote(false);
};
const convertNoteToReminder = (note) => {
  closeKai();

  setTimeout(() => {
    navigationRef?.navigate?.("CreateReminder", {
      prefillTitle: note.note,
      prefillNotes: note.note,
      source: "kai_note",
      routeContext: currentRouteName || "global",
      looseNoteId: note.id,
    });
  }, 180);
};

const editNote = (note) => {
  setEditingNoteId(note.id);
  setNoteText(note.note || "");
};

const deleteNote = async (id) => {
  const { error } = await supabase
    .from("loose_notes")
    .delete()
    .eq("id", id);

  if (error) {
    console.log("Kai note delete error:", error.message);
    return;
  }

  setNotes((prev) => prev.filter((n) => n.id !== id));

  if (editingNoteId === id) {
    setEditingNoteId(null);
    setNoteText("");
  }
};

  const openKai = () => {
    setOpen(true);
    scaleAnim.setValue(0.86);
    opacityAnim.setValue(0);
    translateAnim.setValue(-18);

    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 230,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateAnim, {
        toValue: 0,
        duration: 230,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  };

  const closeKai = () => {
    Animated.parallel([
      Animated.timing(scaleAnim, {
        toValue: 0.92,
        duration: 150,
        useNativeDriver: true,
      }),
      Animated.timing(opacityAnim, {
        toValue: 0,
        duration: 130,
        useNativeDriver: true,
      }),
      Animated.timing(translateAnim, {
        toValue: -12,
        duration: 150,
        useNativeDriver: true,
      }),
    ]).start(() => setOpen(false));
  };

    const onReminder = () => {
    closeKai();

    setTimeout(() => {
        navigationRef?.navigate?.("CreateReminder");
    }, 180);
    };

    const onQuickEvent = () => {
    closeKai();

    setTimeout(() => {
        navigationRef?.navigate?.("CreateEvent");
    }, 180);
    };

  const onLooseNote = () => {
    console.log("Kai → Add Loose Note");
    closeKai();
  };

  const onAskKai = () => {
    console.log("Kai question:", askKai);
    setAskKai("");
  };

  const orbSize = 60;
  const isWeb = Platform.OS === "web";

  return (
    <>
     {!open ? (
  <View style={styles.fabWrap} pointerEvents="box-none">
    <Animated.View
      style={[
        styles.orbAnimatedWrap,
        { transform: [{ scale: idlePulse }] },
      ]}
    >
      <TouchableOpacity
        onPress={openKai}
        activeOpacity={0.9}
        style={styles.orbTouch}
      >
        <KaiOrb size={52} />
      </TouchableOpacity>
    </Animated.View>
  </View>
) : null}   

      <Modal
        visible={open}
        transparent
        animationType="none"
        onRequestClose={closeKai}
      >
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeKai} />

          <View style={styles.modalOrbWrap} pointerEvents="box-none">
            <Animated.View
              style={[
                styles.orbAnimatedWrap,
                {
                  transform: [{ scale: orbPulse }],
                },
              ]}
            >
              <KaiOrb size={orbSize} />
            </Animated.View>
          </View>

          <Animated.View
            style={[
              styles.panel,
              {
                opacity: opacityAnim,
                transform: [
                  { translateX: translateAnim },
                  { scale: scaleAnim },
                ],
              },
            ]}
          >
            <View style={styles.headerRow}>
              <View style={styles.headerTextWrap}>
                <Text style={styles.kaiEyebrow}>What can we do next?</Text>
                <Text style={styles.kaiTitle}>Hi I'm Kai!</Text>
                <Text style={styles.kaiSubtitle}>{context.subtitle}</Text>
              </View>

              <TouchableOpacity onPress={closeKai} style={styles.closeBtn}>
                <Ionicons
                  name="close"
                  size={20}
                  color={colors.textPrimary}
                />
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.content}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.noticeCard}>
                <Text style={styles.noticeLabel}>Kai is active</Text>
                <Text style={styles.noticeText}>
                  Start small. You do not need to update Keepr every day.
                </Text>
              </View>

              <Text style={styles.sectionLabel}>QUICK CAPTURE</Text>
              <View style={styles.actionGrid}>
                <TouchableOpacity
                  style={styles.primaryAction}
                  onPress={onReminder}
                >
                  <Ionicons
                    name="alarm-outline"
                    size={18}
                    color={colors.textPrimary}
                  />
                  <Text style={styles.actionTitle}>Add an Inbox Reminder</Text>
                  <Text style={styles.actionHint}>
                    Keep track of something for later
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.primaryAction}
                  onPress={onQuickEvent}
                >
                  <Ionicons
                    name="flash-outline"
                    size={18}
                    color={colors.textPrimary}
                  />
                  <Text style={styles.actionTitle}>Add an Inbox Quick Event</Text>
                  <Text style={styles.actionHint}>
                    Capture something that happened
                  </Text>
                </TouchableOpacity>
              </View>

            <Text style={styles.sectionLabel}>NOTE PAD</Text>
                <Ionicons
                    name="create-outline"
                    size={18}
                    color={colors.textPrimary}
                  />
                  <Text style={styles.actionTitle}>Add Quick Note to Yourself</Text>
                  <Text style={styles.actionHint}>
                    Jot down a thought without formality
                  </Text>
                  <Text style={styles.actionTitle}></Text>
            
              <View style={styles.notesCard}>
              <TextInput
                value={noteText}
                onChangeText={setNoteText}
                placeholder="Capture a quick thought, idea, or follow-up..."
                placeholderTextColor={colors.textMuted}
                style={styles.noteInput}
                multiline
              />

              <View style={styles.noteActionsRow}>
                {editingNoteId ? (
                  <TouchableOpacity
                    style={styles.noteSecondaryButton}
                    onPress={() => {
                      setEditingNoteId(null);
                      setNoteText("");
                    }}
                  >
                    <Text style={styles.noteSecondaryButtonText}>Cancel</Text>
                  </TouchableOpacity>
                ) : null}

                <TouchableOpacity
                  style={styles.noteSaveButton}
                  onPress={saveNote}
                  disabled={savingNote}
                >
                  <Text style={styles.noteSaveButtonText}>
                    {editingNoteId ? "Update Note" : "Save Note"}
                  </Text>
                </TouchableOpacity>
              </View>
            <ScrollView
              style={styles.notesList}
              contentContainerStyle={styles.notesListContent}
              nestedScrollEnabled
              showsVerticalScrollIndicator={true}
              keyboardShouldPersistTaps="handled"
            >
              {loadingNotes ? (
                <Text style={styles.notesEmpty}>Loading notes…</Text>
              ) : notes.length === 0 ? (
                <Text style={styles.notesEmpty}>
                  No notes yet. Start a running playbook here.
                </Text>
              ) : (
                <>
                  {notes.map((item) => {
                    return (
                <View key={item.id} style={styles.noteItem}>
                        <Text style={styles.noteItemText}>{item.note}</Text>
                {item.asset_name || item.system_name ? (
                  <View style={styles.noteContextRow}>
                    {item.asset_name ? (
                      <TouchableOpacity
                        onPress={() => {
                          closeKai();
                          setTimeout(() => {
                            if (item.asset_id) {
                              navigationRef?.navigate?.("AssetGroupDashboard", {
                                assetId: item.asset_id,
                              });
                            }
                          }, 180);
                        }}
                      >
                        <Text style={styles.noteContextLink}>{item.asset_name}</Text>
                      </TouchableOpacity>
                    ) : null}

                    {item.system_name ? (
                      <>
                        <Text style={styles.noteContextSeparator}> • </Text>
                        <TouchableOpacity
                          onPress={() => {
                            closeKai();
                            setTimeout(() => {
                              if (item.system_id) {
                                navigationRef?.navigate?.("HomeSystemStory", {
                                  systemId: item.system_id,
                                });
                              }
                            }, 180);
                          }}
                        >
                          <Text style={styles.noteContextLink}>{item.system_name}</Text>
                        </TouchableOpacity>
                      </>
                    ) : null}
                  </View>
                ) : item.created_from_route ? (
                  <Text style={styles.noteContext}>
                    From: {item.created_from_route}
                  </Text>
                ) : null}
                      <View style={styles.noteItemActions}>
                        <TouchableOpacity onPress={() => editNote(item)}>
                          <Text style={styles.noteActionLink}>Edit</Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => convertNoteToReminder(item)}>
                          <Text style={styles.noteActionLink}>Reminder</Text>
                        </TouchableOpacity>

                        <TouchableOpacity onPress={() => deleteNote(item.id)}>
                          <Text style={[styles.noteActionLink, styles.noteDeleteLink]}>
                            Delete
                          </Text>
                        </TouchableOpacity>
                      </View>
                      </View>
                    );
                  })}
                </>
              )}
            </ScrollView>
            </View>
              <Text style={styles.sectionLabel}>KAI NOTICED. Coming Soon... </Text>
              <View style={styles.suggestionCard}>
                <Text style={styles.contextLabel}>{context.label}</Text>
                {context.suggestions.map((item) => (
                  <View key={item} style={styles.suggestionRow}>
                    <Ionicons
                      name="sparkles-outline"
                      size={16}
                      color={colors.primary}
                    />
                    <Text style={styles.suggestionText}>{item}</Text>
                  </View>
                ))}
              </View>

              <Text style={styles.sectionLabel}>ASK KAI</Text>
              <View style={styles.askCard}>
                <TextInput
                  value={askKai}
                  onChangeText={setAskKai}
                  placeholder="Coming Soon, Keepr Intelligence powered by Kai… once you have your assets and systems built, imagine being able to ask, or enable Kai to help you build its story."
                  placeholderTextColor={colors.textMuted}
                  style={styles.askInput}
                  multiline
                />
                <TouchableOpacity style={styles.askButton} onPress={onAskKai}>
                  <Text style={styles.askButtonText}>Ask Kai</Text>
                </TouchableOpacity>
              </View>
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
fabWrap: {
  position: "absolute",
  top: 64,
  right: 18,
  zIndex: 10002,
  elevation: 40,
},

modalOrbWrap: {
  position: "absolute",
  top: 64,
  right: 18,
  zIndex: 10002,
  elevation: 40,
  width: 74,
  height: 74,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "transparent",
},

orbAnimatedWrap: {
  width: 74,
  height: 74,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: "transparent",
},

  orbTouch: {
  alignItems: "center",
  justifyContent: "center",
},

  fab: {
    width: 74,
    height: 74,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.10)",
  },

panel: {
  position: "absolute",
  top: 145,
  right: 30,
  width: 440,
  maxHeight: "75%",
  backgroundColor: colors.surface,
  borderRadius: 24,
  borderTopRightRadius: 32,
  paddingHorizontal: 18,
  paddingTop: 18,
  paddingBottom: 20,
  borderWidth: 1,
  borderColor: "#11182714",
  shadowColor: "#000",
  shadowOpacity: 0.15,
  shadowRadius: 24,
  shadowOffset: { width: 0, height: 12 },
  elevation: 20,
},

  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 16,
  },

  headerTextWrap: {
    flex: 1,
    paddingRight: 16,
  },

  closeBtn: {
    padding: 6,
  },

  kaiEyebrow: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 2,
  },

  kaiTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: colors.textPrimary,
  },

  kaiSubtitle: {
    fontSize: 13,
    color: colors.textMuted,
    marginTop: 4,
    maxWidth: 260,
    lineHeight: 18,
  },

  content: {
    paddingBottom: 20,
  },

  noticeCard: {
    backgroundColor: "#F5F7FA",
    borderRadius: 12,
    padding: 12,
    marginBottom: 18,
  },

  noticeLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    marginBottom: 4,
  },

  noticeText: {
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.textMuted,
    marginBottom: 10,
    marginTop: 6,
  },

  actionGrid: {
    gap: 10,
    marginBottom: 18,
  },

  primaryAction: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 14,
  },

  actionTitle: {
    fontSize: 14,
    fontWeight: "600",
    marginTop: 6,
    color: colors.textPrimary,
  },

  actionHint: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },

  suggestionCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 14,
    marginBottom: 18,
  },

notesCard: {
  backgroundColor: "#F8FAFC",
  borderRadius: 12,
  padding: 12,
  marginBottom: 18,
  borderWidth: 1,
  borderColor: "#E5E7EB",
},

noteInput: {
  fontSize: 14,
  color: colors.textPrimary,
  minHeight: 72,
  textAlignVertical: "top",
  borderWidth: 1,
  borderColor: "#E5E7EB",
  borderRadius: 10,
  backgroundColor: "#FFFFFF",
  padding: 12,
},

notesList: {
  marginTop: 14,
  maxHeight: 220,
},

notesListContent: {
  gap: 10,
  paddingBottom: 4,
},

noteItem: {
  backgroundColor: "#FFF7BF",
  borderRadius: 10,
  padding: 12,
  borderWidth: 1,
  borderColor: "#E6D97A",

  borderTopColor: "#E0D36F",
  borderTopWidth: 2,

  shadowColor: "#000",
  shadowOpacity: 0.10,
  shadowRadius: 5,
  shadowOffset: { width: 0, height: 2 },

  elevation: 2,
},

noteItemText: {
  fontSize: 13,
  color: colors.textPrimary,
  lineHeight: 18,
},

noteItemActions: {
  flexDirection: "row",
  justifyContent: "flex-end",
  alignItems: "center",
  gap: 14,
  marginTop: 10,
  flexWrap: "wrap",
},

noteActionLink: {
  fontSize: 12,
  fontWeight: "600",
  color: colors.primary,
},

noteDeleteLink: {
  color: "#B91C1C",
},
noteContext: {
  fontSize: 11,
  color: "#6B7280",
  marginTop: 6,
  fontStyle: "italic",
},
noteContextRow: {
  flexDirection: "row",
  alignItems: "center",
  marginTop: 6,
  flexWrap: "wrap",
},

noteContextLink: {
  fontSize: 11,
  color: colors.primary,
  fontWeight: "600",
},

noteContextSeparator: {
  fontSize: 11,
  color: "#6B7280",
},

noteContext: {
  fontSize: 11,
  color: "#6B7280",
  marginTop: 6,
  fontStyle: "italic",
},
noteSaveButton: {
  alignSelf: "flex-end",
  marginTop: 8,
  paddingHorizontal: 14,
  paddingVertical: 8,
  borderRadius: 6,
  backgroundColor: "#EEF2F7",
  borderWidth: 1,
  borderColor: "#D1D5DB",
},

noteSaveButtonText: {
  fontSize: 13,
  fontWeight: "600",
  color: "#1F2937",
},

  contextLabel: {
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 6,
    color: colors.textMuted,
  },

  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
  },

  suggestionText: {
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
  },

  askCard: {
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    padding: 12,
  },

  askInput: {
    fontSize: 14,
    color: colors.textPrimary,
    minHeight: 60,
    textAlignVertical: "top",
  },

  askButton: {
    alignSelf: "flex-end",
    marginTop: 10,
    backgroundColor: colors.primary,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },

  askButtonText: {
    color: "#fff",
    fontWeight: "700",
  },
});