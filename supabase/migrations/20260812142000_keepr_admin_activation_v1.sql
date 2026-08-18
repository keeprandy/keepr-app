-- Keepr Admin V1: internal org activation boundary.
--
-- Local package only until explicitly applied.
-- This creates no canonical org/KPC identities and does not seed any users.

create table if not exists public.keepr_internal_admins (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  authority text not null default 'keepr_admin',
  status text not null default 'active',
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  revoked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint keepr_internal_admins_status_check
    check (status in ('active', 'inactive', 'revoked')),
  constraint keepr_internal_admins_authority_check
    check (authority in ('keepr_admin', 'activation_admin', 'support_admin'))
);

create table if not exists public.org_activations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete cascade,
  workspace_type text not null,
  status text not null default 'draft',
  capabilities jsonb not null default '[]'::jsonb,
  activation_metadata jsonb not null default '{}'::jsonb,
  activated_at timestamptz,
  activated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_activations_organization_unique unique (organization_id),
  constraint org_activations_status_check
    check (status in ('draft', 'ready', 'active', 'blocked', 'paused', 'archived')),
  constraint org_activations_workspace_type_check
    check (workspace_type in ('keeprpro', 'keeprdealer', 'keeproem', 'org')),
  constraint org_activations_capabilities_array_check
    check (jsonb_typeof(capabilities) = 'array')
);

alter table public.org_members
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists status text not null default 'active',
  add column if not exists role text;

create unique index if not exists org_members_org_user_unique_idx
  on public.org_members (org_id, user_id);

create index if not exists org_activations_status_idx
  on public.org_activations (status);

create index if not exists org_activations_workspace_type_idx
  on public.org_activations (workspace_type);

create index if not exists org_members_activation_operator_idx
  on public.org_members (org_id, user_id)
  where metadata ->> 'activation_purpose' = 'activation_operator';

create or replace function public.keepr_admin_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists keepr_internal_admins_touch_updated_at on public.keepr_internal_admins;
create trigger keepr_internal_admins_touch_updated_at
before update on public.keepr_internal_admins
for each row execute function public.keepr_admin_touch_updated_at();

drop trigger if exists org_activations_touch_updated_at on public.org_activations;
create trigger org_activations_touch_updated_at
before update on public.org_activations
for each row execute function public.keepr_admin_touch_updated_at();

alter table public.keepr_internal_admins enable row level security;
alter table public.org_activations enable row level security;

drop policy if exists keepr_internal_admins_internal_read on public.keepr_internal_admins;
create policy keepr_internal_admins_internal_read
on public.keepr_internal_admins
for select
using (
  auth.role() = 'service_role'
  or exists (
    select 1
    from public.keepr_internal_admins kia
    where kia.user_id = auth.uid()
      and kia.status = 'active'
      and kia.revoked_at is null
  )
);

drop policy if exists org_activations_internal_read on public.org_activations;
create policy org_activations_internal_read
on public.org_activations
for select
using (
  auth.role() = 'service_role'
  or exists (
    select 1
    from public.keepr_internal_admins kia
    where kia.user_id = auth.uid()
      and kia.status = 'active'
      and kia.revoked_at is null
  )
);

