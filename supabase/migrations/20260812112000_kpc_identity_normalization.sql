-- KPC identity normalization.
-- Additive only: KPC remains the canonical organization identity represented by
-- public.orgs, with public.keepr_pros as the current product/profile
-- compatibility layer.

alter table public.orgs
  add column if not exists legal_name text;

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
    check (authority_state in (
      'manual',
      'owner_added',
      'keepr_seeded',
      'public_source_reported',
      'org_confirmed',
      'counterparty_confirmed',
      'evidence_verified',
      'disputed',
      'superseded'
    ))
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

  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'kpc_external_identities'
      and policyname = 'Org managers can manage KPC external identities'
  ) then
    create policy "Org managers can manage KPC external identities"
      on public.kpc_external_identities
      for all
      to authenticated
      using (
        public.keeprspace_user_can_seed_org(auth.uid())
        or public.keeprspace_user_can_manage_org(auth.uid(), organization_id)
      )
      with check (
        public.keeprspace_user_can_seed_org(auth.uid())
        or public.keeprspace_user_can_manage_org(auth.uid(), organization_id)
      );
  end if;
end $$;

drop trigger if exists kpc_external_identities_touch_updated_at on public.kpc_external_identities;
create trigger kpc_external_identities_touch_updated_at
  before update on public.kpc_external_identities
  for each row execute function public.kpc_touch_updated_at();

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
    'latitude', ol.latitude,
    'longitude', ol.longitude,
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
    -- Backward-compatible snake_case keys consumed by existing web code.
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
    'match', jsonb_build_object(
      'score', p_score,
      'reason', p_match_reason
    ),

    -- Normalized KPC contract keys for new callers.
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

grant select, insert, update on public.kpc_external_identities to authenticated;
grant execute on function public.kpc_primary_location_json(uuid, uuid) to authenticated;
grant execute on function public.kpc_external_identities_json(uuid) to authenticated;
grant execute on function public.kpc_source_summary_json(uuid, uuid) to authenticated;

comment on table public.kpc_external_identities is
  'External source identity mappings for a canonical KPC organization. Google, Garmin, Contacts, websites, and feeds describe the KPC; they do not become the KPC.';

comment on function public.kpc_result_json(uuid, uuid, numeric, text, uuid, text) is
  'Normalized KPC resolver result over canonical orgs plus the current keepr_pros profile compatibility layer. Returns legacy snake_case and new contract camelCase keys.';
