-- Production convergence schema reconciliation.
-- DO NOT RUN until explicitly approved.
-- Baseline: production project jjzjuqxysucqutgjnrkk as inspected on 2026-09-04.
-- Intent: create only release-critical missing platform objects and columns.
-- This file does not promote Tiara/Bennington/Wilson reference rows.

begin;

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  status text not null default 'active',
  website text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint brands_status_check check (status in ('active', 'inactive', 'archived'))
);

create unique index if not exists brands_slug_uidx on public.brands (lower(slug));
create unique index if not exists brands_name_uidx on public.brands (lower(name));
alter table public.brands enable row level security;

drop policy if exists brands_authenticated_read on public.brands;
create policy brands_authenticated_read
on public.brands
for select
to authenticated
using (status = 'active' or public.is_keepr_internal_admin(auth.uid()));

create table if not exists public.organization_brand_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete cascade,
  brand_id uuid not null references public.brands(id) on delete cascade,
  relationship_type text not null,
  status text not null default 'active',
  evidence_state text not null default 'source_reported',
  source_org_relationship_id uuid references public.org_relationships(id) on delete set null,
  source_resource_id uuid references public.asset_resources(id) on delete set null,
  effective_from date,
  effective_to date,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_brand_relationships_type_check check (
    relationship_type in (
      'owns_brand',
      'manufactures_brand',
      'manages_brand',
      'distributes_brand',
      'authorized_dealer_for',
      'represents_brand',
      'services_brand'
    )
  ),
  constraint organization_brand_relationships_status_check check (
    status in ('source_reported', 'active', 'inactive', 'superseded', 'disputed')
  ),
  constraint organization_brand_relationships_evidence_state_check check (
    evidence_state in ('source_reported', 'public_source_reported', 'org_confirmed', 'evidence_verified', 'superseded', 'disputed')
  ),
  constraint organization_brand_relationships_effective_check check (
    effective_to is null or effective_from is null or effective_to >= effective_from
  )
);

create unique index if not exists organization_brand_relationships_active_uidx
  on public.organization_brand_relationships (organization_id, brand_id, relationship_type)
  where status in ('source_reported', 'active');

create index if not exists organization_brand_relationships_org_idx
  on public.organization_brand_relationships (organization_id, relationship_type, status);

create index if not exists organization_brand_relationships_brand_idx
  on public.organization_brand_relationships (brand_id, relationship_type, status);

alter table public.organization_brand_relationships enable row level security;

drop policy if exists organization_brand_relationships_authenticated_read on public.organization_brand_relationships;
create policy organization_brand_relationships_authenticated_read
on public.organization_brand_relationships
for select
to authenticated
using (
  status in ('source_reported', 'active')
  or public.is_keepr_internal_admin(auth.uid())
  or public.activator_user_can_act_for_org(auth.uid(), organization_id)
);

alter table public.asset_model_templates
  add column if not exists brand_id uuid references public.brands(id) on delete set null;

create index if not exists asset_model_templates_brand_idx
  on public.asset_model_templates (brand_id, status)
  where brand_id is not null;

create table if not exists public.system_templates (
  id uuid primary key default gen_random_uuid(),
  canonical_key text not null,
  name text not null,
  manufacturer text,
  supplier_org_id uuid references public.orgs(id) on delete set null,
  owner_org_id uuid references public.orgs(id) on delete set null,
  system_category text,
  description text,
  authority_state text not null default 'keepr_curated',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint system_templates_key_uidx unique (canonical_key),
  constraint system_templates_authority_check check (
    authority_state in ('draft', 'keepr_curated', 'supplier_verified', 'oem_verified', 'official', 'retired')
  )
);

create index if not exists system_templates_owner_org_idx on public.system_templates (owner_org_id);
create index if not exists system_templates_supplier_org_idx on public.system_templates (supplier_org_id);
alter table public.system_templates enable row level security;

drop policy if exists "Readable system templates" on public.system_templates;
create policy "Readable system templates"
on public.system_templates
for select
to authenticated
using (
  authority_state <> 'retired'
  or (
    owner_org_id is not null
    and public.activator_user_can_act_for_org(auth.uid(), owner_org_id)
  )
);

drop policy if exists "Owner org manages system templates" on public.system_templates;
create policy "Owner org manages system templates"
on public.system_templates
for all
to authenticated
using (
  owner_org_id is not null
  and public.activator_user_can_act_for_org(auth.uid(), owner_org_id)
)
with check (
  owner_org_id is not null
  and public.activator_user_can_act_for_org(auth.uid(), owner_org_id)
);

alter table public.asset_model_template_items
  add column if not exists system_template_id uuid references public.system_templates(id) on delete set null;

alter table public.systems
  add column if not exists system_template_id uuid references public.system_templates(id) on delete set null;

