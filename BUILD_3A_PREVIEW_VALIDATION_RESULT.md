# Build 3A Preview Validation Result

Date/time: 2026-07-15 09:30 EDT

## Source

- Branch: `release/build-3a-preview`
- Build 3A implementation commit: `d0e56b5bd19d46bc918ec652b7dbd1f035c31e29`
- Clean-checkout fixture repair commit: `a7cb42f597169d72bd8a7adfbfced61fe165f269`
- Deployment source commit: `a7cb42f597169d72bd8a7adfbfced61fe165f269`
- Rollback point: `d0e56b5bd19d46bc918ec652b7dbd1f035c31e29` for Build 3A implementation, or prior preview deployment `dpl_EPcBhRwsjzmeEGFUUiidApyZaAwh`

The fixture repair adds a sanitized deterministic `data/regal_3300_keepr_import.json` so the clean checkout reproduces the Build 2.x and Build 3A test baseline. It removes dealer URL, address, phone, storage paths, signed URLs, credentials, and contact fields from the untracked local source fixture.

## Deployment

- Vercel team: `see-you-then`
- Vercel project: `keepr-app`
- Vercel project ID: `prj_SEh4lqulA6e3DuEjJLRERR1fCutV`
- Environment: Preview
- Deployment ID: `dpl_BaBgDDC7Hj11FQvS3TrEJRYLjPWj`
- Preview URL: `https://keepr-b7w7uxj22-see-you-then.vercel.app`
- Preview alias: `https://keepr-app-git-release-build-3a-preview-see-you-then.vercel.app`
- Deployment status: READY
- Production deployment: none

The Preview deployment was created by Vercel Git integration after the branch push. No `--prod` deploy was run.

## Tests

Build 3A suite:

```sh
node --test tests/kac-intelligence-orchestration.test.mjs
```

Result: 11 passing, 0 failing.

Full persistent suite:

```sh
node --test tests/profile-security.test.mjs tests/kac-manifest-foundation.test.mjs tests/kac-resolvers.test.mjs tests/kac-manifest-collectors.test.mjs tests/kac-intelligence-manifest.test.mjs tests/kac-manifest-live-rls-remediation.test.mjs tests/kac-context-envelope.test.mjs tests/kai-asset-brief.test.mjs tests/kai-interpretation.test.mjs tests/kai-interpretation-orchestration.test.mjs tests/kai-authority-reconciliation.test.mjs tests/kac-intelligence-orchestration.test.mjs
```

Initial clean-worktree result before fixture repair: 203 passing, 6 failing, all caused by missing `data/regal_3300_keepr_import.json`.

Final clean-worktree result after sanitized fixture repair: 209 passing, 0 failing.

## Web Build

Command:

```sh
npm run build:web
```

Result: succeeded. Expo exported web assets to `dist`.

Generated-output review found no concrete service-role secret value, refresh token value, signed URL value, extracted text, raw SQL, or stack trace in the generated static build. The bundled application code does contain generic auth/storage code strings such as `access_token` and `storage_path`, which are implementation labels rather than secret values.

## Hosted Smoke Results

Vercel deployment inspection:

- `vercel inspect dpl_BaBgDDC7Hj11FQvS3TrEJRYLjPWj --scope see-you-then`
- Status: READY
- Target: Preview
- Build listed `api/og/k/[kac]`

Preview protection:

- Direct unauthenticated Preview HTTP requests return Vercel SSO `302`.
- Temporary Vercel share access was used for browser validation.
- Preview protection was not disabled.

App shell/sign-in:

- Root Preview route opens and redirects to `/auth`.
- Auth screen renders sign-in and create-account controls.
- Static Auth images load with nonzero dimensions.

Formula public KAC:

- Route: `/k/KPR-6QEH-927H`
- Browser result: `PublicKeeprStory`
- Visible facts include `KeeprAfloat!`, KAC `KPR-6QEH-927H`, year `2026`, builder `Formula`, model `380`, length `38 ft`, timeline/showcase/actions tabs, and `OEM Build Record — Formula 380 SSC (Dream Build)`.

Porsche public KAC:

- Route: `/k/KPR-6GV2-MJ6W`
- Browser result: `PublicKeeprStory`
- Visible facts include `Porsche Boxter S`, KAC `KPR-6GV2-MJ6W`, timeline entries, ownership continuity, and existing public story content.

