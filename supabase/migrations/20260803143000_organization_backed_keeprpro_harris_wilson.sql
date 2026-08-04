-- Organization-backed KeeprPro vertical slice for the Harris-Wilson demo.
-- This deliberately keeps professional access separate from broad Team/Hub
-- asset stewardship. Wilson sees Harris through a narrow projection only.

alter table public.orgs
  add column if not exists slug text,
  add column if not exists organization_type text,
  add column if not exists status text not null default 'active',
  add column if not exists updated_at timestamptz not null default now();

update public.orgs
set organization_type = coalesce(organization_type, org_type)
where organization_type is null;

create unique index if not exists orgs_slug_unique_idx
  on public.orgs (lower(slug))
  where slug is not null;

alter table public.orgs
  drop constraint if exists ux_orgs_owner_user_id;

drop index if exists public.ux_orgs_owner_user_id;

create unique index if not exists ux_orgs_owner_user_id
  on public.orgs (owner_user_id)
  where owner_user_id is not null
    and coalesce(org_type, 'personal') = 'personal';

alter table public.org_members
  add column if not exists role text,
  add column if not exists status text not null default 'active',
  add column if not exists joined_at timestamptz;

update public.org_members
set
  role = coalesce(role, member_role, 'member'),
  joined_at = coalesce(joined_at, created_at, now())
where role is null
   or joined_at is null;

create unique index if not exists org_members_org_user_unique_idx
  on public.org_members (org_id, user_id);

alter table public.keepr_pros
  add column if not exists organization_id uuid references public.orgs(id) on delete set null,
  add column if not exists slug text,
  add column if not exists display_name text,
  add column if not exists logo_url text,
  add column if not exists avatar_url text,
  add column if not exists header_image_url text,
  add column if not exists short_description text,
  add column if not exists claimed_state text not null default 'unclaimed',
  add column if not exists profile_status text not null default 'draft',
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists keepr_pros_slug_unique_idx
  on public.keepr_pros (lower(slug))
  where slug is not null;

create table if not exists public.asset_provider_stewardships (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  keepr_pro_id uuid not null references public.keepr_pros(id) on delete cascade,
  organization_id uuid not null references public.orgs(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  relationship_type text not null,
  access_scope text not null,
  status text not null default 'active',
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_provider_stewardships_scope_check
    check (access_scope in ('service_stewardship')),
  constraint asset_provider_stewardships_relationship_check
    check (relationship_type in ('servicing_dealer', 'service_provider')),
  constraint asset_provider_stewardships_status_check
    check (status in ('active', 'pending', 'revoked', 'expired'))
);

create unique index if not exists asset_provider_stewardships_active_unique_idx
  on public.asset_provider_stewardships (asset_id, keepr_pro_id, organization_id, relationship_type)
  where status = 'active';

create index if not exists asset_provider_stewardships_org_idx
  on public.asset_provider_stewardships (organization_id, status);

create index if not exists asset_provider_stewardships_asset_idx
  on public.asset_provider_stewardships (asset_id, status);

alter table public.asset_provider_stewardships enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'asset_provider_stewardships'
      and policyname = 'Owners can read provider stewardships for owned assets'
  ) then
    create policy "Owners can read provider stewardships for owned assets"
      on public.asset_provider_stewardships
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.assets a
          where a.id = asset_provider_stewardships.asset_id
            and a.owner_id = auth.uid()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'asset_provider_stewardships'
      and policyname = 'Organization members can read their provider stewardships'
  ) then
    create policy "Organization members can read their provider stewardships"
      on public.asset_provider_stewardships
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.org_members m
          where m.org_id = asset_provider_stewardships.organization_id
            and m.user_id = auth.uid()
            and coalesce(m.status, 'active') = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'asset_provider_stewardships'
      and policyname = 'Owners can manage provider stewardships for owned assets'
  ) then
    create policy "Owners can manage provider stewardships for owned assets"
      on public.asset_provider_stewardships
      for all
      to authenticated
      using (
        exists (
          select 1
          from public.assets a
          where a.id = asset_provider_stewardships.asset_id
            and a.owner_id = auth.uid()
        )
      )
      with check (
        exists (
          select 1
          from public.assets a
          where a.id = asset_provider_stewardships.asset_id
            and a.owner_id = auth.uid()
        )
      );
  end if;
