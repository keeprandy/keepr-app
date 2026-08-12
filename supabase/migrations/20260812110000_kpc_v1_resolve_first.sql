-- KPC V1 resolve-first foundation.
-- A KPC is the existing canonical org/provider identity: public.orgs + public.keepr_pros.
-- This migration does not create a KPC table.

alter table public.orgs
  add column if not exists kpc_category text,
  add column if not exists kpc_capabilities jsonb not null default '[]'::jsonb;

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

create or replace function public.kpc_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profile_kpc_relationships_touch_updated_at on public.profile_kpc_relationships;
create trigger profile_kpc_relationships_touch_updated_at
  before update on public.profile_kpc_relationships
  for each row
  execute function public.kpc_touch_updated_at();

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
  select jsonb_strip_nulls(jsonb_build_object(
    'kpc_id', coalesce('org:' || o.id::text, 'keepr_pro:' || kp.id::text),
    'organization_id', o.id,
    'keepr_pro_id', kp.id,
    'owner_kpc_relationship_id', p_saved_relationship_id,
    'display_name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), nullif(kp.display_name, ''), kp.name),
    'name', coalesce(nullif(o.name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), kp.display_name),
    'slug', coalesce(nullif(o.slug, ''), nullif(kp.slug, '')),
    'category', public.kpc_default_category(o.kpc_category, o.org_type, o.organization_type, o.workspace_type, kp.categories),
    'capabilities', public.kpc_effective_capabilities(
      o.org_type,
      o.organization_type,
      o.workspace_type,
      o.workspace_capabilities,
      o.kpc_capabilities,
      kp.categories,
      kp.category
    ),
    'claim_state', coalesce(nullif(kp.claimed_state, ''), nullif(o.authority_state, ''), 'unclaimed'),
    'profile_status', coalesce(nullif(kp.profile_status, ''), nullif(kp.publish_status, ''), nullif(o.status, ''), 'active'),
    'publish_status', kp.publish_status,
    'organization_type', coalesce(nullif(o.organization_type, ''), nullif(o.org_type, '')),
    'workspace_type', o.workspace_type,
    'phone', kp.phone,
    'email', kp.email,
    'website', kp.website,
    'domain', coalesce(public.kpc_normalize_domain(kp.website), public.kpc_domain_from_email(kp.email)),
    'location', public.kpc_location_label(kp.location, kp.city, kp.state, o.id),
    'logo_url', coalesce(nullif(kp.logo_url, ''), nullif(kp.avatar_url, '')),
    'header_image_url', kp.header_image_url,
    'short_description', coalesce(nullif(kp.short_description, ''), nullif(kp.public_description, ''), nullif(kp.notes, '')),
    'source', p_source,
    'match', jsonb_build_object(
      'score', p_score,
      'reason', p_match_reason
    )
  ))
  from (select p_organization_id as organization_id, p_keepr_pro_id as keepr_pro_id) input
  left join public.orgs o
    on o.id = input.organization_id
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
  limit 1;
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

