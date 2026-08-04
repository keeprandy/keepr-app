create or replace function public.send_keeprpro_stewardship_thread_reply(
  p_thread_id uuid,
  p_organization_id uuid,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_thread record;
  v_org_name text;
  v_message public.asset_thread_messages;
begin
  if nullif(trim(coalesce(p_body, '')), '') is null then
    raise exception 'Reply body is required.';
  end if;

  select
    t.*,
    coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.name) as organization_name
  into v_thread
  from public.asset_threads t
  join public.asset_provider_stewardships aps
    on aps.asset_id = t.asset_id
   and aps.organization_id = p_organization_id
   and aps.status = 'active'
   and aps.access_scope = 'service_stewardship'
  join public.orgs o
    on o.id = aps.organization_id
  join public.keepr_pros kp
    on kp.id = aps.keepr_pro_id
  where t.id = p_thread_id
    and auth.uid() is not null
    and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
    and (
      t.keepr_pro_id = aps.keepr_pro_id
      or t.resource_ref #>> '{message_link,intended_recipient,source_type}' = 'keepr_pro'
    )
  limit 1;

  if v_thread.id is null then
    return null;
  end if;

  insert into public.asset_thread_messages (
    thread_id,
    from_user_id,
    body,
    sender_type,
    sender_name
  )
  values (
    p_thread_id,
    auth.uid(),
    trim(p_body),
    'keepr_pro',
    v_thread.organization_name
  )
  returning * into v_message;

  update public.asset_threads
  set updated_at = v_message.created_at
  where id = p_thread_id;

  return to_jsonb(v_message);
end;
$$;

