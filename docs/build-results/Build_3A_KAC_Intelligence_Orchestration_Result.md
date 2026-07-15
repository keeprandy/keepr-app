# Build 3A.0 / 3A.1 KAC Intelligence Orchestration Result

Date: 2026-07-15

Status: implemented locally for KAI/Andy review. Not committed. Not deployed.

## Files changed

- `supabase/functions/_shared/kacManifestIdentity.ts`
- `supabase/functions/_shared/kacManifestSystems.ts`
- `supabase/functions/_shared/kacManifestTimeline.ts`
- `supabase/functions/_shared/kacIntelligenceOrchestrationTypes.ts`
- `supabase/functions/_shared/kacIntelligenceOrchestration.ts`
- `supabase/functions/kac-intelligence-orchestration/index.ts`
- `tests/kac-intelligence-orchestration.test.mjs`
- `docs/build-results/Build_3A_KAC_Intelligence_Orchestration_Result.md`

## Contracts

Build 3A request version: `3A.0`.

Supported callable purposes:

- `asset_stewardship`
- `maintenance_planning`

Request contract includes:

- one normalized KAC
- authenticated caller context
- one supported purpose
- an already-authorized Manifest
- optional bounded model invocation configuration
- optional stewardship profile and typed authority statements
- deterministic fallback inputs
- optional generated timestamp and telemetry identifier

Build 3A response version: `3A.1`.

Response contract includes:

- canonical asset identity
- safe authorization status
- Manifest status, association groups, exclusions, and collector summaries
- purpose-specific Context Envelope
- deterministic KAI Asset Brief
- bounded interpretation orchestration result
- authority reconciliation result
- one highest-value next question
- permitted capabilities
- provenance references
- confidence summary
- operational status
- sanitized diagnostics
- telemetry identifier

Operational statuses:

- `deterministic`
- `interpreted`
- `fallback`
- `restricted`
- `unavailable`
- `failed`

## Metadata included

Selected `assets` scalar fields may be carried as safe asset identity context:

- year or model year
- make or manufacturer
- model
- asset subtype
- hull material
- length in feet
- engine type
- engine hours
- reported location
- purchase date
- data source
- asset mode
- commercial entity

Selected `assets.extra_metadata` fields may be carried:

- model
- model year
- OEM
- source summary
- pricing metadata
- stewardship context
- public configuration summary
- configuration options

Selected `systems.metadata` fields may be carried:

- options
- summary
- origin
- playbook presence marker only

Selected `service_records` context may be carried:

- notes
- location
- cost or price
- source metadata
- pricing metadata
- stewardship context

Formula-style option/configuration facts are preserved as configured or provisional context. They are not promoted to verified installed components.

## Metadata excluded

Build 3A excludes or strips:

- `attachments.extracted_text`
- signed URLs
- storage paths
- raw URLs from metadata
- email addresses
- phone numbers
- postal addresses
- access tokens
- refresh tokens
- service-role references
- secrets
- raw SQL or stack traces
- unrestricted attachment metadata

Systems playbook contents are not returned; only `playbook_present: true` may be returned.

## Authorization and concealment

The endpoint is authenticated only.

Owner, direct steward, organization steward, and platform admin callers may request supported Build 3A purposes when the underlying Manifest authorization allows access.

Viewer callers are denied with `403`.

Unauthorized authenticated callers receive concealed `404 asset_not_found` behavior.

Platform admins continue to use the narrow admin KAC-resolution path for initial identity resolution only. Association collectors remain caller-RLS scoped.

Disputed non-admin requests remain restricted and do not reconstruct hidden content.

## Provider and fallback behavior

The shared orchestration accepts optional bounded model invocation. If no provider is supplied or the provider is unavailable, invalid, timed out, or fails validation, Build 3A returns deterministic fallback output.

Invalid model output is not partially accepted. The existing Build 2D validation orchestration remains the enforcement layer.

No production model provider was selected or integrated.

## Tests

Commands run:

```sh
node --test tests/kac-intelligence-orchestration.test.mjs
node --test tests/profile-security.test.mjs tests/kac-manifest-foundation.test.mjs tests/kac-resolvers.test.mjs tests/kac-manifest-collectors.test.mjs tests/kac-intelligence-manifest.test.mjs tests/kac-manifest-live-rls-remediation.test.mjs tests/kac-context-envelope.test.mjs tests/kai-asset-brief.test.mjs tests/kai-interpretation.test.mjs tests/kai-interpretation-orchestration.test.mjs tests/kai-authority-reconciliation.test.mjs tests/kac-intelligence-orchestration.test.mjs
```

Results:

- Build 3A suite: 11 passing, 0 failing
- Full persistent suite including Build 3A: 209 passing, 0 failing

## Security behavior

No endpoint deployment was performed.

No UI changes were made for Build 3A.

No schema changes, migrations, RLS changes, grant changes, storage changes, or production-data writes were performed.

No Actions API execution, reminders, scheduling, plan activation, Keepr Pro workflows, Public Story projection, report generation, embeddings, vector search, or autonomous workflows were added.

KAI still cannot query the database directly. Database reads happen only in the authenticated endpoint before the already-authorized Manifest is transformed.

## Unresolved decisions before commit or deployment

- Whether the Build 3A endpoint should be deployed in this form or held until hosted preview validation.
- Whether `service_records.notes`, `location`, `cost`, `price`, and `extra_metadata` are present in every target production environment; missing columns would produce partial collector diagnostics rather than full failure.
- Whether Build 3A should expose any richer platform-admin diagnostic association access in a later build. Current behavior remains least-privilege.
- Whether a production model provider should be selected in a future build. None is selected here.

## Prohibited changes not made

- No endpoint deployment.
- No UI build.
- No schema, migration, RLS, grant, storage, or production-data change.
- No child-system creation.
- No complete Formula configuration normalization.
- No extracted text, signed URL, storage path, contact data, secret, or raw internal error exposure.
- No generic maintenance recommendation creation without source support.
- No partial acceptance of invalid model output.
