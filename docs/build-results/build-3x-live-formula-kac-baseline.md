# Build 3.X Live Formula KAC Intelligence Baseline

Date: 2026-07-14

KAC: `KPR-6QEH-927H`

Public URL: `https://app.keeprhome.com/k/KPR-6QEH-927H`

## 1. Environment and Access Confirmation

Confirmed environment:

| Item | Finding |
| --- | --- |
| Supabase project ref | `jjzjuqxysucqutgjnrkk` |
| Linked project name | `keepr-prod` |
| Environment classification | Production, based on linked project name and deployed Supabase ref |
| Database access method used | Supabase REST `GET` requests against the configured production URL |
| Database credential present | Service-role secret is present locally; it is write-capable, but this inspection used read-only `GET` requests only |
| Direct Postgres access | Not available from saved pooler file; pooler URL prompted for password |
| Authenticated user JWT | Not available safely in this environment |
| Public KAC endpoint | Available and queried successfully |
| Public web page | Available and returns Vercel-hosted Expo app shell plus metadata |
| Environment variables inspected | `SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_KEEPR_BASE_URL`; values redacted |

Safety confirmation:

- No production inserts, updates, deletes, migrations, storage writes, RLS changes, deployments, or backfills were performed.
- No local fixture files were used as authoritative Formula state.
- Temporary read-only sanitized snapshots were written under `/tmp` for analysis only.
- No keys, passwords, JWTs, refresh tokens, signed URL tokens, full storage paths, email, phone, or postal contact data are included in this report.

## 2. Live KAC Resolution Result

Confirmed via deployed public resolver:

- Function: `supabase/functions/kac-resolve/index.ts`
- Public screen caller: `screens/PublicActionScreen.js`
- Live response status: `200`
- Returned contract:

```json
{
  "asset": {
    "id": "0c92b698-8e26-4a09-8352-b2e19db8521b",
    "name": "KeeprAfloat!",
    "kac_id": "KPR-6QEH-927H"
  },
  "system": null,
  "mode": "action",
  "allowed_actions": ["view"]
}
```

Repository path:

- `supabase/functions/kac-resolve/index.ts:24` creates the shared service client.
- `supabase/functions/kac-resolve/index.ts:26` queries `assets`.
- `supabase/functions/kac-resolve/index.ts:28` selects only `id, name, kac_id`.
- `supabase/functions/kac-resolve/index.ts:37` returns the public contract.
- `screens/PublicActionScreen.js:379` calls `kac-resolve` for `/k/<KAC>`.

Concealment behavior:

- Public KAC resolution conceals type, year, make, model, owner, systems, attachments, source metadata, and public config.
- The resolver returns `allowed_actions: ["view"]`; richer owner-configured actions only appear if a richer public resolver response supplies `public_config`.

## 3. Canonical Asset Record

Confirmed live row:

| Field | Live value |
| --- | --- |
| `assets.id` | `0c92b698-8e26-4a09-8352-b2e19db8521b` |
| `assets.kac_id` | `KPR-6QEH-927H` |
| `assets.name` | `KeeprAfloat!` |
| `assets.type` | `boat` |
| `assets.asset_subtype` | `powerboat` |
| `assets.status` | `active` |
| `assets.deleted_at` | `null` |
| `assets.asset_mode` | `commercial` |
| `assets.commercial_entity` | `SeeYouThen, Inc. - KeeprAfloat` |
| `assets.year` | `2026` |
| `assets.make` | `Formula` |
| `assets.model` | `380` |
| `assets.hull_material` | `Fiberglass` |
| `assets.length_feet` | `38` |
| `assets.engine_type` | `Twin V8, IO` |
| `assets.engine_hours` | `null` |
| `assets.vin` | `null` |
| `assets.serial_number` | `null` |
| `assets.registration_number` | `null` |
| `assets.location` | `Lake Norman Yacht Club Marina (Marina Kept, Freshwater)` |
| `assets.data_source` | `import` |
| `assets.master_asset_id` | `ed3e15ca-83a8-4dba-bbab-27f1a68de271` |
| `assets.hero_placement_id` | `8a6ad32c-9c49-4322-9e79-408da762b0b6` |
| Owner reference | Present, redacted |

Live `assets.extra_metadata` contains:

