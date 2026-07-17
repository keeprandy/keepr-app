# Keepr Staging Bootstrap Plan

Date: 2026-07-17

## Current Decision

Staging project `nvtotcdsvijssokijnbn` has been created and is confirmed not to
be Production project `jjzjuqxysucqutgjnrkk`.

The reviewed schema baseline was applied to staging on 2026-07-17. Continue to
hold before configuring Auth, secrets, Vercel Preview variables, Edge Functions,
Postmark, or synthetic fixtures until the validation findings below are
reviewed.

## Baseline Export Method

Use a schema-only dump from Production project `jjzjuqxysucqutgjnrkk`.

The dump must be written to `/tmp`, reviewed, sanitized, and only then copied to
`supabase/baseline/20260717_keepr_schema_baseline.sql`.

Initial export command:

```bash
supabase db dump --linked --schema public --schema storage --file /tmp/keepr_schema_baseline_public_storage.sql
```

Alternative, if linked CLI is unavailable:

```bash
supabase db dump --db-url "$SUPABASE_DB_URL" --schema public --schema storage --file /tmp/keepr_schema_baseline_public_storage.sql
```

Do not print the database URL. Do not commit the raw dump.

Review guards:

```bash
rg -n "COPY |INSERT INTO|auth\\.users|vault|postgres://|supabase\\.co|service_role|BEGIN DATA|TABLE DATA" /tmp/keepr_schema_baseline_public_storage.sql
```

The hosted Supabase `storage` schema is managed by Supabase and cannot be
recreated from the Keepr baseline by the temporary migration role. The committed
baseline therefore preserves Keepr `public` schema objects and omits
Supabase-managed `storage` schema internals. Storage buckets and storage
policies remain a separate staging setup step.

## Required Schema Contents

The reviewed baseline must include:

- tables
- views
- RPCs and SQL functions
- triggers
- indexes
- constraints
- grants
- RLS policies
- required extensions
- required storage bucket/policy definitions where appropriate

It must exclude:

- table rows
- Auth users
- storage objects
- tokens
- messages
- personal data
- connection strings
- secret values
- Vault contents
- environment-specific credentials

## Object Inventory Required For Event Projection Acceptance

- `profiles`
- `assets`
- `master_assets`, if resolver paths require it
- `asset_stewardships`
- `org_members`
- `hubs`
- `hub_members`
- `public_asset_story_summary`
- `public_asset_story_gallery`
- `attachments`
- `attachment_placements`
- `attachment_links`
- `asset_threads`
- `asset_thread_messages`
- `event_inbox`
- `notifications`
- `public_asset_thread_tokens`
- `resolve_kac`
- `keepr_resolve_kac_for_manifest_admin`

## Environment-Specific Findings From Repository Scan

Hard-coded Production project ref appears in client files:

- `screens/PublicActionScreen.js`
- `screens/PublicKeeprStoryScreen.js`
- `screens/KeeprHubScreen.js`
- `screens/KacResolveScreen.js`
- `screens/KeeprActionScreen.js`
- `lib/publicQrApi.js`

Production URLs / domains appear in:

- `App.js`
- `lib/shareLinks.js`
- `lib/inviteLinks.js`
- `lib/hubsApi.js`
- public story and hub screens
- `supabase/functions/public-action/index.ts`
- `supabase/functions/asset-thread-notify/index.ts`
- `supabase/functions/send-hub-invite/index.ts`

External service schema/runtime references:

- `stripe-webhook` uses Stripe webhook secret and subscription fields.
- Postmark sender identity is in email functions.

No committed schema migration currently defines cron jobs, database webhooks, or
Vault objects. The baseline review must still scan for these in the exported
Production schema.

## Proposed Baseline Cutoff

Recommended cutoff: after Production migration `20260717120000`.

If the baseline is generated after that migration, the currently committed
migrations are included and must not be replayed:

- `20260131125755_attachments_searchable_text.sql`
- `20260713120000_protect_profile_sensitive_fields.sql`
- `20260713162000_kac_manifest_admin_resolve_asset.sql`
- `20260713165000_restrict_manifest_admin_resolve_rpc_grants.sql`
- `20260717120000_public_asset_thread_tokens.sql`

Migration replay list at this cutoff:

- none currently
- apply only future migrations created after the baseline cutoff

