create or replace function public.get_keeprspace_portfolio(
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
  v_service_workspace jsonb := '{}'::jsonb;
  v_boats jsonb;
  v_total integer := 0;
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  select
    o.id as organization_id,
    o.slug as organization_slug,
    coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.display_name, kp.name, 'Organization') as display_name,
    coalesce(o.workspace_type, o.organization_type, o.org_type, 'keeprpro') as workspace_type,
    coalesce(o.workspace_capabilities, '[]'::jsonb) as workspace_capabilities,
    o.photo_url,
    o.team_photo_url,
    kp.id as keepr_pro_id,
    kp.slug as keepr_pro_slug,
    kp.logo_url,
    kp.header_image_url,
    kp.short_description,
    kp.public_description,
    kp.phone,
    kp.email,
    kp.website,
    kp.location,
    kp.categories,
    kp.locations,
    kp.service_offerings,
    kp.packages,
    kp.claimed_state,
    kp.profile_status,
    kp.publish_status,
    coalesce(m.role, m.member_role, 'member') as member_role
  into v_context
  from public.orgs o
  join public.org_members m
    on m.org_id = o.id
   and m.user_id = auth.uid()
   and coalesce(m.status, 'active') = 'active'
  left join public.keepr_pros kp
    on kp.organization_id = o.id
  where auth.uid() is not null
    and coalesce(o.status, 'active') = 'active'
    and (p_organization_id is null or o.id = p_organization_id)
  order by
    case when p_organization_id is not null and o.id = p_organization_id then 0 else 1 end,
    case when coalesce(o.slug, kp.slug) = 'wilsonmarine' then 0 else 1 end,
    o.name
  limit 1;

  if v_context.organization_id is null then
    return jsonb_build_object(
      'context', null,
      'boats', '[]'::jsonb,
      'counts', jsonb_build_object('visible_boats', 0, 'filtered_boats', 0)
    );
  end if;

  if v_context.keepr_pro_id is not null then
    v_service_workspace := coalesce(
      public.get_keeprpro_portfolio_workspace(
        v_context.organization_id,
        p_search,
        p_limit,
        p_offset
      ),
      '{}'::jsonb
    );
  end if;

  with relationship_rows as (
    select
      a.id as asset_id,
      a.name as asset_name,
      a.kac_id,
      a.year,
      a.make,
      a.model,
      a.type as asset_type,
      a.owner_id,
      aps.id as stewardship_id,
      null::uuid as asset_relationship_id,
      aps.keepr_pro_id,
      aps.organization_id,
      aps.relationship_type,
      aps.access_scope,
      aps.status,
      'asset_provider_stewardships'::text as source_table,
      0 as source_priority
    from public.asset_provider_stewardships aps
    join public.assets a
      on a.id = aps.asset_id
     and a.deleted_at is null
    where aps.organization_id = v_context.organization_id
      and aps.status = 'active'

    union all

    select
      a.id as asset_id,
      a.name as asset_name,
      a.kac_id,
      a.year,
      a.make,
      a.model,
      a.type as asset_type,
      a.owner_id,
      null::uuid as stewardship_id,
      ar.id as asset_relationship_id,
      ar.keepr_pro_id,
      ar.organization_id,
      ar.relationship_type,
      ar.access_scope,
      ar.status,
      'asset_relationships'::text as source_table,
      1 as source_priority
    from public.asset_relationships ar
    join public.assets a
      on a.id = ar.asset_id
     and a.deleted_at is null
    where ar.organization_id = v_context.organization_id
      and ar.status = 'active'
  ),
  filtered_rows as (
    select distinct on (rr.asset_id)
      rr.*
    from relationship_rows rr
    where v_search is null
       or rr.asset_name ilike '%' || v_search || '%'
       or rr.kac_id ilike '%' || v_search || '%'
       or rr.make ilike '%' || v_search || '%'
       or rr.model ilike '%' || v_search || '%'
    order by rr.asset_id, rr.source_priority, rr.relationship_type
  ),
  counted as (
    select count(*)::integer as total
    from filtered_rows
  ),
  paged as (
    select *
    from filtered_rows
    order by asset_name nulls last, kac_id nulls last
    limit greatest(coalesce(p_limit, 50), 1)
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'asset_id', p.asset_id,
        'asset_name', p.asset_name,
        'kac_id', p.kac_id,
        'asset_type', p.asset_type,
        'organization_id', p.organization_id,
        'keepr_pro_id', p.keepr_pro_id,
        'stewardship_id', p.stewardship_id,
        'asset_relationship_id', p.asset_relationship_id,
        'relationship_type', p.relationship_type,
        'relationship_source', p.source_table,
        'access_scope', p.access_scope,
        'owner_state', case
          when p.relationship_type in ('servicing_dealer', 'service_provider') then 'In Service'
          when p.relationship_type in ('delivery_dealer', 'selling_dealer') then 'Connected'
          else initcap(replace(coalesce(p.relationship_type, 'connected'), '_', ' '))
        end,
        'identity', jsonb_build_object(
          'year', p.year,
          'make', p.make,
          'model', p.model
        ),
        'activation', jsonb_build_object(
          'status', case when p.status = 'active' then 'active' else p.status end
        ),
        'verification', jsonb_build_object(
          'percent', case when p.source_table = 'asset_provider_stewardships' then 100 else 70 end
        ),
        'service_relationship', jsonb_build_object(
          'relationship_type', p.relationship_type,
          'source_table', p.source_table,
          'stewardship_id', p.stewardship_id,
          'asset_relationship_id', p.asset_relationship_id
        )
      )
    ), '[]'::jsonb),
    max(c.total)
  into v_boats, v_total
  from paged p
  cross join counted c;

  return jsonb_build_object(
    'context', to_jsonb(v_context),
    'boats', coalesce(v_boats, '[]'::jsonb),
    'open_actions', coalesce(v_service_workspace -> 'open_actions', '[]'::jsonb),
    'recent_messages', coalesce(v_service_workspace -> 'recent_messages', '[]'::jsonb),
    'upcoming_work', coalesce(v_service_workspace -> 'upcoming_work', '[]'::jsonb),
    'recent_service_activity', coalesce(v_service_workspace -> 'recent_service_activity', '[]'::jsonb),
    'counts', jsonb_build_object(
      'visible_boats', coalesce(v_total, 0),
      'filtered_boats', coalesce(v_total, 0)
    )
  );
