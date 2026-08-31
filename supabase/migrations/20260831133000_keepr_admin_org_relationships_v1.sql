-- Keepr Admin organization categorization and relationship assignment V1.
--
-- Organizations remain the tenant primitive. This adds admin-safe filtering and
-- relationship assignment for dealer -> OEM and child -> parent-company graphs.

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

alter table public.org_relationships
  drop constraint if exists org_relationships_type_check;

alter table public.org_relationships
  add constraint org_relationships_type_check
    check (relationship_type in (
      'authorized_dealer',
      'dealer_network_member',
      'oem_partner',
      'represented_brand',
      'parent_company'
    ));

create or replace function public.keepr_org_preset_config(p_preset text)
returns jsonb
language sql
immutable
as $$
  select case lower(coalesce(nullif(p_preset, ''), 'org'))
    when 'oem' then jsonb_build_object(
      'preset', 'oem',
      'organization_type', 'oem',
      'org_type', 'manufacturer',
      'workspace_type', 'keeproem',
      'capabilities', public.keepr_default_capabilities_for_workspace('keeproem'),
      'profile_category', 'oem'
    )
    when 'dealer' then jsonb_build_object(
      'preset', 'dealer',
      'organization_type', 'dealer',
      'org_type', 'dealer',
      'workspace_type', 'keeprdealer',
      'capabilities', public.keepr_default_capabilities_for_workspace('keeprdealer'),
      'profile_category', 'dealer'
    )
    when 'member_team' then jsonb_build_object(
      'preset', 'member_team',
      'organization_type', 'member_team',
      'org_type', 'member_team',
      'workspace_type', 'org',
      'capabilities', '["shared_assets","member_portfolio","team_access","relationships"]'::jsonb,
      'profile_category', 'member_team'
    )
    when 'parent_company' then jsonb_build_object(
      'preset', 'parent_company',
      'organization_type', 'parent_company',
      'org_type', 'parent_company',
      'workspace_type', 'org',
      'capabilities', '["relationships","customer_state"]'::jsonb,
      'profile_category', 'parent_company'
    )
    else jsonb_build_object(
      'preset', 'org',
      'organization_type', 'org',
      'org_type', 'org',
      'workspace_type', 'org',
      'capabilities', '[]'::jsonb,
      'profile_category', 'org'
    )
  end;
$$;

drop function if exists public.search_keepr_admin_orgs(text);

