# Public Showcase Media Hotfix Preview Result

Date: 2026-07-15

## Scope

Production base SHA: `4239717d7cdf0445a63b429ab7a5bc4a19f5d140`

Hotfix branch: `hotfix/public-showcase-media-proxy`

Hotfix commit SHA: `525aa6987f5b7527a6d5566a79206a6c50bdf726`

Rollback point: `4239717d7cdf0445a63b429ab7a5bc4a19f5d140`

## Exact Files Changed

- `api/public-media/[mediaId].js`
- `screens/PublicKeeprStoryScreen.js`
- `screens/KeeprHubScreen.js`
- `api/og/k/[kac].js`
- `tests/public-media-security.test.mjs`

## Implementation Summary

- Added the Keepr-controlled public media proxy route at `/api/public-media/<public_media_id>`.
- Preserved the secured media architecture: public pages consume opaque proxy media IDs and same-origin proxy URLs.
- Updated public story and public hub media normalization to support the deployed `public-story-media` contract:
  - `public_media_id`
  - `role`
  - `is_showcase`
  - `sort_order`
  - `image_url`
- Removed dependency on legacy row fields for public Showcase rendering:
  - `placement_id`
  - `mime_type`
  - `file_name`
- Kept proxy media valid when:
  - the URL has no file extension
  - upstream content type is `application/octet-stream`
- Updated Open Graph image selection to emit proxy-compatible media URLs or the safe fallback image only.

## Local Test Totals

Command:

```bash
node --test tests/public-media-security.test.mjs
```

Result:

- 4 passing
- 0 failing

Command:

```bash
node --test tests/*.test.mjs
```

Result:

- 4 passing
- 0 failing

## Web Build Result

Command:

```bash
npm run build:web
```

Result:

- Succeeded
- Exported: `dist`
- Web bundle: `_expo/static/js/web/index-c35e415f606e1ccc701f8af87a81dd2e.js`

## Vercel Preview Deployment

Project: `keepr-app`

Team: `see-you-then`

Deployment ID: `dpl_H52H3mENYkBQg45G35ZhC4UpiK8g`

Preview URL: `https://keepr-dtd2ktgo8-see-you-then.vercel.app`

Branch alias: `keepr-app-git-hotfix-public-showcase-media-proxy-see-you-then.vercel.app`

Deployment status: `READY`

Target: Preview (`target: null`)

Production deployment: Not performed.

## Formula Public Story Results

KAC: `KPR-6QEH-927H`

Route: `/k/KPR-6QEH-927H`

Result:

- HTTP 200
- Application shell loaded
- Public media contract returned 6 media records
- All 6 media records were Showcase records
- All returned `image_url` values were Keepr-controlled proxy URLs
- No legacy public row fields were required for rendering
- Intended Showcase image set is available through the proxy

## Proxy Response Results

Route shape: `/api/public-media/<public_media_id>`

Formula proxy validation:

- 6 proxy requests made
- All 6 returned HTTP 200
- Content types observed:
  - `image/jpeg`
  - `application/octet-stream`
- `application/octet-stream` response count: 1
- All responses were non-empty and browser-renderable through the proxy
- Cache header observed: `public, max-age=300`
- No media IDs, object keys, bucket names, or storage paths were printed or exposed in this report.

## Public Hub Results

Route: `/h/rally-sport-region`

Result:

- HTTP 200
- Application shell loaded
- Public hub record found
- Visibility: `public`
- Hub story links RPC returned 1 story
- Linked story media contract returned proxy-only media URLs
- No storage leakage detected in the public hub page or linked media contract

## Open Graph Results

Route: `/api/og/k/KPR-6QEH-927H`

Result:

- HTTP 200
- OG image resolved to a Keepr-controlled `/api/public-media/...` URL
- Fallback OG image was not needed for the Formula public story
- No signed storage URL or storage metadata was exposed

## Security Checks

Checked Preview story HTML, public media contract responses, proxy response headers, public hub route, linked hub media contract, and OG HTML for:

- signed Supabase URLs
- Supabase storage object URLs
- storage paths
- bucket names
- object keys
- JWT-like values
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

- No Supabase function changes
- No schema changes
- No migrations
- No RLS changes
- No grant changes
- No storage configuration changes
- No production-data writes
- No Build 3A changes
- No Build 3B changes
- No unrelated public story redesign
- No production deployment

## Known Notes

- Preview deployments are Vercel-protected, so validation used a temporary Vercel share URL internally. The share token is intentionally omitted from this report.
- `node_modules/` and `dist/` were generated locally for build validation and remain ignored/uncommitted.

## Recommendation

GO for Production promotion of this hotfix after Andy/KAI review.

This patch restores public Showcase media compatibility while preserving the secured media architecture.
