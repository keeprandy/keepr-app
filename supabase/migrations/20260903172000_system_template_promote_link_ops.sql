-- Small product operation layer for canonical System Templates.
-- Promotion and linking are explicit; inheritance remains reference-based.

create or replace function public.system_template_canonical_key(
  p_name text,
  p_manufacturer text default null
) returns text
language sql
immutable
as $$
  select 'system_template.' ||
    trim(both '_' from regexp_replace(
      lower(coalesce(nullif(p_manufacturer, ''), 'generic')),
      '[^a-z0-9]+',
      '_',
      'g'
    )) ||
    '.' ||
    trim(both '_' from regexp_replace(
      lower(coalesce(nullif(p_name, ''), 'system')),
      '[^a-z0-9]+',
      '_',
      'g'
    ));
$$;

create or replace function public.list_system_templates(
  p_query text default null,
  p_limit integer default 25
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 50);
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', st.id,
        'canonical_key', st.canonical_key,
        'name', st.name,
        'manufacturer', st.manufacturer,
        'owner_org_id', st.owner_org_id,
        'supplier_org_id', st.supplier_org_id,
        'system_category', st.system_category,
        'description', st.description,
        'authority_state', st.authority_state,
        'metadata', coalesce(st.metadata, '{}'::jsonb),
        'resource_count', (
          select count(*)
          from public.attachment_placements ap
          join public.attachments att on att.id = ap.attachment_id
          where ap.target_type = 'system_template'
            and ap.target_id = st.id
            and att.deleted_at is null
        )
      )
      order by
        case
          when v_query is not null and lower(st.name) = lower(v_query) then 0
          when v_query is not null and lower(st.name) like lower(v_query) || '%' then 1
          else 2
        end,
        st.name
    )
    from (
      select *
      from public.system_templates st
      where st.authority_state <> 'retired'
        and (
          v_query is null
          or st.name ilike '%' || v_query || '%'
          or st.manufacturer ilike '%' || v_query || '%'
          or st.canonical_key ilike '%' || v_query || '%'
        )
      order by st.name
      limit v_limit
    ) st
  ), '[]'::jsonb);
end;
$$;

create or replace function public.link_model_item_system_template(
  p_template_item_id uuid,
  p_system_template_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item public.asset_model_template_items%rowtype;
  v_system_template public.system_templates%rowtype;
begin
  if p_template_item_id is null then
    raise exception 'template_item_id is required';
  end if;

  if p_system_template_id is null then
    raise exception 'system_template_id is required';
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

  select *
  into v_system_template
  from public.system_templates
  where id = p_system_template_id
    and authority_state <> 'retired'
  limit 1;

  if v_system_template.id is null then
    raise exception 'system template not found';
  end if;

  if coalesce(v_item.item_type, '') <> 'system'
     and coalesce(v_item.metadata -> 'projection' ->> 'kind', '') <> 'system' then
    raise exception 'only system-like model items can link to a system template';
  end if;

  update public.asset_model_template_items
  set system_template_id = v_system_template.id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'system_template_id', v_system_template.id,
        'system_template_key', v_system_template.canonical_key,
        'system_template_name', v_system_template.name,
        'system_template_reference_source', 'manual_link_system_template',
        'system_template_linked_at', now(),
        'system_template_linked_by', auth.uid()
      ),
      updated_at = now()
  where id = v_item.id
  returning * into v_item;

  return jsonb_build_object(
    'ok', true,
    'item', to_jsonb(v_item),
    'system_template', to_jsonb(v_system_template)
  );
end;
$$;

