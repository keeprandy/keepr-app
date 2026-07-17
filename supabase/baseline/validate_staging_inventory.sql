-- Read-only staging validation.
-- Run only against a staging project, never against keepr-prod.

select
  case
    when current_setting('app.settings.project_ref', true) = 'jjzjuqxysucqutgjnrkk'
      then 'FAIL: production project ref'
    else 'CHECK: confirm project ref outside SQL'
  end as project_ref_guard;

with required(relkind, schema_name, object_name) as (
  values
    ('r', 'public', 'profiles'),
    ('r', 'public', 'assets'),
    ('r', 'public', 'asset_stewardships'),
    ('r', 'public', 'org_members'),
    ('r', 'public', 'hubs'),
    ('r', 'public', 'hub_members'),
    ('v', 'public', 'public_asset_story_summary'),
    ('v', 'public', 'public_asset_story_gallery'),
    ('r', 'public', 'attachments'),
    ('r', 'public', 'attachment_placements'),
    ('r', 'public', 'attachment_links'),
    ('r', 'public', 'asset_threads'),
    ('r', 'public', 'asset_thread_messages'),
    ('r', 'public', 'event_inbox'),
    ('r', 'public', 'notifications'),
    ('r', 'public', 'public_asset_thread_tokens')
)
select
  required.schema_name,
  required.object_name,
  case when c.oid is null then 'missing' else 'present' end as status
from required
left join pg_namespace n on n.nspname = required.schema_name
left join pg_class c
  on c.relnamespace = n.oid
 and c.relname = required.object_name
 and c.relkind = required.relkind
order by required.schema_name, required.object_name;

select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args,
  'present' as status
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('resolve_kac', 'keepr_resolve_kac_for_manifest_admin')
order by p.proname, args;

select
  c.relname as table_name,
  c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in (
    'profiles',
    'assets',
    'asset_threads',
    'asset_thread_messages',
    'public_asset_thread_tokens',
    'notifications'
  )
order by c.relname;

select
  schemaname,
  tablename,
  policyname,
  roles,
  cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'public_asset_thread_tokens'
order by policyname;

