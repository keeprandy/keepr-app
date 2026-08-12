create or replace function public.update_keeprspace_org_profile(
  p_organization_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.keeprpro_user_can_act_for_org(auth.uid(), p_organization_id) then
    raise exception 'Not authorized for organization';
  end if;

  update public.orgs
  set
    display_name = coalesce(nullif(p_patch ->> 'display_name', ''), display_name),
    name = coalesce(nullif(p_patch ->> 'display_name', ''), name),
    slug = coalesce(nullif(regexp_replace(lower(trim(p_patch ->> 'slug')), '[^a-z0-9_-]+', '-', 'g'), ''), slug),
    photo_url = coalesce(nullif(p_patch ->> 'photo_url', ''), nullif(p_patch ->> 'logo_url', ''), photo_url),
    team_photo_url = coalesce(nullif(p_patch ->> 'team_photo_url', ''), nullif(p_patch ->> 'header_image_url', ''), team_photo_url),
    updated_at = now()
  where id = p_organization_id;

  return (
    select jsonb_build_object(
      'organization_id', o.id,
      'display_name', coalesce(nullif(o.display_name, ''), o.name),
      'slug', o.slug,
      'photo_url', o.photo_url,
      'team_photo_url', o.team_photo_url,
      'workspace_type', o.workspace_type
    )
    from public.orgs o
    where o.id = p_organization_id
  );
end;
$$;

grant execute on function public.update_keeprspace_org_profile(uuid, jsonb) to authenticated;
