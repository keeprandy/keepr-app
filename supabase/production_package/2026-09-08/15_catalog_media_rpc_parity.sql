-- Catalog Media RPC Parity
-- Scope: align Product Catalog list/detail RPCs with staging so model images/heroes/resources render.
-- No data changes. No Personal org/workspace changes.

\set ON_ERROR_STOP on

begin;

create or replace function public.get_catalog_templates(p_organization_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'organization_id', t.organization_id,
      'organization_name', coalesce(o.display_name, o.name),
      'manufacturer', t.manufacturer,
      'model', t.model,
      'model_year', t.model_year,
      'template_key', t.template_key,
      'version', t.version,
      'status', t.status,
      'authority_state', t.authority_state,
      'metadata', t.metadata,
      'source_resource_id', t.source_resource_id,
      'showcase_media', coalesce(media.items, '[]'::jsonb),
      'updated_at', t.updated_at
    )
    order by t.model_year desc, t.manufacturer, t.model
  ), '[]'::jsonb)
  from public.asset_model_templates t
  join public.orgs o on o.id = t.organization_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'role', r.metadata ->> 'role',
        'title', r.title,
        'url', r.url,
        'local_asset_key', r.metadata ->> 'local_asset_key',
        'source_name', r.source_name,
        'source_platform', r.source_platform,
        'source_url', r.source_url,
        'authority_state', r.authority_state,
        'rights_status', r.rights_status,
        'metadata', r.metadata
      )
      order by coalesce((r.metadata ->> 'sort_order')::integer, 999), r.title
    ) as items
    from public.asset_resources r
    where r.applies_to_type = 'template'
      and r.applies_to_id = t.id
      and r.resource_type = 'photo'
      and r.metadata ->> 'media_scope' = 'model_template'
  ) media on true
  where (p_organization_id is null or t.organization_id = p_organization_id)
    and public.activator_user_can_read_template(auth.uid(), t.id);
$$;

create or replace function public.get_catalog_template_detail(
  p_template_id uuid default null,
  p_template_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_template public.asset_model_templates%rowtype;
begin
  select *
  into v_template
  from public.asset_model_templates t
  where (p_template_id is not null and t.id = p_template_id)
     or (p_template_id is null and p_template_key is not null and lower(t.template_key) = lower(p_template_key))
  order by t.version desc
  limit 1;

  if v_template.id is null then
    return null;
  end if;

  if not public.activator_user_can_read_template(auth.uid(), v_template.id) then
    return null;
  end if;

  return jsonb_build_object(
    'template', jsonb_build_object(
      'id', v_template.id,
      'organization_id', v_template.organization_id,
      'asset_type', v_template.asset_type,
      'category', v_template.category,
      'class', v_template.class,
      'manufacturer', v_template.manufacturer,
      'model', v_template.model,
      'model_year', v_template.model_year,
      'template_key', v_template.template_key,
      'version', v_template.version,
      'status', v_template.status,
      'authority_state', v_template.authority_state,
      'source_resource_id', v_template.source_resource_id,
      'metadata', v_template.metadata
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'template_id', i.template_id,
          'parent_item_id', i.parent_item_id,
          'item_type', i.item_type,
          'canonical_key', i.canonical_key,
          'label', i.label,
          'expected_value', i.expected_value,
          'applicability', i.applicability,
          'authority_state', i.authority_state,
          'source_resource_id', i.source_resource_id,
          'metadata', i.metadata,
          'sort_order', i.sort_order
        )
        order by i.sort_order, i.label
      )
      from public.asset_model_template_items i
      where i.template_id = v_template.id
    ), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(to_jsonb(r) order by coalesce((r.metadata ->> 'sort_order')::integer, 999), r.created_at, r.title)
      from public.asset_resources r
      where (r.applies_to_type = 'template' and r.applies_to_id = v_template.id)
         or r.id = v_template.source_resource_id
         or ((r.metadata -> 'template_keys') ? lower(v_template.template_key))
         or (
           r.applies_to_type = 'template_item'
           and exists (
             select 1
             from public.asset_model_template_items mapped_item
             where mapped_item.id = r.applies_to_id
               and mapped_item.template_id = v_template.id
           )
         )
    ), '[]'::jsonb),
    'showcase_media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'role', r.metadata ->> 'role',
          'title', r.title,
          'url', r.url,
          'local_asset_key', r.metadata ->> 'local_asset_key',
          'source_name', r.source_name,
          'source_platform', r.source_platform,
          'source_url', r.source_url,
          'authority_state', r.authority_state,
          'rights_status', r.rights_status,
          'metadata', r.metadata
        )
        order by coalesce((r.metadata ->> 'sort_order')::integer, 999), r.title
      )
      from public.asset_resources r
      where r.applies_to_type = 'template'
        and r.applies_to_id = v_template.id
        and r.resource_type = 'photo'
        and r.metadata ->> 'media_scope' = 'model_template'
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_catalog_templates(uuid) to authenticated, service_role;
grant execute on function public.get_catalog_template_detail(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;

begin;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where lower(email)='tiara@keeprhome.com'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select 'tiara_catalog_templates' as metric,
  jsonb_array_length(public.get_catalog_templates((select id from public.orgs where slug='tiara-yachts')))::text as value;
select 'tiara_catalog_list_media' as metric,
  sum(jsonb_array_length(coalesce(template->'showcase_media','[]'::jsonb)))::text as value
from jsonb_array_elements(public.get_catalog_templates((select id from public.orgs where slug='tiara-yachts'))) template;
select 'tiara_56_detail' as metric,
  jsonb_build_object(
    'items', jsonb_array_length(coalesce(public.get_catalog_template_detail(null,'tiara-2027-56-ls')->'items','[]'::jsonb)),
    'resources', jsonb_array_length(coalesce(public.get_catalog_template_detail(null,'tiara-2027-56-ls')->'resources','[]'::jsonb)),
    'showcase_media', jsonb_array_length(coalesce(public.get_catalog_template_detail(null,'tiara-2027-56-ls')->'showcase_media','[]'::jsonb))
  )::text as value;
rollback;
