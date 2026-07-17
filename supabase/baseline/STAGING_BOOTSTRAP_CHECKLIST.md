# Staging Bootstrap Checklist

## Preflight

- [ ] Confirm target Supabase project is not `jjzjuqxysucqutgjnrkk`.
- [ ] Confirm target project name is not `keepr-prod`.
- [ ] Confirm no Production data, Auth users, storage objects, tokens, messages, or customer records will be copied.
- [ ] Confirm Vercel Preview env variables point to staging.
- [ ] Confirm Postmark will send only to approved internal recipients.

## Required Object Inventory

The staging schema must include at minimum:

- `public.profiles`
- `public.assets`
- `public.master_assets`, if resolver paths require it
- `public.asset_stewardships`
- `public.org_members`
- `public.hubs`
- `public.hub_members`
- `public.public_asset_story_summary`
- `public.public_asset_story_gallery`
- `public.attachments`
- `public.attachment_placements`
- `public.attachment_links`
- `public.asset_threads`
- `public.asset_thread_messages`
- `public.event_inbox`
- `public.notifications`
- `public.public_asset_thread_tokens`
- `public.resolve_kac(...)`
- `public.keepr_resolve_kac_for_manifest_admin(text)`

## RLS / Policy Checks

- [ ] RLS enabled on public-thread token table.
- [ ] No public or anonymous read policy exists for `public_asset_thread_tokens`.
- [ ] `asset_threads` and `asset_thread_messages` remain protected by authenticated/owner/member policies.
- [ ] Public media views expose only approved public rows.
- [ ] Profile sensitive-field trigger exists.

## Storage

- [ ] `asset-photos` bucket exists.
- [ ] `asset-files` bucket exists.
- [ ] Buckets remain private unless a specific public bucket is explicitly required.
- [ ] Public media proxy flow does not expose bucket names, storage paths, object keys, or signed URLs.

## Auth

- [ ] Staging Auth site URL configured.
- [ ] Preview redirect URL configured.
- [ ] Localhost redirect URL configured if needed.
- [ ] Synthetic users only.

## Acceptance

- [ ] Event Projection can be configured and published.
- [ ] Event Showcase card renders.
- [ ] Vehicle Highlights card renders.
- [ ] Message Owner card renders.
- [ ] Ask Owner creates exactly one canonical thread.
- [ ] Owner receives in-app notification.
- [ ] Owner receives Postmark test email.
- [ ] Email CTA opens exact thread/message.
- [ ] Authentication resumes exact destination.
- [ ] Owner can reply through existing messaging screen.
- [ ] Public sender receives reply email.
- [ ] Public sender can reopen same conversation.
- [ ] Public sender can post follow-up to same thread.
- [ ] Invalid token fails closed.
- [ ] Revoked token fails closed.
- [ ] Expired token fails closed.
- [ ] Unauthorized thread IDs reveal no information.
- [ ] No notification route falls back to Dashboard.
- [ ] Share and existing Public Story behavior remain intact.

## Cleanup

- [ ] Delete synthetic messages.
- [ ] Delete synthetic public token rows.
- [ ] Delete synthetic notifications.
- [ ] Delete synthetic threads.
- [ ] Delete synthetic public media rows.
- [ ] Delete synthetic storage objects.
- [ ] Delete synthetic Hub/membership rows.
- [ ] Delete synthetic asset rows.
- [ ] Delete synthetic profiles/Auth users.
- [ ] Verify no rows remain for the run prefix.