alter table public.systems
  add column if not exists system_group_id uuid;

create index if not exists asset_model_template_items_system_template_idx
  on public.asset_model_template_items (system_template_id);

create index if not exists systems_system_template_idx
  on public.systems (system_template_id);

create index if not exists systems_system_group_idx
  on public.systems (system_group_id);

alter table public.attachment_placements
  drop constraint if exists attachment_placements_target_type_check;

alter table public.attachment_placements
  add constraint attachment_placements_target_type_check
  check (
    target_type in (
      'asset',
      'system',
      'service_record',
      'event',
      'model_template',
      'system_template',
      'org'
    )
  );

alter table public.asset_resources
  drop constraint if exists asset_resources_applies_to_check;

alter table public.asset_resources
  add constraint asset_resources_applies_to_check
  check (
    applies_to_type in (
      'org',
      'org_relationship',
      'template',
      'template_item',
      'system_template',
      'asset',
      'system',
      'component',
      'relationship',
      'workflow',
      'fact',
      'service_record',
      'playbook'
    )
  );

alter table public.asset_resources
  add column if not exists role text;

alter table public.asset_resources
  add column if not exists public_url_allowed boolean not null default false;

alter table public.asset_resources
  add column if not exists public_link_allowed boolean not null default false;

create table if not exists public.keepr_links (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  normalized_address text not null,
  object_type text not null,
  object_id uuid not null,
  is_canonical boolean not null default true,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint keepr_links_object_type_check check (
    object_type in (
      'organization',
      'asset_model_template',
      'system_template',
      'asset',
      'system_instance',
      'resource',
      'playbook'
    )
  ),
  constraint keepr_links_status_check check (status in ('active', 'retired', 'reserved'))
);

create unique index if not exists keepr_links_normalized_active_uidx
  on public.keepr_links (normalized_address)
  where status = 'active';

create unique index if not exists keepr_links_canonical_object_uidx
  on public.keepr_links (object_type, object_id)
  where status = 'active' and is_canonical;

create index if not exists keepr_links_object_idx
  on public.keepr_links (object_type, object_id, status);

alter table public.keepr_links enable row level security;

drop policy if exists keepr_links_public_read_active on public.keepr_links;
create policy keepr_links_public_read_active
on public.keepr_links
for select
to anon, authenticated
using (status = 'active');

drop policy if exists keepr_links_internal_admin_manage on public.keepr_links;
create policy keepr_links_internal_admin_manage
on public.keepr_links
for all
to authenticated
using (public.is_keepr_internal_admin(auth.uid()))
with check (public.is_keepr_internal_admin(auth.uid()));

create table if not exists public.exact_build_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete restrict,
  template_id uuid not null references public.asset_model_templates(id) on delete restrict,
  asset_id uuid references public.assets(id) on delete set null,
  draft_key text not null,
  display_name text not null,
  status text not null default 'draft',
  source_type text not null default 'manual',
  source_resource_id uuid references public.asset_resources(id) on delete set null,
  work_order_number text,
  hin text,
  build_year integer,
  dealer_name text,
  customer_name text,
  build_date date,
  expected_completion_date date,
  identity jsonb not null default '{}'::jsonb,
  finish_selections jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  constraint exact_build_drafts_status_check
    check (status in ('draft', 'in_review', 'factory_frozen', 'published', 'retired')),
  constraint exact_build_drafts_source_type_check
    check (source_type in ('manual', 'build_sheet', 'factory_work_order', 'csv', 'api', 'llm_proposed'))
);

create unique index if not exists exact_build_drafts_org_key_uidx
  on public.exact_build_drafts (organization_id, lower(draft_key));

create index if not exists exact_build_drafts_org_status_idx
  on public.exact_build_drafts (organization_id, status, updated_at desc);

create index if not exists exact_build_drafts_template_idx
  on public.exact_build_drafts (template_id, status, updated_at desc);

create table if not exists public.exact_build_draft_items (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid not null references public.exact_build_drafts(id) on delete cascade,
  template_item_id uuid references public.asset_model_template_items(id) on delete set null,
  item_key text not null,
  state text not null default 'unselected',
  quantity numeric,
  value jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  notes text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint exact_build_draft_items_state_check
    check (state in ('selected', 'unselected', 'overridden', 'unknown'))
);

create unique index if not exists exact_build_draft_items_template_item_uidx
  on public.exact_build_draft_items (draft_id, template_item_id)
  where template_item_id is not null;

create unique index if not exists exact_build_draft_items_key_uidx
  on public.exact_build_draft_items (draft_id, lower(item_key));

create index if not exists exact_build_draft_items_draft_idx
  on public.exact_build_draft_items (draft_id, state);

alter table public.exact_build_drafts enable row level security;
alter table public.exact_build_draft_items enable row level security;

