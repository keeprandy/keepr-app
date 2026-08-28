-- Internal organization provisioning must satisfy the existing org member guard.
--
-- The legacy membership trigger expects an org owner and a team-plan owner
-- before any org_members insert. Provisioned orgs use the primary admin as
-- owner, while authorization still comes from org membership role/capability.

create or replace function public.ensure_provisioned_org_member_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.metadata, '{}'::jsonb) ->> 'source' = 'create_keepr_organization' then
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

drop trigger if exists aaa_ensure_provisioned_org_member_owner on public.org_members;
create trigger aaa_ensure_provisioned_org_member_owner
before insert or update on public.org_members
for each row
execute function public.ensure_provisioned_org_member_owner();
