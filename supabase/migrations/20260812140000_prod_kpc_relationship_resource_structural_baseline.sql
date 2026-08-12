-- Production-safe structural baseline for canonical KPC, relationship, and
-- resource primitives.
--
-- Scope:
-- - Structural objects only.
-- - No Harris asset backfill.
-- - No marine brand seed.
-- - No broad KeeprSpace admin tables.

alter table public.orgs
  add column if not exists legal_name text,
  add column if not exists authority_state text not null default 'org_managed',
  add column if not exists source_type text,
  add column if not exists source_name text,
  add column if not exists source_url text,
  add column if not exists source_metadata jsonb not null default '{}'::jsonb,
  add column if not exists workspace_type text,
  add column if not exists workspace_capabilities jsonb not null default '[]'::jsonb,
  add column if not exists kpc_category text,
  add column if not exists kpc_capabilities jsonb not null default '[]'::jsonb;

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

alter table public.keepr_pros
  alter column user_id drop not null;

alter table public.org_members
  add column if not exists role text,
  add column if not exists status text not null default 'active';

create unique index if not exists orgs_slug_unique_idx
  on public.orgs (lower(slug))
  where slug is not null;

create or replace function public.kpc_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.kpc_normalize_text(p_value text)
returns text
language sql
immutable
as $$
  select nullif(trim(regexp_replace(lower(coalesce(p_value, '')), '\s+', ' ', 'g')), '');
$$;

create or replace function public.kpc_slugify(p_value text)
returns text
language sql
immutable
as $$
  select trim(both '-' from regexp_replace(lower(coalesce(p_value, '')), '[^a-z0-9]+', '-', 'g'));
$$;

create or replace function public.kpc_normalize_domain(p_value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(
    regexp_replace(
      regexp_replace(lower(trim(coalesce(p_value, ''))), '^https?://', ''),
      '^www\.',
      ''
    ),
    '/.*$',
    ''
  ), '');
$$;

create or replace function public.kpc_domain_from_email(p_value text)
returns text
language sql
immutable
as $$
  select case
    when position('@' in coalesce(p_value, '')) > 0 then public.kpc_normalize_domain(split_part(p_value, '@', 2))
    else null
  end;
$$;

create or replace function public.kpc_normalize_phone(p_value text)
returns text
language sql
immutable
as $$
  select nullif(regexp_replace(coalesce(p_value, ''), '[^0-9]+', '', 'g'), '');
$$;

create or replace function public.kpc_array_from_jsonb(p_value jsonb)
returns jsonb
language sql
immutable
as $$
  select case
    when jsonb_typeof(coalesce(p_value, '[]'::jsonb)) = 'array' then coalesce(p_value, '[]'::jsonb)
    when jsonb_typeof(p_value) = 'string' then jsonb_build_array(trim(both '"' from p_value::text))
    else '[]'::jsonb
  end;
$$;

create or replace function public.kpc_default_category(
  p_category text,
  p_org_type text,
  p_organization_type text,
  p_workspace_type text,
  p_categories jsonb
)
returns text
language sql
immutable
as $$
  with values_in as (
    select lower(coalesce(
      nullif(p_category, ''),
      nullif(p_org_type, ''),
      nullif(p_organization_type, ''),
      nullif(p_workspace_type, ''),
      (
        select value
        from jsonb_array_elements_text(public.kpc_array_from_jsonb(p_categories))
        limit 1
      ),
      ''
    )) as raw
  )
  select case
    when raw in ('marine', 'boat', 'boats', 'dealer', 'keeprdealer', 'keeproem', 'keeprpro', 'oem', 'manufacturer', 'marina') then 'marine'
    when raw in ('vehicle', 'vehicles', 'automotive', 'auto', 'car', 'cars') then 'automotive'
    when raw in ('home', 'home systems', 'house') then 'home'
    when raw in ('powersports', 'outdoor') then 'powersports'
    when raw in ('aviation', 'aircraft') then 'aviation'
    else 'other'
  end
  from values_in;
$$;

create or replace function public.kpc_effective_capabilities(
  p_org_type text,
  p_organization_type text,
  p_workspace_type text,
  p_workspace_capabilities jsonb,
  p_kpc_capabilities jsonb,
  p_keeprpro_categories jsonb,
  p_keeprpro_category text
)
returns jsonb
language sql
immutable
as $$
  with raw_values as (
    select value
    from jsonb_array_elements_text(public.kpc_array_from_jsonb(p_kpc_capabilities))
    union all
    select case lower(value)
      when 'manufacturer' then 'oem_builder'
      when 'model_catalog' then 'oem_builder'
      when 'dealer_network' then 'dealer'
      when 'sales' then 'dealer'
      when 'service_workspace' then 'service_provider'
      else lower(value)
    end
    from jsonb_array_elements_text(public.kpc_array_from_jsonb(p_workspace_capabilities))
    union all
    select lower(value)
    from jsonb_array_elements_text(public.kpc_array_from_jsonb(p_keeprpro_categories))
    union all
    select lower(nullif(p_keeprpro_category, ''))
    union all
    select case
      when lower(coalesce(p_org_type, p_organization_type, p_workspace_type, '')) in ('oem', 'manufacturer', 'keeproem') then 'oem_builder'
      when lower(coalesce(p_org_type, p_organization_type, p_workspace_type, '')) in ('dealer', 'keeprdealer') then 'dealer'
      when lower(coalesce(p_org_type, p_organization_type, p_workspace_type, '')) in ('keeprpro', 'service_provider') then 'service_provider'
      when lower(coalesce(p_org_type, p_organization_type, p_workspace_type, '')) = 'marina' then 'marina'
      else null
    end
  ),
  normalized as (
    select case
      when value in ('marine') then 'service_provider'
      when value in ('vehicles', 'vehicle') then 'service_provider'
      when value in ('home', 'home systems') then 'service_provider'
      when value in ('manufacturer', 'builder', 'oem') then 'oem_builder'
      when value in ('service', 'service_workspace') then 'service_provider'
      when value in ('storage') then 'storage'
      when value in ('delivery') then 'delivery'
      when value in ('dealer') then 'dealer'
      when value in ('marina') then 'marina'
      else nullif(value, '')
    end as value
    from raw_values
  )
  select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
  from normalized
  where value is not null;
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

