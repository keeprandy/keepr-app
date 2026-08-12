-- Activator Phase 2A: read-only browser and vessel workspace resolvers.
-- These functions deliberately keep organization network relationships
-- separate from asset-specific relationships.

create or replace function public.get_activator_boat_browser(
  p_filters jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_search text := nullif(trim(coalesce(p_filters ->> 'search', '')), '');
  v_oem_org_id uuid := nullif(p_filters ->> 'oem_org_id', '')::uuid;
  v_dealer_org_id uuid := nullif(p_filters ->> 'dealer_org_id', '')::uuid;
  v_org_location_id uuid := nullif(p_filters ->> 'org_location_id', '')::uuid;
  v_template_id uuid := nullif(p_filters ->> 'template_id', '')::uuid;
  v_activation_status text := nullif(trim(coalesce(p_filters ->> 'activation_status', '')), '');
  v_limit integer := greatest(1, least(coalesce(nullif(p_filters ->> 'limit', '')::integer, 50), 100));
  v_result jsonb;
begin
  with visible_assets as (
    select a.*
    from public.assets a
    where coalesce(a.deleted_at is null, true)
      and coalesce(a.type, '') in ('boat', 'marine')
      and public.activator_user_can_read_asset(auth.uid(), a.id)
  ),
  filtered_assets as (
    select a.*
    from visible_assets a
    where (
        v_search is null
        or a.name ilike '%' || v_search || '%'
        or a.kac_id ilike '%' || v_search || '%'
        or exists (
          select 1
          from public.asset_facts f
          where f.asset_id = a.id
            and f.active = true
            and f.fact_value::text ilike '%' || v_search || '%'
        )
      )
      and (
        v_oem_org_id is null
        or exists (
          select 1
          from public.asset_relationship_edges e
          where e.asset_id = a.id
            and e.organization_id = v_oem_org_id
            and e.relationship_type = 'oem'
            and e.status = 'active'
        )
        or exists (
          select 1
          from public.asset_template_bindings b
          join public.asset_model_templates t on t.id = b.template_id
          where b.asset_id = a.id
            and b.binding_status in ('suggested', 'inherited', 'verified')
            and t.organization_id = v_oem_org_id
        )
      )
      and (
        v_dealer_org_id is null
        or exists (
          select 1
          from public.asset_relationship_edges e
          where e.asset_id = a.id
            and e.organization_id = v_dealer_org_id
            and e.relationship_type in ('selling_dealer', 'delivery_dealer', 'servicing_dealer', 'service_provider')
            and e.status = 'active'
        )
      )
      and (
        v_org_location_id is null
        or exists (
          select 1
          from public.asset_relationship_edges e
          where e.asset_id = a.id
            and e.org_location_id = v_org_location_id
            and e.status = 'active'
        )
      )
      and (
        v_template_id is null
        or exists (
          select 1
          from public.asset_template_bindings b
          where b.asset_id = a.id
            and b.template_id = v_template_id
            and b.binding_status in ('suggested', 'inherited', 'verified')
        )
      )
      and (
        v_activation_status is null
        or exists (
          select 1
          from public.asset_activation_workflows w
          where w.asset_id = a.id
            and w.status = v_activation_status
        )
      )
  ),
  cards as (
    select
      a.id as asset_id,
      coalesce(nullif(a.name, ''), 'Untitled boat') as asset_name,
      a.kac_id,
      a.type as asset_type,
      a.owner_id,
      to_jsonb(a) ->> 'hero_image_url' as hero_image_url,
      to_jsonb(a) ->> 'year' as asset_year,
      to_jsonb(a) ->> 'make' as asset_make,
      to_jsonb(a) ->> 'model' as asset_model,
      hin.fact_value #>> '{}' as hin,
      binding.id as template_binding_id,
      binding.binding_status,
      template.id as template_id,
      template.organization_id as template_org_id,
      template.manufacturer,
      template.model as template_model,
      template.model_year,
      template.version as template_version,
      workflow.id as activation_workflow_id,
      workflow.status as activation_status,
      workflow.vessel_state,
      fact_counts.fact_count,
      fact_counts.verified_fact_count,
      oem_edge.edge as oem_relationship,
      dealer_edge.edge as dealer_relationship
    from filtered_assets a
    left join lateral (
      select f.fact_value
      from public.asset_facts f
      where f.asset_id = a.id
        and f.fact_key = 'hin'
        and f.active = true
        and f.authority_state not in ('superseded', 'disputed')
      order by public.activator_authority_rank(f.authority_state) desc, f.confidence desc, f.asserted_at desc
      limit 1
    ) hin on true
    left join lateral (
      select b.*
      from public.asset_template_bindings b
      where b.asset_id = a.id
        and b.binding_status in ('suggested', 'inherited', 'verified')
      order by
        case b.binding_status when 'verified' then 0 when 'inherited' then 1 else 2 end,
        b.created_at desc
      limit 1
    ) binding on true
    left join public.asset_model_templates template on template.id = binding.template_id
    left join lateral (
      select w.*
      from public.asset_activation_workflows w
      where w.asset_id = a.id
      order by w.created_at desc
      limit 1
    ) workflow on true
    left join lateral (
      select
        count(*)::integer as fact_count,
        count(*) filter (
          where f.authority_state in ('dealer_confirmed', 'oem_as_built', 'evidence_verified', 'service_verified')
        )::integer as verified_fact_count
      from public.asset_facts f
      where f.asset_id = a.id
        and f.active = true
        and f.authority_state not in ('superseded')
    ) fact_counts on true
    left join lateral (
      select jsonb_build_object(
        'id', e.id,
        'source_table', e.source_table,
        'relationship_type', e.relationship_type,
        'organization_id', e.organization_id,
        'organization_name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), nullif(kp.display_name, ''), kp.name),
        'org_location_id', e.org_location_id,
        'location_name', l.name,
        'status', e.status,
        'access_scope', e.access_scope,
        'claim_state', e.claim_state
      ) as edge
      from public.asset_relationship_edges e
      left join public.orgs o on o.id = e.organization_id
      left join public.keepr_pros kp on kp.id = e.keepr_pro_id
      left join public.org_locations l on l.id = e.org_location_id
      where e.asset_id = a.id
        and e.relationship_type = 'oem'
        and e.status = 'active'
      order by e.created_at desc
      limit 1
    ) oem_edge on true
    left join lateral (
      select jsonb_build_object(
        'id', e.id,
        'source_table', e.source_table,
        'relationship_type', e.relationship_type,
        'organization_id', e.organization_id,
        'organization_name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), nullif(kp.display_name, ''), kp.name),
        'org_location_id', e.org_location_id,
        'location_name', l.name,
        'status', e.status,
        'access_scope', e.access_scope,
        'claim_state', e.claim_state
      ) as edge
      from public.asset_relationship_edges e
      left join public.orgs o on o.id = e.organization_id
      left join public.keepr_pros kp on kp.id = e.keepr_pro_id
      left join public.org_locations l on l.id = e.org_location_id
      where e.asset_id = a.id
        and e.relationship_type in ('delivery_dealer', 'servicing_dealer', 'selling_dealer', 'service_provider')
        and e.status = 'active'
      order by
        case e.relationship_type
          when 'delivery_dealer' then 0
          when 'servicing_dealer' then 1
          when 'selling_dealer' then 2
          else 3
        end,
        e.created_at desc
      limit 1
    ) dealer_edge on true
    order by coalesce(a.name, ''), a.created_at desc
    limit v_limit
  )
  select jsonb_build_object(
    'filters', coalesce(p_filters, '{}'::jsonb),
    'counts', jsonb_build_object(
      'visible_boats', (select count(*) from visible_assets),
      'filtered_boats', (select count(*) from filtered_assets)
    ),
    'boats', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'asset_id', c.asset_id,
          'asset_name', c.asset_name,
          'asset_type', c.asset_type,
          'kac_id', c.kac_id,
          'hin', c.hin,
          'hero_image_url', c.hero_image_url,
          'owner_state', case when c.owner_id is null then 'pending_owner' else 'owner_attached' end,
          'identity', jsonb_build_object(
            'year', coalesce(c.asset_year, c.model_year::text),
            'make', coalesce(c.asset_make, c.manufacturer),
            'model', coalesce(c.asset_model, c.template_model)
          ),
          'template', jsonb_build_object(
            'binding_id', c.template_binding_id,
            'binding_status', c.binding_status,
            'template_id', c.template_id,
            'organization_id', c.template_org_id,
            'manufacturer', c.manufacturer,
            'model', c.template_model,
            'model_year', c.model_year,
            'version', c.template_version
          ),
          'activation', jsonb_build_object(
            'workflow_id', c.activation_workflow_id,
            'status', c.activation_status,
            'vessel_state', c.vessel_state
          ),
          'verification', jsonb_build_object(
            'fact_count', coalesce(c.fact_count, 0),
            'verified_fact_count', coalesce(c.verified_fact_count, 0),
            'percent', case
              when coalesce(c.fact_count, 0) = 0 then 0
              else round((coalesce(c.verified_fact_count, 0)::numeric / c.fact_count::numeric) * 100)
            end
          ),
          'oem_relationship', c.oem_relationship,
          'dealer_relationship', c.dealer_relationship
        )
        order by c.asset_name
      )
      from cards c
    ), '[]'::jsonb),
    'oem_lens', case
      when v_oem_org_id is null then null
      else (
        select jsonb_build_object(
          'organization_id', o.id,
          'organization_name', coalesce(nullif(o.display_name, ''), o.name),
          'dealer_network', coalesce((
            select jsonb_agg(jsonb_build_object(
              'relationship_id', r.id,
              'relationship_type', r.relationship_type,
              'status', r.status,
              'evidence_state', r.evidence_state,
              'dealer_org_id', dealer.id,
              'dealer_name', coalesce(nullif(dealer.display_name, ''), dealer.name),
              'csi_recognition', r.metadata ->> 'csi_recognition',
              'source_resource_id', r.source_resource_id,
              'source_context', r.metadata ->> 'source_context',
              'temporal_scope_note', r.metadata ->> 'temporal_scope_note'
            ) order by coalesce(nullif(dealer.display_name, ''), dealer.name))
            from public.org_relationships r
            join public.orgs dealer on dealer.id = r.to_org_id
            where r.from_org_id = v_oem_org_id
              and r.relationship_type = 'authorized_dealer'
              and r.status in ('active', 'source_reported')
          ), '[]'::jsonb)
        )
        from public.orgs o
        where o.id = v_oem_org_id
      )
    end,
    'dealer_lens', case
      when v_dealer_org_id is null then null
      else (
        select jsonb_build_object(
          'organization_id', o.id,
          'organization_name', coalesce(nullif(o.display_name, ''), o.name),
          'represented_oems', coalesce((
            select jsonb_agg(jsonb_build_object(
              'relationship_id', r.id,
              'relationship_type', r.relationship_type,
              'status', r.status,
              'evidence_state', r.evidence_state,
              'oem_org_id', oem.id,
              'oem_name', coalesce(nullif(oem.display_name, ''), oem.name),
              'csi_recognition', r.metadata ->> 'csi_recognition',
              'source_resource_id', r.source_resource_id,
              'source_context', r.metadata ->> 'source_context',
              'temporal_scope_note', r.metadata ->> 'temporal_scope_note'
            ) order by coalesce(nullif(oem.display_name, ''), oem.name))
            from public.org_relationships r
            join public.orgs oem on oem.id = r.from_org_id
            where r.to_org_id = v_dealer_org_id
              and r.relationship_type = 'authorized_dealer'
              and r.status in ('active', 'source_reported')
          ), '[]'::jsonb),
          'locations', coalesce((
            select jsonb_agg(to_jsonb(l) order by l.region, l.city, l.name)
            from public.org_locations l
            where l.organization_id = v_dealer_org_id
              and l.status = 'active'
          ), '[]'::jsonb)
        )
        from public.orgs o
        where o.id = v_dealer_org_id
      )
    end
  )
  into v_result;

  return coalesce(v_result, '{}'::jsonb);
