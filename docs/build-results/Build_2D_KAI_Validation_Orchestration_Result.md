# Build 2D KAI Validation Orchestration Result

## Implementation Status

Build 2D is implemented locally as a shared-layer-only validation and orchestration boundary. It coordinates:

`KaiAssetBrief -> model request -> raw model result -> strict parsing -> deterministic validation -> accepted KaiInterpretation`

or fail-closed deterministic fallback.

No UI, endpoint, deployment, production model provider, database migration, RLS change, grant change, production-data change, Manifest behavior change, Context Envelope behavior change, Asset Brief behavior change, Actions API execution, reminders, scheduling, Keepr Pro assignment, Public Story projection, report generation, embeddings, vector search, or autonomous workflow was added.

## Commit Status

Implementation committed:

- `525e969` - `Build fail-closed KAI validation orchestration`

This result report was updated after the implementation commit with the final commit hash, exact implementation files committed, final test total, deployment status, endpoint status, production-provider status, and unresolved decisions before Build 2E.

## Deployment Status

Not deployed.

## Endpoint Status

No endpoint was created.

## Production-Provider Status

No production provider was selected or integrated.

## Exact Files Changed

Implementation commit `525e969` includes exactly:

- `package.json`
- `supabase/functions/_shared/kaiInterpretation.ts`
- `supabase/functions/_shared/kaiInterpretationOrchestrationTypes.ts`
- `supabase/functions/_shared/kaiInterpretationOrchestration.ts`
- `tests/kai-interpretation-orchestration.test.mjs`

Result report file:

- `docs/build-results/Build_2D_KAI_Validation_Orchestration_Result.md`

## Final Contracts

`KaiInterpretationOrchestrationResult` includes:

- orchestration version
- generated timestamp
- purpose
- KAC
- canonical asset ID
- source brief version
- source brief status
- orchestration status
- interpretation source
- accepted interpretation
- validation result
- fallback reason
- provider result metadata
- timing metadata
- retry metadata
- sanitized diagnostics
- exclusions and redactions
- provenance summary
- telemetry events

Supporting contracts:

- `KaiOrchestrationStatus`
- `KaiValidationErrorCode`
- `KaiValidationStageResult`
- `KaiOrchestrationValidationResult`
- `KaiProviderMetadata`
- `KaiTimingMetadata`
- `KaiRetryMetadata`
- `KaiTelemetryEvent`

## Input-Gate Rules

The orchestration input gate short-circuits before any provider call when:

- purpose is unsupported
- brief identity is malformed
- source brief version is unsupported
- brief is restricted
- prohibited fields are present
- capability flags are inconsistent
- provenance references are malformed

Restricted, unsupported-purpose, and invalid-input cases do not retry and do not invoke the provider.

## Retry Policy

Build 2D uses a bounded retry policy:

- maximum two attempts total
- retry only for provider `timeout`, `provider_error`, or `unavailable`
- no retry for invalid input, restricted brief, unsupported purpose, parse failure, validation failure, privacy violation, capability expansion, unsupported claim, or action-threshold failure
- retries reuse the same approved `KaiModelInput`
- retry metadata is sanitized

No backoff, scheduling infrastructure, or persistent retry queue was added.

## Parsing Rules

Strict parsing rejects:

- invalid JSON
- prose before or after JSON
- multiple JSON objects
- missing required fields
- unknown top-level fields in strict mode
- multiple follow-up questions
- malformed plan structures

Malformed output is not partially accepted.

## Validation Stages

Validation returns stage results for:

1. schema
2. source reference
3. grounding
4. confidence
5. visibility
6. privacy
7. asset domain
8. capability subset
9. action threshold
10. no-action consistency
11. non-execution
12. language and overclaim

Each stage reports pass/fail, stable error codes, rejected IDs, and sanitized diagnostics.

## Error-Code Vocabulary

Stable Build 2D error codes include:

- `UNSUPPORTED_PURPOSE`
- `INVALID_BRIEF`
- `RESTRICTED_BRIEF`
- `SCHEMA_INVALID`
- `PARSE_FAILED`
- `SOURCE_REFERENCE_MISSING`
- `SOURCE_REFERENCE_UNKNOWN`
- `CLAIM_UNGROUNDED`
- `CONFIDENCE_PROMOTED`
- `VISIBILITY_EXPANDED`
- `PRIVATE_IDENTIFIER_EXPOSED`
- `PROHIBITED_FIELD_PRESENT`
- `DOMAIN_ASSUMPTION_INVALID`
- `CAPABILITY_DENIED`
- `ACTION_THRESHOLD_NOT_MET`
- `NO_ACTION_HAS_STEPS`
- `ACTION_EXECUTION_ATTEMPTED`
- `MULTIPLE_QUESTIONS`
- `UNSUPPORTED_INTERVAL`
- `UNSUPPORTED_PRICE`
- `UNSUPPORTED_WARRANTY`
- `UNSUPPORTED_SAFETY_CLAIM`
- `OVERSTATED_COMPLETENESS`
- `REVIEW_DATE_INVENTED`
- `UNKNOWN_USAGE_ASSUMED`