If Andy chooses an earlier cutoff, replay only migrations whose version is later
than that cutoff.

## Minimum Edge Function Set

Deploy for Event Projection acceptance:

- `kac-resolve`
- `public-action`
- `public-thread`
- `asset-thread-notify`
- `public-story-media`

Deploy only if a test proves dependency:

- `public-resolve`

Do not deploy unrelated Intelligence, extraction, billing, Stripe, upload, or
proposal functions for this acceptance pass.

## Storage Setup

Create private staging buckets:

- `asset-photos`
- `asset-files`

Use synthetic placeholder storage objects only if public media acceptance needs
them. Do not copy Production storage objects.

## Auth Setup

Configure staging Auth:

- staging site URL
- Vercel Preview redirect URL
- localhost redirect URL if needed
- synthetic users only

No customer users.

## Vercel Preview Mapping

Preview environment variables must point to staging:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_KEEPR_BASE_URL`
- `PUBLIC_KEEPR_BASE_URL`

Branch Preview must not use `jjzjuqxysucqutgjnrkk`.

## Postmark Staging

- Use the existing Postmark implementation.
- Prefer a test server/stream.
- Send only to approved internal recipients.
- Do not send to customers.
- Preserve privacy-safe subject/body.
- Email failure remains non-blocking.

## Authoritative Bootstrap Order

1. Apply reviewed schema baseline.
2. Apply committed migrations after the baseline cutoff.
3. Create storage buckets and policies.
4. Configure Auth URLs.
5. Configure staging-only secrets.
6. Deploy minimum Edge Functions.
7. Connect Vercel Preview to staging.
8. Create synthetic fixtures.
9. Run acceptance.
10. Clean synthetic fixtures.

## Validation Scripts

Prepared:

- `supabase/baseline/validate_staging_inventory.sql`
- `supabase/baseline/validate_no_real_data.sql`

Because the Supabase CLI does not provide an arbitrary SQL execution command and
we are not exposing database credentials, the first staging run used supported
linked CLI inspections instead of executing the custom SQL scripts directly.

Executed validation:

- `supabase migration list --linked`
- `supabase db lint --linked --schema public --fail-on error`
- `supabase inspect db table-stats --linked`

Results:

- Migration history is aligned through cutoff `20260717120000`.
- Required Event Projection tables are present in staging.
- Table stats report zero estimated rows for `profiles`, `assets`,
  `asset_threads`, `asset_thread_messages`, `public_asset_thread_tokens`,
  `notifications`, and `event_inbox`.
- `pgcrypto` is required because `public.get_public_asset_view` and
  `public.get_public_system_package` call `digest(...)`. Staging has the
  extension enabled and the baseline now includes a `public.digest(text, text)`
  wrapper over `extensions.digest(...)` so the existing unqualified callers
  resolve without moving Supabase-managed extension objects.
- `public.delete_service_record_full` is not required for Event Projection
  staging acceptance. It is a legacy authenticated service-record deletion RPC
  used by `lib/deleteServiceRecord.js`, not by Public Story, Event Projection,
  Ask Owner, `public-action`, `public-thread`, or `asset-thread-notify`.
  Staging excludes that RPC instead of recreating or imitating
  `storage.delete_object(...)`.
- Remaining lint findings are classified as non-blocking legacy parity issues
  for this acceptance pass:
  - `public.accept_asset_transfer`: legacy transfer notification flow, not
    Event Projection.
  - `public.accept_asset_transfer_simple`: legacy transfer flow, not Event
    Projection.
  - `public.apply_action_proposal`: Actions/proposal flow, not Event
    Projection.
  - `public.generate_kac`: warnings only.

Staging schema readiness is GO for the next configuration preparation step, with
the documented limitation that legacy service-record full deletion is excluded
from staging until a supported storage deletion path is reviewed.
- `supabase/baseline/validate_no_real_data.sql`

## Manual Steps For Andy

1. Create Supabase project `keepr-staging`.
2. Export schema-only baseline from Production to `/tmp`.
3. Review/sanitize the baseline.
4. Commit only the reviewed schema-only baseline.
5. Apply baseline to staging.
6. Configure Auth URLs.
7. Configure staging secrets.
8. Configure Vercel Preview environment variables to staging.
9. Approve synthetic acceptance.