end;
$$;

grant execute on function public.get_keeprspace_portfolio(uuid, text, integer, integer) to authenticated;

create or replace function public.resolve_keeprspace_kac(
  p_query text,
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := nullif(trim(coalesce(p_query, '')), '');
  v_org_id uuid;
  v_matches jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if v_query is null then
    return jsonb_build_object('matches', '[]'::jsonb);
  end if;

  select o.id
  into v_org_id
  from public.orgs o
  join public.org_members m
    on m.org_id = o.id
   and m.user_id = auth.uid()
   and coalesce(m.status, 'active') = 'active'
  where p_organization_id is null or o.id = p_organization_id
  order by case when p_organization_id is not null and o.id = p_organization_id then 0 else 1 end
  limit 1;

  if v_org_id is null then
    raise exception 'Not authorized for organization';
  end if;

  with hin_matches as (
    select f.asset_id
    from public.asset_facts f
    where f.active = true
      and lower(f.fact_key) = 'hin'
      and trim(both '"' from f.fact_value::text) ilike '%' || v_query || '%'
  ),
  asset_matches as (
    select distinct a.*
    from public.assets a
    left join hin_matches hm on hm.asset_id = a.id
    where a.deleted_at is null
      and (
        a.kac_id ilike '%' || v_query || '%'
        or a.name ilike '%' || v_query || '%'
        or a.make ilike '%' || v_query || '%'
        or a.model ilike '%' || v_query || '%'
        or a.serial_number ilike '%' || v_query || '%'
        or hm.asset_id is not null
      )
    order by a.created_at desc
    limit 12
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'asset_id', a.id,
      'asset_name', a.name,
      'kac_id', a.kac_id,
      'year', a.year,
      'make', a.make,
      'model', a.model,
      'asset_type', a.type,
      'owner_id', a.owner_id,
      'already_connected', exists (
        select 1 from public.asset_provider_stewardships aps
        where aps.asset_id = a.id
          and aps.organization_id = v_org_id
          and aps.status = 'active'
      ) or exists (
        select 1 from public.asset_relationships ar
        where ar.asset_id = a.id
          and ar.organization_id = v_org_id
          and ar.status = 'active'
      ),
      'public_context', jsonb_build_object(
        'title', coalesce(a.name, a.kac_id, 'Asset'),
        'identity', concat_ws(' ', a.year::text, a.make, a.model)
      )
    )
  ), '[]'::jsonb)
  into v_matches
  from asset_matches a;

  return jsonb_build_object(
    'organization_id', v_org_id,
    'query', v_query,
    'matches', coalesce(v_matches, '[]'::jsonb)
  );