- `oem`: `Formula Boats`
- `model`: `380 Super Sport Crossover (SSC)`
- `model_year`: `2026`
- `source.builder_url`: Formula builder URL
- `source.details_url`: Formula detail URL
- `pricing.msrp`: `1684600`
- `pricing.mssp`: `1313988`
- `pricing.options_total`: `413890`
- `configuration.engine_package`: `MerCruiser Twin 8.2L MAG HO ECT 430`
- `configuration.drives`: `Bravo Three X`
- `configuration.drive_type`: `stern_drive`
- `configuration.joystick_piloting`: `true`
- `configuration.stabilization`: `Seakeeper 4 Gyro`, `Seakeeper Ride 750`
- `stewardship_context.storage`: `marina_kept`
- `stewardship_context.water_type`: `freshwater`
- `stewardship_context.marina_name`: `Lake Norman Yacht Club Marina`
- `publicConfig.story.enabled`: `true`
- `publicConfig.story.showSystems`: `true`
- `publicConfig.story.showTimeline`: `highlights_only`
- `publicConfig.story.showFinancials`: `true`
- `publicConfig.actions.mode`: `inquiry`
- `publicConfig.actions.actionsEnabled`: `request_info`, `request_service`, `submit_quote`

Master asset:

| Field | Live value |
| --- | --- |
| `master_assets.id` | `ed3e15ca-83a8-4dba-bbab-27f1a68de271` |
| `master_assets.kac` | `KPR-6QEH-927H` |
| `master_assets.asset_type` | `boat` |
| `master_assets.manufacturer` | `Formula` |
| `master_assets.model` | `380 Super Sport Crossover (SSC)` |
| `master_assets.model_year` | `2026` |
| `master_assets.hin` | `null` |
| `master_assets.vin` | `null` |
| `master_assets.serial_number` | `null` |
| `master_assets.status` | `active` |

Confirmed identity gap:

- No live `asset_identifiers` rows exist for this asset.
- HIN/vessel identifier is not currently persisted in `assets`, `master_assets`, or `asset_identifiers`.

## 4. Related-Record Inventory

Read-only production inventory:

| Table / surface | Row count | Relationship | Current app or intelligence consumption |
| --- | ---: | --- | --- |
| `assets` | 1 | `assets.kac_id = KPR-6QEH-927H` | Public resolver, story screens, Manifest identity |
| `master_assets` | 1 | `assets.master_asset_id -> master_assets.id` | Manifest identity consumes limited fields |
| `asset_identifiers` | 0 | `asset_identifiers.asset_id -> assets.id` | Manifest identity would consume if present |
| `systems` | 15 | `systems.asset_id -> assets.id` | Public story, authenticated story screens, Manifest systems |
| `boat_systems` | 0 | `boat_systems.asset_id -> assets.id` | Manifest systems would consume if present |
| `vehicle_systems` | 0 | `vehicle_systems.asset_id -> assets.id` | Not relevant to Formula |
| `home_systems` | 0 | `home_systems.asset_id -> assets.id` | Not relevant to Formula |
| `attachments` | 13 | `attachments.asset_id -> assets.id` | Attachment screens, public media function, Manifest attachments |
| `attachment_placements` | 19 | `attachment_placements.attachment_id -> attachments.id`; targets asset/system/service_record | Proof/media screens, Manifest attachments |
| `attachment_links` | 0 | `attachment_links.asset_id -> assets.id` | Manifest attachments would consume URL-free metadata |
| `asset_photos` | 6 | `asset_photos.asset_id -> assets.id` | Legacy/photo UI surface; not consumed by Manifest |
| `system_photos` | 5 | `system_photos.system_id -> systems.id` | System-story UI surface; not consumed by Manifest |
| `service_records` | 3 | `service_records.asset_id -> assets.id` | Story/timeline screens, Manifest timeline |
| `story_events` | 2 | `story_events.asset_id -> assets.id`; metadata links two service records | Story screens, Manifest timeline deduplication |
| `timeline_records` | 0 | `timeline_records.asset_id -> assets.id` | Manifest would consume if present |
| `maintenance_events` | 0 | `maintenance_events.asset_id -> assets.id` | Manifest would consume if present |
| `service_entries` | 0 | `service_entries.asset_id -> assets.id` | Manifest would consume if present |
| `system_readiness` | 15 | `system_readiness.asset_id/system_id` | Not consumed by Manifest, Context Envelope, or Brief |
| `service_record_documents` | 0 | `service_record_documents.asset_id -> assets.id` | Not currently used for Formula |
| `service_record_photos` | 0 | `service_record_photos.asset_id -> assets.id` | Story screens check this, but none exist |
| `maintenance_reminders` | 0 | `maintenance_reminders.asset_id -> assets.id` | Not present |
| `reminders` | 0 | `reminders.asset_id -> assets.id` | Not present |
| `assurance_records` | 0 | `assurance_records.asset_id -> assets.id` | Not present |
| `warranty_requirements` | 0 asset-scoped rows | Schema is `org_id + warranty_object_id`; no direct Formula asset row found | Not present for Formula |
| `asset_stewardships` | 2 | `asset_stewardships.asset_id -> assets.id` | Auth resolver and Manifest auth logic |
| `asset_stewards` | 1 | `asset_stewards.master_asset_id -> master_assets.id` | Legacy/master stewardship reference |
| `asset_transfers` | 0 | `asset_transfers.master_asset_id -> master_assets.id` | Not present |
| `public_links` | 0 | `public_links.asset_id -> assets.id` | Public token route would consume if present |
| `enrichment_runs` | 0 | `enrichment_runs.asset_id -> assets.id` | Not present |
| `locations` | 0 | `locations.asset_id -> assets.id` | Storage/location only exists in asset fields and JSON |
| `ownership_bands` | 0 | `ownership_bands.asset_id -> assets.id` | Not present |
| `keepr_pros` via service records | 0 | No service record has `keepr_pro_id` | Not present |
| Hub relationship tables | 0 / not present by queried names | No Formula hub relationship found | No Formula Hub affiliation confirmed |