end $$;

create or replace function public.keeprpro_user_can_act_for_org(
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_organization_id
      and m.user_id = p_user_id
      and coalesce(m.status, 'active') = 'active'
      and coalesce(m.role, m.member_role, 'member') in ('owner', 'admin', 'member', 'provider_member')
  );
$$;

create or replace function public.get_my_keeprpro_contexts()
returns table (
  acting_user_id uuid,
  organization_id uuid,
  organization_name text,
  organization_slug text,
  organization_type text,
  member_role text,
  keepr_pro_id uuid,
  keepr_pro_slug text,
  display_name text,
  profile_status text,
  claimed_state text,
  logo_url text,
  avatar_url text,
  header_image_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() as acting_user_id,
    o.id as organization_id,
    coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.name) as organization_name,
    o.slug as organization_slug,
    coalesce(o.organization_type, o.org_type) as organization_type,
    coalesce(m.role, m.member_role, 'member') as member_role,
    kp.id as keepr_pro_id,
    kp.slug as keepr_pro_slug,
    coalesce(nullif(kp.display_name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), o.name) as display_name,
    kp.profile_status,
    kp.claimed_state,
    kp.logo_url,
    kp.avatar_url,
    kp.header_image_url
  from public.org_members m
  join public.orgs o
    on o.id = m.org_id
  join public.keepr_pros kp
    on kp.organization_id = o.id
  where auth.uid() is not null
    and m.user_id = auth.uid()
    and coalesce(m.status, 'active') = 'active'
    and coalesce(o.status, 'active') = 'active'
    and coalesce(kp.profile_status, 'draft') in ('active', 'demo', 'claimed')
  order by coalesce(nullif(kp.display_name, ''), kp.name);
$$;

create or replace function public.get_keeprpro_connected_assets(
  p_organization_id uuid default null
)
returns table (
  acting_user_id uuid,
  organization_id uuid,
  keepr_pro_id uuid,
  stewardship_id uuid,
  relationship_type text,
  access_scope text,
  asset_id uuid,
  asset_name text,
  asset_type text,
  kac_id text,
  owner_display_name text,
  year integer,
  make text,
  model text,
  length_feet numeric,
  engine_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() as acting_user_id,
    aps.organization_id,
    aps.keepr_pro_id,
    aps.id as stewardship_id,
    aps.relationship_type,
    aps.access_scope,
    a.id as asset_id,
    a.name as asset_name,
    a.type as asset_type,
    a.kac_id,
    coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), p.email, 'Owner') as owner_display_name,
    a.year,
    a.make,
    a.model,
    a.length_feet,
    a.engine_type
  from public.asset_provider_stewardships aps
  join public.assets a
    on a.id = aps.asset_id
  left join public.profiles p
    on p.id = a.owner_id
  where auth.uid() is not null
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and (aps.starts_at is null or aps.starts_at <= now())
    and (aps.ends_at is null or aps.ends_at > now())
    and (p_organization_id is null or aps.organization_id = p_organization_id)
    and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
    and a.deleted_at is null
  order by a.name;
$$;

