-- Keepr Admin Control Plane V1.
--
-- Keeps platform administration separate from customer/org workspaces while
-- using organizations as the single tenant primitive for OEM, Dealer, and
-- Member Team customers.

create table if not exists public.keepr_admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  organization_id uuid references public.orgs(id) on delete set null,
  object_type text not null default 'organization',
  object_id text,
  result text not null default 'success',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint keepr_admin_audit_events_result_check
    check (result in ('success', 'denied', 'failure'))
);

create index if not exists keepr_admin_audit_events_actor_idx
  on public.keepr_admin_audit_events (actor_user_id, created_at desc);

create index if not exists keepr_admin_audit_events_org_idx
  on public.keepr_admin_audit_events (organization_id, created_at desc);

create index if not exists keepr_admin_audit_events_action_idx
  on public.keepr_admin_audit_events (action, created_at desc);

alter table public.keepr_admin_audit_events enable row level security;

drop policy if exists keepr_admin_audit_events_internal_read on public.keepr_admin_audit_events;
create policy keepr_admin_audit_events_internal_read
on public.keepr_admin_audit_events
for select
using (
  auth.role() = 'service_role'
  or public.is_keepr_internal_admin(auth.uid())
);

create table if not exists public.org_customer_states (
  organization_id uuid primary key references public.orgs(id) on delete cascade,
  customer_state text not null default 'prospect',
  entitlement_state text not null default 'trial',
  entitlement_plan text not null default 'demo',
  billing_customer_ref text,
  entitlements jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_customer_states_customer_state_check
    check (customer_state in ('prospect', 'demo', 'trial', 'active', 'paused', 'churned', 'archived')),
  constraint org_customer_states_entitlement_state_check
    check (entitlement_state in ('demo', 'trial', 'active', 'past_due', 'paused', 'expired', 'none'))
);

create index if not exists org_customer_states_customer_state_idx
  on public.org_customer_states (customer_state);

create index if not exists org_customer_states_entitlement_state_idx
  on public.org_customer_states (entitlement_state);

alter table public.org_customer_states enable row level security;

drop policy if exists org_customer_states_internal_read on public.org_customer_states;
create policy org_customer_states_internal_read
on public.org_customer_states
for select
using (
  auth.role() = 'service_role'
  or public.is_keepr_internal_admin(auth.uid())
);

