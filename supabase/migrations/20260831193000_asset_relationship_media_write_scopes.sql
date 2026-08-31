-- Allow KAC-specific media placement from active operational asset relationships.
-- Brand/org network relationships remain eligibility only; write authority still
-- requires an asset_relationship on the exact KAC.

create or replace function public.activator_user_can_manage_asset(
  p_user_id uuid,
  p_asset_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and (
    exists (
      select 1
      from public.assets a
      where a.id = p_asset_id
        and a.owner_id = p_user_id
        and coalesce(a.deleted_at is null, true)
    )
    or exists (
      select 1
      from public.asset_relationships r
      where r.asset_id = p_asset_id
        and r.status = 'active'
        and r.access_scope in (
          'owner_full',
          'service_workspace',
          'service_stewardship',
          'stewardship_workspace',
          'dealer_sales_workspace',
          'dealer_delivery_workspace',
          'transfer_workspace',
          'oem_context'
        )
        and (r.effective_from is null or r.effective_from <= now())
        and (r.effective_to is null or r.effective_to > now())
        and (
          r.user_id = p_user_id
          or (
            r.organization_id is not null
            and public.activator_user_can_act_for_org(p_user_id, r.organization_id)
          )
        )
    )
  );
$$;

grant execute on function public.activator_user_can_manage_asset(uuid, uuid) to authenticated;

comment on function public.activator_user_can_manage_asset(uuid, uuid) is
  'Allows owners and active relationship-scoped OEM/dealer/service workspaces to manage shared canonical asset primitives on the exact KAC.';