## 5. Live Fact Ledger

| Fact | Live value | Table | Column / JSON path | Source | Consumed by Manifest? | Visible today? |
| --- | --- | --- | --- | --- | --- | --- |
| Formula identity | `Formula 380`, plus `380 Super Sport Crossover (SSC)` | `assets`, `master_assets` | `make`, `model`, `extra_metadata.model`, `master_assets.model` | Import / master asset | Partially; Manifest uses type/status/KAC and master model flags, not asset `extra_metadata.model` | Public metadata shows title only; app story may show asset fields |
| KAC | `KPR-6QEH-927H` | `assets`, `master_assets` | `kac_id`, `kac` | Production KAC | Yes | Public resolver returns it |
| Asset type | `boat` | `assets`, `master_assets` | `type`, `asset_type` | Import/master asset | Yes | Public resolver hides it |
| Year | `2026` | `assets`, `master_assets`, JSON | `year`, `model_year`, `extra_metadata.model_year` | Import/master asset | Master year appears in Manifest identity metadata; asset year is not separately surfaced | Public resolver hides it |
| HIN / vessel identifier | `null` | `assets`, `master_assets`, `asset_identifiers` | no value present | Not persisted | No | No |
| Engine package | `MerCruiser Twin 8.2L MAG HO ECT 430` | `assets`, `systems` | `extra_metadata.configuration.engine_package`; `systems.metadata.options[]` on Propulsion | OEM build import | Only indirectly as system row name; current Manifest system collector drops `systems.metadata.options` | Hidden from public resolver; may appear only in UI if raw system metadata screen shows it |
| Drive package | `Bravo Three X` | `assets`, `systems` | `extra_metadata.configuration.drives`; Propulsion options | OEM build import | Not retained by Manifest system safe metadata | Not surfaced in public resolver |
| Joystick piloting | `true` | `assets`, `systems` | `extra_metadata.configuration.joystick_piloting`; Propulsion options | OEM build import | Not retained by Manifest | Not surfaced in public resolver |
| Seakeeper 4 | Present | `assets`, `systems` | `extra_metadata.configuration.stabilization[]`; Stabilization options | OEM build import | System name `Stabilization & Ride` retained; option name dropped | Not surfaced as a distinct system |
| Seakeeper Ride 750 | Present | `assets`, `systems` | same as above | OEM build import | Option name dropped | Not surfaced as a distinct system |
| Raymarine electronics | `Raymarine Twin Axiom 2 XL 16 w/ HD Radar` | `systems` | `Navigation & Electronics.metadata.options[]` | OEM build import | Option name dropped | Not surfaced as a distinct system |
| Generator | Not found in live asset JSON or system metadata inspected | n/a | n/a | n/a | No | No |
| HVAC | `18,000 BTU Cockpit A/C (120V)` | `systems` | `HVAC & Climate.metadata.options[]` | OEM build import | System row retained, option detail dropped | Public/story systems list only names |
| Refrigeration | Aft cockpit cooler/refrigerator/freezer coils | `systems` | `Cockpit Utility.metadata.options[]` | OEM build import | System row retained, option detail dropped | Not distinct |
| Communications | `Starlink Satellite Internet`, `Satellite TV HD System` | `systems` | `Navigation & Electronics.metadata.options[]` | OEM build import | Option detail dropped | Not distinct |
| Entertainment | `Entertainment & Connectivity` row exists | `systems` | `name`, `system_type` | OEM build import | Yes as broad system row | Public story systems list can show name |
| Configured options | Many options in system metadata and asset JSON | `assets`, `systems` | `extra_metadata.configuration`, `systems.metadata.options[]` | OEM build import | Mostly not retained by Manifest | Mostly hidden or flattened |
| Pricing/build sheet | MSRP, MSSP, options total | `assets`, `service_records` | `extra_metadata.pricing`, OEM service record metadata | Import | Not retained by Manifest | `publicConfig.showFinancials` is true, but public resolver hides values |
| Builder/dealer/source attribution | Formula builder and details URLs | `assets`, `service_records` | `extra_metadata.source`, OEM service record metadata | Import | Not retained by Manifest except service record source type | Not exposed by public resolver |
| Marina/storage context | Marina-kept, freshwater, Lake Norman Yacht Club Marina | `assets`, `service_records` | `location`, `extra_metadata.stewardship_context` | Import | Location not carried into Manifest; source context dropped | Asset/story UI may show location if enabled |

