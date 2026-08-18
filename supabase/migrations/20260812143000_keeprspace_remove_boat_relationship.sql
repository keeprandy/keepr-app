begin;

create or replace function public.remove_keeprspace_boat(
  p_asset_id uuid,
  p_organization_id uuid,
  p_asset_relationship_id uuid default null,
  p_stewardship_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets;
  v_org public.orgs;
  v_relationships_ended integer := 0;
  v_stewardships_ended integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_asset_id is null then
    raise exception 'Missing asset id';
  end if;

  if p_organization_id is null then
    raise exception 'Missing organization id';
  end if;

  if not public.keeprpro_user_can_act_for_org(auth.uid(), p_organization_id) then
    raise exception 'Not authorized for organization';
  end if;

  select *
  into v_org
  from public.orgs
  where id = p_organization_id
    and coalesce(status, 'active') = 'active';

  if v_org.id is null then
    raise exception 'Organization not found';
  end if;

  select *
  into v_asset
  from public.assets
  where id = p_asset_id
    and coalesce(deleted_at is null, true);

  if v_asset.id is null then
    raise exception 'Asset not found';
  end if;

  update public.asset_relationships
  set
    status = 'ended',
    effective_to = coalesce(effective_to, now()),
    updated_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'removed_by_user_id', auth.uid(),
      'removed_by_org_id', p_organization_id,
      'removed_at', now(),
      'removed_source', 'remove_keeprspace_boat'
    )
  where asset_id = p_asset_id
    and organization_id = p_organization_id
    and status in ('active', 'pending', 'invited', 'paused')
    and (
      p_asset_relationship_id is null
      or id = p_asset_relationship_id
    );

  get diagnostics v_relationships_ended = row_count;

  update public.asset_provider_stewardships
  set
    status = 'ended',
    ends_at = coalesce(ends_at, now()),
    updated_at = now(),
    projection_config = coalesce(projection_config, '{}'::jsonb) || jsonb_build_object(
      'removed_by_user_id', auth.uid(),
      'removed_by_org_id', p_organization_id,
      'removed_at', now(),
      'removed_source', 'remove_keeprspace_boat'
    )
  where asset_id = p_asset_id
    and organization_id = p_organization_id
    and status in ('active', 'pending', 'invited', 'paused')
    and (
      p_stewardship_id is null
      or id = p_stewardship_id
    );

  get diagnostics v_stewardships_ended = row_count;

  if v_relationships_ended = 0 and v_stewardships_ended = 0 then
    raise exception 'No active KeeprSpace relationship found for this asset and organization';
  end if;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'organization_id', p_organization_id,
    'asset_relationships_ended', v_relationships_ended,
    'stewardships_ended', v_stewardships_ended,
    'asset_deleted', false
  );
end;
$$;

grant execute on function public.remove_keeprspace_boat(uuid, uuid, uuid, uuid) to authenticated;

comment on function public.remove_keeprspace_boat(uuid, uuid, uuid, uuid) is
  'Ends the current organization projection for a KeeprSpace boat without deleting the canonical asset, owner record, history, media, or messages.';

commit;
