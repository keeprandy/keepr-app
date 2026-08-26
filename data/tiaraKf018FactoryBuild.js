const WORK_ORDER_SOURCE_DOCUMENT = "Tiara Work Order 68398 / KF018 Change Order 1";
const BUYERS_GUIDE_SOURCE_DOCUMENT = "Tiara Yachts 56 LS Buyer's Guide MY2027";
const TIARA_56LS_PUBLIC_MODEL_URL = "https://www.tiarayachts.com/series/ls/models/56ls";
export const TIARA_56_LS_TEMPLATE_KEY = "tiara-2027-56-ls";
export const TIARA_KF018_BUILD_KEY = "kf018";

export const TIARA_SYSTEM_CATEGORIES = [
  "Propulsion",
  "Navigation & Electronics",
  "Electrical",
  "Generator / AC Power",
  "Batteries & Charging",
  "Stabilization",
  "HVAC",
  "Fresh Water",
  "Waste / Sanitation",
  "Bilge",
  "Fuel",
  "Steering",
  "Deck / Cockpit",
  "Anchoring",
  "Entertainment",
  "Galley / Appliances",
  "Lighting",
  "Safety",
  "Interior",
  "Exterior",
];

export const tiaraKf018WorkOrder = {
  source_type: "tiara_work_order",
  source_document: WORK_ORDER_SOURCE_DOCUMENT,
  order_number: "68398",
  quote_order_number: "QO3881",
  order_date: "2026-05-01",
  hull_number: "SSUKF018H627",
  hin: "SSUKF018H627",
  completion_date: "2026-08-21",
  submitted_by: "Rodney Salinas",
  date_requested: "2026-07-28",
  dealer: "Ocean Blue Yachts",
  customer: "South Florida Assets & Operations LLC DBA Ocean Blue Yachts",
  related_to: "Barry Skolnick",
  build_code: "KF018",
  model: "Tiara 56 LS Luxury Sport",
  source_role: "factory_build_truth",
  supporting_catalog_source: BUYERS_GUIDE_SOURCE_DOCUMENT,
  public_model_source: TIARA_56LS_PUBLIC_MODEL_URL,
};

export const tiara56LsPublicModelContext = {
  source_type: "tiara_public_model_page",
  source_role: "public_catalog_context",
  source_url: TIARA_56LS_PUBLIC_MODEL_URL,
  model: "56 LS",
  specs: [
    { label: "L.O.A. w/ integrated platform", value: "56'2\"" },
    { label: "Beam", value: "16'0\"" },
    { label: "Dry weight", value: "39,600 lbs" },
    { label: "Draft", value: "4'0\"" },
    { label: "Fuel capacity", value: "1,000 Gallons" },
    { label: "Water capacity", value: "150 Gallons" },
    { label: "Holding tank capacity", value: "60 Gallons" },
    { label: "Deadrise at transom", value: "21 degrees" },
    { label: "Staterooms", value: "2" },
    { label: "Heads", value: "2" },
  ],
  resources: [
    { label: "56 LS Buyers Guide", type: "buyers_guide" },
    { label: "2027 Materials Selection Guide", type: "materials_guide" },
    { label: "Quad Mercury 600 Verado V12 Performance Report", type: "performance_report" },
    { label: "Virtual Tour", type: "virtual_tour" },
  ],
  media_gallery: [
    "Exterior running views",
    "Cockpit and salon at dusk",
    "Aft cockpit lounge with high-gloss teak table",
    "Aerial and plan-view images",
    "Interior plan view",
  ],
};

