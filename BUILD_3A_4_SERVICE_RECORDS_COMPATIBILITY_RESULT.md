# Build 3A.4 Service Records Compatibility Result

Date: 2026-07-15 12:00:18 EDT  
UTC: 2026-07-15T16:00:18Z

## Summary

Build 3A.4 repaired the hosted KAC intelligence timeline collector so `service_records` is the canonical service and maintenance history source. The collector no longer selects the retired/nonexistent `service_records.price` column and no longer actively queries or normalizes `timeline_records` in the Build 3A/shared intelligence path.

## Commit

- Implementation commit: `c0cba5cd63450a045e35442ff5d8965792644f1c`
- Branch: `release/build-3a-preview`
- Commit message: `fix(kai): standardize timeline intelligence on service records`
- Push status: pushed to `origin/release/build-3a-preview`

## Deployed Function

- Supabase project ref: `jjzjuqxysucqutgjnrkk`
- Function deployed: `kac-intelligence-orchestration`
- Deploy command: `supabase functions deploy kac-intelligence-orchestration --project-ref jjzjuqxysucqutgjnrkk`
- Deploy result: succeeded
- JWT verification: remains enabled by `supabase/config.toml`
- Model provider: none configured
- Schema/RLS/grants/storage/production data: unchanged

## Exact Files Changed

- `supabase/functions/_shared/kacManifestTimeline.ts`
- `supabase/functions/_shared/kacContextEnvelope.ts`
- `supabase/functions/_shared/kacIntelligenceOrchestration.ts`
- `supabase/functions/kac-intelligence-orchestration/index.ts`
- `supabase/functions/kac-intelligence-manifest/index.ts`
- `tests/kac-manifest-collectors.test.mjs`
- `tests/kac-context-envelope.test.mjs`
- `tests/kac-intelligence-manifest.test.mjs`
- `tests/kai-asset-brief.test.mjs`
- `tests/kai-interpretation.test.mjs`

## Code Changes

- Removed `price` from the `service_records` select list.
- Removed `price?: number | null` from the service-record row shape.
- Changed service record cost mapping from `row.cost ?? row.price` to `row.cost`.
- Removed active `timeline_records` query and normalization from the Manifest timeline collector.
- Removed `timeline_records` from Build 3A/shared grouping and classification lists.
- Updated shared-layer tests so canonical service/history facts use `service_records`.

## Tests

Focused collector tests:

```bash
node --test tests/kac-manifest-collectors.test.mjs
```

Result: `23 passing, 0 failing`

Directly related shared intelligence tests:

```bash
node --test tests/kac-context-envelope.test.mjs tests/kac-intelligence-manifest.test.mjs tests/kai-asset-brief.test.mjs tests/kai-interpretation.test.mjs tests/kac-intelligence-orchestration.test.mjs
```

Result: `108 passing, 0 failing`

Full persistent suite:

```bash
node --test tests/*.test.mjs
```

Result: `217 passing, 0 failing`

## Web Build

```bash
npm run build:web
```

Result: succeeded. Expo web export completed to `dist`.

## Hosted Boundary Checks

Unauthenticated POST:

- Request: `POST /functions/v1/kac-intelligence-orchestration`
- Result: `401`
- Error code: `UNAUTHORIZED_NO_AUTH_HEADER`
- Interpretation: JWT verification remains enforced.

OPTIONS/CORS:

- Request: `OPTIONS /functions/v1/kac-intelligence-orchestration`
- Result: `200`
- Body: `ok`
- Interpretation: CORS preflight remains functional.

## Hosted Owner Validation

Required real-owner validations were not executed by Codex after deployment because this environment does not have access to the existing browser sessions for:

- `demo@keeprhome.com`
- `adrake@keeprhome.com`

No access tokens, refresh tokens, passwords, or personal sessions were requested, printed, copied, stored, or fabricated.

Expected owner validation cases still requiring existing authenticated browser sessions:

- Formula `KPR-6QEH-927H` as `demo@keeprhome.com`
  - `asset_stewardship`
  - `maintenance_planning`
- Porsche `KPR-6GV2-MJ6W` as `adrake@keeprhome.com`
  - `asset_stewardship`
  - `maintenance_planning`

Expected result:

- HTTP `200`
- owner authorization
- deterministic response
- timeline collector complete
- no `service_records` `partial_query_failure`
- no forbidden-value leakage
- no write-back

## Concealment Regression

Reciprocal concealment was not re-run by Codex after deployment because it requires authenticated browser sessions.

Previously confirmed before Build 3A.4:

- `demo@keeprhome.com` against Porsche `KPR-6GV2-MJ6W` returned concealed `404 asset_not_found`.
- `adrake@keeprhome.com` against Formula `KPR-6QEH-927H` returned concealed `404 asset_not_found`.

Expected after Build 3A.4: unchanged, because the repair did not modify authorization or KAC resolution logic.

## Timeline Collector Status

Tested production-shaped behavior:

- `service_records` query does not select `price`.
- `service_records.cost` is preserved.
- Production-shaped `service_records` rows without `price` do not emit `partial_query_failure`.
- Formula-like manifest status remains `complete` when all collectors complete.
- Active Build 3A/shared intelligence code has no `timeline_records` query or classification dependency.

## Remaining Diagnostics

No local test diagnostics remain for the removed `service_records.price` defect.

Hosted post-deploy owner diagnostics remain pending existing authenticated browser-session validation.

## Security Review

Confirmed:

- No schema changes.
- No migrations.
- No RLS changes.
- No grant changes.
- No storage changes.
- No production-data writes.
- No synthetic users.
- No model provider.
- No Actions or reminders.
- No Build 3B work.
- No Build 3L work.
- Legacy UI/helper files were not modified.

## Rollback Point

Rollback to the previous Build 3A preview branch state before commit:

- Previous branch head: `041c487`
- Current implementation commit: `c0cba5cd63450a045e35442ff5d8965792644f1c`

Function rollback option:

- Redeploy the prior `kac-intelligence-orchestration` source from commit `041c487`.

## GO / NO-GO

Build 3B: **NO-GO until hosted owner validation is completed after this deployment.**  
Build 3L: **NO-GO until hosted owner validation is completed after this deployment.**

Reason: code, tests, build, deployment, and unauthenticated boundary checks are clean, but the required post-deploy authenticated owner and reciprocal concealment matrix has not been re-run by Codex because safe authenticated sessions are unavailable in this environment.
