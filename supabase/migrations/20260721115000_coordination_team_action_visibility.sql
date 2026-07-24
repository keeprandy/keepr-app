-- Coordination V1: authorized Team Action visibility.
-- Reminders stay owner-owned. Shared reads/mutations require both explicit
-- Team Action metadata and active stewardship on the linked asset.

create or replace function public.keepr_coordination_is_team_scoped(p_meta jsonb)
returns boolean
language sql
stable
set search_path = public
as $$
  select
    coalesce(p_meta #>> '{assignment_target,type}', '') in ('team', 'team_member')
    or lower(coalesce(p_meta ->> 'assigned_to', '')) = 'team';
$$;

create or replace function public.keepr_coordination_has_active_asset_stewardship(
  p_asset_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.asset_stewardships s
    where s.asset_id = p_asset_id
      and s.active = true
      and (s.starts_at is null or s.starts_at <= now())
      and (s.ends_at is null or s.ends_at > now())
      and (
        s.user_id = p_user_id
        or (
          s.org_id is not null
          and exists (
            select 1
            from public.org_members m
            where m.org_id = s.org_id
              and m.user_id = p_user_id
          )
        )
      )
  );
$$;

create or replace function public.keepr_coordination_can_read_action(
  p_reminder public.reminders,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and (
      (p_reminder).owner_id = p_user_id
      or (
        (p_reminder).asset_id is not null
        and public.keepr_coordination_is_team_scoped((p_reminder).extra_metadata)
        and public.keepr_coordination_has_active_asset_stewardship(
          (p_reminder).asset_id,
          p_user_id
        )
      )
    );
$$;

create or replace function public.keepr_coordination_can_complete_action(
  p_reminder public.reminders,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_user_id is not null
    and (
      (p_reminder).owner_id = p_user_id
      or (
        (p_reminder).asset_id is not null
        and public.keepr_coordination_is_team_scoped((p_reminder).extra_metadata)
        and public.keepr_coordination_has_active_asset_stewardship(
          (p_reminder).asset_id,
          p_user_id
        )
        and (
          coalesce((p_reminder).extra_metadata #>> '{assignment_target,type}', '') <> 'team_member'
          or coalesce((p_reminder).extra_metadata #>> '{assignment_target,id}', '') = p_user_id::text
        )
      )
    );
$$;

create or replace function public.get_coordination_actions(
  p_statuses text[] default null
)
returns setof public.reminders
language sql
stable
security definer
set search_path = public
as $$
  select distinct r.*
  from public.reminders r
  where auth.uid() is not null
    and (p_statuses is null or r.status = any(p_statuses))
    and public.keepr_coordination_can_read_action(r, auth.uid());
$$;

create or replace function public.get_coordination_action(
  p_reminder_id uuid
)
returns public.reminders
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_reminder public.reminders;
begin
  select r.*
  into v_reminder
  from public.reminders r
  where r.id = p_reminder_id
  limit 1;

  if v_reminder.id is null then
    return null;
  end if;

  if not public.keepr_coordination_can_read_action(v_reminder, auth.uid()) then
    return null;
  end if;

  return v_reminder;
end;
$$;

create or replace function public.complete_coordination_action(
  p_reminder_id uuid,
  p_completion_metadata jsonb default '{}'::jsonb
)
returns public.reminders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_reminder public.reminders;
  v_next_meta jsonb;
  v_allowed_keys text[] := array[
    'completed_by_user_id',
    'completed_by_label',
    'completed_at',
    'completion_source',
    'completion_record_type',
    'linked_source_type',
    'linked_source',
    'linked_service_record_id',
    'linked_timeline_record_id',
    'linked_timeline_record_title',
    'linked_timeline_record_date',
    'linked_record_proof_count',
    'work_completed_on',
    'actual_completed_date',
    'proof_updated_at',
    'completion_asset_id',
    'completion_system_id',
    'completion_assignment_target',
    'completion_provider_target',
    'recurrence_status'
  ];
  v_key text;
  v_actor_label text;
  v_close_at timestamptz;
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;

  select r.*
  into v_reminder
  from public.reminders r
  where r.id = p_reminder_id
  for update;

  if v_reminder.id is null then
    raise exception 'Action not found';
  end if;

  if not public.keepr_coordination_can_complete_action(v_reminder, v_uid) then
    raise exception 'Not authorized to complete this Action';
  end if;

  select coalesce(
    nullif(display_name, ''),
    nullif(full_name, ''),
    nullif(username, ''),
    nullif(email, ''),
    v_uid::text
  )
  into v_actor_label
  from public.profiles
  where id = v_uid;

  v_next_meta := coalesce(v_reminder.extra_metadata, '{}'::jsonb);

  foreach v_key in array v_allowed_keys loop
    if coalesce(p_completion_metadata, '{}'::jsonb) ? v_key then
      v_next_meta := jsonb_set(
        v_next_meta,
        array[v_key],
        coalesce(p_completion_metadata, '{}'::jsonb) -> v_key,
        true
      );
    end if;
  end loop;

  v_close_at := coalesce(
    nullif(v_next_meta ->> 'completed_at', '')::timestamptz,
    now()
  );

  if lower(coalesce(v_reminder.status, '')) <> 'completed' then
    v_next_meta := jsonb_set(v_next_meta, '{completed_by_user_id}', to_jsonb(v_uid::text), true);
    v_next_meta := jsonb_set(v_next_meta, '{completed_by_label}', to_jsonb(coalesce(v_actor_label, v_uid::text)), true);
    v_next_meta := jsonb_set(v_next_meta, '{completed_at}', to_jsonb(v_close_at), true);
  else
    v_next_meta := jsonb_set(v_next_meta, '{proof_updated_by_user_id}', to_jsonb(v_uid::text), true);
    v_next_meta := jsonb_set(v_next_meta, '{proof_updated_by_label}', to_jsonb(coalesce(v_actor_label, v_uid::text)), true);
    v_next_meta := jsonb_set(v_next_meta, '{proof_updated_at}', to_jsonb(now()), true);
  end if;

  update public.reminders
  set
    status = 'completed',
    completed_at = coalesce(v_reminder.completed_at, v_close_at),
    extra_metadata = v_next_meta,
    updated_at = now()
  where id = v_reminder.id
  returning *
  into v_reminder;

  return v_reminder;
end;
$$;

grant execute on function public.get_coordination_actions(text[]) to authenticated;
grant execute on function public.get_coordination_action(uuid) to authenticated;
grant execute on function public.complete_coordination_action(uuid, jsonb) to authenticated;
