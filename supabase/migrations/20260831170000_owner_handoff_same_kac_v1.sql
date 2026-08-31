-- Dealer -> Owner handoff V1.
--
-- Same asset/KAC. Pending owner lives in asset_relationships.
-- Acceptance activates owner_full and updates assets.owner_id as the existing owner projection pointer.

alter table public.asset_relationships
  drop constraint if exists asset_relationships_party_check;

alter table public.asset_relationships
  add constraint asset_relationships_party_check
  check (
    organization_id is not null
    or user_id is not null
    or keepr_pro_id is not null
    or (
      relationship_type = 'owner'
      and metadata ? 'pending_owner_email'
    )
  );

create unique index if not exists asset_relationships_pending_owner_email_uidx
  on public.asset_relationships (asset_id, lower(metadata ->> 'pending_owner_email'))
  where relationship_type = 'owner'
    and status in ('pending', 'invited')
    and metadata ? 'pending_owner_email';

create or replace function public.initiate_asset_owner_handoff(
  p_asset_id uuid,
  p_owner_email text,
  p_owner_display_name text default null,
  p_initiated_by_org_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_email text := lower(nullif(trim(coalesce(p_owner_email, '')), ''));
  v_asset public.assets%rowtype;
  v_org_id uuid;
  v_owner_user_id uuid;
  v_relationship public.asset_relationships%rowtype;
begin
  if v_actor_user_id is null then
    raise exception 'Authentication required';
  end if;

  if v_email is null then
    raise exception 'Owner email is required';
  end if;

  select *
  into v_asset
  from public.assets
  where id = p_asset_id
    and coalesce(deleted_at is null, true)
  limit 1;

  if v_asset.id is null then
    raise exception 'Asset not found';
  end if;

  select ar.organization_id
  into v_org_id
  from public.asset_relationships ar
  where ar.asset_id = v_asset.id
    and ar.status = 'active'
    and ar.relationship_type in ('assigned_dealer', 'selling_dealer', 'delivery_dealer')
    and ar.organization_id is not null
    and (p_initiated_by_org_id is null or ar.organization_id = p_initiated_by_org_id)
    and public.activator_user_can_act_for_org(v_actor_user_id, ar.organization_id)
  order by
    case ar.relationship_type when 'assigned_dealer' then 0 when 'selling_dealer' then 1 else 2 end,
    ar.created_at desc
  limit 1;

  if v_org_id is null then
    raise exception 'Active dealer assignment is required to initiate owner handoff';
  end if;

  select p.id
  into v_owner_user_id
  from public.profiles p
  where lower(p.email) = v_email
  limit 1;

  insert into public.asset_relationships (
    asset_id,
    user_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    initiated_by_user_id,
    initiated_by_org_id,
    metadata
  )
  values (
    v_asset.id,
    v_owner_user_id,
    'owner',
    'invited',
    'transfer_workspace',
    'invited',
    v_actor_user_id,
    v_org_id,
    jsonb_build_object(
      'source', 'dealer_owner_handoff_v1',
      'pending_owner_email', v_email,
      'pending_owner_display_name', nullif(trim(coalesce(p_owner_display_name, '')), ''),
      'handoff_state', 'pending_owner_acceptance',
      'handoff_initiated_at', now(),
      'handoff_initiated_by_org_id', v_org_id,
      'previous_owner_id', v_asset.owner_id,
      'relationship_purpose', 'ownership'
    )
  )
  on conflict (asset_id, lower(metadata ->> 'pending_owner_email'))
    where relationship_type = 'owner'
      and status in ('pending', 'invited')
      and metadata ? 'pending_owner_email'
  do update set
    user_id = coalesce(excluded.user_id, public.asset_relationships.user_id),
    status = 'invited',
    access_scope = 'transfer_workspace',
    claim_state = 'invited',
    initiated_by_user_id = excluded.initiated_by_user_id,
    initiated_by_org_id = excluded.initiated_by_org_id,
    metadata = coalesce(public.asset_relationships.metadata, '{}'::jsonb)
      || excluded.metadata
      || jsonb_build_object('handoff_reinvited_at', now()),
    updated_at = now()
  returning * into v_relationship;

  return jsonb_build_object(
    'ok', true,
    'asset_id', v_asset.id,
    'kac_id', v_asset.kac_id,
    'asset_relationship_id', v_relationship.id,
    'status', v_relationship.status,
    'access_scope', v_relationship.access_scope,
    'pending_owner_email', v_email,
    'owner_user_id', v_relationship.user_id,
    'initiated_by_org_id', v_org_id
  );
end;
$$;

create or replace function public.list_pending_asset_owner_handoffs()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_rows jsonb;
begin
  if v_user_id is null then
    return jsonb_build_object('handoffs', '[]'::jsonb);
  end if;

  select lower(email)
  into v_email
  from public.profiles
  where id = v_user_id
  limit 1;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'asset_relationship_id', ar.id,
      'asset_id', a.id,
      'kac_id', a.kac_id,
      'asset_name', a.name,
      'year', a.year,
      'make', a.make,
      'model', a.model,
      'status', ar.status,
      'access_scope', ar.access_scope,
      'pending_owner_email', ar.metadata ->> 'pending_owner_email',
      'pending_owner_display_name', ar.metadata ->> 'pending_owner_display_name',
      'dealer_org_id', ar.initiated_by_org_id,
      'dealer_name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), 'Dealer'),
      'initiated_at', ar.created_at
    )
    order by ar.created_at desc
  ), '[]'::jsonb)
  into v_rows
  from public.asset_relationships ar
  join public.assets a
    on a.id = ar.asset_id
   and coalesce(a.deleted_at is null, true)
  left join public.orgs o
    on o.id = ar.initiated_by_org_id
  where ar.relationship_type = 'owner'
    and ar.status in ('pending', 'invited')
    and (
      ar.user_id = v_user_id
      or lower(ar.metadata ->> 'pending_owner_email') = v_email
    );

  return jsonb_build_object('handoffs', v_rows);
