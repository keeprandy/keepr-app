-- Activation & Attribution V1 Build 2
-- Server-controlled activation sessions for invite, QR, claim, partner,
-- campaign, hub, and Service Ready opens.
--
-- Scope:
-- - Adds activation_sessions.
-- - Adds controlled public session creation and authenticated identification.
-- - Keeps signup attribution, points, economics, partner dashboards, and
--   PostHog dashboard changes out of scope.
--
-- Rollback notes, if this has not been used by production data yet:
--   drop function if exists public.identify_activation_session(text);
--   drop function if exists public.create_activation_session(
--     text, text, text, text, jsonb, text, text, text, text, text, jsonb, text, text, interval
--   );
--   drop function if exists public.sanitize_activation_jsonb(jsonb);
--   drop function if exists public.sanitize_activation_url(text);
--   drop function if exists public.prepare_activation_session();
--   drop table if exists public.activation_sessions;
--
-- If production data exists, do not drop. Expire, ignore, or block sessions
-- through an audited future admin correction process.

create extension if not exists pgcrypto;

create table if not exists public.activation_sessions (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique default encode(extensions.gen_random_bytes(32), 'hex'),
  activation_source_id uuid null references public.activation_sources(id) on delete set null,
  source_slug_snapshot text,
  resolution_state text not null check (
    resolution_state in ('canonical', 'alias', 'legacy_fallback', 'unresolved')
  ),
  entry_method text not null default 'direct' check (
    entry_method in (
      'invite_link',
      'qr_code',
      'claim_link',
      'service_ready',
      'hub_invite',
      'partner_link',
      'campaign_link',
      'direct'
    )
  ),
  landing_url text null,
  referrer text null,
  utm jsonb not null default '{}'::jsonb,
  anonymous_id text null,
  posthog_distinct_id text null,
  client_platform text null,
  app_version text null,
  runtime_version text null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '90 days'),
  identified_at timestamptz null,
  consumed_at timestamptz null,
  converted_at timestamptz null,
  converted_user_id uuid null references public.profiles(id) on delete set null,
  conversion_type text null,
  internal_test_status text not null default 'normal' check (
    internal_test_status in ('normal', 'internal', 'test', 'suspected_abuse')
  ),
  status text not null default 'open' check (
    status in ('open', 'identified', 'consumed', 'converted', 'expired', 'ignored', 'blocked')
  ),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint activation_sessions_source_truth check (
    (resolution_state in ('canonical', 'alias') and activation_source_id is not null)
    or (resolution_state in ('legacy_fallback', 'unresolved') and activation_source_id is null)
  ),
  constraint activation_sessions_identified_shape check (
    (status <> 'identified' and identified_at is null and converted_user_id is null)
    or (status = 'identified' and identified_at is not null and converted_user_id is not null)
    or status in ('consumed', 'converted')
  ),
  constraint activation_sessions_consumed_shape check (
    status <> 'consumed' or consumed_at is not null
  ),
  constraint activation_sessions_converted_shape check (
    status <> 'converted' or (converted_at is not null and converted_user_id is not null)
  )
);

create unique index if not exists activation_sessions_active_idempotency_uidx
  on public.activation_sessions (idempotency_key)
  where status in ('open', 'identified');

create index if not exists activation_sessions_public_token_idx
  on public.activation_sessions (public_token);

create index if not exists activation_sessions_source_idx
  on public.activation_sessions (activation_source_id, status, expires_at)
  where activation_source_id is not null;

create index if not exists activation_sessions_status_expiry_idx
  on public.activation_sessions (status, expires_at);

create index if not exists activation_sessions_converted_user_idx
  on public.activation_sessions (converted_user_id)
  where converted_user_id is not null;