create or replace function public.is_keepr_internal_admin(p_user_id uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or exists (
      select 1
      from public.keepr_internal_admins kia
      where kia.user_id = p_user_id
        and kia.status = 'active'
        and kia.revoked_at is null
    );
$$;

create or replace function public.keepr_admin_workspace_preview_json(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org public.orgs%rowtype;
  v_keepr_pro public.keepr_pros%rowtype;
  v_workspace_type text;
  v_capabilities jsonb;
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  select *
  into v_org
  from public.orgs
  where id = p_organization_id;

  if v_org.id is null then
    raise exception 'organization not found';
  end if;

  select *
  into v_keepr_pro
  from public.keepr_pros
  where organization_id = p_organization_id
  order by created_at asc nulls last
  limit 1;

  v_workspace_type := public.keepr_workspace_type_for_org(
    v_org.workspace_type,
    v_org.organization_type,
    v_org.org_type
  );

  v_capabilities := public.keepr_effective_workspace_capabilities(
    v_workspace_type,
    coalesce(v_org.workspace_capabilities, '[]'::jsonb)
  );

  return jsonb_build_object(
    'workspace_id', 'org:' || v_org.id::text,
    'workspace_type', v_workspace_type,
    'organization_id', v_org.id,
    'organization_slug', v_org.slug,
    'display_name', coalesce(nullif(v_org.display_name, ''), nullif(v_org.name, ''), nullif(v_keepr_pro.display_name, ''), v_keepr_pro.name, 'Organization'),
    'description', case v_workspace_type
      when 'keeproem' then 'Manufacturer workspace'
      when 'keeprdealer' then 'Dealer workspace'
      when 'keeprpro' then 'Service provider workspace'
      else 'Organization workspace'
    end,
    'capabilities', v_capabilities,
    'authority', jsonb_build_object(
      'subject_type', 'organization',
      'organization_id', v_org.id,
      'source', 'keepr_admin_preview'
    ),
    'display', jsonb_build_object(
      'title', coalesce(nullif(v_org.display_name, ''), nullif(v_org.name, ''), nullif(v_keepr_pro.display_name, ''), v_keepr_pro.name, 'Organization'),
      'subtitle', case v_workspace_type
        when 'keeproem' then 'KeeprOEM workspace'
        when 'keeprdealer' then 'KeeprDealer workspace'
        when 'keeprpro' then 'KeeprPro workspace'
        else 'Organization workspace'
      end,
      'icon', case v_workspace_type
        when 'keeproem' then 'business-outline'
        when 'keeprdealer' then 'storefront-outline'
        when 'keeprpro' then 'briefcase-outline'
        else 'people-outline'
      end,
      'logo_url', v_keepr_pro.logo_url,
      'avatar_url', v_keepr_pro.avatar_url,
      'header_image_url', v_keepr_pro.header_image_url
    ),
    'metadata', jsonb_build_object(
      'source', 'keepr_admin_preview',
      'keepr_pro_id', v_keepr_pro.id,
      'keepr_pro_slug', v_keepr_pro.slug,
      'profile_status', v_keepr_pro.profile_status,
      'claimed_state', v_keepr_pro.claimed_state
    )
  );
end;
$$;

create or replace function public.preview_keeprspace_workspace(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.keepr_admin_workspace_preview_json(p_organization_id);
$$;

create or replace function public.search_keepr_admin_orgs(p_query text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  return jsonb_build_object(
    'query', coalesce(p_query, ''),
    'organizations', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'display_name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.display_name, kp.name),
          'slug', o.slug,
          'org_type', o.org_type,
          'organization_type', o.organization_type,
          'status', coalesce(o.status, 'active'),
          'workspace_type', public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type),
          'workspace_capabilities', public.keepr_effective_workspace_capabilities(
            public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type),
            coalesce(o.workspace_capabilities, '[]'::jsonb)
          ),
          'activation', case when oa.id is null then null else jsonb_build_object(
            'id', oa.id,
            'status', oa.status,
            'workspace_type', oa.workspace_type,
            'activated_at', oa.activated_at
          ) end,
          'keepr_pro', case when kp.id is null then null else jsonb_build_object(
            'id', kp.id,
            'slug', kp.slug,
            'display_name', kp.display_name,
            'claimed_state', kp.claimed_state,
            'profile_status', kp.profile_status
          ) end
        )
        order by coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.display_name, kp.name)
      )
      from public.orgs o
      left join public.keepr_pros kp
        on kp.organization_id = o.id
      left join public.org_activations oa
        on oa.organization_id = o.id
      where coalesce(o.status, 'active') = 'active'
        and (
          v_query = ''
          or lower(coalesce(o.display_name, '')) like '%' || v_query || '%'
          or lower(coalesce(o.name, '')) like '%' || v_query || '%'
          or lower(coalesce(o.slug, '')) like '%' || v_query || '%'
          or lower(coalesce(kp.display_name, '')) like '%' || v_query || '%'
          or lower(coalesce(kp.slug, '')) like '%' || v_query || '%'
          or lower(coalesce(kp.email, '')) like '%' || v_query || '%'
          or lower(coalesce(kp.website, '')) like '%' || v_query || '%'
        )
      limit 50
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_keepr_admin_org_activation(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org public.orgs%rowtype;
  v_keepr_pro public.keepr_pros%rowtype;
  v_activation public.org_activations%rowtype;
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  select *
  into v_org
  from public.orgs
  where id = p_organization_id;

  if v_org.id is null then
    raise exception 'organization not found';
  end if;

  select *
  into v_keepr_pro
  from public.keepr_pros
  where organization_id = p_organization_id
  order by created_at asc nulls last
  limit 1;

  select *
  into v_activation
  from public.org_activations
  where organization_id = p_organization_id;

  return jsonb_build_object(
    'organization', to_jsonb(v_org),
    'keepr_pro', case when v_keepr_pro.id is null then null else to_jsonb(v_keepr_pro) end,
    'activation', case when v_activation.id is null then null else to_jsonb(v_activation) end,
    'workspace_preview', public.keepr_admin_workspace_preview_json(p_organization_id),
    'operators', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'member_role', coalesce(m.role, m.member_role, 'member'),
        'status', coalesce(m.status, 'active'),
        'activation_purpose', m.metadata ->> 'activation_purpose',
        'metadata', coalesce(m.metadata, '{}'::jsonb),
        'profile', jsonb_build_object(
          'id', p.id,
          'email', p.email,
          'full_name', coalesce(p.full_name, p.display_name, p.email)
        )
      ) order by coalesce(p.full_name, p.display_name, p.email))
      from public.org_members m
      left join public.profiles p on p.id = m.user_id
      where m.org_id = p_organization_id
        and coalesce(m.status, 'active') = 'active'
        and m.metadata ->> 'activation_purpose' = 'activation_operator'
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', m.user_id,
        'member_role', coalesce(m.role, m.member_role, 'member'),
        'status', coalesce(m.status, 'active'),
        'metadata', coalesce(m.metadata, '{}'::jsonb),
        'profile', jsonb_build_object(
          'id', p.id,
          'email', p.email,
          'full_name', coalesce(p.full_name, p.display_name, p.email)
        )
      ) order by coalesce(p.full_name, p.display_name, p.email))
      from public.org_members m
      left join public.profiles p on p.id = m.user_id
      where m.org_id = p_organization_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.search_keepr_admin_operator_users(p_query text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  return jsonb_build_object(
    'query', coalesce(p_query, ''),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'email', p.email,
        'full_name', coalesce(p.full_name, p.display_name, p.email),
        'role', p.role
      ) order by coalesce(p.full_name, p.display_name, p.email))
      from public.profiles p
      where v_query <> ''
        and (
          lower(coalesce(p.email, '')) like '%' || v_query || '%'
          or lower(coalesce(p.full_name, '')) like '%' || v_query || '%'
          or lower(coalesce(p.display_name, '')) like '%' || v_query || '%'
        )
      limit 25
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.activate_keeprspace_org(
  p_organization_id uuid,
  p_workspace_type text,
  p_operator_user_id uuid,
  p_member_role text,
  p_capabilities jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org public.orgs%rowtype;
  v_operator public.profiles%rowtype;
  v_workspace_type text;
  v_capabilities jsonb;
  v_activation public.org_activations%rowtype;
  v_role text;
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if p_operator_user_id is null then
    raise exception 'operator_user_id is required';
  end if;

  v_workspace_type := lower(coalesce(nullif(p_workspace_type, ''), 'keeprpro'));
  if v_workspace_type not in ('keeprpro', 'keeprdealer', 'keeproem', 'org') then
    raise exception 'unsupported workspace_type: %', p_workspace_type;
  end if;

  v_role := lower(coalesce(nullif(p_member_role, ''), 'member'));
  if v_role not in ('owner', 'admin', 'manager', 'member', 'provider_member') then
    raise exception 'unsupported member_role: %', p_member_role;
  end if;

  v_capabilities := case
    when jsonb_typeof(coalesce(p_capabilities, '[]'::jsonb)) = 'array'
      then coalesce(p_capabilities, '[]'::jsonb)
    else '[]'::jsonb
  end;

  select *
  into v_org
  from public.orgs
  where id = p_organization_id
  for update;

  if v_org.id is null then
    raise exception 'organization not found';
  end if;

  select *
  into v_operator
  from public.profiles
  where id = p_operator_user_id;

  if v_operator.id is null then
    raise exception 'operator profile not found';
  end if;

  update public.orgs
  set
    workspace_type = v_workspace_type,
    workspace_capabilities = case
      when jsonb_array_length(v_capabilities) > 0 then v_capabilities
      else public.keepr_default_capabilities_for_workspace(v_workspace_type)
    end,
    authority_state = coalesce(nullif(authority_state, ''), 'org_managed'),
    updated_at = now()
  where id = p_organization_id;

  insert into public.org_members (
    org_id,
    user_id,
    member_role,
    role,
    status,
    metadata,
    created_at,
    joined_at
  )
  values (
    p_organization_id,
    p_operator_user_id,
    v_role,
    v_role,
    'active',
    jsonb_build_object(
      'activation_purpose', 'activation_operator',
      'assigned_by', auth.uid(),
      'assigned_at', now()
    ),
    now(),
    now()
  )
  on conflict (org_id, user_id) do update
    set member_role = excluded.member_role,
        role = excluded.role,
        status = 'active',
        metadata = coalesce(public.org_members.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'activation_purpose', 'activation_operator',
            'assigned_by', auth.uid(),
            'assigned_at', now()
          ),
        joined_at = coalesce(public.org_members.joined_at, now());

  insert into public.org_activations (
    organization_id,
    workspace_type,
    status,
    capabilities,
    activation_metadata,
    activated_at,
    activated_by
  )
  values (
    p_organization_id,
    v_workspace_type,
    'active',
    case
      when jsonb_array_length(v_capabilities) > 0 then v_capabilities
      else public.keepr_default_capabilities_for_workspace(v_workspace_type)
    end,
    jsonb_build_object(
      'operator_user_id', p_operator_user_id,
      'operator_member_role', v_role,
      'source', 'keepr_admin_v1'
    ),
    now(),
    auth.uid()
  )
  on conflict (organization_id) do update
    set workspace_type = excluded.workspace_type,
        status = 'active',
        capabilities = excluded.capabilities,
        activation_metadata = coalesce(public.org_activations.activation_metadata, '{}'::jsonb)
          || excluded.activation_metadata,
        activated_at = coalesce(public.org_activations.activated_at, excluded.activated_at),
        activated_by = excluded.activated_by
  returning *
  into v_activation;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'workspace_id', 'org:' || p_organization_id::text,
    'workspace_type', v_workspace_type,
    'operator_user_id', p_operator_user_id,
    'member_role', v_role,
    'activation', to_jsonb(v_activation),
    'workspace', public.keepr_admin_workspace_preview_json(p_organization_id),
    'warnings', '[]'::jsonb
  );
end;
$$;

grant execute on function public.is_keepr_internal_admin(uuid) to authenticated;
grant execute on function public.search_keepr_admin_orgs(text) to authenticated;
grant execute on function public.get_keepr_admin_org_activation(uuid) to authenticated;
grant execute on function public.search_keepr_admin_operator_users(text) to authenticated;
grant execute on function public.preview_keeprspace_workspace(uuid) to authenticated;
grant execute on function public.activate_keeprspace_org(uuid, text, uuid, text, jsonb) to authenticated;

comment on table public.keepr_internal_admins is
  'Explicit Keepr internal authority for first-party operational modules. Ordinary profile/org roles do not grant this authority.';

comment on table public.org_activations is
  'First-class lifecycle record for activating canonical orgs into KeeprSpace workspaces.';

comment on function public.activate_keeprspace_org(uuid, text, uuid, text, jsonb) is
  'Keepr Admin transactional activation for existing canonical org and existing operator profile. Does not create orgs, KeeprPros, or Supabase Auth users.';