drop policy if exists "Exact build drafts are readable by org members" on public.exact_build_drafts;
create policy "Exact build drafts are readable by org members"
on public.exact_build_drafts
for select
to authenticated
using (public.activator_user_can_act_for_org(auth.uid(), organization_id));

drop policy if exists "Exact build drafts are manageable by org members" on public.exact_build_drafts;
create policy "Exact build drafts are manageable by org members"
on public.exact_build_drafts
for all
to authenticated
using (public.activator_user_can_act_for_org(auth.uid(), organization_id))
with check (public.activator_user_can_act_for_org(auth.uid(), organization_id));

drop policy if exists "Exact build draft items are readable by org members" on public.exact_build_draft_items;
create policy "Exact build draft items are readable by org members"
on public.exact_build_draft_items
for select
to authenticated
using (
  exists (
    select 1
    from public.exact_build_drafts d
    where d.id = draft_id
      and public.activator_user_can_act_for_org(auth.uid(), d.organization_id)
  )
);

drop policy if exists "Exact build draft items are manageable by org members" on public.exact_build_draft_items;
create policy "Exact build draft items are manageable by org members"
on public.exact_build_draft_items
for all
to authenticated
using (
  exists (
    select 1
    from public.exact_build_drafts d
    where d.id = draft_id
      and public.activator_user_can_act_for_org(auth.uid(), d.organization_id)
  )
)
with check (
  exists (
    select 1
    from public.exact_build_drafts d
    where d.id = draft_id
      and public.activator_user_can_act_for_org(auth.uid(), d.organization_id)
  )
);

drop policy if exists "Readable system template attachment placements" on public.attachment_placements;
create policy "Readable system template attachment placements"
on public.attachment_placements
for select
to authenticated
using (
  target_type = 'system_template'
  and exists (
    select 1
    from public.system_templates st
    where st.id = attachment_placements.target_id
      and (
        st.authority_state <> 'retired'
        or (
          st.owner_org_id is not null
          and public.activator_user_can_act_for_org(auth.uid(), st.owner_org_id)
        )
      )
  )
);

drop policy if exists "Org members read org attachment placements" on public.attachment_placements;
create policy "Org members read org attachment placements"
on public.attachment_placements
for select
to authenticated
using (
  target_type = 'org'
  and public.activator_user_can_act_for_org(auth.uid(), target_id)
);

drop policy if exists "Org members create org attachment placements" on public.attachment_placements;
create policy "Org members create org attachment placements"
on public.attachment_placements
for insert
to authenticated
with check (
  target_type = 'org'
  and public.activator_user_can_act_for_org(auth.uid(), target_id)
  and exists (
    select 1
    from public.attachments attachment
    where attachment.id = attachment_placements.attachment_id
      and (
        attachment.owner_user_id = auth.uid()
        or attachment.org_id = attachment_placements.target_id
      )
  )
);

drop policy if exists "Org members update org attachment placements" on public.attachment_placements;
create policy "Org members update org attachment placements"
on public.attachment_placements
for update
to authenticated
using (
  target_type = 'org'
  and public.activator_user_can_act_for_org(auth.uid(), target_id)
)
with check (
  target_type = 'org'
  and public.activator_user_can_act_for_org(auth.uid(), target_id)
);

drop policy if exists "Org members delete org attachment placements" on public.attachment_placements;
create policy "Org members delete org attachment placements"
on public.attachment_placements
for delete
to authenticated
using (
  target_type = 'org'
  and public.activator_user_can_act_for_org(auth.uid(), target_id)
);

drop policy if exists "Org members update org resource attachments" on public.attachments;
create policy "Org members update org resource attachments"
on public.attachments
for update
to authenticated
using (
  org_id is not null
  and public.activator_user_can_act_for_org(auth.uid(), org_id)
)
with check (
  org_id is not null
  and public.activator_user_can_act_for_org(auth.uid(), org_id)
);

drop policy if exists "Org members delete owned resource descriptors" on public.asset_resources;
create policy "Org members delete owned resource descriptors"
on public.asset_resources
for delete
to authenticated
using (
  (
    applies_to_type = 'org'
    and applies_to_id is not null
    and public.activator_user_can_act_for_org(auth.uid(), applies_to_id)
  )
  or exists (
    select 1
    from public.asset_model_templates t
    where t.id = asset_resources.applies_to_id
      and asset_resources.applies_to_type = 'template'
      and public.activator_user_can_act_for_org(auth.uid(), t.organization_id)
  )
);

grant select on public.brands to authenticated;
grant select on public.organization_brand_relationships to authenticated;
grant select on public.keepr_links to anon, authenticated;
grant select, insert, update on public.exact_build_drafts to authenticated;
grant select, insert, update on public.exact_build_draft_items to authenticated;
grant delete on public.asset_resources to authenticated;

commit;