create or replace function public.sanitize_activation_url(p_url text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  raw_url text;
  base_url text;
  query_string text;
  param text;
  key_name text;
  sanitized_query text := '';
  sensitive_keys text[] := array[
    'password',
    'passcode',
    'token',
    'code',
    'access_token',
    'refresh_token',
    'authorization',
    'auth',
    'secret',
    'email',
    'phone',
    'session',
    'jwt'
  ];
begin
  raw_url := left(nullif(trim(coalesce(p_url, '')), ''), 2048);
  if raw_url is null then
    return null;
  end if;

  raw_url := split_part(raw_url, '#', 1);
  base_url := split_part(raw_url, '?', 1);
  query_string := nullif(substring(raw_url from position('?' in raw_url) + 1), '');

  if position('?' in raw_url) = 0 or query_string is null then
    return base_url;
  end if;

  for param in
    select value from regexp_split_to_table(query_string, '&') as value
  loop
    key_name := lower(split_part(param, '=', 1));
    if key_name <> '' and not (key_name = any (sensitive_keys)) then
      sanitized_query := sanitized_query
        || case when sanitized_query = '' then '' else '&' end
        || param;
    end if;
  end loop;

  if sanitized_query = '' then
    return base_url;
  end if;

  return base_url || '?' || sanitized_query;
end;
$$;

create or replace function public.sanitize_activation_jsonb(p_value jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(p_value, '{}'::jsonb)
    - 'password'
    - 'passcode'
    - 'token'
    - 'code'
    - 'access_token'
    - 'refresh_token'
    - 'authorization'
    - 'auth'
    - 'secret'
    - 'email'
    - 'phone'
    - 'session'
    - 'jwt';
$$;

create or replace function public.prepare_activation_session()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.public_token is null or length(new.public_token) < 48 then
    new.public_token := encode(extensions.gen_random_bytes(32), 'hex');
  end if;

  new.landing_url := public.sanitize_activation_url(new.landing_url);
  new.referrer := public.sanitize_activation_url(new.referrer);
  new.utm := public.sanitize_activation_jsonb(new.utm);
  new.metadata := public.sanitize_activation_jsonb(new.metadata);
  new.updated_at := now();

  if tg_op = 'INSERT' then
    new.first_seen_at := coalesce(new.first_seen_at, now());
    new.last_seen_at := coalesce(new.last_seen_at, new.first_seen_at);
    new.expires_at := coalesce(new.expires_at, now() + interval '90 days');

    if new.status not in ('open', 'ignored', 'blocked') then
      raise exception 'activation session insert status is not allowed';
    end if;
  else
    if old.status in ('converted', 'expired', 'ignored', 'blocked') and new.status <> old.status then
      raise exception 'activation session terminal status cannot transition';
    end if;

    if old.status = 'open' and new.status not in ('open', 'identified', 'expired', 'ignored', 'blocked') then
      raise exception 'activation session status transition is not allowed';
    end if;

    if old.status = 'identified' and new.status not in ('identified', 'consumed', 'expired', 'blocked') then
      raise exception 'activation session status transition is not allowed';
    end if;

    if old.status = 'consumed' and new.status not in ('consumed', 'converted') then
      raise exception 'activation session status transition is not allowed';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_activation_session_before_write on public.activation_sessions;
create trigger prepare_activation_session_before_write
before insert or update on public.activation_sessions
for each row execute function public.prepare_activation_session();

alter table public.activation_sessions enable row level security;

drop policy if exists activation_sessions_admin_all on public.activation_sessions;
create policy activation_sessions_admin_all
on public.activation_sessions
for all
to authenticated
using (public.is_activation_source_admin())
with check (public.is_activation_source_admin());

revoke all on table public.activation_sessions from anon;
grant select, insert, update, delete on table public.activation_sessions to authenticated;

create or replace function public.create_activation_session(
  p_slug text default null,
  p_entry_method text default 'direct',
  p_landing_url text default null,
  p_referrer text default null,
  p_utm jsonb default '{}'::jsonb,
  p_anonymous_id text default null,
  p_posthog_distinct_id text default null,
  p_client_platform text default null,
  p_app_version text default null,
  p_runtime_version text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_existing_public_token text default null,
  p_internal_test_status text default 'normal',
  p_qualification_window interval default interval '90 days'
)
returns table (
  public_token text,
  status text,
  resolution_state text,
  activation_source_id uuid,
  source_slug_snapshot text,
  entry_method text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_slug text;
  resolved record;
  resolved_source_id uuid := null;
  resolved_state text := 'unresolved';
  session_slug_snapshot text := null;
  stable_client_key text;
  session_idempotency_key text;
  existing_session public.activation_sessions%rowtype;
  inserted_session public.activation_sessions%rowtype;
  normalized_entry_method text;
  normalized_internal_test_status text;
  sanitized_landing_url text;
  sanitized_referrer text;
  sanitized_utm jsonb;
  sanitized_metadata jsonb;
  normalized_anonymous_id text;
  normalized_posthog_distinct_id text;
  normalized_client_platform text;
  normalized_app_version text;
  normalized_runtime_version text;
  normalized_existing_public_token text;
  next_status text := 'open';
begin
  normalized_entry_method := coalesce(nullif(p_entry_method, ''), 'direct');
  if normalized_entry_method not in (
    'invite_link',
    'qr_code',
    'claim_link',
    'service_ready',
    'hub_invite',
    'partner_link',
    'campaign_link',
    'direct'
  ) then
    raise exception 'activation session entry method is not allowed';
  end if;

  normalized_internal_test_status := coalesce(nullif(p_internal_test_status, ''), 'normal');
  if normalized_internal_test_status not in ('normal', 'internal', 'test', 'suspected_abuse') then
    raise exception 'activation session internal test status is not allowed';
  end if;

  if normalized_internal_test_status in ('internal', 'test') then
    next_status := 'ignored';
  elsif normalized_internal_test_status = 'suspected_abuse' then
    next_status := 'blocked';
  end if;

  sanitized_landing_url := public.sanitize_activation_url(p_landing_url);
  sanitized_referrer := public.sanitize_activation_url(p_referrer);
  sanitized_utm := public.sanitize_activation_jsonb(p_utm);
  sanitized_metadata := public.sanitize_activation_jsonb(p_metadata);
  normalized_anonymous_id := left(nullif(trim(coalesce(p_anonymous_id, '')), ''), 256);
  normalized_posthog_distinct_id := left(nullif(trim(coalesce(p_posthog_distinct_id, '')), ''), 256);
  normalized_client_platform := left(nullif(trim(coalesce(p_client_platform, '')), ''), 64);
  normalized_app_version := left(nullif(trim(coalesce(p_app_version, '')), ''), 64);
  normalized_runtime_version := left(nullif(trim(coalesce(p_runtime_version, '')), ''), 128);
  normalized_existing_public_token := left(nullif(trim(coalesce(p_existing_public_token, '')), ''), 128);

  if octet_length(sanitized_utm::text) > 8192 then
    raise exception 'activation session utm payload is too large';
  end if;

  if octet_length(sanitized_metadata::text) > 8192 then
    raise exception 'activation session metadata payload is too large';
  end if;

  requested_slug := public.normalize_activation_slug(left(p_slug, 256));
  if requested_slug is not null then
    select *
      into resolved
      from public.resolve_activation_source_slug(requested_slug)
      limit 1;

    if resolved.activation_source_id is not null
      and resolved.resolution_state in ('canonical', 'alias')
    then
      resolved_source_id := resolved.activation_source_id;
      resolved_state := resolved.resolution_state;
      session_slug_snapshot := resolved.normalized_slug;
    elsif requested_slug in ('keeprandy', 'drake', 'hub', 'email')
      or requested_slug ~ '^u_[a-z0-9]{8}$'
    then
      resolved_state := 'legacy_fallback';
      session_slug_snapshot := requested_slug;
    else
      resolved_state := 'unresolved';
      session_slug_snapshot := requested_slug;
    end if;
  end if;

  update public.activation_sessions
    set status = 'expired',
        updated_at = now()
    where activation_sessions.status in ('open', 'identified')
      and activation_sessions.expires_at <= now();

  if normalized_existing_public_token is not null then
    select *
      into existing_session
      from public.activation_sessions s
      where s.public_token = normalized_existing_public_token
        and s.status in ('open', 'identified')
        and s.consumed_at is null
        and s.expires_at > now()
        and s.activation_source_id is not distinct from resolved_source_id
        and s.source_slug_snapshot is not distinct from session_slug_snapshot
      limit 1;

    if existing_session.id is not null then
      update public.activation_sessions
        set last_seen_at = now(),
            landing_url = coalesce(sanitized_landing_url, landing_url),
            referrer = coalesce(sanitized_referrer, referrer),
            updated_at = now()
        where activation_sessions.id = existing_session.id
        returning * into inserted_session;

      return query
      select
        inserted_session.public_token,
        inserted_session.status,
        inserted_session.resolution_state,
        inserted_session.activation_source_id,
        inserted_session.source_slug_snapshot,
        inserted_session.entry_method,
        inserted_session.expires_at;
      return;
    end if;
  end if;

  stable_client_key := lower(nullif(coalesce(normalized_anonymous_id, normalized_posthog_distinct_id), ''));
  if stable_client_key is null then
    stable_client_key := encode(
      digest(
        'unkeyed'
          || '|'
          || coalesce(sanitized_landing_url, '')
          || '|'
          || coalesce(sanitized_referrer, '')
          || '|'
          || coalesce(normalized_client_platform, ''),
        'sha256'
      ),
      'hex'
    );
  end if;

  session_idempotency_key := encode(
    digest(
      coalesce(resolved_source_id::text, resolved_state)
        || '|'
        || coalesce(session_slug_snapshot, '')
        || '|'
        || stable_client_key,
      'sha256'
    ),
    'hex'
  );

  select *
    into existing_session
    from public.activation_sessions s
    where s.idempotency_key = session_idempotency_key
      and s.status in ('open', 'identified')
      and s.consumed_at is null
      and s.expires_at > now()
    limit 1;

  if existing_session.id is not null then
    update public.activation_sessions
      set last_seen_at = now(),
          updated_at = now()
      where activation_sessions.id = existing_session.id
      returning * into inserted_session;
  else
    insert into public.activation_sessions (
      activation_source_id,
      source_slug_snapshot,
      resolution_state,
      entry_method,
      landing_url,
      referrer,
      utm,
      anonymous_id,
      posthog_distinct_id,
      client_platform,
      app_version,
      runtime_version,
      expires_at,
      internal_test_status,
      status,
      idempotency_key,
      metadata
    )
    values (
      resolved_source_id,
      session_slug_snapshot,
      resolved_state,
      normalized_entry_method,
      sanitized_landing_url,
      sanitized_referrer,
      sanitized_utm,
      normalized_anonymous_id,
      normalized_posthog_distinct_id,
      normalized_client_platform,
      normalized_app_version,
      normalized_runtime_version,
      now() + greatest(p_qualification_window, interval '1 day'),
      normalized_internal_test_status,
      next_status,
      session_idempotency_key,
      sanitized_metadata
    )
    returning * into inserted_session;
  end if;

  return query
  select
    inserted_session.public_token,
    inserted_session.status,
    inserted_session.resolution_state,
    inserted_session.activation_source_id,
    inserted_session.source_slug_snapshot,
    inserted_session.entry_method,
    inserted_session.expires_at;
end;
$$;

revoke all on function public.create_activation_session(
  text, text, text, text, jsonb, text, text, text, text, text, jsonb, text, text, interval
) from public;
grant execute on function public.create_activation_session(
  text, text, text, text, jsonb, text, text, text, text, text, jsonb, text, text, interval
) to anon, authenticated;

create or replace function public.identify_activation_session(p_public_token text)
returns table (
  public_token text,
  status text,
  resolution_state text,
  activation_source_id uuid,
  source_slug_snapshot text,
  entry_method text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  session_row public.activation_sessions%rowtype;
  current_user_id uuid;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'authentication required to identify activation session';
  end if;

  update public.activation_sessions
    set status = 'expired',
        updated_at = now()
    where activation_sessions.status in ('open', 'identified')
      and activation_sessions.expires_at <= now();

  select *
    into session_row
    from public.activation_sessions s
    where s.public_token = p_public_token
    limit 1;

  if session_row.id is null then
    raise exception 'activation session not found';
  end if;

  if session_row.status not in ('open', 'identified') then
    raise exception 'activation session cannot be identified from current status';
  end if;

  if session_row.expires_at <= now() or session_row.consumed_at is not null then
    raise exception 'activation session is no longer active';
  end if;

  if session_row.status = 'identified' then
    if session_row.converted_user_id = current_user_id then
      return query
      select
        session_row.public_token,
        session_row.status,
        session_row.resolution_state,
        session_row.activation_source_id,
        session_row.source_slug_snapshot,
        session_row.entry_method,
        session_row.expires_at;
      return;
    end if;

    raise exception 'activation session is already identified by another user';
  end if;

  update public.activation_sessions
    set status = 'identified',
        identified_at = now(),
        converted_user_id = current_user_id,
        updated_at = now()
    where activation_sessions.id = session_row.id
    returning * into session_row;

  return query
  select
    session_row.public_token,
    session_row.status,
    session_row.resolution_state,
    session_row.activation_source_id,
    session_row.source_slug_snapshot,
    session_row.entry_method,
    session_row.expires_at;
end;
$$;

revoke all on function public.identify_activation_session(text) from public;
grant execute on function public.identify_activation_session(text) to authenticated;
