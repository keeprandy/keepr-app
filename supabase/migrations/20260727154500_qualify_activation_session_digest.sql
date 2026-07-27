-- Production Mode 2.0 hotfix.
-- Keep the locked SECURITY DEFINER search_path and schema-qualify pgcrypto
-- inside create_activation_session so clean /invite/:slug opens can create
-- Activation Engine sessions in production.

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
      extensions.digest(
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
    extensions.digest(
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
