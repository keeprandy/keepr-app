-- Materialize exact-build drafts into canonical Keepr primitives using
-- template-defined projection metadata. This replaces the publish RPC only;
-- it does not add tables or reinterpret OEM labels as operational objects.

create or replace function public.publish_exact_build_draft(
  p_draft_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft public.exact_build_drafts%rowtype;
  v_template public.asset_model_templates%rowtype;
  v_created jsonb;
  v_asset_id uuid;
  v_kac text;
  v_item record;
  v_parent public.asset_model_template_items%rowtype;
  v_projection jsonb;
  v_parent_projection jsonb;
  v_kind text;
  v_mapping_status text;
  v_group_name text;
  v_group_id uuid;
  v_quantity integer;
  v_quantity_text text;
  v_instance_index integer;
  v_base_name text;
  v_system_name text;
  v_system_id uuid;
  v_fact_key text;
  v_fact_id uuid;
  v_materialized_systems integer := 0;
  v_materialized_groups integer := 0;
  v_materialized_facts integer := 0;
  v_unresolved integer := 0;
  v_hin_fact_id uuid;
begin
  select *
  into v_draft
  from public.exact_build_drafts
  where id = p_draft_id
  limit 1;

  if v_draft.id is null then
    raise exception 'draft not found';
  end if;

  if not public.activator_user_can_act_for_org(auth.uid(), v_draft.organization_id) then
    raise exception 'not allowed to publish this exact build draft';
  end if;

  select *
  into v_template
  from public.asset_model_templates
  where id = v_draft.template_id
  limit 1;

  v_asset_id := coalesce(
    v_draft.asset_id,
    case
      when nullif(v_draft.metadata ->> 'published_asset_id', '') ~* '^[0-9a-f-]{36}$'
      then nullif(v_draft.metadata ->> 'published_asset_id', '')::uuid
      else null
    end
  );

  if v_asset_id is null and nullif(v_draft.hin, '') is not null then
    select a.id
    into v_asset_id
    from public.assets a
    where a.deleted_at is null
      and (
        upper(nullif(a.serial_number, '')) = upper(v_draft.hin)
        or exists (
          select 1
          from public.asset_facts f
          where f.asset_id = a.id
            and f.active = true
            and lower(f.fact_key) = 'hin'
            and upper(trim(both '"' from f.fact_value::text)) = upper(v_draft.hin)
        )
      )
    limit 1;
  end if;

  if v_asset_id is not null then
    v_created := public.connect_keeprspace_boat(
      v_asset_id,
      v_draft.organization_id,
      'inventory',
      array['in_build', 'factory_frozen'],
      jsonb_build_object(
        'source', 'exact_build_draft_publish',
        'exact_build_draft_id', v_draft.id,
        'template_id', v_template.id,
        'template_key', v_template.template_key
      )
    );
  else
    v_created := public.create_keeprspace_boat(
      v_draft.organization_id,
      jsonb_strip_nulls(jsonb_build_object(
        'name', coalesce(nullif(v_draft.identity ->> 'boatName', ''), concat_ws(' · ', nullif(v_draft.draft_key, ''), v_template.manufacturer || ' ' || v_template.model)),
        'year', coalesce(v_draft.build_year, v_template.model_year),
        'make', v_template.manufacturer,
        'model', v_template.model,
        'location', nullif(v_draft.identity ->> 'location', ''),
        'dealer', nullif(v_draft.dealer_name, ''),
        'catalog_template_id', v_template.id,
        'catalog_template_key', v_template.template_key,
        'source', 'exact_build_draft',
        'exact_build_draft_id', v_draft.id,
        'exact_build_draft_key', v_draft.draft_key
      )),
      'inventory',
      array['in_build', 'factory_frozen'],
      jsonb_build_object(
        'source', 'exact_build_draft_publish',
        'exact_build_draft_id', v_draft.id,
        'template_id', v_template.id,
        'template_key', v_template.template_key
      )
    );

    v_asset_id := nullif(v_created ->> 'asset_id', '')::uuid;

    if v_asset_id is null then
      v_asset_id := nullif(v_created #>> '{asset,id}', '')::uuid;
    end if;
  end if;

  v_kac := nullif(v_created ->> 'kac_id', '');

  if v_kac is null and v_asset_id is not null then
    select nullif(kac_id, '')
    into v_kac
    from public.assets
    where id = v_asset_id
    limit 1;
  end if;

  if v_asset_id is not null and nullif(v_draft.hin, '') is not null then
    update public.assets
    set serial_number = v_draft.hin,
        extra_metadata = coalesce(extra_metadata, '{}'::jsonb) || jsonb_build_object(
          'exact_build_draft_id', v_draft.id,
          'catalog_template_id', v_template.id,
          'catalog_template_key', v_template.template_key
        )
    where id = v_asset_id;

    select id
    into v_hin_fact_id
    from public.asset_facts
    where asset_id = v_asset_id
      and active = true
      and lower(fact_key) = 'hin'
    limit 1;

    if v_hin_fact_id is null then
      insert into public.asset_facts (
        asset_id,
        subject_type,
        subject_id,
        fact_key,
        fact_value,
        authority_state,
        confidence,
        source_resource_id,
        asserted_by_user_id,
        asserted_by_org_id,
        active,
        metadata
      )
      values (
        v_asset_id,
        'asset',
        v_asset_id,
        'hin',
        to_jsonb(v_draft.hin),
        'oem_as_built',
        0.9000,
        v_draft.source_resource_id,
        auth.uid(),
        v_draft.organization_id,
        true,
        jsonb_build_object(
          'source_role', 'exact_build_identity',
          'exact_build_draft_id', v_draft.id,
          'template_key', v_template.template_key
        )
      );
    else
      update public.asset_facts
      set fact_value = to_jsonb(v_draft.hin),
          authority_state = 'oem_as_built',
          confidence = 0.9000,
          source_resource_id = coalesce(v_draft.source_resource_id, source_resource_id),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'source_role', 'exact_build_identity',
            'exact_build_draft_id', v_draft.id,
            'template_key', v_template.template_key
          ),
          updated_at = now()
      where id = v_hin_fact_id;
    end if;
  end if;

  if v_asset_id is not null then
    insert into public.asset_template_bindings (
      asset_id,
      template_id,
      template_version,
      binding_status,
      binding_source,
      confidence,
      source_resource_id,
      created_by,
      metadata
    )
    values (
      v_asset_id,
      v_template.id,
      v_template.version,
      'verified',
      'oem',
      0.9000,
      v_draft.source_resource_id,
      auth.uid(),
      jsonb_build_object(
        'source', 'exact_build_draft_publish',
        'exact_build_draft_id', v_draft.id,
        'draft_key', v_draft.draft_key
      )
    )
    on conflict do nothing;

    for v_item in
      select
        di.id as draft_item_id,
        di.item_key,
        di.state,
        di.quantity as draft_quantity,
        di.value as draft_value,
        di.provenance as draft_provenance,
        di.metadata as draft_metadata,
        ti.*
      from public.exact_build_draft_items di
      left join public.asset_model_template_items ti
        on ti.id = di.template_item_id
      where di.draft_id = v_draft.id
        and di.state in ('selected', 'overridden')
    loop
      v_projection := coalesce(v_item.draft_metadata -> 'projection', v_item.metadata -> 'projection', '{}'::jsonb);
      v_mapping_status := coalesce(v_projection ->> 'mapping_status', v_item.metadata ->> 'mapping_status', v_item.applicability ->> 'mapping_status', 'unmapped');
      v_kind := nullif(v_projection ->> 'kind', '');

      if v_kind is null then
        if v_mapping_status not in ('mapped', 'partially_mapped') then
          v_kind := 'none';
        elsif v_item.item_type in ('configuration_item', 'component', 'system') then
          v_kind := 'system';
        else
          v_kind := 'none';
        end if;
      end if;

      if v_kind = 'system' then
        v_parent := null;
        if v_item.parent_item_id is not null then
          select *
          into v_parent
          from public.asset_model_template_items
          where id = v_item.parent_item_id
          limit 1;
        end if;

        v_parent_projection := coalesce(v_parent.metadata -> 'projection', '{}'::jsonb);
        v_group_name := coalesce(
          nullif(v_projection ->> 'group', ''),
          nullif(v_parent_projection ->> 'name', ''),
          nullif(v_parent_projection ->> 'group', ''),
          nullif(v_parent.label, ''),
          nullif(v_item.draft_metadata ->> 'group', ''),
          'Other Systems'
        );

        select id
        into v_group_id
        from public.system_groups
        where asset_id = v_asset_id
          and lower(btrim(name)) = lower(btrim(v_group_name))
        limit 1;

        if v_group_id is null then
          insert into public.system_groups (
            asset_id,
            name,
            sort_order,
            metadata
          )
          values (
            v_asset_id,
            v_group_name,
            0,
            jsonb_build_object(
              'source', 'exact_build_draft_publish',
              'template_group_id', v_parent.id,
              'template_key', v_template.template_key,
              'projection_kind', 'system_group'
            )
          )
          returning id into v_group_id;
          v_materialized_groups := v_materialized_groups + 1;
        else
          update public.system_groups
          set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                'source', 'exact_build_draft_publish',
                'template_group_id', v_parent.id,
                'template_key', v_template.template_key,
                'projection_kind', 'system_group'
              ),
              updated_at = now()
          where id = v_group_id;
        end if;

        v_quantity_text := coalesce(nullif(v_projection ->> 'quantity', ''), nullif(v_item.expected_value ->> 'quantity', ''));
        v_quantity := greatest(1, coalesce(
          case when v_quantity_text ~ '^[0-9]+$' then v_quantity_text::integer else null end,
          v_item.draft_quantity::integer,
          1
        ));
        v_base_name := coalesce(nullif(v_projection ->> 'name', ''), nullif(v_item.label, ''), nullif(v_item.item_key, ''), 'System');

        for v_instance_index in 1..v_quantity loop
          v_system_name := coalesce(
            nullif(v_projection -> 'instance_labels' ->> (v_instance_index - 1), ''),
            case when v_quantity > 1 then v_base_name || ' #' || v_instance_index else v_base_name end
          );

          select id
          into v_system_id
          from public.systems
          where asset_id = v_asset_id
            and metadata ->> 'exact_build_template_item_id' = v_item.id::text
            and coalesce(metadata ->> 'exact_build_instance_index', '1') = v_instance_index::text
          limit 1;

          if v_system_id is null then
            insert into public.systems (
              asset_id,
              system_group_id,
              ksc_code,
              name,
              lod,
              status,
              system_type,
              source_type,
              metadata
            )
            values (
              v_asset_id,
              v_group_id,
              upper(regexp_replace(coalesce(v_item.canonical_key, v_system_name), '[^a-zA-Z0-9]+', '-', 'g')),
              v_system_name,
              3,
              'active',
              v_group_name,
              'exact_build_draft',
              jsonb_build_object(
                'source_role', 'exact_build_projection',
                'projection_kind', 'system',
                'exact_build_draft_id', v_draft.id,
                'exact_build_draft_item_id', v_item.draft_item_id,
                'exact_build_template_item_id', v_item.id,
                'exact_build_instance_index', v_instance_index,
                'template_id', v_template.id,
                'template_key', v_template.template_key,
                'template_group_id', v_parent.id,
                'source_resource_id', coalesce(v_item.source_resource_id, v_draft.source_resource_id),
                'oem_label', v_item.label,
                'oem_group_label', v_group_name,
                'oem_source_code', coalesce(v_item.metadata ->> 'source_oem_code', v_item.metadata ->> 'oem_item_code', v_item.expected_value ->> 'source_oem_code'),
                'configuration_value', coalesce(v_item.draft_value, '{}'::jsonb),
                'projection', v_projection
              )
            );
          else
            update public.systems
            set system_group_id = v_group_id,
                name = v_system_name,
                system_type = v_group_name,
                source_type = 'exact_build_draft',
                metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                  'source_role', 'exact_build_projection',
                  'projection_kind', 'system',
                  'exact_build_draft_id', v_draft.id,
                  'exact_build_draft_item_id', v_item.draft_item_id,
                  'exact_build_template_item_id', v_item.id,
                  'exact_build_instance_index', v_instance_index,
                  'template_id', v_template.id,
                  'template_key', v_template.template_key,
                  'template_group_id', v_parent.id,
                  'source_resource_id', coalesce(v_item.source_resource_id, v_draft.source_resource_id),
                  'oem_label', v_item.label,
                  'oem_group_label', v_group_name,
                  'oem_source_code', coalesce(v_item.metadata ->> 'source_oem_code', v_item.metadata ->> 'oem_item_code', v_item.expected_value ->> 'source_oem_code'),
                  'configuration_value', coalesce(v_item.draft_value, '{}'::jsonb),
                  'projection', v_projection
                )
            where id = v_system_id;
          end if;

          v_materialized_systems := v_materialized_systems + 1;
        end loop;
      elsif v_kind = 'asset_fact' then
        v_fact_key := coalesce(nullif(v_projection ->> 'fact_type', ''), nullif(v_item.canonical_key, ''), lower(regexp_replace(v_item.label, '[^a-zA-Z0-9]+', '_', 'g')));

        select id
        into v_fact_id
        from public.asset_facts
        where asset_id = v_asset_id
          and active = true
          and template_item_id = v_item.id
          and metadata ->> 'exact_build_draft_id' = v_draft.id::text
        limit 1;

        if v_fact_id is null then
          insert into public.asset_facts (
            asset_id,
            subject_type,
            subject_id,
            template_item_id,
            fact_key,
            fact_value,
            authority_state,
            confidence,
            source_resource_id,
            asserted_by_user_id,
            asserted_by_org_id,
            active,
            metadata
          )
          values (
            v_asset_id,
            'asset',
            v_asset_id,
            v_item.id,
            v_fact_key,
            jsonb_build_object(
              'label', v_item.label,
              'value', coalesce(v_item.draft_value, v_item.expected_value, '{}'::jsonb),
              'quantity', v_item.draft_quantity
            ),
            'oem_as_built',
            0.9000,
            coalesce(v_item.source_resource_id, v_draft.source_resource_id),
            auth.uid(),
            v_draft.organization_id,
            true,
            jsonb_build_object(
              'source_role', 'exact_build_projection',
              'projection_kind', 'asset_fact',
              'exact_build_draft_id', v_draft.id,
              'exact_build_draft_item_id', v_item.draft_item_id,
              'template_key', v_template.template_key,
              'projection', v_projection
            )
          );
        else
          update public.asset_facts
          set fact_key = v_fact_key,
              fact_value = jsonb_build_object(
                'label', v_item.label,
                'value', coalesce(v_item.draft_value, v_item.expected_value, '{}'::jsonb),
                'quantity', v_item.draft_quantity
              ),
              source_resource_id = coalesce(v_item.source_resource_id, v_draft.source_resource_id),
              metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
                'source_role', 'exact_build_projection',
                'projection_kind', 'asset_fact',
                'exact_build_draft_id', v_draft.id,
                'exact_build_draft_item_id', v_item.draft_item_id,
                'template_key', v_template.template_key,
                'projection', v_projection
              ),
              updated_at = now()
          where id = v_fact_id;
        end if;

        v_materialized_facts := v_materialized_facts + 1;
      else
        v_unresolved := v_unresolved + 1;
      end if;
    end loop;
  end if;

  update public.exact_build_drafts
  set status = 'published',
      asset_id = v_asset_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'published_by', auth.uid(),
        'published_at', now(),
        'published_asset_id', v_asset_id,
        'published_kac', v_kac,
        'materialization', jsonb_build_object(
          'system_groups', v_materialized_groups,
          'systems', v_materialized_systems,
          'asset_facts', v_materialized_facts,
          'unresolved_items', v_unresolved
        )
      ),
      published_at = now(),
      updated_at = now()
  where id = v_draft.id
  returning * into v_draft;

  return public.exact_build_draft_payload(v_draft.id) || jsonb_build_object(
    'asset_id', v_asset_id,
    'kac_id', v_kac,
    'created_asset', coalesce((v_created ->> 'created_asset')::boolean, false),
    'materialization', jsonb_build_object(
      'system_groups', v_materialized_groups,
      'systems', v_materialized_systems,
      'asset_facts', v_materialized_facts,
      'unresolved_items', v_unresolved
    )
  );
end;
$$;

grant execute on function public.publish_exact_build_draft(uuid) to authenticated;

select pg_notify('pgrst', 'reload schema');
