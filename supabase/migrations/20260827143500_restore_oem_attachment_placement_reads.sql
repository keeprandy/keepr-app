-- Restore OEM/Activator attachment visibility after hardening placement writes.
-- Reads should follow the same asset relationship model used by Activator asset
-- context; writes remain restricted to authorized asset/template managers.

drop policy if exists "attachment_placements_select_visible" on public.attachment_placements;

create policy "attachment_placements_select_visible"
on public.attachment_placements
for select
to authenticated
using (
  target_type <> 'model_template'
  and public.activator_user_can_read_asset(
    auth.uid(),
    public.keepr_asset_id_for_attachment_placement(target_type, target_id)
  )
);