## 6. Live System Inventory

Maturity states used here:

1. Placeholder
2. Classified
3. Probable match
4. Verified instance
5. Knowledge connected
6. Continuity active

Current Formula systems:

| System | Current representation | Identity level | Evidence | Missing identity | Knowledge available | Current product use |
| --- | --- | --- | --- | --- | --- | --- |
| Vessel Overview | `systems` row, `ksc_code=VSL-OVERVIEW`, `system_type=overview` | 2 Classified | OEM import, service record | Manufacturer/model/serial | Summary in metadata; OEM build record linked by service record | Manifest + public story system list |
| Hull & Structure | `systems` row | 2 Classified | OEM import | Specific hull/HIN/serial | None beyond origin | Manifest + UI list |
| Propulsion & Controls | Broad `systems` row with options | 3 Probable match | OEM import options | Engine serials, drive serials, actual installed instance IDs | Engine/drive/joystick/Mercury options in metadata | Manifest retains only row name/type; drops options |
| Fuel System | Broad `systems` row | 2 Classified | OEM import | Tank/system specs | None beyond origin | Manifest + UI list |
| Electrical & Power | Broad `systems` row | 2 Classified | OEM import | Generator/battery/charger/inverter identity | None beyond origin | Manifest + UI list |
| Navigation & Electronics | Broad row with Raymarine/FLIR/Starlink/Satellite TV options | 3 Probable match | OEM import options | Device models/serials/network topology | Options in metadata | Manifest drops options |
| Stabilization & Ride | Broad row with Seakeeper options | 3 Probable match | OEM import options | Seakeeper model/serial/install details | Seakeeper 4 and Ride 750 in metadata | Manifest drops options |
| HVAC & Climate | Broad row with cockpit A/C option | 3 Probable match | OEM import options | Make/model/serial of HVAC unit | Option in metadata | Manifest drops option |
| Safety Systems | Broad row | 2 Classified | OEM import | Device details | None beyond origin | Manifest + UI list |
| Deck & Exterior | Broad row with hydraulic platform, shade, lights, decking | 3 Probable match | OEM import options + two service records | Actual component serials and service evidence links | Options in metadata; service records linked | Manifest keeps system and service association but drops options |
| Cockpit Utility | Broad bundle row with cooler, grill, Yeti, table, clips | 3 Probable match | OEM import options | Which are true installed equipment vs accessories | Options in metadata | Manifest drops options; UI may show only row name |
| Entertainment & Connectivity | Broad row | 2 Classified | OEM import | Actual audio/connectivity device identities | None beyond origin | Manifest + UI list |
| Security Systems | Broad row with safe and Mercury 1st Mate | 3 Probable match | OEM import options | Specific device/serial/account state | Options in metadata | Manifest drops options |
| Interior & Cabin | Broad row | 2 Classified | OEM import | Component identities | None beyond origin | Manifest + UI list |
| Plumbing & Sanitation | Broad row with options and playbook text in metadata | 5 Knowledge connected | OEM import + manual-derived playbook metadata | Specific pump/head/tank identities | Fresh water/playbook text stored under `systems.metadata.playbook` | Manifest drops metadata/playbook |

Confirmed live system pattern:

