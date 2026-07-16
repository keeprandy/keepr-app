# Public Showcase Media Production Promotion Result

Date: 2026-07-16T17:54:03Z

## Promotion Source

Project: `keepr-app`

Team: `see-you-then`

Promoted Preview deployment: `dpl_6z4phfF4q3ypt6wyHzr2zqqgtC5Y`

Promoted Preview URL: `https://keepr-nw7aji7z5-see-you-then.vercel.app`

Promotion branch: `hotfix/public-showcase-media-proxy`

Source commit SHA: `5a8f39e96c13a04ad1c4fdeb9ce51835d5287bc1`

Required implementation commits included:

- `87ee515d9e23b2ab238f2cc87bbded783640729a`
- `5ceac5431e488b52503c86227c1fa3c307b1eb39`
- `7fb3e369435c7b66abbbcb583625ce2d4142d392`

The deployment selected for promotion was the latest READY Preview from the hotfix branch at the final clean/report state. It contains the final proxy-auth implementation commit as an ancestor and passed full media-body validation before promotion.

## Production Deployment

Production promotion deployment: `dpl_5uKCXCJExcm8YWzd31iwKg1MeD7N`

Production URL: `https://app.keeprhome.com`

Promotion command:

```bash
npx vercel promote https://keepr-nw7aji7z5-see-you-then.vercel.app --scope see-you-then --yes --timeout 5m
```

Promotion result:

- Production deployment reached `READY`
- Production aliases include `app.keeprhome.com`
- No Production rollback was required

## Rollback

Prior active Production deployment: `dpl_C6k7W4ityjf5fyofKx7gaHPHH1s9`

Rollback deployment: `dpl_C6k7W4ityjf5fyofKx7gaHPHH1s9`

Rollback status: not executed because Production validation passed.

## Formula Validation

KAC: `KPR-6QEH-927H`

Route: `/k/KPR-6QEH-927H`

Result:

- Public story route returned HTTP 200
- Application shell loaded
- Hero/story output uses Keepr-controlled proxy media URLs
- Typed contract returned 5 media, 0 files, 1 link
- 5 image proxy requests returned HTTP 200
- 5 image bodies validated as JPEG
- No blank proxy tile failures detected
- No PDFs or links appeared in the gallery media array

## Porsche Validation

KAC: `KPR-6GV2-MJ6W`

Route: `/k/KPR-6GV2-MJ6W`

Result:

- Public story route returned HTTP 200
- Application shell loaded
- Hero/story output uses Keepr-controlled proxy media URLs
- Typed contract returned 11 media, 3 files, 2 links
- 11 image proxy requests returned HTTP 200
- Image bodies validated as 9 JPEG, 1 PNG, and 1 WebP
- 3 PDF proxy requests returned HTTP 200
- 3 document bodies validated as PDF
- PDFs did not appear in the gallery media array
- No blank proxy tile failures detected

## Hub And OG Validation

Public Hub:

- `/h/rally-sport-region` returned HTTP 200
- Application shell loaded
- No storage metadata leakage detected

Open Graph:

- `/api/og/k/KPR-6QEH-927H` returned HTTP 200
- `/api/og/k/KPR-6GV2-MJ6W` returned HTTP 200
- OG output uses proxy-compatible media where available
- No storage metadata leakage detected

## Proxy Response Totals

Formula:

- Image proxy HTTP 200: 5
- Proxy HTTP 502: 0

Porsche:

- Image proxy HTTP 200: 11
- PDF proxy HTTP 200: 3
- Proxy HTTP 502: 0

## Security Checks

Checked Production story HTML, typed media contract responses, proxy media/document bodies, Hub output, and OG output for:

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
- No JWT-like values found in checked browser/network outputs
- No service-role values found
- No raw internal diagnostics found

## Prohibited Changes Not Made

- No Supabase deployment during Production promotion
- No schema changes
- No migrations
- No RLS changes
- No grant changes
- No storage configuration changes
- No production-data writes
- No Build 3A promotion
- No Build 3B promotion
- No unrelated branch merge

## Final Status

Production is verified stable for the Public Showcase media hotfix.

Build 3A and Build 3B changes were not promoted.
