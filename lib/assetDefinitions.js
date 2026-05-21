export const ASSET_DEFINITIONS = {
  vehicle: {
    label: "Vehicle",
    pluralLabel: "Vehicles",
    icon: "car-sport-outline",
    storyLabel: "Vehicle Story",
    systemsLabel: "Vehicle Systems",
    metadata: [
      { key: "year", label: "Year" },
      { key: "make", label: "Make" },
      { key: "model", label: "Model" },
      { key: "trim", label: "Trim" },
      { key: "current_odometer", label: "Mileage", suffix: " mi", format: "number" },
      { key: "vin", label: "VIN" },
    ],
  },

  boat: {
    label: "Boat",
    pluralLabel: "Boats",
    icon: "boat-outline",
    storyLabel: "Boat Story",
    systemsLabel: "Boat Systems",
    metadata: [
      { key: "year", label: "Year" },
      { key: "make", label: "Make" },
      { key: "model", label: "Model" },
      { key: "length_feet", label: "Length", suffix: " ft" },
      { key: "engine_type", label: "Engine" },
      { key: "engine_hours", label: "Hours", format: "number" },
      { key: "registration_number", label: "Registration" },
    ],
  },

  home: {
    label: "Home",
    pluralLabel: "Homes",
    icon: "home-outline",
    storyLabel: "Home Story",
    systemsLabel: "Home Systems",
    metadata: [
      { key: "year_built", label: "Year Built" },
      { key: "square_feet", label: "Sq Ft", format: "number" },
      { key: "beds", label: "Beds" },
      { key: "baths", label: "Baths" },
      { key: "lot_size_sqft", label: "Lot Sq Ft", format: "number" },
    ],
  },

  other: {
    label: "Other Asset",
    pluralLabel: "Other Assets",
    icon: "cube-outline",
    storyLabel: "Asset Story",
    systemsLabel: "Asset Systems",
    metadata: [
      { key: "asset_subtype", label: "Type" },
      { key: "make", label: "Brand" },
      { key: "model", label: "Model" },
      { key: "serial_number", label: "Serial" },
      { key: "year", label: "Year" },
      { key: "estimated_value", label: "Value", prefix: "$", format: "number" },
    ],
  },
};

export function getAssetDefinition(type) {
  return ASSET_DEFINITIONS[type] || ASSET_DEFINITIONS.other;
}

export function formatAssetMetaValue(value, field) {
  if (value === null || value === undefined || value === "") return null;

  let next = value;

  if (field.format === "number") {
    const n = Number(value);
    if (Number.isFinite(n)) next = n.toLocaleString();
  }

  return `${field.prefix || ""}${next}${field.suffix || ""}`;
}