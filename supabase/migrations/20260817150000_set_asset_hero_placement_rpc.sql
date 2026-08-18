create or replace function public.set_asset_hero_placement(
  p_asset_id uuid,
  p_placement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_placement public.attachment_placements%rowtype;
  v_attachment public.attachments%rowtype;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null;

  if v_asset.id is null then
    raise exception 'Asset not found';
  end if;

  select *
    into v_placement
  from public.attachment_placements
  where id = p_placement_id
    and target_type = 'asset'
    and target_id = p_asset_id;

  if v_placement.id is null then
    raise exception 'Hero placement is not attached to this asset';
  end if;

  select *
    into v_attachment
  from public.attachments
  where id = v_placement.attachment_id
    and deleted_at is null;

  if v_attachment.id is null then
    raise exception 'Hero attachment not found';
  end if;

  if not (
    v_attachment.kind = 'photo'
    or coalesce(v_attachment.mime_type, '') ilike 'image/%'
    or coalesce(v_attachment.file_name, v_attachment.storage_path, '') ~* '\.(jpe?g|png|webp|gif|heic|heif)$'
  ) then
    raise exception 'Hero placement must point to an image attachment';
  end if;

  if not (
    v_asset.owner_id = v_user_id
    or v_attachment.owner_user_id = v_user_id
    or v_asset.extra_metadata -> 'provenance' ->> 'created_by_user_id' = v_user_id::text
    or exists (
      select 1
      from public.asset_relationships ar
      where ar.asset_id = p_asset_id
        and ar.status = 'active'
        and ar.initiated_by_user_id = v_user_id
    )
    or exists (
      select 1
      from public.asset_relationships ar
      join public.org_members om
        on om.org_id = ar.organization_id
       and om.user_id = v_user_id
       and coalesce(om.status, 'active') = 'active'
      where ar.asset_id = p_asset_id
        and ar.status = 'active'
    )
  ) then
    raise exception 'Not authorized to set this asset hero';
  end if;

  update public.assets
     set hero_placement_id = p_placement_id,
         hero_image_url = null,
         hero_thumb_url = null,
         hero_thumb_updated_at = now()
   where id = p_asset_id;

  update public.attachment_placements
     set role = case
          when coalesce(role, '') in ('', 'other', 'showcase') then 'primary'
          else role
        end,
         is_showcase = true
   where id = p_placement_id;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'hero_placement_id', p_placement_id,
    'attachment_id', v_attachment.id
  );
end;
$$;

grant execute on function public.set_asset_hero_placement(uuid, uuid) to authenticated;

