import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const MODULE_ROOT = new URL("../supabase/functions/_shared/", import.meta.url);
const REGAL_FIXTURE = new URL("../data/regal_3300_keepr_import.json", import.meta.url);

const cache = new Map();

function loadSharedModule(name) {
  const path = new URL(name, MODULE_ROOT);
  const key = path.pathname;
  if (cache.has(key)) return cache.get(key).exports;

  const source = fs.readFileSync(path, "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;

  const module = { exports: {} };
  cache.set(key, module);

  function localRequire(specifier) {
    if (specifier.endsWith(".ts")) return loadSharedModule(specifier.replace("./", ""));
    throw new Error(`Unexpected require: ${specifier}`);
  }

  const context = { module, exports: module.exports, require: localRequire, console };
  vm.createContext(context);
  new vm.Script(compiled, { filename: path.pathname }).runInContext(context);
  return module.exports;
}

class Query {
  constructor(table, db) {
    this.table = table;
    this.db = db;
    this.filters = [];
    this.expectSingle = false;
  }

  select() {
    return this;
  }

  eq(key, value) {
    this.filters.push((row) => row?.[key] === value);
    return this;
  }

  is(key, value) {
    this.filters.push((row) => (value === null ? row?.[key] == null : row?.[key] === value));
    return this;
  }

  in(key, values) {
    this.filters.push((row) => values.includes(row?.[key]));
    return this;
  }

  single() {
    this.expectSingle = true;
    return this.result();
  }

  rows() {
    let rows = [...(this.db[this.table] || [])];
    for (const filter of this.filters) rows = rows.filter(filter);
    return rows;
  }

  result() {
    const rows = this.rows();
    if (this.expectSingle && rows.length !== 1) {
      return Promise.resolve({ data: null, error: { message: "not found" } });
    }
    return Promise.resolve({ data: rows[0] || null, error: null });
  }

  then(resolve, reject) {
    if (this.db.__fail?.has(this.table)) {
      return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
    }
    return Promise.resolve({ data: this.rows(), error: null }).then(resolve, reject);
  }
}

function makeClient(db = {}) {
  return {
    from(table) {
      return new Query(table, db);
    },
  };
}

function context(overrides = {}) {
  return {
    kac: "KPR-TEST-1",
    asset: {
      id: "asset-1",
      kac_id: "KPR-TEST-1",
      master_asset_id: null,
      owner_id: "owner-1",
      name: "Asset",
      type: "vehicle",
      status: "active",
      asset_mode: "personal",
      vin: null,
      serial_number: null,
      lifecycle_state: "active",
      manifest_availability: "available",
      ...overrides,
    },
  };
}

function byId(associations, id) {
  return associations.find((association) => association.association_id === id);
}

function local(value) {
  return JSON.parse(JSON.stringify(value));
}

function allSafeMetadata(result) {
  return JSON.stringify(result.associations.map((association) => association.safe_metadata || {}));
}

const { collectAssetIdentityAssociations } = loadSharedModule("kacManifestIdentity.ts");
const { collectSystemAssociations } = loadSharedModule("kacManifestSystems.ts");
const { collectTimelineAssociations } = loadSharedModule("kacManifestTimeline.ts");
const { collectAttachmentAssociations } = loadSharedModule("kacManifestAttachments.ts");

test("supports legacy asset without a master asset", async () => {
  const result = await collectAssetIdentityAssociations(makeClient({ asset_identifiers: [] }), context());
  assert.ok(byId(result.associations, "asset:asset-1:identity"));
  assert.equal(result.diagnostics.some((d) => d.code === "missing_expected_relationship"), true);
});

test("supports asset with a master asset", async () => {
  const result = await collectAssetIdentityAssociations(
    makeClient({
      asset_identifiers: [],
      master_assets: [
        {
          id: "master-1",
          kac: "KPR-TEST-1",
          asset_type: "vehicle",
          manufacturer: "Porsche",
          model: "Boxster",
          model_year: 2000,
          vin: "VIN1",
          hin: null,
          serial_number: null,
          status: "active",
        },
      ],
    }),
    context({ master_asset_id: "master-1" }),
  );

  assert.ok(byId(result.associations, "master_asset:master-1"));
  assert.equal(result.diagnostics.some((d) => d.code === "missing_expected_relationship"), false);
});

test("associates VIN, HIN, serial, and KAC identifiers", async () => {
  const result = await collectAssetIdentityAssociations(
    makeClient({
      asset_identifiers: [
        { id: "id-kac", asset_id: "asset-1", kind: "kac", value: "KPR-TEST-1", is_primary: true },
        { id: "id-vin", asset_id: "asset-1", kind: "vin", value: "VIN1", is_primary: true },
        { id: "id-hin", asset_id: "asset-1", kind: "hin", value: "HIN1", is_primary: true },
        { id: "id-serial", asset_id: "asset-1", kind: "serial_number", value: "SERIAL1", is_primary: false },
      ],
    }),
    context({ vin: "VIN1", serial_number: "SERIAL1" }),
  );

  const kinds = result.associations
    .filter((association) => association.object_type === "asset_identifier")
    .map((association) => association.safe_metadata.kind)
    .sort();
  assert.deepEqual(local(kinds), ["hin", "kac", "serial_number", "vin"]);
});

test("normalizes vehicle system extensions", async () => {
  const result = await collectSystemAssociations(
    makeClient({
      systems: [{ id: "sys-1", asset_id: "asset-1", ksc_code: "ENG", name: "Engine", system_type: "engine" }],
      vehicle_systems: [{ id: "veh-1", asset_id: "asset-1", system_id: "sys-1", system_type: "engine", name: "Flat six" }],
    }),
    context(),
  );

  assert.equal(byId(result.associations, "vehicle_systems:veh-1").relationship_type, "system_extension");
});

test("normalizes marine system extensions", async () => {
  const result = await collectSystemAssociations(
    makeClient({
      systems: [{ id: "sys-1", asset_id: "asset-1", ksc_code: "ENG", name: "Engine", system_type: "engine" }],
      boat_systems: [{ id: "boat-1", asset_id: "asset-1", system_id: "sys-1", system_type: "engine", name: "Port engine", manufacturer: "Volvo" }],
    }),
    context({ type: "marine" }),
  );

  assert.equal(byId(result.associations, "boat_systems:boat-1").safe_metadata.manufacturer, "Volvo");
});

test("normalizes home system extensions without treating fields as marine or vehicle", async () => {
  const result = await collectSystemAssociations(
    makeClient({
      systems: [{ id: "sys-1", asset_id: "asset-1", ksc_code: "HVAC", name: "HVAC", system_type: "hvac" }],
      home_systems: [{ id: "home-1", asset_id: "asset-1", system_id: "sys-1", system_type: "hvac", name: "Furnace", location_hint: "Basement", status: "healthy" }],
    }),
    context({ type: "home" }),
  );

  const home = byId(result.associations, "home_systems:home-1");
  assert.equal(home.safe_metadata.location_hint, "Basement");
  assert.equal("manufacturer" in home.safe_metadata, false);
});

test("pairs service record with Moment without double-counting", async () => {
  const result = await collectTimelineAssociations(
    makeClient({
      service_records: [{ id: "svc-1", asset_id: "asset-1", title: "Oil change", performed_at: "2026-01-01", system_id: "sys-engine", keepr_pro_id: "pro-1", verification_status: "verified", source_type: "manual" }],
      story_events: [{ id: "story-1", asset_id: "asset-1", event_type: "maintenance", title: "Oil change moment", metadata: { service_record_id: "svc-1" }, occurred_at: "2026-01-01T00:00:00Z", source_type: "manual", service_record_id: null, system_id: "sys-engine" }],
    }),
    context(),
  );

  assert.equal(result.associations.filter((a) => a.object_type === "work_event").length, 1);
  assert.equal(result.associations.some((a) => a.association_id === "moment:story_event:story-1"), false);
  const event = byId(result.associations, "work_event:service_record:svc-1");
  assert.deepEqual(local(event.event_roles), ["moment", "maintenance"]);
  assert.deepEqual(local(event.participant_roles), ["keepr_pro"]);
  assert.equal(event.affected_system_id, "sys-engine");
  assert.equal(event.association_id, "work_event:service_record:svc-1");
  assert.deepEqual(local(event.provenance), [
    { table: "service_records", row_id: "svc-1" },
    { table: "story_events", row_id: "story-1", note: "paired Moment" },
  ]);
});

test("collects standalone Moment", async () => {
  const result = await collectTimelineAssociations(
    makeClient({
      story_events: [{ id: "story-1", asset_id: "asset-1", event_type: "memory", title: "First drive", metadata: {}, occurred_at: "2026-01-01T00:00:00Z" }],
    }),
    context(),
  );

  assert.equal(byId(result.associations, "moment:story_event:story-1").event_role, "moment");
});

test("collects standalone timeline record", async () => {
  const result = await collectTimelineAssociations(
    makeClient({
      timeline_records: [{ id: "tl-1", asset_id: "asset-1", occurred_on: "2026-01-02", type: "usage", title: "Mileage", attachment_id: "att-1", source_type: "manual" }],
    }),
    context(),
  );

  const record = byId(result.associations, "timeline_record:tl-1");
  assert.equal(record.event_role, "usage");
  assert.equal(record.proof_state, "evidence_attached");
});

test("keeps one attachment identity with multiple placement relationships", async () => {
  const result = await collectAttachmentAssociations(
    makeClient({
      attachments: [{ id: "att-1", asset_id: "asset-1", kind: "file", bucket: "asset-files", file_name: "invoice.pdf", mime_type: "application/pdf", doc_type: "invoice", ocr_status: "complete", text_source: "ocr", extracted_at: "2026-01-01", privacy: "moves_with_asset" }],
      attachment_placements: [
        { id: "pl-1", attachment_id: "att-1", target_type: "asset", target_id: "asset-1", role: "receipt" },
        { id: "pl-2", attachment_id: "att-1", target_type: "system", target_id: "sys-1", role: "evidence" },
      ],
    }),
    context(),
  );

  assert.equal(result.associations.filter((a) => a.association_id === "attachment:att-1").length, 1);
  assert.equal(result.associations.filter((a) => a.object_type === "attachment_placement").length, 2);
});

test("returns orphaned placement diagnostic", async () => {
  const result = await collectAttachmentAssociations(
    makeClient({
      attachments: [],
      attachment_placements: [{ id: "pl-orphan", attachment_id: "missing", target_type: "asset", target_id: "asset-1", role: "proof" }],
    }),
    context(),
  );

  assert.equal(result.diagnostics.some((d) => d.code === "orphaned_placement"), true);
});

test("returns partial collector failure diagnostic", async () => {
  const db = { systems: [], __fail: new Set(["vehicle_systems"]) };
  const result = await collectSystemAssociations(makeClient(db), context());
  assert.equal(result.diagnostics.some((d) => d.code === "partial_query_failure"), true);
});

test("returns disputed asset diagnostic", async () => {
  const result = await collectAssetIdentityAssociations(
    makeClient({ asset_identifiers: [] }),
    context({ status: "disputed", lifecycle_state: "disputed", manifest_availability: "admin_review_required" }),
  );
  assert.equal(result.diagnostics.some((d) => d.code === "disputed_asset_requires_admin_review"), true);
});

test("does not return extracted text or signed URLs", async () => {
  const result = await collectAttachmentAssociations(
    makeClient({
      attachments: [
        {
          id: "att-1",
          asset_id: "asset-1",
          kind: "file",
          bucket: "asset-files",
          file_name: "manual.pdf",
          url: "https://signed.example",
          storage_path: "private/path",
          extracted_text: "secret text",
          doc_type: "manual",
          privacy: "owner_only",
        },
      ],
      attachment_placements: [],
    }),
    context(),
  );

  const serialized = allSafeMetadata(result);
  assert.equal(serialized.includes("secret text"), false);
  assert.equal(serialized.includes("signed.example"), false);
  assert.equal(serialized.includes("private/path"), false);
});

test("Regal marine fixture can normalize as second acceptance asset", async () => {
  const fixture = JSON.parse(fs.readFileSync(REGAL_FIXTURE, "utf8"));
  const db = {
    systems: [{ id: "sys-regal-engine", asset_id: "asset-regal", ksc_code: "PROP", name: "Propulsion", system_type: "propulsion" }],
    boat_systems: fixture.systems.slice(0, 2).map((system, index) => ({
      id: `regal-boat-${index}`,
      asset_id: "asset-regal",
      system_id: index === 0 ? "sys-regal-engine" : null,
      system_type: system.type,
      name: system.name,
      manufacturer: system.manufacturer,
      model: system.model,
      serial_number: system.serial_number,
    })),
  };

  const result = await collectSystemAssociations(makeClient(db), context({ id: "asset-regal", type: "marine", kac_id: "KPR-REGAL-3300" }));
  assert.equal(result.associations.some((a) => a.source_table === "boat_systems"), true);
  const marine = result.associations.find((a) => a.association_id === "boat_systems:regal-boat-0");
  assert.equal(marine.relationship_type, "system_extension");
  assert.equal(marine.affected_system_id, "sys-regal-engine");
  assert.equal(marine.safe_metadata.manufacturer, "Volvo Penta");
  assert.equal(marine.safe_metadata.system_type, "engine");
});
