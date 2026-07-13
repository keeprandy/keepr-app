# Build 2B KAI Asset Brief Result

## Implementation Status

Build 2B is implemented locally as a deterministic shared transformation layer. It creates a `KaiAssetBrief` from an already-authorized `KacContextEnvelope`.

No endpoint, UI, database migration, RLS change, grant change, production-data change, LLM call, RAG, embedding, recommendation, scheduling, Actions API execution, Keepr Pro workflow, or report-generation behavior was added.

## Commit Status

Implementation committed:

- `96006d2` - `Build deterministic KAI asset brief foundation`

This result report was created before the implementation commit and updated after the implementation commit with the final commit hash, committed files, final test total, deployment status, endpoint status, and unresolved Build 2C decisions.

## Deployment Status

Not deployed. Build 2B introduces no deployable endpoint.

## Endpoint Status

No endpoint was created.

## Exact Files Changed

Implementation commit `96006d2` includes exactly:

- `package.json`
- `supabase/functions/_shared/kaiAssetBriefTypes.ts`
- `supabase/functions/_shared/kaiAssetBrief.ts`
- `tests/kai-asset-brief.test.mjs`

Result report file:

- `docs/build-results/Build_2B_KAI_Asset_Brief_Result.md`

## Final Contracts

`KaiAssetBrief` includes:

- brief version
- generated timestamp
- purpose
- KAC
- canonical asset ID
- asset display identity
- asset type
- lifecycle state
- caller authorization role
- source Envelope status
- brief status
- headline
- subheadline
- current-state summary
- known facts
- missing or uncertain facts
- recent updates
- attention items
- readiness cards
- evidence summary
- unresolved states
- highest-value next question
- permitted next capabilities
- provenance references
- public/private visibility classification
- sanitized diagnostics
- exclusions and redactions

Callable Build 2B purposes:

- `asset_stewardship`
- `maintenance_planning`

Future purposes remain typed but rejected:

- `pre_purchase`
- `sale_readiness`
- `transfer_readiness`
- `insurance_readiness`
- `warranty_review`
- `annual_stewardship_review`

## Deterministic Rules

- Input is an already-authorized `KacContextEnvelope`.
- Output is stable for the same input when `generated_at` is supplied.
- No database calls are made.
- No network, LLM, RAG, embedding, recommendation, action execution, scheduling, or Pro assignment calls are made.
- Source Envelope status, evidence confidence, provenance, asset-type distinctions, visibility semantics, and redactions are preserved.
- Hidden or restricted content is not reconstructed.
- Uncertain facts are not upgraded to verified facts.
- Events and evidence are deduplicated by source fact ID.

## Brief Status Rules

- `restricted`: source Envelope is restricted.
- `partial`: source Envelope is partial.
- `attention`: complete source context has deterministic blocking gaps or important attention items.
- `unknown`: identity or context is insufficient.
- `complete`: source context is complete and no blocking gaps exist.

No score, percentage, or vanity readiness number is produced.

## Evidence-Confidence Rules

Evidence confidence is carried from the Context Envelope without promotion:

- `verified`
- `supported`
- `reported`
- `missing`
- `conflicting`
- `not_visible`
- `not_applicable`

## Readiness Model

Readiness cards are produced for:

- Identity
- Systems
- History
- Evidence
- Maintenance
- Continuity

Each card contains status, one-line summary, supporting fact count, blocking gap count, and whether detail review is allowed. No composite score is calculated.

## Recent-Change Rules

Recent changes are transformed from Envelope `recently_changed_facts` only. Supported deterministic categories include service added, attachment added, document processed, system added, warranty added, finding opened/resolved, lifecycle changed, and evidence state changed.

## Capability Flags

Capabilities are presentation entries carried from the Envelope only:

- Ask KAI
- Review gaps
- Add evidence
- Build maintenance plan
- Create asset brief
- Request service
- Create report

Denied Envelope capabilities remain denied. Capabilities are not executed.

## Security And Privacy Confirmation

The Build 2B transformer excludes prohibited fields and test coverage confirms no:

- extracted text
- signed URLs
- storage paths
- email addresses
- phone numbers
- postal addresses
- unrelated profile data
- raw SQL or database errors
- stack traces
- secrets
- unrestricted attachment metadata

VIN and HIN context remains owner-private. Serial-like values are masked by default.

## Acceptance-Case Results

- Porsche asset stewardship: identity, history, proof, gaps, readiness cards, one next question, and capabilities are present.
- Porsche maintenance planning: systems, maintenance history, latest completed work context, missing maintenance proof, and maintenance readiness are emphasized without invented service intervals.
- Regal marine context: HIN, marine-specific systems, twin-engine-style marine data, and marine-relevant next-question behavior are covered without vehicle-only assumptions.

## Test Totals

Command run:

`node --test tests/profile-security.test.mjs tests/kac-manifest-foundation.test.mjs tests/kac-resolvers.test.mjs tests/kac-manifest-collectors.test.mjs tests/kac-intelligence-manifest.test.mjs tests/kac-manifest-live-rls-remediation.test.mjs tests/kac-context-envelope.test.mjs tests/kai-asset-brief.test.mjs`

Result:

- 142 passing
- 0 failing

## Unresolved Decisions Before Build 2C

- Final UI placement and section ordering for the Intelligence modal, action page, dashboard rollup, and Concierge entry.
- Whether future public-story projection requires an explicit safe-public metadata flag before any fact can become public candidate.
- Whether KAI should ask the highest-value next question directly or display it as a suggested prompt.
- How future report generation should consume the brief without broadening visibility or capabilities.
- Which additional acceptance cases should be added before enabling future purposes.
