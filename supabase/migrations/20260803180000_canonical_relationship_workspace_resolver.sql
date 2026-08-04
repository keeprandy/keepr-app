create or replace function public.keeprpro_can_access_provider_action(
  p_reminder_id uuid,
  p_user_id uuid,
  p_organization_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.reminders r
    join public.asset_provider_stewardships aps
      on aps.asset_id = r.asset_id
    where r.id = p_reminder_id
      and p_user_id is not null
      and aps.status = 'active'
      and aps.access_scope = 'service_stewardship'
      and (aps.starts_at is null or aps.starts_at <= now())
      and (aps.ends_at is null or aps.ends_at > now())
      and (p_organization_id is null or aps.organization_id = p_organization_id)
      and public.keeprpro_user_can_act_for_org(p_user_id, aps.organization_id)
      and (
        r.preferred_provider_id = aps.keepr_pro_id
        or r.extra_metadata #>> '{provider_target,id}' = aps.keepr_pro_id::text
        or r.extra_metadata #>> '{provider_target,organization_id}' = aps.organization_id::text
      )
      and coalesce(r.extra_metadata #>> '{provider_target,asset_id}', r.asset_id::text) = aps.asset_id::text
      and (
        coalesce(r.extra_metadata ->> 'provider_access_scope', '') in ('', aps.access_scope)
      )
      and (
        coalesce(r.extra_metadata ->> 'provider_stewardship_id', '') in ('', aps.id::text)
        or coalesce(r.extra_metadata #>> '{provider_target,stewardship_id}', '') in ('', aps.id::text)
      )
  );
$$;

create or replace function public.resolve_relationship_workspace(
  asset_id uuid,
  provider_org_id uuid,
  action_id uuid default null
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
  v_thread_messages jsonb := '[]'::jsonb;
  v_shared_files jsonb := '[]'::jsonb;
  v_service_record jsonb;
  v_open_action_count integer := 0;
begin
  select
    a.id as asset_id,
    a.name as asset_name,
    a.kac_id,
    a.owner_id,
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
    and a.id = resolve_relationship_workspace.asset_id
    and aps.organization_id = provider_org_id
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
    and a.deleted_at is null
  limit 1;

  if v_row.asset_id is null then
    return null;
  end if;

  select count(*)
  into v_open_action_count
  from public.reminders r
  where r.asset_id = v_row.asset_id
    and coalesce(r.status, 'open') not in ('completed', 'deleted', 'archived')
    and coalesce(r.extra_metadata ->> 'source', '') <> 'harris_wilson_demo'
    and public.keeprpro_can_access_provider_action(r.id, auth.uid(), v_row.organization_id);

  select r.*, s.name as system_name
  into v_action
  from public.reminders r
  left join public.systems s
    on s.id = r.system_id
  where r.asset_id = v_row.asset_id
    and coalesce(r.status, 'open') not in ('deleted', 'archived')
    and coalesce(r.extra_metadata ->> 'source', '') <> 'harris_wilson_demo'
    and public.keeprpro_can_access_provider_action(r.id, auth.uid(), v_row.organization_id)
    and (action_id is null or r.id = action_id)
  order by
    case when r.id = action_id then 0 else 1 end,
    case when coalesce(r.status, 'open') = 'completed' then 1 else 0 end,
    r.due_at asc nulls last,
    r.created_at desc
  limit 1;

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
  end if;

  if v_action.id is not null then
    select to_jsonb(sr)
    into v_service_record
    from public.service_records sr
    where sr.asset_id = v_row.asset_id
      and (
        sr.id::text = v_action.extra_metadata ->> 'linked_service_record_id'
        or sr.extra_metadata @> jsonb_build_object('reminder_id', v_action.id::text)
      )
    order by sr.created_at desc
    limit 1;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'placement_id', picked.placement_id,
        'attachment_id', picked.attachment_id,
        'kind', picked.kind,
        'title', picked.title,
        'notes', picked.notes,
        'file_name', picked.file_name,
        'mime_type', picked.mime_type,
        'bucket', picked.bucket,
        'storage_path', picked.storage_path,
        'url', picked.url,
        'role', picked.role,
        'label', picked.label,
        'created_at', picked.created_at
      )
      order by picked.created_at desc
    ),
    '[]'::jsonb
  )
  into v_shared_files
  from (
    select distinct on (att.id)
      ap.id as placement_id,
      att.id as attachment_id,
      att.kind,
      att.title,
      att.notes,
      att.file_name,
      att.mime_type,
      att.bucket,
      att.storage_path,
      att.url,
      ap.role,
      ap.label,
      ap.created_at
    from public.attachment_placements ap
    join public.attachments att
      on att.id = ap.attachment_id
     and att.deleted_at is null
    where (
      (ap.target_type = 'asset' and ap.target_id = v_row.asset_id and ap.role in ('relationship_shared', 'message_shared'))
      or (ap.target_type = 'asset_provider_stewardship' and ap.target_id = v_row.stewardship_id)
      or (v_action.id is not null and ap.target_type = 'reminder' and ap.target_id = v_action.id)
      or (v_thread.id is not null and ap.target_type = 'asset_thread' and ap.target_id = v_thread.id)
      or (
        v_thread.id is not null
        and ap.target_type = 'asset_thread_message'
        and exists (
          select 1
          from public.asset_thread_messages m
          where m.id = ap.target_id
            and m.thread_id = v_thread.id
        )
      )
    )
    order by att.id, ap.created_at desc
  ) picked;

  return jsonb_build_object(
    'workspace_identity',
    jsonb_build_object(
      'asset_id', v_row.asset_id,
      'kac_id', v_row.kac_id,
      'provider_org_id', v_row.organization_id,
      'stewardship_id', v_row.stewardship_id,
      'action_id', v_action.id,
      'thread_id', v_thread.id,
      'service_record_id', v_service_record ->> 'id'
    ),
    'relationship',
    jsonb_build_object(
      'owner_id', v_row.owner_id,
      'owner_display_name', v_row.owner_display_name,
      'organization_id', v_row.organization_id,
      'organization_name', v_row.organization_name,
      'keepr_pro_id', v_row.keepr_pro_id,
      'keepr_pro_name', v_row.keepr_pro_name,
      'stewardship_id', v_row.stewardship_id,
      'relationship_type', v_row.relationship_type,
      'access_scope', v_row.access_scope
    ),
    'action',
    case
      when v_action.id is null then null
      else jsonb_build_object(
        'id', v_action.id,
        'title', v_action.title,
        'status', coalesce(v_action.status, 'open'),
        'due_at', v_action.due_at,
        'notes', v_action.notes,
        'system_id', v_action.system_id,
        'system_name', v_action.system_name,
        'provider_id', v_action.preferred_provider_id,
        'provider_target', v_action.extra_metadata -> 'provider_target',
        'responsible_party', v_action.extra_metadata -> 'responsible_party',
        'assigned_to', v_action.extra_metadata ->> 'assigned_to',
        'provider_response', coalesce(v_action.extra_metadata -> 'provider_response', '{}'::jsonb),
        'latest_activity_at', coalesce(v_action.updated_at, v_action.created_at),
        'created_at', v_action.created_at,
        'updated_at', v_action.updated_at,
        'completed_at', v_action.completed_at
      )
    end,
    'thread',
    case
      when v_thread.id is null then null
      else jsonb_build_object(
        'id', v_thread.id,
        'subject', v_thread.subject,
        'status', v_thread.status,
        'updated_at', v_thread.updated_at,
        'messages', v_thread_messages
      )
    end,
    'files', v_shared_files,
    'service_record', v_service_record,
    'open_action_count', v_open_action_count,
    'permitted_operations',
    jsonb_build_object(
      'view', true,
      'reply_to_thread', v_thread.id is not null,
      'add_file', true,
      'update_action_status', v_action.id is not null and coalesce(v_action.status, 'open') <> 'completed',
      'update_provider_response', v_action.id is not null and coalesce(v_action.status, 'open') <> 'completed',
      'complete_action', v_action.id is not null and coalesce(v_action.status, 'open') <> 'completed'
    )
  );
