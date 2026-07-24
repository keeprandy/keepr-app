-- Activation & Attribution V1 Build 4
-- Origin-aware Share Action foundation.
--
-- Scope:
-- - Adds durable share_actions records and safe short-token resolution.
-- - Adds share/context columns to activation_sessions.
-- - Wires server-authoritative Share Keepr creation/open semantics.
-- - Does not change existing /invite/:slug compatibility, dashboards, rewards,
--   graph traversal, provider activation, or production data.
--
-- Rollback notes, if this has not been used by production data yet:
--   drop function if exists public.open_share_action(text, text, text, text, text, text, text, text, text, text);
--   drop function if exists public.resolve_share_action(text);
--   drop function if exists public.create_share_action(text, uuid, text, text, text, uuid, jsonb, interval);
--   drop function if exists public.prepare_share_action();
--   alter table public.activation_sessions drop column if exists share_action_id;
--   alter table public.activation_sessions drop column if exists activation_object_type;
--   alter table public.activation_sessions drop column if exists activation_object_id;
--   alter table public.activation_sessions drop column if exists intended_action;
--   drop table if exists public.share_actions;
--
-- If production data exists, do not drop. Disable or expire share actions so
-- activation and attribution lineage can remain auditable.

create extension if not exists pgcrypto;

create table if not exists public.share_actions (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  activation_source_id uuid not null references public.activation_sources(id) on delete restrict,
  actor_user_id uuid null references public.profiles(id) on delete set null,
  actor_profile_id uuid null references public.profiles(id) on delete set null,
  acting_for_organization_id uuid null references public.orgs(id) on delete set null,
  root_share_action_id uuid null references public.share_actions(id) on delete restrict,
  parent_share_action_id uuid null references public.share_actions(id) on delete set null,
  shared_object_type text not null check (
    shared_object_type in (
      'keepr',
      'public_story',
      'hub',
      'keeprpro',
      'asset',
      'system',
      'membership',
      'campaign',
      'service_ready',
      'invite'
    )
  ),
  shared_object_id uuid null,
  shared_object_slug_snapshot text null,
  intended_action text not null check (
    intended_action in (
      'signup',
      'create_first_asset',
      'view_story',
      'join_hub',
      'connect_provider',
      'claim_asset',
      'request_service'
    )
  ),
  channel text not null default 'unknown' check (
    channel in ('native_share', 'copy_link', 'qr', 'email', 'sms', 'unknown')
  ),
  campaign_key text null,
  status text not null default 'active' check (
    status in ('active', 'expired', 'disabled', 'completed', 'ignored')
  ),
  created_at timestamptz not null default now(),
  expires_at timestamptz null,
  metadata jsonb not null default '{}'::jsonb,
  constraint share_actions_public_token_shape check (
    public_token ~ '^[a-f0-9]{32,128}$'
  ),
  constraint share_actions_lineage_not_self check (
    (parent_share_action_id is null or parent_share_action_id <> id)
    and (root_share_action_id is null or root_share_action_id <> parent_share_action_id)
  ),
  constraint share_actions_metadata_size check (
    octet_length(metadata::text) <= 8192
  )
);

create index if not exists share_actions_activation_source_idx
  on public.share_actions (activation_source_id, status, created_at desc);

create index if not exists share_actions_actor_user_idx
  on public.share_actions (actor_user_id, status, created_at desc)
  where actor_user_id is not null;

create index if not exists share_actions_shared_object_idx
  on public.share_actions (shared_object_type, shared_object_id, status)
  where shared_object_id is not null;

create index if not exists share_actions_parent_idx
  on public.share_actions (parent_share_action_id)
  where parent_share_action_id is not null;

create index if not exists share_actions_root_idx
  on public.share_actions (root_share_action_id)
  where root_share_action_id is not null;

