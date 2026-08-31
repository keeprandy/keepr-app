-- Brand graph and KAC dealer assignment V1.
--
-- Brand relationships establish network eligibility.
-- Asset/KAC relationships establish operational participation.
-- Permissions determine visibility and actions.

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
  constraint brands_status_check
    check (status in ('active', 'inactive', 'archived'))
);

create unique index if not exists brands_slug_uidx
  on public.brands (lower(slug));

create unique index if not exists brands_name_uidx
  on public.brands (lower(name));

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
  constraint organization_brand_relationships_type_check
    check (relationship_type in (
      'owns_brand',
      'manufactures_brand',
      'manages_brand',
      'distributes_brand',
      'authorized_dealer_for',
      'represents_brand',
      'services_brand'
    )),
  constraint organization_brand_relationships_status_check
    check (status in ('source_reported', 'active', 'inactive', 'superseded', 'disputed')),
  constraint organization_brand_relationships_evidence_state_check
    check (evidence_state in ('source_reported', 'public_source_reported', 'org_confirmed', 'evidence_verified', 'superseded', 'disputed')),
  constraint organization_brand_relationships_effective_check
    check (effective_to is null or effective_from is null or effective_to >= effective_from)
);

alter table public.organization_brand_relationships
  drop constraint if exists organization_brand_relationships_evidence_state_check;

alter table public.organization_brand_relationships
  add constraint organization_brand_relationships_evidence_state_check
  check (evidence_state in ('source_reported', 'public_source_reported', 'org_confirmed', 'evidence_verified', 'superseded', 'disputed'));

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

alter table public.asset_relationships
  drop constraint if exists asset_relationships_type_check;

alter table public.asset_relationships
  add constraint asset_relationships_type_check
  check (
    relationship_type in (
      'owner',
      'steward',
      'oem',
      'assigned_dealer',
      'selling_dealer',
      'delivery_dealer',
      'servicing_dealer',
      'service_provider',
      'stewardship_provider',
      'storage_provider'
    )
  );

create or replace function public.keeprspace_default_access_scope(p_relationship_type text)
returns text
language sql
immutable
as $$
  select case
    when p_relationship_type = 'owner' then 'owner_full'
    when p_relationship_type in ('servicing_dealer', 'service_provider') then 'service_workspace'
    when p_relationship_type = 'stewardship_provider' then 'stewardship_workspace'
    when p_relationship_type = 'storage_provider' then 'storage_workspace'
    when p_relationship_type in ('assigned_dealer', 'selling_dealer') then 'dealer_sales_workspace'
    when p_relationship_type = 'delivery_dealer' then 'dealer_delivery_workspace'
    when p_relationship_type = 'oem' then 'oem_context'
    else 'public_context'
  end;
$$;

create or replace function public.keepr_brand_slug(p_name text)
returns text
language sql
immutable
as $$
  select coalesce(nullif(public.keepr_slugify(p_name), ''), 'brand');
$$;

