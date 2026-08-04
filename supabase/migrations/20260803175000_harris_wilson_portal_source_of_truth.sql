create or replace function public.get_keeprpro_stewardship_messages(
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
  v_org_id uuid;
  v_keepr_pro_id uuid;
  v_messages jsonb;
begin
  select a.id, aps.organization_id, aps.keepr_pro_id
  into v_asset_id, v_org_id, v_keepr_pro_id
  from public.assets a
  join public.asset_provider_stewardships aps
    on aps.asset_id = a.id
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

  if v_asset_id is null then
    return '[]'::jsonb;
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'subject', t.subject,
        'status', t.status,
        'asset_id', t.asset_id,
        'updated_at', t.updated_at,
        'latest_message', latest.body,
        'latest_message_id', latest.id,
        'latest_message_at', latest.created_at,
        'sender_type', latest.sender_type,
        'sender_name', latest.sender_name,
        'messages', coalesce(thread_messages.messages, '[]'::jsonb)
      )
      order by t.updated_at desc
    ),
    '[]'::jsonb
  )
  into v_messages
  from public.asset_threads t
  left join lateral (
    select m.id, m.body, m.created_at, m.sender_type, m.sender_name
    from public.asset_thread_messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) latest on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', m.id,
        'body', m.body,
        'created_at', m.created_at,
        'sender_type', m.sender_type,
        'sender_name', m.sender_name,
        'from_user_id', m.from_user_id
      )
      order by m.created_at asc
    ) as messages
    from public.asset_thread_messages m
    where m.thread_id = t.id
  ) thread_messages on true
  where t.asset_id = v_asset_id
    and (
      t.keepr_pro_id = v_keepr_pro_id
      or t.resource_ref #>> '{message_link,intended_recipient,source_type}' = 'keepr_pro'
    );

  return v_messages;
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
    and coalesce(r.status, 'open') not in ('completed', 'deleted', 'archived')
    and coalesce(r.extra_metadata ->> 'source', '') <> 'harris_wilson_demo'
    and public.keeprpro_can_access_provider_action(r.id, auth.uid(), v_row.organization_id)
    and (
      r.title ilike '%winterization%'
      or r.notes ilike '%winterization%'
    )
  order by r.due_at asc nulls last, r.created_at desc
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
    '[]'::jsonb,
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

