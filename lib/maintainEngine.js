// lib/maintainEngine.js
// Local, rule-based "Maintain Engine v1" for Keepr.
// No network calls, just simple logic over the asset + service history.

/**
 * Simple date helpers so we don't need extra dependencies.
 */
function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function differenceInCalendarDays(a, b) {
  if (!a || !b) return 0;
  const ONE_DAY = 24 * 60 * 60 * 1000;
  const start = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const end = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((start - end) / ONE_DAY);
}

/**
 * Compute simple maintenance insights for an asset.
 *
 * @param {Object} params
 * @param {Object} params.asset - The asset row (boat, vehicle, home, etc.)
 * @param {Array} params.serviceRecords - Array of service_records rows
 * @param {Array} params.storyEvents - Array of story_events rows
 *
 * @returns {Object|null}
 */
export function computeMaintenanceInsights({
  asset,
  serviceRecords = [],
  storyEvents = [],
}) {
  if (!asset) return null;

  const today = new Date();

  // Normalize and sort service records by performed_at / created_at
  const enriched = (serviceRecords || []).map((rec) => {
    const dateRaw =
      rec.performed_at || rec.created_at || rec.inserted_at || null;
    const d = toDate(dateRaw);
    return {
      ...rec,
      _date: d,
    };
  });

  const withDate = enriched.filter((r) => r._date);
  withDate.sort((a, b) => b._date - a._date);

  const lastService = withDate[0] || null;
  const lastServiceDate = lastService ? lastService._date : null;

  const daysSinceLastService =
    lastServiceDate != null
      ? differenceInCalendarDays(today, lastServiceDate)
      : null;

  // Keyword buckets to detect last "type" of service
  const oilKeywords = ["oil", "lube", "lubrication"];
  const impellerKeywords = ["impeller"];
  const winterizeKeywords = ["winterize", "winterization"];
  const trailerKeywords = ["bearing", "hub", "trailer"];

  function findLastByKeywords(keywords) {
    const lowerKeywords = keywords.map((k) => k.toLowerCase());
    for (const rec of withDate) {
      const haystack =
        (rec.title || "").toLowerCase() +
        " " +
        (rec.notes || "").toLowerCase();
      if (lowerKeywords.some((kw) => haystack.includes(kw))) {
        return rec;
      }
    }
    return null;
  }

  const lastOil = findLastByKeywords(oilKeywords);
  const lastImpeller = findLastByKeywords(impellerKeywords);
  const lastWinterize = findLastByKeywords(winterizeKeywords);
  const lastTrailer = findLastByKeywords(trailerKeywords);

  function buildRecommendation({ label, lastRecord, idealDays }) {
    const d = lastRecord ? lastRecord._date : null;
    if (!d) {
      return {
        label,
        status: "missing",
        message: `No history found for ${label.toLowerCase()}. Consider logging a baseline service.`,
      };
    }
    const daysAgo = differenceInCalendarDays(today, d);
    const daysUntil = idealDays - daysAgo;
    let status = "ok";
    if (daysUntil <= 0) status = "overdue";
    else if (daysUntil <= 30) status = "soon";

    return {
      label,
      lastDate: d.toISOString(),
      daysAgo,
      daysUntil,
      status,
    };
  }

  const recs = [];

  // For boats, prioritize engine / trailer style recommendations
  const assetType = asset.asset_type || asset.type || "asset";
  const isBoat =
    (assetType || "").toLowerCase() === "boat" ||
    (asset.category || "").toLowerCase() === "boat";

  if (isBoat) {
    recs.push(
      buildRecommendation({
        label: "Engine oil & filter",
        lastRecord: lastOil || lastService,
        idealDays: 180, // ~6 months
      })
    );
    recs.push(
      buildRecommendation({
        label: "Impeller / cooling system check",
        lastRecord: lastImpeller || lastService,
        idealDays: 365,
      })
    );
    recs.push(
      buildRecommendation({
        label: "Trailer bearings & hubs",
        lastRecord: lastTrailer || lastService,
        idealDays: 365,
      })
    );
    recs.push(
      buildRecommendation({
        label: "Seasonal winterization",
        lastRecord: lastWinterize || lastService,
        idealDays: 365,
      })
    );
  } else {
    // Generic asset recommendations
    recs.push(
      buildRecommendation({
        label: "General inspection",
        lastRecord: lastService,
        idealDays: 365,
      })
    );
  }

  // Basic "health" heuristic – extremely simple for v1
  let healthScore = 100;
  if (!lastServiceDate) {
    healthScore = 60;
  } else if (daysSinceLastService > 365) {
    healthScore = 65;
  } else if (daysSinceLastService > 180) {
    healthScore = 75;
  } else if (daysSinceLastService > 90) {
    healthScore = 85;
  }

  // Summary headline
  let headline = "";
  if (!lastServiceDate) {
    headline = "No service history yet – start with a baseline visit.";
  } else if (daysSinceLastService <= 30) {
    headline = "Recently serviced. You're in good shape.";
  } else if (daysSinceLastService <= 180) {
    headline = "You're on track. Keep an eye on upcoming maintenance.";
  } else if (daysSinceLastService <= 365) {
    headline = "Service is aging – plan the next visit soon.";
  } else {
    headline = "Service appears overdue. Consider scheduling maintenance.";
  }

  // Top 2 actionable recs sorted by urgency
  const actionable = [...recs].sort((a, b) => {
    const ai = a.status === "overdue" ? 0 : a.status === "soon" ? 1 : 2;
    const bi = b.status === "overdue" ? 0 : b.status === "soon" ? 1 : 2;
    return ai - bi;
  });

  const topRecs = actionable.slice(0, 2);

  return {
    assetId: asset.id,
    assetType,
    lastServiceDate: lastServiceDate ? lastServiceDate.toISOString() : null,
    daysSinceLastService,
    healthScore,
    headline,
    recommendations: topRecs,
  };
}

/**
 * Generate a simple narrative summary for an asset.
 * This is deterministic and doesn't call any LLM.
 */
export function generateAssetSummary({ asset, serviceRecords = [] }) {
  if (!asset) return "";
  const today = new Date();

  const withDate = (serviceRecords || [])
    .map((rec) => {
      const dateRaw =
        rec.performed_at || rec.created_at || rec.inserted_at || null;
      const d = toDate(dateRaw);
      return { rec, d };
    })
    .filter((x) => x.d)
    .sort((a, b) => a.d - b.d);

  const totalServices = withDate.length;
  const first = withDate[0];
  const last = withDate[withDate.length - 1];

  if (!totalServices) {
    return `No maintenance has been logged for this asset yet. Start by adding a recent service visit so Keepr can track its story.`;
  }

  const yearsSpan =
    today.getFullYear() - (first.d?.getFullYear() || today.getFullYear());

  const name = asset.name || asset.nickname || "this asset";

  let sentence = `${name} has ${totalServices} logged service ${
    totalServices === 1 ? "event" : "events"
  }`;

  if (yearsSpan > 0) {
    sentence += ` over approximately ${yearsSpan} year${
      yearsSpan === 1 ? "" : "s"
    }.`;
  } else {
    sentence += ` so far.`;
  }

  if (last?.d) {
    sentence += ` The most recent service was on ${last.d.toLocaleDateString()}`;
    if (last.rec?.title) {
      sentence += ` for “${last.rec.title}”`;
    }
    sentence += `.`;
  }

  return sentence;
}
