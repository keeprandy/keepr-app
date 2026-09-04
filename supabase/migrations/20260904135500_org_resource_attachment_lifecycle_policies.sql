-- Org resource lifecycle: org admins/managers must be able to update resource
-- metadata later even if the original uploader is not the person maintaining it.

drop policy if exists "Org members update org resource attachments" on public.attachments;
create policy "Org members update org resource attachments"
  on public.attachments
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.attachment_placements ap
      where ap.attachment_id = attachments.id
        and ap.target_type = 'org'
        and public.activator_user_can_act_for_org(auth.uid(), ap.target_id)
    )
  )
  with check (
    exists (
      select 1
      from public.attachment_placements ap
      where ap.attachment_id = attachments.id
        and ap.target_type = 'org'
        and public.activator_user_can_act_for_org(auth.uid(), ap.target_id)
    )
  );
