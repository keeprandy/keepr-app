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
  v_search_key text := nullif(regexp_replace(lower(trim(coalesce(p_search, ''))), '[^a-z0-9]+', '', 'g'), '');
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
      coalesce(nullif(owner_p.display_name, ''), nullif(owner_p.full_name, ''), owner_p.email) as owner_display_name,
      owner_p.email as owner_email,
      aps.id as stewardship_id,
      null::uuid as asset_relationship_id,
      aps.keepr_pro_id,
      aps.organization_id,
      aps.relationship_type,
      aps.access_scope,
      aps.status,
      nullif(aps.projection_config #>> '{customer,display_name}', '') as customer_display_name,
      nullif(aps.projection_config #>> '{customer,email}', '') as customer_email,
      nullif(aps.projection_config #>> '{customer,phone}', '') as customer_phone,
      nullif(aps.projection_config #>> '{customer,external_customer_id}', '') as customer_external_id,
      nullif(aps.projection_config #>> '{customer,external_system}', '') as customer_external_system,
      'asset_provider_stewardships'::text as source_table,
      0 as source_priority
    from public.asset_provider_stewardships aps
    join public.assets a
      on a.id = aps.asset_id
     and a.deleted_at is null
    left join public.profiles owner_p
      on owner_p.id = a.owner_id
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
      coalesce(nullif(owner_p.display_name, ''), nullif(owner_p.full_name, ''), owner_p.email) as owner_display_name,
      owner_p.email as owner_email,
      null::uuid as stewardship_id,
      ar.id as asset_relationship_id,
      ar.keepr_pro_id,
      ar.organization_id,
      ar.relationship_type,
      ar.access_scope,
      ar.status,
      nullif(ar.metadata #>> '{customer,display_name}', '') as customer_display_name,
      nullif(ar.metadata #>> '{customer,email}', '') as customer_email,
      nullif(ar.metadata #>> '{customer,phone}', '') as customer_phone,
      nullif(ar.metadata #>> '{customer,external_customer_id}', '') as customer_external_id,
      nullif(ar.metadata #>> '{customer,external_system}', '') as customer_external_system,
      'asset_relationships'::text as source_table,
      1 as source_priority
    from public.asset_relationships ar
    join public.assets a
      on a.id = ar.asset_id
     and a.deleted_at is null
    left join public.profiles owner_p
      on owner_p.id = a.owner_id
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
       or coalesce(rr.owner_display_name, '') ilike '%' || v_search || '%'
       or coalesce(rr.owner_email, '') ilike '%' || v_search || '%'
       or coalesce(rr.customer_display_name, '') ilike '%' || v_search || '%'
       or coalesce(rr.customer_email, '') ilike '%' || v_search || '%'
       or coalesce(rr.customer_phone, '') ilike '%' || v_search || '%'
       or coalesce(rr.customer_external_id, '') ilike '%' || v_search || '%'
       or coalesce(rr.customer_external_system, '') ilike '%' || v_search || '%'
       or (
         v_search_key is not null
         and regexp_replace(
           lower(concat_ws(
             ' ',
             rr.asset_name,
             rr.kac_id,
             rr.make,
             rr.model,
             rr.owner_display_name,
             rr.owner_email,
             rr.customer_display_name,
             rr.customer_email,
             rr.customer_phone,
             rr.customer_external_id,
             rr.customer_external_system
           )),
           '[^a-z0-9]+',
           '',
           'g'
         ) ilike '%' || v_search_key || '%'
       )
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
        'owner_display_name', p.owner_display_name,
        'customer', jsonb_strip_nulls(jsonb_build_object(
          'display_name', p.customer_display_name,
          'email', p.customer_email,
          'phone', p.customer_phone,
          'external_customer_id', p.customer_external_id,
          'external_system', p.customer_external_system
        )),
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
