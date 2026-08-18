create or replace function public.keepr_attachment_has_visible_shared_asset_placement(
  p_user_id uuid,
  p_attachment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p_user_id is not null
    and p_attachment_id is not null
    and exists (
      select 1
      from public.attachment_placements ap
      join public.attachments att
        on att.id = ap.attachment_id
      join public.assets a
        on a.id = ap.target_id
       and a.deleted_at is null
      where ap.attachment_id = p_attachment_id
        and ap.target_type = 'asset'
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
        and public.keepr_user_can_read_asset_shared_media(p_user_id, ap.target_id)
    );
$$;

drop policy if exists "attachments_select_relationship_shared_asset_media"
  on public.attachments;

create policy "attachments_select_relationship_shared_asset_media"
  on public.attachments
  for select
  to authenticated
  using (
    public.keepr_attachment_has_visible_shared_asset_placement(auth.uid(), attachments.id)
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
      where att.bucket = storage.objects.bucket_id
        and att.storage_path = storage.objects.name
        and public.keepr_attachment_has_visible_shared_asset_placement(auth.uid(), att.id)
    )
  );

grant execute on function public.keepr_attachment_has_visible_shared_asset_placement(uuid, uuid)
  to authenticated;