export const tiara56LsCatalogTemplate = {
  template_key: TIARA_56_LS_TEMPLATE_KEY,
  version: 1,
  source_type: "tiara_catalog_template",
  source_role: "reusable_model_template",
  manufacturer: "Tiara Yachts",
  model: "56 LS",
  model_year: 2027,
  source_documents: [
    BUYERS_GUIDE_SOURCE_DOCUMENT,
    TIARA_56LS_PUBLIC_MODEL_URL,
  ],
  identity: {
    category: "boat",
    class: "Luxury Sport",
    loa: "56'2\"",
    beam: "16'0\"",
    dry_weight: "39,600 lbs",
    fuel_capacity: "1,000 Gallons",
    water_capacity: "150 Gallons",
    holding_tank_capacity: "60 Gallons",
  },
  starter_systems: [
    {
      canonical_key: "system.propulsion.quad_mercury_v12_600",
      normalized_name: "Quad Mercury V12 600 HP Verado Outboards",
      system_category: "Propulsion",
      manufacturer: "Mercury",
      model: "V12 600 HP Verado",
      relationship_type: "system",
      template_status: "standard_or_base_required",
    },
    {
      canonical_key: "system.generator.onan_13_5kw",
      normalized_name: "Onan 13.5kW Diesel Generator",
      system_category: "Generator / AC Power",
      manufacturer: "Onan",
      model: "13.5kW Diesel Generator",
      relationship_type: "system",
      template_status: "standard",
    },
    {
      canonical_key: "system.navigation.garmin_integrated",
      normalized_name: "Tiara Integrated Garmin Electronics Package",
      system_category: "Navigation & Electronics",
      manufacturer: "Garmin",
      product_family: "GPSMAP / GSD / Fantom / VHF",
      relationship_type: "system",
      template_status: "standard",
      components: [
        "Three Garmin GPSMAP displays",
        "Garmin GSD 25 premium sounder",
        "1kW transducer",
        "Garmin VHF radio",
        "Garmin Fantom 54 open-array radar",
        "Cockpit camera",
      ],
    },
    {
      canonical_key: "system.stabilization.zipwake",
      normalized_name: "Zipwake Dynamic Trim Control System",
      system_category: "Stabilization",
      manufacturer: "Zipwake",
      relationship_type: "system",
      template_status: "standard",
    },
    {
      canonical_key: "system.hvac.dometic",
      normalized_name: "Dometic Cockpit and Cabin HVAC",
      system_category: "HVAC",
      manufacturer: "Dometic",
      product_family: "Cockpit air conditioning / Voyager cabin air conditioning",
      relationship_type: "system",
      template_status: "standard",
    },
    {
      canonical_key: "system.waste.vacuflush_holding",
      normalized_name: "VacuFlush and Holding Tank Waste System",
      system_category: "Waste / Sanitation",
      manufacturer: "VacuFlush",
      relationship_type: "system",
      template_status: "standard",
    },
    {
      canonical_key: "system.deck_cockpit.modules",
      normalized_name: "Aft Cockpit Module",
      system_category: "Deck / Cockpit",
      relationship_type: "option",
      template_status: "choose_one",
      options: ["Buffet Lounge Module", "Adventure Module"],
    },
  ],
  option_groups: [
    {
      group: "Mechanical Group",
      options: ["Seakeeper SK10.5 Gyro", "Head Macerator System", "Oil Changer for Generator", "ElectroSea Strainer System", "Forward Shore Power", "Watermaker Prep", "Zipwake Pro Trim Tabs"],
    },
    {
      group: "Electronics Group",
      options: ["ACR LED Remote Spotlight", "Electric Fold-Down Antennas and Navigation Light Mast", "FLIR M364C Camera", "AIS System", "SiriusXM Radio & Weather Ready"],
    },
    {
      group: "Exterior Group",
      options: ["Synthetic Teak Decking", "Integrated Air Station", "Quick Release Fender Hanger", "Gunwale Rod Holders", "Forward Manual Mediterranean Style Sunshade", "Engine Cowling Paint"],
    },
    {
      group: "Interior Group",
      options: ["Icemaker", "Upholstery Package", "Solid Surface Selections"],
    },
  ],
};