create or replace function public.upsert_brand_by_name(
  p_name text,
  p_website text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_slug text;
  v_brand_id uuid;
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized to create or manage brands';
  end if;

  if v_name is null then
    raise exception 'brand name is required';
  end if;

  v_slug := public.keepr_brand_slug(v_name);

  insert into public.brands (
    name,
    slug,
    website,
    metadata,
    created_by,
    updated_at
  )
  values (
    v_name,
    v_slug,
    nullif(trim(coalesce(p_website, '')), ''),
    coalesce(p_metadata, '{}'::jsonb),
    auth.uid(),
    now()
  )
  on conflict (lower(slug))
  do update set
    name = excluded.name,
    website = coalesce(excluded.website, public.brands.website),
    metadata = coalesce(public.brands.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now()
  returning id into v_brand_id;

  return v_brand_id;
end;
$$;

create or replace function public.upsert_organization_brand_relationship(
  p_organization_id uuid,
  p_brand_id uuid,
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
  v_relationship_type text := lower(coalesce(nullif(trim(coalesce(p_relationship_type, '')), ''), 'represents_brand'));
  v_status text := lower(coalesce(nullif(trim(coalesce(p_status, '')), ''), 'active'));
  v_relationship public.organization_brand_relationships%rowtype;
begin
  if p_organization_id is null or p_brand_id is null then
    raise exception 'organization_id and brand_id are required';
  end if;

  if not (
    public.is_keepr_internal_admin(v_actor_user_id)
    or public.activator_user_can_act_for_org(v_actor_user_id, p_organization_id)
  ) then
    raise exception 'not authorized to manage organization brand relationships';
  end if;

  if v_relationship_type not in (
    'owns_brand',
    'manufactures_brand',
    'manages_brand',
    'distributes_brand',
    'authorized_dealer_for',
    'represents_brand',
    'services_brand'
  ) then
    raise exception 'unsupported organization brand relationship_type: %', p_relationship_type;
  end if;

  if v_status not in ('source_reported', 'active', 'inactive', 'superseded', 'disputed') then
    raise exception 'unsupported relationship status: %', p_status;
  end if;

  insert into public.organization_brand_relationships (
    organization_id,
    brand_id,
    relationship_type,
    status,
    evidence_state,
    metadata,
    created_by,
    updated_at
  )
  values (
    p_organization_id,
    p_brand_id,
    v_relationship_type,
    v_status,
    case when public.is_keepr_internal_admin(v_actor_user_id) then 'org_confirmed' else 'source_reported' end,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'organization_brand_relationship',
      'assigned_by', v_actor_user_id,
      'assigned_at', now()
    ),
    v_actor_user_id,
    now()
  )
  on conflict (organization_id, brand_id, relationship_type)
    where status in ('source_reported', 'active')
  do update set
    status = excluded.status,
    evidence_state = excluded.evidence_state,
    metadata = coalesce(public.organization_brand_relationships.metadata, '{}'::jsonb)
      || coalesce(p_metadata, '{}'::jsonb)
      || jsonb_build_object(
        'source', 'organization_brand_relationship',
        'assigned_by', v_actor_user_id,
        'assigned_at', now()
      ),
    updated_at = now()
  returning * into v_relationship;

  if public.is_keepr_internal_admin(v_actor_user_id) then
    perform public.keepr_admin_record_audit_event(
      v_actor_user_id,
      'organization.brand_relationship.upserted',
      p_organization_id,
      'organization_brand_relationship',
      v_relationship.id::text,
      'success',
      jsonb_build_object(
        'organization_id', p_organization_id,
        'brand_id', p_brand_id,
        'relationship_type', v_relationship_type,
        'status', v_status
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'relationship', to_jsonb(v_relationship)
  );
end;
$$;

create or replace function public.organization_is_eligible_dealer_for_brand(
  p_dealer_org_id uuid,
  p_brand_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_brand_relationships r
    where r.organization_id = p_dealer_org_id
      and r.brand_id = p_brand_id
      and r.relationship_type in ('authorized_dealer_for', 'represents_brand')
      and r.status = 'active'
      and r.evidence_state in ('org_confirmed', 'evidence_verified')
  );
$$;

create or replace function public.assign_kac_dealer(
  p_asset_id uuid,
  p_dealer_org_id uuid,
  p_relationship_type text default 'assigned_dealer',
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_asset public.assets%rowtype;
  v_template public.asset_model_templates%rowtype;
  v_brand public.brands%rowtype;
  v_dealer public.orgs%rowtype;
  v_relationship_type text := lower(coalesce(nullif(trim(coalesce(p_relationship_type, '')), ''), 'assigned_dealer'));
  v_asset_relationship public.asset_relationships%rowtype;
begin
  if v_actor_user_id is null then
    raise exception 'not authenticated';
  end if;

  if p_asset_id is null or p_dealer_org_id is null then
    raise exception 'asset_id and dealer_org_id are required';
  end if;

  if v_relationship_type not in ('assigned_dealer', 'selling_dealer', 'delivery_dealer', 'servicing_dealer') then
    raise exception 'unsupported dealer asset relationship_type: %', p_relationship_type;
  end if;

  select *
  into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null;

  if v_asset.id is null then
    raise exception 'asset not found';
  end if;

  select t.*
  into v_template
  from public.asset_template_bindings b
  join public.asset_model_templates t on t.id = b.template_id
  where b.asset_id = v_asset.id
    and b.binding_status in ('suggested', 'inherited', 'verified')
  order by case b.binding_status when 'verified' then 0 when 'inherited' then 1 else 2 end, b.created_at desc
  limit 1;

  if v_template.id is null then
    raise exception 'asset has no model template binding';
  end if;

  if not (
    public.activator_user_can_act_for_org(v_actor_user_id, v_template.organization_id)
    or public.is_keepr_internal_admin(v_actor_user_id)
  ) then
    raise exception 'not authorized to assign dealer for this KAC';
  end if;

  if v_template.brand_id is null then
    raise exception 'model template has no brand_id';
  end if;

  select *
  into v_brand
  from public.brands
  where id = v_template.brand_id
    and status = 'active';

  if v_brand.id is null then
    raise exception 'brand not found for model template';
  end if;

  select *
  into v_dealer
  from public.orgs
  where id = p_dealer_org_id
    and coalesce(status, 'active') = 'active';

  if v_dealer.id is null then
    raise exception 'dealer organization not found';
  end if;

  if not public.organization_is_eligible_dealer_for_brand(v_dealer.id, v_brand.id) then
    raise exception 'dealer is not eligible for this brand';
  end if;

  insert into public.asset_relationships (
    asset_id,
    organization_id,
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
    v_dealer.id,
    v_relationship_type,
    'active',
    public.keeprspace_default_access_scope(v_relationship_type),
    'claimed_org',
    v_actor_user_id,
    v_template.organization_id,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'assign_kac_dealer',
      'brand_id', v_brand.id,
      'brand_name', v_brand.name,
      'template_id', v_template.id,
      'template_key', v_template.template_key,
      'assigned_by', v_actor_user_id,
      'assigned_at', now()
    )
  )
  on conflict (asset_id, organization_id, relationship_type, coalesce(org_location_id, '00000000-0000-0000-0000-000000000000'::uuid))
    where status = 'active' and organization_id is not null
  do update set
    access_scope = excluded.access_scope,
    claim_state = excluded.claim_state,
    initiated_by_user_id = excluded.initiated_by_user_id,
    initiated_by_org_id = excluded.initiated_by_org_id,
    metadata = coalesce(public.asset_relationships.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now()
  returning * into v_asset_relationship;

  if public.is_keepr_internal_admin(v_actor_user_id) then
    perform public.keepr_admin_record_audit_event(
      v_actor_user_id,
      'kac.dealer.assigned',
      v_dealer.id,
      'asset_relationship',
      v_asset_relationship.id::text,
      'success',
      jsonb_build_object(
        'asset_id', v_asset.id,
        'kac_id', v_asset.kac_id,
        'dealer_org_id', v_dealer.id,
        'brand_id', v_brand.id,
        'template_id', v_template.id,
        'relationship_type', v_relationship_type
      )
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'asset', jsonb_build_object('id', v_asset.id, 'kac_id', v_asset.kac_id),
    'brand', to_jsonb(v_brand),
    'template', to_jsonb(v_template),
    'dealer_organization', to_jsonb(v_dealer),
    'asset_relationship', to_jsonb(v_asset_relationship)
  );
end;
$$;

create or replace function public.get_organization_brand_graph(p_organization_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'organization_id', p_organization_id,
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object(
        'relationship_id', r.id,
        'relationship_type', r.relationship_type,
        'status', r.status,
        'brand', to_jsonb(b),
        'model_count', (
          select count(*)
          from public.asset_model_templates t
          where t.brand_id = b.id
            and t.status <> 'retired'
        )
      ) order by r.relationship_type, b.name)
      from public.organization_brand_relationships r
      join public.brands b on b.id = r.brand_id
      where r.organization_id = p_organization_id
        and r.status in ('source_reported', 'active')
    ), '[]'::jsonb),
    'assigned_kacs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'relationship_id', ar.id,
        'relationship_type', ar.relationship_type,
        'access_scope', ar.access_scope,
        'asset', jsonb_build_object(
          'id', a.id,
          'kac_id', a.kac_id,
          'name', a.name,
          'make', a.make,
          'model', a.model,
          'year', a.year
        ),
        'brand_id', ar.metadata ->> 'brand_id',
        'template_key', ar.metadata ->> 'template_key'
      ) order by ar.created_at desc)
      from public.asset_relationships ar
      join public.assets a on a.id = ar.asset_id and a.deleted_at is null
      where ar.organization_id = p_organization_id
        and ar.relationship_type in ('assigned_dealer', 'selling_dealer', 'delivery_dealer', 'servicing_dealer')
        and ar.status = 'active'
    ), '[]'::jsonb)
  )
  where public.is_keepr_internal_admin(auth.uid())
     or public.activator_user_can_act_for_org(auth.uid(), p_organization_id);
