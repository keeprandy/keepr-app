// data/vehicles/2024_Yamaha_Tracer_GT.js
// Keepr-aware profile for Andy's 2024 Yamaha Tracer 9 GT+
// Safe to import into your existing VEHICLES array without changing any UI.

export const YAMAHA_TRACER_2024 = {
  id: "tracer-2024",
  type: "vehicle",

  // What shows up in the UI today
  name: "2024 Yamaha Tracer 9 GT+",
  nickname: "Tracer 9 GT+",
  category: "Sport Touring",
  location: "Brighton, MI",

  // TODO: point these to real images in your assets folder
  image: require("../assets/vehicles/vehicle_yamaha_tracer.jpg"),
  photos: [
    require("../assets/vehicles/vehicle_yamaha_tracer.jpg"),
    // require("../assets/vehicles/tracer_2024_side.jpg"),
    // require("../assets/vehicles/tracer_2024_cockpit.jpg"),
  ],

  // Core ownership data
  year: 2024,
  make: "Yamaha",
  model: "Tracer 9 GT+",
  vin: null, // fill in later if you want
  purchaseDate: null, // e.g. "2025-03-15"
  purchasePrice: null, // e.g. "$16,500"
  dealer: "Local Yamaha dealer (TBD)",

  // Simple fields your current UI can already use
  odometerMiles: 0, // starting point – update as needed
  estimatedValue: null,
  tags: ["motorcycle", "sport touring", "primary bike"],

  // Usage + story: this is what VehicleStoryScreen can render as copy
  usageProfile: {
    primaryUse: "Sport-touring and weekend trips",
    secondaryUse: "Day rides and exploration around Michigan",
    notes: [
      "Set up as a long-distance sport-touring machine with comfort and safety as priorities.",
      "Intended for a mix of local rides and multi-day trips, with an emphasis on staying ahead of wear items like tires, chain, and brakes.",
    ],
  },

  // Factory-level base knowledge as it rolls off the line
  baseSpec: {
    engine: "890cc inline 3-cylinder",
    power: "Approx. 117 hp (market-dependent)",
    transmission: "6-speed with assist & slipper clutch",
    driveType: "Chain drive",
    fuelCapacity: "Approx. 5.0 gal (19 L)",
    curbWeight: "Sport-touring middleweight (reference owner’s manual for exact spec)",
    electronics: [
      "Adaptive cruise control with front radar",
      "IMU-based cornering ABS and traction control",
      "Electronically controlled suspension",
      "Multiple ride modes and quickshifter (up/down)",
      "TFT dash with integrated ride settings",
    ],
    serviceIntervals: {
      // These are directional; real logic should reference the OEM schedule
      oilChange: "Approx. every 4,000–6,000 miles or annually (follow Yamaha manual)",
      valveCheck: "Typically around 26,600 miles (confirm in service manual)",
      chainCare: "Inspect and lube every 500–700 miles or after wet/dirty rides",
      brakeFluid: "Every 2 years (or per manual)",
    },
  },

  // This is the seed for the mAIntAIn Agent – core philosophy + preferences
  maintainProfile: {
    maintenancePhilosophy:
      "Stay comfortably ahead of wear items, protect electronics and safety systems, and keep the bike trip-ready for sport-touring and weekend rides.",

    focusAreas: [
      "Chain tension and lubrication – frequent mixed riding and highway miles.",
      "Tires – sport-touring rubber with attention to flat-spotting from highway miles.",
      "Front and rear electronic suspension – log any changes, faults, or unusual behavior.",
      "Brakes – pads and fluid, especially before and after loaded touring.",
      "Electronics and radar systems – capture any warnings or irregular behavior.",
    ],

    ownerPreferences: {
      style: "Mix of dealer service and light DIY.",
      diyScope: [
        "Chain cleaning and lubrication",
        "Basic inspections and pre-ride checks",
        "Accessory installs (top box, luggage, protection, mounts)",
      ],
      proScope: [
        "Major scheduled services",
        "Valve checks and engine internals",
        "Diagnostics, firmware updates, and electronics issues",
      ],
      scheduling: {
        wantsCalendarSync: true,
        cadence:
          "Pre-season check, post-season review, and mileage-based reminders for chain, oil, and tires.",
      },
    },

    // Early "agent fuel" – these tasks don’t have to be wired to UI yet.
    starterTasks: [
      {
        id: "tracer-30-day-check",
        label: "30-day post-purchase setup & safety check",
        description:
          "Walk around the bike, check torque on key fasteners, verify chain slack, tire pressures, controls, and lights. Log any adjustments or issues.",
        trigger: {
          type: "relativeToPurchase",
          offsetDays: 30,
        },
      },
      {
        id: "tracer-chain-maintenance",
        label: "Chain clean & lube",
        description:
          "Inspect, clean, and lube the chain after every few rides or roughly every 500–700 miles, more often after rain or dirty conditions.",
        trigger: {
          type: "mileageInterval",
          miles: 600,
        },
      },
      {
        id: "tracer-pre-trip-check",
        label: "Pre-trip touring check",
        description:
          "Before any multi-day trip, inspect tire tread and pressures, brakes, fluids, lights, luggage mounting points, and electronics. Log a pre-trip condition note.",
        trigger: {
          type: "manual",
          context: "Before multi-day trip",
        },
      },
    ],
  },

  // This is what can be shown in your existing VehicleStoryScreen today
  notes:
    "2024 Yamaha Tracer 9 GT+ configured as a sport-touring platform. Focus is on comfort, safety, and reliability for weekend rides and longer trips. This profile includes factory-level specs plus a Maintain-aware plan that can evolve as accessories, mileage, and service history are added.",
};
