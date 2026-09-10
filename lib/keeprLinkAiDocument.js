function safeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compactValue(value) {
  if (value == null || value === "") return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(compactValue).filter(Boolean).join(", ");
  if (typeof value === "object") {
    const preferred = [
      value.name,
      value.title,
      value.label,
      value.display_name,
      value.value,
      value.status,
    ].map(compactValue).find(Boolean);
    if (preferred) return preferred;
    return Object.entries(value)
      .filter(([, child]) => child != null && child !== "")
      .slice(0, 5)
      .map(([key, child]) => `${key}: ${compactValue(child)}`)
      .filter(Boolean)
      .join("; ");
  }
  return "";
}

function fieldList(fields) {
  const rows = Object.entries(fields || {})
    .map(([label, value]) => [label, compactValue(value)])
    .filter(([, value]) => value);

  if (!rows.length) return "<p>None established in this projection.</p>";

  return `<dl>${rows
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("")}</dl>`;
}

function listItems(items, renderItem) {
  const safeItems = asArray(items).filter(Boolean);
  if (!safeItems.length) return "<p>None included in this projection.</p>";
  return `<ul>${safeItems.map((item) => `<li>${renderItem(asObject(item))}</li>`).join("")}</ul>`;
}

function titleForResource(resource) {
  return (
    safeString(resource.title) ||
    safeString(resource.name) ||
    safeString(resource.resource_title) ||
    safeString(resource.attachment_title) ||
    "Untitled resource"
  );
}

function renderFacts(facts) {
  const obj = asObject(facts);
  if (!Object.keys(obj).length) return "";
  return `<h4>Facts</h4>${fieldList(obj)}`;
}

function renderClaims(claims) {
  const safeClaims = asArray(claims);
  if (!safeClaims.length) return "";
  return `<h4>Claims</h4>${listItems(safeClaims, (claim) => {
    const statement = compactValue(claim.statement || claim.claim || claim.title || claim);
    const provenance = compactValue(claim.provenance || claim.source || claim.reason);
    return `${escapeHtml(statement || "Operational claim")}${provenance ? `<br><small>Provenance: ${escapeHtml(provenance)}</small>` : ""}`;
  })}`;
}

function renderSystems(projection) {
  return listItems(projection.systems, (system) => {
    const heading = safeString(system.name) || safeString(system.system_type) || "Installed system";
    const facts = renderFacts(system.facts);
    const claims = renderClaims(system.claims);
    const counts = fieldList({
      "System type": system.system_type,
      "Template": compactValue(system.system_template),
      "Status": system.status,
      "Resource count": asArray(system.resource_bindings).length || system.resource_count,
      "Evidence count": asObject(system.evidence_summary).count || system.evidence_count,
      "History count": asObject(system.operational_history).total_count || system.history_count,
    });
    return `<article><h3>${escapeHtml(heading)}</h3>${counts}${facts}${claims}</article>`;
  });
}

function renderResources(projection) {
  const resources = [
    ...asArray(projection.applicable_resources).map((resource) => ({ ...asObject(resource), source_section: "applicable_resources" })),
    ...asArray(projection.resource_bindings).map((resource) => ({ ...asObject(resource), source_section: "resource_bindings" })),
  ];

  return listItems(resources, (resource) => {
    const target = compactValue(resource.target_path || resource.target_type || resource.applies_to || resource.source_section);
    const authority = compactValue(resource.authority_state || resource.authority || resource.provenance);
    return `<strong>${escapeHtml(titleForResource(resource))}</strong>${target ? `<br><small>Binding: ${escapeHtml(target)}</small>` : ""}${authority ? `<br><small>Authority: ${escapeHtml(authority)}</small>` : ""}`;
  });
}

function renderHistory(projection) {
  const history = asObject(projection.operational_history);
  const records = asArray(history.recent_records || history.records || projection.timeline);
  const summary = fieldList({
    "Total records": history.total_count || history.record_count || history.count,
    "Included records": records.length,
    "Latest service date": history.latest_service_date || history.latest_date,
  });

  return `${summary}${listItems(records, (record) => {
    const title = safeString(record.title) || safeString(record.summary) || safeString(record.event_type) || "History record";
    const date = safeString(record.occurred_at) || safeString(record.completed_at) || safeString(record.date);
    const source = compactValue(record.provenance || record.source || record.authority);
    return `<strong>${escapeHtml(title)}</strong>${date ? ` <time>${escapeHtml(date)}</time>` : ""}${source ? `<br><small>Provenance: ${escapeHtml(source)}</small>` : ""}`;
  })}`;
}

function renderRelationships(projection) {
  return listItems(projection.relationships, (relationship) => {
    const label = compactValue(relationship.organization || relationship.provider || relationship.related_org || relationship.name) || "Related organization";
    const type = compactValue(relationship.relationship_type || relationship.role || relationship.type);
    const authority = compactValue(relationship.authority_state || relationship.status || relationship.provenance);
    return `<strong>${escapeHtml(label)}</strong>${type ? `<br><small>Relationship: ${escapeHtml(type)}</small>` : ""}${authority ? `<br><small>Status/provenance: ${escapeHtml(authority)}</small>` : ""}`;
  });
}

