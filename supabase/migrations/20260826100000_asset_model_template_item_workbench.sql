-- Generic OEM model configuration workbench primitives.
-- Keeps OEM vocabulary as data in asset_model_template_items; no OEM-specific schema.

alter table public.asset_model_template_items
  drop constraint if exists asset_model_template_items_type_check;

alter table public.asset_model_template_items
  add constraint asset_model_template_items_type_check
  check (
    item_type in (
      'section',
      'spec',
      'standard',
      'option_group',
      'option',
      'configuration_group',
      'configuration_item',
      'choice',
      'system',
      'component',
      'equipment',
      'knowledge',
      'playbook',
      'resource'
    )
  );

create or replace function public.upsert_asset_model_template_item(
  p_template_id uuid,
  p_item_type text,
  p_canonical_key text,
  p_label text,
  p_parent_item_id uuid default null,
  p_parent_canonical_key text default null,
  p_expected_value jsonb default '{}'::jsonb,
  p_applicability jsonb default '{}'::jsonb,
  p_authority_state text default 'oem_published',
  p_source_resource_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_sort_order integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.asset_model_templates%rowtype;
  v_parent_id uuid := p_parent_item_id;
  v_item public.asset_model_template_items%rowtype;
begin
  if p_template_id is null then
    raise exception 'template_id is required';
  end if;

  if nullif(trim(p_item_type), '') is null then
    raise exception 'item_type is required';
  end if;

  if nullif(trim(p_canonical_key), '') is null then
    raise exception 'canonical_key is required';
  end if;

  if nullif(trim(p_label), '') is null then
    raise exception 'label is required';
  end if;

  select *
  into v_template
  from public.asset_model_templates
  where id = p_template_id
  limit 1;

  if v_template.id is null then
    raise exception 'template not found';
  end if;

  if not public.activator_user_can_manage_template(auth.uid(), p_template_id) then
    raise exception 'not allowed to manage this template';
  end if;

  if v_parent_id is null and nullif(trim(p_parent_canonical_key), '') is not null then
    select id
    into v_parent_id
    from public.asset_model_template_items
    where template_id = p_template_id
      and lower(canonical_key) = lower(p_parent_canonical_key)
    limit 1;
  end if;

  insert into public.asset_model_template_items (
    template_id,
    parent_item_id,
    item_type,
    canonical_key,
    label,
    expected_value,
    applicability,
    authority_state,
    source_resource_id,
    metadata,
    sort_order
  )
  values (
    p_template_id,
    v_parent_id,
    trim(p_item_type),
    trim(p_canonical_key),
    trim(p_label),
    coalesce(p_expected_value, '{}'::jsonb),
    coalesce(p_applicability, '{}'::jsonb),
    coalesce(nullif(trim(p_authority_state), ''), 'oem_published'),
    p_source_resource_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'workbench_last_saved_at', now(),
      'workbench_saved_by', auth.uid()
    ),
    coalesce(p_sort_order, 0)
  )
  on conflict (template_id, lower(canonical_key))
  do update set
    parent_item_id = excluded.parent_item_id,
    item_type = excluded.item_type,
    label = excluded.label,
    expected_value = excluded.expected_value,
    applicability = excluded.applicability,
    authority_state = excluded.authority_state,
    source_resource_id = excluded.source_resource_id,
    metadata = public.asset_model_template_items.metadata || excluded.metadata,
    sort_order = excluded.sort_order,
    updated_at = now()
  returning * into v_item;

  return jsonb_build_object(
    'ok', true,
    'item', to_jsonb(v_item)
  );
end;
$$;

create or replace function public.retire_asset_model_template_item(
  p_template_item_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.asset_model_template_items%rowtype;
begin
  if p_template_item_id is null then
    raise exception 'template_item_id is required';
  end if;

  select *
  into v_item
  from public.asset_model_template_items
  where id = p_template_item_id
  limit 1;

  if v_item.id is null then
    raise exception 'template item not found';
  end if;

  if not public.activator_user_can_manage_template(auth.uid(), v_item.template_id) then
    raise exception 'not allowed to manage this template';
  end if;

  update public.asset_model_template_items
  set applicability = coalesce(applicability, '{}'::jsonb) || jsonb_build_object('active', false),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'retired_at', now(),
        'retired_by', auth.uid(),
        'retire_method', 'workbench'
      ),
      updated_at = now()
  where id = p_template_item_id
  returning * into v_item;

  return jsonb_build_object(
    'ok', true,
    'item', to_jsonb(v_item)
  );
end;
$$;

grant execute on function public.upsert_asset_model_template_item(
  uuid,
  text,
  text,
  text,
  uuid,
  text,
  jsonb,
  jsonb,
  text,
  uuid,
  jsonb,
  integer
) to authenticated;

grant execute on function public.retire_asset_model_template_item(uuid) to authenticated;
