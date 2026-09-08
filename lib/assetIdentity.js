function firstPresent(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

export function assetKacId(asset = {}) {
  const identity = asset?.identity || {};
  const exact = asset?.exact_build || {};
  const workOrder = asset?.work_order || asset?.extra_metadata?.work_order || {};
  const keeprLink = asset?.keepr_link || asset?.keeprLink || {};

  return firstPresent(
    asset?.kac_id,
    asset?.kacId,
    asset?.kac,
    identity?.kac_id,
    identity?.kac,
    exact?.kac_id,
    exact?.published_kac,
    workOrder?.kac_id,
    keeprLink?.kac_id,
    keeprLink?.address
  );
}

export function assetHin(asset = {}) {
  const identity = asset?.identity || {};
  const exact = asset?.exact_build || {};
  const workOrder = asset?.work_order || asset?.extra_metadata?.work_order || {};

  return firstPresent(
    identity?.hin,
    identity?.hull_number,
    exact?.hin,
    exact?.hull_number,
    asset?.hin,
    asset?.hull_number,
    asset?.serial_number,
    asset?.vin,
    workOrder?.hin,
    workOrder?.hull_number
  );
}

export function assetBuildCode(asset = {}) {
  const identity = asset?.identity || {};
  const exact = asset?.exact_build || {};
  const workOrder = asset?.work_order || asset?.extra_metadata?.work_order || {};

  return firstPresent(
    exact?.build_key,
    exact?.build_code,
    identity?.build_code,
    asset?.build_code,
    asset?.extra_metadata?.build_code,
    workOrder?.build_code
  );
}
