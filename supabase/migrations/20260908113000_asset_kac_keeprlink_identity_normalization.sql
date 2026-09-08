-- Keep asset KAC identity and KeeprLINK address registry in sync.
-- This is intentionally generic: any active asset with assets.kac_id receives
-- a canonical /k/<KAC> address without replacing the asset row as truth.

create or replace function public.ensure_asset_keepr_link(p_asset_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_address text;
  v_normalized text;
  v_link_id uuid;
begin
  select *
  into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null;

  if v_asset.id is null or nullif(btrim(coalesce(v_asset.kac_id, '')), '') is null then
    update public.keepr_links
    set
      status = 'retired',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'retired_by', 'asset_kac_identity_normalization',
        'retired_reason', 'asset_missing_kac',
        'retired_at', now()
      ),
      updated_at = now()
    where object_type = 'asset'
      and object_id = p_asset_id
      and status = 'active'
      and is_canonical = true
    returning id into v_link_id;

    return v_link_id;
  end if;

  v_address := '/k/' || btrim(v_asset.kac_id);
  v_normalized := public.keeprlink_normalize_address(v_address);

  update public.keepr_links
  set
    address = v_address,
    normalized_address = v_normalized,
    object_type = 'asset',
    is_canonical = true,
    status = 'active',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'source', 'asset.kac_id',
      'address_contract', 'asset_kac_keeprlink_identity_normalization_v1',
      'asset_kac_id', v_asset.kac_id,
      'asset_type', v_asset.type,
      'asset_name', v_asset.name,
      'serial_number_present', nullif(btrim(coalesce(v_asset.serial_number, '')), '') is not null
    )),
    updated_at = now()
  where object_type = 'asset'
    and object_id = v_asset.id
    and status = 'active'
    and is_canonical = true
  returning id into v_link_id;

  if v_link_id is not null then
    return v_link_id;
  end if;

  insert into public.keepr_links (
    address,
    normalized_address,
    object_type,
    object_id,
    is_canonical,
    status,
    metadata
  )
  values (
    v_address,
    v_normalized,
    'asset',
    v_asset.id,
    true,
    'active',
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'asset.kac_id',
      'address_contract', 'asset_kac_keeprlink_identity_normalization_v1',
      'asset_kac_id', v_asset.kac_id,
      'asset_type', v_asset.type,
      'asset_name', v_asset.name,
      'serial_number_present', nullif(btrim(coalesce(v_asset.serial_number, '')), '') is not null
    ))
  )
  on conflict (normalized_address) where status = 'active'
  do update set
    address = excluded.address,
    object_type = excluded.object_type,
    object_id = excluded.object_id,
    is_canonical = excluded.is_canonical,
    metadata = coalesce(public.keepr_links.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now()
  where public.keepr_links.object_type = 'asset'
    and public.keepr_links.object_id = excluded.object_id
  returning id into v_link_id;

  return v_link_id;
end;
$$;

create or replace function public.sync_asset_keepr_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_asset_keepr_link(new.id);
  return new;
end;
$$;

drop trigger if exists sync_asset_keepr_link_after_write on public.assets;
create trigger sync_asset_keepr_link_after_write
after insert or update of kac_id, name, type, serial_number, deleted_at
on public.assets
for each row
execute function public.sync_asset_keepr_link();

select public.ensure_asset_keepr_link(id)
from public.assets
where deleted_at is null
  and nullif(btrim(coalesce(kac_id, '')), '') is not null;

grant execute on function public.ensure_asset_keepr_link(uuid) to authenticated, service_role;
