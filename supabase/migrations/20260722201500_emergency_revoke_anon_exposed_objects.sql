-- Emergency security hotfix:
-- prevent anonymous PostgREST reads for confirmed exposed production objects.
--
-- Scope intentionally limited to grants only. This migration does not enable
-- RLS, rewrite policies, change SECURITY DEFINER functions, alter public story
-- projection views, or change application tables beyond the listed revokes.
--
-- Production note: this SQL was manually applied to keepr-prod through the
-- Supabase SQL Editor on 2026-07-22. This file preserves repository history
-- and must not be applied again blindly while migration history is unreconciled.

revoke select on table public.admin_user_story_summary from anon;
revoke select on table public.actions from anon;
revoke select on table public.reminders from anon;
revoke select on table public.public_intake_events from anon;
revoke select on table public.attachments_backup_20260226 from anon;
revoke select on table public.attachment_meta_backup_20260226 from anon;
revoke select on table public.attachment_placements_backup_20260226 from anon;

-- All admin views should be unavailable to anonymous clients.
revoke select on table public.admin_user_assets from anon;
revoke select on table public.admin_asset_story_summary from anon;
revoke select on table public.admin_system_story_summary from anon;
revoke select on table public.admin_user_story_summary from anon;

-- Backup attachment tables are historical/internal data. They should not be
-- reachable by browser clients in this emergency posture.
revoke all privileges on table public.attachments_backup_20260226 from anon;
revoke all privileges on table public.attachment_meta_backup_20260226 from anon;
revoke all privileges on table public.attachment_placements_backup_20260226 from anon;

revoke all privileges on table public.attachments_backup_20260226 from authenticated;
revoke all privileges on table public.attachment_meta_backup_20260226 from authenticated;
revoke all privileges on table public.attachment_placements_backup_20260226 from authenticated;