create or replace function public.unlink_model_item_system_template(
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
  set system_template_id = null,
      metadata = (coalesce(metadata, '{}'::jsonb)
        - 'system_template_id'
        - 'system_template_key'
        - 'system_template_name')
        || jsonb_build_object(
          'system_template_unlinked_at', now(),
          'system_template_unlinked_by', auth.uid()
        ),
      updated_at = now()
  where id = v_item.id
  returning * into v_item;

  return jsonb_build_object('ok', true, 'item', to_jsonb(v_item));
end;
$$;

create or replace function public.promote_system_to_system_template(
  p_system_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system public.systems%rowtype;
  v_template public.system_templates%rowtype;
  v_name text;
  v_manufacturer text;
  v_category text;
  v_description text;
  v_owner_org_id uuid;
  v_canonical_key text;
  v_promote_resources boolean := coalesce((p_payload ->> 'promote_resources')::boolean, false);
  v_link_system boolean := coalesce((p_payload ->> 'link_system')::boolean, true);
  v_resource_count integer := 0;
begin
  if p_system_id is null then
    raise exception 'system_id is required';
  end if;

  select *
  into v_system
  from public.systems
  where id = p_system_id
  limit 1;

  if v_system.id is null then
    raise exception 'system not found';
  end if;

  if not public.activator_user_can_manage_asset(auth.uid(), v_system.asset_id) then
    raise exception 'not allowed to manage this asset system';
  end if;

  begin
    v_owner_org_id := nullif(p_payload ->> 'owner_org_id', '')::uuid;
  exception when invalid_text_representation then
    v_owner_org_id := null;
  end;

  if v_owner_org_id is not null
     and not public.activator_user_can_act_for_org(auth.uid(), v_owner_org_id) then
    raise exception 'not allowed to create reusable system truth for this organization';
  end if;

  v_name := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
  v_name := coalesce(v_name, nullif(trim(v_system.name), ''), 'System');

  v_manufacturer := nullif(trim(coalesce(p_payload ->> 'manufacturer', '')), '');
  v_manufacturer := coalesce(
    v_manufacturer,
    nullif(trim(coalesce(v_system.metadata -> 'standard' -> 'identity' ->> 'manufacturer', '')), ''),
    nullif(trim(coalesce(v_system.metadata -> 'identity' ->> 'manufacturer', '')), '')
  );

  v_category := nullif(trim(coalesce(p_payload ->> 'system_category', '')), '');
  v_category := coalesce(v_category, nullif(trim(v_system.system_type), ''));

  v_description := nullif(trim(coalesce(p_payload ->> 'description', '')), '');
  v_description := coalesce(
    v_description,
    nullif(trim(coalesce(v_system.metadata -> 'standard' -> 'story' ->> 'description', '')), ''),
    nullif(trim(coalesce(v_system.metadata ->> 'description', '')), '')
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
    coalesce(nullif(p_payload ->> 'authority_state', ''), 'oem_verified'),
    jsonb_build_object(
      'source', 'promote_system_to_system_template',
      'promoted_from_system_id', v_system.id,
      'promoted_from_asset_id', v_system.asset_id,
      'promoted_at', now(),
      'promoted_by', auth.uid(),
      'reusable_truth_only', true,
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
  returning * into v_template;

  if v_link_system then
    update public.systems
    set system_template_id = v_template.id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'system_template_id', v_template.id,
          'system_template_key', v_template.canonical_key,
          'system_template_name', v_template.name,
          'system_template_reference_source', 'promote_system_to_system_template',
          'system_template_linked_at', now(),
          'system_template_linked_by', auth.uid()
        ),
        updated_at = now()
    where id = v_system.id
    returning * into v_system;
  end if;

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
      v_template.id,
      ap.role,
      coalesce(ap.label, 'System Template resource'),
      false,
      ap.sort_order
    from public.attachment_placements ap
    join public.attachments att on att.id = ap.attachment_id
    where ap.target_type = 'system'
      and ap.target_id = v_system.id
      and att.deleted_at is null
      and coalesce(att.kind, '') <> 'photo'
      and coalesce(att.mime_type, '') not ilike 'image/%'
      and not exists (
        select 1
        from public.attachment_placements existing
        where existing.attachment_id = ap.attachment_id
          and existing.target_type = 'system_template'
          and existing.target_id = v_template.id
      );

    get diagnostics v_resource_count = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'system', to_jsonb(v_system),
    'system_template', to_jsonb(v_template),
    'promoted_resource_count', v_resource_count,
    'exact_truth_left_on_system', true
  );
end;
$$;

grant execute on function public.system_template_canonical_key(text, text) to authenticated;
grant execute on function public.list_system_templates(text, integer) to authenticated;
grant execute on function public.link_model_item_system_template(uuid, uuid) to authenticated;
grant execute on function public.unlink_model_item_system_template(uuid) to authenticated;
grant execute on function public.promote_system_to_system_template(uuid, jsonb) to authenticated;

comment on function public.promote_system_to_system_template(uuid, jsonb) is
  'Explicitly promotes reusable exact-system knowledge into a canonical System Template and optionally links the exact system. Exact-only state remains on the system instance.';

comment on function public.link_model_item_system_template(uuid, uuid) is
  'Explicitly links a system-like Asset Template Item to canonical reusable System Template truth while leaving model-specific applicability on the item.';

select pg_notify('pgrst', 'reload schema');
