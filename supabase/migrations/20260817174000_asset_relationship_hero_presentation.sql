create or replace function public.set_asset_relationship_hero_placement(
  p_asset_id uuid,
  p_organization_id uuid,
  p_placement_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_relationship public.asset_relationships%rowtype;
  v_placement public.attachment_placements%rowtype;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_asset_id is null or p_organization_id is null or p_placement_id is null then
    raise exception 'Asset, organization, and placement are required';
  end if;

  select *
    into v_relationship
  from public.asset_relationships ar
  where ar.asset_id = p_asset_id
    and ar.organization_id = p_organization_id
    and ar.status = 'active'
    and ar.access_scope <> 'none'
    and (ar.effective_from is null or ar.effective_from <= now())
    and (ar.effective_to is null or ar.effective_to > now())
    and public.activator_user_can_act_for_org(v_user_id, ar.organization_id)
  order by ar.created_at desc
  limit 1;

  if v_relationship.id is null then
    raise exception 'Active relationship context is required to set a workspace Hero';
  end if;

  select *
    into v_placement
  from public.attachment_placements ap
  where ap.id = p_placement_id
    and ap.target_type = 'asset'
    and ap.target_id = p_asset_id;

  if v_placement.id is null then
    raise exception 'Hero placement is not attached to this asset';
  end if;

  if not public.keepr_user_can_read_asset_shared_media(v_user_id, p_asset_id) then
    raise exception 'Not authorized to read this asset media';
  end if;

  if not exists (
    select 1
    from public.attachments att
    join public.assets a
      on a.id = p_asset_id
     and a.deleted_at is null
    where att.id = v_placement.attachment_id
      and att.deleted_at is null
      and (
        att.kind = 'photo'
        or coalesce(att.mime_type, '') ilike 'image/%'
        or coalesce(att.file_name, att.storage_path, '') ~* '\.(jpe?g|png|webp|gif|heic|heif)$'
      )
      and (
        v_placement.id = a.hero_placement_id
        or v_placement.is_showcase = true
        or coalesce(v_placement.role, '') in ('primary', 'hero', 'showcase', 'relationship_shared', 'message_shared')
      )
  ) then
    raise exception 'Workspace Hero must use visible asset-level shared image media';
  end if;

  update public.asset_relationships
     set metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{presentation}',
           coalesce(metadata -> 'presentation', '{}'::jsonb) ||
             jsonb_build_object('hero_placement_id', p_placement_id::text),
           true
         ),
         updated_at = now()
   where id = v_relationship.id
   returning * into v_relationship;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'asset_relationship_id', v_relationship.id,
    'organization_id', p_organization_id,
    'hero_placement_id', p_placement_id
  );
end;
$$;

grant execute on function public.set_asset_relationship_hero_placement(uuid, uuid, uuid) to authenticated;

create or replace function public.clear_asset_relationship_hero_placement(
  p_asset_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_relationship public.asset_relationships%rowtype;
  v_presentation jsonb;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  if p_asset_id is null or p_organization_id is null then
    raise exception 'Asset and organization are required';
  end if;

  select *
    into v_relationship
  from public.asset_relationships ar
  where ar.asset_id = p_asset_id
    and ar.organization_id = p_organization_id
    and ar.status = 'active'
    and ar.access_scope <> 'none'
    and (ar.effective_from is null or ar.effective_from <= now())
    and (ar.effective_to is null or ar.effective_to > now())
    and public.activator_user_can_act_for_org(v_user_id, ar.organization_id)
  order by ar.created_at desc
  limit 1;

  if v_relationship.id is null then
    raise exception 'Active relationship context is required to clear a workspace Hero';
  end if;

  v_presentation := coalesce(v_relationship.metadata -> 'presentation', '{}'::jsonb) - 'hero_placement_id';

  update public.asset_relationships
     set metadata = jsonb_set(
           coalesce(metadata, '{}'::jsonb),
           '{presentation}',
           v_presentation,
           true
         ),
         updated_at = now()
   where id = v_relationship.id
   returning * into v_relationship;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'asset_relationship_id', v_relationship.id,
    'organization_id', p_organization_id,
    'hero_placement_id', null
  );
end;
$$;

grant execute on function public.clear_asset_relationship_hero_placement(uuid, uuid) to authenticated;
