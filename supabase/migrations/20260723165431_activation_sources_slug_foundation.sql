-- Activation & Attribution V1 Build 1
-- Canonical activation source identities plus case-insensitive slug aliases.
--
-- Scope:
-- - Adds durable source and slug tables.
-- - Adds server-controlled public slug resolution.
-- - Adds admin/internal read-only source lookup.
-- - Does not modify profiles.acquisition_source_slug, PostHog events, Stripe,
--   existing invite URLs, hub URLs, or production data.
--
-- Migration safety:
-- - PostgreSQL/Supabase migrations run transactionally by default.
-- - Object creation uses if-not-exists/create-or-replace where safe.
-- - Re-running after local edits is not a substitute for a real production
--   migration replay; once applied, treat it as one-time schema history.
--
-- Rollback notes, if this has not been used by production data yet:
--   drop function if exists public.lookup_activation_sources(text, integer);
--   drop function if exists public.resolve_activation_source_slug(text);
--   drop function if exists public.normalize_activation_slug(text);
--   drop function if exists public.is_activation_source_admin();
--   drop function if exists public.prepare_activation_source_slug();
--   drop function if exists public.touch_activation_updated_at();
--   drop table if exists public.activation_source_slugs;
--   drop table if exists public.activation_sources;
--
-- If production data exists, do not drop. Retire/disable sources and slugs
-- instead so historical attribution records can continue to resolve.

create extension if not exists pgcrypto;

create or replace function public.normalize_activation_slug(p_slug text)
returns text
language sql
immutable
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(trim(coalesce(p_slug, ''))), '[^a-z0-9_-]+', '-', 'g'),
      '(^-+|-+$)',
      '',
      'g'
    ),
    ''
  );
$$;

