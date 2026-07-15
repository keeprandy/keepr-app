# BUILD 2.x Preview Promotion Result

Date/time: 2026-07-15T10:54:45Z

## Source

- Source commit: `9450f5e650e557900f27fab933f14dccdf0a7e93`
- Promotion commit: `8fac5d33d9c8b81bacc89ebcad79a6c4224c8d09`
- Promotion branch: `release/build-2x-preview-baseline`
- Frozen Build 2.x baseline commit: `266fcd3c0d8b57b49eab20741ce573e620d15828`
- Baseline tag: `build-2x-198-test-baseline`
- Baseline tag remote status: pushed and unchanged
- Promotion branch remote status: pushed

## Vercel Deployment

- Team: `see-you-then`
- Project: `keepr-app`
- Project ID: `prj_SEh4lqulA6e3DuEjJLRERR1fCutV`
- Environment: Preview
- Deployment ID: `dpl_Dx9W2KvG4aMXB13TnHUq2JLscMGi`
- Preview URL: `https://keepr-lmccaoehg-see-you-then.vercel.app`
- Preview alias: `https://keepr-app-git-release-build-2x-preview-baseline-see-you-then.vercel.app`
- Deployment status: Ready
- Production deployment: No

## Build Result

Vercel build completed successfully.

Non-blocking build warnings:

- `baseline-browser-mapping` data is older than two months.
- Node.js function `api/og/k/[kac].js` was compiled from ESM to CommonJS.

No blocking build errors were found.

## Persistent Test Suite

Command:

```bash
node --test tests/profile-security.test.mjs tests/kac-manifest-foundation.test.mjs tests/kac-resolvers.test.mjs tests/kac-manifest-collectors.test.mjs tests/kac-intelligence-manifest.test.mjs tests/kac-manifest-live-rls-remediation.test.mjs tests/kac-context-envelope.test.mjs tests/kai-asset-brief.test.mjs tests/kai-interpretation.test.mjs tests/kai-interpretation-orchestration.test.mjs tests/kai-authority-reconciliation.test.mjs
```

Result from clean promotion source after using an uncommitted temporary `node_modules` symlink for local dependency resolution:

- Tests: 198
- Passing: 192
- Failing: 6

Failure cause:

- The following tests require `data/regal_3300_keepr_import.json`.
- That fixture is not present in the clean promotion branch.
- The file exists only as an untracked dirty-worktree file in the original development checkout.

Affected tests:

- `tests/kac-context-envelope.test.mjs`
- `tests/kac-intelligence-manifest.test.mjs`
- `tests/kac-manifest-collectors.test.mjs`
- `tests/kai-asset-brief.test.mjs`
- `tests/kai-interpretation.test.mjs`

This is a source-control completeness issue, not a hosted deployment failure. The clean branch cannot reproduce the previously observed 198-test green baseline without that untracked Regal fixture.

## Smoke-Test Results

All smoke checks used the protected Vercel Preview with temporary Vercel share access. The share token is intentionally not recorded here.

| Check | Result |
| --- | --- |
| Deployment state remains Ready | Pass |
| Preview application shell loads | Pass: `/` returns 200 and redirects to `Auth` |
| Sign-in screen loads | Pass: `/auth` returns 200, title `Auth` |
| Existing authenticated app route safely testable | Pass: `/dashboard` returns 200 and redirects to `Auth` while unauthenticated |
| Existing public KAC route loads | Pass |
| Formula KAC resolves | Pass: `/k/KPR-6QEH-927H` returns 200 |
| Formula public story loads | Pass: title `PublicKeeprStory`, KAC present |
| Other public asset/story route loads | Pass: `/k/KPR-6GV2-MJ6W` returns 200 |
| Static assets and media load | Pass: Expo JS bundle found and fetched |
| Browser page exceptions | Pass: none observed |
| Browser console | Warnings/errors observed, not Build 2.x-related |

Browser console observations:

- PostHog reports missing public API key and disables analytics.
- React Native Web reports `useNativeDriver` fallback warning.
- No page exceptions were observed.
- No browser console error was attributable to Build 2.x shared intelligence modules.

## Public Formula KAC Result

- Route: `/k/KPR-6QEH-927H`
- HTTP status: 200
- Page title: `PublicKeeprStory`
- Public KAC present in response: yes
- Public asset name marker `KeeprAfloat` present: yes
- Rich Formula configuration metadata exposed publicly: no

## Log Review

Build logs:

- Build completed successfully.
- No blocking errors.
- Non-blocking warnings are listed above.

Runtime logs:

- Runtime status-code grouping showed only 200 responses for preview function checks.
- One serverless runtime log entry was recorded at error level for `/k/KPR-6QEH-927H`, but the request returned 200.
- The log message was a Node deprecation warning for `url.parse()`.
- No Build 2.x shared-module runtime failure was found.

## Security Review

Client output and fetched public responses were scanned for sensitive markers.

No occurrences found for:

- `SUPABASE_SERVICE_ROLE_KEY`
- `service_role`
- `BEGIN PRIVATE`
- `stripe_customer_id`
- local-machine Git author email
- Vercel-associated email

The strings `access_token` and `refresh_token` are present only as client-side Supabase auth field names in application code, not as token values.

No signed URLs, storage paths, service-role secret values, credentials, or private contact data were observed in the smoke-test responses.

## Hosted Environment Variable Names

Configured in Vercel for `keepr-app`:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_KEEPR_BASE_URL`
- `EXPO_PUBLIC_POSTHOG_KEY`
- `EXPO_PUBLIC_POSTHOG_HOST`

Observed limitation:

- `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` are configured for Production only, not Preview.
- This explains the Preview browser console message that PostHog is disabled.

## Production/Data Safety

Confirmed:

- No production deployment was performed.
- No schema changes were made.
- No migrations were run.
- No RLS changes were made.
- No grant changes were made.
- No storage writes were performed.
- No production-data writes were performed.
- No Build 3A implementation was started.

## Rollback Point

- Previous frozen source commit: `9450f5e650e557900f27fab933f14dccdf0a7e93`
- Frozen Build 2.x baseline tag remains: `build-2x-198-test-baseline -> 266fcd3c0d8b57b49eab20741ce573e620d15828`

## Warnings And Limitations

- The corrected Preview deployment is healthy and Ready.
- Preview browser analytics is disabled because PostHog public env vars are Production-only.
- The public KAC OG function logs a Node `url.parse()` deprecation warning at error level, although requests return 200.
- The persistent test suite is not reproducible from the clean promotion branch because the Regal acceptance fixture is not committed.

## Recommendation For Build 3A

NO-GO for Build 3A until the Build 2.x persistent test baseline is made reproducible from Git.

The hosted Preview itself is safe and functional, but the clean promotion source does not contain all files required to reproduce the 198-test baseline. The minimum correction before Build 3A is to version the missing Regal fixture or update the tests to use a committed fixture source, then rerun and confirm the full suite returns 198 passing, 0 failing from a clean checkout.
