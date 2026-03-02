/**
 * Keepr Asset Code generator
 * Example output: BOAT-2025-A7F2J9
 */

const ASSET_TYPE_PREFIX = {
  boat: "BOAT",
  auto: "AUTO",
  moto: "MOTO",
  home_system: "HOME",
  atv: "ATV",
  snow: "SNOW",
  trailer: "TRL"
};

function randomString(length = 6) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < length; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

export function generateKac(assetType) {
  const prefix = ASSET_TYPE_PREFIX[assetType] || "ASSET";
  const year = new Date().getFullYear();
  const code = randomString(6);
  return `${prefix}-${year}-${code}`;
}