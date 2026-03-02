// utils/maintainRules.js

export const MAINTENANCE_RULES = {
  vehicle: [
    {
      id: "oil-change",
      label: "Oil & filter change",
      cadence: "Every 5,000–7,500 miles or annually",
    },
    {
      id: "tire-rotation",
      label: "Tire rotation & pressure check",
      cadence: "Every 6 months",
    },
    {
      id: "brake-check",
      label: "Brake inspection",
      cadence: "Annually or if you notice changes",
    },
  ],
  boat: [
    {
      id: "winterize",
      label: "Winterization",
      cadence: "Every fall before freezing temps",
    },
    {
      id: "oil-change",
      label: "Engine oil & gear lube",
      cadence: "Every 50–100 hours or each season",
    },
    {
      id: "impeller",
      label: "Impeller / cooling system check",
      cadence: "Every 2–3 seasons",
    },
  ],
  home: [
    {
      id: "furnace-service",
      label: "Furnace service & filter",
      cadence: "Annually before heating season",
    },
    {
      id: "ac-service",
      label: "A/C service & coil clean",
      cadence: "Annually before cooling season",
    },
    {
      id: "roof-check",
      label: "Roof & gutter inspection",
      cadence: "Annually and after major storms",
    },
  ],
};

export function getRulesForAsset(asset) {
  if (!asset?.type) return [];
  return MAINTENANCE_RULES[asset.type] || [];
}
