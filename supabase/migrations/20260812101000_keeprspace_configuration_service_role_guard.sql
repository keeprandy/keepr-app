-- KeeprSpace configuration guard correction.
-- Allows service-role verification and Keeps org member/admin behavior unchanged.

create or replace function public.keeprspace_user_can_seed_org(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or exists (
      select 1
      from public.profiles p
      where p.id = p_user_id
        and coalesce(p.role, '') in ('admin', 'super_admin', 'keepr_admin', 'staff')
    );
$$;

create or replace function public.keeprspace_user_is_org_member(p_user_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or exists (
      select 1
      from public.org_members m
      where m.user_id = p_user_id
        and m.org_id = p_org_id
        and coalesce(m.status, 'active') = 'active'
    );
$$;

