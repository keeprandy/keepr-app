import { Asset } from "expo-asset";

const TIARA_MEDIA = {
  banner: require("../assets/boats/tiara/tiara_oem_banner.png"),
  logo: require("../assets/boats/tiara/tiara_oem_logo.png"),
};

function bundledAssetUri(source) {
  return Asset.fromModule(source)?.uri || null;
}

export function getOrgBrandMediaFallback(workspace) {
  const text = [
    workspace?.display?.name,
    workspace?.display_name,
    workspace?.name,
    workspace?.org_name,
    workspace?.organization_name,
    workspace?.label,
    workspace?.slug,
    workspace?.organization_slug,
    workspace?.display?.slug,
  ].filter(Boolean).join(" ");

  if (!/tiara/i.test(text)) {
    return { logoUri: null, headerImageUri: null };
  }

  return {
    logoUri: bundledAssetUri(TIARA_MEDIA.logo),
    headerImageUri: bundledAssetUri(TIARA_MEDIA.banner),
  };
}
