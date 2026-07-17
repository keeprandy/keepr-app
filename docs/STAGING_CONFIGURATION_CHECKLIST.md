# Keepr Staging Configuration Checklist

Date: 2026-07-17

Staging project ref: `nvtotcdsvijssokijnbn`

Production project ref guard: never target `jjzjuqxysucqutgjnrkk`.

This checklist prepares external configuration only. It does not contain secret
values.

## Auth Redirect Preparation

Configure Supabase Auth for staging with only staging/Preview destinations:

- Staging site URL: the approved Vercel Preview URL for
  `integration/projections-handoff`.
- Redirect URLs:
  - Vercel Preview URL.
  - Localhost development URL only if needed for synthetic testing.
  - Any future staging custom domain, if approved.

Do not add Production-only redirects as the staging default.

## Storage Bucket Preparation

Create staging buckets only:

- `asset-photos`
- `asset-files`

Do not copy Production storage objects.

Bucket policy requirements:

- Authenticated users may upload/read only their permitted synthetic test
  objects.
- Public Story media should be read through the approved Edge Function/proxy
  path, not by making buckets public.
- Public browser output must not expose bucket names, storage paths, object
  keys, signed URLs, or service-role values.

## Edge Function Secret Names

Configure staging secret values separately from Production. Required names:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POSTMARK_SERVER_TOKEN`
- `SITE_URL`
- `EXPO_PUBLIC_KEEPR_BASE_URL`

Do not paste or commit values into the repository.

Postmark staging must use approved internal recipients only.

## Vercel Preview Environment Mapping

For the Preview branch, configure values that point to staging:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_KEEPR_BASE_URL`
- `PUBLIC_KEEPR_BASE_URL`

Verification before Preview acceptance:

- Browser/client output references staging Supabase URL only.
- No request targets Production project `jjzjuqxysucqutgjnrkk`.
- No service-role value appears in client bundles, HTML, logs, or network
  responses.

## Minimum Edge Function Deployment List

Deploy only these functions for Event Projection synthetic acceptance:

- `kac-resolve`
- `public-action`
- `public-thread`
- `asset-thread-notify`
- `public-story-media`

Deploy `public-resolve` only if the Preview flow proves it is still invoked.

Do not deploy unrelated Intelligence, extraction, billing, upload, Stripe,
proposal, or production-only functions.

## Synthetic Acceptance Fixture Plan

Use one run prefix:

```text
stg_evtproj_<YYYYMMDDHHMM>_
```

Synthetic records only:

- owner Auth user/profile
- public sender identity
- optional steward/member user
- one vehicle asset/KAC
- optional Hub and Hub membership
- public Story/Event Projection config
- minimal public media rows and synthetic storage objects only if needed
- Ask Owner thread/message/token rows created through the app flow

Cleanup:

- delete synthetic thread messages
- delete synthetic threads
- delete public token rows
- delete notifications/event inbox rows
- delete public Story/media/config rows
- delete synthetic storage objects
- delete synthetic asset/Hub/member/profile/Auth users
- rerun no-real-data validation

## Current Hold Points

Stop before:

- entering or changing secret values
- changing Vercel environment variables
- deploying Edge Functions
- creating Auth users
- creating synthetic fixtures
- modifying Production