create or replace function public.get_keeprpro_portfolio_workspace(
  p_organization_id uuid default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_context record;
  v_assets jsonb;
  v_asset_ids uuid[];
  v_open_actions jsonb;
  v_upcoming_work jsonb;
  v_recent_service_activity jsonb;
  v_recent_messages jsonb;
begin
  select
    o.id as organization_id,
    o.slug as organization_slug,
    coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.name) as organization_name,
    kp.id as keepr_pro_id,
    coalesce(nullif(kp.display_name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), o.name) as display_name,
    kp.profile_status,
    kp.claimed_state,
    m.role as member_role
  into v_context
  from public.orgs o
  join public.org_members m
    on m.org_id = o.id
  join public.keepr_pros kp
    on kp.organization_id = o.id
  where auth.uid() is not null
    and m.user_id = auth.uid()
    and coalesce(m.status, 'active') = 'active'
    and coalesce(o.status, 'active') = 'active'
    and (p_organization_id is null or o.id = p_organization_id)
    and coalesce(o.org_type, o.organization_type, 'personal') = 'keeprpro'
  order by case when o.slug = 'wilsonmarine' then 0 else 1 end, o.name
  limit 1;

  if v_context.organization_id is null then
    return jsonb_build_object(
      'context', null,
      'assets', '[]'::jsonb,
      'open_actions', '[]'::jsonb,
      'recent_messages', '[]'::jsonb,
      'upcoming_work', '[]'::jsonb,
      'recent_service_activity', '[]'::jsonb
    );
  end if;

  select coalesce(array_agg(row_asset.asset_id), array[]::uuid[])
  into v_asset_ids
  from public.get_keeprpro_connected_assets(
    v_context.organization_id,
    p_search,
    p_limit,
    p_offset
  ) as row_asset;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'acting_user_id', auth.uid(),
        'organization_id', aps.organization_id,
        'keepr_pro_id', aps.keepr_pro_id,
        'stewardship_id', aps.id,
        'relationship_type', aps.relationship_type,
        'access_scope', aps.access_scope,
        'asset_id', a.id,
        'asset_name', a.name,
        'asset_type', a.type,
        'kac_id', a.kac_id,
        'owner_display_name', coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), p.email, 'Owner'),
        'year', a.year,
        'make', a.make,
        'model', a.model,
        'length_feet', a.length_feet,
        'engine_type', a.engine_type,
        'hero_media',
        case
          when hero_attachment.id is null then null
          else jsonb_build_object(
            'placement_id', hero_placement.id,
            'attachment_id', hero_attachment.id,
            'title', hero_attachment.title,
            'kind', hero_attachment.kind,
            'mime_type', hero_attachment.mime_type,
            'bucket', hero_attachment.bucket,
            'storage_path', hero_attachment.storage_path,
            'file_name', hero_attachment.file_name,
            'role', hero_placement.role
          )
        end,
        'portal_status', 'Service stewardship',
        'what_next', winter_action.title,
        'open_action_count', coalesce(action_counts.open_count, 0),
        'recent_message_preview', recent_message.body
      )
      order by a.name, a.created_at desc
    ),
    '[]'::jsonb
  )
  into v_assets
  from public.asset_provider_stewardships aps
  join public.assets a
    on a.id = aps.asset_id
  left join public.profiles p
    on p.id = a.owner_id
  left join public.attachment_placements hero_placement
    on hero_placement.id = a.hero_placement_id
   and hero_placement.target_type = 'asset'
   and hero_placement.target_id = a.id
  left join public.attachments hero_attachment
    on hero_attachment.id = hero_placement.attachment_id
   and hero_attachment.deleted_at is null
   and hero_attachment.kind = 'photo'
  left join lateral (
    select r.*
    from public.reminders r
    where r.asset_id = a.id
      and coalesce(r.status, 'open') not in ('completed', 'deleted', 'archived')
      and public.keeprpro_can_access_provider_action(r.id, auth.uid(), aps.organization_id)
      and coalesce(r.extra_metadata ->> 'source', '') <> 'harris_wilson_demo'
    order by r.due_at asc nulls last, r.created_at desc
    limit 1
  ) winter_action on true
  left join lateral (
    select count(*)::integer as open_count
    from public.reminders r
    where r.asset_id = a.id
      and coalesce(r.status, 'open') not in ('completed', 'deleted', 'archived')
      and public.keeprpro_can_access_provider_action(r.id, auth.uid(), aps.organization_id)
      and coalesce(r.extra_metadata ->> 'source', '') <> 'harris_wilson_demo'
  ) action_counts on true
  left join lateral (
    select m.body
    from public.asset_threads t
    join public.asset_thread_messages m
      on m.thread_id = t.id
    where t.asset_id = a.id
      and (
        t.keepr_pro_id = aps.keepr_pro_id
        or t.resource_ref #>> '{message_link,intended_recipient,source_type}' = 'keepr_pro'
      )
    order by m.created_at desc
    limit 1
  ) recent_message on true
  where auth.uid() is not null
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and (aps.starts_at is null or aps.starts_at <= now())
    and (aps.ends_at is null or aps.ends_at > now())
    and aps.organization_id = v_context.organization_id
    and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
    and a.deleted_at is null
    and (
      nullif(trim(p_search), '') is null
      or a.name ilike '%' || trim(p_search) || '%'
      or a.kac_id ilike '%' || trim(p_search) || '%'
      or coalesce(a.make, '') ilike '%' || trim(p_search) || '%'
      or coalesce(a.model, '') ilike '%' || trim(p_search) || '%'
      or coalesce(p.display_name, p.full_name, p.email, '') ilike '%' || trim(p_search) || '%'
    );

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'status', r.status,
        'due_at', r.due_at,
        'asset_id', r.asset_id,
        'asset_name', a.name,
        'kac_id', a.kac_id,
        'system_id', r.system_id,
        'system_name', s.name
      )
      order by r.due_at asc nulls last, r.created_at desc
    ),
    '[]'::jsonb
  )
  into v_open_actions
  from public.reminders r
  join public.assets a
    on a.id = r.asset_id
  left join public.systems s
    on s.id = r.system_id
  where r.asset_id = any(v_asset_ids)
    and coalesce(r.status, 'open') not in ('completed', 'deleted', 'archived')
    and public.keeprpro_can_access_provider_action(r.id, auth.uid(), v_context.organization_id)
    and coalesce(r.extra_metadata ->> 'source', '') <> 'harris_wilson_demo';

  select coalesce(
    jsonb_agg(item order by (item ->> 'due_at') asc nulls last),
    '[]'::jsonb
  )
  into v_upcoming_work
  from (
    select jsonb_build_object(
      'id', r.id,
      'title', r.title,
      'due_at', r.due_at,
      'asset_id', r.asset_id,
      'asset_name', a.name,
      'kac_id', a.kac_id
    ) as item
    from public.reminders r
    join public.assets a
      on a.id = r.asset_id
    where r.asset_id = any(v_asset_ids)
      and r.due_at is not null
      and coalesce(r.status, 'open') not in ('completed', 'deleted', 'archived')
      and public.keeprpro_can_access_provider_action(r.id, auth.uid(), v_context.organization_id)
      and coalesce(r.extra_metadata ->> 'source', '') <> 'harris_wilson_demo'
    order by r.due_at asc
    limit 10
  ) upcoming;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', sr.id,
        'title', sr.title,
        'service_type', sr.service_type,
        'performed_at', sr.performed_at,
        'asset_id', sr.asset_id,
        'asset_name', a.name,
        'kac_id', a.kac_id,
        'verification_status', sr.verification_status
      )
      order by sr.performed_at desc nulls last, sr.created_at desc
    ),
    '[]'::jsonb
  )
  into v_recent_service_activity
  from public.service_records sr
  join public.assets a
    on a.id = sr.asset_id
  where sr.asset_id = any(v_asset_ids)
    and sr.keepr_pro_id = v_context.keepr_pro_id
  limit 10;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', t.id,
        'subject', t.subject,
        'status', t.status,
        'asset_id', t.asset_id,
        'asset_name', a.name,
        'kac_id', a.kac_id,
        'updated_at', t.updated_at,
        'latest_message', latest.body,
        'latest_message_id', latest.id,
        'latest_message_at', latest.created_at,
        'sender_type', latest.sender_type,
        'sender_name', latest.sender_name
      )
      order by t.updated_at desc
    ),
    '[]'::jsonb
  )
  into v_recent_messages
  from public.asset_threads t
  join public.assets a
    on a.id = t.asset_id
  join public.asset_provider_stewardships aps
    on aps.asset_id = t.asset_id
   and aps.organization_id = v_context.organization_id
   and aps.keepr_pro_id = v_context.keepr_pro_id
   and aps.status = 'active'
  left join lateral (
    select m.id, m.body, m.created_at, m.sender_type, m.sender_name
    from public.asset_thread_messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) latest on true
  where t.asset_id = any(v_asset_ids)
    and (
      t.keepr_pro_id = v_context.keepr_pro_id
      or t.resource_ref #>> '{message_link,intended_recipient,source_type}' = 'keepr_pro'
    )
  limit 10;

  return jsonb_build_object(
    'context',
    jsonb_build_object(
      'organization_id', v_context.organization_id,
      'organization_slug', v_context.organization_slug,
      'organization_name', v_context.organization_name,
      'keepr_pro_id', v_context.keepr_pro_id,
      'display_name', v_context.display_name,
      'profile_status', v_context.profile_status,
      'claimed_state', v_context.claimed_state,
      'member_role', v_context.member_role
    ),
    'assets', v_assets,
    'open_actions', v_open_actions,
    'recent_messages', v_recent_messages,
    'upcoming_work', v_upcoming_work,
    'recent_service_activity', v_recent_service_activity
  );
end;
$$;

update public.reminders
set
  extra_metadata = coalesce(extra_metadata, '{}'::jsonb) - 'service_state' - 'relationship_portal_kind',
  updated_at = now()
where id = '5d740c3b-ff98-41c9-aa8f-f44d76b61334';

grant execute on function public.get_keeprpro_stewardship_messages(uuid, text, uuid) to authenticated;
grant execute on function public.get_keeprpro_relationship_portal(uuid, text, uuid) to authenticated;
grant execute on function public.get_keeprpro_portfolio_workspace(uuid, text, integer, integer) to authenticated;