alter table public.activation_sessions
  add column if not exists share_action_id uuid null,
  add column if not exists activation_object_type text null,
  add column if not exists activation_object_id uuid null,
  add column if not exists intended_action text null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'activation_sessions_share_action_id_fkey'
  ) then
    alter table public.activation_sessions
      add constraint activation_sessions_share_action_id_fkey
      foreign key (share_action_id)
      references public.share_actions(id)
      on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'activation_sessions_activation_object_type_check'
  ) then
    alter table public.activation_sessions
      add constraint activation_sessions_activation_object_type_check
      check (
        activation_object_type is null
        or activation_object_type in (
          'keepr',
          'public_story',
          'hub',
          'keeprpro',
          'asset',
          'system',
          'membership',
          'campaign',
          'service_ready',
          'invite'
        )
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'activation_sessions_intended_action_check'
  ) then
    alter table public.activation_sessions
      add constraint activation_sessions_intended_action_check
      check (
        intended_action is null
        or intended_action in (
          'signup',
          'create_first_asset',
          'view_story',
          'join_hub',
          'connect_provider',
          'claim_asset',
          'request_service'
        )
      );
  end if;
end $$;

create index if not exists activation_sessions_share_action_idx
  on public.activation_sessions (share_action_id, status, expires_at)
  where share_action_id is not null;

create index if not exists activation_sessions_object_intent_idx
  on public.activation_sessions (activation_object_type, activation_object_id, intended_action)
  where activation_object_type is not null;

create or replace function public.prepare_share_action()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.public_token is null or new.public_token !~ '^[a-f0-9]{32,128}$' then
    new.public_token := encode(gen_random_bytes(16), 'hex');
  end if;

  new.shared_object_slug_snapshot := public.normalize_activation_slug(new.shared_object_slug_snapshot);
  new.campaign_key := left(nullif(trim(coalesce(new.campaign_key, '')), ''), 128);
  new.metadata := public.sanitize_activation_jsonb(coalesce(new.metadata, '{}'::jsonb));

  if octet_length(new.metadata::text) > 8192 then
    raise exception 'share action metadata payload is too large';
  end if;

  if new.expires_at is not null and new.expires_at <= new.created_at then
    raise exception 'share action expiration must be after creation';
  end if;

  if tg_op = 'UPDATE' and old.public_token <> new.public_token then
    raise exception 'share action public token is immutable';
  end if;

  return new;
end;
$$;

drop trigger if exists prepare_share_action_before_write on public.share_actions;
create trigger prepare_share_action_before_write
before insert or update on public.share_actions
for each row execute function public.prepare_share_action();

alter table public.share_actions enable row level security;

drop policy if exists share_actions_admin_all on public.share_actions;
create policy share_actions_admin_all
on public.share_actions
for all
to authenticated
using (public.is_activation_source_admin())
with check (public.is_activation_source_admin());

drop policy if exists share_actions_actor_select on public.share_actions;
create policy share_actions_actor_select
on public.share_actions
for select
to authenticated
using (actor_user_id = auth.uid());

revoke all on table public.share_actions from anon;
grant select on table public.share_actions to authenticated;