$$;

insert into public.brands (name, slug, status, metadata, updated_at)
select distinct
  trim(t.manufacturer) as name,
  public.keepr_brand_slug(trim(t.manufacturer)) as slug,
  'active',
  jsonb_build_object('source', 'asset_model_templates.manufacturer'),
  now()
from public.asset_model_templates t
where nullif(trim(t.manufacturer), '') is not null
on conflict (lower(slug)) do update
set name = excluded.name,
    metadata = coalesce(public.brands.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

insert into public.brands (name, slug, status, website, metadata, updated_at)
select distinct
  trim(coalesce(nullif(o.display_name, ''), o.name)) as name,
  public.keepr_brand_slug(trim(coalesce(nullif(o.display_name, ''), o.name))) as slug,
  'active',
  nullif(o.source_url, ''),
  jsonb_build_object('source', 'legacy_brand_like_org', 'legacy_org_id', o.id),
  now()
from public.orgs o
where nullif(trim(coalesce(nullif(o.display_name, ''), o.name)), '') is not null
  and (
    lower(coalesce(o.org_type, '')) in ('brand', 'manufacturer')
    or lower(coalesce(o.organization_type, '')) in ('brand', 'oem', 'manufacturer')
  )
on conflict (lower(slug)) do update
set website = coalesce(excluded.website, public.brands.website),
    metadata = coalesce(public.brands.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

update public.asset_model_templates t
set brand_id = b.id,
    metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object('brand_backfilled_from', 'manufacturer')
from public.brands b
where t.brand_id is null
  and lower(b.name) = lower(trim(t.manufacturer));

insert into public.organization_brand_relationships (
  organization_id,
  brand_id,
  relationship_type,
  status,
  evidence_state,
  source_org_relationship_id,
  metadata,
  created_by,
  updated_at
)
select
  r.from_org_id,
  b.id,
  case r.relationship_type
    when 'authorized_dealer' then 'authorized_dealer_for'
    else 'represents_brand'
  end,
  r.status,
  coalesce(nullif(r.evidence_state, ''), 'source_reported'),
  r.id,
  coalesce(r.metadata, '{}'::jsonb) || jsonb_build_object(
    'source', 'legacy_org_relationship_backfill',
    'legacy_relationship_type', r.relationship_type,
    'legacy_to_org_id', r.to_org_id
  ),
  r.created_by,
  now()
from public.org_relationships r
join public.orgs o on o.id = r.to_org_id
join public.brands b on lower(b.name) = lower(trim(coalesce(nullif(o.display_name, ''), o.name)))
where r.relationship_type in ('represented_brand', 'authorized_dealer')
  and r.status in ('source_reported', 'active')
on conflict (organization_id, brand_id, relationship_type)
  where status in ('source_reported', 'active')
do update set
  status = excluded.status,
  evidence_state = excluded.evidence_state,
  source_org_relationship_id = coalesce(public.organization_brand_relationships.source_org_relationship_id, excluded.source_org_relationship_id),
  metadata = coalesce(public.organization_brand_relationships.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

insert into public.organization_brand_relationships (
  organization_id,
  brand_id,
  relationship_type,
  status,
  evidence_state,
  metadata,
  created_by,
  updated_at
)
select distinct
  pairs.organization_id,
  pairs.brand_id,
  'manufactures_brand',
  'active',
  'org_confirmed',
  jsonb_build_object('source', 'asset_model_templates.organization_id_backfill'),
  pairs.created_by,
  now()
from (
  select
    t.organization_id,
    t.brand_id,
    min(t.created_by::text)::uuid as created_by
  from public.asset_model_templates t
  where t.brand_id is not null
  group by t.organization_id, t.brand_id
) pairs
on conflict (organization_id, brand_id, relationship_type)
  where status in ('source_reported', 'active')
do update set
  status = excluded.status,
  evidence_state = excluded.evidence_state,
  metadata = coalesce(public.organization_brand_relationships.metadata, '{}'::jsonb) || excluded.metadata,
  updated_at = now();

grant select on public.brands to authenticated;
grant select on public.organization_brand_relationships to authenticated;
grant execute on function public.upsert_brand_by_name(text, text, jsonb) to authenticated;
grant execute on function public.upsert_organization_brand_relationship(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.organization_is_eligible_dealer_for_brand(uuid, uuid) to authenticated;
grant execute on function public.assign_kac_dealer(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.get_organization_brand_graph(uuid) to authenticated;

comment on table public.brands is
  'First-class commercial brand node. Organizations connect to brands through relationship rows; ownership and representation are not single fields.';

comment on table public.organization_brand_relationships is
  'Organization-to-brand network graph. These rows establish eligibility/context only; KAC visibility comes from asset_relationships and permissions.';

comment on function public.assign_kac_dealer(uuid, uuid, text, jsonb) is
  'Validates dealer eligibility through the KAC model brand, then writes the KAC-specific operational asset relationship.';