function line({
  line_number,
  factory_item_code,
  factory_description,
  quantity = 1,
  factory_section = "Standards & Options",
  normalized_name,
  system_category,
  system_id = null,
  component_id = null,
  manufacturer = null,
  model = null,
  product_family = null,
  relationship_type,
  mapping_status = "mapped",
  mapping_confidence = 0.78,
  mapping_method = "rules",
  manual_status = null,
  owner_manual = null,
  service_manual = null,
  installation_manual = null,
  warranty_source = null,
  review_note = null,
  supporting_catalog_source = BUYERS_GUIDE_SOURCE_DOCUMENT,
}) {
  return {
    id: `kf018-wo-${String(line_number).padStart(2, "0")}`,
    line_number,
    source_type: "tiara_work_order",
    source_document: WORK_ORDER_SOURCE_DOCUMENT,
    order_number: tiaraKf018WorkOrder.order_number,
    order_date: tiaraKf018WorkOrder.order_date,
    hull_number: tiaraKf018WorkOrder.hull_number,
    hin: tiaraKf018WorkOrder.hin,
    completion_date: tiaraKf018WorkOrder.completion_date,
    factory_item_code,
    factory_description,
    quantity,
    factory_section,
    raw_source_text: [quantity, factory_item_code, factory_description].filter((value) => value !== null && value !== undefined && value !== "").join(" "),
    normalized_name,
    system_category,
    system_id,
    component_id,
    manufacturer,
    model,
    product_family,
    relationship_type,
    mapping_status,
    mapping_confidence,
    mapping_method,
    source_role: "factory_build_truth",
    factory_confirmed: true,
    manual_status: manual_status || (["system", "component"].includes(relationship_type) ? "missing" : null),
    owner_manual,
    service_manual,
    installation_manual,
    warranty_source,
    review_note,
    supporting_catalog_source,
  };
}

