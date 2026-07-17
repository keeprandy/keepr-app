# Public Sender Continuity Deployment Plan

Status: prepared only. No migration, Edge Function, Vercel Preview, or Production deployment has been run from this work.

## Scope

This build lets a public Ask Owner sender reopen the same asset conversation without creating an account.

It uses:

- `asset_threads`
- `asset_thread_messages`
- `KeeprActionScreen`
- exact thread/message permalink routes
- existing Postmark transactional email pattern

## Database Change

Pending migration:

- `supabase/migrations/20260717120000_public_asset_thread_tokens.sql`

Creates:

- `public.public_asset_thread_tokens`

Stored fields:

- `thread_id`
- `asset_id`
- `sender_email`
- `sender_name`
- `token_hash`
- `created_at`
- optional `expires_at`
- nullable `revoked_at`
- `last_used_at`

The raw token is never stored.

RLS is enabled. No anonymous direct table policy is created.

## Edge Functions

Deploy after migration approval:

1. `public-action`
   - creates or reuses the canonical Ask Owner thread for public `question` submissions
   - inserts the public sender message
   - stores only the token hash
   - creates the owner in-app notification
   - sends owner Postmark email best-effort

2. `public-thread`
   - validates opaque public token by hash
   - reads only the bound thread/messages
   - posts public follow-ups only to the bound thread
   - returns generic errors for invalid, expired, or revoked tokens

3. `asset-thread-notify`
   - preserves authenticated owner/member notifications
   - for owner replies to public senders, mints a fresh public token and emails the exact public thread/message URL

## Client Change

`PublicActionScreen` opens the returned public thread permalink after Ask Owner.

`KeeprActionScreen` supports:

- authenticated owner/member exact thread links
- secure public-token thread links
- exact message highlighting
- explicit missing/denied/expired states
- no Dashboard fallback

## Deployment Sequence

Do not run until approved.

1. Confirm migration status against the target project.
2. Apply only:
   - `20260717120000_public_asset_thread_tokens.sql`
3. Deploy only:
   - `public-action`
   - `public-thread`
   - `asset-thread-notify`
4. Deploy web/app Preview from this branch.
5. Validate with synthetic fixtures first:
   - public Ask Owner creates one thread
   - public sender can reopen by token
   - public sender can post follow-up
   - owner reply emails a fresh public permalink
   - invalid/expired/revoked token fails closed
   - no Dashboard fallback
6. Only after synthetic validation, test against approved real public story paths.

## Rollback

If validation fails before Production:

1. Do not promote Preview.
2. Redeploy prior Edge Function versions for:
   - `public-action`
   - `asset-thread-notify`
3. Leave the unused token table in place until reviewed, or run a reviewed rollback migration:
   - `drop table public.public_asset_thread_tokens;`

If validation fails after a future Production promotion:

1. Promote the previous Vercel Production deployment.
2. Redeploy prior Edge Function versions.
3. Revoke affected public sender tokens:
   - set `revoked_at = now()` for impacted rows.

## Security Notes

- A thread ID or URL alone grants no access.
- Public access is token-scoped and server-enforced.
- Public token operations do not expose private asset data, storage paths, signed URLs, Hub admin state, owner/member authority, or direct table access.
- Email failure is logged and does not roll back saved messages or in-app notifications.
