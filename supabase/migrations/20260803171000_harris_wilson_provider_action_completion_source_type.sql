create or replace function public.complete_keeprpro_stewardship_action(
  p_reminder_id uuid,
  p_organization_id uuid,
  p_completion_notes text default null,
  p_performed_at date default current_date
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reminder public.reminders;
  v_stewardship public.asset_provider_stewardships;
  v_provider_name text;
  v_system_name text;
  v_actor_label text;
  v_record public.service_records;
  v_completion_at timestamptz := now();
  v_notes text;
  v_meta jsonb;
begin
  if auth.uid() is null then
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

  if not public.keeprpro_can_access_provider_action(p_reminder_id, auth.uid(), p_organization_id) then
    return null;
  end if;

  select aps.*
  into v_stewardship
  from public.asset_provider_stewardships aps
  where aps.id = nullif(v_reminder.extra_metadata ->> 'provider_stewardship_id', '')::uuid
    and aps.organization_id = p_organization_id
    and aps.asset_id = v_reminder.asset_id
    and aps.status = 'active'
  limit 1;

  if v_stewardship.id is null then
    return null;
  end if;

  select coalesce(nullif(kp.display_name, ''), kp.name)
  into v_provider_name
  from public.keepr_pros kp
  where kp.id = v_stewardship.keepr_pro_id;

  select s.name
  into v_system_name
  from public.systems s
  where s.id = v_reminder.system_id;

  select coalesce(
    nullif(display_name, ''),
    nullif(full_name, ''),
    nullif(username, ''),
    nullif(email, ''),
    auth.uid()::text
  )
  into v_actor_label
  from public.profiles
  where id = auth.uid();

  v_notes := array_to_string(
    array_remove(array[
      nullif(p_completion_notes, ''),
      nullif(v_reminder.notes, ''),
      'Created from completed reminder ' || v_reminder.id::text || '.'
    ], null),
    E'\n\n'
  );

  select sr.*
  into v_record
  from public.service_records sr
  where sr.asset_id = v_reminder.asset_id
    and sr.extra_metadata @> jsonb_build_object(
      'source',
      'keeprpro_stewardship_action_completion',
      'reminder_id',
      v_reminder.id::text
    )
  order by sr.created_at desc
  limit 1;

  if v_record.id is null then
    insert into public.service_records (
      asset_id,
      system_id,
      keepr_pro_id,
      service_type,
      title,
      performed_at,
      notes,
      source_type,
      verification_status,
      extra_metadata
    )
    values (
      v_reminder.asset_id,
      v_reminder.system_id,
      v_stewardship.keepr_pro_id,
      'pro',
      'Completed: ' || coalesce(nullif(v_reminder.title, ''), 'Service request'),
      coalesce(p_performed_at, current_date),
      v_notes,
      'manual',
      'verified',
      jsonb_build_object(
        'source',
        'keeprpro_stewardship_action_completion',
        'reminder_id',
        v_reminder.id::text,
        'provider_stewardship_id',
        v_stewardship.id::text,
        'provider_organization_id',
        p_organization_id::text,
        'completed_by_user_id',
        auth.uid()::text,
        'completed_by_label',
        coalesce(v_actor_label, auth.uid()::text),
        'system_name',
        v_system_name,
        'provider_name',
        v_provider_name
      )
    )
    returning *
    into v_record;
  end if;

  v_meta := coalesce(v_reminder.extra_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'completed_by_user_id',
      auth.uid()::text,
      'completed_by_label',
      coalesce(v_actor_label, auth.uid()::text),
      'completed_at',
      v_completion_at,
      'completion_source',
      'keeprpro_stewardship_action',
      'linked_service_record_id',
      v_record.id::text,
      'completion_provider_target',
      jsonb_build_object(
        'type',
        'keepr_pro',
        'id',
        v_stewardship.keepr_pro_id,
        'organization_id',
        p_organization_id,
        'stewardship_id',
        v_stewardship.id,
        'label',
        coalesce(v_provider_name, 'Wilson Marine'),
        'access_scope',
        v_stewardship.access_scope
      )
    );

  update public.reminders
  set
    status = 'completed',
    completed_at = coalesce(completed_at, v_completion_at),
    extra_metadata = v_meta,
    updated_at = now()
  where id = v_reminder.id;

  return public.get_keeprpro_stewardship_action(p_reminder_id, p_organization_id);
end;
$$;

grant execute on function public.complete_keeprpro_stewardship_action(uuid, uuid, text, date) to authenticated;
