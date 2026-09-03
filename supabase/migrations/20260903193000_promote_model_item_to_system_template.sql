-- Promote reusable model-item knowledge into the canonical System Library.
-- The model item keeps applicability; the System Template keeps reusable truth.

create or replace function public.promote_model_item_to_system_template(
  p_template_item_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.asset_model_template_items%rowtype;
  v_model_template public.asset_model_templates%rowtype;
  v_system_template public.system_templates%rowtype;
  v_name text;
  v_manufacturer text;
  v_category text;
  v_description text;
  v_owner_org_id uuid;
  v_canonical_key text;
  v_promote_resources boolean := coalesce((p_payload ->> 'promote_resources')::boolean, true);
  v_resource_count integer := 0;
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

  if coalesce(v_item.item_type, '') not in ('system', 'component', 'equipment', 'configuration_item', 'choice', 'option')
     and coalesce(v_item.metadata -> 'projection' ->> 'kind', '') <> 'system' then
    raise exception 'only system-like model items and system-producing choices can be promoted to the System Library';
  end if;

  select *
  into v_model_template
  from public.asset_model_templates
  where id = v_item.template_id
  limit 1;

  begin
    v_owner_org_id := nullif(p_payload ->> 'owner_org_id', '')::uuid;
  exception when invalid_text_representation then
    v_owner_org_id := null;
  end;

  v_owner_org_id := coalesce(v_owner_org_id, v_model_template.organization_id);

  if v_owner_org_id is not null
     and not public.activator_user_can_act_for_org(auth.uid(), v_owner_org_id) then
    raise exception 'not allowed to create reusable system truth for this organization';
  end if;

  v_name := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
  v_name := coalesce(
    v_name,
    nullif(trim(coalesce(v_item.metadata -> 'projection' ->> 'name', '')), ''),
    nullif(trim(v_item.label), ''),
    'System'
  );

  v_manufacturer := nullif(trim(coalesce(p_payload ->> 'manufacturer', '')), '');
  v_manufacturer := coalesce(
    v_manufacturer,
    nullif(trim(coalesce(v_item.metadata ->> 'manufacturer', '')), ''),
    nullif(trim(coalesce(v_item.expected_value ->> 'manufacturer', '')), ''),
    nullif(trim(coalesce(v_model_template.manufacturer, '')), '')
  );

  v_category := nullif(trim(coalesce(p_payload ->> 'system_category', '')), '');
  v_category := coalesce(
    v_category,
    nullif(trim(coalesce(v_item.metadata -> 'projection' ->> 'group', '')), ''),
    nullif(trim(coalesce(v_item.metadata ->> 'system_category', '')), ''),
    nullif(trim(coalesce(v_item.item_type, '')), '')
  );

  v_description := nullif(trim(coalesce(p_payload ->> 'description', '')), '');
  v_description := coalesce(
    v_description,
    nullif(trim(coalesce(v_item.metadata ->> 'description', '')), ''),
    nullif(trim(coalesce(v_item.metadata ->> 'oem_description', '')), ''),
    nullif(trim(coalesce(v_item.expected_value ->> 'description', '')), '')
  );

  v_canonical_key := nullif(trim(coalesce(p_payload ->> 'canonical_key', '')), '');
  v_canonical_key := coalesce(v_canonical_key, public.system_template_canonical_key(v_name, v_manufacturer));

  insert into public.system_templates (
    canonical_key,
    name,
    manufacturer,
    owner_org_id,
    system_category,
    description,
    authority_state,
    metadata
  )
  values (
    v_canonical_key,
    v_name,
    v_manufacturer,
    v_owner_org_id,
    v_category,
    v_description,
    coalesce(nullif(p_payload ->> 'authority_state', ''), 'keepr_curated'),
    jsonb_build_object(
      'source', 'promote_model_item_to_system_template',
      'promoted_from_template_item_id', v_item.id,
      'promoted_from_model_template_id', v_item.template_id,
      'promoted_from_model_template_key', v_model_template.template_key,
      'promoted_at', now(),
      'promoted_by', auth.uid(),
      'reusable_truth_only', true,
      'model_applicability_excluded', jsonb_build_array(
        'standard_state',
        'model_quantity',
        'expected_location',
        'factory_option_code',
        'model_specific_notes'
      ),
      'exact_truth_excluded', jsonb_build_array(
        'serials',
        'service_history',
        'exact_photos',
        'condition',
        'failures',
        'exact_warranty_state'
      )
    ) || coalesce(p_payload -> 'metadata', '{}'::jsonb)
  )
  on conflict (canonical_key) do update
  set name = excluded.name,
      manufacturer = coalesce(excluded.manufacturer, public.system_templates.manufacturer),
      owner_org_id = coalesce(excluded.owner_org_id, public.system_templates.owner_org_id),
      system_category = coalesce(excluded.system_category, public.system_templates.system_category),
      description = coalesce(excluded.description, public.system_templates.description),
      authority_state = coalesce(excluded.authority_state, public.system_templates.authority_state),
      metadata = coalesce(public.system_templates.metadata, '{}'::jsonb) || excluded.metadata,
      updated_at = now()
  returning * into v_system_template;

  update public.asset_model_template_items
  set system_template_id = v_system_template.id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'system_template_id', v_system_template.id,
        'system_template_key', v_system_template.canonical_key,
        'system_template_name', v_system_template.name,
        'system_template_reference_source', 'promote_model_item_to_system_template',
        'system_template_linked_at', now(),
        'system_template_linked_by', auth.uid()
      ),
      updated_at = now()
  where id = v_item.id
  returning * into v_item;

  if v_promote_resources then
    insert into public.attachment_placements (
      attachment_id,
      target_type,
      target_id,
      role,
      label,
      is_showcase,
      sort_order
    )
    select
      ap.attachment_id,
      'system_template',
      v_system_template.id,
      ap.role,
      coalesce(ap.label, 'System Template resource'),
      false,
      ap.sort_order
    from public.attachment_placements ap
    join public.attachments att on att.id = ap.attachment_id
    where ap.target_type = 'model_template'
      and ap.target_id = v_item.template_id
      and att.deleted_at is null
      and coalesce(att.kind, '') <> 'photo'
      and coalesce(att.mime_type, '') not ilike 'image/%'
      and (
        att.source_context ->> 'template_item_id' = v_item.id::text
        or att.ai_metadata ->> 'template_item_id' = v_item.id::text
        or att.source_context ->> 'linked_template_item_id' = v_item.id::text
        or att.ai_metadata ->> 'linked_template_item_id' = v_item.id::text
        or coalesce(att.source_context -> 'linked_template_item_ids', '[]'::jsonb) ? v_item.id::text
        or coalesce(att.ai_metadata -> 'linked_template_item_ids', '[]'::jsonb) ? v_item.id::text
        or coalesce(att.source_context -> 'template_item_ids', '[]'::jsonb) ? v_item.id::text
        or coalesce(att.ai_metadata -> 'template_item_ids', '[]'::jsonb) ? v_item.id::text
      )
      and not exists (
        select 1
        from public.attachment_placements existing
        where existing.attachment_id = ap.attachment_id
          and existing.target_type = 'system_template'
          and existing.target_id = v_system_template.id
      );

    get diagnostics v_resource_count = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'template_item', to_jsonb(v_item),
    'system_template', to_jsonb(v_system_template),
    'promoted_resource_count', v_resource_count,
    'model_applicability_left_on_item', true,
    'exact_truth_left_on_system_instances', true
  );
end;
$$;

grant execute on function public.promote_model_item_to_system_template(uuid, jsonb) to authenticated;

comment on function public.promote_model_item_to_system_template(uuid, jsonb) is
  'Promotes a system-like Asset Template Item into canonical reusable System Template truth, links the model item back, and references reusable non-photo resources without moving exact evidence.';

select pg_notify('pgrst', 'reload schema');
