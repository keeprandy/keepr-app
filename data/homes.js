// data/homes.js
// Keepr demo homes for the MVP:
// 1. Primary Home
// 2. Secondary Home (Lake Home)
// 3. Rental Home

export const homes = [
  {
    id: "home-primary",
    type: "home",

    name: "Primary Home",
    role: "Main residence",
    location: "Brighton, MI",

    // Uses existing image
    image: require("../assets/home/home_exterior.jpg"),
    photos: [require("../assets/home/home_exterior.jpg")],

    status: "Occupied",
    statusLevel: "ok",
    nextService: "Annual 120-point inspection – Spring 2026",
    lastService: "Fall 2025 – furnace service & gutter cleaning",
    usage: "Year-round family home.",

    notes:
      "Primary residence. The 120-point checklist is the baseline for staying ahead of big-ticket systems and documenting a clean story for future valuation.",

    isPrimary: true,

    maintainProfile: {
      maintenancePhilosophy:
        "Treat the home like a portfolio of systems—roof, water, HVAC, structure, safety—and run a consistent annual + seasonal checklist.",
      focusAreas: [
        "Roof & exterior envelope",
        "HVAC service & filter discipline",
        "Water management (foundation, sump, downspouts)",
        "Electrical panel & life-safety devices",
        "Bathroom, kitchen & interior finish health",
      ],
      starterTasks: [
        {
          id: "primary-annual-120pt",
          label: "Annual 120-point home inspection",
          description:
            "Full walk of exterior, mechanicals, safety, and interior systems. Log issues before they become expensive problems.",
          trigger: { type: "timeInterval", months: 12 },
          checklist: [
            { id: "roof-shingles", label: "Inspect roof shingles & flashing." },
            { id: "gutters", label: "Clean gutters & verify downspout drainage." },
            { id: "siding-trim", label: "Check siding, trim & caulking." },
            { id: "grading", label: "Ensure grading slopes away from foundation." },
            { id: "filters", label: "Replace HVAC filters." },
            { id: "sump-test", label: "Test sump pump & discharge path." },
            { id: "smoke-co", label: "Test smoke & CO detectors." },
            { id: "bath-caulk", label: "Check bath/shower caulk & grout." },
            {
              id: "kitchen-plumbing",
              label: "Inspect kitchen sink cabinet & supply lines.",
            },
            {
              id: "interior-walk",
              label: "Walk floors and doors for movement & sticking.",
            },
          ],
        },
        {
          id: "primary-fall-prep",
          label: "Fall pre-winter prep",
          description:
            "Protect against cold, water, and air leaks before freezing temps arrive.",
          trigger: { type: "seasonal", season: "fall" },
        },
        {
          id: "primary-spring-check",
          label: "Spring post-winter check",
          description:
            "Scan for freeze damage, water issues, and return systems to spring operation.",
          trigger: { type: "seasonal", season: "spring" },
        },
      ],
    },

    serviceHistory: [
      {
        id: "primary-svc-1",
        date: "2025-10-10",
        type: "pro",
        title: "Furnace safety service",
        provider: "Local HVAC KeeprPro",
        cost: "$220",
        notes: "Checked burners, exchanger, CO levels, filter size recorded.",
      },
      {
        id: "primary-svc-2",
        date: "2025-10-18",
        type: "diy",
        title: "Gutter cleaning & roof scan",
        provider: "Owner DIY",
        cost: "$0",
        notes: "Cleared gutters. Quick visual inspection of roof.",
      },
    ],
  },

  {
    id: "home-secondary",
    type: "home",

    name: "Secondary Home",
    role: "Lake home",
    location: "Higgins Lake, MI",

    // Same placeholder image for now
    image: require("../assets/home/home_lake_exterior.jpg"),
    photos: [require("../assets/home/home_lake_exterior.jpg")],

    status: "Seasonal use",
    statusLevel: "ok",
    nextService: "Spring 2026 – open-up routine",
    lastService: "Fall 2025 – full close-down",
    usage: "Summer and holiday property.",

    notes:
      "Seasonal lake home. Key focus is winterization, dewinterization, and preventing moisture/pest issues.",

    maintainProfile: {
      maintenancePhilosophy:
        "Seasonal systems need predictable open/close routines. Water, cold, pests, and humidity are the main threats.",
      focusAreas: [
        "Winterization & dewinterization",
        "Moisture & ventilation",
        "Deck, dock, and exterior safety",
      ],
      starterTasks: [
        {
          id: "secondary-fall-close",
          label: "Fall close-down",
          description: "Shut off water, blow out lines, secure for winter.",
          trigger: { type: "seasonal", season: "fall" },
        },
        {
          id: "secondary-spring-open",
          label: "Spring open-up",
          description:
            "Restore water, walk the exterior, test systems for winter damage.",
          trigger: { type: "seasonal", season: "spring" },
        },
      ],
    },

    serviceHistory: [
      {
        id: "secondary-svc-1",
        date: "2025-10-05",
        type: "pro",
        title: "Fall close-down",
        provider: "Local KeeprPro",
        cost: "$350",
        notes:
          "Lines blown out, traps treated, exterior walk completed, dock inspected.",
      },
    ],
  },

  {
    id: "home-rental",
    type: "home",

    name: "Rental Home",
    role: "Investment property",
    location: "Brighton, MI",

    // Same placeholder image for now
    image: require("../assets/home/home_rental_exterior.jpg"),
    photos: [require("../assets/home/home_rental_exterior.jpg")],

    status: "Tenant occupied",
    statusLevel: "watch",
    nextService: "Quarterly walkthrough – Q1 2026",
    lastService: "Q4 2025 – walkthrough & filter change",
    usage: "Long-term tenant. Standard lease.",

    notes:
      "The Keepr value here is the landlord playbook: quarterly walkthroughs, documented issues, fast safety checks, and a reliable network of Keepr Pros.",

    maintainProfile: {
      maintenancePhilosophy:
        "Treat rental properties like portfolio assets: predictable walkthroughs, documented safety, and quick mitigation of water issues.",
      focusAreas: [
        "Quarterly interior/exterior walkthroughs",
        "Leak & moisture detection",
        "Life-safety checks for compliance",
      ],
      starterTasks: [
        {
          id: "rental-quarterly-walk",
          label: "Quarterly walkthrough",
          description:
            "Document condition, check for leaks, test detectors, and verify tenant requests.",
          trigger: { type: "timeInterval", months: 3 },
        },
      ],
    },

    serviceHistory: [
      {
        id: "rental-svc-1",
        date: "2025-11-01",
        type: "diy",
        title: "Q4 walkthrough & filter change",
        provider: "Owner DIY",
        cost: "$35",
        notes:
          "Changed furnace filter, checked sinks, tested alarms, marked cosmetic items for spring.",
      },
    ],
  },
];