create or replace function public.update_keeprpro_stewardship_action_response(
  p_reminder_id uuid,
  p_organization_id uuid,
  p_note text default null,
  p_next_step text default null,
  p_status text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_meta jsonb;
  v_status text;
begin
  if not public.keeprpro_can_access_provider_action(p_reminder_id, auth.uid(), p_organization_id) then
    return null;
  end if;

  v_status := lower(nullif(trim(coalesce(p_status, '')), ''));
  if v_status is not null and v_status not in ('open', 'requested', 'in_progress', 'waiting', 'completed') then
    raise exception 'Unsupported Action status: %', p_status;
  end if;

  v_next_meta := jsonb_build_object(
    'provider_response',
    jsonb_strip_nulls(
      jsonb_build_object(
        'note', nullif(p_note, ''),
        'next_step', nullif(p_next_step, ''),
        'updated_at', now(),
        'updated_by', auth.uid()
      )
    )
  );

  update public.reminders r
  set
    status = coalesce(v_status, r.status),
    extra_metadata = coalesce(r.extra_metadata, '{}'::jsonb) || v_next_meta,
    updated_at = now()
  where r.id = p_reminder_id;

  return public.get_keeprpro_stewardship_action(p_reminder_id, p_organization_id);
end;
$$;

create or replace function public.get_keeprpro_relationship_portal(
  p_asset_id uuid default null,
  p_kac text default null,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row record;
  v_action record;
  v_thread record;
  v_thread_messages jsonb;
  v_provider_next_step text;
  v_shared_files jsonb;
begin
  select
    a.id as asset_id,
    a.name as asset_name,
    a.kac_id,
    coalesce(nullif(owner_profile.display_name, ''), nullif(owner_profile.full_name, ''), owner_profile.email, 'Owner') as owner_display_name,
    aps.id as stewardship_id,
    aps.relationship_type,
    aps.access_scope,
    o.id as organization_id,
    coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.name) as organization_name,
    kp.id as keepr_pro_id,
    coalesce(nullif(kp.display_name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), o.name) as keepr_pro_name
  into v_row
  from public.assets a
  join public.asset_provider_stewardships aps
    on aps.asset_id = a.id
  join public.orgs o
    on o.id = aps.organization_id
  join public.keepr_pros kp
    on kp.id = aps.keepr_pro_id
  left join public.profiles owner_profile
    on owner_profile.id = a.owner_id
  where auth.uid() is not null
    and (p_asset_id is null or a.id = p_asset_id)
    and (nullif(trim(coalesce(p_kac, '')), '') is null or upper(a.kac_id) = upper(trim(p_kac)))
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and (p_organization_id is null or aps.organization_id = p_organization_id)
    and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
    and a.deleted_at is null
  order by a.created_at desc
  limit 1;

  if v_row.asset_id is null then
    return null;
  end if;

  select r.*, s.name as system_name
  into v_action
  from public.reminders r
  left join public.systems s
    on s.id = r.system_id
  where r.asset_id = v_row.asset_id
    and coalesce(r.status, 'open') not in ('deleted', 'archived')
    and coalesce(r.extra_metadata ->> 'source', '') <> 'harris_wilson_demo'
    and public.keeprpro_can_access_provider_action(r.id, auth.uid(), v_row.organization_id)
    and (
      r.title ilike '%winterization%'
      or r.notes ilike '%winterization%'
    )
  order by
    case when coalesce(r.status, 'open') = 'completed' then 1 else 0 end,
    r.due_at asc nulls last,
    r.created_at desc
  limit 1;

  v_provider_next_step := nullif(v_action.extra_metadata #>> '{provider_response,next_step}', '');

  select t.*
  into v_thread
  from public.asset_threads t
  where t.asset_id = v_row.asset_id
    and (
      t.keepr_pro_id = v_row.keepr_pro_id
      or t.resource_ref #>> '{message_link,intended_recipient,source_type}' = 'keepr_pro'
    )
  order by t.updated_at desc
  limit 1;

  if v_thread.id is not null then
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', m.id,
          'body', m.body,
          'created_at', m.created_at,
          'sender_type', m.sender_type,
          'sender_name', m.sender_name,
          'from_user_id', m.from_user_id
        )
        order by m.created_at asc
      ),
      '[]'::jsonb
    )
    into v_thread_messages
    from public.asset_thread_messages m
    where m.thread_id = v_thread.id;
  else
    v_thread_messages := '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'placement_id', ap.id,
        'attachment_id', att.id,
        'kind', att.kind,
        'title', att.title,
        'notes', att.notes,
        'file_name', att.file_name,
        'mime_type', att.mime_type,
        'bucket', att.bucket,
        'storage_path', att.storage_path,
        'url', att.url,
        'role', ap.role,
        'label', ap.label,
        'created_at', ap.created_at
      )
      order by ap.created_at desc
    ),
    '[]'::jsonb
  )
  into v_shared_files
  from public.attachment_placements ap
  join public.attachments att
    on att.id = ap.attachment_id
   and att.deleted_at is null
  where ap.target_type = 'asset'
    and ap.target_id = v_row.asset_id
    and ap.role = 'relationship_shared'
    and ap.label = v_row.stewardship_id::text;

  return jsonb_build_object(
    'portal_label', 'Relationship Portal',
    'relationship_title', v_row.owner_display_name || ' ↔ ' || v_row.organization_name,
    'relationship_subtitle', v_row.asset_name || ' · ' || v_row.kac_id,
    'scope_label', 'KeeprPro projection thread',
    'owner_display_name', v_row.owner_display_name,
    'organization_name', v_row.organization_name,
    'asset_name', v_row.asset_name,
    'kac_id', v_row.kac_id,
    'stewardship_id', v_row.stewardship_id,
    'access_scope', v_row.access_scope,
    'current_action',
    case
      when v_action.id is null then null
      else jsonb_build_object(
        'id', v_action.id,
        'title', v_action.title,
        'status', v_action.status,
        'due_at', v_action.due_at,
        'notes', v_action.notes,
        'system_id', v_action.system_id,
        'system_name', v_action.system_name,
        'provider_id', v_action.preferred_provider_id,
        'provider_target', v_action.extra_metadata -> 'provider_target',
        'responsible_party', v_action.extra_metadata -> 'responsible_party',
        'assigned_to', v_action.extra_metadata ->> 'assigned_to',
        'provider_response', coalesce(v_action.extra_metadata -> 'provider_response', '{}'::jsonb),
        'created_at', v_action.created_at,
        'updated_at', v_action.updated_at
      )
    end,
    'what_next',
    case
      when v_provider_next_step is null then null
      else jsonb_build_object(
        'title', v_provider_next_step,
        'source', 'reminders.extra_metadata.provider_response.next_step',
        'action_id', v_action.id
      )
    end,
    'playbook',
    jsonb_build_object(
      'exists', false,
      'source', null,
      'reason', 'No ordered Action Playbook is connected to this Harris-Wilson Action.'
    ),
    'appointment',
    jsonb_build_object(
      'scheduled', false,
      'source', null
    ),
    'shared_files',
    v_shared_files,
    'projection_thread',
    case
      when v_thread.id is null then null
      else jsonb_build_object(
        'id', v_thread.id,
        'subject', v_thread.subject,
        'status', v_thread.status,
        'updated_at', v_thread.updated_at,
        'messages', v_thread_messages
      )
    end
  );
end;
$$;

grant execute on function public.send_keeprpro_stewardship_thread_reply(uuid, uuid, text) to authenticated;
grant execute on function public.update_keeprpro_stewardship_action_response(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.get_keeprpro_relationship_portal(uuid, text, uuid) to authenticated;