export const tiaraKf018FactoryLines = [
  line({
    line_number: 1,
    factory_item_code: "KF",
    factory_description: "TIARA 56LS LUXURY SPORT",
    normalized_name: "Tiara 56 LS Luxury Sport",
    system_category: "Boat Configuration",
    relationship_type: "configuration",
    mapping_status: "mapped",
    mapping_confidence: 0.98,
    mapping_method: "exact_catalog_match",
    manual_status: null,
  }),
  line({
    line_number: 2,
    factory_item_code: "KFA275Q0003921",
    factory_description: "QUAD MERCURY V12 600 HP, JPO",
    normalized_name: "Quad Mercury V12 600 HP Joystick Piloting Outboards",
    system_category: "Propulsion",
    system_id: "kf018-system-propulsion",
    manufacturer: "Mercury",
    model: "V12 600 HP",
    product_family: "Verado / Joystick Piloting",
    relationship_type: "system",
    mapping_confidence: 0.92,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 3,
    factory_item_code: "KFA275Q0705050",
    factory_description: "LOUNGE MODULE",
    normalized_name: "Aft Lounge Module",
    system_category: "Deck / Cockpit",
    system_id: "kf018-system-deck-cockpit",
    product_family: "Aft module",
    relationship_type: "option",
    mapping_confidence: 0.86,
  }),
  line({
    line_number: 4,
    factory_item_code: "KFA275Q0706454",
    factory_description: "COCKPIT TABLE W/LOUNGE MODULE",
    normalized_name: "Cockpit Table with Lounge Module",
    system_category: "Deck / Cockpit",
    system_id: "kf018-system-deck-cockpit",
    relationship_type: "option",
    mapping_confidence: 0.9,
  }),
  line({
    line_number: 5,
    factory_item_code: "KFA275Q0322420",
    factory_description: "SEAKEEPER SK10.5 GYRO",
    normalized_name: "Seakeeper SK10.5 Gyro Stabilizer",
    system_category: "Stabilization",
    system_id: "kf018-system-stabilization",
    manufacturer: "Seakeeper",
    model: "SK10.5",
    product_family: "Gyro stabilizer",
    relationship_type: "system",
    mapping_status: "partially_mapped",
    mapping_confidence: 0.94,
    mapping_method: "rules",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 6,
    factory_item_code: "KFA275Q0613400",
    factory_description: "MACERATOR (WASTE SYSTEM)",
    normalized_name: "Waste System Macerator",
    system_category: "Waste / Sanitation",
    system_id: "kf018-system-waste",
    component_id: "kf018-component-macerator",
    relationship_type: "component",
    mapping_status: "partially_mapped",
    mapping_confidence: 0.82,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 7,
    factory_item_code: "KFA275Q0780397",
    factory_description: "OIL CHANGER FOR GENERATOR",
    normalized_name: "Generator Oil Changer",
    system_category: "Generator / AC Power",
    system_id: "kf018-system-generator",
    component_id: "kf018-component-generator-oil-changer",
    relationship_type: "component",
    mapping_status: "partially_mapped",
    mapping_confidence: 0.9,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 8,
    factory_item_code: "KFA275Q0780399",
    factory_description: "ELECTROSEA STRAINER",
    normalized_name: "ElectroSea Strainer",
    system_category: "Fresh Water",
    system_id: "kf018-system-raw-water-protection",
    manufacturer: "ElectroSea",
    product_family: "Strainer system",
    relationship_type: "system",
    mapping_status: "mapped",
    mapping_confidence: 0.92,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 9,
    factory_item_code: "KFA275Q0674800",
    factory_description: "SHORE POWER SYSTEM - FWD DECK",
    normalized_name: "Forward Deck Shore Power System",
    system_category: "Electrical",
    system_id: "kf018-system-electrical",
    component_id: "kf018-component-shore-power-fwd-deck",
    relationship_type: "component",
    mapping_confidence: 0.94,
    mapping_method: "exact_catalog_match",
    manual_status: "missing",
  }),
  line({
    line_number: 10,
    factory_item_code: "KFA275Q0696760",
    factory_description: "SYN TEAK DECK, STB PKG, NATURAL",
    normalized_name: "Synthetic Teak Deck Starboard Package Natural",
    system_category: "Exterior",
    system_id: "kf018-system-exterior",
    relationship_type: "option",
    mapping_confidence: 0.86,
  }),
  line({
    line_number: 11,
    factory_item_code: "KFA275Q0696762",
    factory_description: "SYN TEAK DECK, COCKPIT/SWIM, NATURAL",
    normalized_name: "Synthetic Teak Deck Cockpit and Swim Platform Natural",
    system_category: "Deck / Cockpit",
    system_id: "kf018-system-deck-cockpit",
    relationship_type: "option",
    mapping_confidence: 0.9,
  }),
  line({
    line_number: 12,
    factory_item_code: "KFA275Q0705058",
    factory_description: "INTEGRATED AFT STATION-LOUNGE MODULE",
    normalized_name: "Integrated Aft Station Lounge Module",
    system_category: "Deck / Cockpit",
    system_id: "kf018-system-deck-cockpit",
    relationship_type: "option",
    mapping_status: "partially_mapped",
    mapping_confidence: 0.78,
  }),
  line({
    line_number: 13,
    factory_item_code: "KFA275Q0707236",
    factory_description: "FWD MANUAL MEDITERRANEAN STYLE SUNSHADE",
    normalized_name: "Forward Manual Mediterranean Style Sunshade",
    system_category: "Deck / Cockpit",
    system_id: "kf018-system-deck-cockpit",
    relationship_type: "option",
    mapping_confidence: 0.84,
  }),
  line({
    line_number: 14,
    factory_item_code: "KFA275Q0711492",
    factory_description: "FREEZER/ ICEMAKER, LIEU OF STD FREEZER",
    normalized_name: "Freezer and Icemaker Upgrade",
    system_category: "Galley / Appliances",
    system_id: "kf018-system-galley-appliances",
    component_id: "kf018-component-freezer-icemaker",
    relationship_type: "component",
    mapping_status: "partially_mapped",
    mapping_confidence: 0.88,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 15,
    factory_item_code: "KFA275Q0705049",
    factory_description: "GUNWALE ROD HOLDERS",
    normalized_name: "Gunwale Rod Holders",
    system_category: "Deck / Cockpit",
    system_id: "kf018-system-deck-cockpit",
    relationship_type: "option",
    mapping_confidence: 0.95,
    mapping_method: "exact_catalog_match",
  }),
  line({
    line_number: 16,
    factory_item_code: "KFA275Q0706216",
    factory_description: "SPOTLIGHT, REMOTE (ACR100 LED) HARDTOP",
    normalized_name: "ACR100 LED Remote Spotlight",
    system_category: "Lighting",
    system_id: "kf018-system-lighting",
    component_id: "kf018-component-acr100-spotlight",
    manufacturer: "ACR",
    model: "ACR100 LED",
    product_family: "Remote spotlight",
    relationship_type: "component",
    mapping_status: "partially_mapped",
    mapping_confidence: 0.9,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 17,
    factory_item_code: "KFA275Q0706221",
    factory_description: "ELECTRIC FOLD-DOWN ANTENNAS/NAV LIGHT",
    normalized_name: "Electric Fold-Down Antennas and Navigation Light",
    system_category: "Navigation & Electronics",
    system_id: "kf018-system-navigation-electronics",
    component_id: "kf018-component-fold-down-antennas-nav-light",
    relationship_type: "component",
    mapping_status: "partially_mapped",
    mapping_confidence: 0.9,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 18,
    factory_item_code: "KFA275Q0037712",
    factory_description: "FLIR THERMAL CAMERA",
    normalized_name: "FLIR Thermal Camera",
    system_category: "Navigation & Electronics",
    system_id: "kf018-system-navigation-electronics",
    component_id: "kf018-component-flir-thermal-camera",
    manufacturer: "FLIR",
    model: "M364C",
    product_family: "Thermal camera",
    relationship_type: "component",
    mapping_status: "mapped",
    mapping_confidence: 0.96,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 19,
    factory_item_code: "KFA275Q0373740",
    factory_description: "STARLINK",
    normalized_name: "Starlink Satellite Internet Pre-Wire / Ready",
    system_category: "Navigation & Electronics",
    system_id: "kf018-system-navigation-electronics",
    component_id: "kf018-component-starlink",
    manufacturer: "Starlink",
    product_family: "Satellite internet",
    relationship_type: "option",
    mapping_status: "partially_mapped",
    mapping_confidence: 0.82,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 20,
    factory_item_code: "KFA275Q0227001",
    factory_description: "ZIP WAKE PRO TRIM TABS",
    normalized_name: "Zipwake Pro Trim Tabs",
    system_category: "Stabilization",
    system_id: "kf018-system-stabilization",
    component_id: "kf018-component-zipwake-trim-tabs",
    manufacturer: "Zipwake",
    product_family: "Dynamic trim control",
    relationship_type: "component",
    mapping_status: "mapped",
    mapping_confidence: 0.96,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
  }),
  line({
    line_number: 21,
    factory_item_code: "KFA275Q0716905",
    factory_description: "HULL COLOR: PAINT",
    normalized_name: "Hull Color Paint",
    system_category: "Exterior",
    system_id: "kf018-system-exterior",
    relationship_type: "configuration",
    mapping_status: "needs_review",
    mapping_confidence: 0.58,
    mapping_method: "rules",
    manual_status: null,
    review_note: "Photo confirms paint option but the visible line does not show the selected paint color.",
  }),
  line({
    line_number: 22,
    factory_item_code: "KFA275Q0061532",
    factory_description: "ENGINE PAINT, WHITE-HULL COLOR, MERCURY",
    normalized_name: "Mercury Engine Paint White Hull Color",
    system_category: "Propulsion",
    system_id: "kf018-system-propulsion",
    relationship_type: "configuration",
    mapping_confidence: 0.82,
    manual_status: null,
  }),
  line({
    line_number: 23,
    factory_item_code: "KFA275Q0796067",
    factory_description: "BOOTLINE: AX7666H CRYSTAL WHITE",
    normalized_name: "Bootline Crystal White",
    system_category: "Exterior",
    system_id: "kf018-system-exterior",
    relationship_type: "configuration",
    mapping_status: "needs_review",
    mapping_confidence: 0.64,
    mapping_method: "rules",
    manual_status: null,
    review_note: "Bootline color text is OCR-read from the image and should be confirmed against a source PDF.",
  }),
  line({
    line_number: 24,
    factory_item_code: "KFA275Q0666800",
    factory_description: "BOTTOM PAINT BLACK ANTI-FOULING",
    normalized_name: "Black Anti-Fouling Bottom Paint",
    system_category: "Exterior",
    system_id: "kf018-system-exterior",
    relationship_type: "configuration",
    mapping_confidence: 0.86,
    manual_status: null,
  }),
  line({
    line_number: 25,
    factory_item_code: "KFA275Q0733725",
    factory_description: "SIGNATURE UPH EXTERIOR: LIGHTHOUSE WHITE",
    normalized_name: "Exterior Upholstery Lighthouse White",
    system_category: "Interior",
    system_id: "kf018-system-interior",
    relationship_type: "configuration",
    mapping_confidence: 0.8,
    manual_status: null,
  }),
  line({
    line_number: 26,
    factory_item_code: "KFA275Q0731316",
    factory_description: "INTERIOR FABRIC: COASTAL",
    normalized_name: "Interior Fabric Coastal",
    system_category: "Interior",
    system_id: "kf018-system-interior",
    relationship_type: "configuration",
    mapping_confidence: 0.86,
    manual_status: null,
  }),
  line({
    line_number: 27,
    factory_item_code: "KFA275Q0716967",
    factory_description: "SOLID SURFACE-INTECK LG AURORA ANDRIA",
    normalized_name: "Solid Surface InTeck LG Aurora Andria",
    system_category: "Interior",
    system_id: "kf018-system-interior",
    relationship_type: "configuration",
    mapping_status: "needs_review",
    mapping_confidence: 0.62,
    mapping_method: "rules",
    manual_status: null,
    review_note: "Surface name is OCR-read from the photo and needs confirmation from the original work-order document.",
  }),
  line({
    line_number: 28,
    factory_item_code: "KFA275SOC000021",
    factory_description: "HULL CLR: AX AGF724PHT SUNFAST RED",
    normalized_name: "Hull Color Sunfast Red",
    system_category: "Exterior",
    system_id: "kf018-system-exterior",
    relationship_type: "configuration",
    mapping_status: "needs_review",
    mapping_confidence: 0.54,
    mapping_method: "rules",
    factory_section: "Approved Specials",
    manual_status: null,
    review_note: "Approved special text is partially OCR-read from the image and must be reconciled with the paint line.",
  }),
  line({
    line_number: 29,
    factory_item_code: null,
    factory_description: "Generator",
    normalized_name: "Onan 13.5kW Diesel Generator",
    system_category: "Generator / AC Power",
    system_id: "kf018-system-generator",
    manufacturer: "Onan",
    model: "13.5kW Diesel Generator",
    product_family: "Diesel generator with sound shield",
    relationship_type: "system",
    mapping_status: "partially_mapped",
    mapping_confidence: 0.86,
    mapping_method: "exact_catalog_match",
    manual_status: "needs_exact_model",
    review_note: "Derived from the generator oil changer factory line and confirmed as standard equipment in the 56 LS buyer's guide; exact serial/model evidence still needed.",
  }),
];

