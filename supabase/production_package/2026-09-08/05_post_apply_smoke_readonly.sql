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

\echo '== temporary release apply role must own no production objects =='
with owned_relations as (
  select 'relation'::text as object_kind, n.nspname, c.relname as object_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_roles r on r.oid = c.relowner
  where r.rolname = 'keepr_prod_release_apply'
    and n.nspname not in ('pg_catalog', 'information_schema')
),
owned_functions as (
  select 'function'::text as object_kind, n.nspname, p.proname as object_name
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_roles r on r.oid = p.proowner
  where r.rolname = 'keepr_prod_release_apply'
    and n.nspname not in ('pg_catalog', 'information_schema')
),
owned_types as (
  select 'type'::text as object_kind, n.nspname, t.typname as object_name
  from pg_type t
  join pg_namespace n on n.oid = t.typnamespace
  join pg_roles r on r.oid = t.typowner
  where r.rolname = 'keepr_prod_release_apply'
    and n.nspname not in ('pg_catalog', 'information_schema')
)
select object_kind, nspname, object_name
from owned_relations
union all
select object_kind, nspname, object_name
from owned_functions
union all
select object_kind, nspname, object_name
from owned_types
order by object_kind, nspname, object_name;
