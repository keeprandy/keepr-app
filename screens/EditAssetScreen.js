// screens/EditAssetScreen.js
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAuth } from "../context/AuthContext";
import { supabase } from "../lib/supabaseClient";
import { layoutStyles } from "../styles/layout";
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from "../styles/theme";
import KeeprDateField from "../components/KeeprDateField";
import { loadMyKeeprProsForPicker } from "../lib/kpcApi";
import { getKeeprSpacePortfolio, updateKeeprSpaceBoatAsset } from "../lib/keeprspaceApi";
import { formatMoneyInput, parseMoneyInput } from "../lib/money";

/** ---------- Keepr input wrapper ---------- **/
const KInput = (props) => {
  const { style, placeholderTextColor, ...rest } = props;
  return (
    <TextInput
      {...rest}
      style={[styles.input, style]}
      placeholderTextColor={placeholderTextColor || colors.textMuted}
    />
  );
};

function buildKeeprProLabel(row) {
  const name = row?.name || "";
  const location = row?.location || "";
  if (name && location) return `${name} · ${location}`;
  return name || location || "KeeprPro";
}

function uniqIds(arr) {
  const out = [];
  const seen = new Set();
  for (const value of arr || []) {
    if (!value) continue;
    const id = String(value);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function ensureAssetMetadata(src) {
  const base = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  const standard = base.standard && typeof base.standard === "object" ? base.standard : {};
  const relationships =
    standard.relationships && typeof standard.relationships === "object"
      ? standard.relationships
      : {};

  return {
    ...base,
    standard: {
      ...standard,
      relationships: {
        ...relationships,
        keepr_pro_ids: Array.isArray(relationships.keepr_pro_ids)
          ? relationships.keepr_pro_ids
          : [],
        keepr_pro_assignments: Array.isArray(relationships.keepr_pro_assignments)
          ? relationships.keepr_pro_assignments
          : [],
      },
    },
  };
}

function extractAssetKeeprProIds(assetRow) {
  const meta = ensureAssetMetadata(assetRow?.metadata || assetRow?.extra_metadata);
  const relationships = meta.standard.relationships || {};
  const ids =
    relationships.keepr_pro_ids ||
    relationships.keeprProIds ||
    relationships.keepr_pros ||
    [];
  return uniqIds(Array.isArray(ids) ? ids : []);
}

export default function EditAssetScreen({ route, navigation }) {
  const assetId = route.params?.assetId ?? null;
  const assetTypeParam = route.params?.assetType ?? null; // "home", "vehicle", "boat", etc.
  const routeOrganizationId = route.params?.organizationId || null;
  const isOrgWorkspaceEdit = !!(assetId && routeOrganizationId);

  const { user } = useAuth();

  const [loading, setLoading] = useState(!!assetId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Core fields
  const [type, setType] = useState(assetId ? assetTypeParam || "home" : assetTypeParam || "home");
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [notes, setNotes] = useState("");

  // Classification
  const [assetMode, setAssetMode] = useState("personal");
  const [commercialEntity, setCommercialEntity] = useState("");

  // Financial / dates
  const [purchasePrice, setPurchasePrice] = useState("");
  const [estimatedValue, setEstimatedValue] = useState("");
  const [purchaseDate, setPurchaseDate] = useState(""); // ISO: YYYY-MM-DD

  // Home-specific metadata
  const [propertyType, setPropertyType] = useState("");
  const [yearBuilt, setYearBuilt] = useState("");
  const [beds, setBeds] = useState("");
  const [baths, setBaths] = useState("");
  const [squareFeet, setSquareFeet] = useState("");
  const [lotSizeSqft, setLotSizeSqft] = useState("");
  const [parcelNumber, setParcelNumber] = useState("");

  // Vehicle-specific metadata
  const [vehicleSubtype, setVehicleSubtype] = useState(""); // car, motorcycle, etc.
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehicleTrim, setVehicleTrim] = useState("");
  const [vehicleBodyStyle, setVehicleBodyStyle] = useState("");
  const [vehicleEngine, setVehicleEngine] = useState("");
  const [vehicleDrivetrain, setVehicleDrivetrain] = useState("");
  const [vehicleTransmission, setVehicleTransmission] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleOdometer, setVehicleOdometer] = useState("");
  const [vehicleVin, setVehicleVin] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");

  // Boat-specific metadata
  const [boatYear, setBoatYear] = useState("");
  const [boatMake, setBoatMake] = useState("");
  const [boatModel, setBoatModel] = useState("");
  const [hullMaterial, setHullMaterial] = useState("");
  const [lengthFeet, setLengthFeet] = useState("");
  const [engineType, setEngineType] = useState("");
  const [engineHours, setEngineHours] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [assetMetadata, setAssetMetadata] = useState({});
  const [keeprPros, setKeeprPros] = useState([]);
  const [prosLoading, setProsLoading] = useState(false);
  const [prosError, setProsError] = useState(null);
  const [selectedProIds, setSelectedProIds] = useState([]);
  const [showProPicker, setShowProPicker] = useState(false);
  const [proSearch, setProSearch] = useState("");

  // Derive effective type
  const effectiveType = (assetId ? type : assetTypeParam || type || "home").toLowerCase();
  const isHome = effectiveType === "home";
  const isVehicle = effectiveType === "vehicle";
  const isBoat = effectiveType === "boat";

  const isTypeLocked = !!(assetTypeParam && !assetId);
  const showTypeField = !(isVehicle || isBoat || isHome);

  const hydrateAssetForm = (row = {}) => {
    // Core
    setType(row.type || assetTypeParam || "home");
    setName(row.name || "");
    setLocation(row.location || "");
    setNotes(row.notes || "");
    setAssetMode(row.asset_mode || "personal");
    setCommercialEntity(row.commercial_entity || "");

    setPurchasePrice(row.purchase_price != null ? String(row.purchase_price) : "");
    setEstimatedValue(row.estimated_value != null ? String(row.estimated_value) : "");
    setPurchaseDate(row.purchase_date || "");

    // Home
    setPropertyType(row.property_type || "");
    setYearBuilt(row.year_built != null ? String(row.year_built) : "");
    setBeds(row.beds != null ? String(row.beds) : "");
    setBaths(row.baths != null ? String(row.baths) : "");
    setSquareFeet(row.square_feet != null ? String(row.square_feet) : "");
    setLotSizeSqft(row.lot_size_sqft != null ? String(row.lot_size_sqft) : "");
    setParcelNumber(row.parcel_number || "");

    // Vehicle
    setVehicleSubtype(row.vehicle_subtype || "");
    setVehicleYear(row.year != null ? String(row.year) : "");
    setVehicleMake(row.make || "");
    setVehicleModel(row.model || "");
    setVehicleTrim(row.trim || "");
    setVehicleBodyStyle(row.body_style || "");
    setVehicleEngine(row.engine || "");
    setVehicleDrivetrain(row.drivetrain || "");
    setVehicleTransmission(row.transmission || "");
    setVehicleColor(row.color || "");
    setVehicleOdometer(row.current_odometer != null ? String(row.current_odometer) : "");
    setVehicleVin(row.vin || "");
    setVehiclePlate(row.plate_number || "");

    // Boat
    setBoatYear(row.year != null ? String(row.year) : "");
    setBoatMake(row.make || "");
    setBoatModel(row.model || "");
    setHullMaterial(row.hull_material || "");
    setLengthFeet(row.length_feet != null ? String(row.length_feet) : "");
    setEngineType(row.engine_type || "");
    setEngineHours(row.engine_hours != null ? String(row.engine_hours) : "");
    setRegistrationNumber(row.registration_number || "");
    setAssetMetadata(row.extra_metadata || {});
    setSelectedProIds(extractAssetKeeprProIds(row));
  };

  const workspaceAssetRowFromPortfolioItem = (item = {}) => {
    const identity = item.identity || {};
    const exactBuild = item.exact_build || {};
    const asset = item.asset || {};
    return {
      id: item.asset_id || asset.id || assetId,
      name: item.asset_name || asset.name || "",
      type: item.asset_type || asset.type || "boat",
      location:
        asset.location ||
        identity.location ||
        item.dealer_relationship?.location_name ||
        item.service_relationship?.location_name ||
        null,
      notes: asset.notes || exactBuild.notes || null,
      asset_mode: asset.asset_mode || "commercial",
      commercial_entity: asset.commercial_entity || null,
      year: identity.year || asset.year || null,
      make: identity.make || asset.make || null,
      model: identity.model || asset.model || null,
      hull_material: asset.hull_material || identity.hull_material || null,
      length_feet: asset.length_feet || identity.length_feet || null,
      engine_type: asset.engine_type || identity.engine_type || null,
      engine_hours: asset.engine_hours || identity.engine_hours || null,
      registration_number: asset.registration_number || identity.registration_number || null,
      serial_number: identity.hin || identity.hull_number || exactBuild.hin || exactBuild.hull_number || asset.serial_number || null,
      extra_metadata: {
        ...(asset.extra_metadata || {}),
        exact_build: exactBuild,
        template: item.template || null,
        workspace_projection: {
          organization_id: item.organization_id || routeOrganizationId,
          relationship_type: item.relationship_type || null,
          access_scope: item.access_scope || null,
          asset_relationship_id: item.asset_relationship_id || null,
          stewardship_id: item.stewardship_id || null,
        },
      },
    };
  };

  // Load existing asset if editing
  useEffect(() => {
    let isMounted = true;

    const loadAsset = async () => {
      if (!assetId) {
        setLoading(false);
        return;
      }

      // IMPORTANT: Select every column we read into state. If we only select a subset,
      // missing fields become undefined -> our state setters overwrite with "" -> save writes nulls.
      const { data, error } = await supabase
        .from("assets")
        .select(
          [
            "id",
            "name",
            "type",
            "location",
            "notes",
            "hero_image_url",
            "hero_placement_id",
            "asset_mode",
            "commercial_entity",
            // value/purchase
            "purchase_price",
            "estimated_value",
            "purchase_date",
            // home
            "property_type",
            "year_built",
            "beds",
            "baths",
            "square_feet",
            "lot_size_sqft",
            "parcel_number",
            // vehicle
            "vehicle_subtype",
            "year",
            "make",
            "model",
            "trim",
            "body_style",
            "engine",
            "drivetrain",
            "transmission",
            "color",
            "current_odometer",
            "vin",
            "plate_number",
            // boat
            "hull_material",
            "length_feet",
            "engine_type",
            "engine_hours",
            "registration_number",
            "extra_metadata",
          ].join(",")
        )
        .eq("id", assetId)
        .maybeSingle();

      if (!isMounted) return;

      if (error) {
        console.error("Error loading asset", error);
        setError(error.message);
        setLoading(false);
        return;
      }

      if (data) {
        hydrateAssetForm(data);
      } else if (routeOrganizationId) {
        try {
          const portfolio = await getKeeprSpacePortfolio({
            organizationId: routeOrganizationId,
            limit: 100,
          });
          const item = (portfolio?.boats || []).find((boat) => String(boat?.asset_id || boat?.asset?.id) === String(assetId));
          if (item) {
            hydrateAssetForm(workspaceAssetRowFromPortfolioItem(item));
          } else {
            setError("This asset is not available to edit from this workspace.");
          }
        } catch (portfolioError) {
          console.error("Error loading workspace asset", portfolioError);
          setError(portfolioError?.message || "This asset is not available to edit from this workspace.");
        }
      } else {
        setError("This asset is not available to edit from this account.");
      }

      setLoading(false);
    };

    loadAsset();

    return () => {
      isMounted = false;
    };
  }, [assetId, assetTypeParam, routeOrganizationId]);

  useEffect(() => {
    let cancelled = false;

    async function loadKeeprPros() {
      if (!user?.id) {
        setKeeprPros([]);
        return;
      }

      setProsLoading(true);
      setProsError(null);
      try {
        const rows = await loadMyKeeprProsForPicker();
        if (!cancelled) setKeeprPros(rows || []);
      } catch (e) {
        if (!cancelled) {
          setProsError(e?.message || "Could not load KeeprPros.");
          setKeeprPros([]);
        }
      } finally {
        if (!cancelled) setProsLoading(false);
      }
    }

    loadKeeprPros();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const handleBack = () => {
    navigation.goBack();
  };

  const parseNumber = (value) => {
    return parseMoneyInput(value);
  };

  const selectedPros = useMemo(() => {
    const byId = new Map((keeprPros || []).map((pro) => [String(pro.id), pro]));
    return selectedProIds.map((id) => byId.get(String(id))).filter(Boolean);
  }, [keeprPros, selectedProIds]);

  const filteredPros = useMemo(() => {
    const q = proSearch.trim().toLowerCase();
    if (!q) return keeprPros;
    return keeprPros.filter((pro) =>
      [pro.name, pro.category, pro.location, pro.phone, pro.email]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [keeprPros, proSearch]);

  const toggleKeeprPro = (id) => {
    if (!id) return;
    setSelectedProIds((prev) => {
      const set = new Set(prev || []);
      const key = String(id);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      return Array.from(set);
    });
  };

  const clearKeeprPros = () => setSelectedProIds([]);

  const openKeeprProDetail = (pro) => {
    if (!pro?.id) return;
    navigation.navigate("KeeprProDetail", { pro });
  };

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }

    if (!user) {
      setError("You must be signed in to save an asset.");
      return;
    }

    setSaving(true);
    setError(null);

    const purchaseIso = purchaseDate;
    if (purchaseDate && !purchaseIso) {
      setSaving(false);
      setError("Please select a purchase date.");
      return;
    }

    const normalizedType = (assetId ? type : assetTypeParam || type || "home").toLowerCase();

    const isHomeType = normalizedType === "home";
    const isVehicleType = normalizedType === "vehicle";
    const isBoatType = normalizedType === "boat";

    const payload = {
      owner_id: user.id,
      asset_mode: assetMode === "commercial" ? "commercial" : "personal",
      commercial_entity:
    assetMode === "commercial"
    ? commercialEntity?.trim() || null
    : null,

      type: normalizedType,
      name: name.trim(),
      location: location.trim() || null,
      notes: notes.trim() || null,
      purchase_price: parseNumber(purchasePrice),
      estimated_value: parseNumber(estimatedValue),
      purchase_date: purchaseIso || null,

      // Home-only
      property_type: isHomeType ? propertyType || null : null,
      year_built: isHomeType && yearBuilt ? Number(yearBuilt) : null,
      beds: isHomeType && beds ? Number(beds) : null,
      baths: isHomeType && baths ? Number(baths) : null,
      square_feet: isHomeType && squareFeet ? Number(squareFeet) : null,
      lot_size_sqft:
        isHomeType && lotSizeSqft ? Number(lotSizeSqft) : null,
      parcel_number: isHomeType ? parcelNumber || null : null,

      // Vehicle-only
      vehicle_subtype: isVehicleType ? vehicleSubtype || null : null,
      year:
        isVehicleType && vehicleYear
          ? Number(vehicleYear)
          : isBoatType && boatYear
          ? Number(boatYear)
          : null,
      make: isVehicleType
        ? vehicleMake || null
        : isBoatType
        ? boatMake || null
        : null,
      model: isVehicleType
        ? vehicleModel || null
        : isBoatType
        ? boatModel || null
        : null,
      trim: isVehicleType ? vehicleTrim || null : null,
      body_style: isVehicleType ? vehicleBodyStyle || null : null,
      engine: isVehicleType ? vehicleEngine || null : null,
      drivetrain: isVehicleType ? vehicleDrivetrain || null : null,
      transmission: isVehicleType ? vehicleTransmission || null : null,
      color: isVehicleType ? vehicleColor || null : null,
      current_odometer:
        isVehicleType && vehicleOdometer
          ? Number(vehicleOdometer)
          : null,
      vin: isVehicleType ? vehicleVin || null : null,
      plate_number: isVehicleType ? vehiclePlate || null : null,

      // Boat-only (beyond shared year/make/model)
      hull_material: isBoatType ? hullMaterial || null : null,
      length_feet:
        isBoatType && lengthFeet ? Number(lengthFeet) : null,
      engine_type: isBoatType ? engineType || null : null,
      engine_hours:
        isBoatType && engineHours ? Number(engineHours) : null,
      registration_number: isBoatType
        ? registrationNumber || null
        : null,
    };

    const nextMetadata = ensureAssetMetadata(assetMetadata);
    const selectedIds = uniqIds(selectedProIds);
    const selectedById = new Map((keeprPros || []).map((pro) => [String(pro.id), pro]));
    const assignments = selectedIds
      .map((id) => selectedById.get(String(id)))
      .filter(Boolean)
      .map((pro) => ({
        type: "keepr_pro",
        id: pro.id,
        keepr_pro_id: pro.id,
        label: buildKeeprProLabel(pro),
        name: pro.name || buildKeeprProLabel(pro),
        category: pro.category || null,
        phone: pro.phone || null,
        email: pro.email || null,
        website: pro.website || null,
        location: pro.location || null,
        kpc_id: pro.kpcId || null,
        organization_id: pro.organizationId || pro.orgId || null,
        source: pro.source || null,
        scope: "asset",
        assignment_scope: "asset",
        relationship_label: "Linked Service Partner",
      }));

    nextMetadata.standard.relationships.keepr_pro_ids = selectedIds;
    nextMetadata.standard.relationships.keepr_pro_assignments = assignments;
    if (assignments[0]) {
      nextMetadata.asset_keepr_pro = assignments[0];
      nextMetadata.keepr_pro_label = assignments[0].label;
    } else {
      delete nextMetadata.asset_keepr_pro;
      delete nextMetadata.keepr_pro_label;
    }
    payload.extra_metadata = nextMetadata;

    let data;
    let error;
    try {
      let result;
      if (assetId) {
        if (isOrgWorkspaceEdit && isBoatType) {
          const updated = await updateKeeprSpaceBoatAsset({
            assetId,
            organizationId: routeOrganizationId,
            patch: payload,
          });
          result = {
            data: updated?.asset || { id: assetId, ...payload },
            error: null,
          };
        } else {
          result = await supabase
            .from("assets")
            .update(payload)
            .eq("id", assetId)
            .select()
            .maybeSingle();
        }
      } else {
        result = await supabase
          .from("assets")
          .insert(payload)
          .select()
          .maybeSingle();
      }
      data = result.data;
      error = result.error;
    } catch (saveError) {
      setSaving(false);
      console.error("Error saving asset", saveError);
      setError(saveError?.message || "Could not reach Keepr to save this asset.");
      return;
    }

    if (error) {
      setSaving(false);
      console.error("Error saving asset", error);
      setError(error.message);
      return;
    }

    const syncAssetId = data?.id || assetId;
    if (syncAssetId && !isOrgWorkspaceEdit) {
      const { error: syncError } = await supabase.rpc("sync_asset_provider_stewardships", {
        p_asset_id: syncAssetId,
        p_keepr_pro_ids: selectedIds,
      });

      if (syncError) {
        setSaving(false);
        console.error("Error syncing asset provider stewardships", syncError);
        setError(syncError.message || "Could not sync KeeprPro stewardship.");
        return;
      }
    }

    setSaving(false);

    console.log("Saved asset", data);
   
    const finalType = (data?.type || normalizedType || "home").toLowerCase();

    if (assetId) {
      navigation.goBack();
      return;
    }

    if (finalType === "vehicle") {
      navigation.navigate("RootTabs", {
        screen: "Garage",
        params: { focusAssetId: data.id },
      });
    } else if (finalType === "home") {
      navigation.navigate("RootTabs", {
        screen: "MyHome",
        params: { focusAssetId: data.id },
      });
    } else if (finalType === "boat") {
      navigation.navigate("Boat", { focusAssetId: data.id });
    } else {
      navigation.goBack();
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={layoutStyles.screen}>
        <View style={styles.centered}>
          <ActivityIndicator />
          <Text style={{ marginTop: spacing.sm }}>Loading asset…</Text>
        </View>
      </SafeAreaView>
    );
  }

  const isHomeEffective = isHome;
  const isVehicleEffective = isVehicle;
  const isBoatEffective = isBoat;

  return (
    <SafeAreaView style={layoutStyles.screen}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={80}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity style={styles.headerBackBtn} onPress={handleBack}>
              <Ionicons
                name="chevron-back"
                size={22}
                color={colors.textPrimary}
              />
            </TouchableOpacity>

            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {assetId ? "Edit asset" : "Add asset"}
              </Text>
              <Text style={styles.subtitle}>
                {isHomeEffective
                  ? "Home"
                  : isVehicleEffective
                  ? "Vehicle"
                  : isBoatEffective
                  ? "Boat"
                  : effectiveType || "Asset"}
              </Text>
            </View>
          </View>

          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {/* Basics */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Basics</Text>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Name</Text>
              <KInput
                value={name}
                onChangeText={setName}
                placeholder={
                  isHomeEffective
                    ? "Primary home"
                    : isVehicleEffective
                    ? "Porsche Boxster S"
                    : isBoatEffective
                    ? "Bennington 23' Tri-Toon"
                    : "Asset name"
                }
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Location</Text>
              <KInput
                value={location}
                onChangeText={setLocation}
                placeholder="City, State or Marina"
              />
            </View>


            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Asset use</Text>

              <View style={styles.modeRow}>
  <TouchableOpacity
    style={[
      styles.modeButton,
      assetMode === "personal" && styles.modeButtonActive,
    ]}
    onPress={() => setAssetMode("personal")}
  >
    <Text
      style={[
        styles.modeText,
        assetMode === "personal" && styles.modeTextActive,
      ]}
    >
      Personal
    </Text>
  </TouchableOpacity>

  <TouchableOpacity
    style={[
      styles.modeButton,
      assetMode === "commercial" && styles.modeButtonActive,
    ]}
    onPress={() => setAssetMode("commercial")}
  >
    <Text
      style={[
        styles.modeText,
        assetMode === "commercial" && styles.modeTextActive,
      ]}
    >
      Commercial
    </Text>
  </TouchableOpacity>

</View>
  {assetMode === "commercial" && (
  <View style={styles.field}>
    <Text style={styles.fieldLabel}>Commercial entity</Text>
    <KInput
      value={commercialEntity}
      onChangeText={setCommercialEntity}
      placeholder="LLC name, business name, trust, etc."
    />
  </View>
)}
              <Text style={styles.fieldLabel}>
                
              </Text>
              <Text style={styles.fieldLabel}>
                Optional: Used for reporting and future business features.
              </Text>
            </View>

            {showTypeField && (
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Type</Text>
                <KInput
                  value={type}
                  onChangeText={setType}
                  placeholder="home, vehicle, boat…"
                  editable={!isTypeLocked}
                  style={
                    isTypeLocked
                      ? { backgroundColor: colors.surfaceSubtle }
                      : null
                  }
                />
              </View>
            )}
          </View>

          {/* Value / purchase */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Value & purchase</Text>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Purchase price</Text>
              <KInput
                keyboardType="default"
                value={purchasePrice}
                onChangeText={setPurchasePrice}
                onBlur={() => setPurchasePrice(formatMoneyInput(purchasePrice))}
                placeholder="e.g. 525000"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Estimated value</Text>
              <KInput
                keyboardType="default"
                value={estimatedValue}
                onChangeText={setEstimatedValue}
                onBlur={() => setEstimatedValue(formatMoneyInput(estimatedValue))}
                placeholder="e.g. 1100000"
              />
            </View>
          <View style={styles.field}>
            <Text style={styles.fieldLabel}>Purchase date</Text>
            <KeeprDateField
              value={purchaseDate}
              onChange={setPurchaseDate}
            />
          </View>
          </View>

          {/* Home-specific section */}
          {isHomeEffective && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Home details</Text>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Property type</Text>
                <KInput
                  value={propertyType}
                  onChangeText={setPropertyType}
                  placeholder="Single family, condo…"
                />
              </View>

              <View style={styles.fieldRow}>
                <View
                  style={[styles.field, { flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Year built</Text>
                  <KInput
                    keyboardType="numeric"
                    value={yearBuilt}
                    onChangeText={setYearBuilt}
                    placeholder="2001"
                  />
                </View>

                <View
                  style={[styles.field, { flex: 1, marginLeft: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Beds</Text>
                  <KInput
                    keyboardType="numeric"
                    value={beds}
                    onChangeText={setBeds}
                    placeholder="3"
                  />
                </View>
              </View>

              <View style={styles.fieldRow}>
                <View
                  style={[styles.field, { flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Baths</Text>
                  <KInput
                    keyboardType="numeric"
                    value={baths}
                    onChangeText={setBaths}
                    placeholder="2"
                  />
                </View>

                <View
                  style={[styles.field, { flex: 1, marginLeft: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Square feet</Text>
                  <KInput
                    keyboardType="numeric"
                    value={squareFeet}
                    onChangeText={setSquareFeet}
                    placeholder="2100"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Lot size (sq ft)</Text>
                <KInput
                  keyboardType="numeric"
                  value={lotSizeSqft}
                  onChangeText={setLotSizeSqft}
                  placeholder="9500"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Parcel / Tax ID</Text>
                <KInput
                  value={parcelNumber}
                  onChangeText={setParcelNumber}
                  placeholder="Parcel number"
                />
              </View>
            </View>
          )}

          {/* Vehicle-specific section */}
          {isVehicleEffective && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Vehicle details</Text>

              <View style={styles.fieldRow}>
                <View
                  style={[styles.field, { flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Year</Text>
                  <KInput
                    keyboardType="numeric"
                    value={vehicleYear}
                    onChangeText={setVehicleYear}
                    placeholder="2024"
                  />
                </View>
                <View
                  style={[styles.field, { flex: 1, marginLeft: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Make</Text>
                  <KInput
                    value={vehicleMake}
                    onChangeText={setVehicleMake}
                    placeholder="Alfa Romeo"
                  />
                </View>
              </View>

              <View style={styles.fieldRow}>
                <View
                  style={[styles.field, { flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Model</Text>
                  <KInput
                    value={vehicleModel}
                    onChangeText={setVehicleModel}
                    placeholder="Stelvio Veloce"
                  />
                </View>
                <View
                  style={[styles.field, { flex: 1, marginLeft: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Trim</Text>
                  <KInput
                    value={vehicleTrim}
                    onChangeText={setVehicleTrim}
                    placeholder="Veloce, S, etc."
                  />
                </View>
              </View>

              <View style={styles.fieldRow}>
                <View
                  style={[styles.field, { flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Body style</Text>
                  <KInput
                    value={vehicleBodyStyle}
                    onChangeText={setVehicleBodyStyle}
                    placeholder="SUV, coupe, convertible…"
                  />
                </View>
                <View
                  style={[styles.field, { flex: 1, marginLeft: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Color</Text>
                  <KInput
                    value={vehicleColor}
                    onChangeText={setVehicleColor}
                    placeholder="Black, Silver…"
                  />
                </View>
              </View>

              <View style={styles.fieldRow}>
                <View
                  style={[styles.field, { flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Engine</Text>
                  <KInput
                    value={vehicleEngine}
                    onChangeText={setVehicleEngine}
                    placeholder="2.0L turbo, V6…"
                  />
                </View>
                <View
                  style={[styles.field, { flex: 1, marginLeft: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Drivetrain</Text>
                  <KInput
                    value={vehicleDrivetrain}
                    onChangeText={setVehicleDrivetrain}
                    placeholder="AWD, RWD…"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Transmission</Text>
                <KInput
                  value={vehicleTransmission}
                  onChangeText={setVehicleTransmission}
                  placeholder="8-speed automatic, manual…"
                />
              </View>

              <View style={styles.fieldRow}>
                <View
                  style={[styles.field, { flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Current odometer</Text>
                  <KInput
                    keyboardType="numeric"
                    value={vehicleOdometer}
                    onChangeText={setVehicleOdometer}
                    placeholder="e.g. 34500"
                  />
                </View>
                <View
                  style={[styles.field, { flex: 1, marginLeft: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>VIN</Text>
                  <KInput
                    value={vehicleVin}
                    onChangeText={setVehicleVin}
                    placeholder="17-character VIN"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Plate number</Text>
                <KInput
                  value={vehiclePlate}
                  onChangeText={setVehiclePlate}
                  placeholder="License plate"
                />
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Vehicle type</Text>
                <KInput
                  value={vehicleSubtype}
                  onChangeText={setVehicleSubtype}
                  placeholder="Car, truck, SUV, motorcycle, quad, golf cart…"
                />
                <Text style={styles.helperText}>
                  This won’t hide anything in your garage — it just helps you
                  remember what kind of vehicle it is.
                </Text>
              </View>
            </View>
          )}

          {/* Boat-specific section */}
          {isBoatEffective && (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Boat details</Text>

              <View style={styles.fieldRow}>
                <View
                  style={[styles.field, { flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Year</Text>
                  <KInput
                    keyboardType="numeric"
                    value={boatYear}
                    onChangeText={setBoatYear}
                    placeholder="2009"
                  />
                </View>
                <View
                  style={[styles.field, { flex: 1, marginLeft: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Make</Text>
                  <KInput
                    value={boatMake}
                    onChangeText={setBoatMake}
                    placeholder="Harris, Bennington…"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Model</Text>
                <KInput
                  value={boatModel}
                  onChangeText={setBoatModel}
                  placeholder="Kayot V220i, 23' Tri-Toon…"
                />
              </View>

              <View style={styles.fieldRow}>
                <View
                  style={[styles.field, { flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Hull material</Text>
                  <KInput
                    value={hullMaterial}
                    onChangeText={setHullMaterial}
                    placeholder="Aluminum, fiberglass…"
                  />
                </View>
                <View
                  style={[styles.field, { flex: 1, marginLeft: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Length (ft)</Text>
                  <KInput
                    keyboardType="numeric"
                    value={lengthFeet}
                    onChangeText={setLengthFeet}
                    placeholder="22"
                  />
                </View>
              </View>

              <View style={styles.fieldRow}>
                <View
                  style={[styles.field, { flex: 1, marginRight: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Engine type</Text>
                  <KInput
                    value={engineType}
                    onChangeText={setEngineType}
                    placeholder="V8 inboard, 200 HP outboard…"
                  />
                </View>
                <View
                  style={[styles.field, { flex: 1, marginLeft: spacing.sm }]}
                >
                  <Text style={styles.fieldLabel}>Engine hours</Text>
                  <KInput
                    keyboardType="numeric"
                    value={engineHours}
                    onChangeText={setEngineHours}
                    placeholder="e.g. 135"
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Registration #</Text>
                <KInput
                  value={registrationNumber}
                  onChangeText={setRegistrationNumber}
                  placeholder="State registration number"
                />
              </View>
            </View>
          )}

          {/* Notes */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <View style={styles.field}>
              <KInput
                multiline
                value={notes}
                onChangeText={setNotes}
                style={styles.notesInput}
                placeholder={
                  isHomeEffective
                    ? "Anything important about this home…"
                    : isBoatEffective
                    ? "Trips, storage notes, marina details…"
                    : "Anything important about this asset…"
                }
              />
            </View>
          </View>

          {/* KeeprPro */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>KeeprPro</Text>
            <View style={styles.settingsCard}>
              <View style={styles.settingsCardContent}>
                <View style={styles.settingsIcon}>
                  <Ionicons
                    name="construct-outline"
                    size={18}
                    color={colors.textPrimary}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.settingsTitle}>
                    {selectedPros.length
                      ? selectedPros.map((pro) => buildKeeprProLabel(pro)).join(", ")
                      : "No KeeprPro connected"}
                  </Text>
                  <Text style={styles.settingsSubtitle}>
                    {selectedPros.length
                      ? "Connected to this asset"
                      : "Connect a service partner to this asset."}
                  </Text>
                </View>

                <TouchableOpacity
                  style={styles.inlineActionBtn}
                  onPress={() => setShowProPicker(true)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.inlineActionText}>
                    {selectedPros.length ? "Change" : "Connect"}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.helperText}>
              Asset-level means this provider is connected to the asset generally. It does not assign them to every system.
            </Text>
            {!!prosError && <Text style={styles.errorText}>{prosError}</Text>}
          </View>

          {/* Public View & Actions */}
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Public view & actions</Text>

            <TouchableOpacity
              style={styles.settingsCard}
              onPress={() =>
                navigation.navigate("PublicConfig", {
                  assetId,
                  assetName: name || "Asset",
                })
              }
              activeOpacity={0.85}
            >
              <View style={styles.settingsCardContent}>
                <View style={styles.settingsIcon}>
                  <Ionicons
                    name="globe-outline"
                    size={18}
                    color={colors.textPrimary}
                  />
                </View>

                <View style={{ flex: 1 }}>
                  <Text style={styles.settingsTitle}>
                    Configure public view
                  </Text>
                  <Text style={styles.settingsSubtitle}>
                    Control what others can see and do for this asset.
                  </Text>
                </View>

                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={colors.textMuted}
                />
              </View>
            </TouchableOpacity>
          </View>
          {/* Save button */}
          <View style={styles.footer}>
            <TouchableOpacity
              style={[
                styles.saveButton,
                saving && { opacity: 0.7 },
              ]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color={colors.brandWhite} />
              ) : (
                <>
                  <Ionicons
                    name="save-outline"
                    size={18}
                    color={colors.brandWhite}
                    style={{ marginRight: 6 }}
                  />
                  <Text style={styles.saveButtonText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </ScrollView>

        <Modal
          visible={showProPicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowProPicker(false)}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View>
                  <Text style={styles.modalKicker}>KeeprPro</Text>
                  <Text style={styles.modalTitle}>Connect KeeprPro</Text>
                </View>
                <TouchableOpacity
                  style={styles.modalCloseBtn}
                  onPress={() => setShowProPicker(false)}
                >
                  <Ionicons name="close" size={20} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <KInput
                value={proSearch}
                onChangeText={setProSearch}
                placeholder="Search KeeprPros..."
              />

              {prosLoading ? (
                <View style={styles.inlineRow}>
                  <ActivityIndicator size="small" />
                  <Text style={styles.inlineText}>Loading KeeprPros...</Text>
                </View>
              ) : filteredPros.length === 0 ? (
                <Text style={styles.emptyHint}>No KeeprPros found.</Text>
              ) : (
                <ScrollView style={styles.modalList}>
                  {filteredPros.map((pro) => {
                    const selected = selectedProIds.includes(String(pro.id));
                    return (
                      <TouchableOpacity
                        key={pro.id}
                        style={styles.modalOptionRow}
                        onPress={() => toggleKeeprPro(pro.id)}
                        activeOpacity={0.85}
                      >
                        <Ionicons
                          name={selected ? "checkbox-outline" : "square-outline"}
                          size={19}
                          color={selected ? colors.brandBlue : colors.textMuted}
                          style={{ marginRight: 10 }}
                        />
                        <View style={{ flex: 1 }}>
                          <Text
                            style={
                              selected
                                ? styles.modalOptionTextActive
                                : styles.modalOptionText
                            }
                            numberOfLines={1}
                          >
                            {buildKeeprProLabel(pro)}
                          </Text>
                          {(pro.category || pro.phone || pro.email) ? (
                            <Text style={styles.modalOptionSub} numberOfLines={1}>
                              {[pro.category, pro.phone, pro.email]
                                .filter(Boolean)
                                .join(" · ")}
                            </Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          onPress={() => openKeeprProDetail(pro)}
                          style={styles.modalOpenBtn}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons
                            name="open-outline"
                            size={18}
                            color={colors.textSecondary}
                          />
                        </TouchableOpacity>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              )}

              <View style={styles.modalFooterRow}>
                <TouchableOpacity
                  style={styles.modalSecondaryBtn}
                  onPress={clearKeeprPros}
                  disabled={!selectedProIds.length}
                >
                  <Text style={styles.modalSecondaryText}>Clear</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.modalPrimaryBtn}
                  onPress={() => setShowProPicker(false)}
                >
                  <Text style={styles.modalPrimaryText}>Done</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/* ======================== STYLES ======================== */

const styles = StyleSheet.create({
  scrollContent: {
    paddingBottom: spacing.xl * 2,
  },
  centered: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
  },

  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  headerBackBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.surfaceSubtle,
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.sm,
  },
  title: {
    ...typography.title,
  },
  subtitle: {
    ...typography.subtitle,
    marginTop: 2,
  },

  settingsCard: {
  backgroundColor: colors.surface,
  borderRadius: radius.lg,
  padding: spacing.sm,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  ...shadows.subtle,
},

settingsCardContent: {
  flexDirection: "row",
  alignItems: "center",
},

settingsIcon: {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
  marginRight: spacing.sm,
  backgroundColor: colors.surfaceSubtle,
},

settingsTitle: {
  fontSize: 14,
  fontWeight: "700",
  color: colors.textPrimary,
},

settingsSubtitle: {
  fontSize: 12,
  color: colors.textMuted,
  marginTop: 2,
},
  inlineActionBtn: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.surfaceSubtle,
  },
  inlineActionText: {
    fontSize: 12,
    fontWeight: "800",
    color: colors.textPrimary,
  },

  section: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  sectionLabel: {
    ...typography.sectionLabel,
    marginBottom: spacing.xs,
  },

  field: {
    marginBottom: spacing.sm,
  },
  fieldRow: {
    flexDirection: "row",
    marginBottom: spacing.sm,
  },
  fieldLabel: {
    fontSize: 12,
    color: colors.textMuted,
    marginBottom: 4,
  },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.borderSubtle,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs + 2,
    backgroundColor: colors.surface,
    fontSize: 14,
    color: colors.textPrimary,
  },
  notesInput: {
    minHeight: 80,
    textAlignVertical: "top",
  },
  helperText: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 4,
  },
  inlineRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
  },
  inlineText: {
    marginLeft: spacing.sm,
    color: colors.textSecondary,
    fontSize: 12,
  },
  emptyHint: {
    marginTop: spacing.md,
    color: colors.textMuted,
    fontSize: 13,
  },

  errorCard: {
    marginHorizontal: spacing.lg,
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FCA5A5",
  },
  errorText: {
    fontSize: 12,
    color: "#B91C1C",
  },

  footer: {
    paddingHorizontal: spacing.lg,
    marginTop: spacing.lg,
    marginBottom: spacing.xl,
  },
  saveButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.brandBlue,
    ...shadows.subtle,
  },
  saveButtonText: {
    color: colors.brandWhite,
    fontSize: 15,
    fontWeight: "600",
  },
  modeRow: {
  flexDirection: "row",
  gap: 8,
  marginTop: 6,
},

modeButton: {
  paddingVertical: 8,
  paddingHorizontal: 14,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surface,
},

modeButtonActive: {
  backgroundColor: colors.primary,
  borderColor: colors.primary,
},

modeText: {
  fontSize: 13,
  color: colors.textSecondary,
  fontWeight: "600",
},

modeTextActive: {
  color: "#fff",
},
modalBackdrop: {
  flex: 1,
  backgroundColor: "rgba(15, 23, 42, 0.48)",
  alignItems: "center",
  justifyContent: "center",
  padding: spacing.lg,
},
modalCard: {
  width: "100%",
  maxWidth: 560,
  maxHeight: "86%",
  borderRadius: radius.lg,
  backgroundColor: colors.surface,
  padding: spacing.lg,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  ...shadows.subtle,
},
modalHeader: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: spacing.md,
},
modalKicker: {
  fontSize: 11,
  color: colors.textMuted,
  fontWeight: "800",
  textTransform: "uppercase",
},
modalTitle: {
  fontSize: 18,
  fontWeight: "900",
  color: colors.textPrimary,
  marginTop: 2,
},
modalCloseBtn: {
  width: 36,
  height: 36,
  borderRadius: 18,
  alignItems: "center",
  justifyContent: "center",
  backgroundColor: colors.surfaceSubtle,
},
modalList: {
  marginTop: spacing.md,
  maxHeight: 360,
},
modalOptionRow: {
  flexDirection: "row",
  alignItems: "center",
  paddingVertical: spacing.sm,
  borderBottomWidth: 1,
  borderBottomColor: colors.borderSubtle,
},
modalOptionText: {
  fontSize: 14,
  fontWeight: "700",
  color: colors.textPrimary,
},
modalOptionTextActive: {
  fontSize: 14,
  fontWeight: "900",
  color: colors.brandBlue,
},
modalOptionSub: {
  marginTop: 2,
  fontSize: 12,
  color: colors.textMuted,
},
modalOpenBtn: {
  width: 34,
  height: 34,
  borderRadius: 17,
  alignItems: "center",
  justifyContent: "center",
},
modalFooterRow: {
  flexDirection: "row",
  justifyContent: "flex-end",
  gap: spacing.sm,
  marginTop: spacing.lg,
},
modalSecondaryBtn: {
  borderRadius: radius.md,
  borderWidth: 1,
  borderColor: colors.borderSubtle,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
},
modalSecondaryText: {
  color: colors.textSecondary,
  fontWeight: "800",
},
modalPrimaryBtn: {
  borderRadius: radius.md,
  backgroundColor: colors.brandBlue,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
},
modalPrimaryText: {
  color: colors.brandWhite,
  fontWeight: "900",
},
});
