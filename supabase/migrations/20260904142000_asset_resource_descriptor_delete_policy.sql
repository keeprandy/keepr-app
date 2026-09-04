-- Organization Resources can include older asset_resources descriptors that
-- predate attachment-backed resource editing. Let org actors remove those
-- descriptors from the Resources workbench without giving broad delete rights.

grant delete on public.asset_resources to authenticated;

drop policy if exists "Org members delete owned resource descriptors" on public.asset_resources;
create policy "Org members delete owned resource descriptors"
  on public.asset_resources
  for delete
  to authenticated
  using (
    (
      applies_to_type = 'org'
      and applies_to_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), applies_to_id)
    )
    or exists (
      select 1
      from public.asset_model_templates t
      where t.id = asset_resources.applies_to_id
        and asset_resources.applies_to_type = 'template'
        and public.activator_user_can_act_for_org(auth.uid(), t.organization_id)
    )
  );

