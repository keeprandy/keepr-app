const KEYWORD_SCORES = [
  { words: ["remodel", "renovation", "renovated"], score: 5 },
  { words: ["replaced", "replacement"], score: 5 },
  { words: ["rebuilt"], score: 5 },
  { words: ["installed", "install"], score: 4 },
  { words: ["added", "built", "finished"], score: 4 },
  { words: ["upgrade", "upgraded"], score: 4 },
  { words: ["repair", "fixed"], score: 2 },
  { words: ["maintenance", "service"], score: 1 },
];

const IMPORTANT_SYSTEMS = [
  "roof",
  "hvac",
  "foundation",
  "deck",
  "dock",
  "lift",
  "pool",
  "generator",
  "windows",
  "kitchen",
  "basement",
];

function getCostScore(cost) {
  if (!cost) return 0;
  const num =
    typeof cost === "number"
      ? cost
      : Number(String(cost).replace(/[$,]/g, ""));

  if (!Number.isFinite(num)) return 0;

  if (num >= 50000) return 5;
  if (num >= 10000) return 4;
  if (num >= 2500) return 3;
  if (num >= 500) return 2;

  return 1;
}

function getKeywordScore(text = "") {
  const t = text.toLowerCase();
  let score = 0;

  for (const group of KEYWORD_SCORES) {
    if (group.words.some((w) => t.includes(w))) {
      score = Math.max(score, group.score);
    }
  }

  return score;
}

function getSystemScore(systemName = "") {
  const s = systemName.toLowerCase();
  return IMPORTANT_SYSTEMS.some((key) => s.includes(key)) ? 3 : 0;
}

function normalizeHeadline(title = "") {
  const t = title.toLowerCase();

  if (t.includes("purchase")) return "Purchased Home";
  if (t.includes("basement")) return "Finished Basement";
  if (t.includes("pool")) return "Built / Updated Pool";
  if (t.includes("roof")) return "Roof Replaced";
  if (t.includes("deck")) return "Deck Rebuilt / Updated";
  if (t.includes("kitchen")) return "Kitchen Remodel";
  if (t.includes("hvac")) return "HVAC Work Completed";

  return title;
}

export function buildHighlights(timeline = []) {
  const scored = timeline.map((item) => {
    const text = `${item.title || ""} ${item.description || ""}`;

    const keywordScore = getKeywordScore(text);
    const costScore = getCostScore(item.cost);
    const systemScore = getSystemScore(item.systemName);

    const score = keywordScore + costScore + systemScore;

    return {
      ...item,
      highlightScore: score,
      headline: normalizeHeadline(item.title),
    };
  });

  return scored
    .filter((i) => i.highlightScore >= 5)
    .sort((a, b) => b.highlightScore - a.highlightScore)
    .slice(0, 10);
}