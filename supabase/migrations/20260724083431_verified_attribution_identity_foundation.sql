-- Activation & Attribution V1 Build 3
-- Verified attribution and permanent user activation identity foundation.
--
-- Scope:
-- - Converts an activation session or legacy source_slug into one immutable
--   verified attribution record per user.
-- - Ensures every verified user has one durable user activation source and
--   canonical personal slug.
-- - Preserves graph-ready lineage columns without implementing graph traversal.
-- - Adds audited admin correction records and a read-only unmatched history report.
-- - Does not implement rewards, points, dashboards, provider activation, graph
--   visualization, or historical PostHog backfill.

create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists acquisition_source_slug text;

create unique index if not exists activation_sources_one_user_identity_uidx
  on public.activation_sources (owner_user_id)
  where source_type = 'user' and owner_user_id is not null;

create table if not exists public.attribution_records (
  id uuid primary key default gen_random_uuid(),
  activation_source_id uuid null references public.activation_sources(id) on delete set null,
  activation_session_id uuid null references public.activation_sessions(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  source_slug_snapshot text,
  source_type_snapshot text,
  attribution_model text not null default 'direct' check (
    attribution_model in ('direct', 'person', 'organization', 'campaign', 'hub', 'partner', 'system_internal', 'legacy')
  ),
  organization_id uuid null references public.orgs(id) on delete set null,
  campaign_id uuid null,
  initiating_actor_id uuid null references public.profiles(id) on delete set null,
  activation_object_type text null,
  activation_object_id uuid null,
  intended_action text null,
  parent_attribution_record_id uuid null references public.attribution_records(id) on delete set null,
  root_attribution_record_id uuid null references public.attribution_records(id) on delete set null,
  verified_at timestamptz not null default now(),
  status text not null default 'verified' check (
    status in ('verified', 'unattributed', 'legacy_fallback', 'ignored', 'blocked', 'corrected', 'reversed')
  ),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attribution_records_profile_matches_user check (
    profile_id = user_id
  ),
  constraint attribution_records_metadata_size check (
    octet_length(metadata::text) <= 8192
  )
);

create unique index if not exists attribution_records_user_uidx
  on public.attribution_records (user_id);

create unique index if not exists attribution_records_session_uidx
  on public.attribution_records (activation_session_id)
  where activation_session_id is not null;

create index if not exists attribution_records_source_idx
  on public.attribution_records (activation_source_id, verified_at)
  where activation_source_id is not null;

create index if not exists attribution_records_lineage_idx
  on public.attribution_records (root_attribution_record_id, parent_attribution_record_id);

create index if not exists attribution_records_object_idx
  on public.attribution_records (activation_object_type, activation_object_id)
  where activation_object_type is not null and activation_object_id is not null;

create table if not exists public.attribution_record_corrections (
  id uuid primary key default gen_random_uuid(),
  attribution_record_id uuid not null references public.attribution_records(id) on delete cascade,
  corrected_activation_source_id uuid null references public.activation_sources(id) on delete set null,
  corrected_source_slug_snapshot text null,
  corrected_source_type_snapshot text null,
  corrected_organization_id uuid null references public.orgs(id) on delete set null,
  corrected_campaign_id uuid null,
  corrected_initiating_actor_id uuid null references public.profiles(id) on delete set null,
  corrected_status text null check (
    corrected_status is null
    or corrected_status in ('verified', 'unattributed', 'legacy_fallback', 'ignored', 'blocked', 'corrected', 'reversed')
  ),
  reason text not null check (length(trim(reason)) >= 8),
  corrected_by uuid not null references public.profiles(id) on delete restrict,
  corrected_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  constraint attribution_record_corrections_metadata_size check (
    octet_length(metadata::text) <= 8192
  )
);

create index if not exists attribution_record_corrections_record_idx
  on public.attribution_record_corrections (attribution_record_id, corrected_at desc);

create or replace function public.is_reserved_activation_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public.normalize_activation_slug(p_slug) = any (array[
    'admin',
    'api',
    'app',
    'auth',
    'billing',
    'campaign',
    'claim',
    'dashboard',
    'email',
    'help',
    'hub',
    'invite',
    'login',
    'logout',
    'me',
    'org',
    'partner',
    'posthog',
    'privacy',
    'qr',
    'reset',
    'settings',
    'signup',
    'stripe',
    'support',
    'system',
    'team'
  ]);
$$;

create or replace function public.is_valid_personal_activation_slug(p_slug text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select public.normalize_activation_slug(p_slug) is not null
    and public.normalize_activation_slug(p_slug) = lower(trim(p_slug))
    and length(public.normalize_activation_slug(p_slug)) between 3 and 48
    and public.normalize_activation_slug(p_slug) !~ '@'
    and public.normalize_activation_slug(p_slug) !~ '(^|-)gmail(-|$)|(^|-)icloud(-|$)|(^|-)yahoo(-|$)|(^|-)hotmail(-|$)'
    and not public.is_reserved_activation_slug(p_slug);
$$;

create or replace function public.user_activation_slug_candidate(p_user_id uuid, p_length integer default 8)
returns text
language sql
immutable
set search_path = public
as $$
  select 'u_' || left(regexp_replace(p_user_id::text, '-', '', 'g'), greatest(8, least(coalesce(p_length, 8), 24)));
$$;

create or replace function public.ensure_user_activation_identity(
  p_user_id uuid,
  p_share_base_url text default 'https://www.keeprhome.com/invite'
)
returns table (
  activation_source_id uuid,
  canonical_slug text,
  personal_share_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_json jsonb;
  source_id uuid;
  candidate_slug text;
  alias_slug text;
  alias_values text[];
begin
  if p_user_id is null then
    raise exception 'user id is required';
  end if;

  select to_jsonb(p)
    into profile_json
    from public.profiles p
    where p.id = p_user_id;

  if profile_json is null then
    raise exception 'profile is required before activation identity can be created';
  end if;

  select id
    into source_id
    from public.activation_sources
    where source_type = 'user'
      and owner_user_id = p_user_id
    limit 1;

  if source_id is null then
    insert into public.activation_sources (
      source_type,
      source_key,
      display_name,
      owner_user_id,
      status,
      metadata
    )
    values (
      'user',
      'user:' || p_user_id::text,
      coalesce(nullif(profile_json->>'display_name', ''), 'Keepr member'),
      p_user_id,
      'active',
      jsonb_build_object('created_by_build', 'activation_attribution_v1_build_3')
    )
    on conflict (owner_user_id)
      where source_type = 'user' and owner_user_id is not null
      do update set updated_at = now()
    returning id into source_id;
  end if;

  candidate_slug := public.user_activation_slug_candidate(p_user_id, 8);
  while exists (
    select 1
    from public.activation_source_slugs s
    where s.normalized_slug = public.normalize_activation_slug(candidate_slug)
      and s.activation_source_id <> source_id
  ) loop
    candidate_slug := public.user_activation_slug_candidate(p_user_id, length(candidate_slug) + 2);
  end loop;

  select s.normalized_slug
    into canonical_slug
    from public.activation_source_slugs s
    where s.activation_source_id = source_id
      and s.slug_kind = 'canonical'
      and s.status = 'active'
    limit 1;

  if canonical_slug is null then
    insert into public.activation_source_slugs (
      activation_source_id,
      slug,
      slug_kind,
      status,
      metadata
    )
    values (
      source_id,
      candidate_slug,
      'canonical',
      'active',
      jsonb_build_object('created_by_build', 'activation_attribution_v1_build_3')
    )
    returning normalized_slug into canonical_slug;
  end if;

  alias_values := array[
    profile_json->>'username',
    profile_json->>'inbox_name'
  ];

  foreach alias_slug in array alias_values loop
    alias_slug := public.normalize_activation_slug(alias_slug);
    if public.is_valid_personal_activation_slug(alias_slug)
      and alias_slug <> canonical_slug
      and not exists (
        select 1
        from public.activation_source_slugs s
        where s.normalized_slug = alias_slug
          and s.activation_source_id <> source_id
      )
    then
      insert into public.activation_source_slugs (
        activation_source_id,
        slug,
        slug_kind,
        status,
        metadata
      )
      values (
        source_id,
        alias_slug,
        'alias',
        'active',
        jsonb_build_object('alias_source', 'profile', 'created_by_build', 'activation_attribution_v1_build_3')
      )
      on conflict (normalized_slug) do nothing;
    end if;
  end loop;

  activation_source_id := source_id;
  personal_share_url := rtrim(coalesce(nullif(p_share_base_url, ''), 'https://www.keeprhome.com/invite'), '/') || '/' || canonical_slug;
  return next;
end;
$$;

revoke all on function public.ensure_user_activation_identity(uuid, text) from public;
grant execute on function public.ensure_user_activation_identity(uuid, text) to authenticated;

create or replace function public.complete_verified_attribution(
  p_activation_session_token text default null,
  p_source_slug text default null,
  p_activation_object_type text default null,
  p_activation_object_id uuid default null,
  p_intended_action text default null,
  p_share_base_url text default 'https://www.keeprhome.com/invite'
)
returns table (
  attribution_record_id uuid,
  activation_source_id uuid,
  activation_session_id uuid,
  user_id uuid,
  source_slug_snapshot text,
  source_type_snapshot text,
  attribution_model text,
  status text,
  user_activation_source_id uuid,
  canonical_slug text,
  personal_share_url text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  identity_row record;
  existing_record public.attribution_records%rowtype;
  session_row public.activation_sessions%rowtype;
  resolved record;
  source_row public.activation_sources%rowtype;
  chosen_source_id uuid := null;
  chosen_session_id uuid := null;
  chosen_source_slug text := public.normalize_activation_slug(p_source_slug);
  chosen_source_type_snapshot text := null;
  chosen_attribution_model text := 'direct';
  chosen_org_id uuid := null;
  chosen_campaign_id uuid := null;
  chosen_actor_id uuid := null;
  record_status text := 'unattributed';
  session_token_supplied boolean := nullif(trim(coalesce(p_activation_session_token, '')), '') is not null;
  rejection_reason text := null;
  inserted_record public.attribution_records%rowtype;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'authentication required to complete verified attribution';
  end if;

  select *
    into identity_row
    from public.ensure_user_activation_identity(current_user_id, p_share_base_url)
    limit 1;

  select *
    into existing_record
    from public.attribution_records ar
    where ar.user_id = current_user_id
    limit 1;

  if existing_record.id is not null then
    attribution_record_id := existing_record.id;
    activation_source_id := existing_record.activation_source_id;
    activation_session_id := existing_record.activation_session_id;
    user_id := existing_record.user_id;
    source_slug_snapshot := existing_record.source_slug_snapshot;
    source_type_snapshot := existing_record.source_type_snapshot;
    attribution_model := existing_record.attribution_model;
    status := existing_record.status;
    user_activation_source_id := identity_row.activation_source_id;
    canonical_slug := identity_row.canonical_slug;
    personal_share_url := identity_row.personal_share_url;
    return next;
    return;
  end if;

  if session_token_supplied then
    update public.activation_sessions
      set status = 'expired',
          updated_at = now()
      where activation_sessions.status in ('open', 'identified')
        and activation_sessions.expires_at <= now();

    select *
      into session_row
      from public.activation_sessions s
      where s.public_token = left(trim(p_activation_session_token), 128)
      for update;

    if session_row.id is not null
      and session_row.status in ('open', 'identified')
      and session_row.expires_at > now()
      and session_row.consumed_at is null
      and (
        session_row.converted_user_id is null
        or session_row.converted_user_id = current_user_id
      )
    then
      chosen_session_id := session_row.id;
      chosen_source_id := session_row.activation_source_id;
      chosen_source_slug := coalesce(session_row.source_slug_snapshot, chosen_source_slug);

      if session_row.status = 'open' then
        update public.activation_sessions
          set status = 'identified',
              identified_at = coalesce(identified_at, now()),
              converted_user_id = current_user_id,
              updated_at = now()
          where id = session_row.id;
      end if;

      update public.activation_sessions
        set status = 'consumed',
            consumed_at = now(),
            converted_user_id = current_user_id,
            conversion_type = 'signup',
            updated_at = now()
        where id = session_row.id;

      if session_row.status in ('ignored', 'blocked') then
        record_status := session_row.status;
        chosen_attribution_model := 'direct';
      elsif session_row.resolution_state = 'legacy_fallback' then
        record_status := 'legacy_fallback';
        chosen_attribution_model := 'legacy';
      elsif session_row.resolution_state in ('canonical', 'alias') then
        record_status := 'verified';
      else
        record_status := 'unattributed';
      end if;
    else
      if session_row.id is null then
        rejection_reason := 'activation_session_not_found';
      elsif session_row.status in ('ignored', 'blocked') then
        chosen_session_id := session_row.id;
        record_status := session_row.status;
        rejection_reason := 'activation_session_' || session_row.status;
      elsif session_row.expires_at <= now() then
        chosen_session_id := session_row.id;
        rejection_reason := 'activation_session_expired';
      elsif session_row.consumed_at is not null or session_row.status = 'consumed' then
        chosen_session_id := session_row.id;
        rejection_reason := 'activation_session_consumed';
      elsif session_row.converted_user_id is not null and session_row.converted_user_id <> current_user_id then
        chosen_session_id := session_row.id;
        rejection_reason := 'activation_session_claimed_by_another_user';
      else
        chosen_session_id := session_row.id;
        rejection_reason := 'activation_session_ineligible';
      end if;
    end if;
  end if;

  if chosen_source_id is null and chosen_source_slug is not null and not session_token_supplied then
    select *
      into resolved
      from public.resolve_activation_source_slug(chosen_source_slug)
      limit 1;

    if resolved.activation_source_id is not null
      and resolved.resolution_state in ('canonical', 'alias')
    then
      chosen_source_id := resolved.activation_source_id;
      chosen_source_slug := resolved.normalized_slug;
      record_status := 'verified';
    elsif chosen_source_slug in ('keeprandy', 'drake', 'hub', 'email')
      or chosen_source_slug ~ '^u_[a-z0-9]{8}$'
    then
      record_status := 'legacy_fallback';
      chosen_attribution_model := 'legacy';
    end if;
  end if;

  if chosen_source_id is not null then
    select *
      into source_row
      from public.activation_sources src
      where src.id = chosen_source_id;

    chosen_source_type_snapshot := source_row.source_type;
    chosen_attribution_model := case source_row.source_type
      when 'user' then 'person'
      when 'organization' then 'organization'
      when 'campaign' then 'campaign'
      when 'hub' then 'hub'
      when 'partner' then 'partner'
      when 'system_internal' then 'system_internal'
      else 'direct'
    end;
    chosen_org_id := source_row.owner_org_id;
    chosen_actor_id := source_row.owner_user_id;
  end if;

  begin
    insert into public.attribution_records (
      activation_source_id,
      activation_session_id,
      user_id,
      profile_id,
      source_slug_snapshot,
      source_type_snapshot,
      attribution_model,
      organization_id,
      campaign_id,
      initiating_actor_id,
      activation_object_type,
      activation_object_id,
      intended_action,
      parent_attribution_record_id,
      root_attribution_record_id,
      status,
      metadata
    )
    values (
      chosen_source_id,
      chosen_session_id,
      current_user_id,
      current_user_id,
      chosen_source_slug,
      chosen_source_type_snapshot,
      chosen_attribution_model,
      chosen_org_id,
      chosen_campaign_id,
      chosen_actor_id,
      left(nullif(trim(coalesce(p_activation_object_type, '')), ''), 64),
      p_activation_object_id,
      left(nullif(trim(coalesce(p_intended_action, '')), ''), 128),
      null,
      null,
      record_status,
      public.sanitize_activation_jsonb(
        jsonb_build_object(
          'created_by_build',
          'activation_attribution_v1_build_3',
          'rejection_reason',
          rejection_reason
        )
      )
    )
    returning * into inserted_record;
  exception
    when unique_violation then
      select *
        into inserted_record
        from public.attribution_records ar
        where ar.user_id = current_user_id;
  end;

  if inserted_record.id is null then
    select *
      into inserted_record
      from public.attribution_records ar
      where ar.user_id = current_user_id;
  else
    update public.attribution_records
      set root_attribution_record_id = inserted_record.id,
          updated_at = now()
      where id = inserted_record.id
      returning * into inserted_record;
  end if;

  if chosen_source_slug is not null then
    update public.profiles
      set acquisition_source_slug = coalesce(acquisition_source_slug, chosen_source_slug)
      where id = current_user_id;
  end if;

  attribution_record_id := inserted_record.id;
  activation_source_id := inserted_record.activation_source_id;
  activation_session_id := inserted_record.activation_session_id;
  user_id := inserted_record.user_id;
  source_slug_snapshot := inserted_record.source_slug_snapshot;
  source_type_snapshot := inserted_record.source_type_snapshot;
  attribution_model := inserted_record.attribution_model;
  status := inserted_record.status;
  user_activation_source_id := identity_row.activation_source_id;
  canonical_slug := identity_row.canonical_slug;
  personal_share_url := identity_row.personal_share_url;
  return next;
end;
$$;

revoke all on function public.complete_verified_attribution(text, text, text, uuid, text, text) from public;
grant execute on function public.complete_verified_attribution(text, text, text, uuid, text, text) to authenticated;

create or replace function public.correct_attribution_record(
  p_attribution_record_id uuid,
  p_reason text,
  p_corrected_activation_source_id uuid default null,
  p_corrected_source_slug_snapshot text default null,
  p_corrected_status text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  correction_id uuid;
  corrected_source public.activation_sources%rowtype;
begin
  if not public.is_activation_source_admin() then
    raise exception 'admin access required to correct attribution';
  end if;

  if p_attribution_record_id is null then
    raise exception 'attribution record id is required';
  end if;

  if p_reason is null or length(trim(p_reason)) < 8 then
    raise exception 'correction reason is required';
  end if;

  if p_corrected_activation_source_id is not null then
    select *
      into corrected_source
      from public.activation_sources
      where id = p_corrected_activation_source_id;
  end if;

  insert into public.attribution_record_corrections (
    attribution_record_id,
    corrected_activation_source_id,
    corrected_source_slug_snapshot,
    corrected_source_type_snapshot,
    corrected_organization_id,
    corrected_campaign_id,
    corrected_initiating_actor_id,
    corrected_status,
    reason,
    corrected_by,
    metadata
  )
  values (
    p_attribution_record_id,
    p_corrected_activation_source_id,
    public.normalize_activation_slug(p_corrected_source_slug_snapshot),
    corrected_source.source_type,
    corrected_source.owner_org_id,
    null,
    corrected_source.owner_user_id,
    p_corrected_status,
    trim(p_reason),
    auth.uid(),
    public.sanitize_activation_jsonb(p_metadata)
  )
  returning id into correction_id;

  return correction_id;
end;
$$;

revoke all on function public.correct_attribution_record(uuid, text, uuid, text, text, jsonb) from public;
grant execute on function public.correct_attribution_record(uuid, text, uuid, text, text, jsonb) to authenticated;

create or replace function public.report_unmatched_historical_activations()
returns table (
  profile_id uuid,
  acquisition_source_slug text,
  normalized_source_slug text,
  has_verified_attribution boolean,
  has_matching_activation_source boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id as profile_id,
    p.acquisition_source_slug,
    public.normalize_activation_slug(p.acquisition_source_slug) as normalized_source_slug,
    ar.id is not null as has_verified_attribution,
    src.activation_source_id is not null as has_matching_activation_source
  from public.profiles p
  left join public.attribution_records ar on ar.user_id = p.id
  left join lateral (
    select r.activation_source_id
    from public.resolve_activation_source_slug(p.acquisition_source_slug) r
    limit 1
  ) src on true
  where public.is_activation_source_admin()
    and p.acquisition_source_slug is not null
    and ar.id is null;
$$;

revoke all on function public.report_unmatched_historical_activations() from public;
grant execute on function public.report_unmatched_historical_activations() to authenticated;

alter table public.attribution_records enable row level security;
alter table public.attribution_record_corrections enable row level security;

drop policy if exists attribution_records_admin_all on public.attribution_records;
create policy attribution_records_admin_all
on public.attribution_records
for all
to authenticated
using (public.is_activation_source_admin())
with check (public.is_activation_source_admin());

drop policy if exists attribution_records_owner_select on public.attribution_records;
create policy attribution_records_owner_select
on public.attribution_records
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists attribution_record_corrections_admin_all on public.attribution_record_corrections;
create policy attribution_record_corrections_admin_all
on public.attribution_record_corrections
for all
to authenticated
using (public.is_activation_source_admin())
with check (public.is_activation_source_admin());

revoke all on table public.attribution_records from anon;
revoke all on table public.attribution_record_corrections from anon;
grant select on table public.attribution_records to authenticated;
grant select, insert on table public.attribution_record_corrections to authenticated;
