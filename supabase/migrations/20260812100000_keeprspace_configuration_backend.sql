-- KeeprSpace / KRM organization configuration foundation.
-- Additive only: canonical orgs/relationships stay the source of truth.

alter table public.orgs
  add column if not exists authority_state text not null default 'org_managed',
  add column if not exists source_type text,
  add column if not exists source_name text,
  add column if not exists source_url text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

alter table public.orgs
  drop constraint if exists orgs_authority_state_check;

alter table public.orgs
  add constraint orgs_authority_state_check
  check (authority_state in (
    'keepr_seeded',
    'public_source_reported',
    'org_managed',
    'org_confirmed',
    'counterparty_confirmed',
    'evidence_verified',
    'disputed',
    'superseded'
  ));

alter table public.org_relationships
  add column if not exists authority_state text not null default 'source_reported',
  add column if not exists source_name text,
  add column if not exists source_url text;

alter table public.org_relationships
  drop constraint if exists org_relationships_type_check;

alter table public.org_relationships
  add constraint org_relationships_type_check
  check (relationship_type in (
    'authorized_dealer',
    'dealer_network_member',
    'oem_partner',
    'represented_brand',
    'brand_reference',
    'service_partner',
    'sales_partner',
    'marina_partner'
  ));

alter table public.org_relationships
  drop constraint if exists org_relationships_evidence_state_check;

alter table public.org_relationships
  add constraint org_relationships_evidence_state_check
  check (evidence_state in (
    'source_reported',
    'public_source_reported',
    'keepr_seeded',
    'oem_published',
    'org_confirmed',
    'counterparty_confirmed',
    'evidence_verified',
    'superseded',
    'disputed'
  ));

alter table public.org_relationships
  drop constraint if exists org_relationships_authority_state_check;

alter table public.org_relationships
  add constraint org_relationships_authority_state_check
  check (authority_state in (
    'keepr_seeded',
    'public_source_reported',
    'source_reported',
    'org_confirmed',
    'counterparty_confirmed',
    'evidence_verified',
    'disputed',
    'superseded'
  ));

