-- Production convergence preflight.
-- READ ONLY. Run before any schema/data package file.
-- Goal: confirm the actual production baseline and expected impact counts.

\echo '== connection =='
select current_database() as db, current_user as user_name;

\echo '== migration ledger =='
select count(*) as migration_count, max(version) as latest_version
from supabase_migrations.schema_migrations;

select version, name
from supabase_migrations.schema_migrations
where version >= '20260810000000'
order by version;

\echo '== required table presence =='
select required.table_name, (t.table_name is not null) as present
from (
  values
    ('orgs'),
    ('org_relationships'),
    ('brands'),
    ('organization_brand_relationships'),
    ('asset_model_templates'),
    ('asset_model_template_items'),
    ('system_templates'),
    ('systems'),
    ('attachments'),
    ('attachment_placements'),
    ('asset_resources'),
    ('asset_template_bindings'),
    ('keepr_links'),
    ('exact_build_drafts')
) as required(table_name)
left join information_schema.tables t
  on t.table_schema = 'public'
 and t.table_name = required.table_name
order by required.table_name;

\echo '== protected owner data aggregate counts =='
select 'assets' as table_name, count(*) as rows from public.assets
union all select 'systems', count(*) from public.systems
union all select 'attachments', count(*) from public.attachments
union all select 'attachment_placements', count(*) from public.attachment_placements
union all select 'orgs', count(*) from public.orgs
union all select 'org_relationships', count(*) from public.org_relationships
union all select 'asset_model_templates', count(*) from public.asset_model_templates
union all select 'asset_model_template_items', count(*) from public.asset_model_template_items
union all select 'asset_resources', count(*) from public.asset_resources
union all select 'asset_template_bindings', count(*) from public.asset_template_bindings
order by table_name;

\echo '== attachment placement target shapes =='
select target_type, count(*)
from public.attachment_placements
group by target_type
order by target_type;

\echo '== canonical org candidates =='
select
  id,
  name,
  display_name,
  slug,
  org_type,
  organization_type,
  workspace_type,
  status
from public.orgs
where lower(coalesce(slug, '')) in ('tiara-yachts', 'tiarayachts', 'tiara', 'bennington', 'wilsonmarine', 'wilson-marine')
   or lower(coalesce(display_name, name, '')) in ('tiara yachts', 'bennington', 'wilson marine')
order by lower(coalesce(display_name, name, slug));

\echo '== release-critical columns =='
select
  required.table_name,
  required.column_name,
  (c.column_name is not null) as present,
  c.data_type,
  c.is_nullable
from (
  values
    ('asset_model_templates', 'brand_id'),
    ('asset_model_template_items', 'system_template_id'),
    ('systems', 'system_template_id'),
    ('systems', 'system_group_id')
) as required(table_name, column_name)
left join information_schema.columns c
  on c.table_schema = 'public'
 and c.table_name = required.table_name
 and c.column_name = required.column_name
order by required.table_name, required.column_name;

\echo '== selected policy inventory =='
select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in (
    'brands',
    'organization_brand_relationships',
    'system_templates',
    'keepr_links',
    'asset_model_templates',
    'asset_model_template_items',
    'systems',
    'attachments',
    'attachment_placements',
    'asset_resources'
  )
order by tablename, policyname;

\echo '== selected function inventory =='
select
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as args,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'resolve_keeprlink_context',
    'keeprlink_resource_projection',
    'search_keeprspace_organizations',
    'upsert_brand_by_name',
    'upsert_organization_brand_relationship',
    'get_organization_brand_graph',
    'apply_system_template_reference_from_metadata',
    'activator_user_can_author_catalog_for_org',
    'activator_user_can_author_for_org'
  )
order by function_name, args;
