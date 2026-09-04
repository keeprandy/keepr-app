-- Allow OEM/Activator template managers to edit metadata on attachment-backed
-- model resources, including legacy/backfilled resources with no owner_user_id.

create unique index if not exists attachment_placements_unique_triplet
  on public.attachment_placements (attachment_id, target_type, target_id);

create or replace function public.keepr_attachment_owned_by_user(
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
      from public.attachments attachment
      where attachment.id = p_attachment_id
        and attachment.owner_user_id = p_user_id
        and attachment.deleted_at is null
    );
$$;

grant execute on function public.keepr_attachment_owned_by_user(uuid, uuid) to authenticated;

drop policy if exists "Template managers create model template attachment placements" on public.attachment_placements;
create policy "Template managers create model template attachment placements"
  on public.attachment_placements
  for insert
  to authenticated
  with check (
    target_type = 'model_template'
    and public.keepr_attachment_owned_by_user(auth.uid(), attachment_id)
    and exists (
      select 1
      from public.asset_model_templates template
      where template.id = attachment_placements.target_id
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  );

drop policy if exists "attachment_placements_insert_authorized_target" on public.attachment_placements;
create policy "attachment_placements_insert_authorized_target"
on public.attachment_placements
for insert
to authenticated
with check (
  public.keepr_attachment_owned_by_user(auth.uid(), attachment_id)
  and (
    (
      target_type = 'model_template'
      and public.activator_user_can_manage_template(auth.uid(), target_id)
    )
    or (
      target_type <> 'model_template'
      and public.activator_user_can_manage_asset(
        auth.uid(),
        public.keepr_asset_id_for_attachment_placement(target_type, target_id)
      )
    )
  )
);

drop policy if exists "Owner org creates system template attachment placements" on public.attachment_placements;
create policy "Owner org creates system template attachment placements"
on public.attachment_placements
for insert
to authenticated
with check (
  target_type = 'system_template'
  and public.keepr_attachment_owned_by_user(auth.uid(), attachment_id)
  and exists (
    select 1
    from public.system_templates st
    where st.id = attachment_placements.target_id
      and st.owner_org_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), st.owner_org_id)
  )
);

drop policy if exists "Template managers update model template attachments" on public.attachments;
create policy "Template managers update model template attachments"
  on public.attachments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.attachment_placements ap
      join public.asset_model_templates template
        on template.id = ap.target_id
      where ap.attachment_id = attachments.id
        and ap.target_type = 'model_template'
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  )
  with check (
    exists (
      select 1
      from public.attachment_placements ap
      join public.asset_model_templates template
        on template.id = ap.target_id
      where ap.attachment_id = attachments.id
        and ap.target_type = 'model_template'
        and public.activator_user_can_manage_template(auth.uid(), template.id)
    )
  );