end;
$$;

create or replace function public.resolve_activator_boat_workspace(
  p_asset_id uuid,
  p_projection text default 'owner',
  p_organization_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_base jsonb;
  v_relationships jsonb := '[]'::jsonb;
  v_org_network jsonb := '[]'::jsonb;
  v_resources jsonb := '[]'::jsonb;
begin
  v_base := public.resolve_asset_activation_projection(p_asset_id, p_projection, p_organization_id);

  if v_base is null then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id,
    'source_table', e.source_table,
    'relationship_type', e.relationship_type,
    'status', e.status,
    'access_scope', e.access_scope,
    'claim_state', e.claim_state,
    'organization_id', e.organization_id,
    'organization_name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), nullif(kp.display_name, ''), kp.name),
    'org_location_id', e.org_location_id,
    'location_name', l.name,
    'location_type', l.location_type,
    'location_city', l.city,
    'location_region', l.region,
    'keepr_pro_id', e.keepr_pro_id,
    'user_id', e.user_id,
    'effective_from', e.effective_from,
    'effective_to', e.effective_to,
    'metadata', e.metadata
  ) order by
    case e.relationship_type
      when 'owner' then 0
      when 'oem' then 1
      when 'delivery_dealer' then 2
      when 'servicing_dealer' then 3
      else 4
    end,
    e.created_at desc
  ), '[]'::jsonb)
  into v_relationships
  from public.asset_relationship_edges e
  left join public.orgs o on o.id = e.organization_id
  left join public.keepr_pros kp on kp.id = e.keepr_pro_id
  left join public.org_locations l on l.id = e.org_location_id
  where e.asset_id = p_asset_id;

  with oems as (
    select distinct e.organization_id
    from public.asset_relationship_edges e
    where e.asset_id = p_asset_id
      and e.relationship_type = 'oem'
      and e.status = 'active'
      and e.organization_id is not null
  ),
  dealers as (
    select distinct e.organization_id
    from public.asset_relationship_edges e
    where e.asset_id = p_asset_id
      and e.relationship_type in ('selling_dealer', 'delivery_dealer', 'servicing_dealer', 'service_provider')
      and e.status = 'active'
      and e.organization_id is not null
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'relationship_id', r.id,
    'from_org_id', r.from_org_id,
    'from_org_name', coalesce(nullif(from_org.display_name, ''), from_org.name),
    'to_org_id', r.to_org_id,
    'to_org_name', coalesce(nullif(to_org.display_name, ''), to_org.name),
    'relationship_type', r.relationship_type,
    'status', r.status,
    'evidence_state', r.evidence_state,
    'source_resource_id', r.source_resource_id,
    'csi_recognition', r.metadata ->> 'csi_recognition',
    'source_context', r.metadata ->> 'source_context',
    'temporal_scope_note', r.metadata ->> 'temporal_scope_note'
  ) order by coalesce(nullif(from_org.display_name, ''), from_org.name), coalesce(nullif(to_org.display_name, ''), to_org.name)), '[]'::jsonb)
  into v_org_network
  from public.org_relationships r
  join public.orgs from_org on from_org.id = r.from_org_id
  join public.orgs to_org on to_org.id = r.to_org_id
  where exists (select 1 from oems o where o.organization_id = r.from_org_id)
    and exists (select 1 from dealers d where d.organization_id = r.to_org_id);

  select coalesce(jsonb_agg(to_jsonb(res) order by res.captured_at desc), '[]'::jsonb)
  into v_resources
  from public.asset_resources res
  where (
      res.metadata ->> 'asset_id' = p_asset_id::text
      or (
        res.applies_to_type = 'template'
        and res.applies_to_id = nullif(v_base #>> '{template,id}', '')::uuid
      )
      or exists (
        select 1
        from public.org_relationships r
        where r.source_resource_id = res.id
          and exists (
            select 1 from public.asset_relationship_edges e
            where e.asset_id = p_asset_id
              and e.organization_id in (r.from_org_id, r.to_org_id)
          )
      )
    );

  return v_base
    || jsonb_build_object(
      'relationship_details', v_relationships,
      'org_network_evidence', v_org_network,
      'resources', v_resources
    );
end;
$$;

grant execute on function public.get_activator_boat_browser(jsonb) to authenticated;
grant execute on function public.resolve_activator_boat_workspace(uuid, text, uuid) to authenticated;

comment on function public.get_activator_boat_browser(jsonb) is
  'Read-only Activator Phase 2A boat browser. org_relationships describe org networks; asset_relationship_edges describe relationships attached to specific assets.';

comment on function public.resolve_activator_boat_workspace(uuid, text, uuid) is
  'Read-only Activator Phase 2A vessel workspace resolver with enriched asset relationships and separate org-network provenance evidence.';