create or replace function public.update_keeprspace_boat_asset(
  p_asset_id uuid,
  p_organization_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_user_id uuid := auth.uid();
  v_year integer;
  v_length numeric;
  v_engine_hours numeric;
  v_purchase_price numeric;
  v_estimated_value numeric;
  v_purchase_date date;
  v_relationship_metadata jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_asset
  from public.assets
  where id = p_asset_id
    and type = 'boat'
    and deleted_at is null;

  if v_asset.id is null then
    raise exception 'Boat not found';
  end if;

  if not exists (
    select 1
    from public.asset_relationships ar
    join public.org_members om
      on om.org_id = ar.organization_id
     and om.user_id = v_user_id
     and coalesce(om.status, 'active') = 'active'
    where ar.asset_id = p_asset_id
      and ar.organization_id = p_organization_id
      and ar.status = 'active'
  ) then
    raise exception 'Not authorized to edit this boat';
  end if;

  if nullif(trim(coalesce(p_patch ->> 'year', '')), '') ~ '^[0-9]{4}$' then
    v_year := nullif(trim(coalesce(p_patch ->> 'year', '')), '')::integer;
  end if;

  if nullif(trim(coalesce(p_patch ->> 'length_feet', '')), '') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_length := nullif(trim(coalesce(p_patch ->> 'length_feet', '')), '')::numeric;
  end if;

  if nullif(trim(coalesce(p_patch ->> 'engine_hours', '')), '') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_engine_hours := nullif(trim(coalesce(p_patch ->> 'engine_hours', '')), '')::numeric;
  end if;

  if nullif(trim(coalesce(p_patch ->> 'purchase_price', '')), '') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_purchase_price := nullif(trim(coalesce(p_patch ->> 'purchase_price', '')), '')::numeric;
  end if;

  if nullif(trim(coalesce(p_patch ->> 'estimated_value', '')), '') ~ '^[0-9]+(\.[0-9]+)?$' then
    v_estimated_value := nullif(trim(coalesce(p_patch ->> 'estimated_value', '')), '')::numeric;
  end if;

  if nullif(trim(coalesce(p_patch ->> 'purchase_date', '')), '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    v_purchase_date := nullif(trim(coalesce(p_patch ->> 'purchase_date', '')), '')::date;
  end if;

  update public.assets
     set name = nullif(trim(coalesce(p_patch ->> 'name', name)), ''),
         year = coalesce(v_year, year),
         make = nullif(trim(coalesce(p_patch ->> 'make', make)), ''),
         model = nullif(trim(coalesce(p_patch ->> 'model', model)), ''),
         serial_number = nullif(trim(coalesce(p_patch ->> 'hin', serial_number)), ''),
         location = nullif(trim(coalesce(p_patch ->> 'location', location)), ''),
         length_feet = coalesce(v_length, length_feet),
         engine_type = nullif(trim(coalesce(p_patch ->> 'engine_type', engine_type)), ''),
         engine_hours = coalesce(v_engine_hours, engine_hours),
         hull_material = nullif(trim(coalesce(p_patch ->> 'hull_material', hull_material)), ''),
         registration_number = nullif(trim(coalesce(p_patch ->> 'registration_number', registration_number)), ''),
         notes = nullif(trim(coalesce(p_patch ->> 'notes', notes)), ''),
         extra_metadata = coalesce(extra_metadata, '{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
                'new_used', nullif(trim(coalesce(p_patch ->> 'new_used', '')), ''),
                'asset_mode', nullif(trim(coalesce(p_patch ->> 'asset_mode', '')), ''),
                'canonical_asset_mode', coalesce(asset_mode, 'commercial'),
                'commercial_entity', nullif(trim(coalesce(p_patch ->> 'commercial_entity', '')), ''),
                'purchase_price', v_purchase_price,
                'estimated_value', v_estimated_value,
                'purchase_date', v_purchase_date,
                'length_feet', v_length,
                'hull_material', nullif(trim(coalesce(p_patch ->> 'hull_material', '')), ''),
                'registration_number', nullif(trim(coalesce(p_patch ->> 'registration_number', '')), ''),
                'notes', nullif(trim(coalesce(p_patch ->> 'notes', '')), ''),
                'engine_hours', v_engine_hours,
                'last_keeprspace_edit_at', now(),
                'last_keeprspace_edit_by_user_id', v_user_id,
                'last_keeprspace_edit_by_org_id', p_organization_id
              ))
   where id = p_asset_id
   returning * into v_asset;

  update public.asset_relationships
     set metadata = coalesce(metadata, '{}'::jsonb)
       || jsonb_strip_nulls(jsonb_build_object(
            'inventory', jsonb_strip_nulls(jsonb_build_object(
              'stock_number', nullif(trim(coalesce(p_patch ->> 'stock_number', '')), ''),
              'listing_url', nullif(trim(coalesce(p_patch ->> 'listing_url', '')), ''),
              'location', nullif(trim(coalesce(p_patch ->> 'wilson_location', p_patch ->> 'location', '')), ''),
              'external_asset_id', coalesce(
                nullif(trim(coalesce(p_patch ->> 'external_asset_id', '')), ''),
                nullif(trim(coalesce(p_patch ->> 'stock_number', '')), '')
              )
            )),
            'customer', jsonb_strip_nulls(jsonb_build_object(
              'external_system', nullif(trim(coalesce(p_patch ->> 'customer_external_system', '')), ''),
              'external_customer_id', nullif(trim(coalesce(p_patch ->> 'customer_external_id', '')), ''),
              'display_name', nullif(trim(coalesce(p_patch ->> 'customer_display_name', '')), ''),
              'email', nullif(trim(coalesce(p_patch ->> 'customer_email', '')), ''),
              'phone', nullif(trim(coalesce(p_patch ->> 'customer_phone', '')), '')
            )),
            'last_keeprspace_edit_at', now(),
            'last_keeprspace_edit_by_user_id', v_user_id
          )),
         updated_at = now()
   where asset_id = p_asset_id
     and organization_id = p_organization_id
     and status = 'active'
   returning metadata into v_relationship_metadata;

  return jsonb_build_object(
    'asset', jsonb_build_object(
      'id', v_asset.id,
      'name', v_asset.name,
      'type', v_asset.type,
      'kac_id', v_asset.kac_id,
      'year', v_asset.year,
      'make', v_asset.make,
      'model', v_asset.model,
      'hin', v_asset.serial_number,
      'location', v_asset.location,
      'length_feet', v_asset.length_feet,
      'engine_type', v_asset.engine_type,
      'engine_hours', v_asset.engine_hours,
      'hull_material', v_asset.hull_material,
      'registration_number', v_asset.registration_number,
      'notes', v_asset.notes,
      'asset_mode', v_asset.asset_mode,
      'extra_metadata', v_asset.extra_metadata,
      'hero_placement_id', v_asset.hero_placement_id,
      'hero_image_url', v_asset.hero_image_url,
      'hero_thumb_url', v_asset.hero_thumb_url
    ),
    'relationship_metadata', v_relationship_metadata
  );
end;
$$;

grant execute on function public.update_keeprspace_boat_asset(uuid, uuid, jsonb) to authenticated;

create or replace function public.remove_keeprspace_boat_asset(
  p_asset_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_asset
  from public.assets
  where id = p_asset_id
    and type = 'boat'
    and deleted_at is null;

  if v_asset.id is null then
    raise exception 'Boat not found';
  end if;

  if not exists (
    select 1
    from public.asset_relationships ar
    join public.org_members om
      on om.org_id = ar.organization_id
     and om.user_id = v_user_id
     and coalesce(om.status, 'active') = 'active'
    where ar.asset_id = p_asset_id
      and ar.organization_id = p_organization_id
      and ar.status = 'active'
  ) then
    raise exception 'Not authorized to remove this boat';
  end if;

  if not (
    v_asset.owner_id is null
    and v_asset.extra_metadata ->> 'created_by_org_id' = p_organization_id::text
  ) then
    raise exception 'Only Activator-created unowned boats can be removed here';
  end if;

  update public.asset_relationships
     set status = 'deleted',
         effective_to = now(),
         updated_at = now()
   where asset_id = p_asset_id
     and organization_id = p_organization_id
     and status = 'active';

  update public.assets
     set deleted_at = now(),
         status = 'deleted',
         extra_metadata = coalesce(extra_metadata, '{}'::jsonb)
           || jsonb_build_object(
                'removed_by_user_id', v_user_id,
                'removed_by_org_id', p_organization_id,
                'removed_at', now()
              )
   where id = p_asset_id;

  return jsonb_build_object('asset_id', p_asset_id, 'removed', true);
end;
$$;

grant execute on function public.remove_keeprspace_boat_asset(uuid, uuid) to authenticated;