create or replace function public.keeprspace_slugify(p_value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.keeprspace_jsonb_text_array(p_value jsonb)
returns text[]
language sql
immutable
as $$
  select case
    when p_value is null then null
    when jsonb_typeof(p_value) = 'array' then (
      select coalesce(array_agg(value), '{}'::text[])
      from jsonb_array_elements_text(p_value)
    )
    when jsonb_typeof(p_value) = 'string' then array[trim(both '"' from p_value::text)]
    else null
  end;
$$;

create or replace function public.keeprspace_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

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

create or replace function public.keeprspace_user_can_manage_org(p_user_id uuid, p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.keeprspace_user_can_seed_org(p_user_id)
    or exists (
      select 1
      from public.orgs o
      where o.id = p_org_id
        and o.owner_user_id = p_user_id
    )
    or exists (
      select 1
      from public.org_members m
      where m.user_id = p_user_id
        and m.org_id = p_org_id
        and coalesce(m.status, 'active') = 'active'
        and coalesce(m.role, m.member_role, '') in ('owner', 'admin', 'manager')
    );
$$;

create table if not exists public.org_teams (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  slug text not null,
  team_type text,
  description text,
  status text not null default 'active',
  authority_state text not null default 'org_managed',
  source_type text,
  source_name text,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_teams_status_check check (status in ('active', 'inactive', 'archived')),
  constraint org_teams_authority_state_check check (authority_state in (
    'keepr_seeded',
    'public_source_reported',
    'org_managed',
    'org_confirmed',
    'counterparty_confirmed',
    'evidence_verified',
    'disputed',
    'superseded'
  ))
);

create unique index if not exists org_teams_org_slug_uidx
  on public.org_teams (organization_id, lower(slug));

create index if not exists org_teams_org_status_idx
  on public.org_teams (organization_id, status);

drop trigger if exists org_teams_touch_updated_at on public.org_teams;
create trigger org_teams_touch_updated_at
  before update on public.org_teams
  for each row execute function public.keeprspace_touch_updated_at();

create table if not exists public.org_member_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  org_team_id uuid references public.org_teams(id) on delete cascade,
  org_location_id uuid references public.org_locations(id) on delete cascade,
  assignment_role text,
  is_primary boolean not null default false,
  status text not null default 'active',
  authority_state text not null default 'org_managed',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_member_assignments_target_check check (org_team_id is not null or org_location_id is not null),
  constraint org_member_assignments_status_check check (status in ('active', 'inactive', 'archived')),
  constraint org_member_assignments_authority_state_check check (authority_state in (
    'keepr_seeded',
    'public_source_reported',
    'org_managed',
    'org_confirmed',
    'counterparty_confirmed',
    'evidence_verified',
    'disputed',
    'superseded'
  ))
);

create unique index if not exists org_member_assignments_active_uidx
  on public.org_member_assignments (
    organization_id,
    user_id,
    coalesce(org_team_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(org_location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(assignment_role, '')
  )
  where status = 'active';

create index if not exists org_member_assignments_org_idx
  on public.org_member_assignments (organization_id, status);

drop trigger if exists org_member_assignments_touch_updated_at on public.org_member_assignments;
create trigger org_member_assignments_touch_updated_at
  before update on public.org_member_assignments
  for each row execute function public.keeprspace_touch_updated_at();

create table if not exists public.org_service_offerings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete cascade,
  keepr_pro_id uuid references public.keepr_pros(id) on delete set null,
  name text not null,
  slug text not null,
  service_type text,
  description text,
  owner_facing_label text,
  owner_facing_description text,
  status text not null default 'active',
  visibility text not null default 'owner_portal',
  relationship_purposes text[] not null default '{}'::text[],
  supported_asset_types text[] not null default '{}'::text[],
  authority_state text not null default 'org_managed',
  source_type text,
  source_name text,
  source_url text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_service_offerings_status_check check (status in ('active', 'disabled', 'archived')),
  constraint org_service_offerings_visibility_check check (visibility in ('internal', 'owner_portal', 'public')),
  constraint org_service_offerings_authority_state_check check (authority_state in (
    'keepr_seeded',
    'public_source_reported',
    'org_managed',
    'org_confirmed',
    'counterparty_confirmed',
    'evidence_verified',
    'disputed',
    'superseded'
  ))
);

create unique index if not exists org_service_offerings_org_slug_uidx
  on public.org_service_offerings (organization_id, lower(slug));

create index if not exists org_service_offerings_org_status_idx
  on public.org_service_offerings (organization_id, status);

drop trigger if exists org_service_offerings_touch_updated_at on public.org_service_offerings;
create trigger org_service_offerings_touch_updated_at
  before update on public.org_service_offerings
  for each row execute function public.keeprspace_touch_updated_at();

alter table public.org_teams enable row level security;
alter table public.org_member_assignments enable row level security;
alter table public.org_service_offerings enable row level security;

drop policy if exists "Org members read teams" on public.org_teams;
create policy "Org members read teams"
  on public.org_teams for select
  to authenticated
  using (
    public.keeprspace_user_is_org_member(auth.uid(), organization_id)
    or public.keeprspace_user_can_seed_org(auth.uid())
  );

drop policy if exists "Org admins manage teams" on public.org_teams;
create policy "Org admins manage teams"
  on public.org_teams for all
  to authenticated
  using (public.keeprspace_user_can_manage_org(auth.uid(), organization_id))
  with check (public.keeprspace_user_can_manage_org(auth.uid(), organization_id));

drop policy if exists "Org members read member assignments" on public.org_member_assignments;
create policy "Org members read member assignments"
  on public.org_member_assignments for select
  to authenticated
  using (
    public.keeprspace_user_is_org_member(auth.uid(), organization_id)
    or public.keeprspace_user_can_seed_org(auth.uid())
  );

drop policy if exists "Org admins manage member assignments" on public.org_member_assignments;
create policy "Org admins manage member assignments"
  on public.org_member_assignments for all
  to authenticated
  using (public.keeprspace_user_can_manage_org(auth.uid(), organization_id))
  with check (public.keeprspace_user_can_manage_org(auth.uid(), organization_id));

drop policy if exists "Org members read service offerings" on public.org_service_offerings;
create policy "Org members read service offerings"
  on public.org_service_offerings for select
  to authenticated
  using (
    public.keeprspace_user_is_org_member(auth.uid(), organization_id)
    or public.keeprspace_user_can_seed_org(auth.uid())
  );

drop policy if exists "Org admins manage service offerings" on public.org_service_offerings;
create policy "Org admins manage service offerings"
  on public.org_service_offerings for all
  to authenticated
  using (public.keeprspace_user_can_manage_org(auth.uid(), organization_id))
  with check (public.keeprspace_user_can_manage_org(auth.uid(), organization_id));

grant select, insert, update on public.org_teams to authenticated;
grant select, insert, update on public.org_member_assignments to authenticated;
grant select, insert, update on public.org_service_offerings to authenticated;

create or replace function public.get_keeprspace_org_config(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org public.orgs;
  v_keepr_pro public.keepr_pros;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if not (
    public.keeprspace_user_is_org_member(auth.uid(), p_organization_id)
    or public.keeprspace_user_can_seed_org(auth.uid())
  ) then
    raise exception 'not authorized to read this organization configuration';
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

  return jsonb_build_object(
    'organization', to_jsonb(v_org),
    'keepr_pro', case when v_keepr_pro.id is null then null else to_jsonb(v_keepr_pro) end,
    'can_manage', public.keeprspace_user_can_manage_org(auth.uid(), p_organization_id),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.org_id::text || ':' || m.user_id::text,
        'user_id', m.user_id,
        'org_id', m.org_id,
        'role', coalesce(m.role, m.member_role, 'member'),
        'status', coalesce(m.status, 'active'),
        'joined_at', m.joined_at,
        'profile', jsonb_build_object(
          'id', p.id,
          'email', p.email,
          'full_name', coalesce(p.full_name, p.email)
        )
      ) order by coalesce(p.full_name, p.email))
      from public.org_members m
      left join public.profiles p on p.id = m.user_id
      where m.org_id = p_organization_id
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(to_jsonb(l) order by coalesce(l.name, l.city, l.address_line1))
      from public.org_locations l
      where l.organization_id = p_organization_id
    ), '[]'::jsonb),
    'teams', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.name)
      from public.org_teams t
      where t.organization_id = p_organization_id
    ), '[]'::jsonb),
    'member_assignments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'organization_id', a.organization_id,
        'user_id', a.user_id,
        'org_team_id', a.org_team_id,
        'org_location_id', a.org_location_id,
        'assignment_role', a.assignment_role,
        'is_primary', a.is_primary,
        'status', a.status,
        'authority_state', a.authority_state,
        'member_name', coalesce(p.full_name, p.email),
        'member_email', p.email,
        'team_name', t.name,
        'location_name', l.name
      ) order by coalesce(p.full_name, p.email), t.name, l.name)
      from public.org_member_assignments a
      left join public.profiles p on p.id = a.user_id
      left join public.org_teams t on t.id = a.org_team_id
      left join public.org_locations l on l.id = a.org_location_id
      where a.organization_id = p_organization_id
    ), '[]'::jsonb),
    'service_offerings', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.name)
      from public.org_service_offerings s
      where s.organization_id = p_organization_id
    ), '[]'::jsonb),
    'brand_relationships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id,
        'from_org_id', r.from_org_id,
        'to_org_id', r.to_org_id,
        'relationship_type', r.relationship_type,
        'status', r.status,
        'evidence_state', r.evidence_state,
        'authority_state', r.authority_state,
        'source_type', r.metadata ->> 'source_type',
        'source_name', r.source_name,
        'source_url', r.source_url,
        'metadata', r.metadata,
        'org', jsonb_build_object(
          'id', o.id,
          'name', coalesce(o.display_name, o.name),
          'slug', o.slug,
          'organization_type', o.organization_type,
          'authority_state', o.authority_state
        )
      ) order by coalesce(o.display_name, o.name))
      from public.org_relationships r
      join public.orgs o on o.id = r.to_org_id
      where r.from_org_id = p_organization_id
        and r.relationship_type in ('represented_brand', 'brand_reference', 'authorized_dealer', 'dealer_network_member', 'oem_partner', 'service_partner', 'sales_partner', 'marina_partner')
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.upsert_keeprspace_org_profile(
  p_organization_id uuid,
  p_patch jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.keeprspace_user_can_manage_org(auth.uid(), p_organization_id) then
    raise exception 'not authorized to manage this organization';
  end if;

  update public.orgs
  set
    display_name = coalesce(nullif(p_patch ->> 'display_name', ''), display_name),
    name = coalesce(nullif(p_patch ->> 'display_name', ''), name),
    slug = coalesce(nullif(public.keeprspace_slugify(p_patch ->> 'slug'), ''), slug),
    photo_url = coalesce(nullif(p_patch ->> 'photo_url', ''), photo_url),
    team_photo_url = coalesce(nullif(p_patch ->> 'team_photo_url', ''), team_photo_url),
    workspace_capabilities = coalesce(p_patch -> 'workspace_capabilities', workspace_capabilities),
    authority_state = coalesce(nullif(p_patch ->> 'authority_state', ''), authority_state),
    source_type = coalesce(nullif(p_patch ->> 'source_type', ''), source_type),
    source_name = coalesce(nullif(p_patch ->> 'source_name', ''), source_name),
    source_url = coalesce(nullif(p_patch ->> 'source_url', ''), source_url),
    source_metadata = source_metadata || coalesce(p_patch -> 'source_metadata', '{}'::jsonb),
    updated_at = now()
  where id = p_organization_id;

  update public.keepr_pros
  set
    display_name = coalesce(nullif(p_patch ->> 'display_name', ''), display_name),
    slug = coalesce(nullif(public.keeprspace_slugify(p_patch ->> 'slug'), ''), slug),
    logo_url = coalesce(nullif(p_patch ->> 'logo_url', ''), nullif(p_patch ->> 'photo_url', ''), logo_url),
    header_image_url = coalesce(nullif(p_patch ->> 'header_image_url', ''), nullif(p_patch ->> 'team_photo_url', ''), header_image_url),
    short_description = coalesce(nullif(p_patch ->> 'short_description', ''), short_description),
    public_description = coalesce(nullif(p_patch ->> 'public_description', ''), public_description),
    phone = coalesce(nullif(p_patch ->> 'phone', ''), phone),
    email = coalesce(nullif(p_patch ->> 'email', ''), email),
    website = coalesce(nullif(p_patch ->> 'website', ''), website),
    location = coalesce(nullif(p_patch ->> 'location', ''), location),
    publish_status = coalesce(nullif(p_patch ->> 'publish_status', ''), publish_status),
    service_offerings = coalesce(p_patch -> 'service_offerings', service_offerings),
    packages = coalesce(p_patch -> 'packages', packages),
    source_metadata = source_metadata || coalesce(p_patch -> 'source_metadata', '{}'::jsonb),
    updated_at = now()
  where organization_id = p_organization_id;

  return public.get_keeprspace_org_config(p_organization_id);
end;
$$;

create or replace function public.upsert_keeprspace_org_location(
  p_organization_id uuid,
  p_location jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_location_id uuid;
begin
  if not public.keeprspace_user_can_manage_org(auth.uid(), p_organization_id) then
    raise exception 'not authorized to manage this organization';
  end if;

  v_location_id := nullif(p_location ->> 'id', '')::uuid;

  if v_location_id is null then
    insert into public.org_locations (
      organization_id, name, location_type, address_line1, address_line2,
      city, region, postal_code, country, phone, email, website,
      status, source_name, source_url, metadata, created_by
    )
    values (
      p_organization_id,
      nullif(p_location ->> 'name', ''),
      case
        when nullif(p_location ->> 'location_type', '') in (
          'dealer_location', 'marina', 'service_center', 'showroom',
          'delivery_center', 'factory', 'office', 'other'
        ) then nullif(p_location ->> 'location_type', '')
        else 'other'
      end,
      nullif(p_location ->> 'address_line1', ''),
      nullif(p_location ->> 'address_line2', ''),
      nullif(p_location ->> 'city', ''),
      nullif(p_location ->> 'region', ''),
      nullif(p_location ->> 'postal_code', ''),
      coalesce(nullif(p_location ->> 'country', ''), 'US'),
      nullif(p_location ->> 'phone', ''),
      nullif(p_location ->> 'email', ''),
      nullif(p_location ->> 'website', ''),
      coalesce(nullif(p_location ->> 'status', ''), 'active'),
      nullif(p_location ->> 'source_name', ''),
      nullif(p_location ->> 'source_url', ''),
      coalesce(p_location -> 'metadata', '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object('source_type', nullif(p_location ->> 'source_type', ''))),
      auth.uid()
    );
  else
    update public.org_locations
    set
      name = coalesce(nullif(p_location ->> 'name', ''), name),
      location_type = coalesce(
        case
          when nullif(p_location ->> 'location_type', '') in (
            'dealer_location', 'marina', 'service_center', 'showroom',
            'delivery_center', 'factory', 'office', 'other'
          ) then nullif(p_location ->> 'location_type', '')
          else null
        end,
        location_type
      ),
      address_line1 = coalesce(nullif(p_location ->> 'address_line1', ''), address_line1),
      address_line2 = coalesce(nullif(p_location ->> 'address_line2', ''), address_line2),
      city = coalesce(nullif(p_location ->> 'city', ''), city),
      region = coalesce(nullif(p_location ->> 'region', ''), region),
      postal_code = coalesce(nullif(p_location ->> 'postal_code', ''), postal_code),
      country = coalesce(nullif(p_location ->> 'country', ''), country),
      phone = coalesce(nullif(p_location ->> 'phone', ''), phone),
      email = coalesce(nullif(p_location ->> 'email', ''), email),
      website = coalesce(nullif(p_location ->> 'website', ''), website),
      status = coalesce(nullif(p_location ->> 'status', ''), status),
      source_name = coalesce(nullif(p_location ->> 'source_name', ''), source_name),
      source_url = coalesce(nullif(p_location ->> 'source_url', ''), source_url),
      metadata = metadata
        || coalesce(p_location -> 'metadata', '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object('source_type', nullif(p_location ->> 'source_type', ''))),
      updated_at = now()
    where id = v_location_id
      and organization_id = p_organization_id;
  end if;

  return public.get_keeprspace_org_config(p_organization_id);
end;
$$;

create or replace function public.upsert_keeprspace_org_team(
  p_organization_id uuid,
  p_team jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team_id uuid;
  v_name text;
  v_slug text;
begin
  if not public.keeprspace_user_can_manage_org(auth.uid(), p_organization_id) then
    raise exception 'not authorized to manage this organization';
  end if;

  v_team_id := nullif(p_team ->> 'id', '')::uuid;
  v_name := nullif(p_team ->> 'name', '');
  v_slug := coalesce(nullif(public.keeprspace_slugify(p_team ->> 'slug'), ''), public.keeprspace_slugify(v_name));

  if v_team_id is null then
    insert into public.org_teams (
      organization_id, name, slug, team_type, description, status,
      authority_state, source_type, source_name, source_url, metadata, created_by
    )
    values (
      p_organization_id, v_name, v_slug,
      nullif(p_team ->> 'team_type', ''),
      nullif(p_team ->> 'description', ''),
      coalesce(nullif(p_team ->> 'status', ''), 'active'),
      coalesce(nullif(p_team ->> 'authority_state', ''), 'org_managed'),
      nullif(p_team ->> 'source_type', ''),
      nullif(p_team ->> 'source_name', ''),
      nullif(p_team ->> 'source_url', ''),
      coalesce(p_team -> 'metadata', '{}'::jsonb),
      auth.uid()
    )
    on conflict (organization_id, (lower(slug))) do update
      set name = excluded.name,
          team_type = excluded.team_type,
          description = excluded.description,
          status = excluded.status,
          authority_state = excluded.authority_state,
          metadata = public.org_teams.metadata || excluded.metadata,
          updated_at = now();
  else
    update public.org_teams
    set
      name = coalesce(v_name, name),
      slug = coalesce(v_slug, slug),
      team_type = coalesce(nullif(p_team ->> 'team_type', ''), team_type),
      description = coalesce(nullif(p_team ->> 'description', ''), description),
      status = coalesce(nullif(p_team ->> 'status', ''), status),
      authority_state = coalesce(nullif(p_team ->> 'authority_state', ''), authority_state),
      metadata = metadata || coalesce(p_team -> 'metadata', '{}'::jsonb),
      updated_at = now()
    where id = v_team_id
      and organization_id = p_organization_id;
  end if;

  return public.get_keeprspace_org_config(p_organization_id);
end;
$$;

create or replace function public.upsert_keeprspace_org_member_assignment(
  p_organization_id uuid,
  p_assignment jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_assignment_id uuid;
  v_user_id uuid;
  v_team_id uuid;
  v_location_id uuid;
begin
  if not public.keeprspace_user_can_manage_org(auth.uid(), p_organization_id) then
    raise exception 'not authorized to manage this organization';
  end if;

  v_assignment_id := nullif(p_assignment ->> 'id', '')::uuid;
  v_user_id := nullif(p_assignment ->> 'user_id', '')::uuid;
  v_team_id := nullif(p_assignment ->> 'org_team_id', '')::uuid;
  v_location_id := nullif(p_assignment ->> 'org_location_id', '')::uuid;

  if v_user_id is null then
    raise exception 'user_id is required';
  end if;

  if not exists (
    select 1 from public.org_members m
    where m.user_id = v_user_id
      and m.org_id = p_organization_id
      and coalesce(m.status, 'active') = 'active'
  ) then
    raise exception 'member must belong to the organization before assignment';
  end if;

  if v_assignment_id is null then
    insert into public.org_member_assignments (
      organization_id, user_id, org_team_id, org_location_id, assignment_role,
      is_primary, status, authority_state, metadata, created_by
    )
    values (
      p_organization_id, v_user_id, v_team_id, v_location_id,
      nullif(p_assignment ->> 'assignment_role', ''),
      coalesce((p_assignment ->> 'is_primary')::boolean, false),
      coalesce(nullif(p_assignment ->> 'status', ''), 'active'),
      coalesce(nullif(p_assignment ->> 'authority_state', ''), 'org_managed'),
      coalesce(p_assignment -> 'metadata', '{}'::jsonb),
      auth.uid()
    )
    on conflict (
      organization_id,
      user_id,
      (coalesce(org_team_id, '00000000-0000-0000-0000-000000000000'::uuid)),
      (coalesce(org_location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
      (coalesce(assignment_role, ''))
    ) where status = 'active'
    do update
      set is_primary = excluded.is_primary,
          authority_state = excluded.authority_state,
          metadata = public.org_member_assignments.metadata || excluded.metadata,
          updated_at = now();
  else
    update public.org_member_assignments
    set
      org_team_id = v_team_id,
      org_location_id = v_location_id,
      assignment_role = coalesce(nullif(p_assignment ->> 'assignment_role', ''), assignment_role),
      is_primary = coalesce((p_assignment ->> 'is_primary')::boolean, is_primary),
      status = coalesce(nullif(p_assignment ->> 'status', ''), status),
      authority_state = coalesce(nullif(p_assignment ->> 'authority_state', ''), authority_state),
      metadata = metadata || coalesce(p_assignment -> 'metadata', '{}'::jsonb),
      updated_at = now()
    where id = v_assignment_id
      and organization_id = p_organization_id;
  end if;

  return public.get_keeprspace_org_config(p_organization_id);
end;
$$;

create or replace function public.upsert_keeprspace_org_service_offering(
  p_organization_id uuid,
  p_service jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_service_id uuid;
  v_name text;
  v_slug text;
begin
  if not public.keeprspace_user_can_manage_org(auth.uid(), p_organization_id) then
    raise exception 'not authorized to manage this organization';
  end if;

  v_service_id := nullif(p_service ->> 'id', '')::uuid;
  v_name := nullif(p_service ->> 'name', '');
  v_slug := coalesce(nullif(public.keeprspace_slugify(p_service ->> 'slug'), ''), public.keeprspace_slugify(v_name));

  if v_service_id is null then
    insert into public.org_service_offerings (
      organization_id, keepr_pro_id, name, slug, service_type, description,
      owner_facing_label, owner_facing_description, status, visibility,
      relationship_purposes, supported_asset_types, authority_state,
      source_type, source_name, source_url, metadata, created_by
    )
    values (
      p_organization_id,
      nullif(p_service ->> 'keepr_pro_id', '')::uuid,
      v_name,
      v_slug,
      nullif(p_service ->> 'service_type', ''),
      nullif(p_service ->> 'description', ''),
      coalesce(nullif(p_service ->> 'owner_facing_label', ''), v_name),
      nullif(p_service ->> 'owner_facing_description', ''),
      coalesce(nullif(p_service ->> 'status', ''), 'active'),
      coalesce(nullif(p_service ->> 'visibility', ''), 'owner_portal'),
      coalesce(public.keeprspace_jsonb_text_array(p_service -> 'relationship_purposes'), '{}'::text[]),
      coalesce(public.keeprspace_jsonb_text_array(p_service -> 'supported_asset_types'), '{}'::text[]),
      coalesce(nullif(p_service ->> 'authority_state', ''), 'org_managed'),
      nullif(p_service ->> 'source_type', ''),
      nullif(p_service ->> 'source_name', ''),
      nullif(p_service ->> 'source_url', ''),
      coalesce(p_service -> 'metadata', '{}'::jsonb),
      auth.uid()
    )
    on conflict (organization_id, (lower(slug))) do update
      set name = excluded.name,
          service_type = excluded.service_type,
          description = excluded.description,
          owner_facing_label = excluded.owner_facing_label,
          owner_facing_description = excluded.owner_facing_description,
          status = excluded.status,
          visibility = excluded.visibility,
          relationship_purposes = excluded.relationship_purposes,
          supported_asset_types = excluded.supported_asset_types,
          authority_state = excluded.authority_state,
          source_type = excluded.source_type,
          source_name = excluded.source_name,
          source_url = excluded.source_url,
          metadata = public.org_service_offerings.metadata || excluded.metadata,
          updated_at = now();
  else
    update public.org_service_offerings
    set
      name = coalesce(v_name, name),
      slug = coalesce(v_slug, slug),
      service_type = coalesce(nullif(p_service ->> 'service_type', ''), service_type),
      description = coalesce(nullif(p_service ->> 'description', ''), description),
      owner_facing_label = coalesce(nullif(p_service ->> 'owner_facing_label', ''), owner_facing_label),
      owner_facing_description = coalesce(nullif(p_service ->> 'owner_facing_description', ''), owner_facing_description),
      status = coalesce(nullif(p_service ->> 'status', ''), status),
      visibility = coalesce(nullif(p_service ->> 'visibility', ''), visibility),
      relationship_purposes = coalesce(public.keeprspace_jsonb_text_array(p_service -> 'relationship_purposes'), relationship_purposes),
      supported_asset_types = coalesce(public.keeprspace_jsonb_text_array(p_service -> 'supported_asset_types'), supported_asset_types),
      authority_state = coalesce(nullif(p_service ->> 'authority_state', ''), authority_state),
      source_type = coalesce(nullif(p_service ->> 'source_type', ''), source_type),
      source_name = coalesce(nullif(p_service ->> 'source_name', ''), source_name),
      source_url = coalesce(nullif(p_service ->> 'source_url', ''), source_url),
      metadata = metadata || coalesce(p_service -> 'metadata', '{}'::jsonb),
      updated_at = now()
    where id = v_service_id
      and organization_id = p_organization_id;
  end if;

  return public.get_keeprspace_org_config(p_organization_id);
end;
$$;

create or replace function public.upsert_keeprspace_org_relationship(
  p_from_org_id uuid,
  p_to_org_id uuid default null,
  p_to_org_name text default null,
  p_relationship_type text default 'represented_brand',
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to_org_id uuid;
  v_to_org_name text;
  v_slug text;
  v_relationship_id uuid;
  v_status text;
  v_authority text;
begin
  if not public.keeprspace_user_can_manage_org(auth.uid(), p_from_org_id) then
    raise exception 'not authorized to manage this organization';
  end if;

  v_to_org_id := p_to_org_id;
  v_to_org_name := nullif(p_to_org_name, '');
  v_status := coalesce(nullif(p_payload ->> 'status', ''), 'source_reported');
  v_authority := coalesce(nullif(p_payload ->> 'authority_state', ''), 'public_source_reported');

  if v_to_org_id is null then
    if v_to_org_name is null then
      raise exception 'to_org_id or to_org_name is required';
    end if;

    v_slug := public.keeprspace_slugify(v_to_org_name);

    select id
    into v_to_org_id
    from public.orgs
    where lower(slug) = v_slug
       or lower(coalesce(display_name, name)) = lower(v_to_org_name)
    order by created_at asc nulls last
    limit 1;

    if v_to_org_id is null then
      insert into public.orgs (
        name, display_name, slug, organization_type, org_type, status,
        authority_state, source_type, source_name, source_url, source_metadata
      )
      values (
        v_to_org_name, v_to_org_name, v_slug, 'brand', 'organization', 'active',
        v_authority,
        nullif(p_payload ->> 'source_type', ''),
        nullif(p_payload ->> 'source_name', ''),
        nullif(p_payload ->> 'source_url', ''),
        coalesce(p_payload -> 'source_metadata', '{}'::jsonb)
      )
      returning id into v_to_org_id;
    end if;
  end if;

  select id
  into v_relationship_id
  from public.org_relationships
  where from_org_id = p_from_org_id
    and to_org_id = v_to_org_id
    and relationship_type = coalesce(nullif(p_relationship_type, ''), 'represented_brand')
    and status in ('source_reported', 'active')
  order by created_at asc
  limit 1;

  if v_relationship_id is null then
    insert into public.org_relationships (
      from_org_id, to_org_id, relationship_type, status, evidence_state,
      authority_state, source_name, source_url, metadata
    )
    values (
      p_from_org_id,
      v_to_org_id,
      coalesce(nullif(p_relationship_type, ''), 'represented_brand'),
      v_status,
      coalesce(nullif(p_payload ->> 'evidence_state', ''), v_authority),
      v_authority,
      nullif(p_payload ->> 'source_name', ''),
      nullif(p_payload ->> 'source_url', ''),
      coalesce(p_payload -> 'metadata', '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object('source_type', nullif(p_payload ->> 'source_type', '')))
    );
  else
    update public.org_relationships
    set
      status = coalesce(nullif(p_payload ->> 'status', ''), status),
      evidence_state = coalesce(nullif(p_payload ->> 'evidence_state', ''), evidence_state),
      authority_state = coalesce(nullif(p_payload ->> 'authority_state', ''), authority_state),
      source_name = coalesce(nullif(p_payload ->> 'source_name', ''), source_name),
      source_url = coalesce(nullif(p_payload ->> 'source_url', ''), source_url),
      metadata = metadata
        || coalesce(p_payload -> 'metadata', '{}'::jsonb)
        || jsonb_strip_nulls(jsonb_build_object('source_type', nullif(p_payload ->> 'source_type', ''))),
      updated_at = now()
    where id = v_relationship_id;
  end if;

  return public.get_keeprspace_org_config(p_from_org_id);
end;
$$;

grant execute on function public.keeprspace_user_can_seed_org(uuid) to authenticated;
grant execute on function public.keeprspace_user_is_org_member(uuid, uuid) to authenticated;
grant execute on function public.keeprspace_user_can_manage_org(uuid, uuid) to authenticated;
grant execute on function public.get_keeprspace_org_config(uuid) to authenticated;
grant execute on function public.upsert_keeprspace_org_profile(uuid, jsonb) to authenticated;
grant execute on function public.upsert_keeprspace_org_location(uuid, jsonb) to authenticated;
grant execute on function public.upsert_keeprspace_org_team(uuid, jsonb) to authenticated;
grant execute on function public.upsert_keeprspace_org_member_assignment(uuid, jsonb) to authenticated;
grant execute on function public.upsert_keeprspace_org_service_offering(uuid, jsonb) to authenticated;
grant execute on function public.upsert_keeprspace_org_relationship(uuid, uuid, text, text, jsonb) to authenticated;

do $$
declare
  v_wilson_org_id uuid;
  v_wilson_keepr_pro_id uuid;
  v_brand_name text;
  v_brand_org_id uuid;
  v_brand_slug text;
begin
  select id
  into v_wilson_org_id
  from public.orgs
  where lower(coalesce(slug, '')) in ('wilsonmarine', 'wilson-marine')
     or lower(coalesce(display_name, name, '')) = 'wilson marine'
  order by created_at asc nulls last
  limit 1;

  if v_wilson_org_id is null then
    insert into public.orgs (
      name, display_name, slug, organization_type, org_type, status,
      authority_state, source_type, source_name, source_url, source_metadata
    )
    values (
      'Wilson Marine',
      'Wilson Marine',
      'wilson-marine',
      'dealer',
      'organization',
      'active',
      'keepr_seeded',
      'public_website',
      'Wilson Marine public website',
      'https://www.wilsonboats.com',
      '{"seed_reason":"KeeprSpace pilot organization configuration"}'::jsonb
    )
    returning id into v_wilson_org_id;
  end if;

  select id
  into v_wilson_keepr_pro_id
  from public.keepr_pros
  where organization_id = v_wilson_org_id
  order by created_at asc nulls last
  limit 1;

  insert into public.org_teams (organization_id, name, slug, team_type, description, authority_state, source_type, source_name, source_url)
  values
    (v_wilson_org_id, 'Service', 'service', 'service', 'Service advisors and technicians', 'keepr_seeded', 'public_website', 'Wilson Marine public website', 'https://www.wilsonboats.com/service'),
    (v_wilson_org_id, 'Sales', 'sales', 'sales', 'Sales and customer delivery', 'keepr_seeded', 'public_website', 'Wilson Marine public website', 'https://www.wilsonboats.com/inventory'),
    (v_wilson_org_id, 'Parts', 'parts', 'parts', 'Parts and accessories', 'keepr_seeded', 'public_website', 'Wilson Marine public website', 'https://www.wilsonboats.com/parts'),
    (v_wilson_org_id, 'Storage', 'storage', 'storage', 'Storage and seasonal continuity', 'keepr_seeded', 'public_website', 'Wilson Marine public website', 'https://www.wilsonboats.com/service')
  on conflict (organization_id, (lower(slug))) do update
    set name = excluded.name,
        team_type = excluded.team_type,
        description = excluded.description,
        authority_state = excluded.authority_state,
        source_type = excluded.source_type,
        source_name = excluded.source_name,
        source_url = excluded.source_url,
        updated_at = now();

  insert into public.org_service_offerings (
    organization_id, keepr_pro_id, name, slug, service_type, description,
    owner_facing_label, owner_facing_description, relationship_purposes,
    supported_asset_types, authority_state, source_type, source_name, source_url
  )
  values
    (v_wilson_org_id, v_wilson_keepr_pro_id, 'Marine Service', 'marine-service', 'service', 'General marine service and repair.', 'Request Marine Service', 'Ask Wilson Marine for help with maintenance or repair.', array['service'], array['boat'], 'keepr_seeded', 'public_website', 'Wilson Marine public website', 'https://www.wilsonboats.com/service'),
    (v_wilson_org_id, v_wilson_keepr_pro_id, 'Winterization', 'winterization', 'winterization', 'Seasonal winterization support.', 'Schedule Winterization', 'Prepare your boat for winter storage.', array['service','storage'], array['boat'], 'keepr_seeded', 'public_website', 'Wilson Marine public website', 'https://www.wilsonboats.com/service'),
    (v_wilson_org_id, v_wilson_keepr_pro_id, 'Storage', 'storage', 'storage', 'Seasonal boat storage.', 'Schedule Storage', 'Coordinate storage with Wilson Marine.', array['storage'], array['boat'], 'keepr_seeded', 'public_website', 'Wilson Marine public website', 'https://www.wilsonboats.com/service'),
    (v_wilson_org_id, v_wilson_keepr_pro_id, 'Pickup and Delivery', 'pickup-delivery', 'logistics', 'Pickup and delivery coordination for service or storage.', 'Request Pickup or Delivery', 'Coordinate boat transport with Wilson Marine.', array['service','storage'], array['boat'], 'keepr_seeded', 'public_website', 'Wilson Marine public website', 'https://www.wilsonboats.com/service'),
    (v_wilson_org_id, v_wilson_keepr_pro_id, 'Fiberglass Work', 'fiberglass-work', 'repair', 'Fiberglass and body repair.', 'Request Fiberglass Repair', 'Ask Wilson Marine about fiberglass repair options.', array['service'], array['boat'], 'keepr_seeded', 'public_website', 'Wilson Marine public website', 'https://www.wilsonboats.com/service'),
    (v_wilson_org_id, v_wilson_keepr_pro_id, 'Parts and Accessories', 'parts-accessories', 'parts', 'Parts, accessories, and installation support.', 'Request Parts Support', 'Ask Wilson Marine about parts, accessories, or installation.', array['service'], array['boat'], 'keepr_seeded', 'public_website', 'Wilson Marine public website', 'https://www.wilsonboats.com/parts')
  on conflict (organization_id, (lower(slug))) do update
    set name = excluded.name,
        keepr_pro_id = coalesce(excluded.keepr_pro_id, public.org_service_offerings.keepr_pro_id),
        service_type = excluded.service_type,
        description = excluded.description,
        owner_facing_label = excluded.owner_facing_label,
        owner_facing_description = excluded.owner_facing_description,
        relationship_purposes = excluded.relationship_purposes,
        supported_asset_types = excluded.supported_asset_types,
        source_type = excluded.source_type,
        source_name = excluded.source_name,
        source_url = excluded.source_url,
        updated_at = now();

  insert into public.org_locations (
    organization_id, name, location_type, address_line1, city, region, postal_code, country,
    phone, status, source_name, source_url, metadata
  )
  values
    (v_wilson_org_id, 'Brighton', 'showroom', '6095 Grand River Ave', 'Brighton', 'MI', '48114', 'US', '(517) 546-3774', 'active', 'Wilson Marine locations page', 'https://www.wilsonboats.com/locations', '{"authority_state":"public_source_reported","source_type":"public_website"}'::jsonb),
    (v_wilson_org_id, 'Commerce Township', 'showroom', '4440 Haggerty Rd', 'Commerce Township', 'MI', '48390', 'US', '(248) 363-5240', 'active', 'Wilson Marine locations page', 'https://www.wilsonboats.com/locations', '{"authority_state":"public_source_reported","source_type":"public_website"}'::jsonb),
    (v_wilson_org_id, 'Commerce Township Parts/Service', 'service_center', '4266 Haggerty Rd', 'Commerce Township', 'MI', '48390', 'US', '(855) 919-2628', 'active', 'Wilson Marine locations page', 'https://www.wilsonboats.com/locations', '{"authority_state":"public_source_reported","source_type":"public_website"}'::jsonb),
    (v_wilson_org_id, 'Harrison Township', 'showroom', '36355 Jefferson Ave', 'Harrison Township', 'MI', '48045', 'US', '(586) 307-3180', 'active', 'Wilson Marine locations page', 'https://www.wilsonboats.com/locations', '{"authority_state":"public_source_reported","source_type":"public_website"}'::jsonb),
    (v_wilson_org_id, 'Harrison Township Parts/Service', 'service_center', '36355 Jefferson Ave', 'Harrison Township', 'MI', '48045', 'US', '(586) 307-3180', 'active', 'Wilson Marine locations page', 'https://www.wilsonboats.com/locations', '{"authority_state":"public_source_reported","source_type":"public_website"}'::jsonb),
    (v_wilson_org_id, 'Howell', 'showroom', '5866 E Grand River Ave', 'Howell', 'MI', '48843', 'US', '(517) 546-3774', 'active', 'Wilson Marine locations page', 'https://www.wilsonboats.com/locations', '{"authority_state":"public_source_reported","source_type":"public_website"}'::jsonb),
    (v_wilson_org_id, 'Howell Parts/Service', 'service_center', '1850 Dorr Rd', 'Howell', 'MI', '48843', 'US', '(800) 875-2620', 'active', 'Wilson Marine locations page', 'https://www.wilsonboats.com/locations', '{"authority_state":"public_source_reported","source_type":"public_website"}'::jsonb),
    (v_wilson_org_id, 'Wixom', 'showroom', '48500 12 Mile Rd', 'Wixom', 'MI', '48393', 'US', '(248) 319-7600', 'active', 'Wilson Marine locations page', 'https://www.wilsonboats.com/locations', '{"authority_state":"public_source_reported","source_type":"public_website"}'::jsonb),
    (v_wilson_org_id, 'Wixom Parts/Service', 'service_center', '48500 12 Mile Rd', 'Wixom', 'MI', '48393', 'US', '(248) 319-7600', 'active', 'Wilson Marine locations page', 'https://www.wilsonboats.com/locations', '{"authority_state":"public_source_reported","source_type":"public_website"}'::jsonb)
  on conflict do nothing;

  foreach v_brand_name in array array[
    'Bayliner', 'Bennington', 'Crestliner', 'Crownline', 'Harris',
    'Heyday', 'Evotti', 'Smoker Craft', 'Sportsman', 'Starweld',
    'SunChaser', 'Mercury', 'Yamaha'
  ]
  loop
    v_brand_slug := public.keeprspace_slugify(v_brand_name);

    select id
    into v_brand_org_id
    from public.orgs
    where lower(coalesce(slug, '')) = v_brand_slug
       or lower(coalesce(display_name, name, '')) = lower(v_brand_name)
    order by created_at asc nulls last
    limit 1;

    if v_brand_org_id is null then
      insert into public.orgs (
        name, display_name, slug, organization_type, org_type, status,
        authority_state, source_type, source_name, source_url, source_metadata
      )
      values (
        v_brand_name, v_brand_name, v_brand_slug, 'brand', 'organization', 'active',
        'public_source_reported', 'public_website', 'Wilson Marine brands page',
        'https://www.wilsonboats.com/brands-we-carry',
        '{"seed_reason":"Wilson represented brand reference"}'::jsonb
      )
      returning id into v_brand_org_id;
    end if;

    if not exists (
      select 1
      from public.org_relationships
      where from_org_id = v_wilson_org_id
        and to_org_id = v_brand_org_id
        and relationship_type = 'represented_brand'
        and status in ('source_reported', 'active')
    ) then
      insert into public.org_relationships (
        from_org_id, to_org_id, relationship_type, status, evidence_state,
        authority_state, source_name, source_url, metadata
      )
      values (
        v_wilson_org_id, v_brand_org_id, 'represented_brand', 'source_reported',
        'public_source_reported', 'public_source_reported',
        'Wilson Marine brands page', 'https://www.wilsonboats.com/brands-we-carry',
        '{"note":"Dealer-published represented brand. Not counterparty-confirmed by OEM.","source_type":"public_website"}'::jsonb
      );
    end if;
  end loop;
end;
$$;