end;
$$;

grant execute on function public.keeprpro_can_access_provider_action(uuid, uuid, uuid) to authenticated;
grant execute on function public.resolve_relationship_workspace(uuid, uuid, uuid) to authenticated;

comment on function public.resolve_relationship_workspace(uuid, uuid, uuid) is
  'Canonical resolver for one asset-provider work objective. Action state comes from reminders.status; files and thread are references, not copied state.';

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
  v_asset_id uuid;
  v_workspace jsonb;
  v_action jsonb;
  v_relationship jsonb;
  v_next_step text;
begin
  if p_asset_id is not null then
    v_asset_id := p_asset_id;
  else
    select a.id
    into v_asset_id
    from public.assets a
    join public.asset_provider_stewardships aps
      on aps.asset_id = a.id
    where nullif(trim(coalesce(p_kac, '')), '') is not null
      and upper(a.kac_id) = upper(trim(p_kac))
      and aps.status = 'active'
      and aps.access_scope = 'service_stewardship'
      and (p_organization_id is null or aps.organization_id = p_organization_id)
      and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
      and a.deleted_at is null
    order by a.created_at desc
    limit 1;
  end if;

  if v_asset_id is null or p_organization_id is null then
    return null;
  end if;

  v_workspace := public.resolve_relationship_workspace(v_asset_id, p_organization_id, null);
  if v_workspace is null then
    return null;
  end if;

  v_action := v_workspace -> 'action';
  v_relationship := v_workspace -> 'relationship';
  v_next_step := nullif(v_action #>> '{provider_response,next_step}', '');

  return jsonb_build_object(
    'portal_label', 'Relationship Portal',
    'relationship_title', (v_relationship ->> 'owner_display_name') || ' ↔ ' || (v_relationship ->> 'organization_name'),
    'relationship_subtitle', (select a.name || ' · ' || a.kac_id from public.assets a where a.id = v_asset_id),
    'scope_label', 'KeeprPro projection thread',
    'owner_display_name', v_relationship ->> 'owner_display_name',
    'organization_name', v_relationship ->> 'organization_name',
    'asset_name', (select a.name from public.assets a where a.id = v_asset_id),
    'kac_id', (select a.kac_id from public.assets a where a.id = v_asset_id),
    'stewardship_id', v_relationship ->> 'stewardship_id',
    'access_scope', v_relationship ->> 'access_scope',
    'workspace_identity', v_workspace -> 'workspace_identity',
    'current_action', v_action,
    'what_next',
    case
      when v_next_step is null then null
      else jsonb_build_object(
        'title', v_next_step,
        'source', 'reminders.extra_metadata.provider_response.next_step',
        'action_id', v_action ->> 'id'
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
    'shared_files', coalesce(v_workspace -> 'files', '[]'::jsonb),
    'projection_thread', v_workspace -> 'thread',
    'service_record', v_workspace -> 'service_record',
    'shared_action_count', coalesce((v_workspace ->> 'open_action_count')::integer, 0),
    'permitted_operations', v_workspace -> 'permitted_operations'
  );
end;
$$;

grant execute on function public.get_keeprpro_relationship_portal(uuid, text, uuid) to authenticated;

comment on function public.get_keeprpro_relationship_portal(uuid, text, uuid) is
  'Relationship portal projection backed by resolve_relationship_workspace; current work state is canonical reminders state.';
