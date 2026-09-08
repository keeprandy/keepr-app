-- Production convergence post-apply smoke checks.
-- READ ONLY. Run after approved schema/backfill/data/code rollout.

\echo '== owner data counts must preserve baseline =='
select 'assets' as table_name, count(*) as rows from public.assets
union all select 'systems', count(*) from public.systems
union all select 'attachments', count(*) from public.attachments
union all select 'attachment_placements', count(*) from public.attachment_placements
order by table_name;

\echo '== launch graph presence =='
select
  (select count(*) from public.orgs where slug in ('tiara-yachts', 'bennington')) as launch_oems,
  (select count(*) from public.orgs where slug in ('wilsonmarine', 'wilson-marine')) as wilson_candidates,
  (select count(*) from public.brands where slug in ('tiara-yachts', 'bennington')) as launch_brands,
  (select count(*) from public.asset_model_templates where template_key like '%tiara%' or template_key like '%bennington%') as launch_templates,
  (select count(*) from public.system_templates) as system_templates,
  (select count(*) from public.keepr_links where normalized_address in ('tiara', 'tiara-yachts', 'bennington')) as org_keeprlinks;

\echo '== public-safe resource flags =='
select
  applies_to_type,
  count(*) as resources,
  count(*) filter (where public_link_allowed) as public_link_allowed,
  count(*) filter (where public_url_allowed) as public_url_allowed
from public.asset_resources
where applies_to_type in ('org', 'template', 'system_template')
group by applies_to_type
order by applies_to_type;

\echo '== exact build table contract present, with no promoted KF018 rows expected =='
select
  (to_regclass('public.exact_build_drafts') is not null) as exact_build_drafts_present,
  case
    when to_regclass('public.exact_build_drafts') is null then null
    else (select count(*) from public.exact_build_drafts)
  end as exact_build_draft_rows;

\echo '== release-created objects should be owned by postgres =='
with expected_release_relations(relname) as (
  values
    ('brands'),
    ('organization_brand_relationships'),
    ('system_templates'),
    ('keepr_links'),
    ('exact_build_drafts'),
    ('exact_build_draft_items')
),
expected_release_functions(proname) as (
  values
    ('keeprlink_slugify'),
    ('keeprlink_normalize_address'),
    ('keeprlink_compact_address'),
    ('keeprlink_purpose'),
    ('keeprlink_public_purpose'),
    ('keeprlink_context_instructions'),
    ('keeprlink_resource_projection'),
    ('keeprlink_org_context'),
    ('keeprlink_model_context'),
    ('keeprlink_system_template_context'),
    ('keeprlink_asset_context'),
    ('keeprlink_system_instance_context'),
    ('resolve_keeprlink_context'),
    ('search_keeprspace_organizations'),
    ('apply_system_template_reference_from_metadata'),
    ('list_organization_supplier_network'),
    ('ensure_asset_keepr_link'),
    ('sync_asset_keepr_link'),
    ('promote_system_to_system_template')
),
release_relations as (
  select 'relation'::text as object_kind, n.nspname, c.relname as object_name, r.rolname as owner
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = c.relowner
  join expected_release_relations e on e.relname = c.relname
  where n.nspname = 'public'
    and c.relkind in ('r', 'p')
    and r.rolname <> 'postgres'
),
release_functions as (
  select 'function'::text as object_kind, n.nspname, p.proname as object_name, r.rolname as owner
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  join expected_release_functions e on e.proname = p.proname
  where n.nspname = 'public'
    and r.rolname <> 'postgres'
),
release_types as (
  select 'type'::text as object_kind, n.nspname, t.typname as object_name, r.rolname as owner
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_roles r on r.oid = t.typowner
  join expected_release_relations e on e.relname = t.typname
  where n.nspname = 'public'
    and r.rolname <> 'postgres'
)
select object_kind, nspname, object_name, owner
from release_relations
union all
select object_kind, nspname, object_name, owner
from release_functions
union all
select object_kind, nspname, object_name, owner
from release_types
order by object_kind, nspname, object_name;
