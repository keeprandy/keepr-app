-- Activator V1 foundation: marine ownership ingress primitives.
--
-- This adds the minimum production-backed model for:
-- model/year templates, exact-vessel template bindings, vessel facts with
-- authority/provenance, generalized asset relationships, activation workflow
-- state, thin resource provenance, and template playbook assignments.
--
-- Existing Keepr primitives remain authoritative for owned assets, actual
-- systems, reminders/actions, service records, attachments, and Harris/Wilson
-- provider continuity.

create table if not exists public.asset_model_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete restrict,
  asset_type text not null,
  category text not null,
  class text,
  manufacturer text not null,
  model text not null,
  model_year integer not null,
  model_year_start integer,
  model_year_end integer,
  template_key text not null,
  version integer not null default 1,
  status text not null default 'draft',
  authority_state text not null default 'imported',
  source_resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_model_templates_year_check
    check (model_year between 1900 and 2200),
  constraint asset_model_templates_year_range_check
    check (
      (model_year_start is null and model_year_end is null)
      or (
        model_year_start is not null
        and model_year_end is not null
        and model_year_start <= model_year_end
      )
    ),
  constraint asset_model_templates_version_check
    check (version > 0),
  constraint asset_model_templates_status_check
    check (status in ('draft', 'published', 'retired')),
  constraint asset_model_templates_authority_check
    check (authority_state in ('oem_as_built', 'oem_published', 'dealer_reported', 'keepr_curated', 'imported'))
);

create unique index if not exists asset_model_templates_key_version_uidx
  on public.asset_model_templates (lower(template_key), version);

create index if not exists asset_model_templates_org_status_idx
  on public.asset_model_templates (organization_id, status);

create index if not exists asset_model_templates_lookup_idx
  on public.asset_model_templates (lower(manufacturer), lower(model), model_year, status);

create table if not exists public.asset_model_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.asset_model_templates(id) on delete cascade,
  parent_item_id uuid references public.asset_model_template_items(id) on delete cascade,
  item_type text not null,
  canonical_key text not null,
  label text not null,
  expected_value jsonb not null default '{}'::jsonb,
  applicability jsonb not null default '{}'::jsonb,
  authority_state text not null default 'model_expected',
  source_resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_model_template_items_type_check
    check (item_type in ('system', 'component', 'spec', 'equipment', 'resource', 'playbook', 'interval', 'knowledge')),
  constraint asset_model_template_items_authority_check
    check (authority_state in ('model_expected', 'oem_published', 'oem_as_built', 'dealer_reported', 'keepr_curated', 'imported'))
);

create unique index if not exists asset_model_template_items_key_uidx
  on public.asset_model_template_items (template_id, lower(canonical_key));

create index if not exists asset_model_template_items_parent_idx
  on public.asset_model_template_items (template_id, parent_item_id, sort_order);

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

alter table public.asset_model_templates
  drop constraint if exists asset_model_templates_source_resource_fkey;

alter table public.asset_model_templates
  add constraint asset_model_templates_source_resource_fkey
  foreign key (source_resource_id) references public.asset_resources(id) on delete set null;

alter table public.asset_model_template_items
  drop constraint if exists asset_model_template_items_source_resource_fkey;

alter table public.asset_model_template_items
  add constraint asset_model_template_items_source_resource_fkey
  foreign key (source_resource_id) references public.asset_resources(id) on delete set null;