create or replace function public.activator_user_can_act_for_org(
  p_user_id uuid,
  p_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.keeprspace_user_is_org_member(p_user_id, p_organization_id);
$$;

create table if not exists public.profile_kpc_relationships (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.orgs(id) on delete cascade,
  keepr_pro_id uuid references public.keepr_pros(id) on delete set null,
  relationship_type text not null default 'saved_provider',
  status text not null default 'active',
  is_favorite boolean not null default false,
  notes text,
  authority_state text not null default 'owner_saved',
  source_type text,
  source_name text,
  source_external_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_kpc_relationships_target_check
    check (organization_id is not null or keepr_pro_id is not null),
  constraint profile_kpc_relationships_status_check
    check (status in ('active', 'paused', 'ended', 'removed')),
  constraint profile_kpc_relationships_type_check
    check (relationship_type in ('saved_provider', 'blackbook', 'owner_added', 'contact_import'))
);

create unique index if not exists profile_kpc_relationships_active_org_uidx
  on public.profile_kpc_relationships (profile_id, organization_id, relationship_type)
  where organization_id is not null
    and status in ('active', 'paused');

create unique index if not exists profile_kpc_relationships_active_keeprpro_uidx
  on public.profile_kpc_relationships (profile_id, keepr_pro_id, relationship_type)
  where organization_id is null
    and keepr_pro_id is not null
    and status in ('active', 'paused');

create index if not exists profile_kpc_relationships_profile_idx
  on public.profile_kpc_relationships (profile_id, status);

create index if not exists profile_kpc_relationships_org_idx
  on public.profile_kpc_relationships (organization_id, status)
  where organization_id is not null;

alter table public.profile_kpc_relationships enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'profile_kpc_relationships'
      and policyname = 'Profiles can manage their saved KPC relationships'
  ) then
    create policy "Profiles can manage their saved KPC relationships"
      on public.profile_kpc_relationships
      for all
      to authenticated
      using (profile_id = auth.uid())
      with check (profile_id = auth.uid());
  end if;
end $$;

drop trigger if exists profile_kpc_relationships_touch_updated_at on public.profile_kpc_relationships;
create trigger profile_kpc_relationships_touch_updated_at
  before update on public.profile_kpc_relationships
  for each row execute function public.kpc_touch_updated_at();

create table if not exists public.org_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  location_type text not null default 'dealer_location',
  address_line1 text,
  address_line2 text,
  city text,
  region text,
  postal_code text,
  country text not null default 'US',
  latitude numeric,
  longitude numeric,
  phone text,
  email text,
  website text,
  contact_metadata jsonb not null default '{}'::jsonb,
  status text not null default 'active',
  source_name text,
  source_url text,
  external_source_id text,
  claim_state text not null default 'unclaimed',
  verification_state text not null default 'unverified',
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_locations_type_check
    check (location_type in ('dealer_location', 'marina', 'service_center', 'showroom', 'delivery_center', 'factory', 'office', 'other')),
  constraint org_locations_status_check
    check (status in ('active', 'inactive', 'closed')),
  constraint org_locations_claim_state_check
    check (claim_state in ('unclaimed', 'claimed', 'invited', 'not_applicable')),
  constraint org_locations_verification_state_check
    check (verification_state in ('unverified', 'source_reported', 'org_confirmed', 'evidence_verified'))
);

create unique index if not exists org_locations_org_name_city_region_uidx
  on public.org_locations (
    organization_id,
    lower(name),
    lower(coalesce(city, '')),
    lower(coalesce(region, ''))
  );

create index if not exists org_locations_org_status_idx
  on public.org_locations (organization_id, status);

alter table public.org_locations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'org_locations'
      and policyname = 'Active org locations are readable'
  ) then
    create policy "Active org locations are readable"
      on public.org_locations
      for select
      to authenticated
      using (
        status = 'active'
        or public.activator_user_can_act_for_org(auth.uid(), organization_id)
      );
  end if;
end $$;

create table if not exists public.asset_resources (
  id uuid primary key default gen_random_uuid(),
  resource_type text not null,
  title text not null,
  url text,
  attachment_id uuid references public.attachments(id) on delete set null,
  source_name text,
  source_platform text,
  source_url text,
  captured_at timestamptz,
  authority_state text not null default 'source_reported',
  rights_status text not null default 'private',
  applies_to_type text not null,
  applies_to_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_resources_type_check
    check (resource_type in ('oem_catalog', 'model_page', 'manual', 'dealer_listing', 'build_sheet', 'survey', 'title', 'registration', 'photo', 'service_document', 'source_snapshot', 'other')),
  constraint asset_resources_authority_check
    check (authority_state in ('model_expected', 'source_reported', 'owner_confirmed', 'dealer_confirmed', 'oem_as_built', 'oem_published', 'evidence_verified', 'service_verified', 'superseded', 'disputed')),
  constraint asset_resources_rights_check
    check (rights_status in ('private', 'owner_uploaded', 'review_permission', 'public_ok', 'restricted')),
  constraint asset_resources_applies_to_check
    check (applies_to_type in ('org', 'org_relationship', 'template', 'template_item', 'asset', 'system', 'component', 'relationship', 'workflow', 'fact', 'service_record'))
);