export const tiaraKf018Systems = Object.values(
  tiaraKf018FactoryLines.reduce((acc, item) => {
    if (!item.system_id || item.relationship_type === "build_only" || item.relationship_type === "configuration") return acc;
    if (!acc[item.system_id]) {
      acc[item.system_id] = {
        id: item.system_id,
        name: item.system_category === "Generator / AC Power" ? "Generator" : item.system_category,
        system_category: item.system_category,
        factory_confirmed: true,
        manual_status: item.manual_status || "missing",
        owner_manual: null,
        service_manual: null,
        installation_manual: null,
        warranty_source: null,
        evidence_line_ids: [],
      };
    }
    acc[item.system_id].evidence_line_ids.push(item.id);
    if (item.manual_status === "needs_exact_model") acc[item.system_id].manual_status = "needs_exact_model";
    return acc;
  }, {})
);

export function getTiaraKf018ManualQueue(lines = tiaraKf018FactoryLines) {
  const queueBySystem = new Map();
  lines.forEach((item) => {
    if (!item.system_id || !["system", "component"].includes(item.relationship_type)) return;
    if (!["missing", "needs_exact_model"].includes(item.manual_status)) return;
    const current = queueBySystem.get(item.system_id) || {
      system_id: item.system_id,
      system_category: item.system_category,
      normalized_name: item.system_category === "Generator / AC Power" ? "Generator" : item.system_category,
      manual_status: item.manual_status,
      factory_confirmed: true,
      missing_sources: ["owner_manual", "service_manual", "installation_manual", "warranty_source"],
      evidence_lines: [],
    };
    current.evidence_lines.push({
      id: item.id,
      factory_item_code: item.factory_item_code,
      factory_description: item.factory_description,
      relationship_type: item.relationship_type,
    });
    if (item.manual_status === "needs_exact_model") current.manual_status = "needs_exact_model";
    queueBySystem.set(item.system_id, current);
  });
  return [...queueBySystem.values()];
}

