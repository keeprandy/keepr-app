BEGIN;

DO $$
DECLARE
  v_asset uuid := 'a5b0d793-0aa2-4c3b-842e-5d2375aba8ed';
  v_projection text := 'kf018_canonical_system_projection_v1';
  v_group_id uuid;
  v_system_id uuid;
  v_line public.factory_build_line_items%rowtype;
  v_node public.asset_graph_nodes%rowtype;
  v_group_categories text[] := ARRAY[
    'Propulsion',
    'Stabilization',
    'Waste / Sanitation',
    'Generator / AC Power',
    'Fresh Water',
    'Electrical',
    'Lighting',
    'Navigation & Electronics',
    'Galley / Appliances',
    'Deck / Cockpit',
    'Exterior',
    'Interior'
  ];
  v_group_category text;
  v_rollup_ids uuid[];
BEGIN
  FOREACH v_group_category IN ARRAY v_group_categories LOOP
    SELECT id INTO v_group_id
    FROM public.system_groups
    WHERE asset_id = v_asset
      AND lower(btrim(name)) = lower(btrim(v_group_category))
    ORDER BY created_at
    LIMIT 1;

    IF v_group_id IS NULL THEN
      INSERT INTO public.system_groups (asset_id, name, description, sort_order, category, metadata)
      VALUES (
        v_asset,
        v_group_category,
        'Factory/build-derived system group for KF018.',
        array_position(v_group_categories, v_group_category) * 10,
        lower(regexp_replace(v_group_category, '[^a-zA-Z0-9]+', '-', 'g')),
        jsonb_build_object(
          'source', 'factory_build_projection',
          'projection_version', v_projection
        )
      )
      RETURNING id INTO v_group_id;
    ELSE
      UPDATE public.system_groups
      SET
        sort_order = coalesce(nullif(sort_order, 0), array_position(v_group_categories, v_group_category) * 10),
        category = coalesce(category, lower(regexp_replace(v_group_category, '[^a-zA-Z0-9]+', '-', 'g'))),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'source', 'factory_build_projection',
          'projection_version', v_projection
        ),
        updated_at = now()
      WHERE id = v_group_id;
    END IF;
  END LOOP;

  SELECT array_agg(system_id) INTO v_rollup_ids
  FROM public.asset_graph_nodes
  WHERE asset_id = v_asset
    AND node_type = 'system'
    AND system_id IS NOT NULL;

  UPDATE public.systems s
  SET
    system_group_id = g.id,
    metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
      'projection_role', 'system_group_rollup',
      'system_group_rollup', true,
      'system_group_id', g.id::text,
      'projection_version', v_projection
    ),
    updated_at = now()
  FROM public.system_groups g
  WHERE s.asset_id = v_asset
    AND g.asset_id = v_asset
    AND lower(btrim(g.name)) = lower(btrim(coalesce(s.metadata->>'system_category', s.system_type, s.name)))
    AND s.id = ANY(coalesce(v_rollup_ids, ARRAY[]::uuid[]));

  FOR v_line IN
    SELECT *
    FROM public.factory_build_line_items
    WHERE document_id IN (
      SELECT id FROM public.factory_build_documents WHERE asset_id = v_asset
    )
      AND relationship_type in ('system', 'component')
      AND line_number <> 2
    ORDER BY line_number
  LOOP
    SELECT id INTO v_group_id
    FROM public.system_groups
    WHERE asset_id = v_asset
      AND lower(btrim(name)) = lower(btrim(v_line.system_category))
    ORDER BY created_at
    LIMIT 1;

    IF v_group_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_node
    FROM public.asset_graph_nodes
    WHERE asset_id = v_asset
      AND node_type in ('component_model', 'component_instance')
      AND (
        factory_line_item_id = v_line.id
        OR node_key = 'component_model.' || (v_line.mapping_metadata->>'component_key')
        OR lower(label) = lower(v_line.normalized_name)
      )
    ORDER BY CASE node_type WHEN 'component_instance' THEN 0 ELSE 1 END, created_at
    LIMIT 1;

    SELECT id INTO v_system_id
    FROM public.systems
    WHERE asset_id = v_asset
      AND (
        metadata->>'factory_line_item_id' = v_line.id::text
        OR (v_node.id IS NOT NULL AND metadata->>'bound_graph_node_id' = v_node.id::text)
        OR lower(name) = lower(coalesce(v_node.label, v_line.normalized_name))
      )
    ORDER BY created_at
    LIMIT 1;

    IF v_system_id IS NULL THEN
      INSERT INTO public.systems (
        asset_id,
        ksc_code,
        name,
        system_type,
        source_type,
        status,
        system_group_id,
        metadata
      )
      VALUES (
        v_asset,
        lower(regexp_replace('kf018-' || coalesce(v_node.node_key, v_line.normalized_name, 'system-' || v_line.line_number), '[^a-zA-Z0-9]+', '-', 'g')),
        coalesce(v_node.label, v_line.normalized_name, v_line.factory_description, 'Factory system ' || v_line.line_number),
        v_line.system_category,
        'tiara_factory_build',
        'active',
        v_group_id,
        '{}'::jsonb
      )
      RETURNING id INTO v_system_id;
    END IF;

    UPDATE public.systems
    SET
      name = coalesce(v_node.label, v_line.normalized_name, v_line.factory_description, name),
      system_type = v_line.system_category,
      source_type = 'tiara_factory_build',
      status = coalesce(nullif(status, 'needs_review'), 'active'),
      system_group_id = v_group_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'display_name', coalesce(v_node.label, v_line.normalized_name, v_line.factory_description, name),
        'manufacturer', nullif(v_node.manufacturer, ''),
        'model', nullif(v_node.model, ''),
        'quantity', coalesce(v_node.quantity, v_line.quantity),
        'factory_confirmed', true,
        'projection_role', 'canonical_system',
        'projection_version', v_projection,
        'system_group_id', v_group_id::text,
        'bound_graph_node_id', CASE WHEN v_node.id IS NULL THEN NULL ELSE v_node.id::text END,
        'factory_line_item_id', v_line.id::text,
        'factory_line_number', v_line.line_number,
        'factory_item_code', v_line.factory_item_code,
        'factory_description', v_line.factory_description,
        'source_resource_id', v_line.mapping_metadata->>'source_resource_id',
        'standard', coalesce(metadata->'standard', '{}'::jsonb) || jsonb_build_object(
          'identity', coalesce(metadata->'standard'->'identity', '{}'::jsonb) || jsonb_build_object(
            'manufacturer', coalesce(nullif(v_node.manufacturer, ''), metadata#>>'{standard,identity,manufacturer}', ''),
            'model', coalesce(nullif(v_node.model, ''), metadata#>>'{standard,identity,model}', ''),
            'serial_number', coalesce(metadata#>>'{standard,identity,serial_number}', ''),
            'location', coalesce(metadata#>>'{standard,identity,location}', '')
          ),
          'warranty', coalesce(metadata->'standard'->'warranty', '{}'::jsonb),
          'value', coalesce(metadata->'standard'->'value', '{}'::jsonb),
          'risk', coalesce(metadata->'standard'->'risk', '{}'::jsonb),
          'story', coalesce(metadata->'standard'->'story', '{}'::jsonb) || jsonb_build_object(
            'summary', 'Factory-confirmed from Tiara work order 68398, line ' || v_line.line_number || '.'
          ),
          'relationships', coalesce(metadata->'standard'->'relationships', '{}'::jsonb)
        )
      ),
      updated_at = now()
    WHERE id = v_system_id;

    IF v_node.id IS NOT NULL THEN
      UPDATE public.asset_graph_nodes
      SET
        system_id = v_system_id,
        factory_line_item_id = coalesce(factory_line_item_id, v_line.id),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'canonical_system_id', v_system_id::text,
          'system_group_id', v_group_id::text,
          'projection_role', 'component_traceability',
          'projection_version', v_projection
        ),
        updated_at = now()
      WHERE id = v_node.id;
    END IF;

    UPDATE public.factory_build_line_items
    SET
      system_id = v_system_id,
      mapping_metadata = coalesce(mapping_metadata, '{}'::jsonb) || jsonb_build_object(
        'system_group_id', v_group_id::text,
        'canonical_system_id', v_system_id::text,
        'component_graph_node_id', CASE WHEN v_node.id IS NULL THEN NULL ELSE v_node.id::text END,
        'projection_binding', 'factory_line_to_canonical_system',
        'projection_version', v_projection
      ),
      updated_at = now()
    WHERE id = v_line.id;
  END LOOP;

  UPDATE public.asset_graph_nodes n
  SET
    metadata = coalesce(n.metadata, '{}'::jsonb) || jsonb_build_object(
      'system_group_id', g.id::text,
      'projection_role', 'system_group_traceability',
      'projection_version', v_projection
    ),
    updated_at = now()
  FROM public.system_groups g
  WHERE n.asset_id = v_asset
    AND n.node_type = 'system'
    AND g.asset_id = v_asset
    AND lower(btrim(g.name)) = lower(btrim(n.label));
END $$;

COMMIT;
