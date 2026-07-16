# Public Showcase Media Hotfix Preview Result

Date: 2026-07-15

## Scope

Production base SHA: `4239717d7cdf0445a63b429ab7a5bc4a19f5d140`

Hotfix branch: `hotfix/public-showcase-media-proxy`

Frontend/proxy hotfix commit SHA: `87ee515d9e23b2ab238f2cc87bbded783640729a`

Edge Function contract repair commit SHA: `5ceac5431e488b52503c86227c1fa3c307b1eb39`

Final proxy-auth patch commit SHA: `7fb3e369435c7b66abbbcb583625ce2d4142d392`

Report commit SHA: pending at report update time

Rollback point: `4239717d7cdf0445a63b429ab7a5bc4a19f5d140`

## Exact Implementation Files Changed

Frontend/proxy hotfix:

- `api/og/k/[kac].js`
- `api/public-media/[mediaId].js`
- `screens/KeeprHubScreen.js`
- `screens/PublicKeeprStoryScreen.js`
- `tests/public-media-security.test.mjs`

Edge Function contract repair:

- `supabase/functions/public-story-media/index.ts`
- `tests/public-media-security.test.mjs`
- `tests/public-story-media-contract.test.mjs`

## Implementation Summary

- Added the Keepr-controlled public media proxy route at `/api/public-media/<public_media_id>`.
- Preserved the secured media architecture: public pages consume opaque proxy media IDs and same-origin proxy URLs.
- Updated public story, public hub, and OG media handling to consume proxy-compatible media rows.
- Removed public browser-side signed URL generation from `PublicKeeprStoryScreen`.
- Updated `public-story-media` POST to return typed arrays:
  - `media`
  - `showcaseFiles`
  - `showcaseLinks`
- Classified image rows, document/file rows, and external links separately from the existing public-approved `public_asset_story_gallery` source.
- Preserved `public-story-media` GET as an opaque media proxy for image/document bodies.
- Updated `/api/public-media/<public_media_id>` to authenticate its upstream request to `public-story-media` with the public anon headers, preserving `verify_jwt = true` without using service-role credentials.

## Supabase Edge Function Deployment

Project ref: `jjzjuqxysucqutgjnrkk`

Function deployed: `public-story-media`

Deploy command:

```bash
supabase functions deploy public-story-media --project-ref jjzjuqxysucqutgjnrkk
```

Deployment result:

- Succeeded
- Only `public-story-media` was deployed
- No schema, migration, RLS, grant, storage, or production-data change occurred

JWT/security note:

- Local `supabase/config.toml` has `verify_jwt = true` for `public-story-media`.
- POST validation succeeds with the public anon JWT.
- GET validation without auth returns `401`.
- GET validation with the public anon JWT returns the expected image/document body.

## Typed Contract Validation

Formula `KPR-6QEH-927H`:

- HTTP 200
- `media`: 5
- `showcaseFiles`: 0
- `showcaseLinks`: 1
- PDFs in `media`: 0
- links in `media`: 0
- storage metadata returned: no

Porsche `KPR-6GV2-MJ6W`:

- HTTP 200
- `media`: 11
- `showcaseFiles`: 3
- `showcaseLinks`: 2
- PDFs in `media`: 0
- links in `media`: 0
- storage metadata returned: no

## Local Test Totals

Command:

```bash
node --test tests/public-media-security.test.mjs
```

Result:

- 11 passing
- 0 failing

Command:

```bash
node --test tests/public-story-media-contract.test.mjs
```

Result:

- 6 passing
- 0 failing

Command:

```bash
node --test tests/*.test.mjs
```

Result:

- 17 passing
- 0 failing

## Web Build Result

Command:

```bash
npm run build:web
```

Result:

- Succeeded
- Exported: `dist`
- Web bundle: `_expo/static/js/web/index-f032b702fd6346039171253cbac6ab91.js`

## Vercel Preview Deployment

Project: `keepr-app`

Team: `see-you-then`

Latest deployment ID: `dpl_6bbAe5h2TmAUiwUQWPQsnURMFAKq`