create index if not exists asset_resources_applies_to_idx
  on public.asset_resources (applies_to_type, applies_to_id);

create index if not exists asset_resources_attachment_idx
  on public.asset_resources (attachment_id)
  where attachment_id is not null;

create index if not exists asset_resources_normalization_key_idx
  on public.asset_resources ((metadata ->> 'normalization_key'))
  where metadata ? 'normalization_key';

alter table public.asset_resources enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'asset_resources'
      and policyname = 'Authenticated users can read asset resources'
  ) then
    create policy "Authenticated users can read asset resources"
      on public.asset_resources
      for select
      to authenticated
      using (true);
  end if;
end $$;

create table if not exists public.org_relationships (
  id uuid primary key default gen_random_uuid(),
  from_org_id uuid not null references public.orgs(id) on delete cascade,
  to_org_id uuid not null references public.orgs(id) on delete cascade,
  relationship_type text not null,
  status text not null default 'source_reported',
  source_resource_id uuid references public.asset_resources(id) on delete set null,
  evidence_state text not null default 'source_reported',
  authority_state text not null default 'source_reported',
  source_name text,
  source_url text,
  effective_from date,
  effective_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_relationships_distinct_orgs_check
    check (from_org_id <> to_org_id),
  constraint org_relationships_type_check
    check (relationship_type in ('authorized_dealer', 'dealer_network_member', 'oem_partner', 'represented_brand', 'brand_reference', 'service_partner', 'sales_partner', 'marina_partner')),
  constraint org_relationships_status_check
    check (status in ('source_reported', 'active', 'inactive', 'superseded', 'disputed')),
  constraint org_relationships_evidence_state_check
    check (evidence_state in ('source_reported', 'public_source_reported', 'keepr_seeded', 'oem_published', 'org_confirmed', 'counterparty_confirmed', 'evidence_verified', 'superseded', 'disputed')),
  constraint org_relationships_authority_state_check
    check (authority_state in ('keepr_seeded', 'public_source_reported', 'source_reported', 'org_confirmed', 'counterparty_confirmed', 'evidence_verified', 'disputed', 'superseded')),
  constraint org_relationships_effective_check
    check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

create unique index if not exists org_relationships_active_unique_idx
  on public.org_relationships (from_org_id, to_org_id, relationship_type)
  where status in ('source_reported', 'active');

create index if not exists org_relationships_from_idx
  on public.org_relationships (from_org_id, relationship_type, status);

create index if not exists org_relationships_to_idx
  on public.org_relationships (to_org_id, relationship_type, status);

alter table public.org_relationships enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'org_relationships'
      and policyname = 'Active org relationships are readable'
  ) then
    create policy "Active org relationships are readable"
      on public.org_relationships
      for select
      to authenticated
      using (
        status in ('source_reported', 'active')
        or public.activator_user_can_act_for_org(auth.uid(), from_org_id)
        or public.activator_user_can_act_for_org(auth.uid(), to_org_id)
      );
  end if;
end $$;

