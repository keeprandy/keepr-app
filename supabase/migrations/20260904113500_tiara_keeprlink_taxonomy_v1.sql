-- Tiara KeeprLINK taxonomy seed.
-- This does not rename model templates or create Tiara-specific resolver logic.
-- It registers normalized KeeprLINK aliases and marks existing authoritative
-- resources with the canonical AI Context metadata contract.

with tiara_org as (
  select id
  from public.orgs
  where slug = 'tiara-yachts'
     or lower(display_name) = 'tiara yachts'
     or lower(name) = 'tiara yachts'
  order by case when slug = 'tiara-yachts' then 0 else 1 end
  limit 1
),
org_aliases(address, display_name) as (
  values
    ('/k/Tiara', 'Tiara Yachts'),
    ('/k/TiaraYachts', 'Tiara Yachts'),
    ('/k/tiarayachts', 'Tiara Yachts'),
    ('/k/Tiara Yachts', 'Tiara Yachts')
),
distinct_org_aliases as (
  select distinct on (public.keeprlink_normalize_address(address))
    address,
    display_name
  from org_aliases
  order by public.keeprlink_normalize_address(address), address
)
insert into public.keepr_links(address, normalized_address, object_type, object_id, is_canonical, status, metadata)
select
  a.address,
  public.keeprlink_normalize_address(a.address),
  'organization',
  o.id,
  false,
  'active',
  jsonb_build_object('display_name', a.display_name, 'alias_for', '/k/tiara-yachts', 'taxonomy_seed', 'tiara_keeprlink_taxonomy_v1')
from distinct_org_aliases a
cross join tiara_org o
on conflict (normalized_address) where status = 'active'
do update set
  object_type = excluded.object_type,
  object_id = excluded.object_id,
  is_canonical = excluded.is_canonical,
  metadata = public.keepr_links.metadata || excluded.metadata,
  updated_at = now();

with tiara_templates as (
  select
    t.id,
    t.template_key,
    t.model_year,
    t.model,
    trim(both '-' from regexp_replace(
      regexp_replace(lower(t.model), '([0-9])([a-z])', '\1-\2', 'g'),
      '[^a-z0-9]+',
      '-',
      'g'
    )) as model_slug
  from public.asset_model_templates t
  join public.orgs o on o.id = t.organization_id
  where t.status <> 'retired'
    and (o.slug = 'tiara-yachts' or lower(coalesce(o.display_name, o.name)) = 'tiara yachts')
),
model_aliases as (
  select id, '/k/tiara-' || model_year::text || '-' || model_slug as address from tiara_templates
  union
  select id, '/k/tiarayachts-' || model_year::text || '-' || model_slug as address from tiara_templates
  union
  select id, '/k/tiara-yachts-' || model_year::text || '-' || model_slug as address from tiara_templates
  union
  select id, '/k/' || template_key as address from tiara_templates
),
distinct_model_aliases as (
  select distinct on (public.keeprlink_normalize_address(address))
    id,
    address
  from model_aliases
  order by public.keeprlink_normalize_address(address), address
)
insert into public.keepr_links(address, normalized_address, object_type, object_id, is_canonical, status, metadata)
select
  a.address,
  public.keeprlink_normalize_address(a.address),
  'asset_model_template',
  a.id,
  false,
  'active',
  jsonb_build_object('alias_family', 'tiara_model_taxonomy', 'taxonomy_seed', 'tiara_keeprlink_taxonomy_v1')
from distinct_model_aliases a
on conflict (normalized_address) where status = 'active'
do update set
  object_type = excluded.object_type,
  object_id = excluded.object_id,
  is_canonical = excluded.is_canonical,
  metadata = public.keepr_links.metadata || excluded.metadata,
  updated_at = now();

