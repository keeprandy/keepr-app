-- Harris-Wilson next vertical slice:
-- - make service_stewardship projection explicit
-- - seed the shared "Engine bogs under load" Action
-- - expose provider-facing Action detail/update RPCs through provider stewardship

alter table public.asset_provider_stewardships
  add column if not exists projection_config jsonb not null default '{}'::jsonb;

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
      and coalesce(r.extra_metadata ->> 'provider_access_scope', '') = aps.access_scope
      and (
        coalesce(r.extra_metadata ->> 'provider_stewardship_id', '') = aps.id::text
        or coalesce(r.extra_metadata #>> '{provider_target,stewardship_id}', '') = aps.id::text
      )
  );
$$;

drop function if exists public.get_keeprpro_connected_assets(uuid);

create or replace function public.get_keeprpro_connected_assets(
  p_organization_id uuid default null,
  p_search text default null,
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  acting_user_id uuid,
  organization_id uuid,
  keepr_pro_id uuid,
  stewardship_id uuid,
  relationship_type text,
  access_scope text,
  asset_id uuid,
  asset_name text,
  asset_type text,
  kac_id text,
  owner_display_name text,
  year integer,
  make text,
  model text,
  length_feet numeric,
  engine_type text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() as acting_user_id,
    aps.organization_id,
    aps.keepr_pro_id,
    aps.id as stewardship_id,
    aps.relationship_type,
    aps.access_scope,
    a.id as asset_id,
    a.name as asset_name,
    a.type as asset_type,
    a.kac_id,
    coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), p.email, 'Owner') as owner_display_name,
    a.year,
    a.make,
    a.model,
    a.length_feet,
    a.engine_type
  from public.asset_provider_stewardships aps
  join public.assets a
    on a.id = aps.asset_id
  left join public.profiles p
    on p.id = a.owner_id
  where auth.uid() is not null
    and aps.status = 'active'
    and aps.access_scope = 'service_stewardship'
    and (aps.starts_at is null or aps.starts_at <= now())
    and (aps.ends_at is null or aps.ends_at > now())
    and (p_organization_id is null or aps.organization_id = p_organization_id)
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
  order by a.name, a.created_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

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
    'attachment_id', a.id,
    'title', a.title,
    'kind', a.kind,
    'mime_type', a.mime_type,
    'bucket', a.bucket,
    'storage_path', a.storage_path,
    'file_name', a.file_name,
    'role', ap.role
  )
  into v_hero_media
  from public.attachment_placements ap
  join public.attachments a
    on a.id = ap.attachment_id
  where ap.target_type = 'asset'
    and ap.target_id = v_row.asset_id
    and ap.id = v_row.hero_placement_id
    and a.deleted_at is null
    and a.kind = 'photo'
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

create or replace function public.get_keeprpro_stewardship_action(
  p_reminder_id uuid,
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
begin
  select
    r.id,
    r.title,
    r.notes,
    r.status,
    r.due_at,
    r.has_time,
    r.is_urgent,
    r.asset_id,
    r.system_id,
    r.extra_metadata,
    aps.id as stewardship_id,
    aps.access_scope,
    aps.relationship_type,
    a.name as asset_name,
    a.type as asset_type,
    a.kac_id,
    s.name as system_name,
    kp.id as keepr_pro_id,
    coalesce(nullif(kp.display_name, ''), kp.name) as provider_name,
    o.id as organization_id,
    coalesce(nullif(o.display_name, ''), o.name, kp.name) as organization_name,
    coalesce(nullif(p.display_name, ''), nullif(p.full_name, ''), p.email, 'Owner') as owner_display_name
  into v_row
  from public.reminders r
  join public.asset_provider_stewardships aps
    on aps.asset_id = r.asset_id
  join public.assets a
    on a.id = r.asset_id
  join public.keepr_pros kp
    on kp.id = aps.keepr_pro_id
  join public.orgs o
    on o.id = aps.organization_id
  left join public.systems s
    on s.id = r.system_id
  left join public.profiles p
    on p.id = a.owner_id
  where r.id = p_reminder_id
    and (p_organization_id is null or aps.organization_id = p_organization_id)
    and public.keeprpro_can_access_provider_action(r.id, auth.uid(), aps.organization_id)
  limit 1;

  if v_row.id is null then
    return null;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'title', v_row.title,
    'notes', v_row.notes,
    'status', v_row.status,
    'due_at', v_row.due_at,
    'has_time', v_row.has_time,
    'is_urgent', v_row.is_urgent,
    'access_scope', v_row.access_scope,
    'relationship_label', case
      when v_row.relationship_type = 'servicing_dealer' then 'Servicing dealer'
      else initcap(replace(v_row.relationship_type, '_', ' '))
    end,
    'asset', jsonb_build_object(
      'id', v_row.asset_id,
      'name', v_row.asset_name,
      'type', v_row.asset_type,
      'kac_id', v_row.kac_id,
      'owner_display_name', v_row.owner_display_name
    ),
    'system', case
      when v_row.system_id is null then null
      else jsonb_build_object('id', v_row.system_id, 'name', v_row.system_name)
    end,
    'provider', jsonb_build_object(
      'keepr_pro_id', v_row.keepr_pro_id,
      'organization_id', v_row.organization_id,
      'name', v_row.provider_name,
      'organization_name', v_row.organization_name
    ),
    'provider_response', coalesce(v_row.extra_metadata -> 'provider_response', '{}'::jsonb),
    'shared_notes', v_row.extra_metadata ->> 'shared_notes'
  );