create table if not exists public.asset_relationships (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  organization_id uuid references public.orgs(id) on delete cascade,
  org_location_id uuid references public.org_locations(id) on delete set null,
  keepr_pro_id uuid references public.keepr_pros(id) on delete set null,
  user_id uuid references public.profiles(id) on delete cascade,
  relationship_type text not null,
  status text not null default 'pending',
  access_scope text not null default 'none',
  claim_state text not null default 'unclaimed_org',
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  initiated_by_user_id uuid references public.profiles(id) on delete set null,
  initiated_by_org_id uuid references public.orgs(id) on delete set null,
  source_resource_id uuid references public.asset_resources(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_relationships_party_check
    check (organization_id is not null or user_id is not null or keepr_pro_id is not null),
  constraint asset_relationships_location_org_check
    check (org_location_id is null or organization_id is not null),
  constraint asset_relationships_type_check
    check (relationship_type in ('owner', 'steward', 'oem', 'selling_dealer', 'delivery_dealer', 'servicing_dealer', 'service_provider', 'stewardship_provider', 'storage_provider')),
  constraint asset_relationships_status_check
    check (status in ('invited', 'pending', 'active', 'paused', 'ended', 'revoked', 'expired', 'unclaimed', 'claimed')),
  constraint asset_relationships_access_scope_check
    check (access_scope in ('none', 'public_context', 'service_workspace', 'service_stewardship', 'stewardship_workspace', 'storage_workspace', 'dealer_sales_workspace', 'dealer_delivery_workspace', 'transfer_workspace', 'oem_context', 'owner_full')),
  constraint asset_relationships_claim_state_check
    check (claim_state in ('unclaimed_org', 'claimed_org', 'invited', 'accepted', 'not_applicable')),
  constraint asset_relationships_effective_check
    check (effective_to is null or effective_to > effective_from)
);

create unique index if not exists asset_relationships_active_org_type_uidx
  on public.asset_relationships (asset_id, organization_id, relationship_type, coalesce(org_location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active' and organization_id is not null;

create unique index if not exists asset_relationships_active_user_type_uidx
  on public.asset_relationships (asset_id, user_id, relationship_type)
  where status = 'active' and user_id is not null;

create index if not exists asset_relationships_asset_status_idx
  on public.asset_relationships (asset_id, status);

create index if not exists asset_relationships_org_status_idx
  on public.asset_relationships (organization_id, status);

create index if not exists asset_relationships_keepr_pro_status_idx
  on public.asset_relationships (keepr_pro_id, status)
  where keepr_pro_id is not null;

alter table public.asset_relationships enable row level security;

create or replace function public.activator_user_can_read_asset(
  p_user_id uuid,
  p_asset_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and (
    exists (
      select 1
      from public.assets a
      where a.id = p_asset_id
        and a.owner_id = p_user_id
        and coalesce(a.deleted_at is null, true)
    )
    or exists (
      select 1
      from public.asset_stewardships s
      where s.asset_id = p_asset_id
        and s.user_id = p_user_id
        and coalesce(s.active, true) = true
        and (s.starts_at is null or s.starts_at <= now())
        and (s.ends_at is null or s.ends_at > now())
    )
    or exists (
      select 1
      from public.asset_relationships r
      where r.asset_id = p_asset_id
        and r.status = 'active'
        and r.access_scope <> 'none'
        and (r.effective_from is null or r.effective_from <= now())
        and (r.effective_to is null or r.effective_to > now())
        and (
          r.user_id = p_user_id
          or (
            r.organization_id is not null
            and public.activator_user_can_act_for_org(p_user_id, r.organization_id)
          )
        )
    )
  );
$$;

create or replace function public.activator_user_can_manage_asset(
  p_user_id uuid,
  p_asset_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_user_id is not null and exists (
    select 1
    from public.assets a
    where a.id = p_asset_id
      and a.owner_id = p_user_id
      and coalesce(a.deleted_at is null, true)
  );
$$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'asset_relationships'
      and policyname = 'Asset readers read relationships'
  ) then
    create policy "Asset readers read relationships"
      on public.asset_relationships
      for select
      to authenticated
      using (public.activator_user_can_read_asset(auth.uid(), asset_id));
  end if;
end $$;

create or replace view public.asset_relationship_edges
with (security_invoker = true)
as
select
  r.id,
  'asset_relationships'::text as source_table,
  r.asset_id,
  r.organization_id,
  r.org_location_id,
  r.keepr_pro_id,
  r.user_id,
  r.relationship_type,
  r.status,
  r.access_scope,
  r.claim_state,
  r.effective_from,
  r.effective_to,
  r.created_at,
  r.updated_at,
  r.metadata
from public.asset_relationships r
union all
select
  aps.id,
  'asset_provider_stewardships'::text as source_table,
  aps.asset_id,
  aps.organization_id,
  null::uuid as org_location_id,
  aps.keepr_pro_id,
  null::uuid as user_id,
  aps.relationship_type,
  aps.status,
  case aps.access_scope
    when 'service_stewardship' then 'service_workspace'
    else aps.access_scope
  end as access_scope,
  coalesce(kp.claimed_state, 'unclaimed') as claim_state,
  aps.starts_at as effective_from,
  aps.ends_at as effective_to,
  aps.created_at,
  aps.updated_at,
  jsonb_build_object(
    'owner_id', aps.owner_id,
    'legacy_access_scope', aps.access_scope
  ) as metadata
from public.asset_provider_stewardships aps
left join public.keepr_pros kp
  on kp.id = aps.keepr_pro_id;

create table if not exists public.kpc_external_identities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete cascade,
  keepr_pro_id uuid references public.keepr_pros(id) on delete set null,
  source_type text not null,
  external_id text not null,
  source_url text,
  raw_types jsonb not null default '[]'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  authority_state text not null default 'public_source_reported',
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint kpc_external_identities_source_type_check
    check (length(trim(source_type)) > 0),
  constraint kpc_external_identities_external_id_check
    check (length(trim(external_id)) > 0),
  constraint kpc_external_identities_raw_types_check
    check (jsonb_typeof(raw_types) = 'array'),
  constraint kpc_external_identities_authority_state_check
    check (authority_state in ('manual', 'owner_added', 'keepr_seeded', 'public_source_reported', 'org_confirmed', 'counterparty_confirmed', 'evidence_verified', 'disputed', 'superseded'))
);

create unique index if not exists kpc_external_identities_source_uidx
  on public.kpc_external_identities (lower(source_type), external_id);

create index if not exists kpc_external_identities_org_idx
  on public.kpc_external_identities (organization_id, authority_state);

create index if not exists kpc_external_identities_keeprpro_idx
  on public.kpc_external_identities (keepr_pro_id)
  where keepr_pro_id is not null;

alter table public.kpc_external_identities enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'kpc_external_identities'
      and policyname = 'Authenticated users can read KPC external identities'
  ) then
    create policy "Authenticated users can read KPC external identities"
      on public.kpc_external_identities
      for select
      to authenticated
      using (true);
  end if;
end $$;

drop trigger if exists kpc_external_identities_touch_updated_at on public.kpc_external_identities;
create trigger kpc_external_identities_touch_updated_at
  before update on public.kpc_external_identities
  for each row execute function public.kpc_touch_updated_at();

create or replace function public.kpc_location_label(
  p_location text,
  p_city text,
  p_state text,
  p_org_id uuid
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(p_location, ''),
    nullif(concat_ws(', ', nullif(p_city, ''), nullif(p_state, '')), ''),
    (
      select nullif(concat_ws(', ', nullif(ol.name, ''), nullif(ol.city, ''), nullif(ol.region, '')), '')
      from public.org_locations ol
      where ol.organization_id = p_org_id
        and coalesce(ol.status, 'active') = 'active'
      order by ol.created_at asc nulls last
      limit 1
    )
  );
$$;

create or replace function public.kpc_primary_location_json(p_org_id uuid, p_keepr_pro_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select p_org_id as organization_id, p_keepr_pro_id as keepr_pro_id
  ),
  resolved as (
    select
      coalesce(input.organization_id, kp.organization_id) as resolved_organization_id,
      kp.*
    from input
    left join public.keepr_pros kp
      on kp.id = input.keepr_pro_id
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'name', coalesce(nullif(ol.name, ''), nullif(r.location, '')),
    'location_name', coalesce(nullif(ol.name, ''), nullif(r.location, '')),
    'address_line_1', coalesce(nullif(ol.address_line1, ''), nullif(r.address_line1, '')),
    'address_line_2', coalesce(nullif(ol.address_line2, ''), nullif(r.address_line2, '')),
    'city', coalesce(nullif(ol.city, ''), nullif(r.city, '')),
    'region', coalesce(nullif(ol.region, ''), nullif(r.state, '')),
    'postal_code', coalesce(nullif(ol.postal_code, ''), nullif(r.postal_code, '')),
    'country_code', coalesce(nullif(ol.country, ''), nullif(r.country, '')),
    'phone', coalesce(nullif(ol.phone, ''), nullif(r.phone, '')),
    'email', coalesce(nullif(ol.email, ''), nullif(r.email, '')),
    'website', coalesce(nullif(ol.website, ''), nullif(r.website, '')),
    'source_name', ol.source_name,
    'source_url', ol.source_url,
    'external_source_id', ol.external_source_id,
    'claim_state', ol.claim_state,
    'verification_state', ol.verification_state
  ))
  from resolved r
  left join lateral (
    select *
    from public.org_locations loc
    where loc.organization_id = r.resolved_organization_id
      and coalesce(loc.status, 'active') = 'active'
    order by
      case when loc.location_type in ('office', 'showroom', 'dealer_location', 'marina', 'service_center') then 0 else 1 end,
      loc.created_at asc nulls last
    limit 1
  ) ol on true;
$$;

create or replace function public.kpc_external_identities_json(p_org_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', kei.id,
    'source_type', kei.source_type,
    'external_id', kei.external_id,
    'source_url', kei.source_url,
    'raw_types', kei.raw_types,
    'source_metadata', kei.source_metadata,
    'authority_state', kei.authority_state,
    'first_seen_at', kei.first_seen_at,
    'last_seen_at', kei.last_seen_at,
    'verified_at', kei.verified_at
  )) order by kei.verified_at desc nulls last, kei.last_seen_at desc), '[]'::jsonb)
  from public.kpc_external_identities kei
  where kei.organization_id = p_org_id
    and coalesce(kei.authority_state, '') <> 'superseded';
