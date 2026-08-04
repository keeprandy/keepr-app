alter table public.keepr_pros
  add column if not exists public_description text,
  add column if not exists publish_status text not null default 'draft',
  add column if not exists categories jsonb not null default '[]'::jsonb,
  add column if not exists locations jsonb not null default '[]'::jsonb,
  add column if not exists service_offerings jsonb not null default '[]'::jsonb,
  add column if not exists packages jsonb not null default '[]'::jsonb,
  add column if not exists verified_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists claimed_by_org_id uuid references public.orgs(id) on delete set null,
  add column if not exists claimed_by_user_id uuid references public.profiles(id) on delete set null;

update public.keepr_pros kp
set
  public_description = coalesce(nullif(kp.public_description, ''), nullif(kp.notes, ''), kp.short_description),
  publish_status = coalesce(nullif(kp.publish_status, ''), case when kp.profile_status in ('active', 'demo', 'claimed') then 'published' else 'draft' end),
  categories = case
    when jsonb_array_length(coalesce(kp.categories, '[]'::jsonb)) > 0 then kp.categories
    when nullif(kp.category, '') is not null then jsonb_build_array(kp.category)
    else '[]'::jsonb
  end,
  locations = case
    when jsonb_array_length(coalesce(kp.locations, '[]'::jsonb)) > 0 then kp.locations
    else jsonb_build_array(jsonb_build_object(
      'label', coalesce(nullif(kp.location, ''), concat_ws(', ', nullif(kp.city, ''), nullif(kp.state, ''))),
      'address_line1', kp.address_line1,
      'address_line2', kp.address_line2,
      'city', kp.city,
      'state', kp.state,
      'postal_code', kp.postal_code,
      'country', kp.country
    ))
  end,
  service_offerings = case
    when jsonb_array_length(coalesce(kp.service_offerings, '[]'::jsonb)) > 0 then kp.service_offerings
    else jsonb_build_array('Marine service', 'Winterization', 'Storage', 'Commissioning')
  end,
  packages = coalesce(kp.packages, '[]'::jsonb)
where kp.slug = 'wilsonmarine';

update public.keepr_pros kp
set
  claimed_state = 'claimed',
  profile_status = case when coalesce(kp.profile_status, 'draft') = 'draft' then 'claimed' else kp.profile_status end,
  publish_status = 'published',
  claimed_at = coalesce(kp.claimed_at, now()),
  claimed_by_org_id = coalesce(kp.claimed_by_org_id, kp.organization_id),
  claimed_by_user_id = coalesce(kp.claimed_by_user_id, o.owner_user_id),
  source_metadata = coalesce(kp.source_metadata, '{}'::jsonb) || jsonb_build_object(
    'claimed_existing_keepr_pro_id', kp.id::text,
    'claim_preserved_slug', kp.slug,
    'claim_preserved_relationships', true,
    'claim_path', 'existing_wilson_demo_org_link'
  )
from public.orgs o
where kp.slug = 'wilsonmarine'
  and kp.organization_id = o.id
  and o.slug = 'wilsonmarine';

