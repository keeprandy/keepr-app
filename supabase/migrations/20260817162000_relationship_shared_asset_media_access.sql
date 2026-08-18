create or replace function public.keepr_user_can_read_asset_shared_media(
  p_user_id uuid,
  p_asset_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p_user_id is not null
    and p_asset_id is not null
    and (
      exists (
        select 1
        from public.assets a
        where a.id = p_asset_id
          and a.deleted_at is null
          and a.owner_id = p_user_id
      )
      or exists (
        select 1
        from public.asset_members am
        where am.asset_id = p_asset_id
          and am.user_id = p_user_id
      )
      or exists (
        select 1
        from public.asset_relationships ar
        where ar.asset_id = p_asset_id
          and ar.status = 'active'
          and ar.access_scope <> 'none'
          and (ar.effective_from is null or ar.effective_from <= now())
          and (ar.effective_to is null or ar.effective_to > now())
          and (
            ar.user_id = p_user_id
            or (
              ar.organization_id is not null
              and public.activator_user_can_act_for_org(p_user_id, ar.organization_id)
            )
          )
      )
      or exists (
        select 1
        from public.asset_provider_stewardships aps
        where aps.asset_id = p_asset_id
          and aps.status = 'active'
          and aps.access_scope = 'service_stewardship'
          and (aps.starts_at is null or aps.starts_at <= now())
          and (aps.ends_at is null or aps.ends_at > now())
          and public.activator_user_can_act_for_org(p_user_id, aps.organization_id)
      )
    );
$$;

create or replace function public.keepr_attachment_is_asset_shared_media(
  p_attachment_id uuid,
  p_asset_id uuid
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
    from public.attachments att
    join public.attachment_placements ap
      on ap.attachment_id = att.id
     and ap.target_type = 'asset'
     and ap.target_id = p_asset_id
    join public.assets a
      on a.id = p_asset_id
     and a.deleted_at is null
    where att.id = p_attachment_id
      and att.deleted_at is null
      and (
        att.kind = 'photo'
        or coalesce(att.mime_type, '') ilike 'image/%'
        or coalesce(att.file_name, att.storage_path, '') ~* '\.(jpe?g|png|webp|gif|heic|heif)$'
      )
      and (
        ap.id = a.hero_placement_id
        or ap.is_showcase = true
        or coalesce(ap.role, '') in ('primary', 'hero', 'showcase', 'relationship_shared', 'message_shared')
      )
  );
$$;

create or replace function public.keepr_asset_placement_is_shared_media(
  p_attachment_id uuid,
  p_asset_id uuid,
  p_placement_id uuid,
  p_role text,
  p_is_showcase boolean
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
    from public.attachments att
    join public.assets a
      on a.id = p_asset_id
     and a.deleted_at is null
    where att.id = p_attachment_id
      and att.deleted_at is null
      and (
        att.kind = 'photo'
        or coalesce(att.mime_type, '') ilike 'image/%'
        or coalesce(att.file_name, att.storage_path, '') ~* '\.(jpe?g|png|webp|gif|heic|heif)$'
      )
      and (
        p_placement_id = a.hero_placement_id
        or p_is_showcase = true
        or coalesce(p_role, '') in ('primary', 'hero', 'showcase', 'relationship_shared', 'message_shared')
      )
  );
$$;

drop policy if exists "attachment_placements_select_relationship_shared_asset_media"
  on public.attachment_placements;

create policy "attachment_placements_select_relationship_shared_asset_media"
  on public.attachment_placements
  for select
  to authenticated
  using (
    target_type = 'asset'
    and public.keepr_user_can_read_asset_shared_media(auth.uid(), target_id)
    and public.keepr_asset_placement_is_shared_media(
      attachment_id,
      target_id,
      id,
      role,
      is_showcase
    )
  );

drop policy if exists "attachments_select_relationship_shared_asset_media"
  on public.attachments;

create policy "attachments_select_relationship_shared_asset_media"
  on public.attachments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.attachment_placements ap
      where ap.attachment_id = attachments.id
        and ap.target_type = 'asset'
        and public.keepr_user_can_read_asset_shared_media(auth.uid(), ap.target_id)
        and public.keepr_attachment_is_asset_shared_media(attachments.id, ap.target_id)
    )
  );

drop policy if exists "asset_files_read_relationship_shared_asset_media"
  on storage.objects;

create policy "asset_files_read_relationship_shared_asset_media"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'asset-files'
    and exists (
      select 1
      from public.attachments att
      join public.attachment_placements ap
        on ap.attachment_id = att.id
       and ap.target_type = 'asset'
      where att.bucket = storage.objects.bucket_id
        and att.storage_path = storage.objects.name
        and public.keepr_user_can_read_asset_shared_media(auth.uid(), ap.target_id)
        and public.keepr_attachment_is_asset_shared_media(att.id, ap.target_id)
    )
  );

grant execute on function public.keepr_user_can_read_asset_shared_media(uuid, uuid) to authenticated;
grant execute on function public.keepr_attachment_is_asset_shared_media(uuid, uuid) to authenticated;
grant execute on function public.keepr_asset_placement_is_shared_media(uuid, uuid, uuid, text, boolean) to authenticated;
