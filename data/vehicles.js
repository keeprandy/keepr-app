// data/vehicles.js
// Real-world Keepr demo vehicles for Andy:
// - 2000 Porsche Boxster S (986)
// - 2024 Yamaha Tracer 9 GT+
//
// Safe for your current UI: it still has id/name/type/image/notes/etc.
// Extra fields (baseSpec, usageProfile, maintainProfile, starterTasks) are
// for mAIntAIn and can be ignored by existing screens until you're ready.

export const VEHICLES = [
  {
    id: "boxster-2000",
    type: "vehicle",

    // What shows in the Garage / VehicleStoryScreen
    name: "2000 Porsche Boxster S",
    nickname: "Boxster S",
    category: "Sports Car",
    location: "Brighton, MI",

    image: require("../assets/vehicles/vehicle_porsche_hero.jpg"),
    photos: [
      require("../assets/vehicles/vehicle_porsche_hero.jpg"),
      // require("../assets/vehicles/boxster_2000_side.jpg"),
      // require("../assets/vehicles/boxster_2000_interior.jpg"),
    ],

    year: 2000,
    make: "Porsche",
    model: "Boxster S (986)",
    vin: null, // fill in later if you’d like
    purchaseDate: null, // e.g. "2015-06-15"
    purchasePrice: null,
    odometerMiles: null, // e.g. 92000
    estimatedValue: null,
    tags: ["convertible", "sports car", "analog", "modern classic"],

    // How you use it – easy for VehicleStoryScreen to turn into copy
    usageProfile: {
      primaryUse: "Fun drives and fair-weather cruising",
      secondaryUse: "Weekend trips and back-road runs",
      notes: [
        "25-year-old analog Porsche used for enjoyment, not commuting.",
        "Driven seasonally in good weather and stored during winter.",
      ],
    },

    // Factory-level + platform-level info
    baseSpec: {
      engine: "3.2L flat-6 (M96)",
      power: "Approx. 250 hp",
      transmission: "6-speed manual (typical for Boxster S of this era)",
      driveType: "RWD, mid-engine",
      platform: "986 Boxster S",
      knownIssues: [
        "Original IMS bearing vulnerability on early M96 engines.",
        "Rear main seal (RMS) seepage potential.",
        "Coolant expansion tank cracks.",
        "Aging suspension bushings and mounts.",
      ],
      serviceIntervals: {
        oilChange:
          "Every 5,000–7,500 miles or annually with quality synthetic oil.",
        coolantSystem:
          "Inspect hoses, expansion tank, and water pump regularly on higher-mileage cars.",
        brakeFluid: "Every 2 years.",
        gearboxOil:
          "Recommended refresh on older cars even if not in manual schedule.",
      },
    },

    // This is the seed for the Boxster’s “Maintain Agent”
    maintainProfile: {
      maintenancePhilosophy:
        "Preserve a modern-classic sports car by staying ahead of age-related issues, protecting the engine, and keeping suspension and braking tight and confidence-inspiring.",

      focusAreas: [
        "IMS bearing – VERIFY status once, then monitor for symptoms rather than panic.",
        "Cooling system – tank, water pump, and hoses on a 25-year-old Porsche.",
        "Oil leaks – RMS and cam cover areas; track trends over time, not perfection.",
        "Suspension – bushings, control arms, and shocks for crisp handling.",
        "Top and seals – prevent water ingress and interior damage.",
      ],

      historyFlags: {
        imsBearingStatus: "Replaced",
        imsNotes:
          "IMS bearing replacement documented; monitor for noise or contamination but treat as addressed.",
      },

      ownerPreferences: {
        style:
          "Preservation-focused; willing to invest selectively to keep the car tight and enjoyable.",
        diyScope: [
          "Basic checks and fluid top-offs",
          "Cosmetic care and interior upkeep",
        ],
        proScope: [
          "Engine-related work (IMS, RMS, cooling system)",
          "Suspension refresh and alignment",
          "Brake system overhaul and diagnostics",
        ],
        scheduling: {
          wantsCalendarSync: true,
          cadence:
            "Seasonal pre-storage and post-storage checks, plus mileage-based service reminders.",
        },
      },

      starterTasks: [
        {
          id: "boxster-seasonal-pre-storage",
          label: "Pre-storage inspection",
          description:
            "Check fluids, tire pressures, top condition, and look for obvious leaks before winter storage. Log odometer and any issues to address in spring.",
          trigger: {
            type: "seasonal",
            season: "fall",
          },
          checklist: [
            {
              id: "boxster-pre-fluids",
              label: "Check engine oil, coolant level, and brake fluid condition.",
            },
            {
              id: "boxster-pre-leaks",
              label: "Look for obvious leaks under the car and around the engine.",
            },
            {
              id: "boxster-pre-tires",
              label: "Set tire pressures for storage and inspect tread for uneven wear.",
            },
            {
              id: "boxster-pre-wash",
              label: "Wash and dry the car, including wheels and wheel arches.",
            },
            {
              id: "boxster-pre-interior",
              label:
                "Clean interior, remove trash, and check for any moisture or musty smells.",
            },
            {
              id: "boxster-pre-top",
              label:
                "Inspect convertible top, seals, and drains for cracks, tears, or blockages.",
            },
            {
              id: "boxster-pre-battery",
              label:
                "Connect a battery maintainer or prepare to disconnect the battery for storage.",
            },
          ],
        },
        {
          id: "boxster-seasonal-post-storage",
          label: "Post-storage shakedown",
          description:
            "After winter, inspect for leaks, flat-spots, and battery health. Take a short shakedown drive and log any new noises, vibrations, or warning lights.",
          trigger: {
            type: "seasonal",
            season: "spring",
          },
          checklist: [
            {
              id: "boxster-post-visual",
              label:
                "Do a full walkaround: check for new drips, fluid spots, or rodent damage.",
            },
            {
              id: "boxster-post-tires",
              label:
                "Inspect tires for flat spots or cracking; set pressures to driving spec.",
            },
            {
              id: "boxster-post-battery",
              label:
                "Confirm battery voltage/health and clean terminals if needed.",
            },
            {
              id: "boxster-post-fluids",
              label:
                "Check engine oil level, coolant level, and power steering/brake fluid.",
            },
            {
              id: "boxster-post-drive",
              label:
                "Take a short shakedown drive, listening for new noises, vibrations, or warning lights.",
            },
            {
              id: "boxster-post-log",
              label:
                "Log odometer, any issues found, and plan follow-up work if needed.",
            },
          ],
        },
        {
          id: "boxster-annual-fluid-check",
          label: "Annual oil and fluid check",
          description:
            "Verify engine oil quality/level, coolant condition and level, and brake fluid age. Consider annual oil changes regardless of mileage for preservation.",
          trigger: {
            type: "timeInterval",
            months: 12,
          },
          checklist: [
            {
              id: "boxster-annual-oil",
              label:
                "Check engine oil level and color; schedule an oil change if due by time or mileage.",
            },
            {
              id: "boxster-annual-coolant",
              label:
                "Inspect coolant color and level; look at the expansion tank for cracks or staining.",
            },
            {
              id: "boxster-annual-brake",
              label:
                "Confirm brake fluid age; bleed/flush if older than 2 years.",
            },
            {
              id: "boxster-annual-record",
              label:
                "Capture mileage, dates, and any notes into Keepr for future reference.",
            },
          ],
        },
      ],
    },

    notes:
      "2000 Porsche Boxster S (986) driven as a fair-weather sports car and modern classic. IMS bearing has been replaced, making it a stronger long-term ownership candidate. Focus is on staying ahead of age-related issues in the cooling system, suspension, and seals while keeping the driving experience sharp and enjoyable.",
  },

  {
    id: "tracer-2024",
    type: "vehicle",

    name: "2024 Yamaha Tracer 9 GT+",
    nickname: "Tracer 9 GT+",
    category: "Sport Touring",
    location: "Brighton, MI",

    image: require("../assets/vehicles/vehicle_yamaha_tracer.jpg"),
    photos: [
      require("../assets/vehicles/vehicle_yamaha_tracer.jpg"),
      // require("../assets/vehicles/tracer_2024_side.jpg"),
      // require("../assets/vehicles/tracer_2024_cockpit.jpg"),
    ],

    year: 2024,
    make: "Yamaha",
    model: "Tracer 9 GT+",
    vin: null,
    purchaseDate: null, // e.g. "2025-03-15"
    purchasePrice: null,
    odometerMiles: 0,
    estimatedValue: null,
    tags: ["motorcycle", "sport touring", "primary bike"],

    usageProfile: {
      primaryUse: "Sport-touring and weekend trips",
      secondaryUse: "Day rides and exploration around Michigan",
      notes: [
        "Set up as a long-distance sport-touring machine with comfort and safety as priorities.",
        "Intended for a mix of local rides and multi-day trips, with an emphasis on staying ahead of wear items like tires, chain, and brakes.",
      ],
    },

    baseSpec: {
      engine: "890cc inline 3-cylinder",
      power: "Approx. 117 hp (market-dependent)",
      transmission: "6-speed with assist & slipper clutch",
      driveType: "Chain drive",
      fuelCapacity: "Approx. 5.0 gal (19 L)",
      electronics: [
        "Adaptive cruise control with front radar",
        "IMU-based cornering ABS and traction control",
        "Electronically controlled suspension",
        "Multiple ride modes and quickshifter",
        "TFT dash with integrated ride settings",
      ],
      serviceIntervals: {
        oilChange:
          "Approx. every 4,000–6,000 miles or annually (follow Yamaha manual).",
        valveCheck:
          "Typically around 26,600 miles (confirm in service manual).",
        chainCare:
          "Inspect and lube every 500–700 miles or after wet/dirty rides.",
        brakeFluid: "Every 2 years (or per manual).",
      },
    },

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

    notes:
      "2024 Yamaha Tracer 9 GT+ configured as a sport-touring platform. Focus is on comfort, safety, and reliability for weekend rides and longer trips. This profile includes factory-level specs plus a Maintain-aware plan that can evolve as accessories, mileage, and service history are added.",
  },
];

