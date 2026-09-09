-- Forward-fix for Personal Keepr attachment placement writes.
--
-- 20_personal_keepr_recovery_contract.sql correctly removed stale recursive
-- attachment placement policies, but production also needs the staging
-- helper-backed asset/system placement write policies.
--
-- Scope: RLS policy restoration only. No data changes.

begin;

drop policy if exists "attachment_placements_insert_authorized_target"
  on public.attachment_placements;
drop policy if exists "attachment_placements_update_authorized_target"
  on public.attachment_placements;
drop policy if exists "attachment_placements_delete_authorized_target"
  on public.attachment_placements;

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

commit;
