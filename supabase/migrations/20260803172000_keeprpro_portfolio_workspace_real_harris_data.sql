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
        (
          (
            r.preferred_provider_id = aps.keepr_pro_id
            or r.extra_metadata #>> '{provider_target,id}' = aps.keepr_pro_id::text
            or r.extra_metadata #>> '{provider_target,organization_id}' = aps.organization_id::text
          )
          and coalesce(r.extra_metadata ->> 'provider_access_scope', '') = aps.access_scope
          and (
            coalesce(r.extra_metadata ->> 'provider_stewardship_id', '') = aps.id::text
            or coalesce(r.extra_metadata #>> '{provider_target,stewardship_id}', '') = aps.id::text
          )
        )
        or (
          r.extra_metadata ->> 'source' = 'keeprpro_private_request'
          and r.extra_metadata #>> '{provider_target,id}' = aps.keepr_pro_id::text
          and coalesce(r.extra_metadata #>> '{provider_target,asset_id}', r.asset_id::text) = aps.asset_id::text
        )
      )
  );
$$;

create or replace function public.get_keeprpro_stewardship_asset_by_kac(
  p_kac text,
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
begin
  select a.id
  into v_asset_id
  from public.assets a
  join public.asset_provider_stewardships aps
    on aps.asset_id = a.id
  where upper(a.kac_id) = upper(trim(coalesce(p_kac, '')))
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and (p_organization_id is null or aps.organization_id = p_organization_id)
    and public.keeprpro_user_can_act_for_org(auth.uid(), aps.organization_id)
    and a.deleted_at is null
  order by a.created_at desc
  limit 1;

  if v_asset_id is null then
    return null;
  end if;

  return public.get_keeprpro_stewardship_asset(v_asset_id, p_organization_id);
end;
$$;

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
        'latest_message_at', latest.created_at,
        'sender_type', latest.sender_type,
        'sender_name', latest.sender_name
      )
      order by t.updated_at desc
    ),
    '[]'::jsonb
  )
  into v_messages
  from public.asset_threads t
  left join lateral (
    select m.body, m.created_at, m.sender_type, m.sender_name
    from public.asset_thread_messages m
    where m.thread_id = t.id
    order by m.created_at desc
    limit 1
  ) latest on true
  where t.asset_id = v_asset_id
    and (
      t.keepr_pro_id = v_keepr_pro_id
      or t.resource_ref #>> '{message_link,intended_recipient,source_type}' = 'keepr_pro'
    );

  return v_messages;
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
      'context',
      null,
      'assets',
      '[]'::jsonb,
      'open_actions',
      '[]'::jsonb,
      'recent_messages',
      '[]'::jsonb,
      'upcoming_work',
      '[]'::jsonb,
      'recent_service_activity',
      '[]'::jsonb
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

  select coalesce(jsonb_agg(to_jsonb(row_asset)), '[]'::jsonb)
  into v_assets
  from public.get_keeprpro_connected_assets(
    v_context.organization_id,
    p_search,
    p_limit,
    p_offset
  ) as row_asset;

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
    'assets',
    v_assets,
    'open_actions',
    v_open_actions,
    'recent_messages',
    v_recent_messages,
    'upcoming_work',
    v_upcoming_work,
    'recent_service_activity',
    v_recent_service_activity
  );
end;
$$;

grant execute on function public.keeprpro_can_access_provider_action(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_keeprpro_stewardship_asset_by_kac(text, uuid) to authenticated;
grant execute on function public.get_keeprpro_stewardship_messages(uuid, text, uuid) to authenticated;
grant execute on function public.get_keeprpro_portfolio_workspace(uuid, text, integer, integer) to authenticated;

update public.reminders
set
  status = 'archived',
  updated_at = now(),
  extra_metadata = coalesce(extra_metadata, '{}'::jsonb) || jsonb_build_object(
    'archived_reason',
    'superseded_by_existing_harris_wilson_winterization_action'
  )
where id = '0fa6ef8b-762f-45d7-bbfd-e373dd50d6c1'
  and extra_metadata ->> 'source' = 'harris_wilson_demo';
