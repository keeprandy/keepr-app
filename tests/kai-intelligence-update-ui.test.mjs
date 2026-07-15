import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const ROOT = new URL("../", import.meta.url);
const LIB_PATH = new URL("../lib/kaiIntelligenceUpdate.js", import.meta.url);

function loadUpdateModule() {
  const source = fs.readFileSync(LIB_PATH, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;

  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: (specifier) => {
      if (specifier === "./supabaseClient") {
        return {
          supabase: {
            auth: {
              getSession: async () => ({ data: { session: null } }),
            },
          },
        };
      }
      throw new Error(`Unexpected require: ${specifier}`);
    },
    fetch: async () => {
      throw new Error("fetch should be injected in tests");
    },
    console,
  };
  vm.createContext(context);
  new vm.Script(compiled, { filename: LIB_PATH.pathname }).runInContext(context);
  return module.exports;
}

const {
  buildKeeprIntelligenceUpdateViewModel,
  buildKeeprIntelligenceErrorViewModel,
  detectOwnerFacingLeakage,
  fetchKeeprIntelligenceUpdate,
} = loadUpdateModule();

function body(overrides = {}) {
  const manifestStatus = overrides.manifestStatus || "complete";
  const knownFacts = overrides.knownFacts || [
    {
      id: "fact:identity",
      label: "Model",
      value: "2000 Porsche Boxster S",
      category: "identity",
      confidence_state: "verified",
      provenance: [{ table: "assets", row_id: "row-secret" }],
    },
  ];
  return {
    response_version: "3A.1",
    generated_at: "2026-07-15T12:00:00Z",
    operational_status: overrides.operationalStatus || "deterministic",
    authorization: { status: "authorized", role: "owner" },
    canonical_asset: {
      kac_id: overrides.kac || "KPR-6GV2-MJ6W",
      name: overrides.canonicalName === undefined ? (overrides.assetName || "2000 Porsche Boxster S") : overrides.canonicalName,
      type: overrides.assetType || "vehicle",
    },
    manifest: {
      status: manifestStatus,
      kac: overrides.kac || "KPR-6GV2-MJ6W",
      asset: {
        kac_id: overrides.kac || "KPR-6GV2-MJ6W",
        name: overrides.manifestName === undefined ? (overrides.assetName || "2000 Porsche Boxster S") : overrides.manifestName,
        type: overrides.assetType || "vehicle",
      },
      authorization: { access: "owner" },
      association_groups: {
        identity: [
          {
            source_table: "assets",
            safe_metadata: {
              name: overrides.assetName || "2000 Porsche Boxster S",
              year: 2000,
              make: "Porsche",
              model: "Boxster S",
              bucket: "private-asset-documents",
              storage_path: "private/path/document.pdf",
            },
          },
        ],
        systems: overrides.systemAssociations || [],
      },
      collector_summaries: overrides.collectorSummaries || [
        { collector: "identity", status: "complete", association_count: 3, diagnostics: [] },
        { collector: "systems", status: "complete", association_count: 2, diagnostics: [] },
        { collector: "timeline", status: "complete", association_count: 5, diagnostics: [] },
        { collector: "attachments", status: "complete", association_count: 4, diagnostics: [] },
      ],
      diagnostics: [
        { code: "partial_query_failure", source: "service_records", message: "PostgrestError select from service_records" },
      ],
    },
    asset_brief: {
      brief_status: manifestStatus,
      caller_authorization_role: "owner",
      headline: overrides.headline || "This asset is well documented",
      subheadline: overrides.subheadline || "Keepr has enough context to summarize current ownership state.",
      known_facts: knownFacts,
      missing_or_uncertain_facts: overrides.gaps || [],
      attention_items: overrides.attention || [],
      readiness_cards: [
        { dimension: "identity", status: overrides.identityReadiness || "ready", summary: "Identity is documented." },
        { dimension: "systems", status: overrides.systemReadiness || "ready", summary: "Systems are documented." },
        { dimension: "history", status: "ready", summary: "History is present." },
        { dimension: "evidence", status: "ready", summary: "Evidence is present." },
        { dimension: "maintenance", status: "ready", summary: "Maintenance history is present." },
        { dimension: "continuity", status: "ready", summary: "Continuity is supported." },
      ],
      highest_value_next_question: {
        question: overrides.question || "A system is missing model or serial identity.",
        priority_reason: "missing_primary_system_identity",
      },
      permitted_next_capabilities: [
        { key: "can_review_gaps", label: "Review gaps", enabled: true },
        { key: "can_add_evidence", label: "Add evidence", enabled: true },
        { key: "can_create_report", label: "Create report", enabled: true },
      ],
    },
    highest_value_next_question: {
      question: overrides.question || "A system is missing model or serial identity.",
      priority_reason: "missing_primary_system_identity",
    },
    permitted_capabilities: [
      { key: "can_review_gaps", label: "Review gaps", enabled: true },
      { key: "can_add_evidence", label: "Add evidence", enabled: true },
      { key: "can_create_report", label: "Create report", enabled: true },
    ],
  };
}

