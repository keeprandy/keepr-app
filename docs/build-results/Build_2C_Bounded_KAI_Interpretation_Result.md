# Build 2C Bounded KAI Interpretation Result

## Implementation Status

Build 2C is implemented locally as a bounded interpretation and proposed-planning layer. It accepts an already-authorized `KaiAssetBrief`, optionally calls a provider-neutral structured model provider, validates the result deterministically, and falls back to a deterministic brief-derived interpretation when the model is unavailable, invalid, unparsable, timed out, or ungrounded.

No UI, endpoint, deployment, database migration, RLS change, grant change, production-data change, Manifest change, Context Envelope change, Asset Brief behavior change, Actions API execution, scheduling, reminders, Keepr Pro assignment, Public Story projection, report generation, embeddings, vector search, or autonomous workflow was added.

## Commit Status

Implementation committed:

- `2950e66` - `Build bounded KAI interpretation and planning`

This result report was updated after the implementation commit and includes the final commit hash, exact implementation files committed, final test total, Amendment A confirmation, no-action contract confirmation, deployment status, endpoint status, and unresolved decisions before Build 2D.

## Deployment Status

Not deployed.

## Endpoint Status

No endpoint was created.

## Exact Files Changed

Implementation commit `2950e66` includes exactly:

- `package.json`
- `supabase/functions/_shared/kaiInterpretationTypes.ts`
- `supabase/functions/_shared/kaiInterpretation.ts`
- `tests/kai-interpretation.test.mjs`

Result report file:

- `docs/build-results/Build_2C_Bounded_KAI_Interpretation_Result.md`

## Final Contracts

`KaiInterpretation` includes:

- interpretation version
- generated timestamp
- purpose
- KAC
- canonical asset ID
- source brief version
- source brief status
- interpretation status
- summary
- prioritized observations
- current risks or concerns
- evidence limitations
- one follow-up question when clarification is useful
- proposed plan
- source references
- capability references
- exclusions and redactions
- validation result
- sanitized diagnostics

Related contracts:

- `KaiObservation`
- `KaiProposedPlan`
- `KaiPlanStep`
- `KaiFollowUpQuestion`
- `KaiValidationResult`
- `KaiModelInput`
- `KaiModelRequest`
- `KaiModelResult`
- `KaiInterpretationModelProvider`

`KaiProposedPlan` supports:

- `plan_status: action_proposed`
- `plan_status: no_action_required`
- `plan_status: needs_clarification`
- `plan_status: restricted`
- `plan_status: invalid`
- `plan_status: unavailable`
- plain-language rationale
- supporting evidence
- evidence limitations
- reassessment triggers
- optional source-supported next review milestone
- zero ordered steps when no action is justified

Amendment A is included. `no_action_required` is a first-class valid outcome: KAI is not required to manufacture work when the authorized evidence does not justify action.

Callable Build 2C purposes:

- `asset_stewardship`
- `maintenance_planning`

Future purposes remain rejected.

## Prompt And Grounding Rules

The fixed system prompt requires KAI to:

- reason only from the supplied `KaiAssetBrief`
- distinguish facts, uncertainty, missing evidence, and hidden context
- cite source IDs or provenance references for material claims
- avoid inventing dates, service intervals, specifications, prices, warranties, findings, ownership, or history
- avoid safety, valuation, legal, insurance, or mechanical certainty
- preserve asset-type distinctions
- use only permitted capability flags
- propose but never execute actions
- state when evidence is insufficient
- ask no more than one follow-up question
- return structured JSON matching the approved contract

The model input contains only approved Asset Brief fields:

- brief identity
- known facts
- missing or uncertain facts
- recent updates
- attention items
- readiness cards
- evidence summary
- unresolved states
- highest-value next question
- permitted capabilities
- provenance references
- visibility classifications
- exclusions and redactions

It does not include raw Manifest data, raw Context Envelope data, database rows, hidden associations, extracted document text, signed URLs, storage paths, contact data, unrestricted private identifiers, raw errors, credentials, or secrets.

## Validation Rules

The deterministic validator checks:

- material observations are grounded in supplied facts, gaps, readiness dimensions, updates, attention items, or unresolved states
- proposed steps map to enabled Asset Brief capabilities
- proposed steps meet an explicit source-supported action threshold
- denied capabilities are rejected
- steps remain `proposed`
- `no_action_required` plans contain no steps and include rationale plus supporting evidence
- no hidden or restricted content is reconstructed
- private identifier values are not echoed
- no unsupported service interval, price, warranty expiration, finding, repair, safety claim, or full-documentation claim appears
- no cross-domain assumptions are made for marine assets
- confidence and visibility are preserved
- no more than one question is returned
- no action execution metadata appears
- prohibited personal or infrastructure fields are absent

