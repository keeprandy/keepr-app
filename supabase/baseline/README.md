# Keepr Staging Schema Baseline

This directory is reserved for a reviewed schema-only Keepr database baseline.

Do not commit an unreviewed raw dump here.

## Intended Baseline File

Proposed reviewed artifact:

```text
supabase/baseline/20260717_keepr_schema_baseline.sql
```

The baseline must be schema only. It may include:

- tables
- views
- RPCs and SQL functions
- triggers
- indexes
- constraints
- grants
- RLS policies
- required extensions
- storage bucket and storage policy definitions, where appropriate

It must not include:

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

## Why a Baseline Is Required

The committed migrations in this repository are not a complete Keepr schema
bootstrap. The earliest committed migration alters `public.attachments`, which
means the base schema predates the committed migration chain.

A fresh staging Supabase project therefore requires a reviewed schema-only
baseline before applying later migrations.

## Recommended Cutoff

Recommended cutoff: after Production migration `20260717120000`.

If the baseline is generated from the current approved Production schema after
`20260717120000_public_asset_thread_tokens.sql`, the currently committed
migrations are already represented in the baseline and must not be replayed.

Later migrations created after this cutoff should be applied normally.

## Export Method

Use Supabase CLI schema-only dump against the approved Production project, write
to `/tmp`, review/sanitize, then copy only the reviewed schema-only artifact into
this directory.

Example command for Andy to run after confirming target:

```bash
supabase db dump --linked --schema public --schema storage --file /tmp/keepr_schema_baseline_public_storage.sql
```

If the CLI requires a database URL instead of a linked project, use a temporary
shell variable and do not print it:

```bash
supabase db dump --db-url "$SUPABASE_DB_URL" --schema public --schema storage --file /tmp/keepr_schema_baseline_public_storage.sql
```

Review the dump before committing:

```bash
rg -n "COPY |INSERT INTO|auth\\.users|vault|postgres://|supabase\\.co|service_role|anon key|BEGIN DATA|TABLE DATA" /tmp/keepr_schema_baseline_public_storage.sql
```

Only after review, copy the sanitized schema-only baseline to:

```text
supabase/baseline/20260717_keepr_schema_baseline.sql
```

## Bootstrap Order

1. Create a new Supabase project, for example `keepr-staging`.
2. Confirm the project ref is not `jjzjuqxysucqutgjnrkk`.
3. Apply the reviewed schema-only baseline.
4. Apply only migrations newer than the baseline cutoff.
5. Create required storage buckets and storage policies if not included in the baseline.
6. Configure Auth redirect URLs.
7. Configure staging-only Edge Function secrets.
8. Deploy the minimum Event Projection acceptance Edge Functions.
9. Point Vercel Preview environment variables at staging.
10. Create synthetic fixtures.
11. Run synthetic acceptance.
12. Clean synthetic fixtures and verify cleanup.

## Minimum Function Set For Event Projection Acceptance

Deploy only:

- `kac-resolve`
- `public-action`
- `public-thread`
- `asset-thread-notify`
- `public-story-media`

Deploy `public-resolve` only if the Preview path being tested still invokes it.

Do not deploy Intelligence, extraction, billing, upload, Stripe, proposal, or
unrelated functions for this acceptance pass unless a test proves the Preview
build depends on them.

## Environment Isolation

Vercel Preview must point to staging values only:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_KEEPR_BASE_URL`
- `PUBLIC_KEEPR_BASE_URL`

Supabase Edge Function staging secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `POSTMARK_SERVER_TOKEN`
- `SITE_URL`
- `EXPO_PUBLIC_KEEPR_BASE_URL`

Do not copy Production secret values into Preview or staging unless explicitly
approved for that environment. Never commit secret values.

## Postmark Staging Strategy

- Use the existing Postmark code path.
- Prefer a Postmark test server/stream.
- Allow approved internal recipients only.
- Never send staging messages to customers.
- Keep subjects and body privacy-safe.
- Preserve non-blocking email failure behavior.

## Storage Requirements

Minimum private buckets:

- `asset-photos`
- `asset-files`

Use synthetic placeholder objects only. Do not copy customer objects from
Production.

## Synthetic Fixture Strategy

Use a run prefix such as:

```text
stg_evtproj_<YYYYMMDDHHMM>_
```

Create only synthetic:

- owner profile/Auth user
- optional steward/member user
- public sender identity
- vehicle asset with KAC
- optional Hub and membership
- public Story configuration with Event Projection
- minimal public media rows and placeholder storage objects, if needed
- Ask Owner thread/message/token rows through the app flow

Cleanup must delete all rows and storage objects with the run prefix.