$$;

create or replace function public.kpc_source_summary_json(p_org_id uuid, p_keepr_pro_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select p_org_id as organization_id, p_keepr_pro_id as keepr_pro_id
  ),
  resolved as (
    select coalesce(input.organization_id, kp.organization_id) as organization_id, kp.id as keepr_pro_id
    from input
    left join public.keepr_pros kp
      on kp.id = input.keepr_pro_id
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'identity_authority_state', o.authority_state,
    'org_source_type', o.source_type,
    'org_source_name', o.source_name,
    'org_source_url', o.source_url,
    'profile_source', kp.source,
    'profile_source_metadata', kp.source_metadata,
    'external_identity_count', (
      select count(*)
      from public.kpc_external_identities kei
      where kei.organization_id = r.organization_id
        and coalesce(kei.authority_state, '') <> 'superseded'
    )
  ))
  from resolved r
  left join public.orgs o
    on o.id = r.organization_id
  left join public.keepr_pros kp
    on kp.id = r.keepr_pro_id;
$$;

create or replace function public.kpc_result_json(
  p_organization_id uuid,
  p_keepr_pro_id uuid,
  p_score numeric default 0,
  p_match_reason text default null,
  p_saved_relationship_id uuid default null,
  p_source text default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with input as (
    select p_organization_id as organization_id, p_keepr_pro_id as keepr_pro_id
  ),
  profile as (
    select
      coalesce(p_organization_id, kp.organization_id) as organization_id,
      kp.id as keepr_pro_id
    from input
    left join public.keepr_pros kp
      on kp.id = input.keepr_pro_id
      or (
        input.keepr_pro_id is null
        and input.organization_id is not null
        and kp.organization_id = input.organization_id
      )
    order by
      case when kp.organization_id = input.organization_id then 0 else 1 end,
      case coalesce(kp.claimed_state, '') when 'claimed' then 0 else 1 end,
      kp.created_at asc nulls last
    limit 1
  ),
  resolved as (
    select
      o.id as organization_id,
      kp.id as keepr_pro_id,
      coalesce('org:' || o.id::text, 'keepr_pro:' || kp.id::text) as kpc_id,
      coalesce(nullif(o.display_name, ''), nullif(o.name, ''), nullif(kp.display_name, ''), kp.name) as display_name,
      coalesce(nullif(o.name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), kp.display_name) as name,
      coalesce(nullif(o.legal_name, ''), nullif(o.name, ''), nullif(kp.name, '')) as legal_name,
      coalesce(nullif(o.slug, ''), nullif(kp.slug, '')) as slug,
      public.kpc_default_category(o.kpc_category, o.org_type, o.organization_type, o.workspace_type, kp.categories) as primary_category,
      public.kpc_effective_capabilities(
        o.org_type,
        o.organization_type,
        o.workspace_type,
        o.workspace_capabilities,
        o.kpc_capabilities,
        kp.categories,
        kp.category
      ) as capabilities,
      coalesce(nullif(kp.claimed_state, ''), nullif(o.authority_state, ''), 'unclaimed') as claim_state,
      coalesce(nullif(kp.profile_status, ''), nullif(kp.publish_status, ''), nullif(o.status, ''), 'active') as status,
      kp.publish_status,
      coalesce(nullif(o.organization_type, ''), nullif(o.org_type, '')) as organization_type,
      o.workspace_type,
      kp.phone,
      kp.email,
      kp.website,
      coalesce(public.kpc_normalize_domain(kp.website), public.kpc_domain_from_email(kp.email)) as domain,
      public.kpc_location_label(kp.location, kp.city, kp.state, o.id) as location,
      coalesce(nullif(kp.logo_url, ''), nullif(kp.avatar_url, '')) as logo_url,
      kp.header_image_url,
      coalesce(nullif(kp.short_description, ''), nullif(kp.public_description, ''), nullif(kp.notes, '')) as short_description
    from profile input
    left join public.orgs o
      on o.id = input.organization_id
    left join public.keepr_pros kp
      on kp.id = input.keepr_pro_id
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'kpc_id', r.kpc_id,
    'organization_id', r.organization_id,
    'keepr_pro_id', r.keepr_pro_id,
    'owner_kpc_relationship_id', p_saved_relationship_id,
    'display_name', r.display_name,
    'name', r.name,
    'legal_name', r.legal_name,
    'slug', r.slug,
    'category', r.primary_category,
    'capabilities', r.capabilities,
    'claim_state', r.claim_state,
    'profile_status', r.status,
    'publish_status', r.publish_status,
    'organization_type', r.organization_type,
    'workspace_type', r.workspace_type,
    'phone', r.phone,
    'email', r.email,
    'website', r.website,
    'domain', r.domain,
    'location', r.location,
    'logo_url', r.logo_url,
    'header_image_url', r.header_image_url,
    'short_description', r.short_description,
    'primary_location', public.kpc_primary_location_json(r.organization_id, r.keepr_pro_id),
    'external_identities', public.kpc_external_identities_json(r.organization_id),
    'source_summary', public.kpc_source_summary_json(r.organization_id, r.keepr_pro_id),
    'source', p_source,
    'match', jsonb_build_object('score', p_score, 'reason', p_match_reason),
    'kpcId', r.kpc_id,
    'orgId', r.organization_id,
    'keeprProId', r.keepr_pro_id,
    'displayName', r.display_name,
    'legalName', r.legal_name,
    'primaryCategory', r.primary_category,
    'claimState', r.claim_state,
    'status', r.status,
    'profileMedia', jsonb_strip_nulls(jsonb_build_object(
      'logoUrl', r.logo_url,
      'headerUrl', r.header_image_url
    )),
    'contact', jsonb_strip_nulls(jsonb_build_object(
      'phone', r.phone,
      'email', r.email,
      'website', r.website,
      'domain', r.domain
    )),
    'primaryLocation', public.kpc_primary_location_json(r.organization_id, r.keepr_pro_id),
    'externalIdentities', public.kpc_external_identities_json(r.organization_id),
    'sourceSummary', public.kpc_source_summary_json(r.organization_id, r.keepr_pro_id)
  ))
  from resolved r;
