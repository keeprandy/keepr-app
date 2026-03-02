import envProfiles from "../data/environment_profiles.json";

/**
 * Get an environment profile by key, with a safe fallback.
 */
export function getEnvironmentProfile(key) {
  if (!key) return null;
  return envProfiles[key] || null;
}