with tiara_org as (
  select id
  from public.orgs
  where slug = 'tiara-yachts'
     or lower(display_name) = 'tiara yachts'
     or lower(name) = 'tiara yachts'
  order by case when slug = 'tiara-yachts' then 0 else 1 end
  limit 1
),
tiara_templates as (
  select t.id
  from public.asset_model_templates t
  join tiara_org o on o.id = t.organization_id
  where t.status <> 'retired'
),
resource_roles as (
  select
    r.id,
    case
      when r.resource_type in ('oem_catalog', 'manual', 'model_page') then 'Primary'
      else 'Supporting'
    end as role,
    case
      when r.applies_to_type = 'org' then 'organization'
      when r.resource_type = 'photo' then 'model_media'
      when r.applies_to_type = 'system_template' then 'system_template'
      when r.applies_to_type = 'asset' then 'exact_asset'
      when r.applies_to_type = 'system' then 'system_instance'
      else 'model_template'
    end as scope,
    case
      when r.rights_status in ('public_ok', 'review_permission') then 'public_safe'
      else 'internal_private'
    end as privacy,
    case
      when r.rights_status = 'public_ok' then 'public_source_ok'
      when r.rights_status = 'review_permission' then 'descriptor_review_ok'
      else 'authorized_only'
    end as review_state
  from public.asset_resources r
  where (
      (r.applies_to_type = 'org' and r.applies_to_id in (select id from tiara_org))
      or (r.applies_to_type = 'template' and r.applies_to_id in (select id from tiara_templates))
    )
    and r.authority_state in ('oem_as_built', 'oem_published', 'evidence_verified', 'keepr_curated')
)
update public.asset_resources r
set metadata = coalesce(r.metadata, '{}'::jsonb)
  || jsonb_build_object(
    'ai_context',
    coalesce(r.metadata -> 'ai_context', '{}'::jsonb) || jsonb_build_object(
      'role', rr.role,
      'scope', rr.scope,
      'privacy', rr.privacy,
      'review_state', rr.review_state,
      'status', 'included'
    )
  )
  || case
    when r.metadata ? 'provenance' then '{}'::jsonb
    else jsonb_build_object(
      'provenance',
      jsonb_build_object(
        'provider', coalesce(r.source_name, 'Tiara Yachts'),
        'authority_state', r.authority_state,
        'rights_status', r.rights_status,
        'applies_to_type', r.applies_to_type,
        'review_state', rr.review_state
      )
    )
  end,
  updated_at = now()
from resource_roles rr
where rr.id = r.id;

with tiara_templates as (
  select t.id
  from public.asset_model_templates t
  join public.orgs o on o.id = t.organization_id
  where t.status <> 'retired'
    and (o.slug = 'tiara-yachts' or lower(coalesce(o.display_name, o.name)) = 'tiara yachts')
),
coverage as (
  select
    t.id,
    count(distinct i.id) as item_count,
    count(distinct i.system_template_id) filter (where i.system_template_id is not null) as system_template_count,
    count(distinct r.id) filter (
      where lower(coalesce(r.metadata #>> '{ai_context,role}', r.metadata ->> 'ai_context_role', r.metadata ->> 'context_role', 'off'))
        in ('primary', 'supporting')
    ) as ai_resource_count
  from public.asset_model_templates t
  left join public.asset_model_template_items i on i.template_id = t.id
  left join public.asset_resources r on r.applies_to_type = 'template' and r.applies_to_id = t.id
  where t.id in (select id from tiara_templates)
  group by t.id
),
gaps as (
  select
    c.id,
    coalesce(jsonb_agg(gap) filter (where gap is not null), '[]'::jsonb) as knowledge_gaps
  from coverage c
  cross join lateral (
    values
      (case when c.item_count = 0 then 'No model system items mapped yet.' end),
      (case when c.system_template_count = 0 then 'No reusable system templates linked yet.' end),
      (case when c.ai_resource_count = 0 then 'No model-level resources marked for AI context yet.' end)
  ) as g(gap)
  group by c.id
)
update public.asset_model_templates t
set metadata = jsonb_set(coalesce(t.metadata, '{}'::jsonb), '{knowledge_gaps}', g.knowledge_gaps, true)
from gaps g
where g.id = t.id;