$$;

create or replace function public.search_kpc_directory(
  p_query text default null,
  p_filters jsonb default '{}'::jsonb,
  p_limit integer default 12
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_norm text := public.kpc_normalize_text(p_query);
  v_domain text := coalesce(public.kpc_normalize_domain(p_query), public.kpc_domain_from_email(p_query));
  v_phone text := public.kpc_normalize_phone(p_query);
  v_limit integer := greatest(1, least(coalesce(p_limit, 12), 50));
  v_results jsonb;
begin
  with candidates as (
    select
      coalesce(kp.organization_id::text, 'kp:' || kp.id::text) as candidate_key,
      kp.organization_id,
      kp.id as keepr_pro_id,
      case
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) = v_norm then 100
        when v_domain is not null and (public.kpc_normalize_domain(kp.website) = v_domain or public.kpc_domain_from_email(kp.email) = v_domain) then 95
        when v_phone is not null and public.kpc_normalize_phone(kp.phone) = v_phone then 90
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) like v_norm || '%' then 80
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) like '%' || v_norm || '%' then 65
        else 10
      end as score,
      case
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) = v_norm then 'name_exact'
        when v_domain is not null and (public.kpc_normalize_domain(kp.website) = v_domain or public.kpc_domain_from_email(kp.email) = v_domain) then 'domain'
        when v_phone is not null and public.kpc_normalize_phone(kp.phone) = v_phone then 'phone'
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) like v_norm || '%' then 'name_prefix'
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) like '%' || v_norm || '%' then 'name_contains'
        else 'directory'
      end as match_reason,
      case
        when kp.organization_id is not null and coalesce(kp.claimed_state, '') = 'claimed' then 0
        when kp.organization_id is not null then 1
        else 2
      end as canonical_rank,
      coalesce(kp.created_at, o.created_at, now()) as created_at
    from public.keepr_pros kp
    left join public.orgs o
      on o.id = kp.organization_id
    where coalesce(kp.name, kp.display_name, o.name, o.display_name) is not null
      and (
        v_query is null
        or public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) like '%' || v_norm || '%'
        or public.kpc_normalize_domain(kp.website) = v_domain
        or public.kpc_domain_from_email(kp.email) = v_domain
        or public.kpc_normalize_phone(kp.phone) = v_phone
      )
    union all
    select
      o.id::text as candidate_key,
      o.id as organization_id,
      null::uuid as keepr_pro_id,
      case
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name)) = v_norm then 92
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name)) like v_norm || '%' then 78
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name)) like '%' || v_norm || '%' then 60
        else 5
      end as score,
      case
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name)) = v_norm then 'org_name_exact'
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name)) like v_norm || '%' then 'org_name_prefix'
        when v_norm is not null and public.kpc_normalize_text(coalesce(o.display_name, o.name)) like '%' || v_norm || '%' then 'org_name_contains'
        else 'org_directory'
      end as match_reason,
      1 as canonical_rank,
      coalesce(o.created_at, now()) as created_at
    from public.orgs o
    where coalesce(o.name, o.display_name) is not null
      and (
        v_query is null
        or public.kpc_normalize_text(coalesce(o.display_name, o.name)) like '%' || v_norm || '%'
      )
  ),
  ranked as (
    select distinct on (candidate_key)
      candidate_key,
      organization_id,
      keepr_pro_id,
      score,
      match_reason
    from candidates
    where v_query is null or score > 0
    order by candidate_key, score desc, canonical_rank asc, created_at asc
  )
  select coalesce(
    jsonb_agg(public.kpc_result_json(organization_id, keepr_pro_id, score, match_reason, null, 'kpc_directory') order by score desc),
    '[]'::jsonb
  )
  into v_results
  from (
    select *
    from ranked
    order by score desc
    limit v_limit
  ) limited;

  return jsonb_build_object(
    'query', v_query,
    'results', coalesce(v_results, '[]'::jsonb)
  );
