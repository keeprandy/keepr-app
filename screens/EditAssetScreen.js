// screens/EditAssetScreen.js
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
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

export default function EditAssetScreen({ route, navigation }) {
  const assetId = route.params?.assetId ?? null;
  const assetTypeParam = route.params?.assetType ?? null; // "home", "vehicle", "boat", etc.

  const { user } = useAuth();

  const [loading, setLoading] = useState(!!assetId);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Core fields
  const [type, setType] = useState(assetTypeParam || "home");
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

  // Derive effective type
  const effectiveType = (assetTypeParam || type || "home").toLowerCase();
  const isHome = effectiveType === "home";
  const isVehicle = effectiveType === "vehicle";
  const isBoat = effectiveType === "boat";

  const isTypeLocked = !!(assetTypeParam && !assetId);
  const showTypeField = !(isVehicle || isBoat || isHome);

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
          ].join(",")
        )
        .eq("id", assetId)
        .single();

      if (!isMounted) return;

      if (error) {
        console.error("Error loading asset", error);
        setError(error.message);
        setLoading(false);
        return;
      }

      if (data) {
        // Core
        setType(data.type || assetTypeParam || "home");
        setName(data.name || "");
        setLocation(data.location || "");
        setNotes(data.notes || "");
        setAssetMode(data.asset_mode || "personal");
        setCommercialEntity(data.commercial_entity || "");

        setPurchasePrice(
          data.purchase_price != null ? String(data.purchase_price) : ""
        );
        setEstimatedValue(
          data.estimated_value != null ? String(data.estimated_value) : ""
        );
        setPurchaseDate(data.purchase_date || "");

        // Home
        setPropertyType(data.property_type || "");
        setYearBuilt(
          data.year_built != null ? String(data.year_built) : ""
        );
        setBeds(data.beds != null ? String(data.beds) : "");
        setBaths(data.baths != null ? String(data.baths) : "");
        setSquareFeet(
          data.square_feet != null ? String(data.square_feet) : ""
        );
        setLotSizeSqft(
          data.lot_size_sqft != null ? String(data.lot_size_sqft) : ""
        );
        setParcelNumber(data.parcel_number || "");

        // Vehicle
        setVehicleSubtype(data.vehicle_subtype || "");
        setVehicleYear(data.year != null ? String(data.year) : "");
        setVehicleMake(data.make || "");
        setVehicleModel(data.model || "");
        setVehicleTrim(data.trim || "");
        setVehicleBodyStyle(data.body_style || "");
        setVehicleEngine(data.engine || "");
        setVehicleDrivetrain(data.drivetrain || "");
        setVehicleTransmission(data.transmission || "");
        setVehicleColor(data.color || "");
        setVehicleOdometer(
          data.current_odometer != null
            ? String(data.current_odometer)
            : ""
        );
        setVehicleVin(data.vin || "");
        setVehiclePlate(data.plate_number || "");

        // Boat
        setBoatYear(data.year != null ? String(data.year) : "");
        setBoatMake(data.make || "");
        setBoatModel(data.model || "");
        setHullMaterial(data.hull_material || "");
        setLengthFeet(
          data.length_feet != null ? String(data.length_feet) : ""
        );
        setEngineType(data.engine_type || "");
        setEngineHours(
          data.engine_hours != null ? String(data.engine_hours) : ""
        );
        setRegistrationNumber(data.registration_number || "");
      }

      setLoading(false);
    };

    loadAsset();

    return () => {
      isMounted = false;
    };
  }, [assetId, assetTypeParam]);

  const handleBack = () => {
    navigation.goBack();
  };

  const parseNumber = (value) => {
    if (!value) return null;
    const n = Number(String(value).replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
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

    const normalizedType = (assetTypeParam || type || "home").toLowerCase();

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

    let result;
    if (assetId) {
      result = await supabase
        .from("assets")
        .update(payload)
        .eq("id", assetId)
        .select()
        .maybeSingle();
    } else {
      result = await supabase
        .from("assets")
        .insert(payload)
        .select()
        .maybeSingle();
    }

    const { data, error } = result;
    setSaving(false);

    if (error) {
      console.error("Error saving asset", error);
      setError(error.message);
      return;
    }

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
                keyboardType="numeric"
                value={purchasePrice}
                onChangeText={setPurchasePrice}
                placeholder="e.g. 525000"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.fieldLabel}>Estimated value</Text>
              <KInput
                keyboardType="numeric"
                value={estimatedValue}
                onChangeText={setEstimatedValue}
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
});
