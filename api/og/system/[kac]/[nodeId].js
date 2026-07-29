import {
  buildDescription,
  buildOgHtml,
  canonicalUrl,
  getRequestBaseUrl,
  requestAbsoluteUrl,
  safeString,
} from "../../_shared.js";

function systemTitle(node) {
  const name = safeString(node?.display_name || node?.name) || "System Story";
  const manufacturer = safeString(node?.identity?.manufacturer);
  if (!manufacturer || name.toLowerCase().includes(manufacturer.toLowerCase())) {
    return name;
  }
  return `${manufacturer} ${name}`;
}

function systemDescription(payload) {
  const parent = safeString(payload?.asset?.name);
  const pro = safeString(payload?.connectors?.keepr_pros?.[0]?.name);
  return buildDescription(
    [
      parent ? `Connected to ${parent}.` : null,
      pro ? `Supported by ${pro}.` : null,
    ],
    "A public Keepr System Story with documented ownership continuity."
  );
}

async function resolvePublicNode(req, kac, nodeId) {
  const baseUrl = getRequestBaseUrl(req);
  const url = `${baseUrl}/api/public-node/${encodeURIComponent(kac)}/${encodeURIComponent(
    nodeId
  )}`;
  const response = await fetch(url, {
    headers: { "user-agent": "KeeprOG/1.0" },
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.ok ? payload : null;
}

export default async function handler(req, res) {
  const rawKac = req.query?.kac;
  const rawNodeId = req.query?.nodeId;
  const kac = Array.isArray(rawKac) ? rawKac[0] : rawKac;
  const nodeId = Array.isArray(rawNodeId) ? rawNodeId[0] : rawNodeId;
  const resourcePath = `/k/${encodeURIComponent(kac || "")}/n/${encodeURIComponent(
    nodeId || ""
  )}`;
  const shareUrl = canonicalUrl(resourcePath);
  const image = requestAbsoluteUrl(req, `/og/system/${encodeURIComponent(kac || "")}/${encodeURIComponent(
    nodeId || ""
  )}.png`);

  let title = "Keepr System Story";
  let description = "A public Keepr System Story with documented ownership continuity.";

  try {
    const payload = kac && nodeId ? await resolvePublicNode(req, kac, nodeId) : null;
    if (payload?.node) {
      title = systemTitle(payload.node);
      description = systemDescription(payload);
    }
  } catch (_) {
    title = "Keepr System Story";
  }

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, max-age=60, s-maxage=300");
  return res.status(200).send(
    buildOgHtml({
      title,
      description,
      url: shareUrl,
      image,
    })
  );
}
