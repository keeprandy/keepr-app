// data/homeSystems.js
// System-level view for each home in the Keepr demo.
// This file does two things:
//
// 1) Exposes HOME_MAIN for the HomeStoryScreen (primary home story)
// 2) Exposes HOME_SYSTEMS, which MyHomeSystemsScreen filters by `homeId`
//
// homeId MUST match the ids in data/homes.js:
//   - "home-primary"
//   - "home-secondary"
//   - "home-rental"

export const HOME_MAIN = {
  id: "home-primary",
  type: "home",

  name: "Primary Home",
  role: "Main residence",
  location: "Brighton, MI",

  image: require("../assets/home/home_exterior.jpg"),
  photos: [require("../assets/home/home_exterior.jpg")],

  status: "Occupied",
  statusLevel: "ok",

  notes:
    "Primary residence. This view will eventually roll up the health, value, and documentation status of all major systems in the home.",
};

// Each entry is a major system tied to a specific homeId.
export const HOME_SYSTEMS = [
  /* ===================== PRIMARY HOME – Brighton ===================== */
  {
    id: "primary-hvac",
    homeId: "home-primary",
    name: "Furnace & AC",
    type: "hvac",
    status: "healthy",
    nextService: "Annual safety & tune-up – Fall 2026",
    lastService: "Fall 2025 – furnace safety service",
  },
  {
    id: "primary-water-heater",
    homeId: "home-primary",
    name: "Water heater",
    type: "water-heater",
    status: "healthy",
    nextService: "Anode rod check – 2027",
    lastService: "2024 – flush & inspection",
  },
  {
    id: "primary-roof-envelope",
    homeId: "home-primary",
    name: "Roof & exterior envelope",
    type: "exterior",
    status: "healthy",
    nextService: "Part of annual 120-point inspection – Spring 2026",
    lastService: "2025 – gutter cleaning & roof scan",
  },
  {
    id: "primary-foundation-water",
    homeId: "home-primary",
    name: "Foundation & water management",
    type: "water-management",
    status: "healthy",
    nextService: "Sump test & drainage check – Spring 2026",
    lastService: "2025 – sump tested, downspouts verified",
  },

  /* ===================== SECONDARY HOME – LAKE ======================= */
  {
    id: "secondary-plumbing",
    homeId: "home-secondary",
    name: "Domestic plumbing",
    type: "plumbing",
    status: "healthy",
    nextService: "Spring 2026 – dewinterization & pressure check",
    lastService: "Fall 2025 – winterization & blowout",
  },
  {
    id: "secondary-hvac",
    homeId: "home-secondary",
    name: "Heating system",
    type: "hvac",
    status: "healthy",
    nextService: "Pre-winter safety check – Fall 2026",
    lastService: "Fall 2025 – basic inspection at close-down",
  },
  {
    id: "secondary-moisture",
    homeId: "home-secondary",
    name: "Moisture & ventilation",
    type: "envelope",
    status: "warning",
    nextService: "Spring 2026 – crawlspace & dehumidifier review",
    lastService: "Fall 2025 – vents checked, dehumidifier serviced",
  },
  {
    id: "secondary-dock-deck",
    homeId: "home-secondary",
    name: "Deck & dock",
    type: "exterior-structure",
    status: "healthy",
    nextService: "Spring 2026 – fastener & surface inspection",
    lastService: "2025 – boards inspected, hardware tightened",
  },

  /* ===================== RENTAL HOME – INVESTMENT ==================== */
  {
    id: "rental-hvac",
    homeId: "home-rental",
    name: "Furnace & AC",
    type: "hvac",
    status: "warning",
    nextService: "Q1 2026 – safety check & filter change",
    lastService: "Q4 2025 – walkthrough & filter change",
  },
  {
    id: "rental-plumbing",
    homeId: "home-rental",
    name: "Plumbing & leaks",
    type: "plumbing",
    status: "healthy",
    nextService: "Next quarterly walkthrough – Q1 2026",
    lastService: "Q4 2025 – sinks & traps checked",
  },
  {
    id: "rental-life-safety",
    homeId: "home-rental",
    name: "Life-safety (smoke/CO, egress)",
    type: "life-safety",
    status: "healthy",
    nextService: "Annual compliance check – Fall 2026",
    lastService: "Q4 2025 – detectors tested, batteries replaced",
  },
  {
    id: "rental-exterior",
    homeId: "home-rental",
    name: "Exterior & site",
    type: "exterior",
    status: "healthy",
    nextService: "Spring 2026 – exterior walkthrough",
    lastService: "Spring 2025 – siding & grading check",
  },
];

