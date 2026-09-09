-- Demo OEM Access Parity
-- Scope: Tiara/Bennington demo login/access only.
-- Does not touch adrake@keeprhome.com credentials.

\set ON_ERROR_STOP on

create temp table stg_demo_auth_users (
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create temp table stg_demo_profiles (
  email text,
  role text,
  plan text,
  account_status text,
  display_name text,
  full_name text
);

\copy stg_demo_auth_users from '/private/tmp/keepr_oem_parity/demo_auth_users.csv' with csv header
\copy stg_demo_profiles from '/private/tmp/keepr_oem_parity/demo_profiles.csv' with csv header

select 'staging_demo_auth_rows' as metric, count(*)::bigint as count from stg_demo_auth_users
union all select 'staging_demo_profile_rows', count(*) from stg_demo_profiles
union all select 'production_existing_tiara_auth', count(*) from auth.users where lower(email) = 'tiara@keeprhome.com'
union all select 'production_existing_bennington_auth', count(*) from auth.users where lower(email) = 'bennington@keeprhome.com'
union all select 'production_existing_andy_auth', count(*) from auth.users where lower(email) = 'adrake@keeprhome.com';

do $$
begin
  if (select count(*) from stg_demo_auth_users where lower(email) in ('tiara@keeprhome.com', 'bennington@keeprhome.com')) <> 2 then
    raise exception 'expected exactly Tiara and Bennington demo auth rows';
  end if;

  if exists (
    select 1 from stg_demo_auth_users
    where encrypted_password is null or length(encrypted_password) = 0
  ) then
    raise exception 'demo auth export is missing a password hash';
  end if;
end $$;

begin;

-- Tiara exists in production; align only demo password metadata and profile/access convention.
update auth.users prod
set
  encrypted_password = stage.encrypted_password,
  email_confirmed_at = coalesce(prod.email_confirmed_at, stage.email_confirmed_at, now()),
  raw_app_meta_data = coalesce(prod.raw_app_meta_data, '{}'::jsonb) || coalesce(stage.raw_app_meta_data, '{}'::jsonb),
  raw_user_meta_data = coalesce(prod.raw_user_meta_data, '{}'::jsonb) || coalesce(stage.raw_user_meta_data, '{}'::jsonb),
  updated_at = now()
from stg_demo_auth_users stage
where lower(prod.email) = 'tiara@keeprhome.com'
  and lower(stage.email) = 'tiara@keeprhome.com';

-- Bennington is absent in production; create the demo Auth row from the approved convention only if missing.
insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  confirmation_token,
  recovery_token,
  email_change_token_new,
  email_change,
  last_sign_in_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at,
  phone,
  phone_change,
  phone_change_token,
  email_change_token_current,
  email_change_confirm_status,
  reauthentication_token,
  is_sso_user,
  is_anonymous
)
select
  null,
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  lower(stage.email),
  stage.encrypted_password,
  coalesce(stage.email_confirmed_at, now()),
  '',
  '',
  '',
  '',
  null,
  coalesce(stage.raw_app_meta_data, '{}'::jsonb),
  coalesce(stage.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('source', 'demo_oem_access_parity_20260908'),
  false,
  coalesce(stage.created_at, now()),
  now(),
  null,
  '',
  '',
  '',
  0,
  '',
  false,
  false
from stg_demo_auth_users stage
where lower(stage.email) = 'bennington@keeprhome.com'
  and not exists (select 1 from auth.users u where lower(u.email) = 'bennington@keeprhome.com');

insert into auth.identities (
  provider_id,
  user_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at,
  id
)
select
  u.id::text,
  u.id,
  jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true, 'phone_verified', false),
  'email',
  null,
  now(),
  now(),
  gen_random_uuid()
from auth.users u
where lower(u.email) = 'bennington@keeprhome.com'
  and not exists (
    select 1 from auth.identities i
    where i.user_id = u.id and i.provider = 'email'
  );

insert into public.profiles (
  id,
  email,
  display_name,
  full_name,
  role,
  plan,
  account_status,
  created_at,
  updated_at
)
select
  u.id,
  u.email,
  p.display_name,
  p.full_name,
  coalesce(p.role, 'consumer'),
  'team',
  coalesce(p.account_status, 'active'),
  now(),
  now()
from auth.users u
join stg_demo_profiles p on lower(p.email) = lower(u.email)
where lower(u.email) in ('tiara@keeprhome.com', 'bennington@keeprhome.com')
on conflict (id) do update
set email = excluded.email,
    display_name = excluded.display_name,
    full_name = excluded.full_name,
    role = excluded.role,
    plan = 'team',
    account_status = 'active',
    updated_at = now();

update public.orgs o
set owner_user_id = p.id,
    organization_type = 'oem',
    org_type = 'manufacturer',
    workspace_type = 'keeproem',
    authority_state = 'org_managed',
    workspace_capabilities = '["manufacturer", "model_catalog", "dealer_network", "activation", "as_built_context", "asset_continuity"]'::jsonb,
    updated_at = now()
from public.profiles p
where (o.slug = 'tiara-yachts' and lower(p.email) = 'tiara@keeprhome.com')
   or (o.slug = 'bennington' and lower(p.email) = 'bennington@keeprhome.com');

insert into public.org_members (org_id, user_id, member_role, role, status, joined_at, metadata)
select o.id, p.id, 'manager', 'manager', 'active', now(),
       jsonb_build_object('source', 'demo_oem_access_parity_20260908', 'workspace_role', 'oem_operator')
from public.orgs o
join public.profiles p
  on (o.slug = 'tiara-yachts' and lower(p.email) = 'tiara@keeprhome.com')
  or (o.slug = 'bennington' and lower(p.email) = 'bennington@keeprhome.com')
on conflict (org_id, user_id) do update
set member_role = 'manager',
    role = 'manager',
    status = 'active',
    joined_at = coalesce(public.org_members.joined_at, excluded.joined_at),
    metadata = coalesce(public.org_members.metadata, '{}'::jsonb) || excluded.metadata;

notify pgrst, 'reload schema';

commit;

select 'demo_auth' as metric, email, id::text, email_confirmed_at is not null as confirmed
from auth.users
where lower(email) in ('tiara@keeprhome.com', 'bennington@keeprhome.com')
order by email;

select 'demo_profile' as metric, email, id::text, plan, account_status
from public.profiles
where lower(email) in ('tiara@keeprhome.com', 'bennington@keeprhome.com')
order by email;

select 'demo_membership' as metric, o.slug, p.email, m.member_role, m.role, m.status
from public.org_members m
join public.orgs o on o.id = m.org_id
join public.profiles p on p.id = m.user_id
where o.slug in ('tiara-yachts', 'bennington')
order by o.slug, p.email;
