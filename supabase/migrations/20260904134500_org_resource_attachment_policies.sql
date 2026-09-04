-- Org-wide Resources / Knowledge needs to place attachments directly on an
-- organization. Keep this scoped to authenticated users who can act for that
-- organization; the attachment itself must still be owned by the caller.

drop policy if exists "Org members read org attachment placements" on public.attachment_placements;
create policy "Org members read org attachment placements"
  on public.attachment_placements
  for select
  to authenticated
  using (
    target_type = 'org'
    and public.activator_user_can_act_for_org(auth.uid(), target_id)
  );

drop policy if exists "Org members create org attachment placements" on public.attachment_placements;
create policy "Org members create org attachment placements"
  on public.attachment_placements
  for insert
  to authenticated
  with check (
    target_type = 'org'
    and public.keepr_attachment_owned_by_user(auth.uid(), attachment_id)
    and public.activator_user_can_act_for_org(auth.uid(), target_id)
  );

drop policy if exists "Org members update org attachment placements" on public.attachment_placements;
create policy "Org members update org attachment placements"
  on public.attachment_placements
  for update
  to authenticated
  using (
    target_type = 'org'
    and public.activator_user_can_act_for_org(auth.uid(), target_id)
  )
  with check (
    target_type = 'org'
    and public.activator_user_can_act_for_org(auth.uid(), target_id)
  );

drop policy if exists "Org members delete org attachment placements" on public.attachment_placements;
create policy "Org members delete org attachment placements"
  on public.attachment_placements
  for delete
  to authenticated
  using (
    target_type = 'org'
    and public.activator_user_can_act_for_org(auth.uid(), target_id)
  );
