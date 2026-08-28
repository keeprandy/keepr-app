-- Harden attachment tenancy before model-template media becomes a production path.
-- Owning an attachment does not imply authority to place it on another org's
-- model template or asset. Attachment org_id also cannot be client-spoofed.

drop policy if exists "attachments_own_all" on public.attachments;

create policy "attachments_own_all"
on public.attachments
for all
to authenticated
using (
  (
    owner_user_id = auth.uid()
    or exists (
      select 1
      from public.assets a
      where a.id = attachments.asset_id
        and a.owner_id = auth.uid()
    )
  )
  and (
    org_id is null
    or public.activator_user_can_act_for_org(auth.uid(), org_id)
  )
)
with check (
  (
    owner_user_id = auth.uid()
    or exists (
      select 1
      from public.assets a
      where a.id = attachments.asset_id
        and a.owner_id = auth.uid()
    )
  )
  and (
    org_id is null
    or public.activator_user_can_act_for_org(auth.uid(), org_id)
  )
);

drop policy if exists "attachment_placements_insert_own" on public.attachment_placements;
drop policy if exists "placements_if_own_attachment_all" on public.attachment_placements;
drop policy if exists "attachment_placements_insert_visible" on public.attachment_placements;
drop policy if exists "attachment_placements_update_visible" on public.attachment_placements;
drop policy if exists "attachment_placements_delete_owner_only" on public.attachment_placements;

create policy "attachment_placements_insert_authorized_target"
on public.attachment_placements
for insert
to authenticated
with check (
  exists (
    select 1
    from public.attachments a
    where a.id = attachment_placements.attachment_id
      and a.owner_user_id = auth.uid()
  )
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

create policy "attachment_placements_update_authorized_target"
on public.attachment_placements
for update
to authenticated
using (
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
with check (
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
);

create policy "attachment_placements_delete_authorized_target"
on public.attachment_placements
for delete
to authenticated
using (
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
);
