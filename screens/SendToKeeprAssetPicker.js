import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { supabase } from "../lib/supabaseClient";
import { navigationRef } from "../navigationRoot";

export default function SendToKeeprAssetPicker({ route }) {
  const incomingShare = route?.params?.incomingShare;

  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [lastAssetId, setLastAssetId] = useState(null);

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

      setAssets(data || []);

      const last = await AsyncStorage.getItem(`lastCaptureAsset:${userId}`);
        const stillExists = (data || []).some((a) => a.id === last);
        if (!stillExists) {
        await AsyncStorage.removeItem(`lastCaptureAsset:${userId}`);
        setLastAssetId(null);
        } else {
        setLastAssetId(last);
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

      navigationRef.navigate("AssetAttachmentsMobile", {
        assetId: asset.id,
        assetName: asset.name,
        incomingShare,
      });
    } catch (e) {
      console.log("Select failed", e);
    }
  };

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  // Put last asset at top
  const sorted = [...assets].sort((a, b) => {
    if (a.id === lastAssetId) return -1;
    if (b.id === lastAssetId) return 1;
    return a.name.localeCompare(b.name);
  });

  

  return (
    <View style={{ flex: 1, padding: 20 }}>
      <Text style={{ fontSize: 18, fontWeight: "700", marginBottom: 10 }}>
        Send to Keepr
      </Text>

      <FlatList
        data={sorted}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => handleSelect(item)}
            style={{
              padding: 16,
              borderBottomWidth: 1,
              borderColor: "#eee",
            }}
          >
            <Text>{item.name}</Text>
            {item.id === lastAssetId && (
              <Text style={{ fontSize: 12, color: "#888" }}>
                Last used
              </Text>
            )}
          </TouchableOpacity>
        )}
      />
    </View>
  );
}