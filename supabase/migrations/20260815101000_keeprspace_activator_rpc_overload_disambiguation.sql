-- KeeprSpace Activator RPC overload disambiguation.
--
-- Staging hotfix after 20260815100000:
-- - The metadata-aware 5-argument RPCs must not have default arguments.
-- - Existing 4-argument callers remain supported by explicit wrappers.
-- - This is function-only; it does not insert, update, or delete asset data.
--
-- The underlying Add Boat contract still keeps the canonical asset model intact:
-- - Wilson/dealer inventory/customer/storage data lives on the org relationship.
-- - The canonical asset carries vessel identity only.
-- - Existing 4-argument callers still work through explicit compatibility wrappers.
-- - Duplicate prevention resolves by KAC, then HIN, then org-scoped external inventory id.

drop function if exists public.connect_keeprspace_service_asset(uuid, uuid, text);
drop function if exists public.create_keeprspace_boat(uuid, jsonb, text, text[]);
drop function if exists public.connect_keeprspace_boat(uuid, uuid, text, text[]);
drop function if exists public.create_keeprspace_boat(uuid, jsonb, text, text[], jsonb);
drop function if exists public.connect_keeprspace_boat(uuid, uuid, text, text[], jsonb);

create or replace function public.connect_keeprspace_boat(
  p_asset_id uuid,
  p_organization_id uuid,
  p_relationship_purpose text,
  p_operating_states text[],
  p_relationship_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets;
  v_org public.orgs;
  v_keepr_pro public.keepr_pros;
  v_stewardship public.asset_provider_stewardships;
  v_relationship public.asset_relationships;
  v_purpose text := lower(coalesce(nullif(trim(p_relationship_purpose), ''), 'service'));
  v_relationship_type text;
  v_access_scope text;
  v_create_stewardship boolean := false;
  v_states jsonb := coalesce(to_jsonb(p_operating_states), '[]'::jsonb);
  v_metadata jsonb := jsonb_strip_nulls(coalesce(p_relationship_metadata, '{}'::jsonb));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.keeprpro_user_can_act_for_org(auth.uid(), p_organization_id) then
    raise exception 'Not authorized for organization';
  end if;

  select * into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null;

  if v_asset.id is null then
    raise exception 'Asset not found';
  end if;

  select * into v_org
  from public.orgs
  where id = p_organization_id
    and coalesce(status, 'active') = 'active';

  if v_org.id is null then
    raise exception 'Organization not found';
  end if;

  select * into v_keepr_pro
  from public.keepr_pros
  where organization_id = p_organization_id
  order by case when slug = v_org.slug then 0 else 1 end, created_at
  limit 1;

  if v_purpose in ('service', 'service_provider', 'servicing_dealer') then
    v_relationship_type := 'service_provider';
    v_access_scope := 'service_workspace';
    v_create_stewardship := v_keepr_pro.id is not null;
  elsif v_purpose in ('stewardship', 'stewardship_provider') then
    v_relationship_type := 'stewardship_provider';
    v_access_scope := 'stewardship_workspace';
    v_create_stewardship := v_keepr_pro.id is not null;
  elsif v_purpose in ('storage', 'storage_provider') then
    v_relationship_type := 'storage_provider';
    v_access_scope := 'storage_workspace';
    v_create_stewardship := v_keepr_pro.id is not null;
  elsif v_purpose in ('selling', 'sales', 'selling_dealer', 'inventory', 'our_boat') then
    v_relationship_type := 'selling_dealer';
    v_access_scope := 'dealer_sales_workspace';
  elsif v_purpose in ('delivery', 'delivery_dealer') then
    v_relationship_type := 'delivery_dealer';
    v_access_scope := 'dealer_delivery_workspace';
  else
    raise exception 'Unsupported relationship purpose: %', p_relationship_purpose;
  end if;

  v_metadata := v_metadata || jsonb_build_object(
    'source', 'keeprspace_add_boat',
    'relationship_purpose', v_purpose,
    'operating_states', v_states
  );

  if v_create_stewardship then
    insert into public.asset_provider_stewardships (
      asset_id,
      keepr_pro_id,
      organization_id,
      owner_id,
      relationship_type,
      access_scope,
      status,
      created_by,
      created_at,
      updated_at,
      projection_config
    )
    values (
      v_asset.id,
      v_keepr_pro.id,
      p_organization_id,
      v_asset.owner_id,
      v_relationship_type,
      case when v_relationship_type = 'service_provider' then 'service_stewardship' else v_access_scope end,
      'active',
      auth.uid(),
      now(),
      now(),
      jsonb_build_object(
        'source', 'keeprspace_add_boat',
        'operating_states', v_states,
        'relationship_metadata', v_metadata
      )
    )
    on conflict do nothing;

    select *
    into v_stewardship
    from public.asset_provider_stewardships
    where asset_id = v_asset.id
      and keepr_pro_id = v_keepr_pro.id
      and organization_id = p_organization_id
      and relationship_type = v_relationship_type
      and status = 'active'
    order by created_at desc
    limit 1;

    if v_stewardship.id is not null then
      update public.asset_provider_stewardships
      set projection_config = coalesce(projection_config, '{}'::jsonb) || jsonb_build_object(
            'source', 'keeprspace_add_boat',
            'operating_states', v_states,
            'relationship_metadata', v_metadata
          ),
          updated_at = now()
      where id = v_stewardship.id;

      v_metadata := v_metadata || jsonb_build_object('compatibility_stewardship_id', v_stewardship.id);
    end if;
  end if;

  insert into public.asset_relationships (
    asset_id,
    organization_id,
    keepr_pro_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    initiated_by_user_id,
    initiated_by_org_id,
    metadata
  )
  values (
    v_asset.id,
    p_organization_id,
    v_keepr_pro.id,
    v_relationship_type,
    'active',
    v_access_scope,
    'claimed_org',
    auth.uid(),
    p_organization_id,
    v_metadata
  )
  on conflict do nothing;

  select *
  into v_relationship
  from public.asset_relationships
  where asset_id = v_asset.id
    and organization_id = p_organization_id
    and relationship_type = v_relationship_type
    and status = 'active'
  order by created_at desc
  limit 1;

  if v_relationship.id is not null then
    update public.asset_relationships
    set metadata = coalesce(metadata, '{}'::jsonb) || v_metadata,
        updated_at = now()
    where id = v_relationship.id
    returning * into v_relationship;
  end if;

  update public.assets
  set extra_metadata = coalesce(extra_metadata, '{}'::jsonb) || jsonb_build_object(
        'operating_states', case when jsonb_array_length(v_states) > 0 then v_states else coalesce(extra_metadata -> 'operating_states', '[]'::jsonb) end,
        'last_keeprspace_relationship_purpose', v_purpose,
        'last_keeprspace_org_id', p_organization_id
      )
  where id = v_asset.id;

  return jsonb_build_object(
    'asset_id', v_asset.id,
    'kac_id', v_asset.kac_id,
    'organization_id', p_organization_id,
    'keepr_pro_id', v_keepr_pro.id,
    'relationship_type', v_relationship_type,
    'relationship_purpose', v_purpose,
    'stewardship_id', v_stewardship.id,
    'asset_relationship_id', v_relationship.id
  );
end;
$$;

grant execute on function public.connect_keeprspace_boat(uuid, uuid, text, text[], jsonb) to authenticated;

create or replace function public.connect_keeprspace_boat(
  p_asset_id uuid,
  p_organization_id uuid,
  p_relationship_purpose text,
  p_operating_states text[]
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.connect_keeprspace_boat(
    p_asset_id,
    p_organization_id,
    p_relationship_purpose,
    p_operating_states,
    '{}'::jsonb
  );
$$;

grant execute on function public.connect_keeprspace_boat(uuid, uuid, text, text[]) to authenticated;

create or replace function public.connect_keeprspace_service_asset(
  p_asset_id uuid,
  p_organization_id uuid,
  p_relationship_type text default 'service_provider'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return public.connect_keeprspace_boat(
    p_asset_id,
    p_organization_id,
    case
      when p_relationship_type = 'servicing_dealer' then 'service'
      when p_relationship_type = 'service_provider' then 'service'
      else p_relationship_type
    end,
    array['In Service'],
    '{}'::jsonb
  );
end;
$$;

grant execute on function public.connect_keeprspace_service_asset(uuid, uuid, text) to authenticated;

create or replace function public.create_keeprspace_boat(
  p_organization_id uuid,
  p_boat jsonb,
  p_relationship_purpose text,
  p_operating_states text[],
  p_relationship_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org_id uuid := p_organization_id;
  v_asset_id uuid;
  v_existing_asset_id uuid;
  v_kac text;
  v_supplied_kac text := nullif(upper(trim(coalesce(p_boat ->> 'kac_id', p_boat ->> 'kac', ''))), '');
  v_hin text := nullif(trim(coalesce(p_boat ->> 'hin', '')), '');
  v_year_text text := nullif(trim(coalesce(p_boat ->> 'year', '')), '');
  v_year integer := null;
  v_make text := nullif(trim(coalesce(p_boat ->> 'make', '')), '');
  v_model text := nullif(trim(coalesce(p_boat ->> 'model', '')), '');
  v_name text := nullif(trim(coalesce(p_boat ->> 'name', '')), '');
  v_location text := nullif(trim(coalesce(p_boat ->> 'location', '')), '');
  v_engine text := nullif(trim(coalesce(p_boat ->> 'engine', p_boat ->> 'engine_type', '')), '');
  v_new_used text := nullif(trim(coalesce(p_boat ->> 'new_used', '')), '');
  v_operational_state text := nullif(trim(coalesce(p_boat ->> 'operational_state', '')), '');
  v_hero_image_url text := nullif(trim(coalesce(p_boat ->> 'hero_image_url', '')), '');
  v_length_feet numeric := null;
  v_engine_hours numeric := null;
  v_purchase_price numeric := null;
  v_estimated_value numeric := null;
  v_purchase_date date := null;
  v_external_asset_id text := nullif(trim(coalesce(p_relationship_metadata #>> '{inventory,external_asset_id}', p_boat ->> 'external_asset_id', '')), '');
  v_metadata jsonb := jsonb_strip_nulls(coalesce(p_relationship_metadata, '{}'::jsonb));
  v_operating_states text[] := coalesce(p_operating_states, case when v_operational_state is null then array[]::text[] else array[v_operational_state] end);
  v_result jsonb;
  v_resolved_by text := null;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if v_year_text is not null and v_year_text ~ '^[0-9]{4}$' then
    v_year := v_year_text::integer;
  end if;

  if nullif(trim(coalesce(p_boat ->> 'length_feet', '')), '') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_length_feet := nullif(trim(coalesce(p_boat ->> 'length_feet', '')), '')::numeric;
  end if;

  if nullif(trim(coalesce(p_boat ->> 'engine_hours', '')), '') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_engine_hours := nullif(trim(coalesce(p_boat ->> 'engine_hours', '')), '')::numeric;
  end if;

  if nullif(trim(coalesce(p_boat ->> 'purchase_price', '')), '') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_purchase_price := nullif(trim(coalesce(p_boat ->> 'purchase_price', '')), '')::numeric;
  end if;

  if nullif(trim(coalesce(p_boat ->> 'estimated_value', '')), '') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_estimated_value := nullif(trim(coalesce(p_boat ->> 'estimated_value', '')), '')::numeric;
  end if;

  if nullif(trim(coalesce(p_boat ->> 'purchase_date', '')), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_purchase_date := nullif(trim(coalesce(p_boat ->> 'purchase_date', '')), '')::date;
  end if;

  if v_org_id is null then
    select o.id
    into v_org_id
    from public.orgs o
    join public.org_members m
      on m.org_id = o.id
     and m.user_id = auth.uid()
     and coalesce(m.status, 'active') = 'active'
    where coalesce(o.status, 'active') = 'active'
    order by o.name
    limit 1;
  end if;

  if v_org_id is null or not public.keeprpro_user_can_act_for_org(auth.uid(), v_org_id) then
    raise exception 'Not authorized for organization';
  end if;

  if v_year is null then
    raise exception 'Year is required';
  end if;

  if v_make is null or v_model is null then
    raise exception 'Make and model are required';
  end if;

  if v_supplied_kac is not null then
    select a.id
    into v_existing_asset_id
    from public.assets a
    where a.deleted_at is null
      and upper(nullif(a.kac_id, '')) = v_supplied_kac
    limit 1;

    if v_existing_asset_id is not null then
      v_resolved_by := 'kac';
    end if;
  end if;

  if v_existing_asset_id is null and v_hin is not null then
    select a.id
    into v_existing_asset_id
    from public.assets a
    where a.deleted_at is null
      and (
        upper(nullif(a.serial_number, '')) = upper(v_hin)
        or exists (
          select 1
          from public.asset_facts f
          where f.asset_id = a.id
            and f.active = true
            and lower(f.fact_key) = 'hin'
            and upper(trim(both '"' from f.fact_value::text)) = upper(v_hin)
        )
      )
    limit 1;

    if v_existing_asset_id is not null then
      v_resolved_by := 'hin';
    end if;
  end if;

  if v_existing_asset_id is null and v_external_asset_id is not null then
    select ar.asset_id
    into v_existing_asset_id
    from public.asset_relationships ar
    join public.assets a
      on a.id = ar.asset_id
     and a.deleted_at is null
    where ar.organization_id = v_org_id
      and ar.status = 'active'
      and ar.metadata #>> '{inventory,external_asset_id}' = v_external_asset_id
    order by ar.updated_at desc nulls last, ar.created_at desc
    limit 1;

    if v_existing_asset_id is not null then
      v_resolved_by := 'external_asset_id';
    end if;
  end if;

  if v_existing_asset_id is not null then
    return public.connect_keeprspace_boat(
      v_existing_asset_id,
      v_org_id,
      p_relationship_purpose,
      v_operating_states,
      v_metadata
    ) || jsonb_build_object(
      'resolved_existing', true,
      'resolved_by', v_resolved_by
    );
  end if;

  if v_supplied_kac is not null then
    v_kac := v_supplied_kac;
  else
    loop
      v_kac := 'KAC-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
      exit when not exists (select 1 from public.assets where kac_id = v_kac);
    end loop;
  end if;

  insert into public.assets (
    owner_id,
    name,
    type,
    status,
    asset_mode,
    year,
    make,
    model,
    engine,
    location,
    hero_image_url,
    serial_number,
    kac_id,
    data_source,
    extra_metadata,
    created_at
  )
  values (
    null,
    coalesce(v_name, trim(concat_ws(' ', v_year::text, v_make, v_model))),
    'boat',
    'active',
    'keeprspace',
    v_year,
    v_make,
    v_model,
    v_engine,
    v_location,
    v_hero_image_url,
    v_hin,
    v_kac,
    'keeprspace_dealer_created',
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'keeprspace_add_boat',
      'created_by_org_id', v_org_id,
      'new_used', v_new_used,
      'operational_state', v_operational_state,
      'operating_states', coalesce(to_jsonb(v_operating_states), '[]'::jsonb),
      'length_feet', v_length_feet,
      'hull_material', nullif(trim(coalesce(p_boat ->> 'hull_material', '')), ''),
      'registration_number', nullif(trim(coalesce(p_boat ->> 'registration_number', '')), ''),
      'notes', nullif(trim(coalesce(p_boat ->> 'notes', '')), ''),
      'engine_hours', v_engine_hours,
      'asset_mode', nullif(trim(coalesce(p_boat ->> 'asset_mode', '')), ''),
      'commercial_entity', nullif(trim(coalesce(p_boat ->> 'commercial_entity', '')), ''),
      'purchase_price', v_purchase_price,
      'estimated_value', v_estimated_value,
      'purchase_date', v_purchase_date,
      'catalog_template_id', nullif(trim(coalesce(p_boat ->> 'catalog_template_id', '')), ''),
      'catalog_template_key', nullif(trim(coalesce(p_boat ->> 'catalog_template_key', '')), ''),
      'provenance', jsonb_build_object(
        'authority_state', 'source_reported',
        'source_type', 'dealer_created',
        'created_by_user_id', auth.uid(),
        'created_at', now()
      )
    )),
    now()
  )
  returning id into v_asset_id;

  if v_hin is not null then
    insert into public.asset_facts (
      asset_id,
      subject_type,
      subject_id,
      fact_key,
      fact_value,
      authority_state,
      confidence,
      asserted_by_user_id,
      asserted_by_org_id,
      asserted_at,
      active,
      metadata,
      created_at,
      updated_at
    )
    values (
      v_asset_id,
      'asset',
      v_asset_id,
      'hin',
      to_jsonb(v_hin),
      'source_reported',
      70,
      auth.uid(),
      v_org_id,
      now(),
      true,
      jsonb_build_object('source', 'keeprspace_add_boat'),
      now(),
      now()
    );
  end if;

  v_result := public.connect_keeprspace_boat(
    v_asset_id,
    v_org_id,
    p_relationship_purpose,
    v_operating_states,
    v_metadata
  );

  return v_result || jsonb_build_object(
    'created_asset', true,
    'resolved_existing', false
  );
end;
$$;

grant execute on function public.create_keeprspace_boat(uuid, jsonb, text, text[], jsonb) to authenticated;

create or replace function public.create_keeprspace_boat(
  p_organization_id uuid,
  p_boat jsonb,
  p_relationship_purpose text,
  p_operating_states text[]
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.create_keeprspace_boat(
    p_organization_id,
    p_boat,
    p_relationship_purpose,
    p_operating_states,
    '{}'::jsonb
  );
$$;

grant execute on function public.create_keeprspace_boat(uuid, jsonb, text, text[]) to authenticated;

select pg_notify('pgrst', 'reload schema');