end;
$$;

create or replace function public.resolve_or_create_owner_kpc(
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(p_payload ->> 'name', p_payload ->> 'display_name')), '');
  v_category text := nullif(lower(trim(coalesce(p_payload ->> 'category', ''))), '');
  v_phone text := nullif(trim(coalesce(p_payload ->> 'phone', '')), '');
  v_email text := nullif(trim(coalesce(p_payload ->> 'email', '')), '');
  v_website text := nullif(trim(coalesce(p_payload ->> 'website', '')), '');
  v_location text := nullif(trim(coalesce(p_payload ->> 'location', '')), '');
  v_notes text := nullif(trim(coalesce(p_payload ->> 'notes', '')), '');
  v_source text := nullif(trim(coalesce(p_payload ->> 'source', 'manual')), '');
  v_contact_id text := nullif(trim(coalesce(p_payload ->> 'contact_id', '')), '');
  v_norm text := public.kpc_normalize_text(coalesce(p_payload ->> 'name', p_payload ->> 'display_name'));
  v_domain text := coalesce(public.kpc_normalize_domain(v_website), public.kpc_domain_from_email(v_email));
  v_phone_norm text := public.kpc_normalize_phone(v_phone);
  v_slug text;
  v_org_id uuid;
  v_kp_id uuid;
  v_relationship_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if v_name is null then
    raise exception 'KPC name is required';
  end if;

  select kp.organization_id, kp.id
  into v_org_id, v_kp_id
  from public.keepr_pros kp
  left join public.orgs o
    on o.id = kp.organization_id
  where (
      v_norm is not null
      and public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) = v_norm
    )
    or (
      v_domain is not null
      and (public.kpc_normalize_domain(kp.website) = v_domain or public.kpc_domain_from_email(kp.email) = v_domain)
    )
    or (
      v_phone_norm is not null
      and length(v_phone_norm) >= 7
      and public.kpc_normalize_phone(kp.phone) = v_phone_norm
    )
  order by
    case when kp.organization_id is not null and coalesce(kp.claimed_state, '') = 'claimed' then 0 else 1 end,
    case when kp.organization_id is not null then 0 else 1 end,
    kp.created_at asc nulls last
  limit 1;

  if v_org_id is null then
    select o.id
    into v_org_id
    from public.orgs o
    where v_norm is not null
      and public.kpc_normalize_text(coalesce(o.display_name, o.name)) = v_norm
    order by o.created_at asc nulls last
    limit 1;
  end if;

  if v_org_id is null then
    v_slug := public.kpc_slugify(v_name);

    insert into public.orgs (
      name,
      display_name,
      slug,
      org_type,
      organization_type,
      status,
      authority_state,
      source_type,
      source_name,
      source_metadata,
      kpc_category,
      kpc_capabilities,
      updated_at
    )
    values (
      v_name,
      v_name,
      v_slug,
      'organization',
      'organization',
      'active',
      'public_source_reported',
      coalesce(v_source, 'owner_manual'),
      'Owner KPC resolve-first',
      jsonb_strip_nulls(jsonb_build_object(
        'created_from', 'resolve_or_create_owner_kpc',
        'created_by_profile_id', auth.uid(),
        'source_external_id', v_contact_id,
        'website_domain', v_domain,
        'phone_normalized', v_phone_norm
      )),
      public.kpc_default_category(v_category, null, null, null, jsonb_build_array(v_category)),
      '[]'::jsonb,
      now()
    )
    on conflict (lower(slug)) where slug is not null do nothing
    returning id into v_org_id;

    if v_org_id is null then
      select id
      into v_org_id
      from public.orgs
      where lower(slug) = lower(v_slug)
      limit 1;
    end if;
  end if;

  if v_kp_id is null then
    select id
    into v_kp_id
    from public.keepr_pros
    where organization_id = v_org_id
    order by
      case coalesce(claimed_state, '') when 'claimed' then 0 else 1 end,
      created_at asc nulls last
    limit 1;
  end if;

  if v_kp_id is null then
    insert into public.keepr_pros (
      user_id,
      organization_id,
      name,
      display_name,
      category,
      phone,
      email,
      website,
      location,
      notes,
      since_label,
      last_service,
      is_favorite,
      assets,
      service_history,
      address_line1,
      address_line2,
      city,
      state,
      postal_code,
      country,
      source,
      contact_id,
      claimed_state,
      profile_status,
      categories,
      source_metadata
    )
    values (
      null,
      v_org_id,
      v_name,
      v_name,
      coalesce(v_category, 'other'),
      v_phone,
      v_email,
      v_website,
      v_location,
      v_notes,
      'Keepr setup',
      null,
      false,
      '[]'::jsonb,
      '[]'::jsonb,
      nullif(p_payload ->> 'address_line1', ''),
      nullif(p_payload ->> 'address_line2', ''),
      nullif(p_payload ->> 'city', ''),
      nullif(p_payload ->> 'state', ''),
      nullif(p_payload ->> 'postal_code', ''),
      nullif(p_payload ->> 'country', ''),
      coalesce(v_source, 'owner_manual'),
      v_contact_id,
      'unclaimed',
      'draft',
      jsonb_build_array(coalesce(v_category, 'other')),
      jsonb_strip_nulls(jsonb_build_object(
        'created_from', 'resolve_or_create_owner_kpc',
        'created_by_profile_id', auth.uid(),
        'source_external_id', v_contact_id
      ))
    )
    returning id into v_kp_id;
  end if;

  insert into public.profile_kpc_relationships (
    profile_id,
    organization_id,
    keepr_pro_id,
    relationship_type,
    status,
    is_favorite,
    notes,
    authority_state,
    source_type,
    source_name,
    source_external_id,
    metadata
  )
  values (
    auth.uid(),
    v_org_id,
    v_kp_id,
    case when v_source = 'contact_import' then 'contact_import' else 'saved_provider' end,
    'active',
    coalesce((p_payload ->> 'is_favorite')::boolean, false),
    v_notes,
    'owner_saved',
    coalesce(v_source, 'owner_manual'),
    'Owner Add KeeprPro',
    v_contact_id,
    jsonb_strip_nulls(jsonb_build_object(
      'resolve_first', true,
      'legacy_surface', 'Owner Add KeeprPro'
    ))
  )
  on conflict (profile_id, organization_id, relationship_type)
    where organization_id is not null and status in ('active', 'paused')
  do update
    set keepr_pro_id = coalesce(excluded.keepr_pro_id, public.profile_kpc_relationships.keepr_pro_id),
        is_favorite = public.profile_kpc_relationships.is_favorite or excluded.is_favorite,
        notes = coalesce(excluded.notes, public.profile_kpc_relationships.notes),
        source_type = coalesce(excluded.source_type, public.profile_kpc_relationships.source_type),
        source_name = coalesce(excluded.source_name, public.profile_kpc_relationships.source_name),
        source_external_id = coalesce(excluded.source_external_id, public.profile_kpc_relationships.source_external_id),
        metadata = public.profile_kpc_relationships.metadata || excluded.metadata,
        updated_at = now()
  returning id into v_relationship_id;

  return jsonb_build_object(
    'relationship_id', v_relationship_id,
    'kpc', public.kpc_result_json(v_org_id, v_kp_id, 100, 'resolve_or_create_owner_kpc', v_relationship_id, 'owner_saved')
  );