Preview URL: `https://keepr-3ah3hn2e9-see-you-then.vercel.app`

Branch alias: `keepr-app-git-hotfix-public-showcase-media-proxy-see-you-then.vercel.app`

Deployment status: `READY`

Target: Preview (`target: null`)

Production deployment: Not performed.

## Combined Preview Validation

Preview access:

- Preview is Vercel-protected.
- Validation used a temporary Vercel access cookie internally.
- No share token or cookie value is included in this report.
- Final validation was repeated against the report-commit Preview deployment listed above. The earlier proxy-auth code deployment `dpl_24EL8tQvFE1nyDiyc32BrJYgJzMq` produced the same media/proxy/security results.

Formula public story:

- Route `/k/KPR-6QEH-927H`: HTTP 200
- Application shell loaded
- Typed contract: 5 media, 0 files, 1 link
- Proxy media requests: 5 HTTP 200 image bodies
- Image body validation: 5 JPEG bodies
- Hero/gallery media render path uses `/api/public-media/<id>`
- No PDFs, links, HTML/error rows, or storage metadata in `media`
- No signed URL or storage metadata detected in checked page/contract output
- No blank proxy media failures detected

Porsche public story:

- Route `/k/KPR-6GV2-MJ6W`: HTTP 200
- Application shell loaded
- Typed contract: 11 media, 3 files, 2 links
- Proxy media requests: 11 HTTP 200 image bodies
- Image body validation: 9 JPEG, 1 PNG, 1 WebP
- Proxy document requests: 3 HTTP 200 PDF bodies
- PDFs classified as `showcaseFiles`, not `media`
- external links classified as `showcaseLinks`, not `media`
- document cards open through `/api/public-media/<id>`
- No signed URL or storage metadata detected in checked page/contract output
- No blank proxy media failures detected

Public Hub:

- Route `/h/rally-sport-region`: HTTP 200
- Application shell loaded
- Hub page output did not expose signed URLs or storage metadata
- No signed URL or storage metadata detected in checked page output

Open Graph:

- Formula OG route: HTTP 200
- Porsche OG route: HTTP 200
- OG HTML uses Keepr-controlled `/api/public-media/...` media where available
- No signed URL or storage metadata detected

## Prior 502 Blocker

Status: resolved.

- `public-story-media` keeps `verify_jwt = true`.
- The Vercel `/api/public-media/<id>` route now sends the public anon `apikey` and `Authorization: Bearer <anon>` headers to the upstream Edge Function.
- Preview proxy image requests now return HTTP 200.
- Preview proxy PDF requests now return HTTP 200.
- No 502 responses were observed in the final hosted media-body validation.

## Security Checks

Checked Preview story HTML, public media contract responses, public hub route, OG HTML, and proxy error responses for:

- signed Supabase URLs
- Supabase storage object URLs
- storage paths
- bucket names
- object keys
- JWT-like returned values
- service-role values
- raw internal diagnostics

Result:

- No signed Supabase URLs found
- No storage object URLs found
- No storage paths found
- No bucket names found
- No object keys found
- No JWT-like values found in returned page/media outputs
- No service-role values found
- No raw internal diagnostics found

## Prohibited Changes Not Made

- No Vercel Production deployment
- No schema changes
- No migrations
- No RLS changes
- No grant changes
- No storage configuration changes
- No production-data writes
- No Build 3A promotion
- No Build 3B promotion
- No unrelated public story redesign

## Recommendation

GO for Production promotion review.

The typed `public-story-media` contract and the Vercel media proxy are now aligned in Preview. Formula and Porsche Showcase photos/files/links validate through the secured proxy model, the previous 502 blocker is resolved, and checked browser/network outputs do not expose signed Supabase URLs, storage paths, buckets, object keys, JWTs, service-role values, or raw diagnostics.

Production promotion should still be performed as a separate, explicit action after Andy/KAI review. Rollback point remains `4239717d7cdf0445a63b429ab7a5bc4a19f5d140`.
