/**
 * Maintain Engine client stub.
 * In v1, this will call your backend (or a serverless function)
 * which wraps the LLM calls.
 */

const MAINTAIN_ENGINE_BASE_URL = "https://your-maintain-engine.example.com";

export async function analyzePhoto({ assetId, photoUrl }) {
  // TODO: replace with real HTTP call
  console.log("Stub: analyzePhoto", { assetId, photoUrl });
  return {
    asset_type: "boat",
    detected_systems: ["ENG-MAIN"],
    conditions: [],
    confidence: 0.5
  };
}

export async function generateSchedule({ assetId }) {
  console.log("Stub: generateSchedule", { assetId });
  return {
    schedule: []
  };
}