create or replace function public.create_share_action(
  p_shared_object_type text default 'keepr',
  p_shared_object_id uuid default null,
  p_intended_action text default 'signup',
  p_channel text default 'unknown',
  p_campaign_key text default null,
  p_parent_share_action_id uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_reuse_window interval default interval '6 hours'
)
returns table (
  share_action_id uuid,
  public_token text,
  activation_source_id uuid,
  shared_object_type text,
  shared_object_id uuid,
  shared_object_slug_snapshot text,
  intended_action text,
  channel text,
  status text,
  root_share_action_id uuid,
  parent_share_action_id uuid,
  title text,
  description text,
  image_url text,
  cta text,
  route_name text,
  route_path text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  identity_row record;
  parent_row public.share_actions%rowtype;
  normalized_object_type text;
  normalized_intended_action text;
  normalized_channel text;
  normalized_campaign_key text;
  sanitized_metadata jsonb;
  existing_share public.share_actions%rowtype;
  inserted_share public.share_actions%rowtype;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'authentication required to create share action';
  end if;

  select *
    into identity_row
    from public.ensure_user_activation_identity(current_user_id, 'https://www.keeprhome.com/invite')
    limit 1;

  normalized_object_type := coalesce(nullif(trim(p_shared_object_type), ''), 'keepr');
  if normalized_object_type not in (
    'keepr',
    'public_story',
    'hub',
    'keeprpro',
    'asset',
    'system',
    'membership',
    'campaign',
    'service_ready',
    'invite'
  ) then
    raise exception 'share action object type is not allowed';
  end if;

  normalized_intended_action := coalesce(nullif(trim(p_intended_action), ''), 'signup');
  if normalized_intended_action not in (
    'signup',
    'create_first_asset',
    'view_story',
    'join_hub',
    'connect_provider',
    'claim_asset',
    'request_service'
  ) then
    raise exception 'share action intended action is not allowed';
  end if;

  normalized_channel := coalesce(nullif(trim(p_channel), ''), 'unknown');
  if normalized_channel not in ('native_share', 'copy_link', 'qr', 'email', 'sms', 'unknown') then
    raise exception 'share action channel is not allowed';
  end if;

  sanitized_metadata := public.sanitize_activation_jsonb(coalesce(p_metadata, '{}'::jsonb));
  if octet_length(sanitized_metadata::text) > 8192 then
    raise exception 'share action metadata payload is too large';
  end if;

  normalized_campaign_key := left(nullif(trim(coalesce(p_campaign_key, '')), ''), 128);

  if p_parent_share_action_id is not null then
    select *
      into parent_row
      from public.share_actions s
      where s.id = p_parent_share_action_id
        and s.status = 'active'
        and (s.expires_at is null or s.expires_at > now())
      limit 1;

    if parent_row.id is null then
      raise exception 'parent share action is not active';
    end if;
  end if;

  select *
    into existing_share
    from public.share_actions s
    where s.activation_source_id = identity_row.activation_source_id
      and s.actor_user_id = current_user_id
      and s.shared_object_type = normalized_object_type
      and s.shared_object_id is not distinct from p_shared_object_id
      and s.intended_action = normalized_intended_action
      and s.channel = normalized_channel
      and s.status = 'active'
      and (s.expires_at is null or s.expires_at > now())
      and s.created_at >= now() - greatest(p_reuse_window, interval '5 minutes')
    order by s.created_at desc
    limit 1;

  if existing_share.id is not null then
    inserted_share := existing_share;
  else
    insert into public.share_actions (
      activation_source_id,
      actor_user_id,
      actor_profile_id,
      root_share_action_id,
      parent_share_action_id,
      shared_object_type,
      shared_object_id,
      shared_object_slug_snapshot,
      intended_action,
      channel,
      campaign_key,
      status,
      expires_at,
      metadata
    )
    values (
      identity_row.activation_source_id,
      current_user_id,
      current_user_id,
      coalesce(parent_row.root_share_action_id, parent_row.id),
      parent_row.id,
      normalized_object_type,
      p_shared_object_id,
      identity_row.canonical_slug,
      normalized_intended_action,
      normalized_channel,
      normalized_campaign_key,
      'active',
      now() + interval '180 days',
      sanitized_metadata || jsonb_build_object('created_by_build', 'activation_attribution_v1_build_4')
    )
    returning * into inserted_share;

    if inserted_share.root_share_action_id is null then
      update public.share_actions
        set root_share_action_id = inserted_share.id
        where id = inserted_share.id
        returning * into inserted_share;
    end if;
  end if;

  share_action_id := inserted_share.id;
  public_token := inserted_share.public_token;
  activation_source_id := inserted_share.activation_source_id;
  shared_object_type := inserted_share.shared_object_type;
  shared_object_id := inserted_share.shared_object_id;
  shared_object_slug_snapshot := inserted_share.shared_object_slug_snapshot;
  intended_action := inserted_share.intended_action;
  channel := inserted_share.channel;
  status := inserted_share.status;
  root_share_action_id := inserted_share.root_share_action_id;
  parent_share_action_id := inserted_share.parent_share_action_id;
  title := 'Become a Keepr';
  description := 'Start building the story of what you own.';
  image_url := null;
  cta := 'Create your Keepr account';
  route_name := 'Invite';
  route_path := '/invite/' || inserted_share.shared_object_slug_snapshot;
  return next;
end;
$$;

revoke all on function public.create_share_action(text, uuid, text, text, text, uuid, jsonb, interval) from public;
grant execute on function public.create_share_action(text, uuid, text, text, text, uuid, jsonb, interval) to authenticated;

create or replace function public.resolve_share_action(p_public_token text)
returns table (
  resolution_state text,
  share_action_id uuid,
  activation_source_id uuid,
  shared_object_type text,
  shared_object_id uuid,
  shared_object_slug_snapshot text,
  intended_action text,
  status text,
  title text,
  description text,
  image_url text,
  cta text,
  route_name text,
  route_path text
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  requested_token text;
  share_row public.share_actions%rowtype;
begin
  requested_token := left(lower(trim(coalesce(p_public_token, ''))), 128);

  if requested_token !~ '^[a-f0-9]{32,128}$' then
    resolution_state := 'invalid';
    share_action_id := null;
    activation_source_id := null;
    shared_object_type := null;
    shared_object_id := null;
    shared_object_slug_snapshot := null;
    intended_action := null;
    status := 'invalid';
    title := 'Keepr link unavailable';
    description := 'This Keepr link is no longer available.';
    image_url := null;
    cta := 'Open Keepr';
    route_name := 'Auth';
    route_path := '/auth';
    return next;
    return;
  end if;

  select *
    into share_row
    from public.share_actions s
    where s.public_token = requested_token
    limit 1;

  if share_row.id is null then
    resolution_state := 'not_found';
    status := 'invalid';
    title := 'Keepr link unavailable';
    description := 'This Keepr link is no longer available.';
    cta := 'Open Keepr';
    route_name := 'Auth';
    route_path := '/auth';
    return next;
    return;
  end if;

  if share_row.status <> 'active' or (share_row.expires_at is not null and share_row.expires_at <= now()) then
    resolution_state := share_row.status;
    share_action_id := null;
    activation_source_id := null;
    shared_object_type := share_row.shared_object_type;
    shared_object_id := null;
    shared_object_slug_snapshot := null;
    intended_action := share_row.intended_action;
    status := share_row.status;
    title := 'Keepr link unavailable';
    description := 'This Keepr link is no longer available.';
    image_url := null;
    cta := 'Open Keepr';
    route_name := 'Auth';
    route_path := '/auth';
    return next;
    return;
  end if;

  resolution_state := 'active';
  share_action_id := share_row.id;
  activation_source_id := share_row.activation_source_id;
  shared_object_type := share_row.shared_object_type;
  shared_object_id := share_row.shared_object_id;
  shared_object_slug_snapshot := share_row.shared_object_slug_snapshot;
  intended_action := share_row.intended_action;
  status := share_row.status;
  title := case share_row.shared_object_type
    when 'keepr' then 'Become a Keepr'
    else 'Open Keepr'
  end;
  description := case share_row.shared_object_type
    when 'keepr' then 'Start building the story of what you own.'
    else 'Continue in Keepr.'
  end;
  image_url := null;
  cta := case share_row.intended_action
    when 'signup' then 'Create your Keepr account'
    when 'create_first_asset' then 'Add your first asset'
    else 'Continue'
  end;
  route_name := 'Invite';
  route_path := '/invite/' || share_row.shared_object_slug_snapshot;
  return next;
end;
$$;

revoke all on function public.resolve_share_action(text) from public;
grant execute on function public.resolve_share_action(text) to anon, authenticated;

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
        digest(
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
      digest(
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