function formulaBody() {
  return body({
    kac: "KPR-6QEH-927H",
    assetName: "Formula 380 SSC",
    assetType: "marine",
    knownFacts: [
      {
        id: "fact:formula:engine",
        label: "Engine package",
        value: "MerCruiser Twin 8.2L MAG HO ECT 430",
        category: "systems",
        confidence_state: "reported",
      },
      {
        id: "fact:formula:stabilization",
        label: "Stabilization",
        value: "Seakeeper 4",
        category: "systems",
        confidence_state: "reported",
      },
    ],
    systemAssociations: [
      {
        source_table: "systems",
        safe_metadata: {
          name: "Joystick piloting",
          system_type: "configured_option",
          model: "Joystick Piloting",
          bucket: "do-not-render",
        },
      },
    ],
  });
}

test("Porsche complete owner response maps to owner-facing update", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body());
  assert.equal(vm.kac, "KPR-6GV2-MJ6W");
  assert.equal(vm.assetName, "2000 Porsche Boxster S");
  assert.equal(vm.ownerStatus, "Ready");
  assert.equal(vm.currentState.contextStatus, "Based on confirmed Keepr information");
  assert.equal(vm.readiness.length, 6);
  assert.equal(vm.nextBestStep.question, "Review systems missing model or serial information.");
});

test("meaningful asset name beats category label", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    canonicalName: "vehicle",
    manifestName: "vehicle",
  }), { assetName: "2000 Porsche Boxster S" });
  assert.equal(vm.assetName, "2000 Porsche Boxster S");
  assert.notEqual(vm.assetName, "vehicle");
});

test("route display name is presentation fallback only", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    canonicalName: "Porsche Boxster S",
  }), { assetName: "Route Supplied Name" });
  assert.equal(vm.assetName, "Porsche Boxster S");
});

test("strong-history with partial identity does not overstate whole asset understanding", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    headline: "Keepr understands this asset well",
    subheadline: "This asset is well documented.",
    identityReadiness: "partial",
    systemReadiness: "partial",
  }));
  assert.equal(vm.currentState.headline, "Keepr has a strong history for this asset.");
  assert.equal(vm.currentState.subheadline, "Service, evidence, and continuity are documented. Some identity and system details still need review.");
  assert.equal(JSON.stringify(vm.currentState).includes("understands this asset well"), false);
});

test("Formula configured/provisional response remains qualified", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(formulaBody());
  const text = JSON.stringify(vm);
  assert.equal(vm.assetType, "marine");
  assert.equal(text.includes("MerCruiser Twin 8.2L MAG HO ECT 430"), true);
  assert.equal(text.includes("configured/provisional") || text.includes("Configured/Provisional") || text.includes("reported"), true);
  assert.equal(text.includes("verified installed component"), false);
});

test("identity facts rank before systems", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    knownFacts: [
      { id: "sys", label: "Engine", value: "M96", category: "systems", confidence_state: "verified" },
      { id: "identity", label: "Model", value: "Boxster S", category: "identity", confidence_state: "verified" },
    ],
  }));
  assert.equal(vm.knownFacts[0].category, "Identity");
  assert.equal(vm.knownFacts.some((fact) => fact.label === "Model"), true);
});

test("major systems rank before accessories and part-like associations", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    knownFacts: [
      { id: "mats", label: "Porsche Mats", value: "Floor mats", category: "systems", confidence_state: "reported" },
      { id: "engine", label: "Engine", value: "M96", category: "systems", confidence_state: "verified" },
      { id: "seals", label: "Oil Seals and Gaskets", value: "Gaskets", category: "systems", confidence_state: "reported" },
    ],
  }));
  const labels = vm.knownFacts.map((fact) => fact.label);
  assert.equal(labels.includes("Engine"), true);
  assert.equal(labels.includes("Porsche Mats"), false);
  assert.equal(labels.includes("Oil Seals and Gaskets"), false);
});

