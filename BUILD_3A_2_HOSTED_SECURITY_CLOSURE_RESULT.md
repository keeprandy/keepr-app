# Build 3A.2 Hosted Endpoint And Media Security Closure Result

Date/time: 2026-07-15 10:45 EDT

## Source

- Branch: `release/build-3a-preview`
- Build 3A implementation base: `d0e56b5bd19d46bc918ec652b7dbd1f035c31e29`
- Build 3A preview/report base before this closure: `99f3fb1e86ead19f5a4c8a019d189995167f052b`
- Build 3A.2 media hardening commit: `daa244a80b205cc9a5ff3a6b0dba4de6b9d60d57`
- Build 3A.2 no-service-role proxy correction: `3fe98e1c6fab1796c83965a2caeb0be64b18ab69`

## Files Changed

- `api/public-media/[mediaId].js`
- `api/og/k/[kac].js`
- `screens/KeeprHubScreen.js`
- `screens/PublicKeeprStoryScreen.js`
- `supabase/config.toml`
- `supabase/functions/public-story-media/index.ts`
- `tests/public-media-security.test.mjs`
- `BUILD_3A_2_HOSTED_SECURITY_CLOSURE_RESULT.md`

## Media-Path Findings

- Signed Supabase storage URLs were created in `supabase/functions/public-story-media/index.ts` using `createSignedUrl(...)`.
- `screens/PublicKeeprStoryScreen.js` consumed the returned `image_url` directly for hero and gallery rendering.
- `api/og/k/[kac].js` also consumed the returned `image_url` for browser-visible OG metadata.
- `screens/KeeprHubScreen.js` reused the same public media response for public hub story cards.
- The browser could receive token-bearing Supabase storage URLs before this fix.

## Media Remediation

- Public media listing now returns opaque Keepr proxy references only:
  - `public_media_id`
  - `role`
  - `is_showcase`
  - `sort_order`
  - `image_url: /api/public-media/<public_media_id>`
- The Vercel API route `api/public-media/[mediaId].js` proxies media without requiring a Vercel service-role secret.
- The Vercel route calls the `public-story-media` Edge Function media stream path.
- The `public-story-media` Edge Function owns server-side storage signing and streams bytes without returning signed URLs, storage paths, bucket names, or token-bearing query strings.
- `public-story-media` is now explicitly public-invocable for public media proxy delivery.
- `kac-intelligence-orchestration` remains `verify_jwt = true`.

## Supabase Deployment

- Project: `jjzjuqxysucqutgjnrkk`
- Project name: `keepr-prod`
- Deployed functions:
  - `public-story-media`, version `7`, updated `2026-07-15 14:40:49 UTC`
  - `kac-intelligence-orchestration`, version `1`, updated `2026-07-15 14:32:31 UTC`
- `kac-intelligence-orchestration` unauthenticated POST: `401`
- `kac-intelligence-orchestration` OPTIONS/CORS: `200`
- `public-story-media` media proxy GET for Formula media: `200 image/jpeg`

## Vercel Preview

- Team: `see-you-then`
- Project: `keepr-app`
- Project ID: `prj_SEh4lqulA6e3DuEjJLRERR1fCutV`
- Deployment ID: `dpl_CYb39LQfrsjsP1owm4mLYwCrzRhf`
- Preview URL: `https://keepr-87s9k37t4-see-you-then.vercel.app`
- Branch alias: `https://keepr-app-git-release-build-3a-preview-see-you-then.vercel.app`
- Deployment state: `READY`
- Source commit: `3fe98e1c6fab1796c83965a2caeb0be64b18ab69`
- Production deployment: none

## Hosted Access Matrix

Safe unauthenticated boundary checks:

| Case | Result |
| --- | --- |
| Orchestration unauthenticated POST | `401`, `UNAUTHORIZED_NO_AUTH_HEADER` |
| Orchestration OPTIONS/CORS | `200`, `Access-Control-Allow-Origin: *` |
| Preview app shell | `200` |
| Preview sign-in route | `200` |
| Formula public KAC route | `200` |
| Porsche public KAC route | `200` |
| Formula public media proxy | `200 image/jpeg` |

Authenticated role checks were not run because no safe owner, steward, viewer, unauthorized, disputed-owner, or platform-admin sessions were available in the validation environment. No personal session token was used, and no disposable production users or data were created.

## Asset Validation

Formula `KPR-6QEH-927H`:

- Public route returned `200`.
- Browser-visible HTML/OG output referenced `/api/public-media/8a6ad32c-9c49-4322-9e79-408da762b0b6`.
- Media proxy returned `200 image/jpeg`.
- No signed Supabase URL, storage path, token query parameter, service-role string, raw SQL, or stack trace appeared in fetched output.

Porsche `KPR-6GV2-MJ6W`:

- Public route returned `200`.
- Browser-visible HTML/OG output referenced `/api/public-media/a3ea8786-0d54-49de-b59e-37d5aa710850`.
- No signed Supabase URL, storage path, token query parameter, service-role string, raw SQL, or stack trace appeared in fetched output.

Partial, concealed, and authenticated role-specific hosted endpoint cases remain blocked pending safe authenticated test sessions.

## Service-Record Compatibility

Local Build 3A tests still cover optional and unavailable service-record metadata through deterministic orchestration fixtures. Hosted authenticated service-record compatibility was not run because safe authenticated sessions were unavailable.

## Security Scan

Checked public route HTML, OG route HTML, sign-in route HTML, and media proxy response metadata for:

- `object/sign`
- `storage_path`
- `token=`
- `signedUrl`
- `SUPABASE_SERVICE_ROLE`
- `service_role`
- stack/trace markers

Result: no matches in fetched browser-visible outputs.

The generated web bundle still contains existing authenticated-app source strings for storage paths, signed URL helpers, and reset-token parsing. Those were pre-existing authenticated/internal app code paths and not the public story media output fixed in this closure.

## Tests

Build 3A:

```bash
node --test tests/kac-intelligence-orchestration.test.mjs
```

Result: `11 passing`, `0 failing`.

Full persistent suite plus media security:

```bash
node --test tests/profile-security.test.mjs tests/kac-manifest-foundation.test.mjs tests/kac-resolvers.test.mjs tests/kac-manifest-collectors.test.mjs tests/kac-intelligence-manifest.test.mjs tests/kac-manifest-live-rls-remediation.test.mjs tests/kac-context-envelope.test.mjs tests/kai-asset-brief.test.mjs tests/kai-interpretation.test.mjs tests/kai-interpretation-orchestration.test.mjs tests/kai-authority-reconciliation.test.mjs tests/kac-intelligence-orchestration.test.mjs tests/public-media-security.test.mjs
```

Result: `215 passing`, `0 failing`.

Web build:

```bash
npm run build:web
```

Result: succeeded.

## Build And Runtime Logs

- Vercel build completed successfully.
- Known warning: `baseline-browser-mapping` package data is over two months old.
- Known warning: Vercel compiled ESM API routes to CommonJS.
- Runtime warning: Node `url.parse()` deprecation warning was logged by Vercel/serverless runtime on API route requests. The affected requests returned successful HTTP status and did not expose private data.

## Temporary Validation Access

- Vercel generated one deployment-protection automation bypass entry for protected Preview CLI smoke testing.
- The temporary bypass entry was revoked after validation.
- Follow-up check confirmed `protectionBypass: {}`.
- A temporary accidental Vercel project created by CLI help/link behavior was removed before completion.

## Prohibited Changes Not Made

- No Build 3B work.
- No deep-link/permalink implementation.
- No Actions, reminders, scheduling, autonomous workflows, or model-provider integration.
- No schema changes, migrations, RLS changes, grants, storage writes, or production-data writes.
- No production Vercel deployment.
- No public exposure of the authenticated KAC intelligence endpoint.

## Rollback Point

- Vercel Preview rollback: previous Preview deployment `dpl_AXLhrbJ3GmamxWLD1BVX95J4rzCz` from commit `daa244a80b205cc9a5ff3a6b0dba4de6b9d60d57`.
- Supabase function rollback: redeploy previous `public-story-media` version and/or remove Build 3A orchestration function version if required.
- Git rollback: reset preview branch to `99f3fb1e86ead19f5a4c8a019d189995167f052b` for pre-closure state, or to `d0e56b5bd19d46bc918ec652b7dbd1f035c31e29` for Build 3A implementation only.

## Recommendation

Build 3A.2 media security gate: `GO`, with public media no longer exposing signed storage URLs in validated browser-visible output.

Build 3B: `NO-GO` until safe authenticated hosted endpoint validation is completed for owner, direct steward, organization steward, viewer, unauthorized authenticated caller, disputed non-admin, and platform-admin paths.

Build 3L permalink/deep-link work: `NO-GO` for implementation until the authenticated endpoint matrix is completed; planning can proceed separately if it does not alter routes or production behavior.
