-- Track explicit social share channels through durable share actions.
-- Native share remains channel=native_share because the selected destination is unknown.

alter table public.share_actions
  drop constraint if exists share_actions_channel_check;

alter table public.share_actions
  add constraint share_actions_channel_check check (
    channel in ('native_share', 'copy_link', 'qr', 'email', 'sms', 'facebook', 'linkedin', 'unknown')
  );

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
  if normalized_channel not in ('native_share', 'copy_link', 'qr', 'email', 'sms', 'facebook', 'linkedin', 'unknown') then
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