end;
$$;

create or replace function public.get_my_kpc_relationships()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_results jsonb;
begin
  if auth.uid() is null then
    return jsonb_build_object('results', '[]'::jsonb);
  end if;

  with saved as (
    select
      rel.id as relationship_id,
      rel.organization_id,
      rel.keepr_pro_id,
      rel.is_favorite,
      rel.relationship_type,
      rel.created_at,
      public.kpc_result_json(rel.organization_id, rel.keepr_pro_id, 100, 'owner_saved', rel.id, 'owner_saved') as kpc
    from public.profile_kpc_relationships rel
    where rel.profile_id = auth.uid()
      and rel.status in ('active', 'paused')
  ),
  legacy as (
    select
      null::uuid as relationship_id,
      kp.organization_id,
      kp.id as keepr_pro_id,
      coalesce(kp.is_favorite, false) as is_favorite,
      'legacy_keepr_pro'::text as relationship_type,
      kp.created_at,
      public.kpc_result_json(kp.organization_id, kp.id, 50, 'legacy_owner_keepr_pro', null, 'legacy_owner_keepr_pro') as kpc
    from public.keepr_pros kp
    where kp.user_id = auth.uid()
      and not exists (
        select 1
        from public.profile_kpc_relationships rel
        where rel.profile_id = auth.uid()
          and rel.status in ('active', 'paused')
          and (
            (rel.organization_id is not null and rel.organization_id = kp.organization_id)
            or (rel.organization_id is null and rel.keepr_pro_id = kp.id)
          )
      )
  ),
  combined as (
    select * from saved
    union all
    select * from legacy
  )
  select coalesce(jsonb_agg(
    kpc
    || jsonb_build_object(
      'owner_kpc_relationship_id', relationship_id,
      'relationship_type', relationship_type,
      'is_favorite', is_favorite
    )
    order by is_favorite desc, lower(kpc ->> 'display_name')
  ), '[]'::jsonb)
  into v_results
  from combined;

  return jsonb_build_object('results', coalesce(v_results, '[]'::jsonb));
end;
$$;

grant select on public.asset_relationship_edges to authenticated;
grant select, insert, update on public.profile_kpc_relationships to authenticated;
grant select, insert, update on public.kpc_external_identities to authenticated;
grant select, insert, update on public.asset_resources to authenticated;
grant select, insert, update on public.org_relationships to authenticated;
grant select, insert, update on public.asset_relationships to authenticated;
grant select on public.org_locations to authenticated;
grant execute on function public.kpc_normalize_text(text) to authenticated;
grant execute on function public.kpc_slugify(text) to authenticated;
grant execute on function public.kpc_normalize_domain(text) to authenticated;
grant execute on function public.kpc_domain_from_email(text) to authenticated;
grant execute on function public.kpc_normalize_phone(text) to authenticated;
grant execute on function public.search_kpc_directory(text, jsonb, integer) to authenticated;
grant execute on function public.resolve_or_create_owner_kpc(jsonb) to authenticated;
grant execute on function public.get_my_kpc_relationships() to authenticated;

comment on table public.profile_kpc_relationships is
  'Owner/person saved relationship to a canonical KPC. KPC identity remains orgs + keepr_pros.';

comment on table public.kpc_external_identities is
  'External source identity mappings for a canonical KPC organization.';

comment on table public.org_relationships is
  'Canonical organization-to-organization relationships such as represented brands and dealer networks.';

comment on table public.asset_relationships is
  'Canonical asset-to-person/org relationship layer for owner, manufacturer, dealer, and provider projections.';

comment on table public.asset_resources is
  'Thin resource/provenance linkage over existing attachments and external source references.';