create or replace function public.claim_keeprpro_profile(
  p_keepr_pro_id uuid,
  p_organization_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile public.keepr_pros;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.keeprpro_user_can_act_for_org(auth.uid(), p_organization_id) then
    raise exception 'Not authorized for organization';
  end if;

  select *
  into v_profile
  from public.keepr_pros
  where id = p_keepr_pro_id
  for update;

  if v_profile.id is null then
    raise exception 'KeeprPro profile not found';
  end if;

  update public.keepr_pros
  set
    organization_id = p_organization_id,
    claimed_state = 'claimed',
    profile_status = case
      when coalesce(profile_status, 'draft') = 'draft' then 'claimed'
      else profile_status
    end,
    publish_status = case
      when coalesce(publish_status, 'draft') = 'draft' then 'published'
      else publish_status
    end,
    claimed_at = coalesce(claimed_at, now()),
    claimed_by_org_id = coalesce(claimed_by_org_id, p_organization_id),
    claimed_by_user_id = coalesce(claimed_by_user_id, auth.uid()),
    source_metadata = coalesce(source_metadata, '{}'::jsonb) || jsonb_build_object(
      'claimed_existing_keepr_pro_id', p_keepr_pro_id::text,
      'claim_preserved_slug', slug,
      'claim_preserved_relationships', true
    ),
    updated_at = now()
  where id = p_keepr_pro_id;

  return (
    select to_jsonb(kp)
    from public.keepr_pros kp
    where kp.id = p_keepr_pro_id
  );
end;
$$;

grant execute on function public.claim_keeprpro_profile(uuid, uuid) to authenticated;

create or replace function public.update_keeprpro_claimed_profile(
  p_keepr_pro_id uuid,
  p_organization_id uuid,
  p_patch jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if not public.keeprpro_user_can_act_for_org(auth.uid(), p_organization_id) then
    raise exception 'Not authorized for organization';
  end if;

  update public.keepr_pros
  set
    display_name = coalesce(nullif(p_patch ->> 'display_name', ''), display_name),
    name = coalesce(nullif(p_patch ->> 'display_name', ''), name),
    slug = coalesce(nullif(regexp_replace(lower(trim(p_patch ->> 'slug')), '[^a-z0-9_-]+', '-', 'g'), ''), slug),
    logo_url = coalesce(nullif(p_patch ->> 'logo_url', ''), logo_url),
    header_image_url = coalesce(nullif(p_patch ->> 'header_image_url', ''), header_image_url),
    short_description = coalesce(nullif(p_patch ->> 'short_description', ''), short_description),
    public_description = coalesce(nullif(p_patch ->> 'public_description', ''), public_description),
    phone = coalesce(nullif(p_patch ->> 'phone', ''), phone),
    email = coalesce(nullif(p_patch ->> 'email', ''), email),
    website = coalesce(nullif(p_patch ->> 'website', ''), website),
    location = coalesce(nullif(p_patch ->> 'location', ''), location),
    publish_status = coalesce(nullif(p_patch ->> 'publish_status', ''), publish_status),
    categories = coalesce(p_patch -> 'categories', categories),
    locations = coalesce(p_patch -> 'locations', locations),
    service_offerings = coalesce(p_patch -> 'service_offerings', service_offerings),
    packages = coalesce(p_patch -> 'packages', packages),
    updated_at = now()
  where id = p_keepr_pro_id
    and organization_id = p_organization_id;

  return (
    select to_jsonb(kp)
    from public.keepr_pros kp
    where kp.id = p_keepr_pro_id
  );
end;
$$;

grant execute on function public.update_keeprpro_claimed_profile(uuid, uuid, jsonb) to authenticated;

create or replace function public.get_public_keeprpro_profile(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', kp.id,
    'slug', kp.slug,
    'display_name', coalesce(nullif(kp.display_name, ''), kp.name),
    'short_description', kp.short_description,
    'public_description', coalesce(kp.public_description, kp.notes, kp.short_description),
    'phone', kp.phone,
    'email', kp.email,
    'website', kp.website,
    'location', kp.location,
    'logo_url', kp.logo_url,
    'header_image_url', kp.header_image_url,
    'claimed_state', kp.claimed_state,
    'profile_status', kp.profile_status,
    'publish_status', kp.publish_status,
    'verified', kp.verified_at is not null,
    'categories', kp.categories,
    'locations', kp.locations,
    'service_offerings', kp.service_offerings,
    'packages', kp.packages,
    'organization',
      jsonb_build_object(
        'id', o.id,
        'name', coalesce(nullif(o.display_name, ''), o.name),
        'slug', o.slug
      )
  )
  from public.keepr_pros kp
  left join public.orgs o
    on o.id = kp.organization_id
  where lower(kp.slug) = lower(trim(coalesce(p_slug, '')))
    and coalesce(kp.publish_status, 'draft') in ('published', 'demo')
    and coalesce(kp.profile_status, 'draft') in ('active', 'demo', 'claimed')
  limit 1;
$$;

grant execute on function public.get_public_keeprpro_profile(text) to anon, authenticated;

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
    kp.slug as keepr_pro_slug,
    coalesce(nullif(kp.display_name, ''), nullif(kp.name, ''), nullif(o.display_name, ''), o.name) as display_name,
    kp.logo_url,
    kp.header_image_url,
    kp.short_description,
    kp.public_description,
    kp.phone,
    kp.email,
    kp.website,
    kp.location,
    kp.category,
    kp.categories,
    kp.locations,
    kp.service_offerings,
    kp.packages,
    kp.profile_status,
    kp.claimed_state,
    kp.publish_status,
    kp.verified_at,
    kp.claimed_at,
    kp.claimed_by_org_id,
    kp.claimed_by_user_id,
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
      'keepr_pro_slug', v_context.keepr_pro_slug,
      'display_name', v_context.display_name,
      'logo_url', v_context.logo_url,
      'header_image_url', v_context.header_image_url,
      'short_description', v_context.short_description,
      'public_description', v_context.public_description,
      'phone', v_context.phone,
      'email', v_context.email,
      'website', v_context.website,
      'location', v_context.location,
      'category', v_context.category,
      'categories', v_context.categories,
      'locations', v_context.locations,
      'service_offerings', v_context.service_offerings,
      'packages', v_context.packages,
      'profile_status', v_context.profile_status,
      'claimed_state', v_context.claimed_state,
      'publish_status', v_context.publish_status,
      'verified', v_context.verified_at is not null,
      'claimed_at', v_context.claimed_at,
      'claimed_by_org_id', v_context.claimed_by_org_id,
      'claimed_by_user_id', v_context.claimed_by_user_id,
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

grant execute on function public.get_keeprpro_portfolio_workspace(uuid, text, integer, integer) to authenticated;
