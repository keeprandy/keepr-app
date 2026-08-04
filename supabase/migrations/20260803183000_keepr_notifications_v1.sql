create table if not exists public.notification_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('service_request_created', 'relationship_message_created')),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  recipient_organization_id uuid null references public.orgs(id) on delete cascade,
  actor_user_id uuid null references public.profiles(id) on delete set null,
  acting_organization_id uuid null references public.orgs(id) on delete set null,
  asset_id uuid null references public.assets(id) on delete cascade,
  kac text null,
  stewardship_id uuid null references public.asset_provider_stewardships(id) on delete set null,
  action_id uuid null references public.reminders(id) on delete set null,
  thread_id uuid null references public.asset_threads(id) on delete set null,
  title text not null,
  body text null,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  dedupe_key text not null,
  delivery_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  read_at timestamptz null,
  acknowledged_at timestamptz null
);

create unique index if not exists notification_events_recipient_dedupe_idx
  on public.notification_events (recipient_user_id, dedupe_key);

create index if not exists notification_events_recipient_unread_idx
  on public.notification_events (recipient_user_id, created_at desc)
  where read_at is null;

create index if not exists notification_events_thread_idx
  on public.notification_events (thread_id, created_at desc);

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'notification_events'
    ) then
    alter publication supabase_realtime add table public.notification_events;
  end if;
end;
$$;

create table if not exists public.notification_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web')),
  device_id text not null,
  push_provider text not null check (push_provider in ('expo', 'web_push')),
  expo_push_token text null,
  web_push_subscription jsonb null,
  user_agent text null,
  enabled boolean not null default true,
  active_context jsonb not null default '{}'::jsonb,
  last_seen_at timestamptz not null default now(),
  invalid_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, platform, device_id)
);

create index if not exists notification_devices_user_enabled_idx
  on public.notification_devices (user_id, enabled, invalid_at);

create table if not exists public.notification_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  new_requests boolean not null default true,
  direct_assigned_messages boolean not null default true,
  mentions boolean not null default true,
  escalation boolean not null default true,
  quiet_hours jsonb not null default '{}'::jsonb,
  lock_screen_preview boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  notification_event_id uuid not null references public.notification_events(id) on delete cascade,
  device_id uuid not null references public.notification_devices(id) on delete cascade,
  channel text not null check (channel in ('expo', 'web_push')),
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'invalid', 'suppressed')),
  provider_response jsonb null,
  created_at timestamptz not null default now(),
  sent_at timestamptz null,
  unique (notification_event_id, device_id)
);

alter table public.notification_events enable row level security;
alter table public.notification_devices enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_deliveries enable row level security;

drop policy if exists "notification_events_recipient_select" on public.notification_events;
create policy "notification_events_recipient_select"
  on public.notification_events
  for select
  to authenticated
  using (recipient_user_id = auth.uid());

drop policy if exists "notification_events_recipient_update" on public.notification_events;
create policy "notification_events_recipient_update"
  on public.notification_events
  for update
  to authenticated
  using (recipient_user_id = auth.uid())
  with check (recipient_user_id = auth.uid());

drop policy if exists "notification_devices_owner_all" on public.notification_devices;
create policy "notification_devices_owner_all"
  on public.notification_devices
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notification_preferences_owner_all" on public.notification_preferences;
create policy "notification_preferences_owner_all"
  on public.notification_preferences
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "notification_deliveries_owner_select" on public.notification_deliveries;
create policy "notification_deliveries_owner_select"
  on public.notification_deliveries
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.notification_events ne
      where ne.id = notification_deliveries.notification_event_id
        and ne.recipient_user_id = auth.uid()
    )
  );