create or replace function public.get_keeprpro_stewardship_asset(
  p_asset_id uuid,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_systems jsonb;
  v_service_records jsonb;
  v_actions jsonb;
begin
  select
    aps.id as stewardship_id,
    aps.organization_id,
    aps.keepr_pro_id,
    aps.relationship_type,
    aps.access_scope,
    o.slug as organization_slug,
    coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.name) as organization_name,
    kp.slug as keepr_pro_slug,
    coalesce(nullif(kp.display_name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), o.name) as keepr_pro_name,
    a.id as asset_id,
    a.name as asset_name,
    a.type as asset_type,
    a.kac_id,
    a.year,
    a.make,
    a.model,
    a.hull_material,
    a.length_feet,
    a.engine_type,
    a.engine_hours,
    coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), p.email, 'Owner') as owner_display_name
  into v_row
  from public.asset_provider_stewardships aps
  join public.assets a
    on a.id = aps.asset_id
  join public.orgs o
    on o.id = aps.organization_id
  join public.keepr_pros kp
    on kp.id = aps.keepr_pro_id
  left join public.profiles p
    on p.id = a.owner_id
  where auth.uid() is not null
    and aps.asset_id = p_asset_id
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and (aps.starts_at is null or aps.starts_at <= now())
    and (aps.ends_at is null or aps.ends_at > now())
    and (p_organization_id is null or aps.organization_id = p_organization_id)
    and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
    and a.deleted_at is null
  limit 1;

  if v_row.asset_id is null then
    return null;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'system_type', s.system_type,
        'status', s.status,
        'lifecycle_status', s.lifecycle_status,
        'last_service_date', s.last_service_date,
        'next_service_date', s.next_service_date
      )
      order by s.name
    ),
    '[]'::jsonb
  )
  into v_systems
  from public.systems s
  where s.asset_id = v_row.asset_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', sr.id,
        'title', sr.title,
        'service_type', sr.service_type,
        'category', sr.category,
        'performed_at', sr.performed_at,
        'verification_status', sr.verification_status
      )
      order by sr.performed_at desc nulls last, sr.created_at desc
    ),
    '[]'::jsonb
  )
  into v_service_records
  from public.service_records sr
  where sr.asset_id = v_row.asset_id
    and sr.keepr_pro_id = v_row.keepr_pro_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'notes', r.notes,
        'due_at', r.due_at,
        'status', r.status,
        'is_urgent', r.is_urgent,
        'provider_target', r.extra_metadata -> 'provider_target'
      )
      order by r.due_at asc nulls last, r.created_at desc
    ),
    '[]'::jsonb
  )
  into v_actions
  from public.reminders r
  where r.asset_id = v_row.asset_id
    and coalesce(r.status, 'open') not in ('completed', 'deleted', 'archived')
    and (
      r.preferred_provider_id = v_row.keepr_pro_id
      or r.extra_metadata #>> '{provider_target,id}' = v_row.keepr_pro_id::text
      or r.extra_metadata #>> '{provider_target,organization_id}' = v_row.organization_id::text
    );

  return jsonb_build_object(
    'view_label', 'Stewardship View · ' || v_row.organization_name,
    'relationship_label', case
      when v_row.relationship_type = 'servicing_dealer' then 'Servicing dealer'
      else initcap(replace(v_row.relationship_type, '_', ' '))
    end,
    'acting_user_id', auth.uid(),
    'organization', jsonb_build_object(
      'id', v_row.organization_id,
      'name', v_row.organization_name,
      'slug', v_row.organization_slug
    ),
    'keepr_pro', jsonb_build_object(
      'id', v_row.keepr_pro_id,
      'name', v_row.keepr_pro_name,
      'slug', v_row.keepr_pro_slug
    ),
    'stewardship', jsonb_build_object(
      'id', v_row.stewardship_id,
      'relationship_type', v_row.relationship_type,
      'access_scope', v_row.access_scope
    ),
    'asset', jsonb_build_object(
      'id', v_row.asset_id,
      'name', v_row.asset_name,
      'type', v_row.asset_type,
      'kac_id', v_row.kac_id,
      'owner_display_name', v_row.owner_display_name,
      'year', v_row.year,
      'make', v_row.make,
      'model', v_row.model,
      'hull_material', v_row.hull_material,
      'length_feet', v_row.length_feet,
      'engine_type', v_row.engine_type,
      'engine_hours', v_row.engine_hours
    ),
    'systems', v_systems,
    'service_records', v_service_records,
    'actions', v_actions
  );
end;
$$;

create or replace function public.get_public_keeprpro_profile(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', kp.id,
    'slug', kp.slug,
    'display_name', coalesce(nullif(kp.display_name, ''), kp.name),
    'category', kp.category,
    'logo_url', kp.logo_url,
    'avatar_url', kp.avatar_url,
    'header_image_url', kp.header_image_url,
    'short_description', kp.short_description,
    'phone', kp.phone,
    'email', kp.email,
    'website', kp.website,
    'location', kp.location,
    'claimed_state', kp.claimed_state,
    'profile_status', kp.profile_status,
    'organization', jsonb_build_object(
      'id', o.id,
      'name', coalesce(nullif(o.display_name, ''), o.name),
      'slug', o.slug
    )
  )
  from public.keepr_pros kp
  left join public.orgs o
    on o.id = kp.organization_id
  where lower(kp.slug) = lower(p_slug)
    and coalesce(kp.profile_status, 'draft') in ('active', 'demo', 'claimed')
  limit 1;