- Major configured systems often exist as `systems.metadata.options[]`, not normalized `boat_systems` rows.
- `boat_systems` has zero rows, so no marine-specific extension identities are currently available to Manifest.
- `system_readiness` has 15 rows, one per system, but each inspected `readiness_json` is empty and the current Manifest path does not query it.

## 7. Current Manifest Output

Generated with current code against a sanitized read-only production snapshot. This was not an authenticated production endpoint invocation because no safe user JWT was available.

Relevant code:

- Endpoint orchestration: `supabase/functions/kac-intelligence-manifest/index.ts:300`
- Collector execution: `supabase/functions/kac-intelligence-manifest/index.ts:355`
- Manifest status aggregation: `supabase/functions/kac-intelligence-manifest/index.ts:367`
- Identity collector: `supabase/functions/_shared/kacManifestIdentity.ts:33`
- Systems collector: `supabase/functions/_shared/kacManifestSystems.ts:92`
- Timeline collector: `supabase/functions/_shared/kacManifestTimeline.ts:95`
- Attachments collector: `supabase/functions/_shared/kacManifestAttachments.ts:170`

Current output summary:

| Domain | Status | Associations |
| --- | --- | ---: |
| identity | `complete` | 2 |
| systems | `complete` | 15 |
| timeline | `complete` | 3 |
| attachments | `complete` | 32 |
| Manifest overall | `complete` | 52 |

Current deterministic knowledge gaps:

- 15 system identity gaps: each `systems` row lacks model or serial in Manifest-safe metadata.
- 13 attachment processing gaps: each attachment is treated as not fully processed because derivative status is pending or processing state is not complete.
- 1 identity gap: no supplemental `asset_identifiers` rows.

Important Manifest limitations confirmed:

- `assets.extra_metadata.configuration` is not collected.
- `systems.metadata.options[]` is not retained.
- `systems.metadata.playbook` is not retained.
- `asset_photos`, `system_photos`, `system_readiness`, `locations`, `ownership_bands`, `assurance_records`, and warranty surfaces are not collected.
- `service_records.extra_metadata.source/pricing/stewardship_context` is not retained.
- Attachment source identity is retained, but storage path/signed URLs are excluded from the sanitized output.

## 8. Current Context Envelope Output

Relevant code:

- `supabase/functions/_shared/kacContextEnvelope.ts:331` builds the envelope.
- `supabase/functions/_shared/kacContextEnvelope.ts:337` selects relevant systems.
- `supabase/functions/_shared/kacContextEnvelope.ts:338` selects relevant events.
- `supabase/functions/_shared/kacContextEnvelope.ts:349` selects relevant evidence.
- `supabase/functions/_shared/kacContextEnvelope.ts:377` calculates evidence confidence.
- `supabase/functions/_shared/kacContextEnvelope.ts:379` computes readiness dimensions.

Current output summary:

| Field | Value |
| --- | --- |
| `context_status` | `complete` |
| identity facts | 1 |
| relevant systems | 15 |
| relevant normalized events | 3 |
| relevant evidence | 32 |
| exclusions/redactions | 17 sensitive-field categories redacted |

Readiness output:

| Dimension | Status | Why |
| --- | --- | --- |
| identity | `attention` | Missing supplemental identifiers |
| systems | `attention` | All 15 broad system rows lack model/serial identity |
| history | `ready` | Three normalized service/work events |
| evidence | `attention` | 13 attachment processing gaps |
| maintenance | `ready` | Three maintenance/work events |
| continuity | `ready` | Canonical KAC identity present |

Information retained:

- System row identities and names.
- Service record/Moment pairing via `story_events.metadata.service_record_id`.
- Attachment identities and placements.
- Provenance references.

Information lost before the envelope:

- Engine package, drive package, joystick, Seakeeper options, Raymarine options, HVAC/refrigeration/communications details.
- Formula source URLs and build/pricing metadata.
- Public story configuration.
- Legacy `asset_photos` and `system_photos`.
- `system_readiness` rows.

## 9. Current Asset Brief Output

Relevant code:

- `supabase/functions/_shared/kaiAssetBrief.ts:458` builds the brief.
- `supabase/functions/_shared/kaiAssetBrief.ts:464` derives missing facts.
- `supabase/functions/_shared/kaiAssetBrief.ts:467` returns the final brief.

Current output summary:

