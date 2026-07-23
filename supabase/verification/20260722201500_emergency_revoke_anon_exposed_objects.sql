-- Verification for 20260722201500_emergency_revoke_anon_exposed_objects.sql
--
-- Run after applying the migration in the target environment.
-- Expected:
-- - anon has no SELECT on the protected objects.
-- - service_role still has SELECT.
-- - authenticated remains unchanged for actions/reminders/public_intake_events.
-- - authenticated has no privileges on the three backup attachment tables.

select
  object_name,
  has_table_privilege('anon', object_name, 'select') as anon_can_select,
  has_table_privilege('authenticated', object_name, 'select') as authenticated_can_select,
  has_table_privilege('service_role', object_name, 'select') as service_role_can_select
from (
  values
    ('public.admin_user_story_summary'),
    ('public.admin_user_assets'),
    ('public.admin_asset_story_summary'),
    ('public.admin_system_story_summary'),
    ('public.actions'),
    ('public.reminders'),
    ('public.public_intake_events'),
    ('public.attachments_backup_20260226'),
    ('public.attachment_meta_backup_20260226'),
    ('public.attachment_placements_backup_20260226')
) as protected(object_name)
order by object_name;

select
  object_name,
  has_table_privilege('anon', object_name, 'select,insert,update,delete') as anon_has_any_dml,
  has_table_privilege('authenticated', object_name, 'select,insert,update,delete') as authenticated_has_any_dml,
  has_table_privilege('service_role', object_name, 'select,insert,update,delete') as service_role_has_any_dml
from (
  values
    ('public.attachments_backup_20260226'),
    ('public.attachment_meta_backup_20260226'),
    ('public.attachment_placements_backup_20260226')
) as backup(object_name)
order by object_name;