create table if not exists public.asset_template_bindings (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  template_id uuid not null references public.asset_model_templates(id) on delete restrict,
  template_version integer not null,
  binding_status text not null default 'suggested',
  binding_source text not null default 'keepr_resolved',
  confidence numeric(5,4) not null default 0.5000,
  source_resource_id uuid references public.asset_resources(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  superseded_by uuid references public.asset_template_bindings(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  constraint asset_template_bindings_status_check
    check (binding_status in ('suggested', 'inherited', 'verified', 'superseded', 'rejected')),
  constraint asset_template_bindings_source_check
    check (binding_source in ('oem', 'dealer_listing', 'owner_entered', 'keepr_resolved', 'imported')),
  constraint asset_template_bindings_confidence_check
    check (confidence >= 0 and confidence <= 1)
);

create unique index if not exists asset_template_bindings_active_asset_uidx
  on public.asset_template_bindings (asset_id)
  where binding_status in ('suggested', 'inherited', 'verified');

create index if not exists asset_template_bindings_template_idx
  on public.asset_template_bindings (template_id, template_version, binding_status);

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
    check (verification_state in ('unverified', 'source_reported', 'org_confirmed', 'evidence_verified')),
  constraint org_locations_latitude_check
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  constraint org_locations_longitude_check
    check (longitude is null or (longitude >= -180 and longitude <= 180))
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

create index if not exists org_locations_source_idx
  on public.org_locations (organization_id, external_source_id)
  where external_source_id is not null;

create table if not exists public.org_relationships (
  id uuid primary key default gen_random_uuid(),
  from_org_id uuid not null references public.orgs(id) on delete cascade,
  to_org_id uuid not null references public.orgs(id) on delete cascade,
  relationship_type text not null,
  status text not null default 'source_reported',
  source_resource_id uuid references public.asset_resources(id) on delete set null,
  evidence_state text not null default 'source_reported',
  effective_from date,
  effective_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint org_relationships_distinct_orgs_check
    check (from_org_id <> to_org_id),
  constraint org_relationships_type_check
    check (relationship_type in ('authorized_dealer', 'dealer_network_member', 'oem_partner')),
  constraint org_relationships_status_check
    check (status in ('source_reported', 'active', 'inactive', 'superseded', 'disputed')),
  constraint org_relationships_evidence_state_check
    check (evidence_state in ('source_reported', 'oem_published', 'org_confirmed', 'evidence_verified', 'superseded', 'disputed')),
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

create index if not exists org_relationships_source_idx
  on public.org_relationships (source_resource_id)
  where source_resource_id is not null;

create table if not exists public.asset_facts (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  subject_type text not null,
  subject_id uuid,
  template_item_id uuid references public.asset_model_template_items(id) on delete set null,
  fact_key text not null,
  fact_value jsonb not null,
  unit text,
  authority_state text not null,
  confidence numeric(5,4) not null default 0.5000,
  source_resource_id uuid references public.asset_resources(id) on delete set null,
  evidence_attachment_id uuid references public.attachments(id) on delete set null,
  asserted_by_user_id uuid references public.profiles(id) on delete set null,
  asserted_by_org_id uuid references public.orgs(id) on delete set null,
  asserted_at timestamptz not null default now(),
  verified_by uuid references public.profiles(id) on delete set null,
  verified_at timestamptz,
  supersedes_fact_id uuid references public.asset_facts(id) on delete set null,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_facts_subject_type_check
    check (subject_type in ('asset', 'system', 'component', 'relationship', 'document', 'location', 'registration', 'propulsion', 'equipment')),
  constraint asset_facts_authority_check
    check (authority_state in ('model_expected', 'source_reported', 'owner_confirmed', 'dealer_confirmed', 'oem_as_built', 'evidence_verified', 'service_verified', 'superseded', 'disputed')),
  constraint asset_facts_confidence_check
    check (confidence >= 0 and confidence <= 1)
);

create index if not exists asset_facts_asset_key_active_idx
  on public.asset_facts (asset_id, lower(fact_key), active);

create index if not exists asset_facts_template_item_idx
  on public.asset_facts (template_item_id)
  where template_item_id is not null;

create unique index if not exists asset_facts_active_hin_uidx
  on public.asset_facts (upper(nullif(trim(both '"' from fact_value::text), 'null')))
  where active = true
    and fact_key = 'hin'
    and authority_state not in ('superseded', 'disputed')
    and nullif(trim(both '"' from fact_value::text), 'null') is not null;

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
  activation_workflow_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_relationships_party_check
    check (organization_id is not null or user_id is not null or keepr_pro_id is not null),
  constraint asset_relationships_location_org_check
    check (org_location_id is null or organization_id is not null),
  constraint asset_relationships_type_check
    check (relationship_type in ('owner', 'steward', 'oem', 'selling_dealer', 'delivery_dealer', 'servicing_dealer', 'service_provider')),
  constraint asset_relationships_status_check
    check (status in ('pending', 'active', 'revoked', 'expired', 'unclaimed', 'claimed')),
  constraint asset_relationships_access_scope_check
    check (access_scope in ('none', 'public_context', 'service_workspace', 'transfer_workspace', 'oem_context', 'owner_full')),
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

create index if not exists asset_relationships_org_location_idx
  on public.asset_relationships (org_location_id, status)
  where org_location_id is not null;

create or replace function public.activator_enforce_relationship_location_org()
returns trigger
language plpgsql
as $$
begin
  if new.org_location_id is not null and not exists (
    select 1
    from public.org_locations l
    where l.id = new.org_location_id
      and l.organization_id = new.organization_id
  ) then
    raise exception 'Asset relationship location must belong to relationship organization';
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_asset_relationship_location_org on public.asset_relationships;
create trigger enforce_asset_relationship_location_org
before insert or update of organization_id, org_location_id
on public.asset_relationships
for each row
execute function public.activator_enforce_relationship_location_org();

create table if not exists public.asset_activation_workflows (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid references public.assets(id) on delete cascade,
  kac_id text,
  initiating_org_id uuid not null references public.orgs(id) on delete restrict,
  acting_member_id uuid not null references public.profiles(id) on delete restrict,
  template_id uuid references public.asset_model_templates(id) on delete set null,
  template_binding_id uuid references public.asset_template_bindings(id) on delete set null,
  activation_type text not null,
  vessel_state text not null default 'unresolved',
  owner_user_id uuid references public.profiles(id) on delete set null,
  owner_invite_email text,
  dealer_relationship_id uuid references public.asset_relationships(id) on delete set null,
  oem_relationship_id uuid references public.asset_relationships(id) on delete set null,
  activation_source_id uuid references public.activation_sources(id) on delete set null,
  activation_session_id uuid references public.activation_sessions(id) on delete set null,
  status text not null default 'draft',
  readiness_summary jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  handed_off_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint asset_activation_workflows_type_check
    check (activation_type in ('oem_first', 'dealer_listing_first', 'owner_first', 'transfer', 'service_continuity')),
  constraint asset_activation_workflows_vessel_state_check
    check (vessel_state in ('unresolved', 'resolved', 'verified_partial', 'ready_for_handoff', 'activated')),
  constraint asset_activation_workflows_status_check
    check (status in ('draft', 'configuring', 'owner_pending', 'activated', 'handed_off', 'cancelled'))
);

create index if not exists asset_activation_workflows_asset_idx
  on public.asset_activation_workflows (asset_id, status);

create index if not exists asset_activation_workflows_initiating_org_idx
  on public.asset_activation_workflows (initiating_org_id, status, created_at desc);

alter table public.asset_relationships
  drop constraint if exists asset_relationships_activation_workflow_fkey;

alter table public.asset_relationships
  add constraint asset_relationships_activation_workflow_fkey
  foreign key (activation_workflow_id) references public.asset_activation_workflows(id) on delete set null;

create table if not exists public.asset_playbook_assignments (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  template_item_id uuid not null references public.asset_model_template_items(id) on delete restrict,
  status text not null default 'suggested',
  responsible_relationship_id uuid references public.asset_relationships(id) on delete set null,
  next_due_at timestamptz,
  created_reminder_id uuid references public.reminders(id) on delete set null,
  service_record_id uuid references public.service_records(id) on delete set null,
  completion_evidence_attachment_id uuid references public.attachments(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_playbook_assignments_status_check
    check (status in ('suggested', 'applied', 'dismissed', 'superseded', 'completed'))
);

create unique index if not exists asset_playbook_assignments_active_uidx
  on public.asset_playbook_assignments (asset_id, template_item_id)
  where status in ('suggested', 'applied');

create index if not exists asset_playbook_assignments_asset_idx
  on public.asset_playbook_assignments (asset_id, status);

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
  select exists (
    select 1
    from public.org_members m
    where p_user_id is not null
      and m.org_id = p_organization_id
      and m.user_id = p_user_id
      and coalesce(m.status, 'active') = 'active'
      and coalesce(m.role, m.member_role, 'member') in ('owner', 'admin', 'member', 'provider_member')
  );
$$;

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
    or exists (
      select 1
      from public.asset_provider_stewardships aps
      where aps.asset_id = p_asset_id
        and aps.status = 'active'
        and aps.access_scope = 'service_stewardship'
        and (aps.starts_at is null or aps.starts_at <= now())
        and (aps.ends_at is null or aps.ends_at > now())
        and public.activator_user_can_act_for_org(p_user_id, aps.organization_id)
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
  select p_user_id is not null and (
    exists (
      select 1
      from public.assets a
      where a.id = p_asset_id
        and a.owner_id = p_user_id
    )
    or exists (
      select 1
      from public.asset_relationships r
      where r.asset_id = p_asset_id
        and r.status = 'active'
        and r.access_scope in ('owner_full', 'service_workspace', 'oem_context')
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

create or replace function public.activator_user_can_manage_template(
  p_user_id uuid,
  p_template_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.asset_model_templates t
    where t.id = p_template_id
      and public.activator_user_can_act_for_org(p_user_id, t.organization_id)
  );
$$;

create or replace function public.activator_user_can_read_template(
  p_user_id uuid,
  p_template_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.asset_model_templates t
    where t.id = p_template_id
      and (
        t.status = 'published'
        or public.activator_user_can_act_for_org(p_user_id, t.organization_id)
      )
  );
$$;

create or replace function public.activator_user_can_read_org_location(
  p_user_id uuid,
  p_org_location_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_locations l
    where l.id = p_org_location_id
      and (
        l.status = 'active'
        or public.activator_user_can_act_for_org(p_user_id, l.organization_id)
      )
  );
$$;

create or replace function public.activator_authority_rank(p_authority_state text)
returns integer
language sql
immutable
as $$
  select case p_authority_state
    when 'evidence_verified' then 10
    when 'oem_as_built' then 9
    when 'service_verified' then 8
    when 'dealer_confirmed' then 7
    when 'owner_confirmed' then 6
    when 'source_reported' then 5
    when 'model_expected' then 4
    when 'oem_published' then 4
    when 'keepr_curated' then 3
    when 'imported' then 2
    when 'disputed' then 1
    when 'superseded' then 0
    else 0
  end;
$$;

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

create or replace function public.resolve_asset_relationship_edges(
  p_asset_id uuid
)
returns setof public.asset_relationship_edges
language sql
stable
security definer
set search_path = public
as $$
  select e.*
  from public.asset_relationship_edges e
  where e.asset_id = p_asset_id
    and public.activator_user_can_read_asset(auth.uid(), e.asset_id)
  order by
    case e.status when 'active' then 0 when 'pending' then 1 else 2 end,
    e.created_at desc;
$$;

create or replace function public.resolve_asset_activation_projection(
  p_asset_id uuid,
  p_projection text default 'owner',
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_can_read boolean := false;
  v_relationship_allowed boolean := false;
  v_template jsonb := null;
  v_binding jsonb := null;
  v_facts jsonb := '[]'::jsonb;
  v_current_facts jsonb := '{}'::jsonb;
  v_relationships jsonb := '[]'::jsonb;
  v_workflow jsonb := null;
begin
  select *
  into v_asset
  from public.assets a
  where a.id = p_asset_id
    and coalesce(a.deleted_at is null, true)
  limit 1;

  if v_asset.id is null then
    return null;
  end if;

  v_can_read := public.activator_user_can_read_asset(auth.uid(), p_asset_id);

  if p_projection = 'oem' and p_organization_id is not null then
    v_relationship_allowed := exists (
      select 1
      from public.asset_relationships r
      where r.asset_id = p_asset_id
        and r.organization_id = p_organization_id
        and r.relationship_type = 'oem'
        and r.status = 'active'
        and r.access_scope in ('oem_context', 'owner_full')
        and public.activator_user_can_act_for_org(auth.uid(), p_organization_id)
    );
  elsif p_projection = 'dealer' and p_organization_id is not null then
    v_relationship_allowed := exists (
      select 1
      from public.asset_relationship_edges r
      where r.asset_id = p_asset_id
        and r.organization_id = p_organization_id
        and r.relationship_type in ('selling_dealer', 'delivery_dealer', 'servicing_dealer', 'service_provider')
        and r.status = 'active'
        and r.access_scope in ('service_workspace', 'owner_full')
        and public.activator_user_can_act_for_org(auth.uid(), p_organization_id)
    );
  else
    v_relationship_allowed := v_can_read;
  end if;

  if not v_relationship_allowed then
    return null;
  end if;

  select to_jsonb(b)
  into v_binding
  from public.asset_template_bindings b
  where b.asset_id = p_asset_id
    and b.binding_status in ('suggested', 'inherited', 'verified')
  order by
    case b.binding_status when 'verified' then 0 when 'inherited' then 1 else 2 end,
    b.created_at desc
  limit 1;

  if v_binding is not null then
    select jsonb_build_object(
      'id', t.id,
      'organization_id', t.organization_id,
      'manufacturer', t.manufacturer,
      'model', t.model,
      'model_year', t.model_year,
      'class', t.class,
      'category', t.category,
      'template_key', t.template_key,
      'version', t.version,
      'authority_state', t.authority_state,
      'items', coalesce((
        select jsonb_agg(to_jsonb(i) order by i.sort_order, i.label)
        from public.asset_model_template_items i
        where i.template_id = t.id
      ), '[]'::jsonb)
    )
    into v_template
    from public.asset_model_templates t
    where t.id = (v_binding ->> 'template_id')::uuid;
  end if;

  select coalesce(jsonb_agg(to_jsonb(f) order by public.activator_authority_rank(f.authority_state) desc, f.asserted_at desc), '[]'::jsonb)
  into v_facts
  from public.asset_facts f
  where f.asset_id = p_asset_id
    and f.active = true
    and f.authority_state not in ('superseded');

  select coalesce(jsonb_object_agg(f.fact_key, f.fact_value), '{}'::jsonb)
  into v_current_facts
  from (
    select distinct on (af.fact_key)
      af.fact_key,
      af.fact_value
    from public.asset_facts af
    where af.asset_id = p_asset_id
      and af.active = true
      and af.authority_state not in ('superseded', 'disputed')
    order by af.fact_key, public.activator_authority_rank(af.authority_state) desc, af.confidence desc, af.asserted_at desc
  ) f;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.relationship_type, r.created_at desc), '[]'::jsonb)
  into v_relationships
  from public.asset_relationship_edges r
  where r.asset_id = p_asset_id
    and (
      p_projection = 'owner'
      or r.access_scope <> 'owner_full'
      or v_asset.owner_id = auth.uid()
    );

  select to_jsonb(w)
  into v_workflow
  from public.asset_activation_workflows w
  where w.asset_id = p_asset_id
  order by w.created_at desc
  limit 1;

  return jsonb_build_object(
    'asset', jsonb_build_object(
      'id', v_asset.id,
      'name', v_asset.name,
      'type', v_asset.type,
      'year', v_asset.year,
      'make', v_asset.make,
      'model', v_asset.model,
      'kac_id', v_asset.kac_id
    ),
    'projection', p_projection,
    'template_binding', v_binding,
    'template', v_template,
    'facts', v_facts,
    'current_facts', v_current_facts,
    'relationships', v_relationships,
    'activation_workflow', v_workflow
  );
end;
$$;

create or replace function public.apply_asset_template_playbook(
  p_asset_id uuid,
  p_template_item_id uuid,
  p_due_at timestamptz default null,
  p_responsible_relationship_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_item public.asset_model_template_items%rowtype;
  v_assignment public.asset_playbook_assignments%rowtype;
  v_reminder_id uuid;
  v_default_relationship_type text;
begin
  if not public.activator_user_can_manage_asset(auth.uid(), p_asset_id) then
    raise exception 'Not authorized to apply playbooks for this asset';
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

  select *
  into v_item
  from public.asset_model_template_items
  where id = p_template_item_id
    and item_type = 'playbook'
  limit 1;

  if v_item.id is null then
    raise exception 'Template playbook item not found';
  end if;

  v_default_relationship_type := v_item.expected_value #>> '{default_responsible_relationship_type}';

  if p_responsible_relationship_id is not null and not exists (
    select 1
    from public.asset_relationship_edges r
    where r.id = p_responsible_relationship_id
      and r.asset_id = p_asset_id
      and r.status = 'active'
  ) then
    raise exception 'Responsible relationship is not active for this asset';
  end if;

  select *
  into v_assignment
  from public.asset_playbook_assignments a
  where a.asset_id = p_asset_id
    and a.template_item_id = p_template_item_id
    and a.status in ('suggested', 'applied')
  order by a.created_at desc
  limit 1;

  if v_assignment.id is not null and v_assignment.created_reminder_id is not null then
    return jsonb_build_object(
      'assignment_id', v_assignment.id,
      'reminder_id', v_assignment.created_reminder_id,
      'status', v_assignment.status,
      'reused', true
    );
  end if;

  insert into public.reminders (
    owner_id,
    title,
    notes,
    due_at,
    status,
    asset_id,
    extra_metadata,
    created_at,
    updated_at
  )
  values (
    v_asset.owner_id,
    v_item.label,
    'Created from Activator template playbook.',
    coalesce(p_due_at, now()),
    'open',
    p_asset_id,
    jsonb_build_object(
      'source', 'activator_template_playbook',
      'template_item_id', p_template_item_id,
      'template_id', v_item.template_id,
      'responsible_relationship_id', p_responsible_relationship_id,
      'default_responsible_relationship_type', v_default_relationship_type
    ),
    now(),
    now()
  )
  returning id into v_reminder_id;

  if v_assignment.id is null then
    insert into public.asset_playbook_assignments (
      asset_id,
      template_item_id,
      status,
      responsible_relationship_id,
      next_due_at,
      created_reminder_id,
      created_by,
      metadata
    )
    values (
      p_asset_id,
      p_template_item_id,
      'applied',
      p_responsible_relationship_id,
      coalesce(p_due_at, now()),
      v_reminder_id,
      auth.uid(),
      jsonb_build_object('source', 'activator_template_playbook')
    )
    returning * into v_assignment;
  else
    update public.asset_playbook_assignments
    set
      status = 'applied',
      responsible_relationship_id = coalesce(p_responsible_relationship_id, responsible_relationship_id),
      next_due_at = coalesce(p_due_at, next_due_at, now()),
      created_reminder_id = v_reminder_id,
      updated_at = now()
    where id = v_assignment.id
    returning * into v_assignment;
  end if;

  return jsonb_build_object(
    'assignment_id', v_assignment.id,
    'reminder_id', v_reminder_id,
    'status', v_assignment.status,
    'reused', false
  );
end;
$$;

alter table public.asset_model_templates enable row level security;
alter table public.asset_model_template_items enable row level security;
alter table public.asset_resources enable row level security;
alter table public.asset_template_bindings enable row level security;
alter table public.org_locations enable row level security;
alter table public.org_relationships enable row level security;
alter table public.asset_facts enable row level security;
alter table public.asset_relationships enable row level security;
alter table public.asset_activation_workflows enable row level security;
alter table public.asset_playbook_assignments enable row level security;

drop policy if exists "Published templates are readable" on public.asset_model_templates;
create policy "Published templates are readable"
  on public.asset_model_templates
  for select
  to authenticated
  using (status = 'published' or public.activator_user_can_act_for_org(auth.uid(), organization_id));

drop policy if exists "Org members manage templates" on public.asset_model_templates;
create policy "Org members manage templates"
  on public.asset_model_templates
  for all
  to authenticated
  using (public.activator_user_can_act_for_org(auth.uid(), organization_id))
  with check (public.activator_user_can_act_for_org(auth.uid(), organization_id));

drop policy if exists "Readable template items follow template" on public.asset_model_template_items;
create policy "Readable template items follow template"
  on public.asset_model_template_items
  for select
  to authenticated
  using (public.activator_user_can_read_template(auth.uid(), template_id));

drop policy if exists "Template managers manage template items" on public.asset_model_template_items;
create policy "Template managers manage template items"
  on public.asset_model_template_items
  for all
  to authenticated
  using (public.activator_user_can_manage_template(auth.uid(), template_id))
  with check (public.activator_user_can_manage_template(auth.uid(), template_id));

drop policy if exists "Readable asset resources follow scope" on public.asset_resources;
create policy "Readable asset resources follow scope"
  on public.asset_resources
  for select
  to authenticated
  using (
    (applies_to_type = 'template' and public.activator_user_can_read_template(auth.uid(), applies_to_id))
    or (applies_to_type in ('asset', 'system', 'component', 'relationship', 'workflow', 'fact', 'service_record') and (
      metadata ? 'asset_id'
      and public.activator_user_can_read_asset(auth.uid(), (metadata ->> 'asset_id')::uuid)
    ))
  );

drop policy if exists "Authenticated users can create scoped resources" on public.asset_resources;
create policy "Authenticated users can create scoped resources"
  on public.asset_resources
  for insert
  to authenticated
  with check (
    created_by = auth.uid()
    and (
      (applies_to_type = 'template' and public.activator_user_can_manage_template(auth.uid(), applies_to_id))
      or (metadata ? 'asset_id' and public.activator_user_can_manage_asset(auth.uid(), (metadata ->> 'asset_id')::uuid))
    )
  );

drop policy if exists "Asset readers read template bindings" on public.asset_template_bindings;
create policy "Asset readers read template bindings"
  on public.asset_template_bindings
  for select
  to authenticated
  using (public.activator_user_can_read_asset(auth.uid(), asset_id));

drop policy if exists "Asset managers manage template bindings" on public.asset_template_bindings;
create policy "Asset managers manage template bindings"
  on public.asset_template_bindings
  for all
  to authenticated
  using (public.activator_user_can_manage_asset(auth.uid(), asset_id))
  with check (public.activator_user_can_manage_asset(auth.uid(), asset_id));

drop policy if exists "Active org locations are readable" on public.org_locations;
create policy "Active org locations are readable"
  on public.org_locations
  for select
  to authenticated
  using (
    status = 'active'
    or public.activator_user_can_act_for_org(auth.uid(), organization_id)
  );

drop policy if exists "Org members manage org locations" on public.org_locations;
create policy "Org members manage org locations"
  on public.org_locations
  for all
  to authenticated
  using (public.activator_user_can_act_for_org(auth.uid(), organization_id))
  with check (public.activator_user_can_act_for_org(auth.uid(), organization_id));

drop policy if exists "Active org relationships are readable" on public.org_relationships;
create policy "Active org relationships are readable"
  on public.org_relationships
  for select
  to authenticated
  using (
    status in ('source_reported', 'active')
    or public.activator_user_can_act_for_org(auth.uid(), from_org_id)
    or public.activator_user_can_act_for_org(auth.uid(), to_org_id)
  );

drop policy if exists "Source org members manage org relationships" on public.org_relationships;
create policy "Source org members manage org relationships"
  on public.org_relationships
  for all
  to authenticated
  using (public.activator_user_can_act_for_org(auth.uid(), from_org_id))
  with check (public.activator_user_can_act_for_org(auth.uid(), from_org_id));

drop policy if exists "Asset readers read facts" on public.asset_facts;
create policy "Asset readers read facts"
  on public.asset_facts
  for select
  to authenticated
  using (public.activator_user_can_read_asset(auth.uid(), asset_id));

drop policy if exists "Asset managers manage facts" on public.asset_facts;
create policy "Asset managers manage facts"
  on public.asset_facts
  for all
  to authenticated
  using (public.activator_user_can_manage_asset(auth.uid(), asset_id))
  with check (public.activator_user_can_manage_asset(auth.uid(), asset_id));

drop policy if exists "Asset readers read relationships" on public.asset_relationships;
create policy "Asset readers read relationships"
  on public.asset_relationships
  for select
  to authenticated
  using (public.activator_user_can_read_asset(auth.uid(), asset_id));

drop policy if exists "Owners and scoped orgs manage relationships" on public.asset_relationships;
create policy "Owners and scoped orgs manage relationships"
  on public.asset_relationships
  for all
  to authenticated
  using (public.activator_user_can_manage_asset(auth.uid(), asset_id))
  with check (
    public.activator_user_can_manage_asset(auth.uid(), asset_id)
    or (
      initiated_by_org_id is not null
      and public.activator_user_can_act_for_org(auth.uid(), initiated_by_org_id)
    )
  );

drop policy if exists "Org members read activation workflows" on public.asset_activation_workflows;
create policy "Org members read activation workflows"
  on public.asset_activation_workflows
  for select
  to authenticated
  using (
    public.activator_user_can_act_for_org(auth.uid(), initiating_org_id)
    or (asset_id is not null and public.activator_user_can_read_asset(auth.uid(), asset_id))
  );

drop policy if exists "Org members manage activation workflows" on public.asset_activation_workflows;
create policy "Org members manage activation workflows"
  on public.asset_activation_workflows
  for all
  to authenticated
  using (public.activator_user_can_act_for_org(auth.uid(), initiating_org_id))
  with check (public.activator_user_can_act_for_org(auth.uid(), initiating_org_id));

drop policy if exists "Asset readers read playbook assignments" on public.asset_playbook_assignments;
create policy "Asset readers read playbook assignments"
  on public.asset_playbook_assignments
  for select
  to authenticated
  using (public.activator_user_can_read_asset(auth.uid(), asset_id));

drop policy if exists "Asset managers manage playbook assignments" on public.asset_playbook_assignments;
create policy "Asset managers manage playbook assignments"
  on public.asset_playbook_assignments
  for all
  to authenticated
  using (public.activator_user_can_manage_asset(auth.uid(), asset_id))
  with check (public.activator_user_can_manage_asset(auth.uid(), asset_id));

grant select on public.asset_relationship_edges to authenticated;
grant select, insert, update on public.asset_model_templates to authenticated;
grant select, insert, update on public.asset_model_template_items to authenticated;
grant select, insert, update on public.asset_resources to authenticated;
grant select, insert, update on public.asset_template_bindings to authenticated;
grant select, insert, update on public.org_locations to authenticated;
grant select, insert, update on public.org_relationships to authenticated;
grant select, insert, update on public.asset_facts to authenticated;
grant select, insert, update on public.asset_relationships to authenticated;
grant select, insert, update on public.asset_activation_workflows to authenticated;
grant select, insert, update on public.asset_playbook_assignments to authenticated;
grant execute on function public.activator_user_can_act_for_org(uuid, uuid) to authenticated;
grant execute on function public.activator_user_can_read_asset(uuid, uuid) to authenticated;
grant execute on function public.activator_user_can_manage_asset(uuid, uuid) to authenticated;
grant execute on function public.activator_user_can_manage_template(uuid, uuid) to authenticated;
grant execute on function public.activator_user_can_read_template(uuid, uuid) to authenticated;
grant execute on function public.activator_user_can_read_org_location(uuid, uuid) to authenticated;
grant execute on function public.activator_authority_rank(text) to authenticated;
grant execute on function public.resolve_asset_relationship_edges(uuid) to authenticated;
grant execute on function public.resolve_asset_activation_projection(uuid, text, uuid) to authenticated;
grant execute on function public.apply_asset_template_playbook(uuid, uuid, timestamptz, uuid) to authenticated;

comment on table public.asset_model_templates is
  'Versioned reusable year/make/model catalog templates for Activator. Not a vessel.';

comment on table public.asset_model_template_items is
  'Expected systems, components, specs, resources, knowledge, intervals, and playbooks inherited from a model template.';

comment on table public.asset_template_bindings is
  'Pins one canonical Keepr asset/KAC to a specific model template version.';

comment on table public.org_locations is
  'Canonical physical locations for an organization, such as dealer marinas, service centers, delivery centers, offices, or OEM factories.';

comment on table public.org_relationships is
  'Canonical organization-to-organization relationships such as OEM authorized dealer network membership. Evidence and temporal context stay in source resources/metadata.';

comment on table public.asset_facts is
  'Durable vessel assertions with authority, confidence, provenance, and supersession history.';

comment on table public.asset_relationships is
  'Generalized asset-to-person/org relationship layer for owner, OEM, dealer, and provider projections.';

comment on table public.asset_activation_workflows is
  'Org-led Activator workflow state and owner handoff. Not a generic workflow engine.';

comment on table public.asset_resources is
  'Thin resource/provenance linkage over existing attachments and external source references.';

comment on table public.asset_playbook_assignments is
  'Application of inherited template playbooks to vessel operations through existing reminders/service history.';

-- Primary proving template seed: 2026 Tiara 39 LE.
insert into public.orgs (name, display_name, slug, org_type, organization_type, status, updated_at)
select 'Tiara Yachts', 'Tiara Yachts', 'tiara-yachts', 'manufacturer', 'oem', 'active', now()
where not exists (
  select 1 from public.orgs where lower(slug) = 'tiara-yachts'
);

insert into public.orgs (name, display_name, slug, org_type, organization_type, status, updated_at)
select 'SkipperBud''s', 'SkipperBud''s', 'skipperbuds', 'dealer', 'dealer', 'active', now()
where not exists (
  select 1 from public.orgs where lower(slug) = 'skipperbuds'
);

insert into public.org_locations (
  organization_id,
  name,
  location_type,
  city,
  region,
  country,
  phone,
  status,
  source_name,
  source_url,
  external_source_id,
  claim_state,
  verification_state,
  metadata
)
select
  o.id,
  'Lake Fenton Marina',
  'marina',
  'Fenton',
  'MI',
  'US',
  '(810) 714-3570',
  'active',
  'SkipperBud''s marina listing',
  'https://www.skipperbuds.com/',
  'skipperbuds-lake-fenton-marina',
  'unclaimed',
  'source_reported',
  jsonb_build_object(
    'source_note', 'Seeded for Activator V1 org-location proof from SkipperBud''s published marina listing.',
    'supports_relationship_examples', jsonb_build_array('delivery_dealer', 'servicing_dealer')
  )
from public.orgs o
where lower(o.slug) = 'skipperbuds'
  and not exists (
    select 1
    from public.org_locations l
    where l.organization_id = o.id
      and lower(l.name) = 'lake fenton marina'
      and lower(coalesce(l.city, '')) = 'fenton'
      and lower(coalesce(l.region, '')) = 'mi'
  );

insert into public.asset_resources (
  resource_type,
  title,
  url,
  source_name,
  source_platform,
  source_url,
  captured_at,
  authority_state,
  rights_status,
  applies_to_type,
  applies_to_id,
  metadata
)
select
  'source_snapshot',
  '16 Tiara Yachts Dealers Awarded 2023 Marine Industry Customer Satisfaction Index Awards',
  'https://www.tiarayachts.com/news/2023-marine-industry-csi-dealership-awards',
  'Tiara Yachts',
  'Tiara Yachts website',
  'https://www.tiarayachts.com/news/2023-marine-industry-csi-dealership-awards',
  '2024-07-22'::timestamptz,
  'oem_published',
  'public_ok',
  'org',
  o.id,
  jsonb_build_object(
    'source_type', 'OEM published dealer-network evidence',
    'published_date', '2024-07-22',
    'context', '2023 Marine Industry CSI Awards',
    'temporal_scope_note', 'This source supports that Tiara identified the listed businesses as authorized dealers in this published 2023 CSI dealer list; it is not a complete current 2026 dealer-network source.',
    'relationship_semantics', 'authorized_dealer relationship is represented separately from source-specific CSI recognition.',
    'dealer_count', 16
  )
from public.orgs o
where lower(o.slug) = 'tiara-yachts'
  and not exists (
    select 1
    from public.asset_resources r
    where r.source_url = 'https://www.tiarayachts.com/news/2023-marine-industry-csi-dealership-awards'
      and r.applies_to_type = 'org'
      and r.applies_to_id = o.id
  );

insert into public.orgs (name, display_name, slug, org_type, organization_type, status, updated_at)
select seed.name, seed.name, seed.slug, 'dealer', 'dealer', 'active', now()
from (
  values
    ('Apex Marine', 'apex-marine'),
    ('Boat Management', 'boat-management'),
    ('Bosun''s Marine', 'bosuns-marine'),
    ('Coastal Carolina Yacht Sales', 'coastal-carolina-yacht-sales'),
    ('Comstock Yacht Sales & Marina', 'comstock-yacht-sales-marina'),
    ('Erickson Marine', 'erickson-marine'),
    ('Hampton Watercraft & Marine', 'hampton-watercraft-marine'),
    ('Hucks Marine & Resort', 'hucks-marine-resort'),
    ('Kelly''s Port', 'kellys-port'),
    ('Legendary Marine - Destin', 'legendary-marine-destin'),
    ('North Point Yacht Sales', 'north-point-yacht-sales'),
    ('Ocean Blue Yacht Sales', 'ocean-blue-yacht-sales'),
    ('Silver Seas Yachts', 'silver-seas-yachts'),
    ('SkipperBud''s', 'skipperbuds'),
    ('Walker''s Marine', 'walkers-marine'),
    ('Walstrom Marine', 'walstrom-marine')
) as seed(name, slug)
where not exists (
  select 1 from public.orgs o where lower(o.slug) = seed.slug
);

insert into public.org_relationships (
  from_org_id,
  to_org_id,
  relationship_type,
  status,
  source_resource_id,
  evidence_state,
  effective_from,
  metadata
)
select
  tiara.id,
  dealer.id,
  'authorized_dealer',
  'source_reported',
  resource.id,
  'oem_published',
  '2024-07-22'::date,
  jsonb_build_object(
    'source_context', '2023 Marine Industry CSI Awards',
    'source_published_date', '2024-07-22',
    'csi_recognition', seed.csi_recognition,
    'relationship_note', 'Authorized Tiara dealer relationship is represented separately from CSI capability/recognition.',
    'temporal_scope_note', 'Does not by itself prove current authorization for every 2026 location, product, or territory.'
  )
from (
  values
    ('apex-marine', 'Sales'),
    ('boat-management', 'Sales'),
    ('bosuns-marine', 'Sales'),
    ('coastal-carolina-yacht-sales', 'Sales & Service'),
    ('comstock-yacht-sales-marina', 'Sales & Service'),
    ('erickson-marine', 'Sales & Service'),
    ('hampton-watercraft-marine', 'Sales & Service'),
    ('hucks-marine-resort', 'Sales'),
    ('kellys-port', 'Sales'),
    ('legendary-marine-destin', 'Sales'),
    ('north-point-yacht-sales', 'Sales & Service'),
    ('ocean-blue-yacht-sales', 'Sales'),
    ('silver-seas-yachts', 'Service'),
    ('skipperbuds', 'Sales'),
    ('walkers-marine', 'Sales & Service'),
    ('walstrom-marine', 'Sales')
) as seed(slug, csi_recognition)
join public.orgs tiara
  on lower(tiara.slug) = 'tiara-yachts'
join public.orgs dealer
  on lower(dealer.slug) = seed.slug
join public.asset_resources resource
  on resource.source_url = 'https://www.tiarayachts.com/news/2023-marine-industry-csi-dealership-awards'
  and resource.applies_to_type = 'org'
  and resource.applies_to_id = tiara.id
where not exists (
  select 1
  from public.org_relationships existing
  where existing.from_org_id = tiara.id
    and existing.to_org_id = dealer.id
    and existing.relationship_type = 'authorized_dealer'
    and existing.source_resource_id = resource.id
);

insert into public.asset_model_templates (
  organization_id,
  asset_type,
  category,
  class,
  manufacturer,
  model,
  model_year,
  template_key,
  version,
  status,
  authority_state,
  metadata
)
select
  o.id,
  'marine',
  'boat',
  'luxury_day_boat',
  'Tiara Yachts',
  '39 LE',
  2026,
  'tiara-2026-39-le',
  1,
  'published',
  'oem_published',
  jsonb_build_object(
    'source_note', 'Seeded for Activator V1 proving path from OEM-published model/catalog material.',
    'scope', 'model',
    'not_hull_specific', true
  )
from public.orgs o
where lower(o.slug) = 'tiara-yachts'
  and not exists (
    select 1
    from public.asset_model_templates t
    where lower(t.template_key) = 'tiara-2026-39-le'
      and t.version = 1
  );

insert into public.asset_model_template_items (
  template_id,
  item_type,
  canonical_key,
  label,
  expected_value,
  applicability,
  authority_state,
  sort_order
)
select
  t.id,
  seed.item_type,
  seed.canonical_key,
  seed.label,
  seed.expected_value,
  seed.applicability,
  'model_expected',
  seed.sort_order
from public.asset_model_templates t
cross join (
  values
    ('spec', 'identity.manufacturer', 'Manufacturer', '{"value":"Tiara Yachts"}'::jsonb, '{"scope":"model"}'::jsonb, 10),
    ('spec', 'identity.model_year', 'Model year', '{"value":2026}'::jsonb, '{"scope":"model"}'::jsonb, 20),
    ('spec', 'identity.model', 'Model', '{"value":"39 LE"}'::jsonb, '{"scope":"model"}'::jsonb, 30),
    ('system', 'system.propulsion', 'Propulsion', '{"expected":"Outboard propulsion package; verify exact engines per hull."}'::jsonb, '{"scope":"model"}'::jsonb, 100),
    ('system', 'system.electrical', 'Electrical', '{"expected":"Marine electrical and battery systems; verify actual configuration per hull."}'::jsonb, '{"scope":"model"}'::jsonb, 110),
    ('system', 'system.fuel', 'Fuel system', '{"expected":"Marine fuel system; verify tankage and components per hull."}'::jsonb, '{"scope":"model"}'::jsonb, 120),
    ('system', 'system.freshwater', 'Freshwater system', '{"expected":"Freshwater system; verify capacity and equipment per hull."}'::jsonb, '{"scope":"model"}'::jsonb, 130),
    ('system', 'system.safety', 'Safety equipment', '{"expected":"Required and installed safety equipment varies by hull and owner use."}'::jsonb, '{"scope":"model"}'::jsonb, 140),
    ('equipment', 'equipment.rotating_lounge', 'Aft rotating lounge', '{"expected":"Model feature; verify installed condition per hull."}'::jsonb, '{"scope":"model"}'::jsonb, 200),
    ('equipment', 'equipment.hardtop', 'Integrated hardtop', '{"expected":"Model feature; verify actual configuration per hull."}'::jsonb, '{"scope":"model"}'::jsonb, 210),
    ('resource', 'resource.oem_model_page', 'OEM model page', '{"resource_type":"model_page","authority":"oem_published"}'::jsonb, '{"scope":"model"}'::jsonb, 300),
    ('playbook', 'playbook.annual_winterization', 'Annual Winterization', '{"default_interval":{"frequency":"yearly"},"default_responsible_relationship_type":"servicing_dealer"}'::jsonb, '{"asset_type":"marine","seasonal":true}'::jsonb, 400)
) as seed(item_type, canonical_key, label, expected_value, applicability, sort_order)
where lower(t.template_key) = 'tiara-2026-39-le'
  and t.version = 1
  and not exists (
    select 1
    from public.asset_model_template_items i
    where i.template_id = t.id
      and lower(i.canonical_key) = lower(seed.canonical_key)
  );
