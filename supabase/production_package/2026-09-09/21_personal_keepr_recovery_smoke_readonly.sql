-- Read-only smoke for Personal Keepr production recovery contract.

select
  'owner_baseline_counts' as check_name,
  (select count(*) from public.assets) as assets,
  (select count(*) from public.systems) as systems,
  (select count(*) from public.attachments) as attachments,
  (select count(*) from public.attachment_placements) as attachment_placements;

select
  'required_functions_present' as check_name,
  count(*) as present_count
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    (p.proname = 'keepr_user_can_read_asset_shared_media' and pg_get_function_identity_arguments(p.oid) = 'p_user_id uuid, p_asset_id uuid')
    or (p.proname = 'kac_hero_template_ids' and pg_get_function_identity_arguments(p.oid) = 'p_asset_id uuid')
    or (p.proname = 'kac_hero_placement_is_valid' and pg_get_function_identity_arguments(p.oid) = 'p_asset_id uuid, p_placement_id uuid')
    or (p.proname = 'resolve_asset_shared_hero_media' and pg_get_function_identity_arguments(p.oid) = 'p_asset_id uuid, p_organization_id uuid')
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

select
  'hero_resolver_authenticated_grants' as check_name,
  count(*) as grant_count
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'keepr_user_can_read_asset_shared_media',
    'kac_hero_template_ids',
    'kac_hero_placement_is_valid',
    'resolve_asset_shared_hero_media'
  )
  and grantee = 'authenticated'
  and privilege_type = 'EXECUTE';

select
  'hero_resolver_anon_grants' as check_name,
  count(*) as anon_grant_count
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name in (
    'keepr_user_can_read_asset_shared_media',
    'kac_hero_template_ids',
    'kac_hero_placement_is_valid',
    'resolve_asset_shared_hero_media'
  )
  and grantee = 'anon'
  and privilege_type = 'EXECUTE';