| Field | Value |
| --- | --- |
| `brief_status` | `complete` |
| Headline | `Keepr understands this asset well` |
| Subheadline | `Identity, history, evidence, and continuity context are present for stewardship review.` |
| Known fact count | 24 |
| Missing / uncertain fact count | 29 |
| Highest-value next question | `A system is missing model or serial identity.` |

Current brief tension:

- The brief status and headline read as strong/completed.
- The readiness cards still show identity, systems, and evidence as needing attention.
- The missing-fact list is large because broad imported systems do not have component identity and attachments are not processed.

## 10. Current Bounded Interpretation and Validation Output

Relevant code:

- `supabase/functions/_shared/kaiInterpretation.ts:546` builds interpretation.
- `supabase/functions/_shared/kaiInterpretation.ts:561` checks provider availability.
- `supabase/functions/_shared/kaiInterpretation.ts:563` returns deterministic fallback when no provider exists.

Current output summary:

| Field | Value |
| --- | --- |
| `interpretation_status` | `unavailable` |
| Provider | none supplied |
| Validation | valid deterministic fallback |
| Summary | mirrors the brief headline/subheadline |
| Proposed plan status | `action_proposed` |
| Proposed step count | 2 |
| Proposed steps | Add missing evidence; review open gaps |

Confirmed behavior:

- No model call was made.
- No action was executed.
- The fallback plan is generated from deterministic gaps.
- The current fallback does not understand Formula-specific option richness because that richness disappeared before the brief.

## 11. Information-Loss Analysis

Where knowledge disappears:

1. Public KAC resolver
   - Live Formula asset resolves, but only `id`, `name`, and `kac_id` are returned.
   - Owner-configured public actions in `assets.extra_metadata.publicConfig.actions.actionsEnabled` are not returned by `kac-resolve`.

2. Manifest identity collector
   - Uses asset identity fields and `master_assets`, but not `assets.make`, `assets.model`, `assets.year`, `assets.length_feet`, `assets.hull_material`, `assets.engine_type`, `assets.location`, or `assets.extra_metadata`.

3. Manifest system collector
   - Selects system row identity fields only.
   - Drops `systems.metadata.options[]`, where most Formula configured systems live.
   - Drops `systems.metadata.playbook`, where Plumbing & Sanitation already has useful operational knowledge.
   - No `boat_systems` rows exist to provide verified marine component identities.

4. Timeline collector
   - Correctly deduplicates service records with paired Moments.
   - Does not retain `service_records.notes`, `location`, `cost`, or `extra_metadata` source/pricing/stewardship context.

5. Attachment collector
   - Correctly keeps one attachment identity plus multiple placements.
   - Does not include extracted text or signed URLs, as intended.
   - Current `doc_type` is `unknown` for all Formula attachments, including owner manuals/build sheet PDFs.

6. Context Envelope / Asset Brief
   - Cannot surface details already lost at Manifest stage.
   - Treats many broad system rows as missing model/serial instead of recognizing imported configured-option bundles.

7. Public page / UI
   - Public app shell metadata confirms the public page exists.
   - Public story code uses `public_asset_story_timeline`, `systems(id,name)`, and public media fetches.
   - The public UI can look organized because systems, photos, and timeline exist, but it does not expose the deeper option-level meaning from JSON.

Security/UI note:

- The live public HTML includes signed storage image URLs in OG/Twitter metadata. This report does not reproduce those tokens or paths. This should be reviewed separately because signed media URLs in public HTML may leak time-limited storage access and owner-scoped path structure.

## 12. Current UI Gap

Current public/app code paths:

- `screens/PublicActionScreen.js:274` reads `resolved.public_config`, but the current public `kac-resolve` contract does not return it.
- `screens/PublicActionScreen.js:324` falls back from configured actions to backend allowed actions.
- `screens/PublicKeeprStoryScreen.js:314` reads `asset.extra_metadata.publicConfig`.
- `screens/PublicKeeprStoryScreen.js:552` queries `public_asset_story_timeline`.
- `screens/PublicKeeprStoryScreen.js:558` queries only `systems(id, name)`.
- Authenticated boat story code queries `service_records`, `story_events`, `systems(id,name)`, and attachment placements/media.

Visible/organized today:

- Asset resolves publicly.
- Public page shell and metadata show `KeeprAfloat!`.
- Story systems can list the 15 broad system names.
- Story timeline can show service records if exposed by `public_asset_story_timeline`.
- Media/hero/gallery can show through attachment placements and media fetches.

Not visibly intelligent today:

