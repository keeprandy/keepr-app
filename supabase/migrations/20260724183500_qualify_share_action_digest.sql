-- Activation & Attribution V1 Build 4 hotfix.
-- Keep the locked SECURITY DEFINER search_path and schema-qualify pgcrypto.

create or replace function public.open_share_action(
  p_public_token text,
  p_existing_activation_session_token text default null,
  p_landing_url text default null,
  p_referrer text default null,
  p_anonymous_id text default null,
  p_posthog_distinct_id text default null,
  p_client_platform text default null,
  p_app_version text default null,
  p_runtime_version text default null,
  p_user_agent text default null
)
returns table (
  resolution_state text,
  share_action_id uuid,
  activation_source_id uuid,
  shared_object_type text,
  shared_object_id uuid,
  shared_object_slug_snapshot text,
  intended_action text,
  source_slug_snapshot text,
  activation_session_public_token text,
  activation_session_status text,
  entry_method text,
  expires_at timestamptz,
  route_name text,
  route_path text,
  title text,
  description text,
  cta text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_token text;
  existing_session_token text;
  share_row public.share_actions%rowtype;
  session_row public.activation_sessions%rowtype;
  inserted_session public.activation_sessions%rowtype;
  sanitized_landing_url text;
  sanitized_referrer text;
  stable_client_key text;
  session_idempotency_key text;
  normalized_anonymous_id text;
  normalized_posthog_distinct_id text;
  normalized_client_platform text;
  normalized_app_version text;
  normalized_runtime_version text;
  normalized_user_agent text;
  normalized_entry_method text;
  next_status text := 'open';
begin
  requested_token := left(lower(trim(coalesce(p_public_token, ''))), 128);
  existing_session_token := left(nullif(trim(coalesce(p_existing_activation_session_token, '')), ''), 128);

  if requested_token !~ '^[a-f0-9]{32,128}$' then
    raise exception 'share action not found';
  end if;

  select *
    into share_row
    from public.share_actions s
    where s.public_token = requested_token
    limit 1;

  if share_row.id is null then
    raise exception 'share action not found';
  end if;

  if share_row.status <> 'active' then
    raise exception 'share action is not active';
  end if;

  if share_row.expires_at is not null and share_row.expires_at <= now() then
    update public.share_actions
      set status = 'expired'
      where id = share_row.id
      returning * into share_row;
    raise exception 'share action has expired';
  end if;

  sanitized_landing_url := public.sanitize_activation_url(p_landing_url);
  sanitized_referrer := public.sanitize_activation_url(p_referrer);
  normalized_anonymous_id := left(nullif(trim(coalesce(p_anonymous_id, '')), ''), 256);
  normalized_posthog_distinct_id := left(nullif(trim(coalesce(p_posthog_distinct_id, '')), ''), 256);
  normalized_client_platform := left(nullif(trim(coalesce(p_client_platform, '')), ''), 64);
  normalized_app_version := left(nullif(trim(coalesce(p_app_version, '')), ''), 64);
  normalized_runtime_version := left(nullif(trim(coalesce(p_runtime_version, '')), ''), 128);
  normalized_user_agent := left(nullif(trim(coalesce(p_user_agent, '')), ''), 512);

  normalized_entry_method := case share_row.channel
    when 'qr' then 'qr_code'
    when 'email' then 'campaign_link'
    when 'sms' then 'campaign_link'
    else 'invite_link'
  end;

  if lower(coalesce(normalized_user_agent, '')) ~ '(bot|crawler|spider|preview|facebookexternalhit|slackbot|twitterbot|linkedinbot)' then
    next_status := 'ignored';
  end if;

  update public.activation_sessions
    set status = 'expired',
        updated_at = now()
    where activation_sessions.status in ('open', 'identified')
      and activation_sessions.expires_at <= now();

  if existing_session_token is not null then
    select *
      into session_row
      from public.activation_sessions s
      where s.public_token = existing_session_token
        and s.status in ('open', 'identified')
        and s.consumed_at is null
        and s.expires_at > now()
        and s.activation_source_id = share_row.activation_source_id
        and s.share_action_id = share_row.id
      limit 1;

    if session_row.id is not null then
      update public.activation_sessions
        set last_seen_at = now(),
            landing_url = coalesce(sanitized_landing_url, landing_url),
            referrer = coalesce(sanitized_referrer, referrer),
            updated_at = now()
        where id = session_row.id
        returning * into inserted_session;
    end if;
  end if;

  if inserted_session.id is null then
    stable_client_key := lower(nullif(coalesce(normalized_anonymous_id, normalized_posthog_distinct_id), ''));
    if stable_client_key is null then
      stable_client_key := encode(
        extensions.digest(
          'share_action'
            || '|'
            || share_row.id::text
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
        'share_action'
          || '|'
          || share_row.id::text
          || '|'
          || stable_client_key,
        'sha256'
      ),
      'hex'
    );

    select *
      into session_row
      from public.activation_sessions s
      where s.idempotency_key = session_idempotency_key
        and s.status in ('open', 'identified')
        and s.consumed_at is null
        and s.expires_at > now()
      limit 1;

    if session_row.id is not null then
      update public.activation_sessions
        set last_seen_at = now(),
            updated_at = now()
        where id = session_row.id
        returning * into inserted_session;
    else
      insert into public.activation_sessions (
        activation_source_id,
        source_slug_snapshot,
        resolution_state,
        entry_method,
        landing_url,
        referrer,
        anonymous_id,
        posthog_distinct_id,
        client_platform,
        app_version,
        runtime_version,
        expires_at,
        internal_test_status,
        status,
        idempotency_key,
        share_action_id,
        activation_object_type,
        activation_object_id,
        intended_action,
        metadata
      )
      values (
        share_row.activation_source_id,
        share_row.shared_object_slug_snapshot,
        'canonical',
        normalized_entry_method,
        sanitized_landing_url,
        sanitized_referrer,
        normalized_anonymous_id,
        normalized_posthog_distinct_id,
        normalized_client_platform,
        normalized_app_version,
        normalized_runtime_version,
        now() + interval '90 days',
        case when next_status = 'ignored' then 'suspected_abuse' else 'normal' end,
        next_status,
        session_idempotency_key,
        share_row.id,
        share_row.shared_object_type,
        share_row.shared_object_id,
        share_row.intended_action,
        public.sanitize_activation_jsonb(jsonb_build_object(
          'share_action_id',
          share_row.id,
          'shared_object_type',
          share_row.shared_object_type,
          'intended_action',
          share_row.intended_action,
          'created_by_build',
          'activation_attribution_v1_build_4'
        ))
      )
      returning * into inserted_session;
    end if;
  end if;

  resolution_state := 'active';
  share_action_id := share_row.id;
  activation_source_id := share_row.activation_source_id;
  shared_object_type := share_row.shared_object_type;
  shared_object_id := share_row.shared_object_id;
  shared_object_slug_snapshot := share_row.shared_object_slug_snapshot;
  intended_action := share_row.intended_action;
  source_slug_snapshot := inserted_session.source_slug_snapshot;
  activation_session_public_token := inserted_session.public_token;
  activation_session_status := inserted_session.status;
  entry_method := inserted_session.entry_method;
  expires_at := inserted_session.expires_at;
  route_name := 'Invite';
  route_path := '/invite/' || share_row.shared_object_slug_snapshot;
  title := 'Become a Keepr';
  description := 'Start building the story of what you own.';
  cta := 'Create your Keepr account';
  return next;
end;
$$;

revoke all on function public.open_share_action(text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.open_share_action(text, text, text, text, text, text, text, text, text, text) to anon, authenticated;