$$;

grant execute on function public.keeprpro_user_can_act_for_org(uuid, uuid) to authenticated;
grant execute on function public.get_my_keeprpro_contexts() to authenticated;
grant execute on function public.get_keeprpro_connected_assets(uuid) to authenticated;
grant execute on function public.get_keeprpro_stewardship_asset(uuid, uuid) to authenticated;
grant execute on function public.get_public_keeprpro_profile(text) to anon, authenticated;

do $$
declare
  v_wilson_org_id uuid := '6ad2fe13-c1b5-40c7-bb2f-6d1c454e0a8d';
  v_wilson_pro_id uuid := 'b570b6b3-6c44-4925-a44e-d39bb22f2816';
  v_harris_asset_id uuid := '9733c254-579b-47ab-8b51-593b1d44f8fa';
  v_andy_user_id uuid := 'b508214b-f076-4526-b126-7fc85a2297f2';
  v_wilson_demo_user_id uuid := '770e2b29-4f6b-4959-8528-aba69fe4a8f7';
begin
  insert into public.orgs (
    id,
    name,
    display_name,
    slug,
    org_type,
    organization_type,
    owner_user_id,
    status,
    created_at,
    updated_at
  )
  values (
    v_wilson_org_id,
    'Wilson Marine',
    'Wilson Marine',
    'wilsonmarine',
    'keeprpro',
    'keeprpro',
    v_wilson_demo_user_id,
    'active',
    now(),
    now()
  )
  on conflict (id) do update
    set name = excluded.name,
        display_name = excluded.display_name,
        slug = excluded.slug,
        org_type = excluded.org_type,
        organization_type = excluded.organization_type,
        owner_user_id = excluded.owner_user_id,
        status = excluded.status,
        updated_at = now();

  if exists (select 1 from public.profiles where id = v_wilson_demo_user_id) then
    insert into public.org_members (
      org_id,
      user_id,
      member_role,
      role,
      status,
      created_at,
      joined_at
    )
    values (
      v_wilson_org_id,
      v_wilson_demo_user_id,
      'owner',
      'owner',
      'active',
      now(),
      now()
    )
    on conflict (org_id, user_id) do update
      set member_role = excluded.member_role,
          role = excluded.role,
          status = excluded.status,
          joined_at = coalesce(public.org_members.joined_at, excluded.joined_at);
  end if;

  update public.keepr_pros
  set
    organization_id = v_wilson_org_id,
    slug = 'wilsonmarine',
    display_name = coalesce(nullif(display_name, ''), name, 'Wilson Marine'),
    short_description = coalesce(
      nullif(short_description, ''),
      'Marine service partner for the Harris-Wilson stewardship demo.'
    ),
    claimed_state = coalesce(nullif(claimed_state, ''), 'demo_claimable'),
    profile_status = 'demo',
    source_metadata = coalesce(source_metadata, '{}'::jsonb) || jsonb_build_object(
      'preserved_keepr_pro_id',
      v_wilson_pro_id,
      'seeded_for',
      'harris_wilson_demo'
    ),
    updated_at = now()
  where id = v_wilson_pro_id;

  insert into public.asset_provider_stewardships (
    id,
    asset_id,
    keepr_pro_id,
    organization_id,
    owner_id,
    relationship_type,
    access_scope,
    status,
    starts_at,
    created_by,
    created_at,
    updated_at
  )
  values (
    '2f3c6b9e-5c3a-45c2-b4a7-3db30a911781',
    v_harris_asset_id,
    v_wilson_pro_id,
    v_wilson_org_id,
    v_andy_user_id,
    'servicing_dealer',
    'service_stewardship',
    'active',
    now(),
    v_andy_user_id,
    now(),
    now()
  )
  on conflict (id) do update
    set asset_id = excluded.asset_id,
        keepr_pro_id = excluded.keepr_pro_id,
        organization_id = excluded.organization_id,
        owner_id = excluded.owner_id,
        relationship_type = excluded.relationship_type,
        access_scope = excluded.access_scope,
        status = excluded.status,
        starts_at = excluded.starts_at,
        created_by = excluded.created_by,
        updated_at = now();
end $$;