- The page does not explain that Propulsion includes twin MerCruiser 8.2L MAG HO ECT 430, Bravo Three X, joystick piloting, Mercury 1st Mate, and Captain's Call Exhaust.
- It does not split Seakeeper 4 and Seakeeper Ride 750 into meaningful installed capabilities.
- It does not surface Raymarine, FLIR, Starlink, HVAC, refrigeration, or security options as first-class configured facts.
- It does not show which facts are exact, configured, provisional, inferred, or unresolved.
- It does not expose identity maturity or the difference between broad bundle rows and verified component instances.

## 13. Build 3A Requirements

Build 3A should be a deterministic intelligence extraction/carry-forward build, not universal ingestion.

Required existing live fields to collect:

- `assets.year`, `make`, `model`, `asset_subtype`, `hull_material`, `length_feet`, `engine_type`, `engine_hours`, `location`, `purchase_date`, `data_source`, `asset_mode`, `commercial_entity`.
- `assets.extra_metadata.model`, `model_year`, `oem`, `source`, `pricing`, `configuration`, `stewardship_context`, and `publicConfig`.
- `master_assets.manufacturer`, `model`, `model_year`, `hin`, `vin`, `serial_number`.
- `systems.metadata.options[]`, `systems.metadata.summary`, `systems.metadata.origin`, `systems.metadata.playbook`.
- `service_records.notes`, `location`, `cost`, `extra_metadata.source`, `extra_metadata.pricing`, `extra_metadata.stewardship_context`.
- `asset_photos` and `system_photos` as legacy media evidence/projection inputs.
- `system_readiness` as a currently sparse but relevant system-state surface.

JSON paths currently ignored:

- `assets.extra_metadata.configuration.engine_package`
- `assets.extra_metadata.configuration.drives`
- `assets.extra_metadata.configuration.drive_type`
- `assets.extra_metadata.configuration.joystick_piloting`
- `assets.extra_metadata.configuration.stabilization[]`
- `assets.extra_metadata.source.builder_url`
- `assets.extra_metadata.source.details_url`
- `assets.extra_metadata.pricing.*`
- `assets.extra_metadata.stewardship_context.*`
- `assets.extra_metadata.publicConfig.*`
- `systems.metadata.options[]`
- `systems.metadata.playbook`

Relationship surfaces to include:

- `asset_photos`
- `system_photos`
- `system_readiness`
- richer `systems.metadata`
- richer `service_records.extra_metadata`
- optional `locations` when rows exist
- optional warranty/assurance rows when rows exist

Source semantics to return:

| Source shape | Proposed meaning |
| --- | --- |
| `assets` scalar identity | exact when directly stored |
| `master_assets` identity | canonical/horizontal identity |
| `asset_identifiers` | exact identifier when present |
| `assets.extra_metadata.configuration` | configured option, not verified installed component |
| `systems.metadata.options[]` | configured/provisional system option |
| `systems` row | KAC-specific system bundle |
| `boat_systems` row | verified/probable installed marine component, if present |
| manual/service row | owner-reported or service-reported operational event |
| attachment placement | evidence relationship |
| public config | presentation/action policy, not asset fact |

Deterministic intelligence possible without new ingestion:

- Formula build configuration summary.
- Marine system option extraction.
- System maturity labels.
- Missing HIN / serial / component identity flags.
- Build sheet/manual attachment classification from titles and placement.
- Owner-facing “known vs missing” brief.
- No-action or “review identity/evidence gaps” outcomes grounded in current rows.

## 14. Build 3B Requirements

Build 3B should make the owner experience immediately intelligible without inventing OEM data.

Owner should see:

- Asset identity: 2026 Formula 380 Super Sport Crossover, boat/powerboat, 38 ft fiberglass.
- KAC and canonical asset identity.
- Current lifecycle: active.
- Storage context: marina-kept freshwater, Lake Norman Yacht Club Marina.
- Configured build highlights:
  - MerCruiser Twin 8.2L MAG HO ECT 430
  - Bravo Three X stern drive
  - Joystick piloting
  - Seakeeper 4 Gyro
  - Seakeeper Ride 750
  - Raymarine Twin Axiom 2 XL 16 with HD Radar
  - FLIR M332 Thermal Camera
  - Starlink Satellite Internet
  - Satellite TV HD System
  - 18,000 BTU Cockpit A/C
  - Aft cockpit cooler/refrigerator/freezer coils
  - Hydraulic extended swim platform
  - Mercury 1st Mate
  - Electronic security safe
- Evidence library:
  - Build sheet PDFs
  - Formula owner manuals
  - Mercury/sterndrive PDF
  - Warranty information link
  - Showcase photos
