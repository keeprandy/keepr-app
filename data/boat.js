// data/boat.js

export const boat = {
  id: "boat-1",
  name: "Bennington Tri-Toon",
  role: "Lake Boat",
  type: "boat",

  // ✅ Correct path to your new folder + filename
  image: require("../assets/boats/boat_bennington_hero.jpg"),

  photos: [
    require("../assets/boats/boat_bennington_hero.jpg"),
    require("../assets/boats/boat_bennington_cockpit.jpg"),
    require("../assets/boats/boat_bennington_engine.jpg"),
  ],

  status: "In the water",
  statusLevel: "ok",
  nextService: "Spring 2026 – tune-up & impeller",
  lastService: "Fall 2025 – winterization at Wilson Marine",
  usage: "Weekends + holidays",
  notes: "Primary family boat. Lives on the lift.",
  tagStatus: "KeeprTag planned",
  tagBattery: null,
};
