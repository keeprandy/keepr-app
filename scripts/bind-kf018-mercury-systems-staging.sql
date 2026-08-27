BEGIN;

DO $$
DECLARE
  v_asset uuid := 'a5b0d793-0aa2-4c3b-842e-5d2375aba8ed';
  v_group uuid;
  v_line uuid := '33ba3157-ddae-4523-91c9-74f4c19aa233';
  v_model_node uuid := '6c0da377-f6b4-4074-a4c2-8cf9d703b117';
  v_rollup_system uuid := '1d59aeaa-e616-40fc-a3db-c71604776419';
  v_engine1_node uuid := 'f7b9b669-1302-43f6-b7ab-1429164ae341';
  v_engine2_node uuid := '4d05454c-8f32-46ea-9ed9-0f5256449772';
  v_engine3_node uuid := '17a393e8-dadc-4191-b75c-2a951c06ecde';
  v_engine4_node uuid := '81712153-b8a5-4da7-8d3d-90327f0ed68e';
  v_engine1_system uuid := '672ebaef-7ca8-43cd-b267-a01553424f57';
  v_engine2_system uuid;
  v_engine3_system uuid := '5a7d53b0-1b9a-4799-a244-a8a50ba6f001';
  v_engine4_system uuid;
  v_system_ids uuid[];
