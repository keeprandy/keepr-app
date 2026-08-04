create or replace function public.sync_asset_provider_stewardships(
  p_asset_id uuid,
  p_keepr_pro_ids uuid[] default array[]::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets;
  v_ids uuid[];
  v_inserted integer := 0;
  v_revoked integer := 0;
begin
  select *
  into v_asset
  from public.assets a
  where a.id = p_asset_id
    and a.deleted_at is null
    and a.owner_id = auth.uid();

  if v_asset.id is null then
    raise exception 'Asset not found or not owned by current user';
  end if;

  select coalesce(array_agg(distinct id), array[]::uuid[])
  into v_ids
  from unnest(coalesce(p_keepr_pro_ids, array[]::uuid[])) as selected(id)
  where id is not null;

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
    updated_at
  )
  select
    v_asset.id,
    kp.id,
    kp.organization_id,
    v_asset.owner_id,
    'servicing_dealer',
    'service_stewardship',
    'active',
    auth.uid(),
    now(),
    now()
  from public.keepr_pros kp
  where kp.id = any(v_ids)
    and kp.organization_id is not null
  on conflict do nothing;

  get diagnostics v_inserted = row_count;

  update public.asset_provider_stewardships aps
  set
    status = 'revoked',
    ends_at = coalesce(aps.ends_at, now()),
    updated_at = now()
  where aps.asset_id = v_asset.id
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and aps.created_by = auth.uid()
    and not (aps.keepr_pro_id = any(v_ids));

  get diagnostics v_revoked = row_count;

  return jsonb_build_object(
    'asset_id', v_asset.id,
    'selected_keepr_pro_ids', to_jsonb(v_ids),
    'inserted', v_inserted,
    'revoked', v_revoked
  );
end;
$$;

grant execute on function public.sync_asset_provider_stewardships(uuid, uuid[]) to authenticated;

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
  updated_at
)
select distinct
  a.id,
  kp.id,
  kp.organization_id,
  a.owner_id,
  'servicing_dealer',
  'service_stewardship',
  'active',
  a.owner_id,
  now(),
  now()
from public.assets a
cross join lateral jsonb_array_elements_text(
  coalesce(a.extra_metadata #> '{standard,relationships,keepr_pro_ids}', '[]'::jsonb)
) linked(keepr_pro_id)
join public.keepr_pros kp
  on kp.id = case
    when linked.keepr_pro_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then linked.keepr_pro_id::uuid
    else null
  end
where a.deleted_at is null
  and a.owner_id is not null
  and kp.organization_id is not null
on conflict do nothing;