end;
$$;

create or replace function public.update_keeprpro_stewardship_action_response(
  p_reminder_id uuid,
  p_organization_id uuid,
  p_note text default null,
  p_next_step text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next_meta jsonb;
begin
  if not public.keeprpro_can_access_provider_action(p_reminder_id, auth.uid(), p_organization_id) then
    return null;
  end if;

  update public.reminders r
  set
    extra_metadata = coalesce(r.extra_metadata, '{}'::jsonb) || jsonb_build_object(
      'provider_response',
      jsonb_build_object(
        'note', nullif(p_note, ''),
        'next_step', nullif(p_next_step, ''),
        'responded_at', now(),
        'responded_by_user_id', auth.uid(),
        'source', 'keeprpro_stewardship_view'
      )
    ),
    updated_at = now()
  where r.id = p_reminder_id
  returning r.extra_metadata into v_next_meta;

  return public.get_keeprpro_stewardship_action(p_reminder_id, p_organization_id);
end;
$$;

grant execute on function public.keeprpro_can_access_provider_action(uuid, uuid, uuid) to authenticated;
grant execute on function public.get_keeprpro_connected_assets(uuid, text, integer, integer) to authenticated;
grant execute on function public.get_keeprpro_stewardship_asset(uuid, uuid) to authenticated;
grant execute on function public.get_keeprpro_stewardship_action(uuid, uuid) to authenticated;
grant execute on function public.update_keeprpro_stewardship_action_response(uuid, uuid, text, text) to authenticated;

do $$
declare
  v_wilson_org_id uuid := '6ad2fe13-c1b5-40c7-bb2f-6d1c454e0a8d';
  v_wilson_pro_id uuid := 'b570b6b3-6c44-4925-a44e-d39bb22f2816';
  v_harris_asset_id uuid := '9733c254-579b-47ab-8b51-593b1d44f8fa';
  v_andy_user_id uuid := 'b508214b-f076-4526-b126-7fc85a2297f2';
  v_stewardship_id uuid := '2f3c6b9e-5c3a-45c2-b4a7-3db30a911781';
  v_action_id uuid := '0fa6ef8b-762f-45d7-bbfd-e373dd50d6c1';
  v_main_engine_id uuid := 'bb839ac6-e699-42fa-98eb-2c85330c746e';
  v_motor_id uuid := 'a722a68a-3be6-491d-9d26-f238062a8437';
  v_lower_unit_id uuid := '9658d96d-45de-476f-9788-915a7f5b4a0f';
begin
  update public.asset_provider_stewardships
  set
    projection_config = jsonb_build_object(
      'included_system_ids',
      jsonb_build_array(v_main_engine_id, v_motor_id, v_lower_unit_id),
      'hero_placement_id',
      '11daf57c-e158-410d-947f-1c75b7f0df02',
      'included_system_reason',
      'Engine bogs under load Harris-Wilson service stewardship demo'
    ),
    updated_at = now()
  where id = v_stewardship_id;

  insert into public.reminders (
    id,
    owner_id,
    title,
    notes,
    due_at,
    has_time,
    is_urgent,
    status,
    asset_id,
    system_id,
    preferred_provider_id,
    extra_metadata,
    created_at,
    updated_at
  )
  values (
    v_action_id,
    v_andy_user_id,
    'Engine bogs under load',
    'Owner reports the Harris engine bogs under load. Wilson Marine should review engine/fuel delivery context and recommend the next diagnostic step.',
    now() + interval '7 days',
    false,
    true,
    'open',
    v_harris_asset_id,
    v_main_engine_id,
    v_wilson_pro_id,
    jsonb_build_object(
      'source', 'harris_wilson_demo',
      'action_context', 'asset',
      'shared_notes', 'Demo request: engine bogs under load during operation.',
      'provider_access_scope', 'service_stewardship',
      'provider_stewardship_id', v_stewardship_id,
      'provider_target', jsonb_build_object(
        'type', 'keepr_pro',
        'id', v_wilson_pro_id,
        'organization_id', v_wilson_org_id,
        'stewardship_id', v_stewardship_id,
        'label', 'Wilson Marine',
        'scope', 'asset',
        'access_scope', 'service_stewardship',
        'asset_id', v_harris_asset_id,
        'system_id', v_main_engine_id,
        'relationship_label', 'Servicing dealer'
      )
    ),
    now(),
    now()
  )
  on conflict (id) do update
    set title = excluded.title,
        notes = excluded.notes,
        due_at = excluded.due_at,
        has_time = excluded.has_time,
        is_urgent = excluded.is_urgent,
        status = excluded.status,
        asset_id = excluded.asset_id,
        system_id = excluded.system_id,
        preferred_provider_id = excluded.preferred_provider_id,
        extra_metadata = excluded.extra_metadata,
        updated_at = now();
end $$;
