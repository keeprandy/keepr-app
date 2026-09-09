begin;

create or replace function public.keepr_user_can_read_model_template_media(
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
      join public.asset_model_templates template
        on template.id = ap.target_id
      join public.org_members member
        on member.org_id = template.organization_id
       and member.user_id = p_user_id
      where ap.attachment_id = p_attachment_id
        and ap.target_type = 'model_template'
        and att.deleted_at is null
        and coalesce(member.status, 'active') = 'active'
        and (
          att.kind = 'photo'
          or coalesce(att.mime_type, '') ilike 'image/%'
          or coalesce(att.file_name, att.storage_path, '') ~* '\.(jpe?g|png|webp|gif|heic|heif)$'
        )
    );
$$;

revoke execute on function public.keepr_user_can_read_model_template_media(uuid, uuid) from public;
revoke execute on function public.keepr_user_can_read_model_template_media(uuid, uuid) from anon;
grant execute on function public.keepr_user_can_read_model_template_media(uuid, uuid) to authenticated;
grant execute on function public.keepr_user_can_read_model_template_media(uuid, uuid) to service_role;

drop policy if exists "asset_files_read_model_template_media" on storage.objects;

create policy "asset_files_read_model_template_media"
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
        and public.keepr_user_can_read_model_template_media(auth.uid(), att.id)
    )
  );

notify pgrst, 'reload schema';

commit;
