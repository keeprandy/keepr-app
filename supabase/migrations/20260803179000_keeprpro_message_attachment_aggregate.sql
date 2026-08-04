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

grant execute on function public.get_keeprpro_relationship_portal(uuid, text, uuid) to authenticated;

comment on function public.get_keeprpro_relationship_portal(uuid, text, uuid) is
  'Relationship portal projection. Shared files are aggregated from asset/thread/message/stewardship/action attachment placements.';