end;
$$;

create or replace function public.accept_asset_owner_handoff(
  p_asset_relationship_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_relationship public.asset_relationships%rowtype;
  v_asset public.assets%rowtype;
  v_previous_owner_id uuid;
begin
  if v_user_id is null then
    raise exception 'Authentication required';
  end if;

  select lower(email)
  into v_email
  from public.profiles
  where id = v_user_id
  limit 1;

  select *
  into v_relationship
  from public.asset_relationships ar
  where ar.id = p_asset_relationship_id
    and ar.relationship_type = 'owner'
    and ar.status in ('pending', 'invited')
    and (
      ar.user_id = v_user_id
      or lower(ar.metadata ->> 'pending_owner_email') = v_email
    )
  limit 1;

  if v_relationship.id is null then
    raise exception 'Pending owner handoff not found';
  end if;

  select *
  into v_asset
  from public.assets
  where id = v_relationship.asset_id
    and coalesce(deleted_at is null, true)
  limit 1;

  if v_asset.id is null then
    raise exception 'Asset not found';
  end if;

  v_previous_owner_id := v_asset.owner_id;

  update public.asset_relationships
  set
    status = 'ended',
    effective_to = now(),
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'handoff_state', 'superseded_by_owner_acceptance',
        'ended_by_owner_handoff_id', v_relationship.id,
        'ended_at', now()
      ),
    updated_at = now()
  where asset_id = v_asset.id
    and relationship_type = 'owner'
    and status = 'active'
    and coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_user_id;

  update public.asset_relationships
  set
    user_id = v_user_id,
    status = 'active',
    access_scope = 'owner_full',
    claim_state = 'accepted',
    effective_from = coalesce(effective_from, now()),
    metadata = coalesce(metadata, '{}'::jsonb)
      || jsonb_build_object(
        'handoff_state', 'accepted',
        'accepted_at', now(),
        'accepted_by_user_id', v_user_id,
        'previous_owner_id', v_previous_owner_id,
        'relationship_purpose', 'ownership'
      ),
    updated_at = now()
  where id = v_relationship.id
  returning * into v_relationship;

  update public.assets
  set
    owner_id = v_user_id,
    updated_at = now()
  where id = v_asset.id;

  return jsonb_build_object(
    'ok', true,
    'asset_id', v_asset.id,
    'kac_id', v_asset.kac_id,
    'asset_relationship_id', v_relationship.id,
    'owner_user_id', v_user_id,
    'previous_owner_id', v_previous_owner_id,
    'status', v_relationship.status,
    'access_scope', v_relationship.access_scope
  );
end;
$$;

grant execute on function public.initiate_asset_owner_handoff(uuid, text, text, uuid) to authenticated;
grant execute on function public.list_pending_asset_owner_handoffs() to authenticated;
grant execute on function public.accept_asset_owner_handoff(uuid) to authenticated;