create or replace function public.keepr_admin_record_audit_event(
  p_actor_user_id uuid,
  p_action text,
  p_organization_id uuid default null,
  p_object_type text default 'organization',
  p_object_id text default null,
  p_result text default 'success',
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := coalesce(p_actor_user_id, auth.uid());
  v_action text := nullif(trim(coalesce(p_action, '')), '');
  v_object_type text := coalesce(nullif(trim(coalesce(p_object_type, '')), ''), 'organization');
  v_result text := lower(coalesce(nullif(trim(coalesce(p_result, '')), ''), 'success'));
  v_event_id uuid;
begin
  if not public.is_keepr_internal_admin(v_actor_user_id) and auth.role() <> 'service_role' then
    raise exception 'not authorized for Keepr Admin';
  end if;

  if v_action is null then
    raise exception 'admin audit action is required';
  end if;

  if v_result not in ('success', 'denied', 'failure') then
    v_result := 'failure';
  end if;

  insert into public.keepr_admin_audit_events (
    actor_user_id,
    action,
    organization_id,
    object_type,
    object_id,
    result,
    metadata
  )
  values (
    v_actor_user_id,
    v_action,
    p_organization_id,
    v_object_type,
    p_object_id,
    v_result,
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create or replace function public.list_keepr_internal_admins()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  return jsonb_build_object(
    'admins', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', kia.user_id,
        'email', p.email,
        'full_name', coalesce(p.full_name, p.display_name, p.email),
        'authority', kia.authority,
        'status', kia.status,
        'granted_by', kia.granted_by,
        'granted_at', kia.granted_at,
        'revoked_at', kia.revoked_at,
        'metadata', coalesce(kia.metadata, '{}'::jsonb)
      ) order by kia.granted_at desc)
      from public.keepr_internal_admins kia
      left join public.profiles p on p.id = kia.user_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.manage_keepr_internal_admin(
  p_target_user_id uuid default null,
  p_target_email text default null,
  p_authority text default 'keepr_admin',
  p_status text default 'active',
  p_reason text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_target public.profiles%rowtype;
  v_authority text := lower(coalesce(nullif(trim(coalesce(p_authority, '')), ''), 'keepr_admin'));
  v_status text := lower(coalesce(nullif(trim(coalesce(p_status, '')), ''), 'active'));
begin
  if not public.is_keepr_internal_admin(v_actor_user_id) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  if v_authority not in ('keepr_admin', 'activation_admin', 'support_admin') then
    raise exception 'unsupported internal admin authority: %', p_authority;
  end if;

  if v_status not in ('active', 'inactive', 'revoked') then
    raise exception 'unsupported internal admin status: %', p_status;
  end if;

  select *
  into v_target
  from public.profiles p
  where (p_target_user_id is not null and p.id = p_target_user_id)
     or (
       p_target_user_id is null
       and nullif(trim(coalesce(p_target_email, '')), '') is not null
       and lower(coalesce(p.email, '')) = lower(trim(p_target_email))
     )
  order by case when p.id = p_target_user_id then 0 else 1 end
  limit 1;

  if v_target.id is null then
    raise exception 'target profile not found';
  end if;

  insert into public.keepr_internal_admins (
    user_id,
    authority,
    status,
    granted_by,
    granted_at,
    revoked_at,
    metadata
  )
  values (
    v_target.id,
    v_authority,
    v_status,
    v_actor_user_id,
    now(),
    case when v_status = 'revoked' then now() else null end,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('reason', p_reason)
  )
  on conflict (user_id) do update
    set authority = excluded.authority,
        status = excluded.status,
        revoked_at = case when excluded.status = 'revoked' then now() else null end,
        metadata = coalesce(public.keepr_internal_admins.metadata, '{}'::jsonb)
          || coalesce(p_metadata, '{}'::jsonb)
          || jsonb_build_object('reason', p_reason),
        updated_at = now();

  perform public.keepr_admin_record_audit_event(
    v_actor_user_id,
    case when v_status = 'revoked' then 'internal_admin.revoked' else 'internal_admin.granted' end,
    null,
    'keepr_internal_admin',
    v_target.id::text,
    'success',
    jsonb_build_object(
      'target_email', v_target.email,
      'authority', v_authority,
      'status', v_status,
      'reason', p_reason
    )
  );

  return jsonb_build_object(
    'ok', true,
    'user_id', v_target.id,
    'email', v_target.email,
    'authority', v_authority,
    'status', v_status
  );
end;
$$;

create or replace function public.set_keepr_admin_org_customer_state(
  p_organization_id uuid,
  p_customer_state text default 'prospect',
  p_entitlement_state text default 'trial',
  p_entitlement_plan text default 'demo',
  p_entitlements jsonb default '{}'::jsonb,
  p_billing_customer_ref text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_org public.orgs%rowtype;
  v_state public.org_customer_states%rowtype;
  v_customer_state text := lower(coalesce(nullif(trim(coalesce(p_customer_state, '')), ''), 'prospect'));
  v_entitlement_state text := lower(coalesce(nullif(trim(coalesce(p_entitlement_state, '')), ''), 'trial'));
  v_entitlement_plan text := lower(coalesce(nullif(trim(coalesce(p_entitlement_plan, '')), ''), 'demo'));
begin
  if not public.is_keepr_internal_admin(v_actor_user_id) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  select *
  into v_org
  from public.orgs
  where id = p_organization_id;

  if v_org.id is null then
    raise exception 'organization not found';
  end if;

  insert into public.org_customer_states (
    organization_id,
    customer_state,
    entitlement_state,
    entitlement_plan,
    billing_customer_ref,
    entitlements,
    metadata,
    updated_by
  )
  values (
    p_organization_id,
    v_customer_state,
    v_entitlement_state,
    v_entitlement_plan,
    nullif(trim(coalesce(p_billing_customer_ref, '')), ''),
    coalesce(p_entitlements, '{}'::jsonb),
    coalesce(p_metadata, '{}'::jsonb),
    v_actor_user_id
  )
  on conflict (organization_id) do update
    set customer_state = excluded.customer_state,
        entitlement_state = excluded.entitlement_state,
        entitlement_plan = excluded.entitlement_plan,
        billing_customer_ref = excluded.billing_customer_ref,
        entitlements = excluded.entitlements,
        metadata = coalesce(public.org_customer_states.metadata, '{}'::jsonb) || excluded.metadata,
        updated_by = excluded.updated_by,
        updated_at = now()
  returning * into v_state;

  perform public.keepr_admin_record_audit_event(
    v_actor_user_id,
    'organization.customer_state.updated',
    p_organization_id,
    'org_customer_state',
    p_organization_id::text,
    'success',
    jsonb_build_object(
      'customer_state', v_state.customer_state,
      'entitlement_state', v_state.entitlement_state,
      'entitlement_plan', v_state.entitlement_plan,
      'billing_customer_ref', v_state.billing_customer_ref
    )
  );

  return jsonb_build_object('ok', true, 'customer_state', to_jsonb(v_state));
end;
$$;

create or replace function public.get_keepr_admin_audit_events(
  p_organization_id uuid default null,
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  return jsonb_build_object(
    'events', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'actor_user_id', e.actor_user_id,
        'actor_email', p.email,
        'action', e.action,
        'organization_id', e.organization_id,
        'object_type', e.object_type,
        'object_id', e.object_id,
        'result', e.result,
        'metadata', e.metadata,
        'created_at', e.created_at
      ) order by e.created_at desc)
      from (
        select *
        from public.keepr_admin_audit_events e
        where p_organization_id is null or e.organization_id = p_organization_id
        order by e.created_at desc
        limit v_limit
      ) e
      left join public.profiles p on p.id = e.actor_user_id
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.create_keepr_organization(
  p_org_name text,
  p_org_preset text,
  p_admin_user_id uuid,
  p_admin_email text default null,
  p_brand jsonb default '{}'::jsonb,
  p_capabilities jsonb default null,
  p_actor_user_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := coalesce(p_actor_user_id, auth.uid());
  v_org_name text := nullif(trim(coalesce(p_org_name, '')), '');
  v_admin_email text := lower(nullif(trim(coalesce(p_admin_email, '')), ''));
  v_brand jsonb := coalesce(p_brand, '{}'::jsonb);
  v_preset jsonb := public.keepr_org_preset_config(p_org_preset);
  v_workspace_type text := v_preset ->> 'workspace_type';
  v_capabilities jsonb := case
    when jsonb_typeof(coalesce(p_capabilities, 'null'::jsonb)) = 'array' then p_capabilities
    else v_preset -> 'capabilities'
  end;
  v_org public.orgs%rowtype;
  v_admin public.profiles%rowtype;
  v_slug text;
  v_candidate_slug text;
  v_profile public.keepr_pros%rowtype;
  v_template_count integer := 0;
  v_draft_count integer := 0;
  v_exact_build_count integer := 0;
begin
  if not public.is_keepr_internal_admin(v_actor_user_id) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  if v_org_name is null then
    raise exception 'org_name is required';
  end if;

  if p_admin_user_id is null then
    raise exception 'admin_user_id is required';
  end if;

  select *
  into v_admin
  from public.profiles
  where id = p_admin_user_id;

  if v_admin.id is null then
    raise exception 'admin profile not found';
  end if;

  v_admin_email := coalesce(v_admin_email, lower(nullif(v_admin.email, '')));
  v_candidate_slug := coalesce(
    nullif(public.keepr_slugify(v_brand ->> 'slug'), ''),
    public.keepr_slugify(v_org_name)
  );

  select *
  into v_org
  from public.orgs o
  where lower(coalesce(o.slug, '')) = lower(v_candidate_slug)
     or lower(coalesce(o.name, '')) = lower(v_org_name)
     or lower(coalesce(o.display_name, '')) = lower(v_org_name)
  order by
    case when lower(coalesce(o.slug, '')) = lower(v_candidate_slug) then 0 else 1 end,
    o.created_at asc nulls last
  limit 1;

  if v_org.id is null then
    v_slug := public.keepr_unique_org_slug(coalesce(v_brand ->> 'slug', v_org_name));

    insert into public.orgs (
      name,
      display_name,
      slug,
      organization_type,
      org_type,
      workspace_type,
      workspace_capabilities,
      status,
      authority_state,
      source_type,
      source_name,
      source_url,
      source_metadata,
      created_at,
      updated_at
    )
    values (
      v_org_name,
      coalesce(nullif(v_brand ->> 'display_name', ''), v_org_name),
      v_slug,
      v_preset ->> 'organization_type',
      v_preset ->> 'org_type',
      v_workspace_type,
      v_capabilities,
      'active',
      'org_managed',
      'keepr_admin',
      'create_keepr_organization',
      nullif(v_brand ->> 'website', ''),
      jsonb_build_object(
        'created_by_operation', 'create_keepr_organization',
        'preset', v_preset ->> 'preset',
        'created_by', v_actor_user_id,
        'created_at', now()
      ),
      now(),
      now()
    )
    returning * into v_org;
  else
    v_slug := coalesce(nullif(v_org.slug, ''), public.keepr_unique_org_slug(coalesce(v_brand ->> 'slug', v_org_name), v_org.id));

    update public.orgs
    set name = coalesce(nullif(name, ''), v_org_name),
        display_name = coalesce(nullif(v_brand ->> 'display_name', ''), nullif(display_name, ''), v_org_name),
        slug = v_slug,
        organization_type = v_preset ->> 'organization_type',
        org_type = v_preset ->> 'org_type',
        workspace_type = v_workspace_type,
        workspace_capabilities = v_capabilities,
        status = 'active',
        authority_state = 'org_managed',
        source_type = coalesce(nullif(source_type, ''), 'keepr_admin'),
        source_name = 'create_keepr_organization',
        source_url = coalesce(nullif(v_brand ->> 'website', ''), source_url),
        source_metadata = coalesce(source_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'provisioned_by_operation', 'create_keepr_organization',
            'preset', v_preset ->> 'preset',
            'provisioned_by', v_actor_user_id,
            'provisioned_at', now()
          ),
        updated_at = now()
    where id = v_org.id
    returning * into v_org;
  end if;

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
    v_org.id,
    v_admin.id,
    'admin',
    'admin',
    'active',
    jsonb_build_object(
      'source', 'create_keepr_organization',
      'preset', v_preset ->> 'preset',
      'assigned_by', v_actor_user_id,
      'assigned_at', now()
    ),
    now(),
    now()
  )
  on conflict (org_id, user_id) do update
    set member_role = 'admin',
        role = 'admin',
        status = 'active',
        metadata = coalesce(public.org_members.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'source', 'create_keepr_organization',
            'preset', v_preset ->> 'preset',
            'assigned_by', v_actor_user_id,
            'assigned_at', now()
          ),
        joined_at = coalesce(public.org_members.joined_at, now());

  select *
  into v_profile
  from public.keepr_pros kp
  where kp.organization_id = v_org.id
  order by kp.created_at asc nulls last
  limit 1;

  if v_profile.id is null then
    insert into public.keepr_pros (
      organization_id,
      user_id,
      name,
      display_name,
      slug,
      category,
      email,
      website,
      logo_url,
      avatar_url,
      header_image_url,
      short_description,
      public_description,
      profile_status,
      publish_status,
      claimed_state,
      source,
      source_metadata,
      created_at,
      updated_at
    )
    values (
      v_org.id,
      v_admin.id,
      v_org_name,
      coalesce(nullif(v_brand ->> 'display_name', ''), v_org_name),
      v_slug,
      v_preset ->> 'profile_category',
      v_admin_email,
      nullif(v_brand ->> 'website', ''),
      nullif(v_brand ->> 'logo_url', ''),
      nullif(v_brand ->> 'avatar_url', ''),
      nullif(v_brand ->> 'header_image_url', ''),
      nullif(v_brand ->> 'short_description', ''),
      nullif(v_brand ->> 'public_description', ''),
      'draft',
      'draft',
      'unclaimed',
      'create_keepr_organization',
      jsonb_build_object('workspace_type', v_workspace_type, 'preset', v_preset ->> 'preset'),
      now(),
      now()
    )
    returning * into v_profile;
  else
    update public.keepr_pros
    set user_id = coalesce(user_id, v_admin.id),
        name = coalesce(nullif(name, ''), v_org_name),
        display_name = coalesce(nullif(v_brand ->> 'display_name', ''), nullif(display_name, ''), v_org_name),
        slug = coalesce(nullif(slug, ''), v_slug),
        category = v_preset ->> 'profile_category',
        email = coalesce(nullif(email, ''), v_admin_email),
        website = coalesce(nullif(v_brand ->> 'website', ''), website),
        logo_url = coalesce(nullif(v_brand ->> 'logo_url', ''), logo_url),
        avatar_url = coalesce(nullif(v_brand ->> 'avatar_url', ''), avatar_url),
        header_image_url = coalesce(nullif(v_brand ->> 'header_image_url', ''), header_image_url),
        short_description = coalesce(nullif(v_brand ->> 'short_description', ''), short_description),
        public_description = coalesce(nullif(v_brand ->> 'public_description', ''), public_description),
        source = 'create_keepr_organization',
        source_metadata = coalesce(source_metadata, '{}'::jsonb)
          || jsonb_build_object('workspace_type', v_workspace_type, 'preset', v_preset ->> 'preset'),
        updated_at = now()
    where id = v_profile.id
    returning * into v_profile;
  end if;

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
    v_org.id,
    v_workspace_type,
    'active',
    v_capabilities,
    jsonb_build_object(
      'source', 'create_keepr_organization',
      'preset', v_preset ->> 'preset',
      'admin_user_id', v_admin.id,
      'admin_email', v_admin_email
    ),
    now(),
    v_actor_user_id
  )
  on conflict (organization_id) do update
    set workspace_type = excluded.workspace_type,
        status = 'active',
        capabilities = excluded.capabilities,
        activation_metadata = coalesce(public.org_activations.activation_metadata, '{}'::jsonb) || excluded.activation_metadata,
        activated_at = coalesce(public.org_activations.activated_at, excluded.activated_at),
        activated_by = excluded.activated_by,
        updated_at = now();

  insert into public.org_customer_states (
    organization_id,
    customer_state,
    entitlement_state,
    entitlement_plan,
    entitlements,
    metadata,
    updated_by
  )
  values (
    v_org.id,
    'demo',
    'demo',
    'demo',
    '{}'::jsonb,
    jsonb_build_object('source', 'create_keepr_organization', 'preset', v_preset ->> 'preset'),
    v_actor_user_id
  )
  on conflict (organization_id) do nothing;

  select count(*)::integer
  into v_template_count
  from public.asset_model_templates t
  where t.organization_id = v_org.id;

  select count(*)::integer
  into v_draft_count
  from public.catalog_template_drafts d
  where d.organization_id = v_org.id;

  select count(*)::integer
  into v_exact_build_count
  from public.exact_build_drafts d
  where d.organization_id = v_org.id;

  perform public.keepr_admin_record_audit_event(
    v_actor_user_id,
    'organization.provisioned',
    v_org.id,
    'organization',
    v_org.id::text,
    'success',
    jsonb_build_object(
      'preset', v_preset ->> 'preset',
      'workspace_type', v_workspace_type,
      'admin_user_id', v_admin.id,
      'admin_email', v_admin_email
    )
  );

  return jsonb_build_object(
    'ok', true,
    'preset', v_preset ->> 'preset',
    'organization_id', v_org.id,
    'workspace_id', 'org:' || v_org.id::text,
    'organization', to_jsonb(v_org),
    'admin_user_id', v_admin.id,
    'admin_email', v_admin_email,
    'brand_profile', to_jsonb(v_profile),
    'catalog_counts', jsonb_build_object(
      'templates', v_template_count,
      'drafts', v_draft_count,
      'exact_build_drafts', v_exact_build_count
    ),
    'workspace', public.keepr_admin_workspace_preview_json(v_org.id)
  );
end;
$$;

create or replace function public.create_keepr_organization(
  p_org_name text,
  p_org_preset text,
  p_admin_user_id uuid,
  p_admin_email text default null,
  p_brand jsonb default '{}'::jsonb,
  p_capabilities jsonb default null
)
returns jsonb
language sql
security definer
set search_path = public
as $$
  select public.create_keepr_organization(
    p_org_name,
    p_org_preset,
    p_admin_user_id,
    p_admin_email,
    p_brand,
    p_capabilities,
    auth.uid()
  );
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
  v_customer_state public.org_customer_states%rowtype;
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

  select *
  into v_customer_state
  from public.org_customer_states
  where organization_id = p_organization_id;

  return jsonb_build_object(
    'organization', to_jsonb(v_org),
    'keepr_pro', case when v_keepr_pro.id is null then null else to_jsonb(v_keepr_pro) end,
    'activation', case when v_activation.id is null then null else to_jsonb(v_activation) end,
    'customer_state', case when v_customer_state.organization_id is null then null else to_jsonb(v_customer_state) end,
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

grant execute on function public.keepr_admin_record_audit_event(uuid, text, uuid, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.list_keepr_internal_admins() to authenticated;
grant execute on function public.manage_keepr_internal_admin(uuid, text, text, text, text, jsonb) to authenticated;
grant execute on function public.set_keepr_admin_org_customer_state(uuid, text, text, text, jsonb, text, jsonb) to authenticated;
grant execute on function public.get_keepr_admin_audit_events(uuid, integer) to authenticated;
grant execute on function public.create_keepr_organization(text, text, uuid, text, jsonb, jsonb, uuid) to authenticated, service_role;

comment on table public.keepr_admin_audit_events is
  'Immutable Keepr Admin control-plane events: actor -> action -> organization/object -> result -> timestamp.';

comment on table public.org_customer_states is
  'Basic customer lifecycle and entitlement state keyed by organization_id for future CRM and billing integrations.';