BEGIN
  SELECT id INTO v_group
  FROM public.system_groups
  WHERE asset_id = v_asset AND lower(name) = 'propulsion'
  ORDER BY created_at
  LIMIT 1;

  IF v_group IS NULL THEN
    INSERT INTO public.system_groups (asset_id, name, description, sort_order, category, metadata)
    VALUES (
      v_asset,
      'Propulsion',
      'Factory-confirmed propulsion systems for KF018.',
      10,
      'propulsion',
      jsonb_build_object('source', 'factory_build_projection', 'factory_line_item_id', v_line)
    )
    RETURNING id INTO v_group;
  ELSE
    UPDATE public.system_groups
    SET
      description = COALESCE(NULLIF(description, ''), 'Factory-confirmed propulsion systems for KF018.'),
      sort_order = COALESCE(sort_order, 10),
      category = COALESCE(category, 'propulsion'),
      metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
        'source', 'factory_build_projection',
        'source_role', 'factory_build_truth',
        'factory_line_item_id', v_line,
        'factory_item_code', 'KFA275Q0003921',
        'factory_description', 'QUAD MERCURY V12 600 HP, JPO',
        'graph_node_id', '77a003d7-6fa3-4612-aada-e290c30f7bc9',
        'projection_version', 'kf018_mercury_system_binding_v1'
      ),
      updated_at = now()
    WHERE id = v_group;
  END IF;

  SELECT id INTO v_engine2_system
  FROM public.systems
  WHERE asset_id = v_asset AND metadata->>'bound_graph_node_id' = v_engine2_node::text
  LIMIT 1;

  IF v_engine2_system IS NULL THEN
    INSERT INTO public.systems (asset_id, ksc_code, name, system_type, source_type, status, system_group_id, metadata)
    VALUES (
      v_asset,
      'kf018-mercury-v12-600-port-2',
      'Mercury V12 600 - Port #2',
      'Propulsion',
      'tiara_factory_build',
      'active',
      v_group,
      '{}'::jsonb
    )
    RETURNING id INTO v_engine2_system;
  END IF;

  SELECT id INTO v_engine4_system
  FROM public.systems
  WHERE asset_id = v_asset AND metadata->>'bound_graph_node_id' = v_engine4_node::text
  LIMIT 1;

  IF v_engine4_system IS NULL THEN
    INSERT INTO public.systems (asset_id, ksc_code, name, system_type, source_type, status, system_group_id, metadata)
    VALUES (
      v_asset,
      'kf018-mercury-v12-600-starboard-2',
      'Mercury V12 600 - Starboard #2',
      'Propulsion',
      'tiara_factory_build',
      'active',
      v_group,
      '{}'::jsonb
    )
    RETURNING id INTO v_engine4_system;
  END IF;

  v_system_ids := ARRAY[v_engine1_system, v_engine2_system, v_engine3_system, v_engine4_system];

  UPDATE public.systems AS s
  SET
    name = v.name,
    ksc_code = v.ksc_code,
    system_type = 'Propulsion',
    source_type = 'tiara_factory_build',
    status = 'active',
    system_group_id = v_group,
    metadata = COALESCE(s.metadata, '{}'::jsonb) || jsonb_build_object(
      'display_name', v.name,
      'manufacturer', 'Mercury Marine',
      'model', 'V12 600',
      'product_family', 'Verado',
      'position', v.position,
      'serial_number', COALESCE(s.metadata->>'serial_number', 'missing'),
      'factory_confirmed', true,
      'bound_graph_node_id', v.graph_node::text,
      'component_model_graph_node_id', v_model_node::text,
      'factory_line_item_id', v_line::text,
      'factory_line_number', 2,
      'factory_item_code', 'KFA275Q0003921',
      'factory_description', 'QUAD MERCURY V12 600 HP, JPO',
      'projection_role', 'canonical_system',
      'projection_version', 'kf018_mercury_system_binding_v1',
      'standard', jsonb_build_object(
        'identity', jsonb_build_object(
          'manufacturer', 'Mercury Marine',
          'model', 'V12 600',
          'serial_number', COALESCE(s.metadata#>>'{standard,identity,serial_number}', ''),
          'location', v.position
        ),
        'warranty', COALESCE(s.metadata->'standard'->'warranty', '{}'::jsonb),
        'value', COALESCE(s.metadata->'standard'->'value', '{}'::jsonb),
        'risk', COALESCE(s.metadata->'standard'->'risk', '{}'::jsonb),
        'story', COALESCE(s.metadata->'standard'->'story', '{}'::jsonb) || jsonb_build_object(
          'summary', 'Factory-confirmed from Tiara work order 68398, line 2.'
        ),
        'relationships', COALESCE(s.metadata->'standard'->'relationships', '{}'::jsonb)
      )
    ),
    updated_at = now()
  FROM (VALUES
    (v_engine1_system, 'Mercury V12 600 - Port #1', 'kf018-mercury-v12-600-port-1', 'Port #1', v_engine1_node),
    (v_engine2_system, 'Mercury V12 600 - Port #2', 'kf018-mercury-v12-600-port-2', 'Port #2', v_engine2_node),
    (v_engine3_system, 'Mercury V12 600 - Starboard #1', 'kf018-mercury-v12-600-starboard-1', 'Starboard #1', v_engine3_node),
    (v_engine4_system, 'Mercury V12 600 - Starboard #2', 'kf018-mercury-v12-600-starboard-2', 'Starboard #2', v_engine4_node)
  ) AS v(id, name, ksc_code, position, graph_node)
  WHERE s.id = v.id;

  UPDATE public.asset_graph_nodes AS n
  SET
    label = v.label,
    system_id = v.system_id,
    factory_line_item_id = v_line,
    metadata = COALESCE(n.metadata, '{}'::jsonb) || jsonb_build_object(
      'canonical_system_id', v.system_id::text,
      'system_group_id', v_group::text,
      'position', v.position,
      'projection_role', 'component_instance_traceability',
      'projection_version', 'kf018_mercury_system_binding_v1'
    ),
    updated_at = now()
  FROM (VALUES
    (v_engine1_node, v_engine1_system, 'Mercury V12 600 - Port #1', 'Port #1'),
    (v_engine2_node, v_engine2_system, 'Mercury V12 600 - Port #2', 'Port #2'),
    (v_engine3_node, v_engine3_system, 'Mercury V12 600 - Starboard #1', 'Starboard #1'),
    (v_engine4_node, v_engine4_system, 'Mercury V12 600 - Starboard #2', 'Starboard #2')
  ) AS v(node_id, system_id, label, position)
  WHERE n.id = v.node_id;

  UPDATE public.systems
  SET
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'projection_role', 'system_group_rollup',
      'system_group_rollup', true,
      'system_group_id', v_group::text,
      'canonical_system_ids', to_jsonb(v_system_ids),
      'factory_line_item_id', v_line::text,
      'factory_description', 'QUAD MERCURY V12 600 HP, JPO',
      'projection_version', 'kf018_mercury_system_binding_v1'
    ),
    updated_at = now()
  WHERE id = v_rollup_system;

  UPDATE public.asset_graph_nodes
  SET
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
      'system_group_id', v_group::text,
      'canonical_system_ids', to_jsonb(v_system_ids),
      'projection_role', 'system_group_traceability',
      'projection_version', 'kf018_mercury_system_binding_v1'
    ),
    updated_at = now()
  WHERE id = '77a003d7-6fa3-4612-aada-e290c30f7bc9'::uuid;

  UPDATE public.factory_build_line_items
  SET
    mapping_metadata = COALESCE(mapping_metadata, '{}'::jsonb) || jsonb_build_object(
      'system_group_id', v_group::text,
      'canonical_system_ids', to_jsonb(v_system_ids),
      'component_model_graph_node_id', v_model_node::text,
      'component_instance_graph_node_ids', to_jsonb(ARRAY[v_engine1_node, v_engine2_node, v_engine3_node, v_engine4_node]),
      'projection_binding', 'system_group_to_canonical_systems',
      'projection_version', 'kf018_mercury_system_binding_v1'
    ),
    updated_at = now()
  WHERE id = v_line;
END $$;

COMMIT;
