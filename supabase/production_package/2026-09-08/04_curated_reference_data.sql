-- Production convergence curated reference-data promotion.
-- DO NOT RUN until explicitly approved.
-- This is not a staging clone. It resolves canonical production identities and
-- upserts launch reference content by stable keys.
-- KF018 and exact build drafts are intentionally excluded.

begin;

\echo '== expected reference inserts/updates before execution =='
with existing as (
  select
    (select count(*) from public.orgs where lower(coalesce(slug, '')) = 'bennington') as bennington_orgs,
    (select count(*) from public.orgs where lower(coalesce(slug, '')) in ('tiara-yachts', 'tiarayachts', 'tiara')) as tiara_orgs,
    (select count(*) from public.orgs where lower(coalesce(slug, '')) in ('wilsonmarine', 'wilson-marine')) as wilson_orgs,
    (select count(*) from public.asset_model_templates where organization_id in (
      select id from public.orgs where lower(coalesce(slug, '')) in ('tiara-yachts', 'tiarayachts', 'tiara', 'bennington')
    )) as launch_templates,
    (select count(*) from public.system_templates) as system_templates,
    (select count(*) from public.keepr_links) as keepr_links
)
select * from existing;

with tiara as (
  select id
  from public.orgs
  where lower(coalesce(slug, '')) in ('tiara-yachts', 'tiarayachts', 'tiara')
     or lower(coalesce(display_name, name, '')) = 'tiara yachts'
  order by case when lower(coalesce(slug, '')) = 'tiara-yachts' then 0 else 1 end, created_at
  limit 1
),
upsert_tiara_brand as (
  insert into public.brands(name, slug, status, website, metadata)
  values (
    'Tiara Yachts',
    'tiara-yachts',
    'active',
    'https://www.tiarayachts.com/',
    jsonb_build_object('promoted_by', 'production_convergence_2026_09_04')
  )
  on conflict (lower(slug)) do update set
    name = excluded.name,
    website = coalesce(excluded.website, public.brands.website),
    metadata = coalesce(public.brands.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now()
  returning id
)
insert into public.organization_brand_relationships(
  organization_id,
  brand_id,
  relationship_type,
  status,
  evidence_state,
  metadata
)
select
  tiara.id,
  upsert_tiara_brand.id,
  'owns_brand',
  'active',
  'org_confirmed',
  jsonb_build_object('promoted_by', 'production_convergence_2026_09_04')
from tiara, upsert_tiara_brand
on conflict (organization_id, brand_id, relationship_type) where status in ('source_reported', 'active')
do update set
  status = excluded.status,
  evidence_state = excluded.evidence_state,
  metadata = coalesce(public.organization_brand_relationships.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

insert into public.orgs(
  name,
  display_name,
  slug,
  org_type,
  organization_type,
  workspace_type,
  workspace_capabilities,
  status,
  authority_state,
  source_type,
  source_name,
  source_url,
  source_metadata
)
select
  'Bennington',
  'Bennington',
  'bennington',
  'manufacturer',
  'oem',
  'keeproem',
  '["product_catalog","system_library","resources","keeprlink","dealer_network"]'::jsonb,
  'active',
  'org_managed',
  'keepr_curated',
  'Keepr production convergence',
  'https://www.benningtonmarine.com/',
  jsonb_build_object('promoted_by', 'production_convergence_2026_09_04')
where not exists (
  select 1
  from public.orgs
  where lower(coalesce(slug, '')) = 'bennington'
     or lower(coalesce(display_name, name, '')) = 'bennington'
);

update public.orgs
set
  display_name = coalesce(nullif(display_name, ''), 'Bennington'),
  slug = coalesce(nullif(slug, ''), 'bennington'),
  org_type = case when org_type in ('manufacturer', 'oem') then org_type else 'manufacturer' end,
  organization_type = case when organization_type in ('manufacturer', 'oem') then organization_type else 'oem' end,
  workspace_type = coalesce(nullif(workspace_type, ''), 'keeproem'),
  workspace_capabilities = (
    select jsonb_agg(distinct capability)
    from jsonb_array_elements_text(
      coalesce(public.orgs.workspace_capabilities, '[]'::jsonb)
      || '["product_catalog","system_library","resources","keeprlink","dealer_network"]'::jsonb
    ) as capability
  ),
  source_metadata = coalesce(source_metadata, '{}'::jsonb) || jsonb_build_object('promoted_by', 'production_convergence_2026_09_04'),
  updated_at = now()
where lower(coalesce(slug, '')) = 'bennington'
   or lower(coalesce(display_name, name, '')) = 'bennington';

with bennington as (
  select id from public.orgs where slug = 'bennington' limit 1
),
brand as (
  insert into public.brands(name, slug, status, website, metadata)
  values (
    'Bennington',
    'bennington',
    'active',
    'https://www.benningtonmarine.com/',
    jsonb_build_object('promoted_by', 'production_convergence_2026_09_04')
  )
  on conflict (lower(slug)) do update set
    name = excluded.name,
    website = coalesce(excluded.website, public.brands.website),
    metadata = coalesce(public.brands.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now()
  returning id
)
insert into public.organization_brand_relationships(
  organization_id,
  brand_id,
  relationship_type,
  status,
  evidence_state,
  metadata
)
select
  bennington.id,
  brand.id,
  'owns_brand',
  'active',
  'org_confirmed',
  jsonb_build_object('promoted_by', 'production_convergence_2026_09_04')
from bennington, brand
on conflict (organization_id, brand_id, relationship_type) where status in ('source_reported', 'active')
do update set
  status = excluded.status,
  evidence_state = excluded.evidence_state,
  metadata = coalesce(public.organization_brand_relationships.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

insert into public.system_templates (
  canonical_key,
  name,
  manufacturer,
  system_category,
  description,
  authority_state,
  metadata
)
values
  ('system_template.mercury.mercury_600_v12_verado', 'Mercury 600 V12 Verado', 'Mercury Marine', 'Propulsion', 'Reusable propulsion system template for Mercury 600 V12 Verado outboard packages.', 'keepr_curated', jsonb_build_object('seeded_by', 'production_convergence_2026_09_04')),
  ('system_template.seakeeper.seakeeper_sk10_5', 'Seakeeper SK10.5', 'Seakeeper', 'Stabilization', 'Reusable gyro stabilization system template for Seakeeper SK10.5 installations.', 'keepr_curated', jsonb_build_object('seeded_by', 'production_convergence_2026_09_04')),
  ('system_template.onan.onan_13_5kw_generator', 'Onan 13.5kW Generator', 'Onan', 'Electrical', 'Reusable marine generator template for Onan 13.5kW generator packages.', 'keepr_curated', jsonb_build_object('seeded_by', 'production_convergence_2026_09_04')),
  ('system_template.dometic_vacuflush.sanitation_system', 'Dometic/VacuFlush Sanitation System', 'Dometic/VacuFlush', 'Plumbing', 'Reusable sanitation system template for Dometic/VacuFlush marine head systems.', 'keepr_curated', jsonb_build_object('seeded_by', 'production_convergence_2026_09_04')),
  ('system_template.starlink.starlink_marine', 'Starlink', 'Starlink', 'Connectivity', 'Reusable connectivity system template for Starlink installations on mobile or marine assets.', 'keepr_curated', jsonb_build_object('seeded_by', 'production_convergence_2026_09_04'))
on conflict (canonical_key) do update set
  name = excluded.name,
  manufacturer = excluded.manufacturer,
  system_category = excluded.system_category,
  description = excluded.description,
  authority_state = case
    when public.system_templates.authority_state = 'retired' then public.system_templates.authority_state
    else excluded.authority_state
  end,
  metadata = coalesce(public.system_templates.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

with launch_templates(org_slug, brand_slug, template_key, model_year, manufacturer, model, status, metadata) as (
  values
    ('tiara-yachts', 'tiara-yachts', '2027-tiara-yachts-34-lx', 2027, 'Tiara Yachts', '34 LX', 'draft', '{"series":"LX"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', '2027-tiara-yachts-35-ls', 2027, 'Tiara Yachts', '35 LS', 'draft', '{"series":"LS"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', '2027-tiara-yachts-43le', 2027, 'Tiara Yachts', '43 LE', 'draft', '{"series":"LE"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', '2027-tiara-yachts-46-ls', 2027, 'Tiara Yachts', '46 LS', 'draft', '{"series":"LS"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', '2027-tiara-yachts-48-le', 2027, 'Tiara Yachts', '48 LE', 'draft', '{"series":"LE"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', '2027-tiara-yachts-54-ex', 2027, 'Tiara Yachts', '54 EX', 'draft', '{"series":"EX"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', '2027-tiara-yachts-60-ex', 2027, 'Tiara Yachts', '60 EX', 'draft', '{"series":"EX"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', 'tiara-2026-39-le', 2026, 'Tiara Yachts', '39 LE', 'published', '{"series":"LE"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', 'tiara-2027-39-le', 2027, 'Tiara Yachts', '39 LE', 'published', '{"series":"LE"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', 'tiara-2027-39-ls', 2027, 'Tiara Yachts', '39 LS', 'published', '{"series":"LS"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', 'tiara-2027-43-ls', 2027, 'Tiara Yachts', '43 LS', 'published', '{"series":"LS"}'::jsonb),
    ('tiara-yachts', 'tiara-yachts', 'tiara-2027-56-ls', 2027, 'Tiara Yachts', '56 LS', 'published', '{"series":"LS"}'::jsonb),
    ('bennington', 'bennington', '2027-bennington-22m-fastback-quad-bench', 2027, 'Bennington', '22M Fastback Quad Bench', 'draft', '{"series":"M"}'::jsonb),
    ('bennington', 'bennington', '2027-bennington-25-qx', 2027, 'Bennington', '25 QX', 'draft', '{"series":"QX"}'::jsonb)
)
insert into public.asset_model_templates(
  organization_id,
  brand_id,
  asset_type,
  category,
  manufacturer,
  model,
  model_year,
  template_key,
  status,
  authority_state,
  metadata
)
select
  o.id,
  b.id,
  'boat',
  'marine',
  lt.manufacturer,
  lt.model,
  lt.model_year,
  lt.template_key,
  lt.status,
  'oem_published',
  lt.metadata || jsonb_build_object('promoted_by', 'production_convergence_2026_09_04')
from launch_templates lt
join public.orgs o on o.slug = lt.org_slug
join public.brands b on b.slug = lt.brand_slug
on conflict (template_key, version) do update set
  organization_id = excluded.organization_id,
  brand_id = excluded.brand_id,
  manufacturer = excluded.manufacturer,
  model = excluded.model,
  model_year = excluded.model_year,
  status = excluded.status,
  authority_state = excluded.authority_state,
  metadata = coalesce(public.asset_model_templates.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

with tiara as (select id from public.orgs where slug = 'tiara-yachts' limit 1),
bennington as (select id from public.orgs where slug = 'bennington' limit 1),
resources(org_id, resource_type, title, url, source_name, authority_state, rights_status, applies_to_type, metadata) as (
  select id, 'oem_website', 'Tiara Main Website', 'https://www.tiarayachts.com/', 'Tiara Yachts', 'oem_published', 'public_ok', 'org',
    jsonb_build_object('ai_context', jsonb_build_object('role', 'supporting', 'scope', 'organization', 'privacy', 'public_safe', 'review_state', 'public_source_ok'))
  from tiara
  union all
  select id, 'oem_catalog', 'Bennington 2025 Catalog', 'https://www.macsportandmarine.com/portals/macsportandmarine/Bennington-Luxury-Performance-Boats-Catalog-2025%20-%20Flip%20PDF%20_%20FlipBuilder_4_1.pdf', 'Bennington', 'oem_published', 'public_ok', 'org',
    jsonb_build_object('ai_context', jsonb_build_object('role', 'supporting', 'scope', 'organization', 'privacy', 'public_safe', 'review_state', 'public_source_ok'))
  from bennington
)
insert into public.asset_resources(
  resource_type,
  title,
  url,
  source_name,
  source_url,
  authority_state,
  rights_status,
  applies_to_type,
  applies_to_id,
  metadata,
  role,
  public_url_allowed,
  public_link_allowed
)
select
  resource_type,
  title,
  url,
  source_name,
  url,
  authority_state,
  rights_status,
  applies_to_type,
  org_id,
  metadata || jsonb_build_object('promoted_by', 'production_convergence_2026_09_04'),
  'Catalog',
  true,
  true
from resources
on conflict do nothing;

with link_targets as (
  select '/k/Tiara' as address, 'organization' as object_type, id as object_id, false as canonical
  from public.orgs where slug = 'tiara-yachts'
  union all select '/k/tiara-yachts', 'organization', id, true from public.orgs where slug = 'tiara-yachts'
  union all select '/k/bennington', 'organization', id, true from public.orgs where slug = 'bennington'
  union all select '/k/' || template_key, 'asset_model_template', id, true from public.asset_model_templates
  where template_key in (
    '2027-tiara-yachts-34-lx',
    '2027-tiara-yachts-35-ls',
    '2027-tiara-yachts-43le',
    '2027-tiara-yachts-46-ls',
    '2027-tiara-yachts-48-le',
    '2027-tiara-yachts-54-ex',
    '2027-tiara-yachts-60-ex',
    'tiara-2026-39-le',
    'tiara-2027-39-le',
    'tiara-2027-39-ls',
    'tiara-2027-43-ls',
    'tiara-2027-56-ls',
    '2027-bennington-22m-fastback-quad-bench',
    '2027-bennington-25-qx'
  )
)
insert into public.keepr_links(address, normalized_address, object_type, object_id, is_canonical, status, metadata)
select
  address,
  public.keeprlink_normalize_address(address),
  object_type,
  object_id,
  canonical,
  'active',
  jsonb_build_object('promoted_by', 'production_convergence_2026_09_04')
from link_targets
on conflict (normalized_address) where status = 'active'
do update set
  object_type = excluded.object_type,
  object_id = excluded.object_id,
  is_canonical = excluded.is_canonical,
  metadata = coalesce(public.keepr_links.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

with bennington as (select id from public.orgs where slug = 'bennington' limit 1),
wilson as (
  select id
  from public.orgs
  where lower(coalesce(slug, '')) in ('wilsonmarine', 'wilson-marine')
     or lower(coalesce(display_name, name, '')) = 'wilson marine'
  order by case when lower(coalesce(slug, '')) = 'wilsonmarine' then 0 else 1 end, created_at
  limit 1
)
insert into public.org_relationships(
  from_org_id,
  to_org_id,
  relationship_type,
  status,
  evidence_state,
  authority_state,
  source_name,
  source_url,
  metadata
)
select
  bennington.id,
  wilson.id,
  'authorized_dealer',
  'active',
  'org_confirmed',
  'org_confirmed',
  'Keepr production convergence',
  'https://www.wilsonboats.com/',
  jsonb_build_object('promoted_by', 'production_convergence_2026_09_04')
from bennington, wilson
where bennington.id is not null and wilson.id is not null
on conflict do nothing;

\echo '== after: curated launch data aggregate counts =='
select 'brands' as table_name, count(*) as rows from public.brands
union all select 'organization_brand_relationships', count(*) from public.organization_brand_relationships
union all select 'system_templates', count(*) from public.system_templates
union all select 'asset_model_templates', count(*) from public.asset_model_templates
union all select 'asset_resources', count(*) from public.asset_resources
union all select 'keepr_links', count(*) from public.keepr_links
order by table_name;

commit;