function renderEvidence(projection) {
  const evidence = asObject(projection.evidence_summary || projection.evidence);
  return fieldList({
    "Attachment count": evidence.attachment_count || evidence.count,
    "Photo count": evidence.photo_count,
    "Document count": evidence.document_count,
    "System placement count": evidence.system_placement_count,
    "Asset placement count": evidence.asset_placement_count,
    "Policy": evidence.policy || "private URLs omitted",
  });
}

function renderGaps(projection) {
  return listItems(projection.knowledge_gaps, (gap) => {
    const label = compactValue(gap.label || gap.title || gap.gap || gap);
    const reason = compactValue(gap.reason || gap.missing_context || gap.authority_status);
    return `${escapeHtml(label || "Knowledge gap")}${reason ? `<br><small>${escapeHtml(reason)}</small>` : ""}`;
  });
}

export function renderKeeprLinkAiDocument(projection, { canonicalJsonUrl = "", canonicalPageUrl = "" } = {}) {
  const safeProjection = asObject(projection);
  const object = asObject(safeProjection.object);
  const contextSummary = asObject(safeProjection.context_summary);
  const manifestVersion = safeString(safeProjection.manifest_version) || "unknown";
  const generatedAt = safeString(safeProjection.generated_at) || new Date().toISOString();
  const kac = safeString(object.kac_id) || safeString(safeProjection.kac_id) || safeString(safeProjection.address).replace(/^\/k\//, "");
  const title = safeString(object.name) || safeString(safeProjection.title) || kac || "KeeprLINK Context";
  const identity = {
    "KAC": kac,
    "Name": title,
    "Type": object.type || safeProjection.object_type,
    "Address": object.address || safeProjection.address,
    "Stable address": object.stable_address,
    "Manifest version": manifestVersion,
    "Generated at": generatedAt,
  };

  const json = JSON.stringify(safeProjection, null, 2);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noarchive">
  <title>${escapeHtml(title)} - Keepr AI Context</title>
  <style>
    body { margin: 0; background: #f6f8fb; color: #121826; font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 1040px; margin: 0 auto; padding: 32px 20px 56px; }
    header, section { background: #fff; border: 1px solid #d9e1ec; border-radius: 8px; padding: 20px; margin: 0 0 16px; }
    h1, h2, h3, h4 { margin: 0 0 8px; line-height: 1.2; }
    h1 { font-size: 32px; }
    h2 { font-size: 20px; border-bottom: 1px solid #e7edf5; padding-bottom: 8px; }
    h3 { font-size: 17px; }
    small, .muted { color: #576274; }
    dl { display: grid; grid-template-columns: minmax(150px, 240px) 1fr; gap: 6px 14px; margin: 12px 0; }
    dt { color: #465266; font-weight: 700; }
    dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
    ul { padding-left: 22px; }
    li { margin: 0 0 10px; }
    article { border-top: 1px solid #e7edf5; padding-top: 14px; margin-top: 14px; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 16px; }
    a { color: #1f6fe5; }
  </style>
</head>
<body>
<main>
  <header>
    <p class="muted">KeeprLINK AI-readable governed context</p>
    <h1>${escapeHtml(title)}</h1>
    <p>This document renders the same governed <code>llm_context</code> projection as the canonical JSON endpoint. It does not create another ownership model.</p>
    ${canonicalJsonUrl ? `<p>Canonical JSON: <a href="${escapeHtml(canonicalJsonUrl)}">${escapeHtml(canonicalJsonUrl)}</a></p>` : ""}
    ${canonicalPageUrl ? `<p>Public Keepr page: <a href="${escapeHtml(canonicalPageUrl)}">${escapeHtml(canonicalPageUrl)}</a></p>` : ""}
  </header>
  <section id="identity"><h2>Identity</h2>${fieldList(identity)}</section>
  <section id="context-summary"><h2>Context Summary</h2>${fieldList(contextSummary)}</section>
  <section id="systems"><h2>Systems</h2>${renderSystems(safeProjection)}</section>
  <section id="resources"><h2>Resources</h2>${renderResources(safeProjection)}</section>
  <section id="operational-history"><h2>Operational History</h2>${renderHistory(safeProjection)}</section>
  <section id="relationships"><h2>Relationships</h2>${renderRelationships(safeProjection)}</section>
  <section id="evidence"><h2>Evidence</h2>${renderEvidence(safeProjection)}</section>
  <section id="gaps"><h2>Gaps</h2>${renderGaps(safeProjection)}</section>
  <section id="facts-vs-claims"><h2>Facts vs Claims</h2><p>Facts are Keepr-established canonical values. Claims are derived operational statements and must retain provenance. Missing values are not facts.</p></section>
  <section id="raw-json"><h2>Raw JSON</h2><pre>${escapeHtml(json)}</pre></section>
</main>
</body>
</html>`;
}
