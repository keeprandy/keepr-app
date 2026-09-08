-- Supplier V1: project suppliers through the canonical Ownership Graph.
--
-- No supplier-local table is introduced. Suppliers are Organizations connected
-- to OEMs by org_relationships and to reusable systems by system_templates.

alter table public.org_relationships
  drop constraint if exists org_relationships_type_check;

alter table public.org_relationships
  add constraint org_relationships_type_check
  check (relationship_type in (
    'authorized_dealer',
    'dealer_network_member',
    'oem_partner',
    'represented_brand',
    'brand_reference',
    'service_partner',
    'sales_partner',
    'marina_partner',
    'parent_company',
    'supplier',
    'system_supplier',
    'component_supplier'
  ));

create index if not exists system_templates_owner_supplier_idx
  on public.system_templates (owner_org_id, supplier_org_id)
  where supplier_org_id is not null;

create index if not exists asset_model_template_items_template_system_template_idx
  on public.asset_model_template_items (template_id, system_template_id)
  where system_template_id is not null;

do $$
declare
  v_mercury_id uuid;
  v_seakeeper_id uuid;
  v_cummins_id uuid;
  v_tiara_id uuid;
  v_bennington_id uuid;
begin
  insert into public.orgs (
    name, display_name, slug, organization_type, org_type, status,
    authority_state, source_type, source_name, source_url, source_metadata
  )
  values
    (
      'Mercury Marine', 'Mercury Marine', 'mercury-marine', 'supplier', 'supplier', 'active',
      'public_source_reported', 'keepr_curated', 'Supplier V1 fixture', 'https://www.mercurymarine.com/',
      jsonb_build_object('supplier_v1', true, 'capabilities', jsonb_build_array('propulsion'))
    ),
    (
      'Seakeeper', 'Seakeeper', 'seakeeper', 'supplier', 'supplier', 'active',
      'public_source_reported', 'keepr_curated', 'Supplier V1 fixture', 'https://seakeeper.com/',
      jsonb_build_object('supplier_v1', true, 'capabilities', jsonb_build_array('stabilization'))
    ),
    (
      'Cummins / Onan', 'Cummins / Onan', 'cummins-onan', 'supplier', 'supplier', 'active',
      'public_source_reported', 'keepr_curated', 'Supplier V1 fixture', 'https://www.cummins.com/generators/marine',
      jsonb_build_object('supplier_v1', true, 'capabilities', jsonb_build_array('marine generators', 'electrical'))
    )
  on conflict (lower(slug)) where slug is not null do update
  set display_name = excluded.display_name,
      organization_type = coalesce(public.orgs.organization_type, excluded.organization_type),
      org_type = coalesce(public.orgs.org_type, excluded.org_type),
      status = coalesce(public.orgs.status, excluded.status),
      source_url = coalesce(public.orgs.source_url, excluded.source_url),
      source_metadata = coalesce(public.orgs.source_metadata, '{}'::jsonb) || excluded.source_metadata,
      updated_at = now();

  select id into v_mercury_id from public.orgs where lower(slug) = 'mercury-marine' limit 1;
  select id into v_seakeeper_id from public.orgs where lower(slug) = 'seakeeper' limit 1;
  select id into v_cummins_id from public.orgs where lower(slug) = 'cummins-onan' limit 1;
  select id into v_tiara_id from public.orgs where lower(slug) = 'tiara-yachts' limit 1;
  select id into v_bennington_id from public.orgs where lower(slug) = 'bennington' limit 1;

  update public.system_templates
  set supplier_org_id = v_mercury_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('supplier_resolution', 'supplier_v1_manufacturer_match')
  where v_mercury_id is not null
    and supplier_org_id is null
    and lower(coalesce(manufacturer, '')) like '%mercury%';

  update public.system_templates
  set supplier_org_id = v_seakeeper_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('supplier_resolution', 'supplier_v1_manufacturer_match')
  where v_seakeeper_id is not null
    and supplier_org_id is null
    and lower(coalesce(manufacturer, '')) like '%seakeeper%';

  update public.system_templates
  set supplier_org_id = v_cummins_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('supplier_resolution', 'supplier_v1_manufacturer_match')
  where v_cummins_id is not null
    and supplier_org_id is null
    and (
      lower(coalesce(manufacturer, '')) like '%onan%'
      or lower(coalesce(manufacturer, '')) like '%cummins%'
    );

  if v_tiara_id is not null then
    insert into public.org_relationships (
      from_org_id, to_org_id, relationship_type, status, evidence_state,
      authority_state, source_name, source_url, metadata
    )
    select v_tiara_id, supplier_id, 'supplier', 'source_reported', 'keepr_seeded',
      'public_source_reported', 'Supplier V1 graph projection', supplier_url,
      jsonb_build_object('supplier_v1', true, 'relationship_basis', 'system_template_supplier')
    from (
      values
        (v_mercury_id, 'https://www.mercurymarine.com/'),
        (v_seakeeper_id, 'https://seakeeper.com/'),
        (v_cummins_id, 'https://www.cummins.com/generators/marine')
    ) as suppliers(supplier_id, supplier_url)
    where supplier_id is not null
    on conflict (from_org_id, to_org_id, relationship_type)
    where status in ('source_reported', 'active')
    do update
    set metadata = coalesce(public.org_relationships.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();
  end if;

  if v_bennington_id is not null and v_mercury_id is not null then
    insert into public.org_relationships (
      from_org_id, to_org_id, relationship_type, status, evidence_state,
      authority_state, source_name, source_url, metadata
    )
    values (
      v_bennington_id, v_mercury_id, 'supplier', 'source_reported', 'keepr_seeded',
      'public_source_reported', 'Supplier V1 graph projection', 'https://www.mercurymarine.com/',
      jsonb_build_object('supplier_v1', true, 'relationship_basis', 'system_template_supplier')
    )
    on conflict (from_org_id, to_org_id, relationship_type)
    where status in ('source_reported', 'active')
    do update
    set metadata = coalesce(public.org_relationships.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();
  end if;
end;
$$;

create or replace function public.list_organization_supplier_network(
  p_organization_id uuid,
  p_query text default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  if p_organization_id is null
     or not public.activator_user_can_act_for_org(auth.uid(), p_organization_id) then
    raise exception 'not allowed to browse this organization Supplier Network';
  end if;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'query', coalesce(p_query, ''),
    'suppliers', coalesce((
      with supplier_ids as (
        select
          r.to_org_id as supplier_org_id,
          r.id as relationship_id,
          r.relationship_type,
          r.status,
          r.authority_state,
          r.evidence_state,
          r.source_name,
          r.source_url
        from public.org_relationships r
        where r.from_org_id = p_organization_id
          and r.relationship_type in ('supplier', 'system_supplier', 'component_supplier')
          and r.status in ('source_reported', 'active')
        union
        select
          st.supplier_org_id,
          null::uuid,
          'system_supplier'::text,
          'source_reported'::text,
          st.authority_state,
          'keepr_seeded'::text,
          st.name,
          null::text
        from public.system_templates st
        where st.owner_org_id = p_organization_id
          and st.supplier_org_id is not null
          and st.authority_state <> 'retired'
      ),
      supplier_rows as (
        select
          s.supplier_org_id,
          (array_agg(s.relationship_id) filter (where s.relationship_id is not null))[1] as relationship_id,
          coalesce(max(s.relationship_type), 'supplier') as relationship_type,
          coalesce(max(s.status), 'source_reported') as status,
          coalesce(max(s.authority_state), 'source_reported') as authority_state,
          coalesce(max(s.evidence_state), 'source_reported') as evidence_state,
          max(s.source_name) as source_name,
          max(s.source_url) as relationship_source_url
        from supplier_ids s
        where s.supplier_org_id is not null
        group by s.supplier_org_id
      )
      select jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'organization_id', o.id,
          'name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.display_name, kp.name, 'Supplier'),
          'slug', o.slug,
          'logo_url', coalesce(o.photo_url, o.team_photo_url, kp.logo_url, kp.avatar_url),
          'website', coalesce(kp.website, o.source_url, sr.relationship_source_url),
          'phone', kp.phone,
          'email', kp.email,
          'classification', coalesce(o.organization_type, o.org_type, 'supplier'),
          'capabilities', coalesce(o.workspace_capabilities, o.source_metadata -> 'capabilities', '[]'::jsonb),
          'relationship_id', sr.relationship_id,
          'relationship_type', sr.relationship_type,
          'relationship_status', sr.status,
          'authority_state', sr.authority_state,
          'evidence_state', sr.evidence_state,
          'source_name', sr.source_name,
          'source_url', sr.relationship_source_url,
          'system_template_count', (
            select count(distinct st.id)
            from public.system_templates st
            where st.supplier_org_id = o.id
              and st.authority_state <> 'retired'
              and (
                st.owner_org_id = p_organization_id
                or exists (
                  select 1
                  from public.asset_model_template_items item
                  join public.asset_model_templates template on template.id = item.template_id
                  where item.system_template_id = st.id
                    and template.organization_id = p_organization_id
                    and template.status <> 'retired'
                )
              )
          ),
          'model_count', (
            select count(distinct template.id)
            from public.asset_model_templates template
            join public.asset_model_template_items item on item.template_id = template.id
            join public.system_templates st on st.id = item.system_template_id
            where template.organization_id = p_organization_id
              and template.status <> 'retired'
              and st.supplier_org_id = o.id
              and st.authority_state <> 'retired'
          ),
          'installed_system_count', (
            select count(distinct system.id)
            from public.systems system
            join public.assets asset on asset.id = system.asset_id
            join public.system_templates st on st.id = system.system_template_id
            where st.supplier_org_id = o.id
              and exists (
                select 1
                from public.asset_relationship_edges edge
                where edge.asset_id = asset.id
                  and edge.organization_id = p_organization_id
                  and edge.status in ('active', 'pending')
              )
          ),
          'kac_count', (
            select count(distinct asset.kac_id)
            from public.systems system
            join public.assets asset on asset.id = system.asset_id
            join public.system_templates st on st.id = system.system_template_id
            where st.supplier_org_id = o.id
              and asset.kac_id is not null
              and exists (
                select 1
                from public.asset_relationship_edges edge
                where edge.asset_id = asset.id
                  and edge.organization_id = p_organization_id
                  and edge.status in ('active', 'pending')
              )
          ),
          'resource_count', (
            select count(distinct ap.attachment_id)
            from public.system_templates st
            join public.attachment_placements ap
              on ap.target_type = 'system_template'
             and ap.target_id = st.id
            join public.attachments att on att.id = ap.attachment_id
            where st.supplier_org_id = o.id
              and att.deleted_at is null
              and st.authority_state <> 'retired'
          ),
          'system_templates', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'id', st.id,
                'canonical_key', st.canonical_key,
                'name', st.name,
                'manufacturer', st.manufacturer,
                'system_category', st.system_category,
                'authority_state', st.authority_state,
                'resource_count', (
                  select count(*)
                  from public.attachment_placements ap
                  join public.attachments att on att.id = ap.attachment_id
                  where ap.target_type = 'system_template'
                    and ap.target_id = st.id
                    and att.deleted_at is null
                )
              )
              order by st.name
            ), '[]'::jsonb)
            from public.system_templates st
            where st.supplier_org_id = o.id
              and st.authority_state <> 'retired'
              and (
                st.owner_org_id = p_organization_id
                or exists (
                  select 1
                  from public.asset_model_template_items item
                  join public.asset_model_templates template on template.id = item.template_id
                  where item.system_template_id = st.id
                    and template.organization_id = p_organization_id
                    and template.status <> 'retired'
                )
              )
          ),
          'models', (
            select coalesce(jsonb_agg(distinct jsonb_build_object(
              'id', template.id,
              'template_key', template.template_key,
              'manufacturer', template.manufacturer,
              'model', template.model,
              'model_year', template.model_year
            )), '[]'::jsonb)
            from public.asset_model_templates template
            join public.asset_model_template_items item on item.template_id = template.id
            join public.system_templates st on st.id = item.system_template_id
            where template.organization_id = p_organization_id
              and template.status <> 'retired'
              and st.supplier_org_id = o.id
              and st.authority_state <> 'retired'
          )
        ))
        order by coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.display_name, kp.name, 'Supplier')
      )
      from supplier_rows sr
      join public.orgs o on o.id = sr.supplier_org_id
      left join public.keepr_pros kp on kp.organization_id = o.id
      where coalesce(o.status, 'active') = 'active'
        and (
          v_query = ''
          or lower(coalesce(o.display_name, o.name, kp.display_name, kp.name, '')) like '%' || v_query || '%'
          or lower(coalesce(o.slug, '')) like '%' || v_query || '%'
          or lower(coalesce(kp.website, o.source_url, sr.relationship_source_url, '')) like '%' || v_query || '%'
        )
      limit v_limit
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'suppliers', (
        with supplier_ids as (
          select to_org_id as id
          from public.org_relationships
          where from_org_id = p_organization_id
            and relationship_type in ('supplier', 'system_supplier', 'component_supplier')
            and status in ('source_reported', 'active')
          union
          select supplier_org_id
          from public.system_templates
          where owner_org_id = p_organization_id
            and supplier_org_id is not null
            and authority_state <> 'retired'
        )
        select count(distinct id) from supplier_ids where id is not null
      )
    )
  );
end;
$$;

grant execute on function public.list_organization_supplier_network(uuid, text, integer) to authenticated;

comment on function public.list_organization_supplier_network(uuid, text, integer) is
  'Supplier V1 graph projection: active OEM Organization -> supplier Organization relationships -> System Templates -> model applicability -> exact system/KAC counts.';

select pg_notify('pgrst', 'reload schema');
