-- Materialize Tiara exact factory builds into canonical Keepr asset rows.
--
-- This is the transition from local/staging seed to durable digital-twin data:
-- reusable template -> exact asset -> factory evidence -> systems graph ->
-- source/manual resolution queue -> package export.

create or replace function public.materialize_tiara_factory_build_asset(
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_work_order jsonb := coalesce(p_payload -> 'workOrder', '{}'::jsonb);
  v_template_payload jsonb := coalesce(p_payload -> 'template', '{}'::jsonb);
  v_context_payload jsonb := coalesce(p_payload -> 'publicModelContext', '{}'::jsonb);
  v_lines jsonb := coalesce(p_payload -> 'lines', '[]'::jsonb);
  v_systems jsonb := coalesce(p_payload -> 'systems', '[]'::jsonb);
  v_resources jsonb := coalesce(p_payload -> 'resources', '[]'::jsonb);
  v_tiara_org_id uuid;
  v_dealer_org_id uuid;
  v_actor_id uuid;
  v_template_id uuid;
  v_template_resource_id uuid;
  v_work_order_resource_id uuid;
  v_asset_id uuid;
  v_kac_id text := concat('KAC-TIARA-56LS-', upper(coalesce(v_work_order ->> 'build_code', 'KF018')));
  v_binding_id uuid;
  v_document_id uuid;
  v_oem_relationship_id uuid;
  v_item jsonb;
  v_line jsonb;
  v_resource jsonb;
  v_stable_system_id text;
  v_system_id uuid;
  v_system_map jsonb := '{}'::jsonb;
  v_manual_queue jsonb := '[]'::jsonb;
  v_template_item_sort_order integer := 100;
begin
  if nullif(v_work_order ->> 'hin', '') is null then
    raise exception 'Factory build payload is missing HIN';
  end if;

  insert into public.orgs (name, display_name, slug, org_type, organization_type, workspace_type, status, updated_at)
  values ('Tiara Yachts', 'Tiara Yachts', 'tiara-yachts', 'manufacturer', 'oem', 'keeproem', 'active', now())
  on conflict (lower(slug))
  where slug is not null
  do update
    set display_name = coalesce(public.orgs.display_name, excluded.display_name),
        organization_type = coalesce(public.orgs.organization_type, excluded.organization_type),
        workspace_type = coalesce(public.orgs.workspace_type, excluded.workspace_type),
        status = coalesce(public.orgs.status, excluded.status),
        updated_at = now()
  returning id into v_tiara_org_id;

  insert into public.orgs (name, display_name, slug, org_type, organization_type, workspace_type, status, updated_at)
  values ('Ocean Blue Yachts', 'Ocean Blue Yachts', 'ocean-blue-yachts', 'dealer', 'dealer', 'keeprdealer', 'active', now())
  on conflict (lower(slug))
  where slug is not null
  do update
    set display_name = coalesce(public.orgs.display_name, excluded.display_name),
        organization_type = coalesce(public.orgs.organization_type, excluded.organization_type),
        workspace_type = coalesce(public.orgs.workspace_type, excluded.workspace_type),
        status = coalesce(public.orgs.status, excluded.status),
        updated_at = now()
  returning id into v_dealer_org_id;

  select user_id
    into v_actor_id
  from public.org_members
  where org_id = v_tiara_org_id
    and coalesce(status, 'active') = 'active'
  order by
    case coalesce(role, member_role, 'member') when 'owner' then 0 when 'admin' then 1 else 2 end,
    created_at nulls last
  limit 1;

  if v_actor_id is null then
    v_actor_id := auth.uid();
  end if;

  select id
    into v_template_resource_id
  from public.asset_resources
  where source_url = v_context_payload ->> 'source_url'
    and applies_to_type = 'org'
    and applies_to_id = v_tiara_org_id
  order by created_at desc
  limit 1;

  if v_template_resource_id is null then
    insert into public.asset_resources (
      resource_type,
      title,
      url,
      source_name,
      source_platform,
      source_url,
      captured_at,
      authority_state,
      rights_status,
      applies_to_type,
      applies_to_id,
      metadata,
      created_by
    )
    values (
      'model_page',
      coalesce(v_context_payload ->> 'source_url', 'Tiara 56 LS public model page'),
      v_context_payload ->> 'source_url',
      'Tiara Yachts',
      'Tiara Yachts website',
      v_context_payload ->> 'source_url',
      now(),
      'oem_published',
      'public_ok',
      'org',
      v_tiara_org_id,
      jsonb_build_object(
        'scope', 'template',
        'template_key', v_template_payload ->> 'template_key',
        'source_type', v_context_payload ->> 'source_type',
        'source_role', v_context_payload ->> 'source_role',
        'specs', coalesce(v_context_payload -> 'specs', '[]'::jsonb),
        'media_gallery', coalesce(v_context_payload -> 'media_gallery', '[]'::jsonb)
      ),
      v_actor_id
    )
    returning id into v_template_resource_id;
  else
    update public.asset_resources
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'scope', 'template',
          'template_key', v_template_payload ->> 'template_key',
          'source_type', v_context_payload ->> 'source_type',
          'source_role', v_context_payload ->> 'source_role',
          'specs', coalesce(v_context_payload -> 'specs', '[]'::jsonb),
          'media_gallery', coalesce(v_context_payload -> 'media_gallery', '[]'::jsonb)
        ),
        updated_at = now()
    where id = v_template_resource_id;
  end if;

  insert into public.asset_model_templates (
    organization_id,
    asset_type,
    category,
    class,
    manufacturer,
    model,
    model_year,
    template_key,
    version,
    status,
    authority_state,
    source_resource_id,
    metadata,
    created_by
  )
  values (
    v_tiara_org_id,
    'marine',
    'boat',
    coalesce(v_template_payload #>> '{identity,class}', 'Luxury Sport'),
    coalesce(v_template_payload ->> 'manufacturer', 'Tiara Yachts'),
    coalesce(v_template_payload ->> 'model', '56 LS'),
    coalesce((v_template_payload ->> 'model_year')::integer, 2027),
    coalesce(v_template_payload ->> 'template_key', 'tiara-2027-56-ls'),
    coalesce((v_template_payload ->> 'version')::integer, 1),
    'published',
    'oem_published',
    v_template_resource_id,
    jsonb_build_object(
      'source_role', 'reusable_model_template',
      'identity', coalesce(v_template_payload -> 'identity', '{}'::jsonb),
      'option_groups', coalesce(v_template_payload -> 'option_groups', '[]'::jsonb),
      'source_documents', coalesce(v_template_payload -> 'source_documents', '[]'::jsonb),
      'public_model_context', v_context_payload
    ),
    v_actor_id
  )
  on conflict (lower(template_key), version)
  do update
    set organization_id = excluded.organization_id,
        manufacturer = excluded.manufacturer,
        model = excluded.model,
        model_year = excluded.model_year,
        status = 'published',
        authority_state = 'oem_published',
        source_resource_id = coalesce(excluded.source_resource_id, public.asset_model_templates.source_resource_id),
        metadata = public.asset_model_templates.metadata || excluded.metadata,
        updated_at = now()
  returning id into v_template_id;

  for v_item in select * from jsonb_array_elements(coalesce(v_template_payload -> 'starter_systems', '[]'::jsonb))
  loop
    insert into public.asset_model_template_items (
      template_id,
      item_type,
      canonical_key,
      label,
      expected_value,
      applicability,
      authority_state,
      source_resource_id,
      metadata,
      sort_order
    )
    values (
      v_template_id,
      case when coalesce(v_item ->> 'relationship_type', 'system') = 'option' then 'equipment' else 'system' end,
      v_item ->> 'canonical_key',
      coalesce(v_item ->> 'normalized_name', v_item ->> 'system_category', v_item ->> 'canonical_key'),
      jsonb_strip_nulls(jsonb_build_object(
        'system_category', v_item ->> 'system_category',
        'manufacturer', v_item ->> 'manufacturer',
        'model', v_item ->> 'model',
        'product_family', v_item ->> 'product_family',
        'template_status', v_item ->> 'template_status',
        'components', v_item -> 'components',
        'options', v_item -> 'options'
      )),
      jsonb_build_object('scope', 'model'),
      'oem_published',
      v_template_resource_id,
      jsonb_build_object('source_role', 'reusable_model_template'),
      v_template_item_sort_order
    )
    on conflict (template_id, lower(canonical_key))
    do update
      set label = excluded.label,
          expected_value = public.asset_model_template_items.expected_value || excluded.expected_value,
          authority_state = 'oem_published',
          source_resource_id = coalesce(excluded.source_resource_id, public.asset_model_template_items.source_resource_id),
          metadata = public.asset_model_template_items.metadata || excluded.metadata,
          updated_at = now();
    v_template_item_sort_order := v_template_item_sort_order + 1;
  end loop;

  for v_resource in select * from jsonb_array_elements(v_resources)
  loop
    insert into public.asset_resources (
      resource_type,
      title,
      url,
      source_name,
      source_platform,
      source_url,
      captured_at,
      authority_state,
      rights_status,
      applies_to_type,
      applies_to_id,
      metadata,
      created_by
    )
    select
      coalesce(v_resource ->> 'resource_type', 'oem_catalog'),
      v_resource ->> 'title',
      v_resource ->> 'url',
      coalesce(v_resource ->> 'source_name', 'Tiara Yachts'),
      v_resource ->> 'source_platform',
      coalesce(v_resource ->> 'source_url', v_resource ->> 'url'),
      now(),
      coalesce(v_resource ->> 'authority_state', 'oem_published'),
      coalesce(v_resource ->> 'rights_status', 'review_permission'),
      coalesce(v_resource ->> 'applies_to_type', 'template'),
      case
        when coalesce(v_resource ->> 'applies_to_type', 'template') = 'template' then v_template_id
        when coalesce(v_resource ->> 'applies_to_type', 'template') = 'asset' then null
        else v_template_id
      end,
      jsonb_strip_nulls(coalesce(v_resource -> 'metadata', '{}'::jsonb) || jsonb_build_object(
        'template_key', v_template_payload ->> 'template_key',
        'scope', coalesce(v_resource ->> 'scope', 'template')
      )),
      v_actor_id
    
    where not exists (
      select 1
      from public.asset_resources existing
      where existing.applies_to_type = coalesce(v_resource ->> 'applies_to_type', 'template')
        and existing.applies_to_id = case
          when coalesce(v_resource ->> 'applies_to_type', 'template') = 'template' then v_template_id
          when coalesce(v_resource ->> 'applies_to_type', 'template') = 'asset' then null
          else v_template_id
        end
        and coalesce(existing.source_url, '') = coalesce(v_resource ->> 'source_url', v_resource ->> 'url', '')
        and lower(existing.title) = lower(v_resource ->> 'title')
    );
  end loop;

  select id
    into v_asset_id
  from public.assets
  where upper(kac_id) = upper(v_kac_id)
    and deleted_at is null
  limit 1;

  if v_asset_id is null then
    insert into public.assets (
      owner_id,
      name,
      type,
      status,
      asset_mode,
      year,
      make,
      model,
      serial_number,
      kac_id,
      data_source,
      extra_metadata,
      created_at
    )
    values (
      null,
      concat(coalesce(v_work_order ->> 'build_code', 'KF018'), ' · ', coalesce(v_template_payload ->> 'manufacturer', 'Tiara Yachts'), ' ', coalesce(v_template_payload ->> 'model', '56 LS')),
      'boat',
      'active',
      'commercial',
      coalesce((v_template_payload ->> 'model_year')::integer, 2027),
      coalesce(v_template_payload ->> 'manufacturer', 'Tiara Yachts'),
      coalesce(v_template_payload ->> 'model', '56 LS'),
      v_work_order ->> 'hin',
      v_kac_id,
      'tiara_factory_build',
      jsonb_build_object(
        'source', 'tiara_factory_build_materialized',
        'catalog_template_key', v_template_payload ->> 'template_key',
        'exact_build_key', lower(coalesce(v_work_order ->> 'build_code', 'kf018')),
        'build_code', v_work_order ->> 'build_code',
        'work_order', v_work_order,
        'factory_confirmed', true,
        'operating_states', jsonb_build_array('OEM Build'),
        'provenance', jsonb_build_object(
          'source_role', 'factory_build_truth',
          'source_type', v_work_order ->> 'source_type',
          'source_document', v_work_order ->> 'source_document'
        )
      ),
      now()
    )
    returning id into v_asset_id;
  else
    update public.assets
    set name = concat(coalesce(v_work_order ->> 'build_code', 'KF018'), ' · ', coalesce(v_template_payload ->> 'manufacturer', 'Tiara Yachts'), ' ', coalesce(v_template_payload ->> 'model', '56 LS')),
        year = coalesce((v_template_payload ->> 'model_year')::integer, 2027),
        make = coalesce(v_template_payload ->> 'manufacturer', 'Tiara Yachts'),
        model = coalesce(v_template_payload ->> 'model', '56 LS'),
        serial_number = v_work_order ->> 'hin',
        data_source = 'tiara_factory_build',
        extra_metadata = coalesce(extra_metadata, '{}'::jsonb) || jsonb_build_object(
          'source', 'tiara_factory_build_materialized',
          'catalog_template_key', v_template_payload ->> 'template_key',
          'exact_build_key', lower(coalesce(v_work_order ->> 'build_code', 'kf018')),
          'build_code', v_work_order ->> 'build_code',
          'work_order', v_work_order,
          'factory_confirmed', true,
          'operating_states', jsonb_build_array('OEM Build'),
          'provenance', jsonb_build_object(
            'source_role', 'factory_build_truth',
            'source_type', v_work_order ->> 'source_type',
            'source_document', v_work_order ->> 'source_document'
          )
        )
    where id = v_asset_id;
  end if;

  select id
    into v_work_order_resource_id
  from public.asset_resources
  where applies_to_type = 'asset'
    and applies_to_id = v_asset_id
    and resource_type = 'build_sheet'
    and metadata ->> 'order_number' = v_work_order ->> 'order_number'
  order by created_at desc
  limit 1;

  if v_work_order_resource_id is null then
    insert into public.asset_resources (
    resource_type,
    title,
    source_name,
    source_platform,
    captured_at,
    authority_state,
    rights_status,
    applies_to_type,
    applies_to_id,
    metadata,
    created_by
  )
  values (
    'build_sheet',
    v_work_order ->> 'source_document',
    'Tiara Yachts',
    'factory work order',
    now(),
    'oem_as_built',
    'private',
    'asset',
    v_asset_id,
    jsonb_build_object(
      'asset_id', v_asset_id,
      'scope', 'exact_build',
      'source_type', v_work_order ->> 'source_type',
      'source_role', v_work_order ->> 'source_role',
      'order_number', v_work_order ->> 'order_number',
      'hull_number', v_work_order ->> 'hull_number',
      'hin', v_work_order ->> 'hin',
      'raw_work_order', v_work_order
    ),
    v_actor_id
    )
    returning id into v_work_order_resource_id;
  else
    update public.asset_resources
    set title = v_work_order ->> 'source_document',
        source_name = 'Tiara Yachts',
        source_platform = 'factory work order',
        authority_state = 'oem_as_built',
        rights_status = 'private',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'asset_id', v_asset_id,
          'scope', 'exact_build',
          'source_type', v_work_order ->> 'source_type',
          'source_role', v_work_order ->> 'source_role',
          'order_number', v_work_order ->> 'order_number',
          'hull_number', v_work_order ->> 'hull_number',
          'hin', v_work_order ->> 'hin',
          'raw_work_order', v_work_order
        ),
        updated_at = now()
    where id = v_work_order_resource_id;
  end if;

  insert into public.asset_template_bindings (
    asset_id,
    template_id,
    template_version,
    binding_status,
    binding_source,
    confidence,
    source_resource_id,
    created_by,
    metadata
  )
  values (
    v_asset_id,
    v_template_id,
    coalesce((v_template_payload ->> 'version')::integer, 1),
    'verified',
    'oem',
    1.0000,
    v_work_order_resource_id,
    v_actor_id,
    jsonb_build_object(
      'source', 'tiara_factory_build_materialized',
      'exact_build_key', lower(coalesce(v_work_order ->> 'build_code', 'kf018')),
      'factory_confirmed', true
    )
  )
  on conflict (asset_id)
  where binding_status in ('suggested', 'inherited', 'verified')
  do update
    set template_id = excluded.template_id,
        template_version = excluded.template_version,
        binding_status = 'verified',
        binding_source = 'oem',
        confidence = 1.0000,
        source_resource_id = excluded.source_resource_id,
        metadata = public.asset_template_bindings.metadata || excluded.metadata
  returning id into v_binding_id;

  insert into public.asset_relationships (
    asset_id,
    organization_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    initiated_by_user_id,
    initiated_by_org_id,
    source_resource_id,
    metadata
  )
  values (
    v_asset_id,
    v_tiara_org_id,
    'oem',
    'active',
    'oem_context',
    'unclaimed_org',
    v_actor_id,
    v_tiara_org_id,
    v_work_order_resource_id,
    jsonb_build_object('source', 'tiara_factory_build_materialized', 'projection_statement', 'The boat Tiara built', 'factory_confirmed', true)
  )
  on conflict (asset_id, organization_id, relationship_type, coalesce(org_location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active' and organization_id is not null
  do update
    set access_scope = 'oem_context',
        source_resource_id = excluded.source_resource_id,
        metadata = public.asset_relationships.metadata || excluded.metadata,
        updated_at = now()
  returning id into v_oem_relationship_id;

  insert into public.asset_relationships (
    asset_id,
    organization_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    initiated_by_user_id,
    initiated_by_org_id,
    source_resource_id,
    metadata
  )
  values (
    v_asset_id,
    v_dealer_org_id,
    'delivery_dealer',
    'active',
    'service_workspace',
    'unclaimed_org',
    v_actor_id,
    v_tiara_org_id,
    v_work_order_resource_id,
    jsonb_build_object('source', 'tiara_factory_build_materialized', 'dealer_from_work_order', v_work_order ->> 'dealer')
  )
  on conflict (asset_id, organization_id, relationship_type, coalesce(org_location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active' and organization_id is not null
  do update
    set access_scope = 'service_workspace',
        source_resource_id = excluded.source_resource_id,
        metadata = public.asset_relationships.metadata || excluded.metadata,
        updated_at = now();

  for v_item in select * from jsonb_array_elements(v_systems)
  loop
    v_stable_system_id := v_item ->> 'id';

    select id
      into v_system_id
    from public.systems
    where asset_id = v_asset_id
      and metadata ->> 'stable_system_id' = v_stable_system_id
    limit 1;

    if v_system_id is null then
      insert into public.systems (
        asset_id,
        ksc_code,
        name,
        lod,
        status,
        system_type,
        source_type,
        metadata
      )
      values (
        v_asset_id,
        upper(regexp_replace(coalesce(v_item ->> 'system_category', v_item ->> 'name', 'SYSTEM'), '[^a-zA-Z0-9]+', '-', 'g')),
        v_item ->> 'name',
        3,
        case when v_item ->> 'manual_status' = 'found' then 'ok' else 'needs_review' end,
        v_item ->> 'system_category',
        'tiara_factory_build',
        jsonb_build_object(
          'stable_system_id', v_stable_system_id,
          'system_category', v_item ->> 'system_category',
          'factory_confirmed', true,
          'manual_status', v_item ->> 'manual_status',
          'owner_manual', null,
          'service_manual', null,
          'installation_manual', null,
          'warranty_source', null,
          'source_role', 'factory_build_truth',
          'source_resource_id', v_work_order_resource_id
        )
      )
      returning id into v_system_id;
    else
      update public.systems
      set
        name = v_item ->> 'name',
        status = case when v_item ->> 'manual_status' = 'found' then 'ok' else 'needs_review' end,
        system_type = v_item ->> 'system_category',
        source_type = 'tiara_factory_build',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'stable_system_id', v_stable_system_id,
          'system_category', v_item ->> 'system_category',
          'factory_confirmed', true,
          'manual_status', v_item ->> 'manual_status',
          'source_role', 'factory_build_truth',
          'source_resource_id', v_work_order_resource_id
        )
      where id = v_system_id;
    end if;

    v_system_map := v_system_map || jsonb_build_object(v_stable_system_id, v_system_id::text);
  end loop;

  insert into public.factory_build_documents (
    source_type,
    source_document,
    source_role,
    manufacturer,
    asset_id,
    catalog_template_key,
    exact_build_key,
    order_number,
    order_date,
    hull_number,
    hin,
    completion_date,
    raw_metadata,
    normalized_metadata
  )
  values (
    v_work_order ->> 'source_type',
    v_work_order ->> 'source_document',
    'factory_build_truth',
    coalesce(v_template_payload ->> 'manufacturer', 'Tiara Yachts'),
    v_asset_id,
    v_template_payload ->> 'template_key',
    lower(coalesce(v_work_order ->> 'build_code', 'kf018')),
    v_work_order ->> 'order_number',
    (v_work_order ->> 'order_date')::date,
    v_work_order ->> 'hull_number',
    v_work_order ->> 'hin',
    (v_work_order ->> 'completion_date')::date,
    v_work_order,
    jsonb_build_object('template_id', v_template_id, 'asset_id', v_asset_id, 'asset_kac_id', v_kac_id)
  )
  on conflict (source_type, order_number, hull_number)
  do update
    set asset_id = excluded.asset_id,
        catalog_template_key = excluded.catalog_template_key,
        exact_build_key = excluded.exact_build_key,
        hin = excluded.hin,
        raw_metadata = excluded.raw_metadata,
        normalized_metadata = excluded.normalized_metadata,
        updated_at = now()
  returning id into v_document_id;

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    v_system_id := null;
    if nullif(v_line ->> 'system_id', '') is not null and v_system_map ? (v_line ->> 'system_id') then
      v_system_id := (v_system_map ->> (v_line ->> 'system_id'))::uuid;
    end if;

    insert into public.factory_build_line_items (
      document_id,
      line_number,
      source_type,
      source_document,
      order_number,
      order_date,
      hull_number,
      hin,
      completion_date,
      factory_item_code,
      factory_description,
      quantity,
      factory_section,
      raw_source_text,
      normalized_name,
      system_category,
      system_id,
      component_id,
      manufacturer,
      model,
      product_family,
      relationship_type,
      mapping_status,
      mapping_confidence,
      mapping_method,
      source_role,
      factory_confirmed,
      manual_status,
      mapping_metadata
    )
    values (
      v_document_id,
      (v_line ->> 'line_number')::integer,
      v_line ->> 'source_type',
      v_line ->> 'source_document',
      v_line ->> 'order_number',
      (v_line ->> 'order_date')::date,
      v_line ->> 'hull_number',
      v_line ->> 'hin',
      (v_line ->> 'completion_date')::date,
      v_line ->> 'factory_item_code',
      v_line ->> 'factory_description',
      nullif(v_line ->> 'quantity', '')::numeric,
      v_line ->> 'factory_section',
      v_line ->> 'raw_source_text',
      v_line ->> 'normalized_name',
      v_line ->> 'system_category',
      v_system_id,
      null,
      v_line ->> 'manufacturer',
      v_line ->> 'model',
      v_line ->> 'product_family',
      v_line ->> 'relationship_type',
      v_line ->> 'mapping_status',
      (v_line ->> 'mapping_confidence')::numeric,
      v_line ->> 'mapping_method',
      'factory_build_truth',
      coalesce((v_line ->> 'factory_confirmed')::boolean, true),
      nullif(v_line ->> 'manual_status', ''),
      jsonb_strip_nulls(jsonb_build_object(
        'stable_factory_line_id', v_line ->> 'id',
        'stable_system_id', v_line ->> 'system_id',
        'component_key', v_line ->> 'component_id',
        'review_note', v_line ->> 'review_note',
        'supporting_catalog_source', v_line ->> 'supporting_catalog_source',
        'asset_id', v_asset_id,
        'source_resource_id', v_work_order_resource_id
      ))
    )
    on conflict (document_id, line_number)
    do update
      set system_id = excluded.system_id,
          factory_item_code = excluded.factory_item_code,
          factory_description = excluded.factory_description,
          raw_source_text = excluded.raw_source_text,
          normalized_name = excluded.normalized_name,
          system_category = excluded.system_category,
          manufacturer = excluded.manufacturer,
          model = excluded.model,
          product_family = excluded.product_family,
          relationship_type = excluded.relationship_type,
          mapping_status = excluded.mapping_status,
          mapping_confidence = excluded.mapping_confidence,
          mapping_method = excluded.mapping_method,
          manual_status = excluded.manual_status,
          mapping_metadata = excluded.mapping_metadata,
          updated_at = now();

    insert into public.asset_facts (
      asset_id,
      subject_type,
      subject_id,
      fact_key,
      fact_value,
      authority_state,
      confidence,
      source_resource_id,
      asserted_by_org_id,
      asserted_by_user_id,
      metadata
    )
    select
      v_asset_id,
      case when v_system_id is null then 'asset' else 'system' end,
      case when v_system_id is null then v_asset_id else v_system_id end,
      'factory_work_order_line',
      v_line,
      'oem_as_built',
      coalesce((v_line ->> 'mapping_confidence')::numeric, 1),
      v_work_order_resource_id,
      v_tiara_org_id,
      v_actor_id,
      jsonb_build_object(
        'factory_line_id', v_line ->> 'id',
        'line_number', (v_line ->> 'line_number')::integer,
        'relationship_type', v_line ->> 'relationship_type',
        'mapping_status', v_line ->> 'mapping_status'
      )
    where not exists (
      select 1
      from public.asset_facts f
      where f.asset_id = v_asset_id
        and f.fact_key = 'factory_work_order_line'
        and f.metadata ->> 'factory_line_id' = v_line ->> 'id'
        and f.active = true
    );
  end loop;

  insert into public.asset_facts (
    asset_id,
    subject_type,
    subject_id,
    fact_key,
    fact_value,
    authority_state,
    confidence,
    source_resource_id,
    asserted_by_org_id,
    asserted_by_user_id,
    metadata
  )
  select *
  from (
    values
      (v_asset_id, 'asset'::text, v_asset_id, 'hin'::text, to_jsonb(v_work_order ->> 'hin'), 'oem_as_built'::text, 1::numeric, v_work_order_resource_id, v_tiara_org_id, v_actor_id, jsonb_build_object('source', 'tiara_factory_work_order')),
      (v_asset_id, 'asset'::text, v_asset_id, 'factory_order_number'::text, to_jsonb(v_work_order ->> 'order_number'), 'oem_as_built'::text, 1::numeric, v_work_order_resource_id, v_tiara_org_id, v_actor_id, jsonb_build_object('source', 'tiara_factory_work_order')),
      (v_asset_id, 'asset'::text, v_asset_id, 'factory_build_code'::text, to_jsonb(v_work_order ->> 'build_code'), 'oem_as_built'::text, 1::numeric, v_work_order_resource_id, v_tiara_org_id, v_actor_id, jsonb_build_object('source', 'tiara_factory_work_order'))
  ) as summary_fact(asset_id, subject_type, subject_id, fact_key, fact_value, authority_state, confidence, source_resource_id, asserted_by_org_id, asserted_by_user_id, metadata)
  where not exists (
    select 1
    from public.asset_facts existing
    where existing.asset_id = v_asset_id
      and existing.fact_key = summary_fact.fact_key
      and existing.fact_value = summary_fact.fact_value
      and existing.active = true
      and existing.authority_state = 'oem_as_built'
  )
  on conflict do nothing;

  select coalesce(jsonb_agg(queue_row order by queue_row ->> 'system_category'), '[]'::jsonb)
    into v_manual_queue
  from (
    select jsonb_build_object(
      'system_id', s.id,
      'system_name', s.name,
      'system_category', s.metadata ->> 'system_category',
      'manual_status', s.metadata ->> 'manual_status',
      'factory_confirmed', true,
      'missing_sources', jsonb_build_array('owner_manual', 'service_manual', 'installation_manual', 'warranty_source')
    ) as queue_row
    from public.systems s
    where s.asset_id = v_asset_id
      and s.source_type = 'tiara_factory_build'
      and coalesce(s.metadata ->> 'manual_status', 'missing') in ('missing', 'needs_exact_model')
  ) q;

  return jsonb_build_object(
    'asset_id', v_asset_id,
    'kac_id', v_kac_id,
    'template_id', v_template_id,
    'template_key', v_template_payload ->> 'template_key',
    'template_binding_id', v_binding_id,
    'factory_build_document_id', v_document_id,
    'oem_relationship_id', v_oem_relationship_id,
    'systems_count', (select count(*) from public.systems where asset_id = v_asset_id and source_type = 'tiara_factory_build'),
    'factory_lines_count', (select count(*) from public.factory_build_line_items where document_id = v_document_id),
    'manual_queue', v_manual_queue
  );
end;
$$;

create or replace function public.export_asset_package(
  p_asset_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_template jsonb := null;
  v_systems jsonb := '[]'::jsonb;
  v_factory_build jsonb := null;
  v_resources jsonb := '[]'::jsonb;
  v_facts jsonb := '[]'::jsonb;
begin
  select *
    into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null
  limit 1;

  if v_asset.id is null then
    return null;
  end if;

  if coalesce(auth.role(), '') <> 'service_role' and not public.activator_user_can_read_asset(auth.uid(), p_asset_id) then
    return null;
  end if;

  select jsonb_build_object(
    'binding', to_jsonb(b),
    'template', to_jsonb(t),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.sort_order, i.label)
      from public.asset_model_template_items i
      where i.template_id = t.id
    ), '[]'::jsonb)
  )
    into v_template
  from public.asset_template_bindings b
  join public.asset_model_templates t
    on t.id = b.template_id
  where b.asset_id = p_asset_id
    and b.binding_status in ('suggested', 'inherited', 'verified')
  order by case b.binding_status when 'verified' then 0 when 'inherited' then 1 else 2 end, b.created_at desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(s) order by s.name), '[]'::jsonb)
    into v_systems
  from public.systems s
  where s.asset_id = p_asset_id;

  select public.get_tiara_factory_build_workspace(d.hull_number, d.catalog_template_key, d.exact_build_key)
    into v_factory_build
  from public.factory_build_documents d
  where d.asset_id = p_asset_id
  order by d.created_at desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.applies_to_type, r.title), '[]'::jsonb)
    into v_resources
  from public.asset_resources r
  where (r.applies_to_type = 'asset' and r.applies_to_id = p_asset_id)
     or (r.metadata ->> 'asset_id') = p_asset_id::text
     or (
       v_template is not null
       and r.applies_to_type = 'template'
       and r.applies_to_id = (v_template #>> '{template,id}')::uuid
     );

  select coalesce(jsonb_agg(to_jsonb(f) order by f.fact_key, f.asserted_at), '[]'::jsonb)
    into v_facts
  from public.asset_facts f
  where f.asset_id = p_asset_id
    and f.active = true;

  return jsonb_build_object(
    'package_contract', jsonb_build_object(
      'contract_name', 'keepr_asset_package_v1',
      'generated_at', now(),
      'asset_id', p_asset_id,
      'kac_id', v_asset.kac_id,
      'recreate_question', 'Could this bundle recreate the boat identity, factory evidence, systems graph, and source queue?'
    ),
    'asset', to_jsonb(v_asset),
    'template', v_template,
    'systems', v_systems,
    'factory_build', v_factory_build,
    'facts', v_facts,
    'resources', v_resources
  );
end;
$$;

create or replace function public.export_asset_package_by_kac(
  p_kac_id text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.export_asset_package(a.id)
  from public.assets a
  where upper(a.kac_id) = upper(p_kac_id)
    and a.deleted_at is null
  limit 1;
$$;

grant execute on function public.materialize_tiara_factory_build_asset(jsonb) to authenticated, service_role;
grant execute on function public.export_asset_package(uuid) to authenticated, service_role;
grant execute on function public.export_asset_package_by_kac(text) to authenticated, service_role;