create or replace function public.get_kpc_duplicate_report(
  p_terms text[] default array['Wilson Marine', 'Tiara Yachts']
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_report jsonb;
begin
  if auth.role() <> 'service_role'
     and (auth.uid() is null or not public.keeprspace_user_can_seed_org(auth.uid())) then
    raise exception 'Not authorized to inspect KPC duplicate reports';
  end if;

  with terms as (
    select unnest(coalesce(p_terms, array[]::text[])) as term
  ),
  term_reports as (
    select
      t.term,
      jsonb_build_object(
        'term', t.term,
        'orgs', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', o.id,
            'name', o.name,
            'display_name', o.display_name,
            'slug', o.slug,
            'org_type', o.org_type,
            'organization_type', o.organization_type,
            'workspace_type', o.workspace_type,
            'authority_state', o.authority_state,
            'kpc_category', o.kpc_category,
            'kpc_capabilities', o.kpc_capabilities,
            'status', o.status
          ) order by o.created_at asc nulls last), '[]'::jsonb)
          from public.orgs o
          where public.kpc_normalize_text(coalesce(o.display_name, o.name)) like '%' || public.kpc_normalize_text(t.term) || '%'
             or public.kpc_slugify(coalesce(o.slug, o.display_name, o.name)) = public.kpc_slugify(t.term)
        ),
        'keepr_pros', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', kp.id,
            'organization_id', kp.organization_id,
            'user_id', kp.user_id,
            'name', kp.name,
            'display_name', kp.display_name,
            'slug', kp.slug,
            'category', kp.category,
            'categories', kp.categories,
            'claimed_state', kp.claimed_state,
            'profile_status', kp.profile_status,
            'publish_status', kp.publish_status,
            'website', kp.website,
            'phone', kp.phone,
            'email', kp.email,
            'source', kp.source,
            'source_metadata', kp.source_metadata
          ) order by (kp.organization_id is null), kp.created_at asc nulls last), '[]'::jsonb)
          from public.keepr_pros kp
          left join public.orgs o
            on o.id = kp.organization_id
          where public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) like '%' || public.kpc_normalize_text(t.term) || '%'
             or public.kpc_slugify(coalesce(kp.slug, o.slug, kp.display_name, kp.name, o.display_name, o.name)) = public.kpc_slugify(t.term)
        ),
        'owner_scoped_keepr_pros', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', kp.id,
            'organization_id', kp.organization_id,
            'user_id', kp.user_id,
            'name', kp.name,
            'claimed_state', kp.claimed_state,
            'profile_status', kp.profile_status
          ) order by kp.created_at asc nulls last), '[]'::jsonb)
          from public.keepr_pros kp
          where kp.user_id is not null
            and public.kpc_normalize_text(coalesce(kp.display_name, kp.name)) like '%' || public.kpc_normalize_text(t.term) || '%'
        ),
        'asset_relationships', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', ar.id,
            'asset_id', ar.asset_id,
            'organization_id', ar.organization_id,
            'keepr_pro_id', ar.keepr_pro_id,
            'relationship_type', ar.relationship_type,
            'status', ar.status,
            'access_scope', ar.access_scope,
            'claim_state', ar.claim_state
          ) order by ar.created_at asc nulls last), '[]'::jsonb)
          from public.asset_relationships ar
          left join public.orgs o
            on o.id = ar.organization_id
          left join public.keepr_pros kp
            on kp.id = ar.keepr_pro_id
          where public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) like '%' || public.kpc_normalize_text(t.term) || '%'
        ),
        'stewardship_references', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'id', aps.id,
            'asset_id', aps.asset_id,
            'organization_id', aps.organization_id,
            'keepr_pro_id', aps.keepr_pro_id,
            'relationship_type', aps.relationship_type,
            'access_scope', aps.access_scope,
            'status', aps.status
          ) order by aps.created_at asc nulls last), '[]'::jsonb)
          from public.asset_provider_stewardships aps
          left join public.orgs o
            on o.id = aps.organization_id
          left join public.keepr_pros kp
            on kp.id = aps.keepr_pro_id
          where public.kpc_normalize_text(coalesce(o.display_name, o.name, kp.display_name, kp.name)) like '%' || public.kpc_normalize_text(t.term) || '%'
        )
      ) as report
    from terms t
  )
  select coalesce(jsonb_agg(report order by term), '[]'::jsonb)
  into v_report
  from term_reports;

  return jsonb_build_object(
    'generated_at', now(),
    'terms', v_report
  );
end;
$$;

update public.orgs
set
  kpc_category = coalesce(kpc_category, 'marine'),
  kpc_capabilities = case
    when lower(coalesce(slug, '')) = 'tiara-yachts' then '["oem_builder"]'::jsonb
    when lower(coalesce(slug, '')) in ('wilsonmarine', 'wilson-marine', 'skipperbuds') then '["dealer","service_provider","storage","delivery"]'::jsonb
    else kpc_capabilities
  end,
  updated_at = now()
where lower(coalesce(slug, '')) in ('tiara-yachts', 'wilsonmarine', 'wilson-marine', 'skipperbuds');

grant execute on function public.kpc_normalize_text(text) to authenticated;
grant execute on function public.kpc_slugify(text) to authenticated;
grant execute on function public.kpc_normalize_domain(text) to authenticated;
grant execute on function public.kpc_domain_from_email(text) to authenticated;
grant execute on function public.kpc_normalize_phone(text) to authenticated;
grant execute on function public.search_kpc_directory(text, jsonb, integer) to authenticated;
grant execute on function public.resolve_or_create_owner_kpc(jsonb) to authenticated;
grant execute on function public.get_my_kpc_relationships() to authenticated;
grant execute on function public.get_kpc_duplicate_report(text[]) to authenticated;

comment on table public.profile_kpc_relationships is
  'Owner/person saved relationship to a canonical KPC. KPC identity remains orgs + keepr_pros.';

comment on function public.search_kpc_directory(text, jsonb, integer) is
  'Search-only KPC resolver over canonical orgs + keepr_pros. Does not create records.';

comment on function public.resolve_or_create_owner_kpc(jsonb) is
  'Resolve-first owner Add KeeprPro contract. Reuses canonical KPC when found; creates one unclaimed canonical org/provider only when no exact identity resolves.';
