-- Keep internal provisioning compatible with the legacy org_members.member_role
-- constraint while preserving the newer admin authority in org_members.role.

create or replace function public.ensure_provisioned_org_member_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.metadata, '{}'::jsonb) ->> 'source' = 'create_keepr_organization' then
    if new.member_role = 'admin' then
      new.member_role := 'owner';
    end if;

    update public.profiles
    set plan = 'team',
        account_status = coalesce(nullif(account_status, ''), 'active'),
        updated_at = now()
    where id = new.user_id;

    update public.orgs
    set owner_user_id = coalesce(owner_user_id, new.user_id),
        updated_at = now()
    where id = new.org_id;
  end if;

  return new;
end;
$$;
