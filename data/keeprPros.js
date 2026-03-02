// data/keeprPros.js

export const KEEPR_PROS = [
  {
    id: "pro-wilson-marine-service",
    name: "Wilson Marine – Service",
    category: "marine",
    phone: "+1 (555) 123-4567",
    email: "service@wilsonmarine.com",
    website: "https://www.wilsonmarine.com/service",
    location: "Brighton, MI",
    notes:
      "Primary Keepr Pro for your Bennington and other rack-stored boats. Winterization, launch, and mid-season issues.",
    since: "2021",
    lastService: "Fall 2024 – Winterization + storage move",
    isFavorite: true,
    assets: ["Bennington 24' Pontoon", "Rack-stored boats"],
    serviceHistory: [
      {
        id: "svc-1",
        date: "2024-10-12",
        asset: "Bennington 24' Pontoon",
        summary: "Full winterization, fuel stabilizer, battery disconnect.",
      },
      {
        id: "svc-2",
        date: "2024-05-26",
        asset: "Bennington 24' Pontoon",
        summary: "Spring launch, basic inspection, lake test.",
      },
    ],
  },
  {
    id: "pro-all-weather-hvac",
    name: "All Weather Heating & Cooling",
    category: "home",
    phone: "+1 (555) 987-6543",
    email: "office@allweatherhvac.com",
    website: "https://www.allweatherhvac.com",
    location: "Brighton, MI",
    notes:
      "Trusted HVAC Keepr Pro for furnace and AC at home. Great at older systems and honest about replacement timing.",
    since: "2019",
    lastService: "Spring 2025 – AC tune-up",
    isFavorite: true,
    assets: ["Furnace – 4125 Flint Rd", "Central AC – 4125 Flint Rd"],
    serviceHistory: [
      {
        id: "svc-3",
        date: "2025-04-18",
        asset: "Central AC – 4125 Flint Rd",
        summary: "Pre-season AC tune-up, condensate line cleared.",
      },
      {
        id: "svc-4",
        date: "2024-11-02",
        asset: "Furnace – 4125 Flint Rd",
        summary: "Annual furnace safety inspection and cleaning.",
      },
    ],
  },
  {
    id: "pro-brighton-auto",
    name: "Brighton Auto & Tire",
    category: "vehicles",
    phone: "+1 (555) 246-8100",
    email: "service@brightonautotire.com",
    website: "https://brightonautotire.com",
    location: "Brighton, MI",
    notes:
      "Trusted local shop for everyday vehicles. Oil changes, brakes, and general diagnosis.",
    since: "2020",
    lastService: "Summer 2024 – Brake service",
    isFavorite: false,
    assets: ["2020 Honda Civic", "Family vehicles"],
    serviceHistory: [
      {
        id: "svc-5",
        date: "2024-07-09",
        asset: "2020 Honda Civic",
        summary: "Front brakes and rotors, tire rotation.",
      },
    ],
  },
  {
    id: "pro-dock-lift-co",
    name: "Lakefront Dock & Lift Co.",
    category: "outdoor",
    phone: "+1 (555) 321-4321",
    email: "info@lakefrontdocklift.com",
    website: "https://lakefrontdocklift.com",
    location: "Howell, MI",
    notes:
      "Keepr Pro for docks and lifts. Seasonal install/remove and repairs.",
    since: "2022",
    lastService: "Spring 2025 – Dock install",
    isFavorite: false,
    assets: ["Dock – Lakeside property", "Boat lift – Bennington"],
    serviceHistory: [
      {
        id: "svc-6",
        date: "2025-05-01",
        asset: "Dock – Lakeside property",
        summary: "Spring install and leveling.",
      },
    ],
  },
];