export function getTiaraKf018EvidenceForQuery(query, lines = tiaraKf018FactoryLines) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return [];

  const aliases = {
    generator: ["generator", "onan", "oil changer"],
    electronics: ["electronics", "garmin", "radar", "flir", "starlink", "antenna", "navigation", "camera"],
    propulsion: ["propulsion", "mercury", "verado", "engine", "outboard", "joystick"],
    gyro: ["gyro", "seakeeper", "stabilization"],
    stabilizer: ["gyro", "seakeeper", "stabilization", "zipwake", "trim tabs"],
    cockpit: ["cockpit", "lounge", "sunshade", "rod holders", "teak", "aft station"],
    interior: ["interior", "fabric", "upholstery", "solid surface", "coastal", "aurora"],
    paint: ["paint", "hull color", "bootline", "bottom paint"],
  };

  const terms = new Set(q.split(/[^a-z0-9.]+/).filter(Boolean));
  Object.entries(aliases).forEach(([key, values]) => {
    if (q.includes(key)) values.forEach((value) => terms.add(value));
  });

  return lines.filter((item) => {
    const haystack = [
      item.factory_item_code,
      item.factory_description,
      item.normalized_name,
      item.system_category,
      item.manufacturer,
      item.model,
      item.product_family,
      item.relationship_type,
      item.raw_source_text,
    ].filter(Boolean).join(" ").toLowerCase();

    return [...terms].some((term) => haystack.includes(term));
  });
}

