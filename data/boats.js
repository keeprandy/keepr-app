// data/boats.js

export const boats = [
  {
    id: "boat-bennington-1",
    type: "boat",

    // Core identity
    name: "Bennington Tri-Toon",
    role: "Family lake boat",

    // Status & health
    status: "In the water",
    statusLevel: "ok",
    nextService: "Spring 2026 – tune-up & impeller",
    lastService: "Fall 2025 – winterization at Wilson Marine",
    usage: "Weekends + holidays",

    // Story / notes
    notes:
      "Primary family boat. Lives on the lift. Wilson Marine handles most mechanical work.",
    location: "Home dock – Brighton Lake",

    // Keepr Tag
    tagStatus: "KeeprTag planned",
    tagBattery: null,

    // Hero image + gallery
    image: require("../assets/boats/boat_bennington_hero.jpg"),
    photos: [
      require("../assets/boats/boat_bennington_hero.jpg"),
      require("../assets/boats/boat_bennington_cockpit.jpg"),
      require("../assets/boats/boat_bennington_engine.jpg"),
    ],

    // This makes it the default boat if no id is passed
    isPrimary: true,

    // ✅ Maintain profile (feeds Maintain plan pills + detail modal)
    maintainProfile: {
      starterTasks: [
        {
          id: "spring-launch",
          label: "Spring launch & shakedown",
          description:
            "Get the Bennington ready for the new season, confirm everything works as expected, and log any issues to fix before peak use.",
          checklist: [
            { id: "sl-visual", label: "Visual walk-around for damage or loose hardware" },
            { id: "sl-battery", label: "Install / reconnect batteries and confirm charge" },
            { id: "sl-fluids", label: "Check engine oil, gear lube, and coolant (if applicable)" },
            { id: "sl-fuel", label: "Confirm fuel quality and add stabilizer if needed" },
            { id: "sl-electrical", label: "Test navigation lights, bilge pump, horn, and accessories" },
            { id: "sl-lake-test", label: "Short lake test: steering, throttle, shifting, and idle" },
          ],
        },
        {
          id: "mid-season-safety",
          label: "Mid-season safety & comfort check",
          description:
            "Half-way through the season, confirm safety gear, comfort items, and basic systems so weekends stay stress-free.",
          checklist: [
            { id: "ms-pfds", label: "Count and inspect PFDs for wear and correct sizing" },
            { id: "ms-fire", label: "Check fire extinguisher charge and accessibility" },
            { id: "ms-flares", label: "Verify flares or signaling devices are in date" },
            { id: "ms-bilge", label: "Test bilge pump operation and float switch" },
            { id: "ms-bimini", label: "Inspect bimini / canvas, zippers, and snaps" },
            { id: "ms-interior", label: "Quick interior clean and vinyl wipe-down" },
          ],
        },
        {
          id: "fall-winterization",
          label: "Fall winterization & storage",
          description:
            "Properly winterizing the boat protects the engine, interior, and gelcoat so it comes out strong in the spring.",
          checklist: [
            { id: "fw-fuel", label: "Top off fuel and add stabilizer per engine guidelines" },
            { id: "fw-flush", label: "Flush cooling system per manufacturer recommendations" },
            { id: "fw-oil", label: "Change engine oil and filter (if due)" },
            { id: "fw-gear-lube", label: "Inspect and change lower unit gear lube (if due)" },
            { id: "fw-batteries", label: "Remove or disconnect batteries and store on maintainer" },
            { id: "fw-clean", label: "Deep clean interior, compartments, and cup holders" },
            { id: "fw-cover", label: "Cover or shrink-wrap for winter storage" },
          ],
        },
        {
          id: "holiday-ready",
          label: "Holiday weekend ready check",
          description:
            "Before a big holiday weekend, confirm everything is dialed so you’re not troubleshooting at the dock.",
          checklist: [
            { id: "hr-fuel", label: "Confirm fuel level is ready for the weekend" },
            { id: "hr-lines", label: "Check dock lines and fenders for wear and placement" },
            { id: "hr-cooler", label: "Stage cooler, trash bags, and towels" },
            { id: "hr-audio", label: "Quick audio system and Bluetooth test" },
            { id: "hr-lights", label: "Night / navigation light quick test" },
          ],
        },
      ],
    },

    // ✅ Service history (shown on “View full story” timeline)
    serviceHistory: [
      {
        id: "svc-1",
        date: "2025-10-15",
        type: "pro",
        title: "Fall winterization & storage",
        provider: "Wilson Marine",
        cost: "$480",
        notes:
          "Engine oil & filter, gear lube, fuel stabilizer, shrink wrap, indoor storage.",
      },
      {
        id: "svc-2",
        date: "2025-05-01",
        type: "pro",
        title: "Spring de-winterization & tune-up",
        provider: "Wilson Marine",
        cost: "$650",
        notes:
          "Impeller, full inspection, batteries tested, lake test before Memorial Day.",
      },
      {
        id: "svc-3",
        date: "2024-08-20",
        type: "diy",
        title: "Cleaned and treated upholstery",
        provider: "Owner DIY",
        cost: "$40",
        notes:
          "Vinyl cleaner and UV protectant. Logged to track interior condition over time.",
      },
      {
        id: "svc-4",
        date: "2024-07-04",
        type: "diy",
        title: "Prop inspection after shallow-water bump",
        provider: "Owner DIY",
        cost: "$0",
        notes:
          "Pulled the prop, checked for chips, reinstalled, and documented for resale history.",
      },
    ],
  },
];