Other public asset/story route:

- Porsche route above served as the second existing public story route.

Static/media:

- Static app assets load.
- Formula public story media loads, but see security finding below.

## Build 3A Hosted Endpoint Validation

Blocked for hosted endpoint checks:

- `supabase/functions/kac-intelligence-orchestration` is a Supabase Edge Function source file, not a Vercel route.
- It was intentionally not deployed to Supabase in this pass.
- No safe authenticated production JWTs were created or used.

Therefore the following Build 3A endpoint matrix was not live-tested against a hosted endpoint:

- unauthenticated request
- owner request
- direct steward request
- organization steward request
- viewer request
- unauthorized authenticated request
- disputed non-admin request
- platform admin narrow-resolution behavior

The same behaviors are covered by persistent tests, including viewer `403`, unauthorized concealed `404 asset_not_found`, disputed restricted behavior, platform-admin narrow resolution, invalid model output fail-closed behavior, deterministic fallback, and no database write path.

## Formula Acceptance

Persistent Build 3A tests confirm the orchestration can safely express configured or provisional context for Formula metadata including:

- 2026 Formula 380 SSC
- MerCruiser Twin 8.2L MAG HO ECT 430
- Bravo Three X
- joystick piloting
- Seakeeper 4
- Seakeeper Ride 750
- Raymarine
- FLIR
- Starlink
- cockpit HVAC
- refrigeration
- hydraulic swim platform
- Mercury 1st Mate
- security safe

No configured option is promoted to a verified installed component in the Build 3A output. Hosted public story UI currently shows only existing public-story facts and does not expose the Build 3A orchestration response because the Supabase endpoint is not deployed.

## Service-Record Compatibility

Local clean tests and web build passed with Build 3A collectors that tolerate partial failures and keep deterministic fallback available.

Hosted endpoint validation for optional `service_records` fields remains blocked because the Build 3A Supabase Edge Function was not deployed. Expected behavior remains:

- partial collector diagnostics if optional columns are missing or unavailable
- no endpoint crash
- no hidden-data reconstruction
- deterministic brief remains available

## Runtime Logs

Vercel runtime logs for the preview showed:

- `GET /k/KPR-6GV2-MJ6W` status 200
- `GET /k/KPR-6QEH-927H` status 200 with Node deprecation warning `[DEP0169] url.parse()`

The deprecation warning appears in existing hosted route behavior and is not attributable to Build 3A shared modules.

No Build 3A-specific runtime failure appeared in logs.

## Security Review

Confirmed for Build 3A source/tests:

- no production model provider selected
- deterministic fallback remains mandatory
- invalid model output fails closed
- no database writes in Build 3A orchestration
- no schema, migration, RLS, grant, storage, or production-data changes
- no Actions API execution, reminders, scheduling, reports, embeddings, or autonomous workflows
- configured Formula options remain configured/provisional

Blocking hosted finding:

- The existing Formula public story page renders a Supabase signed storage URL for media in the browser DOM.
- This is not emitted by the Build 3A orchestration response, but it violates the preview validation requirement that no response/browser output expose signed URLs or storage-token-bearing media URLs.

No service-role value or credential was printed or committed.

## Warnings And Limitations

- Preview is protected by Vercel Authentication; validation used temporary Vercel share access.
- Build 3A endpoint source was not deployed to Supabase, so hosted authenticated endpoint validation is blocked.
- No safe authenticated production sessions were created or used.
- Existing public-story media currently exposes signed Supabase URLs in rendered image `src` values.
- Vercel runtime logs include an existing Node `url.parse()` deprecation warning.
- Browser-console deep inspection was limited because Playwright is not installed in the repo; `agent-browser` snapshots and Vercel runtime logs were used.

## Recommendation For Build 3B

NO-GO for Build 3B until Andy/KAI explicitly accepts or remediates the existing public-story signed-media URL exposure, and until the Build 3A Supabase endpoint deployment/validation plan is approved if Build 3B depends on hosted Build 3A responses.

Build 3A code itself is test-green and deterministic, but the hosted preview security gate is not fully clean.

## Prohibited Changes Not Made

- No production deployment.
- No Supabase function deployment.
- No schema, migration, RLS, grant, storage, or production-data change.
- No UI implementation for Build 3A.
- No production model provider configuration or invocation.
- No Build 3B work.