export function answerTiaraKf018Question(query) {
  const evidence = getTiaraKf018EvidenceForQuery(query);
  if (!evidence.length) {
    return {
      answer: "I do not have factory-work-order evidence for that on KF018 yet.",
      confidence: "unmapped",
      evidence: [],
    };
  }

  const mapped = evidence.filter((item) => item.mapping_status === "mapped");
  const needsReview = evidence.filter((item) => item.mapping_status === "needs_review");
  const systems = [...new Set(evidence.map((item) => item.system_category).filter(Boolean))];

  return {
    answer: `${evidence.length} KF018 factory line${evidence.length === 1 ? "" : "s"} match this question across ${systems.join(", ")}. ${mapped.length} are mapped and ${needsReview.length} need review.`,
    confidence: needsReview.length ? "needs_review" : mapped.length === evidence.length ? "mapped" : "partially_mapped",
    evidence: evidence.map((item) => ({
      factory_item_code: item.factory_item_code,
      factory_description: item.factory_description,
      normalized_name: item.normalized_name,
      system_category: item.system_category,
      relationship_type: item.relationship_type,
      mapping_status: item.mapping_status,
      source_role: item.source_role,
    })),
  };
}

export const tiaraKf018FactoryBuild = {
  build_key: TIARA_KF018_BUILD_KEY,
  exact_build_key: TIARA_KF018_BUILD_KEY,
  template_key: TIARA_56_LS_TEMPLATE_KEY,
  catalog_template: tiara56LsCatalogTemplate,
  work_order: tiaraKf018WorkOrder,
  public_model_context: tiara56LsPublicModelContext,
  line_items: tiaraKf018FactoryLines,
  systems: tiaraKf018Systems,
  manual_queue: getTiaraKf018ManualQueue(),
};

export const tiaraExactFactoryBuilds = [
  tiaraKf018FactoryBuild,
];

export function getTiaraExactFactoryBuild({ templateKey, buildKey = null, hullNumber = null, hin = null } = {}) {
  const normalizedTemplateKey = String(templateKey || "").trim().toLowerCase();
  const normalizedBuildKey = String(buildKey || "").trim().toLowerCase();
  const normalizedHull = String(hullNumber || hin || "").trim().toUpperCase();

  return tiaraExactFactoryBuilds.find((build) => {
    if (normalizedTemplateKey && String(build.template_key || build.catalog_template?.template_key || "").toLowerCase() !== normalizedTemplateKey) {
      return false;
    }

    if (normalizedBuildKey) {
      return [build.build_key, build.exact_build_key, build.work_order?.build_code]
        .filter(Boolean)
        .map((value) => String(value).toLowerCase())
        .includes(normalizedBuildKey);
    }

    if (normalizedHull) {
      return [build.work_order?.hull_number, build.work_order?.hin]
        .filter(Boolean)
        .map((value) => String(value).toUpperCase())
        .includes(normalizedHull);
    }

    return false;
  }) || null;
}

export function getDefaultTiaraExactFactoryBuildForTemplate(templateKey) {
  const normalizedTemplateKey = String(templateKey || "").trim().toLowerCase();
  return tiaraExactFactoryBuilds.find((build) => (
    String(build.template_key || build.catalog_template?.template_key || "").toLowerCase() === normalizedTemplateKey
  )) || null;
}