test("low-value items do not dominate the capped known-facts list", () => {
  const lowValue = ["Bluetooth Dongle", "Porsche Mats", "Oil Seals and Gaskets", "Cruise Control", "Drive Axle Assembly"].map((label, index) => ({
    id: `low:${index}`,
    label,
    value: label,
    category: "systems",
    confidence_state: "reported",
  }));
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    knownFacts: [
      ...lowValue,
      { id: "model", label: "Model", value: "Boxster S", category: "identity", confidence_state: "verified" },
      { id: "history", label: "Documented history", value: "12 records", category: "history", confidence_state: "supported" },
    ],
  }));
  const text = JSON.stringify(vm.knownFacts);
  assert.equal(text.includes("Boxster S"), true);
  assert.equal(text.includes("Documented history"), true);
  assert.equal(text.includes("Bluetooth Dongle"), false);
  assert.equal(text.includes("Porsche Mats"), false);
});

test("complete state is owner-ready", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({ manifestStatus: "complete" }));
  assert.equal(vm.ownerStatus, "Ready");
});

test("partial state uses owner language", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({ manifestStatus: "partial", systemReadiness: "partial" }));
  assert.equal(vm.ownerStatus, "Some context is incomplete");
  assert.equal(vm.readiness.find((card) => card.dimension === "systems").status, "Partial");
});

test("readiness explanations use owner language", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({ identityReadiness: "partial", systemReadiness: "partial" }));
  assert.equal(vm.readiness.find((card) => card.dimension === "identity").summary, "Some identifying details still need confirmation.");
  assert.equal(vm.readiness.find((card) => card.dimension === "systems").summary, "Some systems are missing model or serial information.");
  assert.equal(vm.readiness.find((card) => card.dimension === "history").summary, "Documented service and ownership history is available.");
});

test("restricted state avoids hidden reconstruction", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({ manifestStatus: "restricted", knownFacts: [] }));
  assert.equal(vm.state, "restricted");
  assert.equal(vm.ownerStatus, "Some information is unavailable");
  assert.equal(JSON.stringify(vm).includes("hidden private system"), false);
});

test("concealed 404 maps to unavailable state", () => {
  const vm = buildKeeprIntelligenceErrorViewModel(404, { error: "asset_not_found" });
  assert.equal(vm.state, "concealed");
  assert.equal(vm.title, "Intelligence update unavailable");
});

test("expired session maps to sign-in state", () => {
  const vm = buildKeeprIntelligenceErrorViewModel(401);
  assert.equal(vm.state, "session_expired");
  assert.equal(vm.retryable, false);
});

test("endpoint failure maps to retryable state", () => {
  const vm = buildKeeprIntelligenceErrorViewModel(500);
  assert.equal(vm.state, "endpoint_unavailable");
  assert.equal(vm.retryable, true);
});

test("safe retry is available for network failure", async () => {
  const result = await fetchKeeprIntelligenceUpdate({
    kac: "KPR-TEST-1",
    client: { auth: { getSession: async () => ({ data: { session: { access_token: "not-returned" } } }) } },
    fetchImpl: async () => {
      throw new Error("network");
    },
  });
  assert.equal(result.ok, false);
  assert.equal(result.viewModel.state, "endpoint_unavailable");
  assert.equal(result.viewModel.retryable, true);
  assert.equal(JSON.stringify(result).includes("not-returned"), false);
});

test("no bucket name is rendered in owner view model", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body());
  assert.equal(JSON.stringify(vm).includes("private-asset-documents"), false);
});

test("no storage path is rendered in owner view model", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body());
  assert.equal(JSON.stringify(vm).includes("private/path/document.pdf"), false);
});

test("no signed URL is rendered in owner view model", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    knownFacts: [{ id: "url", label: "Attachment", value: "https://x.supabase.co/storage/v1/object/sign/private/file.pdf", category: "evidence" }],
  }));
  assert.equal(JSON.stringify(vm).includes("/storage/v1/object/sign/"), false);
});

test("no storage URL is rendered in owner view model", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    knownFacts: [{ id: "url", label: "Attachment", value: "https://x.supabase.co/storage/v1/object/public/private/file.pdf", category: "evidence" }],
  }));
  assert.equal(JSON.stringify(vm).includes("/storage/v1/object/"), false);
});

test("no raw diagnostic is rendered in owner view model", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body());
  const text = JSON.stringify(vm);
  assert.equal(text.includes("PostgrestError"), false);
  assert.equal(text.includes("select from"), false);
});

test("no internal table name is rendered in owner view model", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body());
  const text = JSON.stringify(vm);
  assert.equal(text.includes("service_records"), false);
  assert.equal(text.includes("asset_identifiers"), false);
});

test("no supplemental asset identifier row language renders", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    gaps: [{ id: "gap:no_asset_identifiers", question: "No supplemental asset identifier rows were found.", category: "identity" }],
  }));
  const text = JSON.stringify(vm);
  assert.equal(text.includes("supplemental asset identifier rows"), false);
  assert.equal(text.includes("Add another identifying detail."), true);
});

