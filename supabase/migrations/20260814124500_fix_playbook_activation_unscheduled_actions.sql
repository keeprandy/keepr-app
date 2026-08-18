-- Playbook activation V1: reminders.due_at is not nullable in the existing Action model.
-- Keep Playbook step dates optional by storing a harmless placeholder due_at and
-- preserving the unscheduled intent in extra_metadata for the Action UI to refine later.

create or replace function public.activate_keeprspace_playbook(p_playbook_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_playbook public.playbooks;
  v_step public.playbook_steps;
  v_action_id uuid;
  v_service jsonb;
  v_extra jsonb;
  v_due_at timestamptz;
  v_due_time text;
  v_has_time boolean;
  v_due_date_pending boolean;
begin
  select * into v_playbook
  from public.playbooks
  where id = p_playbook_id;

  if v_playbook.id is null then
    raise exception 'playbook not found';
  end if;

  if not public.keeprspace_user_can_manage_playbook(auth.uid(), p_playbook_id) then
    raise exception 'not authorized to activate this playbook';
  end if;

  for v_step in
    select *
    from public.playbook_steps
    where playbook_id = p_playbook_id
      and status = 'planned'
      and action_id is null
    order by position asc, created_at asc
  loop
    v_service := case
      when v_step.service_offering_id is not null
        then public.keeprspace_service_offering_snapshot(v_step.service_offering_id)
      else null
    end;

    v_due_date_pending := v_step.due_date is null;
    v_due_time := nullif(v_step.metadata ->> 'due_time', '');
    if v_due_time is not null and v_due_time !~ '^\d{2}:\d{2}$' then
      v_due_time := null;
    end if;
    v_has_time := (not v_due_date_pending) and v_due_time is not null;
    v_due_at := case
      when v_step.due_date is null then ((current_date + interval '30 days')::date::text || 'T12:00:00Z')::timestamptz
      else (v_step.due_date::text || 'T' || coalesce(v_due_time, '12:00') || ':00Z')::timestamptz
    end;

    v_extra := jsonb_build_object(
      'source', 'keeprspace_playbook',
      'action_type', case when v_step.step_type = 'service' then 'service' else 'playbook_action' end,
      'playbook_id', v_playbook.id,
      'playbook_step_id', v_step.id,
      'playbook_name', v_playbook.name,
      'playbook_step_position', v_step.position,
      'playbook_step_type', v_step.step_type,
      'responsible_party_default', v_step.responsible_party,
      'visibility_org_id', v_playbook.organization_id,
      'asset_relationship_id', v_playbook.asset_relationship_id,
      'playbook_due_date_pending', v_due_date_pending,
      'playbook_due_date_placeholder', case when v_due_date_pending then v_due_at else null end,
      'playbook_scheduled_date', case when v_due_date_pending then null else v_step.due_date end,
      'playbook_scheduled_time', case when v_due_date_pending then null else v_due_time end,
      'playbook_has_time', v_has_time
    ) || coalesce(v_step.metadata, '{}'::jsonb);

    if v_service is not null then
      v_extra := v_extra || jsonb_build_object(
        'service_action', true,
        'service_template_id', v_step.service_offering_id,
        'service_template_key', coalesce(v_service ->> 'key', v_step.service_offering_id::text),
        'service_template_name', v_service ->> 'name',
        'service_template_label', v_service ->> 'label',
        'service_template_snapshot', v_service,
        'service_template_org_id', v_playbook.organization_id
      );
    end if;

    insert into public.reminders (
      owner_id,
      title,
      notes,
      due_at,
      has_time,
      is_urgent,
      repeat_rule,
      status,
      asset_id,
      system_id,
      extra_metadata,
      created_at,
      updated_at
    )
    values (
      coalesce(v_playbook.owner_user_id, auth.uid()),
      v_step.title,
      coalesce(v_service ->> 'owner_facing_description', v_step.metadata ->> 'notes'),
      v_due_at,
      v_has_time,
      false,
      null,
      'open',
      v_playbook.asset_id,
      coalesce(v_playbook.system_id, null),
      v_extra,
      now(),
      now()
    )
    returning id into v_action_id;

    update public.playbook_steps
    set action_id = v_action_id,
        status = 'activated',
        updated_at = now()
    where id = v_step.id;
  end loop;

  update public.playbooks
  set status = 'active',
      updated_at = now()
  where id = p_playbook_id;

  return public.list_keeprspace_playbooks(v_playbook.organization_id, v_playbook.asset_id, v_playbook.system_id);
end;
$$;

grant execute on function public.activate_keeprspace_playbook(uuid) to authenticated;