create or replace function public.mark_notification_event_read(p_event_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.notification_events
  set read_at = coalesce(read_at, now())
  where id = p_event_id
    and recipient_user_id = auth.uid();
$$;

grant execute on function public.mark_notification_event_read(uuid) to authenticated;

create or replace function public.create_keepr_notification_event(
  p_event_type text,
  p_actor_user_id uuid default auth.uid(),
  p_acting_organization_id uuid default null,
  p_asset_id uuid default null,
  p_kac text default null,
  p_recipient_organization_id uuid default null,
  p_stewardship_id uuid default null,
  p_action_id uuid default null,
  p_thread_id uuid default null,
  p_title text default null,
  p_body text default null,
  p_priority text default 'normal',
  p_dedupe_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_user_id uuid := auth.uid();
  v_asset record;
  v_thread_asset_id uuid;
  v_action_asset_id uuid;
  v_thread_keepr_pro_id uuid;
  v_thread_owner_id uuid;
  v_thread_resource_ref jsonb;
  v_action_owner_id uuid;
  v_action_extra_metadata jsonb;
  v_org_id uuid := p_recipient_organization_id;
  v_stewardship_id uuid := p_stewardship_id;
  v_stewardship record;
  v_kac text := nullif(trim(coalesce(p_kac, '')), '');
  v_title text := nullif(trim(coalesce(p_title, '')), '');
  v_body text := nullif(trim(coalesce(p_body, '')), '');
  v_priority text := coalesce(nullif(trim(p_priority), ''), 'normal');
  v_base_dedupe text;
  v_recipients uuid[];
  v_recipient uuid;
  v_event public.notification_events;
  v_events jsonb := '[]'::jsonb;
begin
  if v_actor_user_id is null then
    raise exception 'Authentication is required to create notification events.';
  end if;

  if p_actor_user_id is not null and p_actor_user_id <> v_actor_user_id then
    raise exception 'Notification actor must be the authenticated user.';
  end if;

  if p_event_type not in ('service_request_created', 'relationship_message_created') then
    raise exception 'Unsupported notification event type: %', p_event_type;
  end if;

  if p_thread_id is not null then
    select asset_id, keepr_pro_id, owner_id, resource_ref
    into v_thread_asset_id, v_thread_keepr_pro_id, v_thread_owner_id, v_thread_resource_ref
    from public.asset_threads
    where id = p_thread_id;
  end if;

  if p_action_id is not null then
    select asset_id, owner_id, extra_metadata
    into v_action_asset_id, v_action_owner_id, v_action_extra_metadata
    from public.reminders
    where id = p_action_id;
  end if;

  select *
  into v_asset
  from public.assets
  where id = coalesce(p_asset_id, v_thread_asset_id, v_action_asset_id)
    and deleted_at is null
  limit 1;

  if v_asset.id is null then
    raise exception 'Notification asset could not be resolved.';
  end if;

  if p_thread_id is not null and (v_thread_asset_id is null or v_thread_asset_id <> v_asset.id) then
    raise exception 'Notification thread does not belong to the resolved asset.';
  end if;

  if p_action_id is not null and (v_action_asset_id is null or v_action_asset_id <> v_asset.id) then
    raise exception 'Notification action does not belong to the resolved asset.';
  end if;

  v_kac := coalesce(v_kac, v_asset.kac_id);

  if v_stewardship_id is null and v_org_id is not null then
    select aps.id
    into v_stewardship_id
    from public.asset_provider_stewardships aps
    where aps.asset_id = v_asset.id
      and aps.organization_id = v_org_id
      and aps.status = 'active'
      and aps.access_scope = 'service_stewardship'
    order by aps.created_at desc
    limit 1;
  end if;

  if v_org_id is null and v_stewardship_id is not null then
    select aps.organization_id
    into v_org_id
    from public.asset_provider_stewardships aps
    where aps.id = v_stewardship_id;
  end if;

  if v_stewardship_id is not null then
    select *
    into v_stewardship
    from public.asset_provider_stewardships aps
    where aps.id = v_stewardship_id
      and aps.asset_id = v_asset.id
      and aps.organization_id = v_org_id
      and aps.status = 'active'
      and aps.access_scope = 'service_stewardship'
      and (aps.starts_at is null or aps.starts_at <= now())
      and (aps.ends_at is null or aps.ends_at > now())
    limit 1;
  end if;

  if v_org_id is null or v_stewardship.id is null then
    raise exception 'An active provider stewardship is required for notification events.';
  end if;

  if p_event_type = 'service_request_created' then
    if v_asset.owner_id <> v_actor_user_id then
      raise exception 'Only the asset owner can create service request notifications.';
    end if;

    if p_action_id is not null and v_action_owner_id <> v_actor_user_id then
      raise exception 'Service request action is not owned by the actor.';
    end if;

    select coalesce(array_agg(distinct om.user_id), array[]::uuid[])
    into v_recipients
    from public.org_members om
    where om.org_id = v_org_id
      and om.user_id is not null
      and coalesce(om.status, 'active') = 'active'
      and om.user_id <> v_actor_user_id;

    v_title := coalesce(v_title, 'New service request');
    v_body := coalesce(v_body, v_asset.name);
    v_base_dedupe := coalesce(
      nullif(trim(p_dedupe_key), ''),
      concat_ws(':', 'service_request_created', coalesce(p_action_id::text, ''), coalesce(v_stewardship_id::text, ''), date_trunc('minute', now())::text)
    );
  else
    if p_acting_organization_id is not null then
      if p_acting_organization_id <> v_org_id then
        raise exception 'Acting organization must match the active stewardship organization.';
      end if;

      if not public.keeprpro_user_can_act_for_org(v_actor_user_id, p_acting_organization_id) then
        raise exception 'Actor cannot act for this organization.';
      end if;

      v_recipients := array[v_asset.owner_id]::uuid[];
      v_org_id := p_acting_organization_id;
    else
      if v_asset.owner_id <> v_actor_user_id then
        raise exception 'Only the asset owner can notify provider participants for this relationship.';
      end if;

      select coalesce(array_agg(distinct om.user_id), array[]::uuid[])
      into v_recipients
      from public.org_members om
      where om.org_id = v_org_id
        and om.user_id is not null
        and coalesce(om.status, 'active') = 'active'
        and om.user_id <> v_actor_user_id;
    end if;

    v_title := coalesce(v_title, 'New relationship message');
    v_body := coalesce(v_body, v_asset.name);
    v_base_dedupe := coalesce(
      nullif(trim(p_dedupe_key), ''),
      concat_ws(':', 'relationship_message_created', coalesce(p_thread_id::text, ''), date_trunc('minute', now())::text)
    );
  end if;

  foreach v_recipient in array coalesce(v_recipients, array[]::uuid[]) loop
    if v_recipient is null or v_recipient = v_actor_user_id then
      continue;
    end if;

    insert into public.notification_events (
      event_type,
      recipient_user_id,
      recipient_organization_id,
      actor_user_id,
      acting_organization_id,
      asset_id,
      kac,
      stewardship_id,
      action_id,
      thread_id,
      title,
      body,
      priority,
      dedupe_key,
      delivery_payload
    )
    values (
      p_event_type,
      v_recipient,
      case when p_acting_organization_id is null then v_org_id else null end,
      v_actor_user_id,
      p_acting_organization_id,
      v_asset.id,
      v_kac,
      v_stewardship_id,
      p_action_id,
      p_thread_id,
      v_title,
      v_body,
      v_priority,
      concat(v_base_dedupe, ':', v_recipient::text),
      jsonb_build_object(
        'event_type', p_event_type,
        'asset_id', v_asset.id,
        'asset_name', v_asset.name,
        'kac', v_kac,
        'stewardship_id', v_stewardship_id,
        'action_id', p_action_id,
        'thread_id', p_thread_id,
        'route', case
          when p_thread_id is not null then 'Messages'
          when p_action_id is not null then 'KeeprProActionDetail'
          else 'RelationshipWorkspace'
        end
      )
    )
    on conflict (recipient_user_id, dedupe_key)
    do update set
      title = excluded.title,
      body = excluded.body,
      delivery_payload = notification_events.delivery_payload || excluded.delivery_payload || jsonb_build_object('bundled_count', coalesce((notification_events.delivery_payload ->> 'bundled_count')::integer, 1) + 1),
      created_at = now()
    returning * into v_event;

    v_events := v_events || jsonb_build_array(to_jsonb(v_event));
  end loop;

  return v_events;
end;
$$;

grant execute on function public.create_keepr_notification_event(text, uuid, uuid, uuid, text, uuid, uuid, uuid, uuid, text, text, text, text) to authenticated;
