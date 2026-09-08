-- Production convergence compatibility backfills.
-- DO NOT RUN until explicitly approved.
-- Idempotent, additive, and non-destructive.
-- This file reports intended impact before applying each update.

begin;

\echo '== before: canonical org rows to normalize, aggregate-safe =='
select
  count(*) filter (
    where lower(coalesce(slug, '')) in ('tiara-yachts', 'tiarayachts', 'tiara')
       or lower(coalesce(display_name, name, '')) = 'tiara yachts'
  ) as tiara_candidates,
  count(*) filter (
    where lower(coalesce(slug, '')) in ('wilsonmarine', 'wilson-marine')
       or lower(coalesce(display_name, name, '')) = 'wilson marine'
  ) as wilson_candidates
from public.orgs;

with tiara as (
  select id
  from public.orgs
  where lower(coalesce(slug, '')) in ('tiara-yachts', 'tiarayachts', 'tiara')
     or lower(coalesce(display_name, name, '')) = 'tiara yachts'
  order by
    case when lower(coalesce(slug, '')) = 'tiara-yachts' then 0 else 1 end,
    created_at
  limit 1
)
update public.orgs o
set
  slug = coalesce(nullif(o.slug, ''), 'tiara-yachts'),
  display_name = coalesce(nullif(o.display_name, ''), 'Tiara Yachts'),
  organization_type = case
    when o.organization_type in ('oem', 'manufacturer') then o.organization_type
    else 'oem'
  end,
  org_type = case
    when o.org_type in ('manufacturer', 'oem') then o.org_type
    else 'manufacturer'
  end,
  workspace_type = coalesce(nullif(o.workspace_type, ''), 'keeproem'),
  workspace_capabilities = (
    select jsonb_agg(distinct capability)
    from jsonb_array_elements_text(
      coalesce(o.workspace_capabilities, '[]'::jsonb)
      || '["product_catalog","system_library","resources","keeprlink","dealer_network"]'::jsonb
    ) as capability
  ),
  updated_at = now()
from tiara
where o.id = tiara.id
  and (
    coalesce(o.slug, '') <> 'tiara-yachts'
    or coalesce(o.display_name, '') <> 'Tiara Yachts'
    or coalesce(o.organization_type, '') not in ('oem', 'manufacturer')
    or coalesce(o.org_type, '') not in ('manufacturer', 'oem')
    or coalesce(o.workspace_type, '') <> 'keeproem'
  );

with wilson as (
  select id
  from public.orgs
  where lower(coalesce(slug, '')) in ('wilsonmarine', 'wilson-marine')
     or lower(coalesce(display_name, name, '')) = 'wilson marine'
  order by
    case when lower(coalesce(slug, '')) = 'wilsonmarine' then 0 else 1 end,
    created_at
  limit 1
)
update public.orgs o
set
  slug = coalesce(nullif(o.slug, ''), 'wilsonmarine'),
  display_name = coalesce(nullif(o.display_name, ''), 'Wilson Marine'),
  organization_type = case
    when o.organization_type in ('dealer', 'keeprpro') then o.organization_type
    else 'dealer'
  end,
  org_type = case
    when o.org_type in ('dealer', 'keeprpro') then o.org_type
    else 'dealer'
  end,
  workspace_type = coalesce(nullif(o.workspace_type, ''), 'keeprpro'),
  workspace_capabilities = (
    select jsonb_agg(distinct capability)
    from jsonb_array_elements_text(
      coalesce(o.workspace_capabilities, '[]'::jsonb)
      || '["inventory","service","customers","resources","keeprlink"]'::jsonb
    ) as capability
  ),
  updated_at = now()
from wilson
where o.id = wilson.id
  and (
    coalesce(o.slug, '') = ''
    or coalesce(o.display_name, '') = ''
    or coalesce(o.organization_type, '') = ''
    or coalesce(o.org_type, '') = ''
    or coalesce(o.workspace_type, '') = ''
  );

\echo '== before: system_template_id backfill candidates =='
select count(*) as systems_with_metadata_template_item_no_system_template
from public.systems s
where s.system_template_id is null
  and coalesce(s.metadata, '{}'::jsonb) ? 'exact_build_template_item_id';

update public.systems s
set
  system_template_id = i.system_template_id,
  metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
    'system_template_id', i.system_template_id,
    'system_template_backfilled_by', 'production_convergence_2026_09_04'
  ),
  updated_at = now()
from public.asset_model_template_items i
where s.system_template_id is null
  and i.system_template_id is not null
  and coalesce(s.metadata, '{}'::jsonb) ->> 'exact_build_template_item_id' = i.id::text;

\echo '== after: protected owner data aggregate counts should preserve baseline =='
select 'assets' as table_name, count(*) as rows from public.assets
union all select 'systems', count(*) from public.systems
union all select 'attachments', count(*) from public.attachments
union all select 'attachment_placements', count(*) from public.attachment_placements
order by table_name;

commit;