end;
$$;

grant execute on function public.resolve_keeprspace_kac(text, uuid) to authenticated;

create or replace function public.connect_keeprspace_service_asset(
  p_asset_id uuid,
  p_organization_id uuid,
  p_relationship_type text default 'service_provider'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets;
  v_org public.orgs;
  v_keepr_pro public.keepr_pros;
  v_stewardship public.asset_provider_stewardships;
  v_relationship public.asset_relationships;
  v_relationship_type text := coalesce(nullif(p_relationship_type, ''), 'service_provider');
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if v_relationship_type not in ('servicing_dealer', 'service_provider') then
    raise exception 'Unsupported service relationship type: %', v_relationship_type;
  end if;

  if not public.keeprpro_user_can_act_for_org(auth.uid(), p_organization_id) then
    raise exception 'Not authorized for organization';
  end if;

  select * into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null;

  if v_asset.id is null then
    raise exception 'Asset not found';
  end if;

  select * into v_org
  from public.orgs
  where id = p_organization_id
    and coalesce(status, 'active') = 'active';

  if v_org.id is null then
    raise exception 'Organization not found';
  end if;

  select * into v_keepr_pro
  from public.keepr_pros
  where organization_id = p_organization_id
  order by case when slug = v_org.slug then 0 else 1 end, created_at
  limit 1;

  if v_keepr_pro.id is null then
    raise exception 'This organization does not have a KeeprPro service identity yet.';
  end if;

  insert into public.asset_provider_stewardships (
    asset_id,
    keepr_pro_id,
    organization_id,
    owner_id,
    relationship_type,
    access_scope,
    status,
    created_by,
    created_at,
    updated_at
  )
  values (
    v_asset.id,
    v_keepr_pro.id,
    p_organization_id,
    v_asset.owner_id,
    v_relationship_type,
    'service_stewardship',
    'active',
    auth.uid(),
    now(),
    now()
  )
  on conflict do nothing;

  select *
  into v_stewardship
  from public.asset_provider_stewardships
  where asset_id = v_asset.id
    and keepr_pro_id = v_keepr_pro.id
    and organization_id = p_organization_id
    and relationship_type = v_relationship_type
    and status = 'active'
  limit 1;

  insert into public.asset_relationships (
    asset_id,
    organization_id,
    keepr_pro_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    initiated_by_user_id,
    initiated_by_org_id,
    metadata
  )
  values (
    v_asset.id,
    p_organization_id,
    v_keepr_pro.id,
    v_relationship_type,
    'active',
    'service_workspace',
    'claimed_org',
    auth.uid(),
    p_organization_id,
    jsonb_build_object(
      'source', 'keeprspace_add_kac',
      'compatibility_stewardship_id', v_stewardship.id
    )
  )
  on conflict do nothing;

  select *
  into v_relationship
  from public.asset_relationships
  where asset_id = v_asset.id
    and organization_id = p_organization_id
    and relationship_type = v_relationship_type
    and status = 'active'
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'asset_id', v_asset.id,
    'kac_id', v_asset.kac_id,
    'organization_id', p_organization_id,
    'keepr_pro_id', v_keepr_pro.id,
    'stewardship_id', v_stewardship.id,
    'asset_relationship_id', v_relationship.id
  );
end;
$$;

grant execute on function public.connect_keeprspace_service_asset(uuid, uuid, text) to authenticated;
