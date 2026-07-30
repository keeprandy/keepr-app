import React, { useEffect, useState, useMemo } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  TextInput,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabaseClient";
import { navigationRef } from "../navigationRoot";
import { isSharedFileImage } from "../lib/shareIntentPayload";

export default function SendToKeeprAssetPicker({ route }) {
  const incomingShare = route?.params?.incomingShare;

  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastAssetId, setLastAssetId] = useState(null);
  const [search, setSearch] = useState("");
  const [ready, setReady] = useState(false);

  // 🔐 Cold start guard
    useEffect(() => {
      let timeout;

      if (incomingShare) {
        setReady(true);
      } else {
        // wait briefly for share intent to hydrate (cold launch)
        timeout = setTimeout(() => {
          setReady(true);
        }, 400);
      }

      return () => clearTimeout(timeout);
    }, [incomingShare]);

  useEffect(() => {
    loadAssets();
  }, []);

  const loadAssets = async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData?.user?.id;

      const { data } = await supabase
        .from("assets")
        .select("id,name,status,deleted_at")
        .eq("owner_id", userId)
        .is("deleted_at", null)
        .eq("status", "active")
        .order("name", { ascending: true });

      const clean = data || [];
      setAssets(clean);

      const last = await AsyncStorage.getItem(`lastCaptureAsset:${userId}`);
      const lastId = last ? String(last) : null;

      const stillExists = clean.some((a) => a.id === lastId);

      if (!stillExists) {
        await AsyncStorage.removeItem(`lastCaptureAsset:${userId}`);
        setLastAssetId(null);
      } else {
        setLastAssetId(lastId);
      }
    } catch (e) {
      console.log("Asset load failed", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (asset) => {
    try {
      const { data } = await supabase.auth.getUser();
      const userId = data?.user?.id;

      await AsyncStorage.setItem(
        `lastCaptureAsset:${userId}`,
        asset.id
      );

      const payload = incomingShare ? { ...incomingShare } : null;

      // 🔥 SAFE param clear (no mutation)
      if (navigationRef.isReady()) {
          navigationRef.dispatch((state) => {
            const routes = [...state.routes];
            const lastRoute = routes[routes.length - 1];

            if (lastRoute?.params?.incomingShare) {
              lastRoute.params = {
                ...lastRoute.params,
                incomingShare: null,
              };
            }

            return {
              ...state,
              routes,
            };
          });
        }

      const tempId = `temp-${Date.now()}`;

      const optimisticItem = {
        id: tempId,
        attachment_id: tempId,
        kind: payload?.file
          ? isSharedFileImage(payload.file)
            ? "photo"
            : "file"
          : payload?.url
          ? "link"
          : "file",
        title:
          payload?.file?.fileName ||
          payload?.file?.name ||
          payload?.url ||
          payload?.text ||
          "Shared item",
        file_name:
          payload?.file?.fileName ||
          payload?.file?.name ||
          null,
        url: payload?.url || null,
        status: "uploading",
        created_at: new Date().toISOString(),
      };

      navigationRef.navigate("AssetAttachmentsMobile", {
        assetId: asset.id,
        assetName: asset.name,
        incomingShare: payload,
        optimisticItem,
      });
    } catch (e) {
      console.log("Select failed", e);
    }
  };

  // 🔍 Search + sort
  const filtered = useMemo(() => {
    const list = [...assets];

    list.sort((a, b) => {
      if (a.id === lastAssetId) return -1;
      if (b.id === lastAssetId) return 1;
      return a.name.localeCompare(b.name);
    });

    if (!search.trim()) return list;

    return list.filter((a) =>
      a.name.toLowerCase().includes(search.toLowerCase())
    );
  }, [assets, lastAssetId, search]);

  // ⏳ Loading
  if (loading || !ready) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  // 🧾 Share Preview Block
  const renderPreview = () => {
    if (!incomingShare) return null;

    return (
      <View
        style={{
          padding: 12,
          borderRadius: 10,
          backgroundColor: "#F3F4F6",
          marginBottom: 12,
        }}
      >
        {incomingShare?.file && (
          <Text style={{ fontSize: 13 }}>
            📎 {incomingShare.file.fileName || "File"}
          </Text>
        )}

        {incomingShare?.url && (
          <Text style={{ fontSize: 13 }}>
            🔗 {incomingShare.url}
          </Text>
        )}

        {incomingShare?.text &&
          !incomingShare?.url && (
            <Text style={{ fontSize: 13 }}>
              📝 {incomingShare.text.slice(0, 80)}
            </Text>
          )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1, padding: 20 }}>
      {/* Header */}
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 4 }}>
        Add to Keepr
      </Text>

      <Text style={{ fontSize: 13, color: "#6B7280", marginBottom: 12 }}>
        Choose where this belongs
      </Text>

      {/* Preview */}
      {renderPreview()}

      {/* Search */}
      <TextInput
        placeholder="Search assets..."
        value={search}
        onChangeText={setSearch}
        style={{
          padding: 10,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: "#E5E7EB",
          marginBottom: 12,
        }}
      />

      {/* Asset List */}
      <FlatList
        data={filtered}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => handleSelect(item)}
            style={{
              padding: 16,
              borderBottomWidth: 1,
              borderColor: "#eee",
            }}
          >
            <Text style={{ fontSize: 15 }}>{item.name}</Text>

            {item.id === lastAssetId && (
              <Text style={{ fontSize: 12, color: "#6B7280" }}>
                Last used
              </Text>
            )}
          </TouchableOpacity>
        )}
      />

      {/* Empty state */}
      {filtered.length === 0 && (
        <View style={{ marginTop: 40, alignItems: "center" }}>
          <Text style={{ color: "#6B7280" }}>
            No assets found
          </Text>
        </View>
      )}
    </View>
  );
}
