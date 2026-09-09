-- Read-only smoke for attachment asset/system placement write-policy forward-fix.

select
  'owner_baseline_counts' as check_name,
  (select count(*) from public.assets) as assets,
  (select count(*) from public.systems) as systems,
  (select count(*) from public.attachments) as attachments,
  (select count(*) from public.attachment_placements) as attachment_placements;

select
  'authorized_target_write_policies' as check_name,
  count(*) as policy_count
from pg_policies
where schemaname = 'public'
  and tablename = 'attachment_placements'
  and policyname in (
    'attachment_placements_insert_authorized_target',
    'attachment_placements_update_authorized_target',
    'attachment_placements_delete_authorized_target'
  );

select
  'stale_recursive_attachment_policies' as check_name,
  count(*) as stale_policy_count
from pg_policies
where schemaname = 'public'
  and tablename = 'attachment_placements'
  and policyname in (
    'attachment_placements_insert_own',
    'placements_if_own_attachment_all',
    'attachment_placements_insert_visible',
    'attachment_placements_update_visible',
    'attachment_placements_delete_owner_only'
  );