create table if not exists public.activation_sources (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (
    source_type in (
      'user',
      'organization',
      'campaign',
      'hub',
      'keeprpro',
      'partner',
      'system_internal'
    )
  ),
  source_key text,
  display_name text not null,
  owner_user_id uuid references public.profiles(id) on delete set null,
  owner_org_id uuid references public.orgs(id) on delete set null,
  owner_hub_id uuid references public.hubs(id) on delete set null,
  owner_keepr_pro_id uuid references public.keepr_pros(id) on delete set null,
  campaign_key text,
  partner_key text,
  status text not null default 'active' check (
    status in ('draft', 'active', 'disabled', 'retired')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  retired_at timestamptz,
  constraint activation_sources_owner_shape check (
    (source_type = 'user' and owner_user_id is not null)
    or (source_type = 'organization' and owner_org_id is not null)
    or (source_type = 'campaign' and campaign_key is not null)
    or (source_type = 'hub' and owner_hub_id is not null)
    or (source_type = 'keeprpro' and owner_keepr_pro_id is not null)
    or (source_type = 'partner' and partner_key is not null)
    or source_type = 'system_internal'
  )
);

create unique index if not exists activation_sources_source_key_uidx
  on public.activation_sources (source_type, lower(source_key))
  where source_key is not null;

create index if not exists activation_sources_owner_user_idx
  on public.activation_sources (owner_user_id)
  where owner_user_id is not null;

create index if not exists activation_sources_owner_org_idx
  on public.activation_sources (owner_org_id)
  where owner_org_id is not null;

create index if not exists activation_sources_owner_hub_idx
  on public.activation_sources (owner_hub_id)
  where owner_hub_id is not null;

create index if not exists activation_sources_owner_keeprpro_idx
  on public.activation_sources (owner_keepr_pro_id)
  where owner_keepr_pro_id is not null;

create index if not exists activation_sources_status_idx
  on public.activation_sources (status, source_type);

create table if not exists public.activation_source_slugs (
  id uuid primary key default gen_random_uuid(),
  activation_source_id uuid not null references public.activation_sources(id) on delete cascade,
  slug text not null,
  normalized_slug text not null,
  slug_kind text not null default 'alias' check (slug_kind in ('canonical', 'alias')),
  status text not null default 'active' check (status in ('active', 'disabled', 'retired')),
  redirect_activation_source_id uuid references public.activation_sources(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  disabled_at timestamptz,
  retired_at timestamptz,
  constraint activation_source_slugs_redirect_shape check (
    status <> 'retired'
    or redirect_activation_source_id is null
    or redirect_activation_source_id <> activation_source_id
  )
);

create unique index if not exists activation_source_slugs_normalized_slug_uidx
  on public.activation_source_slugs (normalized_slug);

create unique index if not exists activation_source_slugs_one_active_canonical_uidx
  on public.activation_source_slugs (activation_source_id)
  where slug_kind = 'canonical' and status = 'active';

create index if not exists activation_source_slugs_source_idx
  on public.activation_source_slugs (activation_source_id, status);

create index if not exists activation_source_slugs_redirect_idx
  on public.activation_source_slugs (redirect_activation_source_id)
  where redirect_activation_source_id is not null;

create or replace function public.touch_activation_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  new.updated_at = now();
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists touch_activation_sources_updated_at on public.activation_sources;
create trigger touch_activation_sources_updated_at
before insert or update on public.activation_sources
for each row execute function public.touch_activation_updated_at();

create or replace function public.prepare_activation_source_slug()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  target_status text;
begin
  new.normalized_slug = public.normalize_activation_slug(new.slug);
  if new.normalized_slug is null then
    raise exception 'activation source slug cannot be blank';
  end if;

  if new.slug_kind = 'canonical' and new.redirect_activation_source_id is not null then
    raise exception 'canonical activation source slugs cannot redirect';
  end if;

  if new.redirect_activation_source_id = new.activation_source_id then
    raise exception 'activation source slug cannot redirect to its own source';
  end if;

  if new.status = 'retired' and new.redirect_activation_source_id is null then
    raise exception 'retired activation source slugs must redirect to an active canonical source';
  end if;

  if new.redirect_activation_source_id is not null then
    select status
      into target_status
      from public.activation_sources
      where id = new.redirect_activation_source_id;

    if target_status is null then
      raise exception 'activation source slug redirect target does not exist';
    end if;

    if target_status <> 'active' then
      raise exception 'activation source slug redirect target must be active';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by = coalesce(new.created_by, auth.uid());
  end if;
  new.updated_at = now();
  new.updated_by = coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists prepare_activation_source_slug_before_write on public.activation_source_slugs;
create trigger prepare_activation_source_slug_before_write
before insert or update on public.activation_source_slugs
for each row execute function public.prepare_activation_source_slug();

create or replace function public.is_activation_source_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and (
        lower(coalesce(p.role, '')) in ('admin', 'superkeepr')
        or lower(coalesce(p.email, '')) like '%@keeprhome.com'
      )
  );
$$;

revoke all on function public.is_activation_source_admin() from public;
grant execute on function public.is_activation_source_admin() to authenticated;

alter table public.activation_sources enable row level security;
alter table public.activation_source_slugs enable row level security;

drop policy if exists activation_sources_admin_all on public.activation_sources;
create policy activation_sources_admin_all
on public.activation_sources
for all
to authenticated
using (public.is_activation_source_admin())
with check (public.is_activation_source_admin());

drop policy if exists activation_source_slugs_admin_all on public.activation_source_slugs;
create policy activation_source_slugs_admin_all
on public.activation_source_slugs
for all
to authenticated
using (public.is_activation_source_admin())
with check (public.is_activation_source_admin());

revoke all on table public.activation_sources from anon;
revoke all on table public.activation_source_slugs from anon;

grant select, insert, update, delete on table public.activation_sources to authenticated;
grant select, insert, update, delete on table public.activation_source_slugs to authenticated;

create or replace function public.resolve_activation_source_slug(p_slug text)
returns table (
  resolution_state text,
  activation_source_id uuid,
  source_type text,
  display_name text,
  slug text,
  normalized_slug text,
  slug_kind text,
  is_redirect boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  requested_slug text;
begin
  requested_slug := public.normalize_activation_slug(p_slug);

  if requested_slug is null then
    return query
    select
      'unresolved'::text,
      null::uuid,
      null::text,
      null::text,
      null::text,
      null::text,
      null::text,
      false;
    return;
  end if;

  return query
  with matched_slug as (
    select s.*
    from public.activation_source_slugs s
    where s.normalized_slug = requested_slug
      and s.status in ('active', 'retired')
    limit 1
  ),
  target_source as (
    select
      coalesce(ms.redirect_activation_source_id, ms.activation_source_id) as target_id,
      ms.*
    from matched_slug ms
  ),
  resolved as (
    select
      case
        when ts.slug_kind = 'canonical'
          and ts.status = 'active'
          and ts.redirect_activation_source_id is null
          then 'canonical'
        else 'alias'
      end as resolution_state,
      src.id as activation_source_id,
      src.source_type,
      src.display_name,
      ts.slug,
      ts.normalized_slug,
      ts.slug_kind,
      ts.redirect_activation_source_id is not null as is_redirect
    from target_source ts
    join public.activation_sources src on src.id = ts.target_id
    where src.status = 'active'
  )
  select
    resolved.resolution_state,
    resolved.activation_source_id,
    resolved.source_type,
    resolved.display_name,
    resolved.slug,
    resolved.normalized_slug,
    resolved.slug_kind,
    resolved.is_redirect
  from resolved
  union all
  select
    'unresolved'::text,
    null::uuid,
    null::text,
    null::text,
    requested_slug,
    requested_slug,
    null::text,
    false
  where not exists (select 1 from resolved);
end;
$$;

revoke all on function public.resolve_activation_source_slug(text) from public;
grant execute on function public.resolve_activation_source_slug(text) to anon, authenticated;

create or replace function public.lookup_activation_sources(
  p_query text default null,
  p_limit integer default 50
)
returns table (
  activation_source_id uuid,
  source_type text,
  source_key text,
  display_name text,
  source_status text,
  owner_user_id uuid,
  owner_org_id uuid,
  owner_hub_id uuid,
  owner_keepr_pro_id uuid,
  campaign_key text,
  partner_key text,
  slug_id uuid,
  slug text,
  normalized_slug text,
  slug_kind text,
  slug_status text,
  is_redirect boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    src.id as activation_source_id,
    src.source_type,
    src.source_key,
    src.display_name,
    src.status as source_status,
    src.owner_user_id,
    src.owner_org_id,
    src.owner_hub_id,
    src.owner_keepr_pro_id,
    src.campaign_key,
    src.partner_key,
    sl.id as slug_id,
    sl.slug,
    sl.normalized_slug,
    sl.slug_kind,
    sl.status as slug_status,
    sl.redirect_activation_source_id is not null as is_redirect,
    src.created_at,
    src.updated_at
  from public.activation_sources src
  left join public.activation_source_slugs sl on sl.activation_source_id = src.id
  where public.is_activation_source_admin()
    and (
      p_query is null
      or p_query = ''
      or src.display_name ilike '%' || p_query || '%'
      or src.source_key ilike '%' || p_query || '%'
      or sl.slug ilike '%' || p_query || '%'
      or sl.normalized_slug ilike '%' || public.normalize_activation_slug(p_query) || '%'
    )
  order by src.created_at desc, sl.slug_kind asc, sl.created_at asc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;

revoke all on function public.lookup_activation_sources(text, integer) from public;
grant execute on function public.lookup_activation_sources(text, integer) to authenticated;
