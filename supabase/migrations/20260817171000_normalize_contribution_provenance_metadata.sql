begin;

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
  v_asset_relationship_id uuid;
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

  select ar.id
  into v_asset_relationship_id
  from public.asset_relationships ar
  where ar.asset_id = v_reminder.asset_id
    and ar.organization_id = p_organization_id
    and ar.status in ('active', 'pending', 'invited', 'paused')
    and ar.relationship_type <> 'owner'
  order by ar.created_at desc
  limit 1;

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
      'keeprpro_stewardship',
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
        v_provider_name,
        'contributed_by_user_id',
        auth.uid()::text,
        'contributed_by_user_label',
        coalesce(v_actor_label, auth.uid()::text),
        'contributed_by_org_id',
        p_organization_id::text,
        'contributed_by_org_label',
        v_provider_name,
        'asset_relationship_id',
        v_asset_relationship_id::text,
        'stewardship_id',
        v_stewardship.id::text,
        'contribution_context',
        'trusted_provider_service_completion',
        'authority_state',
        'trusted_provider'
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
      'contributed_by_user_id',
      auth.uid()::text,
      'contributed_by_user_label',
      coalesce(v_actor_label, auth.uid()::text),
      'contributed_by_org_id',
      p_organization_id::text,
      'contributed_by_org_label',
      v_provider_name,
      'asset_relationship_id',
      v_asset_relationship_id::text,
      'stewardship_id',
      v_stewardship.id::text,
      'contribution_context',
      'trusted_provider_service_completion',
      'authority_state',
      'trusted_provider',
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
        coalesce(v_provider_name, 'Provider'),
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

create or replace function public.accept_relationship_record_contribution(
  p_contribution_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_contribution public.asset_relationship_record_contributions;
  v_record public.service_records;
  v_org_label text;
  v_user_label text;
begin
  select *
  into v_contribution
  from public.asset_relationship_record_contributions
  where id = p_contribution_id
  for update;

  if v_contribution.id is null then
    raise exception 'Contribution not found';
  end if;

  if v_contribution.to_user_id <> auth.uid() then
    raise exception 'Only the asset owner can accept this contribution';
  end if;

  if v_contribution.status <> 'pending' then
    return jsonb_build_object(
      'ok', true,
      'status', v_contribution.status,
      'service_record_id', v_contribution.accepted_service_record_id
    );
  end if;

  select coalesce(nullif(o.display_name, ''), nullif(o.name, ''), 'Organization')
  into v_org_label
  from public.orgs o
  where o.id = v_contribution.from_org_id;

  select coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), nullif(p.email, ''), v_contribution.from_user_id::text)
  into v_user_label
  from public.profiles p
  where p.id = v_contribution.from_user_id;

  insert into public.service_records (
    asset_id,
    title,
    notes,
    service_type,
    performed_at,
    cost,
    keepr_pro_id,
    source_type,
    verification_status,
    extra_metadata
  )
  values (
    v_contribution.asset_id,
    v_contribution.title,
    v_contribution.note,
    coalesce(v_contribution.record_type, 'service'),
    v_contribution.performed_at,
    v_contribution.amount,
    nullif(v_contribution.source_metadata ->> 'keepr_pro_id', '')::uuid,
    'relationship_contribution',
    'contributed',
    jsonb_build_object(
      'relationship_contribution_id', v_contribution.id,
      'source_org_id', v_contribution.from_org_id,
      'asset_relationship_id', v_contribution.asset_relationship_id,
      'stewardship_id', v_contribution.stewardship_id,
      'contributed_by_user_id', v_contribution.from_user_id,
      'contributed_by_user_label', v_user_label,
      'contributed_by_org_id', v_contribution.from_org_id,
      'contributed_by_org_label', v_org_label,
      'contribution_context', 'accepted_relationship_contribution',
      'authority_state', 'accepted'
    ) || coalesce(v_contribution.source_metadata, '{}'::jsonb)
  )
  returning * into v_record;

  insert into public.attachment_placements (attachment_id, target_type, target_id, role, label)
  select
    ap.attachment_id,
    'service_record',
    v_record.id,
    'proof',
    'relationship_contribution:' || v_contribution.id::text
  from public.attachment_placements ap
  where ap.target_type = 'asset_relationship_record_contribution'
    and ap.target_id = v_contribution.id
  on conflict (attachment_id, target_type, target_id) do update
    set
      role = excluded.role,
      label = excluded.label;

  update public.asset_relationship_record_contributions
  set
    status = 'accepted',
    accepted_service_record_id = v_record.id,
    accepted_at = now(),
    updated_at = now()
  where id = v_contribution.id
  returning * into v_contribution;

  return jsonb_build_object(
    'ok', true,
    'status', v_contribution.status,
    'service_record_id', v_record.id,
    'asset_id', v_record.asset_id
  );
end;
$$;

grant execute on function public.complete_keeprpro_stewardship_action(uuid, uuid, text, date) to authenticated;
grant execute on function public.accept_relationship_record_contribution(uuid) to authenticated;

commit;