Invalid model output fails closed.

Availability of a capability alone is not valid justification for work. Generic asset-class advice, age alone, elapsed time without a documented interval, low usage ignored by the model, unknown usage treated as known, or an otherwise empty plan cannot force an action.

## Usage-Aware Reasoning

KAI must distinguish:

- elapsed calendar time
- actual mileage
- operating hours
- frequency of use
- seasonal use
- storage or inactivity
- unknown usage

Low mileage or low hours may reduce usage-based urgency. Elapsed time matters only when tied to a documented time-based requirement already present in the brief. Unknown usage should produce uncertainty or a clarification question, not an assumption of heavy use.

## Monitoring Restrictions

Monitor language must not silently create:

- reminders
- due dates
- recurring tasks
- action records
- service requests

A review milestone may be mentioned only when supported by source context such as a documented schedule, maintenance obligation, warranty requirement, seasonal rule, user-selected cadence, or direct owner request.

## Fallback Behavior

Fallback is deterministic and derived only from the Asset Brief:

- brief headline and subheadline
- current brief gaps and readiness
- deterministic highest-value question
- permitted non-executed capabilities
- brief provenance
- brief exclusions and redactions

Fallback proposed plans may contain zero steps. When no action is justified, fallback returns `plan_status: no_action_required`, a rationale, supporting evidence, evidence limitations, and reassessment conditions tied to documented context changes.

Fallback statuses:

- restricted brief -> `restricted`
- missing provider or provider failure -> `unavailable`
- invalid or ungrounded model output -> `invalid`
- partial brief -> `partial`
- attention/unknown brief -> `needs_clarification`
- complete brief with valid grounded output -> `complete`

## Test Totals

Command run:

`node --test tests/profile-security.test.mjs tests/kac-manifest-foundation.test.mjs tests/kac-resolvers.test.mjs tests/kac-manifest-collectors.test.mjs tests/kac-intelligence-manifest.test.mjs tests/kac-manifest-live-rls-remediation.test.mjs tests/kac-context-envelope.test.mjs tests/kai-asset-brief.test.mjs tests/kai-interpretation.test.mjs`

Result:

- 162 passing
- 0 failing

## Security And Privacy Confirmation

Build 2C does not query the database and persistent tests do not make production model calls. Tests confirm no:

- extracted text
- signed URLs
- storage paths
- contact fields
- raw SQL or infrastructure details
- credentials or secrets
- private HIN/VIN echoing
- serial exposure
- denied capability expansion
- action execution
- artificial actions created merely because capabilities are available
- reminder creation or arbitrary review dates in monitor/no-action outputs

## Acceptance-Case Results

- Porsche asset stewardship: recognizes grounded stewardship context, carries evidence gaps, asks the brief's highest-value question, and proposes only permitted non-executed steps.
- Porsche maintenance planning: focuses on maintenance history and proof without inventing service intervals.
- Regal marine context: remains marine-specific, avoids vehicle assumptions, preserves private HIN/serial behavior, and grounds the plan in marine brief content.
- Well-documented low-mileage Porsche: may return `no_action_required` with an empty plan, rationale, source evidence, and reassessment triggers.
- Low-hours marine case: respects documented low hours and does not create unsupported generic marine service work.

## Adversarial-Test Results

Adversarial model outputs fail validation and return deterministic fallback when they attempt to:

- invent service intervals
- invent prices
- invent warranty expiration
- expose private identifiers
- broaden denied capabilities
- add unsupported repairs
- claim the asset is safe
- claim the asset is fully documented
- use vehicle assumptions for a boat
- cite nonexistent source IDs
- return multiple questions
- execute an action
- include contact information
- include raw database or infrastructure details
- create generic maintenance work from age, elapsed time, or available capabilities alone
- assume heavy use when mileage or usage is unknown
- silently create reminders or arbitrary review dates while saying monitor

## Unresolved Decisions

- Which production model provider and structured-output format should be used when an endpoint is later approved.
- Whether provider telemetry should be stored, and where, without exposing brief content.
- Whether model calls should be enabled only for owner/steward roles or also for platform admins.
- Whether future UI should show the deterministic fallback reason.
- Whether future report generation consumes `KaiInterpretation` directly or requires a separate report-safe projection.
- Whether Build 2D should add an endpoint or remain shared-layer only.
