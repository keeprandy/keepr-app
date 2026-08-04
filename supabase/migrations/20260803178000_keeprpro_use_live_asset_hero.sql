create or replace function public.get_keeprpro_stewardship_asset(
  p_asset_id uuid,
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
  v_systems jsonb;
  v_service_records jsonb;
  v_actions jsonb;
  v_hero_media jsonb;
  v_included_system_ids uuid[];
begin
  select
    aps.id as stewardship_id,
    aps.organization_id,
    aps.keepr_pro_id,
    aps.relationship_type,
    aps.access_scope,
    aps.projection_config,
    o.slug as organization_slug,
    coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.name) as organization_name,
    kp.slug as keepr_pro_slug,
    coalesce(nullif(kp.display_name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), o.name) as keepr_pro_name,
    a.id as asset_id,
    a.name as asset_name,
    a.type as asset_type,
    a.kac_id,
    a.year,
    a.make,
    a.model,
    a.hull_material,
    a.length_feet,
    a.engine_type,
    a.engine_hours,
    a.hero_placement_id,
    coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), p.email, 'Owner') as owner_display_name
  into v_row
  from public.asset_provider_stewardships aps
  join public.assets a
    on a.id = aps.asset_id
  join public.orgs o
    on o.id = aps.organization_id
  join public.keepr_pros kp
    on kp.id = aps.keepr_pro_id
  left join public.profiles p
    on p.id = a.owner_id
  where auth.uid() is not null
    and aps.asset_id = p_asset_id
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and (aps.starts_at is null or aps.starts_at <= now())
    and (aps.ends_at is null or aps.ends_at > now())
    and (p_organization_id is null or aps.organization_id = p_organization_id)
    and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
    and a.deleted_at is null
  limit 1;

  if v_row.asset_id is null then
    return null;
  end if;

  select coalesce(array_agg(value::uuid), array[]::uuid[])
  into v_included_system_ids
  from jsonb_array_elements_text(coalesce(v_row.projection_config -> 'included_system_ids', '[]'::jsonb)) as ids(value);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'name', s.name,
        'system_type', s.system_type,
        'status', s.status,
        'lifecycle_status', s.lifecycle_status,
        'last_service_date', s.last_service_date,
        'next_service_date', s.next_service_date
      )
      order by s.name
    ),
    '[]'::jsonb
  )
  into v_systems
  from public.systems s
  where s.asset_id = v_row.asset_id
    and s.id = any(v_included_system_ids);

  select jsonb_build_object(
    'placement_id', ap.id,
    'attachment_id', att.id,
    'title', att.title,
    'kind', att.kind,
    'mime_type', att.mime_type,
    'bucket', att.bucket,
    'storage_path', att.storage_path,
    'file_name', att.file_name,
    'role', ap.role
  )
  into v_hero_media
  from public.attachment_placements ap
  join public.attachments att
    on att.id = ap.attachment_id
  where ap.target_type = 'asset'
    and ap.target_id = v_row.asset_id
    and ap.id = v_row.hero_placement_id
    and att.deleted_at is null
    and att.kind = 'photo'
  limit 1;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', sr.id,
        'title', sr.title,
        'service_type', sr.service_type,
        'category', sr.category,
        'performed_at', sr.performed_at,
        'verification_status', sr.verification_status
      )
      order by sr.performed_at desc nulls last, sr.created_at desc
    ),
    '[]'::jsonb
  )
  into v_service_records
  from public.service_records sr
  where sr.asset_id = v_row.asset_id
    and sr.keepr_pro_id = v_row.keepr_pro_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'notes', r.notes,
        'due_at', r.due_at,
        'status', r.status,
        'is_urgent', r.is_urgent,
        'system_id', r.system_id,
        'system_name', s.name,
        'provider_response', r.extra_metadata #>> '{provider_response,note}',
        'provider_next_step', r.extra_metadata #>> '{provider_response,next_step}',
        'provider_target', r.extra_metadata -> 'provider_target'
      )
      order by r.due_at asc nulls last, r.created_at desc
    ),
    '[]'::jsonb
  )
  into v_actions
  from public.reminders r
  left join public.systems s
    on s.id = r.system_id
  where r.asset_id = v_row.asset_id
    and coalesce(r.status, 'open') not in ('completed', 'deleted', 'archived')
    and public.keeprpro_can_access_provider_action(r.id, auth.uid(), v_row.organization_id);

  return jsonb_build_object(
    'view_label', 'Stewardship View · ' || v_row.organization_name,
    'relationship_label', case
      when v_row.relationship_type = 'servicing_dealer' then 'Servicing dealer'
      else initcap(replace(v_row.relationship_type, '_', ' '))
    end,
    'access_scope', v_row.access_scope,
    'scope_label', 'KeeprPro stewardship context',
    'acting_user_id', auth.uid(),
    'organization', jsonb_build_object(
      'id', v_row.organization_id,
      'name', v_row.organization_name,
      'slug', v_row.organization_slug
    ),
    'keepr_pro', jsonb_build_object(
      'id', v_row.keepr_pro_id,
      'name', v_row.keepr_pro_name,
      'slug', v_row.keepr_pro_slug
    ),
    'stewardship', jsonb_build_object(
      'id', v_row.stewardship_id,
      'relationship_type', v_row.relationship_type,
      'access_scope', v_row.access_scope,
      'included_system_ids', coalesce(v_row.projection_config -> 'included_system_ids', '[]'::jsonb)
    ),
    'asset', jsonb_build_object(
      'id', v_row.asset_id,
      'name', v_row.asset_name,
      'type', v_row.asset_type,
      'kac_id', v_row.kac_id,
      'owner_display_name', v_row.owner_display_name,
      'year', v_row.year,
      'make', v_row.make,
      'model', v_row.model,
      'hull_material', v_row.hull_material,
      'length_feet', v_row.length_feet,
      'engine_type', v_row.engine_type,
      'engine_hours', v_row.engine_hours
    ),
    'hero_media', v_hero_media,
    'systems', v_systems,
    'service_records', v_service_records,
    'actions', v_actions
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
        'portal_status', coalesce(winter_action.extra_metadata #>> '{service_state,status}', 'Service stewardship'),
        'what_next', coalesce(winter_action.extra_metadata #>> '{service_state,next_step}', winter_action.title),
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
    order by
      case when r.extra_metadata ->> 'relationship_portal_kind' = 'annual_winterization' then 0 else 1 end,
      r.due_at asc nulls last,
      r.created_at desc
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
    )
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));

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
    select m.body, m.created_at, m.sender_type, m.sender_name
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

grant execute on function public.get_keeprpro_stewardship_asset(uuid, uuid) to authenticated;
grant execute on function public.get_keeprpro_portfolio_workspace(uuid, text, integer, integer) to authenticated;

comment on function public.get_keeprpro_stewardship_asset(uuid, uuid) is
  'Returns the KeeprPro stewardship projection using the owner-selected live assets.hero_placement_id for hero media.';
