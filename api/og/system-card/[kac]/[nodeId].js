import {
  buildDescription,
  buildKeeprCardElement,
  getRequestBaseUrl,
  safeString,
  sendImageResponse,
} from "../../_shared.js";

function titleForNode(node) {
  const name = safeString(node?.display_name || node?.name) || "System Story";
  const manufacturer = safeString(node?.identity?.manufacturer);
  if (!manufacturer || name.toLowerCase().includes(manufacturer.toLowerCase())) {
    return name;
  }
  return `${manufacturer} ${name}`;
}

function descriptionForPayload(payload) {
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
  const response = await fetch(
    `${baseUrl}/api/public-node/${encodeURIComponent(kac)}/${encodeURIComponent(nodeId)}`,
    { headers: { "user-agent": "KeeprOG/1.0" } }
  );
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null);
  return payload?.ok ? payload : null;
}

export default async function handler(req, res) {
  const rawKac = req.query?.kac;
  const rawNodeId = req.query?.nodeId;
  const kac = Array.isArray(rawKac) ? rawKac[0] : rawKac;
  const nodeId = Array.isArray(rawNodeId) ? rawNodeId[0] : rawNodeId;

  let title = "Keepr System Story";
  let description = "A public Keepr System Story with documented ownership continuity.";
  let imageUrl = null;
  let footer = "A public system story connected to its parent Keepr asset.";

  try {
    const payload = kac && nodeId ? await resolvePublicNode(req, kac, nodeId) : null;
    if (payload?.node) {
      title = titleForNode(payload.node);
      description = descriptionForPayload(payload);
      imageUrl = safeString(payload.node.hero_url) || null;
      footer = "Documented system identity, service context, and ownership continuity.";
    }
  } catch (_) {
    imageUrl = null;
  }

  return sendImageResponse(
    res,
    buildKeeprCardElement({
      eyebrow: "Keepr Enabled System",
      title,
      description,
      imageUrl,
      imageFit: "cover",
      badge: "Open System Story",
      footer,
    })
  );
}