test("no context needs attention internal language renders", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    attention: [
      { id: "identity", title: "identity context needs attention" },
      { id: "systems", title: "systems context needs attention" },
    ],
  }));
  const text = JSON.stringify(vm);
  assert.equal(text.includes("context needs attention"), false);
  assert.equal(text.includes("Confirm the asset's identifying details."), true);
  assert.equal(text.includes("Some systems still need identifying information."), true);
});

test("next step names the system when safely available", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    systemAssociations: [
      { source_table: "systems", safe_metadata: { name: "Port Engine", system_type: "engine", model: null, serial_number: null } },
    ],
    question: "A system is missing model or serial identity.",
  }));
  assert.equal(vm.nextBestStep.question, "Add the model or serial number for Port Engine.");
});

test("generic next step remains actionable when system cannot be identified", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    systemAssociations: [
      { source_table: "systems", safe_metadata: { name: "Porsche Mats", system_type: "accessory", model: null, serial_number: null } },
    ],
    question: "A system is missing model or serial identity.",
  }));
  assert.equal(vm.nextBestStep.question, "Review systems missing model or serial information.");
});

test("leakage markers distinguish bucket names from storage object URLs", () => {
  const markers = detectOwnerFacingLeakage({ safe_metadata: { bucket: "private-bucket" } });
  assert.equal(markers.storage_bucket_name, true);
  assert.equal(markers.storage_object_url, false);
  assert.equal(markers.signed_url, false);
});

test("no generic maintenance recommendation is created", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(formulaBody());
  const text = JSON.stringify(vm).toLowerCase();
  assert.equal(text.includes("oil change"), false);
  assert.equal(text.includes("annual service is due"), false);
});

test("no invented Porsche facts are added", () => {
  const vm = buildKeeprIntelligenceUpdateViewModel(body({
    knownFacts: [{ id: "model", label: "Model", value: "Boxster S", category: "identity", confidence_state: "verified" }],
  }));
  const text = JSON.stringify(vm);
  assert.equal(text.includes("IMS bearing"), false);
  assert.equal(text.includes("oil change"), false);
  assert.equal(text.includes("brake service due"), false);
});

test("category-neutral rendering supports vehicle, marine, home, and other", () => {
  for (const assetType of ["vehicle", "marine", "home", "other"]) {
    const vm = buildKeeprIntelligenceUpdateViewModel(body({ assetType }));
    assert.equal(Boolean(vm.assetType), true);
    assert.equal(vm.readiness.length, 6);
  }
});

test("all four story screens contain the Intelligence entry", () => {
  for (const file of [
    "screens/BoatStoryScreen.js",
    "screens/VehicleStoryScreen.js",
    "screens/HomeStoryScreen.js",
    "screens/OtherAssetStoryScreen.js",
  ]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /label="Intelligence"/);
    assert.match(source, /goToKeeprIntelligenceUpdate/);
  }
});

test("KeeprIntelligenceUpdate route exists and old builder route remains", () => {
  const source = fs.readFileSync(new URL("../App.js", import.meta.url), "utf8");
  assert.match(source, /name="KeeprIntelligenceUpdate"/);
  assert.match(source, /KeeprIntelligenceUpdateScreen/);
  assert.match(source, /name="KeeprIntelligence"/);
  assert.match(source, /KeeprIntelligenceWrapper/);
});

test("no Actions, reminders, plans, or write-back affordance is introduced", () => {
  const panel = fs.readFileSync(new URL("../components/kai/KeeprIntelligenceUpdatePanel.js", import.meta.url), "utf8");
  const screen = fs.readFileSync(new URL("../screens/KeeprIntelligenceUpdateScreen.js", import.meta.url), "utf8");
  const client = fs.readFileSync(LIB_PATH, "utf8");
  const combined = `${panel}\n${screen}\n${client}`;
  assert.doesNotMatch(combined, /\.from\(/);
  assert.doesNotMatch(combined, /\.insert\(/);
  assert.doesNotMatch(combined, /\.update\(/);
  assert.doesNotMatch(combined, /\.upsert\(/);
  assert.doesNotMatch(combined, /Create reminder|Activate plan|Execute action/);
});

test("existing story navigation actions remain present", () => {
  for (const file of [
    "screens/BoatStoryScreen.js",
    "screens/VehicleStoryScreen.js",
    "screens/HomeStoryScreen.js",
    "screens/OtherAssetStoryScreen.js",
  ]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /label="Timeline"/);
    assert.match(source, /label="Attachments"/);
    assert.match(source, /label="Add to Timeline"/);
  }
});