- What is missing:
  - HIN
  - engine/drive/stabilizer/electronics serials
  - real engine hours
  - component-level verified identities
  - processed document classifications
  - warranty obligations tied to this asset

Identity maturity display:

- Asset: verified canonical KAC record.
- Master asset: present.
- HIN: missing.
- Broad systems: classified/probable configured bundles.
- Component systems: not yet verified instances.
- Knowledge connected: only Plumbing & Sanitation has playbook-like metadata today.
- Continuity active: service records and attachments exist, but still sparse.

First recommended plan/action:

- Do not recommend generic marine maintenance merely because the boat is old, configured, or has available capabilities.
- The first grounded owner action should be: review/confirm missing identity and evidence gaps for the major configured systems, starting with HIN and propulsion/stabilization/electronics component identities.
- A valid no-action outcome remains possible for service work if no open finding, documented interval, usage threshold, warranty obligation, or owner request exists.

## 15. Blockers and Unknowns

Confirmed blockers:

- No safe authenticated user JWT was available; live Manifest endpoint could not be invoked as the actual owner/steward.
- Direct Postgres pooler connection lacked a password; canonical inspection used Supabase REST `GET`.
- Service-role credential is present locally; this inspection used read-only requests but the credential itself is not read-only.

Data unknowns:

- HIN is not present.
- Engine hours are not present.
- No component serial numbers are present.
- No `boat_systems` extension rows exist.
- No warranty requirements are linked directly to the Formula asset.
- No Keepr Pro/provider relationships are linked by `keepr_pro_id`.
- No Hub affiliation was confirmed.
- No enrichment run exists for the asset.

Product unknowns:

- Whether public story should expose `publicConfig.actions.actionsEnabled` via resolver or a richer story resolver.
- Whether public OG metadata should continue embedding signed image URLs.
- Whether broad configured-option bundles should become first-class child associations without schema changes or wait for a later normalized component model.

## 16. Explicit Recommendation

Proceed with Build 3A before any UI-first Build 3B.

Build 3A should make the current live Formula knowledge survive the Manifest and Context path:

- collect `assets.extra_metadata` selectively;
- collect selected `systems.metadata` option/playbook fields;
- classify configured options distinctly from verified installed components;
- include legacy photo/system readiness surfaces where they already exist;
- preserve source/provenance and authority;
- keep storage paths, signed URLs, extracted text, and personal data excluded.

Then Build 3B can safely make the owner experience intelligent:

- show known configured Formula systems;
- show identity maturity;
- show evidence and gaps;
- avoid unsupported maintenance recommendations;
- recommend only source-supported next steps.

The live product currently knows a lot about this Formula, but much of that knowledge is trapped in JSON metadata and broad bundle rows. Keepr looks organized today; Build 3A is what lets it become intelligent without inventing anything.

## Queries and Tests Run

Live read-only queries:

- Deployed public resolver call to `kac-resolve` for `KPR-6QEH-927H`: `200`.
- Supabase REST `GET` inventory for `assets`, `master_assets`, `asset_identifiers`, `systems`, extension system tables, attachments, placements, timeline/service tables, media/photo tables, readiness, stewardship, transfers, reminders, assurance, enrichment, and public links.
- Public page HTTP `GET`/`HEAD` for `https://app.keeprhome.com/k/KPR-6QEH-927H`: `200`.
- Current shared-layer pipeline run locally against sanitized live snapshot:
  - Manifest: `complete`, 52 associations.
  - Context Envelope: `complete`.
  - Asset Brief: `complete`, 24 known facts, 29 missing/uncertain facts.
  - Interpretation: deterministic fallback, `unavailable` because no provider was supplied.

Automated tests:

```text
node --test tests/profile-security.test.mjs tests/kac-manifest-foundation.test.mjs tests/kac-resolvers.test.mjs tests/kac-manifest-collectors.test.mjs tests/kac-intelligence-manifest.test.mjs tests/kac-manifest-live-rls-remediation.test.mjs tests/kac-context-envelope.test.mjs tests/kai-asset-brief.test.mjs tests/kai-interpretation.test.mjs tests/kai-interpretation-orchestration.test.mjs tests/kai-authority-reconciliation.test.mjs
```

Result:

- 198 passing
- 0 failing

## Change Confirmation

Only this report was created.

No production data, schema, RLS, grants, storage objects, endpoints, UI files, migrations, deployments, backfills, or synthetic records were changed.