create or replace function public.search_keepr_admin_orgs(
  p_query text default null,
  p_organization_type text default null,
  p_workspace_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
  v_org_type text := lower(nullif(trim(coalesce(p_organization_type, '')), ''));
  v_workspace_type text := lower(nullif(trim(coalesce(p_workspace_type, '')), ''));
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  return jsonb_build_object(
    'query', coalesce(p_query, ''),
    'organization_type', v_org_type,
    'workspace_type', v_workspace_type,
    'organizations', coalesce((
      with matches as (
        select
          o.*,
          kp.id as keepr_pro_id,
          kp.slug as keepr_pro_slug,
          kp.display_name as keepr_pro_display_name,
          kp.name as keepr_pro_name,
          kp.email as keepr_pro_email,
          kp.website as keepr_pro_website,
          kp.claimed_state as keepr_pro_claimed_state,
          kp.profile_status as keepr_pro_profile_status,
          oa.id as activation_id,
          oa.status as activation_status,
          oa.workspace_type as activation_workspace_type,
          oa.activated_at,
          public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type) as resolved_workspace_type,
          coalesce(nullif(o.organization_type, ''), nullif(o.org_type, 'org'), 'org') as resolved_org_type
        from public.orgs o
        left join public.keepr_pros kp on kp.organization_id = o.id
        left join public.org_activations oa on oa.organization_id = o.id
        where coalesce(o.status, 'active') = 'active'
          and (
            v_org_type is null
            or lower(coalesce(o.organization_type, o.org_type, '')) = v_org_type
            or (v_org_type = 'oem' and lower(coalesce(o.organization_type, o.org_type, '')) = 'manufacturer')
          )
          and (
            v_workspace_type is null
            or lower(public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type)) = v_workspace_type
          )
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
        order by coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.display_name, kp.name)
        limit 75
      )
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'display_name', coalesce(nullif(m.display_name, ''), nullif(m.name, ''), m.keepr_pro_display_name, m.keepr_pro_name),
        'slug', m.slug,
        'org_type', m.org_type,
        'organization_type', m.organization_type,
        'status', coalesce(m.status, 'active'),
        'workspace_type', m.resolved_workspace_type,
        'workspace_capabilities', public.keepr_effective_workspace_capabilities(
          m.resolved_workspace_type,
          coalesce(m.workspace_capabilities, '[]'::jsonb)
        ),
        'activation', case when m.activation_id is null then null else jsonb_build_object(
          'id', m.activation_id,
          'status', m.activation_status,
          'workspace_type', m.activation_workspace_type,
          'activated_at', m.activated_at
        ) end,
        'keepr_pro', case when m.keepr_pro_id is null then null else jsonb_build_object(
          'id', m.keepr_pro_id,
          'slug', m.keepr_pro_slug,
          'display_name', m.keepr_pro_display_name,
          'claimed_state', m.keepr_pro_claimed_state,
          'profile_status', m.keepr_pro_profile_status
        ) end
      ))
      from matches m
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_keepr_admin_org_relationship(
  p_from_org_id uuid,
  p_to_org_id uuid,
  p_relationship_type text,
  p_status text default 'active',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_relationship_type text := lower(coalesce(nullif(trim(coalesce(p_relationship_type, '')), ''), 'authorized_dealer'));
  v_status text := lower(coalesce(nullif(trim(coalesce(p_status, '')), ''), 'active'));
  v_from_org public.orgs%rowtype;
  v_to_org public.orgs%rowtype;
  v_relationship public.org_relationships%rowtype;
begin
  if not public.is_keepr_internal_admin(v_actor_user_id) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  if p_from_org_id is null or p_to_org_id is null then
    raise exception 'from_org_id and to_org_id are required';
  end if;

  if p_from_org_id = p_to_org_id then
    raise exception 'organization cannot relate to itself';
  end if;

  if v_relationship_type not in ('authorized_dealer', 'dealer_network_member', 'oem_partner', 'represented_brand', 'parent_company') then
    raise exception 'unsupported relationship_type: %', p_relationship_type;
  end if;

  if v_status not in ('source_reported', 'active', 'inactive', 'superseded', 'disputed') then
    raise exception 'unsupported relationship status: %', p_status;
  end if;

  select * into v_from_org from public.orgs where id = p_from_org_id;
  select * into v_to_org from public.orgs where id = p_to_org_id;

  if v_from_org.id is null then
    raise exception 'source organization not found';
  end if;

  if v_to_org.id is null then
    raise exception 'target organization not found';
  end if;

  insert into public.org_relationships (
    from_org_id,
    to_org_id,
    relationship_type,
    status,
    evidence_state,
    metadata,
    created_by,
    created_at,
    updated_at
  )
  values (
    p_from_org_id,
    p_to_org_id,
    v_relationship_type,
    v_status,
    'org_confirmed',
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'keepr_admin',
      'assigned_by', v_actor_user_id,
      'assigned_at', now()
    ),
    v_actor_user_id,
    now(),
    now()
  )
  on conflict (from_org_id, to_org_id, relationship_type)
    where status in ('source_reported', 'active')
  do update
    set status = excluded.status,
        evidence_state = 'org_confirmed',
        metadata = coalesce(public.org_relationships.metadata, '{}'::jsonb)
          || coalesce(p_metadata, '{}'::jsonb)
          || jsonb_build_object(
            'source', 'keepr_admin',
            'assigned_by', v_actor_user_id,
            'assigned_at', now()
          ),
        updated_at = now()
  returning * into v_relationship;

  perform public.keepr_admin_record_audit_event(
    v_actor_user_id,
    'organization.relationship.upserted',
    p_from_org_id,
    'org_relationship',
    v_relationship.id::text,
    'success',
    jsonb_build_object(
      'from_org_id', p_from_org_id,
      'to_org_id', p_to_org_id,
      'relationship_type', v_relationship_type,
      'status', v_status
    )
  );

  return jsonb_build_object(
    'ok', true,
    'relationship', to_jsonb(v_relationship),
    'from_organization', to_jsonb(v_from_org),
    'to_organization', to_jsonb(v_to_org)
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
    'relationships_from', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'from_org_id', r.from_org_id,
        'to_org_id', r.to_org_id,
        'relationship_type', r.relationship_type,
        'status', r.status,
        'evidence_state', r.evidence_state,
        'metadata', coalesce(r.metadata, '{}'::jsonb),
        'related_org', jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'display_name', coalesce(nullif(o.display_name, ''), o.name),
          'slug', o.slug,
          'org_type', o.org_type,
          'organization_type', o.organization_type,
          'workspace_type', public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type)
        )
      ) order by r.relationship_type, coalesce(o.display_name, o.name))
      from public.org_relationships r
      join public.orgs o on o.id = r.to_org_id
      where r.from_org_id = p_organization_id
        and r.status in ('source_reported', 'active')
    ), '[]'::jsonb),
    'relationships_to', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'from_org_id', r.from_org_id,
        'to_org_id', r.to_org_id,
        'relationship_type', r.relationship_type,
        'status', r.status,
        'evidence_state', r.evidence_state,
        'metadata', coalesce(r.metadata, '{}'::jsonb),
        'related_org', jsonb_build_object(
          'id', o.id,
          'name', o.name,
          'display_name', coalesce(nullif(o.display_name, ''), o.name),
          'slug', o.slug,
          'org_type', o.org_type,
          'organization_type', o.organization_type,
          'workspace_type', public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type)
        )
      ) order by r.relationship_type, coalesce(o.display_name, o.name))
      from public.org_relationships r
      join public.orgs o on o.id = r.from_org_id
      where r.to_org_id = p_organization_id
        and r.status in ('source_reported', 'active')
    ), '[]'::jsonb),
    'parent_chain', coalesce((
      with recursive parent_chain as (
        select
          child.id as child_org_id,
          coalesce(nullif(child.display_name, ''), child.name) as child_name,
          parent.id as parent_org_id,
          coalesce(nullif(parent.display_name, ''), parent.name) as parent_name,
          r.relationship_type,
          r.status,
          1 as depth,
          array[child.id, parent.id] as visited
        from public.org_relationships r
        join public.orgs child on child.id = r.from_org_id
        join public.orgs parent on parent.id = r.to_org_id
        where r.from_org_id = p_organization_id
          and r.relationship_type = 'parent_company'
          and r.status in ('source_reported', 'active')

        union all

        select
          pc.parent_org_id,
          pc.parent_name,
          parent.id,
          coalesce(nullif(parent.display_name, ''), parent.name),
          r.relationship_type,
          r.status,
          pc.depth + 1,
          pc.visited || parent.id
        from parent_chain pc
        join public.org_relationships r on r.from_org_id = pc.parent_org_id
        join public.orgs parent on parent.id = r.to_org_id
        where r.relationship_type = 'parent_company'
          and r.status in ('source_reported', 'active')
          and not parent.id = any(pc.visited)
      )
      select jsonb_agg(jsonb_build_object(
        'depth', depth,
        'child_org_id', child_org_id,
        'child_name', child_name,
        'parent_org_id', parent_org_id,
        'parent_name', parent_name,
        'relationship_type', relationship_type,
        'status', status
      ) order by depth)
      from parent_chain
    ), '[]'::jsonb),
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

grant execute on function public.search_keepr_admin_orgs(text, text, text) to authenticated;
grant execute on function public.upsert_keepr_admin_org_relationship(uuid, uuid, text, text, jsonb) to authenticated;

comment on function public.upsert_keepr_admin_org_relationship(uuid, uuid, text, text, jsonb) is
  'Keepr Admin control-plane operation for assigning organization relationships without adding customer org membership.';