## Fail-Closed Behavior

When parsing or validation fails:

- the whole model interpretation is rejected
- rejected claims are not returned
- accepted fragments are not merged
- provider wording is not preserved
- deterministic fallback is returned
- only sanitized metadata and error codes are retained

There is no best-effort merge.

## Fallback Behavior

Fallback is generated only from the approved `KaiAssetBrief`. It preserves:

- provenance
- visibility
- confidence
- redactions
- no-action rules
- capability limits

Fallback may return `no_action_required`, `needs_clarification`, `restricted`, `unavailable`, or `invalid` plan states.

## No-Action Confirmation

Build 2D preserves Build 2C Amendment A:

- valid `no_action_required` output is accepted
- zero-step plans are valid
- rationale and supporting evidence are required
- no hidden reminders, due dates, service requests, or arbitrary review milestones are allowed
- capability availability alone cannot create action

## Telemetry Contract

Telemetry events are typed but not persisted.

Supported events include:

- `orchestration_started`
- `model_call_started`
- `model_call_completed`
- `model_call_failed`
- `retry_started`
- `parse_failed`
- `validation_failed`
- `interpretation_accepted`
- `fallback_returned`
- `restricted_short_circuit`
- `invalid_input_short_circuit`

Telemetry excludes KAC, canonical asset ID, owner ID, brief facts, prompts, model output, contact data, and private identifiers.

## Test Totals

Command run:

`node --test tests/profile-security.test.mjs tests/kac-manifest-foundation.test.mjs tests/kac-resolvers.test.mjs tests/kac-manifest-collectors.test.mjs tests/kac-intelligence-manifest.test.mjs tests/kac-manifest-live-rls-remediation.test.mjs tests/kac-context-envelope.test.mjs tests/kai-asset-brief.test.mjs tests/kai-interpretation.test.mjs tests/kai-interpretation-orchestration.test.mjs`

Result:

- 176 passing
- 0 failing

## Security And Privacy Confirmation

Build 2D confirms:

- no database calls
- no production provider calls
- no endpoint or deployment behavior
- no raw prompts in orchestration results
- no raw model output in orchestration results
- no secrets or raw provider errors
- no private identifiers in telemetry
- no hidden/restricted content reconstruction
- no capability broadening
- no action execution

## Acceptance-Case Results

- Porsche accepted interpretation: valid model output passes, source references are preserved, plan steps meet action threshold, one question maximum is enforced, and capabilities are not broadened.
- Porsche no-action case: valid `no_action_required` is accepted with zero steps and grounded rationale.
- Porsche invalid model output: invented intervals, unsupported actions, unsupported prices, and multiple questions fail closed to deterministic fallback.
- Regal marine privacy/domain case: HIN exposure, vehicle assumptions, and unsupported marine work fail closed with privacy/domain errors.
- Restricted brief: no provider call, restricted orchestration result, deterministic restricted fallback.
- Provider unavailable: bounded retry where eligible, deterministic fallback, sanitized provider metadata.

## Adversarial-Test Results

Tests cover provider output that attempts to:

- include prompt-injection or broader-context requests
- include raw SQL
- echo private identifiers
- cite unknown sources
- expand visibility
- add denied capabilities
- add reminder or scheduling metadata
- invent review dates or service intervals
- treat age or generic maintenance as action justification
- assume unknown usage
- mix vehicle and marine concepts
- include partial valid and partial invalid content
- return multiple JSON objects
- include prose before/after JSON
- leak private telemetry

All fail closed or are rejected before provider invocation as appropriate.

## Unresolved Decisions Before Build 2E

- How Build 2E should distinguish requirements, professional findings, recommendations, standard practices, owner preferences, and KAI interpretations.
- Which production model provider and structured-output mechanism should be selected later.
- Whether orchestration metadata should be persisted, and where, without storing brief content.
- How future UI should present fallback reasons and stage-level validation failures.
- Whether telemetry should be sampled, aggregated, or fully omitted in early production.
