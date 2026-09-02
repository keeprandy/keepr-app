-- Tighten canonical KAC Hero eligibility.
-- Attachments remain the standard media object, but the canonical Hero pointer
-- must reference a placement that is intended for identity/showcase display.

create or replace function public.kac_hero_placement_is_valid(
  p_asset_id uuid,
  p_placement_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.attachment_placements ap
    join public.attachments att
      on att.id = ap.attachment_id
     and att.deleted_at is null
    where ap.id = p_placement_id
      and (
        (ap.target_type = 'asset' and ap.target_id = p_asset_id)
        or (
          ap.target_type = 'model_template'
          and ap.target_id in (select template_id from public.kac_hero_template_ids(p_asset_id))
        )
      )
      and (
        att.kind = 'photo'
        or coalesce(att.mime_type, '') ilike 'image/%'
        or coalesce(att.file_name, att.storage_path, '') ~* '\.(jpe?g|png|webp|gif|heic|heif)$'
      )
      and (
        ap.is_showcase = true
        or lower(coalesce(ap.role, '')) in ('hero', 'showcase', 'photo')
      )
  );
$$;

grant execute on function public.kac_hero_placement_is_valid(uuid, uuid) to authenticated;

create or replace function public.resolve_asset_shared_hero_media(
  p_asset_id uuid,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
set row_security = off
as $$
declare
  v_user_id uuid := auth.uid();
  v_asset public.assets%rowtype;
  v_media record;
begin
  if v_user_id is null then
    return null;
  end if;

  select *
    into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null;

  if v_asset.id is null then
    return null;
  end if;

  if p_organization_id is not null and not (
    exists (
      select 1
      from public.asset_relationships ar
      where ar.asset_id = p_asset_id
        and ar.organization_id = p_organization_id
        and ar.status = 'active'
        and ar.access_scope <> 'none'
        and (ar.effective_from is null or ar.effective_from <= now())
        and (ar.effective_to is null or ar.effective_to > now())
        and public.activator_user_can_act_for_org(v_user_id, ar.organization_id)
    )
    or exists (
      select 1
      from public.asset_provider_stewardships aps
      where aps.asset_id = p_asset_id
        and aps.organization_id = p_organization_id
        and aps.status = 'active'
        and aps.access_scope = 'service_stewardship'
        and (aps.starts_at is null or aps.starts_at <= now())
        and (aps.ends_at is null or aps.ends_at > now())
        and public.activator_user_can_act_for_org(v_user_id, aps.organization_id)
    )
  ) then
    return null;
  end if;

  if p_organization_id is null
     and not public.keepr_user_can_read_asset_shared_media(v_user_id, p_asset_id) then
    return null;
  end if;

  with candidates as (
    select
      ap.id as placement_id,
      ap.attachment_id,
      ap.role,
      ap.is_showcase,
      ap.sort_order,
      ap.created_at,
      att.bucket,
      att.storage_path,
      att.url,
      att.mime_type,
      att.kind,
      case
        when ap.id = v_asset.hero_placement_id then 300
        when ap.target_type = 'asset'
          and ap.target_id = p_asset_id
          and (lower(coalesce(ap.role, '')) = 'hero' or (lower(coalesce(ap.role, '')) = 'primary' and ap.is_showcase = true)) then 120
        when ap.target_type = 'asset'
          and ap.target_id = p_asset_id
          and (ap.is_showcase = true or lower(coalesce(ap.role, '')) in ('showcase', 'photo')) then 100
        when ap.target_type = 'model_template'
          and ap.target_id in (select template_id from public.kac_hero_template_ids(p_asset_id))
          and (lower(coalesce(ap.role, '')) = 'hero' or (lower(coalesce(ap.role, '')) = 'primary' and ap.is_showcase = true)) then 80
        when ap.target_type = 'model_template'
          and ap.target_id in (select template_id from public.kac_hero_template_ids(p_asset_id))
          and (ap.is_showcase = true or lower(coalesce(ap.role, '')) in ('showcase', 'photo')) then 60
        else 0
      end as rank
    from public.attachment_placements ap
    join public.attachments att
      on att.id = ap.attachment_id
     and att.deleted_at is null
    where (
        (ap.target_type = 'asset' and ap.target_id = p_asset_id)
        or (
          ap.target_type = 'model_template'
          and ap.target_id in (select template_id from public.kac_hero_template_ids(p_asset_id))
        )
      )
      and (
        att.kind = 'photo'
        or coalesce(att.mime_type, '') ilike 'image/%'
        or coalesce(att.file_name, att.storage_path, '') ~* '\.(jpe?g|png|webp|gif|heic|heif)$'
      )
      and (
        ap.is_showcase = true
        or lower(coalesce(ap.role, '')) in ('hero', 'showcase', 'photo')
      )
  )
  select *
    into v_media
  from candidates
  where rank > 0
  order by rank desc,
           sort_order asc nulls last,
           created_at desc
  limit 1;

  if v_media.placement_id is null then
    return null;
  end if;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'placement_id', v_media.placement_id,
    'attachment_id', v_media.attachment_id,
    'bucket', v_media.bucket,
    'storage_path', v_media.storage_path,
    'url', v_media.url,
    'role', v_media.role,
    'is_showcase', v_media.is_showcase
  );
end;
$$;

grant execute on function public.resolve_asset_shared_hero_media(uuid, uuid) to authenticated;
