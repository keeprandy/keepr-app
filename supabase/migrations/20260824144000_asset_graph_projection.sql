-- Asset graph projection V1.
--
-- Factory evidence remains immutable in factory_build_line_items. This layer is
-- a regenerable operational projection used by asset/twin UIs and source queues.

create table if not exists public.asset_graph_nodes (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  node_key text not null,
  node_type text not null,
  label text not null,
  system_id uuid references public.systems(id) on delete set null,
  factory_line_item_id uuid references public.factory_build_line_items(id) on delete set null,
  manufacturer text,
  model text,
  product_family text,
  quantity numeric,
  criticality text,
  factory_confirmed boolean not null default false,
  manual_status text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_graph_nodes_type_check
    check (node_type in ('system', 'component_model', 'component_instance', 'option_accessory', 'configuration', 'build_evidence')),
  constraint asset_graph_nodes_criticality_check
    check (criticality is null or criticality in ('critical', 'high', 'medium', 'low')),
  constraint asset_graph_nodes_manual_status_check
    check (manual_status is null or manual_status in ('found', 'missing', 'needs_exact_model', 'not_applicable'))
);

create unique index if not exists asset_graph_nodes_asset_key_uidx
  on public.asset_graph_nodes (asset_id, lower(node_key));

create index if not exists asset_graph_nodes_asset_type_idx
  on public.asset_graph_nodes (asset_id, node_type);

create index if not exists asset_graph_nodes_line_idx
  on public.asset_graph_nodes (factory_line_item_id)
  where factory_line_item_id is not null;

create table if not exists public.asset_graph_edges (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  from_node_id uuid not null references public.asset_graph_nodes(id) on delete cascade,
  to_node_id uuid not null references public.asset_graph_nodes(id) on delete cascade,
  relationship_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_graph_edges_relationship_check
    check (relationship_type in ('contains', 'instance_of', 'evidenced_by', 'attached_to', 'configured_by', 'requires_source', 'located_in'))
);

create unique index if not exists asset_graph_edges_unique_idx
  on public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type);

create or replace function public.project_tiara_factory_build_asset_graph(
  p_asset_id uuid default null,
  p_hin text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset_id uuid;
  v_doc public.factory_build_documents%rowtype;
  v_line public.factory_build_line_items%rowtype;
  v_evidence_node_id uuid;
  v_system_node_id uuid;
  v_model_node_id uuid;
  v_instance_node_id uuid;
  v_option_node_id uuid;
  v_config_node_id uuid;
  v_key text;
  v_slug text;
  v_position text;
  v_idx integer;
  v_lines_projected integer := 0;
  v_projection_version text := 'tiara_factory_build_v1';
begin
  select a.id
    into v_asset_id
  from public.assets a
  where (p_asset_id is null or a.id = p_asset_id)
    and (
      p_hin is null
      or upper(a.serial_number) = upper(p_hin)
      or upper(a.kac_id) = upper(p_hin)
    )
    and a.deleted_at is null
  order by a.created_at desc
  limit 1;

  if v_asset_id is null then
    raise exception 'Asset not found for graph projection';
  end if;

  select *
    into v_doc
  from public.factory_build_documents d
  where d.asset_id = v_asset_id
  order by d.created_at desc
  limit 1;

  if v_doc.id is null then
    raise exception 'No factory build document found for asset %', v_asset_id;
  end if;

  delete from public.asset_graph_nodes n
  where n.asset_id = v_asset_id
    and n.metadata ->> 'projection_version' = v_projection_version;

  for v_line in
    select *
    from public.factory_build_line_items
    where document_id = v_doc.id
    order by line_number
  loop
    v_lines_projected := v_lines_projected + 1;
    v_slug := lower(regexp_replace(coalesce(v_line.normalized_name, v_line.factory_description, 'line-' || v_line.line_number), '[^a-zA-Z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);

    insert into public.asset_graph_nodes (
      asset_id, node_key, node_type, label, factory_line_item_id, quantity,
      factory_confirmed, manual_status, metadata
    )
    values (
      v_asset_id,
      'evidence.line.' || v_line.line_number,
      'build_evidence',
      coalesce(v_line.factory_description, 'Factory line ' || v_line.line_number),
      v_line.id,
      v_line.quantity,
      true,
      'not_applicable',
      jsonb_build_object(
        'projection_version', v_projection_version,
        'source_type', v_line.source_type,
        'source_role', v_line.source_role,
        'source_document', v_line.source_document,
        'order_number', v_line.order_number,
        'factory_item_code', v_line.factory_item_code,
        'factory_description', v_line.factory_description,
        'raw_source_text', v_line.raw_source_text,
        'relationship_type', v_line.relationship_type,
        'mapping_status', v_line.mapping_status
      )
    )
    returning id into v_evidence_node_id;

    if v_line.system_id is not null
      and v_line.system_category not in ('Deck / Cockpit', 'Interior', 'Exterior')
      and v_line.relationship_type in ('system', 'component', 'option')
    then
      insert into public.asset_graph_nodes (
        asset_id, node_key, node_type, label, system_id, criticality,
        factory_confirmed, manual_status, metadata
      )
      values (
        v_asset_id,
        'system.' || lower(regexp_replace(v_line.system_category, '[^a-zA-Z0-9]+', '-', 'g')),
        'system',
        case when v_line.system_category = 'Generator / AC Power' then 'Generator / AC Power' else v_line.system_category end,
        v_line.system_id,
        case
          when v_line.system_category in ('Propulsion', 'Steering', 'Fuel') then 'critical'
          when v_line.system_category in ('Electrical', 'Generator / AC Power', 'Stabilization', 'Navigation & Electronics') then 'high'
          else 'medium'
        end,
        true,
        coalesce(v_line.manual_status, 'missing'),
        jsonb_build_object(
          'projection_version', v_projection_version,
          'source_projection', 'factory_build_line_items',
          'system_category', v_line.system_category
        )
      )
      on conflict (asset_id, lower(node_key))
      do update
        set factory_confirmed = true,
            manual_status = case
              when public.asset_graph_nodes.manual_status = 'needs_exact_model' or excluded.manual_status = 'needs_exact_model' then 'needs_exact_model'
              when public.asset_graph_nodes.manual_status = 'missing' or excluded.manual_status = 'missing' then 'missing'
              else excluded.manual_status
            end,
            metadata = public.asset_graph_nodes.metadata || excluded.metadata,
            updated_at = now()
      returning id into v_system_node_id;

      insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
      values (v_asset_id, v_system_node_id, v_evidence_node_id, 'evidenced_by', jsonb_build_object('factory_line_number', v_line.line_number))
      on conflict do nothing;
    else
      v_system_node_id := null;
    end if;

    if v_line.factory_description ilike '%QUAD MERCURY V12 600%' then
      insert into public.asset_graph_nodes (
        asset_id, node_key, node_type, label, manufacturer, model, product_family,
        quantity, criticality, factory_confirmed, manual_status, metadata
      )
      values (
        v_asset_id,
        'component_model.mercury.v12-600',
        'component_model',
        'Mercury V12 600 outboard',
        'Mercury Marine',
        'V12 600',
        'Verado',
        4,
        'critical',
        true,
        'needs_exact_model',
        jsonb_build_object(
          'projection_version', v_projection_version,
          'manual_scope', 'component_model',
          'manuals', jsonb_build_object('owner', 'missing', 'service', 'missing', 'installation', 'optional', 'warranty', 'missing')
        )
      )
      returning id into v_model_node_id;

      if v_system_node_id is not null then
        insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
        values (v_asset_id, v_system_node_id, v_model_node_id, 'contains', '{}'::jsonb)
        on conflict do nothing;
      end if;
      insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
      values (v_asset_id, v_model_node_id, v_evidence_node_id, 'evidenced_by', jsonb_build_object('factory_line_number', v_line.line_number))
      on conflict do nothing;

      for v_idx in 1..4 loop
        v_position := case v_idx
          when 1 then 'position_unknown_1'
          when 2 then 'position_unknown_2'
          when 3 then 'position_unknown_3'
          else 'position_unknown_4'
        end;
        insert into public.asset_graph_nodes (
          asset_id, node_key, node_type, label, manufacturer, model, product_family,
          criticality, factory_confirmed, manual_status, metadata
        )
        values (
          v_asset_id,
          'component_instance.mercury-v12-600.engine-' || v_idx,
          'component_instance',
          'Mercury V12 600 engine #' || v_idx,
          'Mercury Marine',
          'V12 600',
          'Verado',
          'critical',
          true,
          'needs_exact_model',
          jsonb_build_object(
            'projection_version', v_projection_version,
            'component_model_key', 'component_model.mercury.v12-600',
            'position', v_position,
            'serial_number', 'missing',
            'warranty', 'unknown',
            'maintenance_schedule', 'pending',
            'service_history', '[]'::jsonb,
            'actions', '[]'::jsonb
          )
        )
        returning id into v_instance_node_id;

        insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
        values
          (v_asset_id, v_instance_node_id, v_model_node_id, 'instance_of', '{}'::jsonb),
          (v_asset_id, v_instance_node_id, v_evidence_node_id, 'evidenced_by', jsonb_build_object('factory_line_number', v_line.line_number));
        if v_system_node_id is not null then
          insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
          values (v_asset_id, v_system_node_id, v_instance_node_id, 'contains', jsonb_build_object('cardinality_source', 'quad'))
          on conflict do nothing;
        end if;
      end loop;
      continue;
    end if;

    if v_line.factory_description ilike '%SEAKEEPER SK10.5%' then
      insert into public.asset_graph_nodes (
        asset_id, node_key, node_type, label, manufacturer, model, product_family,
        quantity, criticality, factory_confirmed, manual_status, metadata
      )
      values (
        v_asset_id,
        'component_model.seakeeper.sk10-5',
        'component_model',
        'Seakeeper SK10.5 gyro',
        'Seakeeper',
        'SK10.5',
        'Gyro stabilizer',
        1,
        'high',
        true,
        'needs_exact_model',
        jsonb_build_object('projection_version', v_projection_version, 'manual_scope', 'component_model')
      )
      returning id into v_model_node_id;

      insert into public.asset_graph_nodes (
        asset_id, node_key, node_type, label, manufacturer, model, product_family,
        criticality, factory_confirmed, manual_status, metadata
      )
      values (
        v_asset_id,
        'component_instance.seakeeper-sk10-5.primary',
        'component_instance',
        'Seakeeper SK10.5 gyro',
        'Seakeeper',
        'SK10.5',
        'Gyro stabilizer',
        'high',
        true,
        'needs_exact_model',
        jsonb_build_object('projection_version', v_projection_version, 'serial_number', 'missing', 'warranty', 'unknown')
      )
      returning id into v_instance_node_id;

      if v_system_node_id is not null then
        insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
        values (v_asset_id, v_system_node_id, v_instance_node_id, 'contains', '{}'::jsonb)
        on conflict do nothing;
      end if;
      insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
      values
        (v_asset_id, v_instance_node_id, v_model_node_id, 'instance_of', '{}'::jsonb),
        (v_asset_id, v_model_node_id, v_evidence_node_id, 'evidenced_by', jsonb_build_object('factory_line_number', v_line.line_number)),
        (v_asset_id, v_instance_node_id, v_evidence_node_id, 'evidenced_by', jsonb_build_object('factory_line_number', v_line.line_number))
      on conflict do nothing;
      continue;
    end if;

    if v_line.relationship_type = 'component' then
      v_key := 'component_model.' || coalesce(nullif(v_line.mapping_metadata ->> 'component_key', ''), v_slug);
      insert into public.asset_graph_nodes (
        asset_id, node_key, node_type, label, system_id, manufacturer, model,
        product_family, quantity, criticality, factory_confirmed, manual_status, metadata
      )
      values (
        v_asset_id,
        v_key,
        'component_model',
        coalesce(v_line.normalized_name, v_line.factory_description),
        v_line.system_id,
        nullif(v_line.manufacturer, 'unknown'),
        nullif(v_line.model, 'unknown'),
        v_line.product_family,
        v_line.quantity,
        case when v_line.system_category in ('Generator / AC Power', 'Navigation & Electronics', 'Electrical', 'Fresh Water', 'Waste / Sanitation') then 'medium' else 'low' end,
        true,
        coalesce(v_line.manual_status, 'needs_exact_model'),
        jsonb_build_object(
          'projection_version', v_projection_version,
          'component_key', v_line.mapping_metadata ->> 'component_key',
          'manual_scope', 'component_model'
        )
      )
      returning id into v_model_node_id;

      if v_system_node_id is not null then
        insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
        values (v_asset_id, v_system_node_id, v_model_node_id, 'contains', '{}'::jsonb)
        on conflict do nothing;
      end if;
      insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
      values (v_asset_id, v_model_node_id, v_evidence_node_id, 'evidenced_by', jsonb_build_object('factory_line_number', v_line.line_number))
      on conflict do nothing;
      continue;
    end if;

    if v_line.relationship_type = 'option' then
      insert into public.asset_graph_nodes (
        asset_id, node_key, node_type, label, system_id, manufacturer, model,
        product_family, quantity, criticality, factory_confirmed, manual_status, metadata
      )
      values (
        v_asset_id,
        'option_accessory.' || v_slug,
        'option_accessory',
        coalesce(v_line.normalized_name, v_line.factory_description),
        v_line.system_id,
        nullif(v_line.manufacturer, 'unknown'),
        nullif(v_line.model, 'unknown'),
        v_line.product_family,
        v_line.quantity,
        'low',
        true,
        coalesce(v_line.manual_status, 'not_applicable'),
        jsonb_build_object(
          'projection_version', v_projection_version,
          'zones', case
            when v_line.factory_description ilike '%COCKPIT/SWIM%' then jsonb_build_array('cockpit', 'swim platform')
            when v_line.factory_description ilike '%COCKPIT%' then jsonb_build_array('cockpit')
            when v_line.factory_description ilike '%FWD%' then jsonb_build_array('forward deck')
            when v_line.factory_description ilike '%AFT%' then jsonb_build_array('aft cockpit')
            else '[]'::jsonb
          end,
          'source_relationship_type', v_line.relationship_type
        )
      )
      returning id into v_option_node_id;

      if v_system_node_id is not null then
        insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
        values (v_asset_id, v_system_node_id, v_option_node_id, 'attached_to', '{}'::jsonb)
        on conflict do nothing;
      end if;
      insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
      values (v_asset_id, v_option_node_id, v_evidence_node_id, 'evidenced_by', jsonb_build_object('factory_line_number', v_line.line_number))
      on conflict do nothing;
      continue;
    end if;

    if v_line.relationship_type = 'configuration' then
      insert into public.asset_graph_nodes (
        asset_id, node_key, node_type, label, system_id, product_family,
        quantity, criticality, factory_confirmed, manual_status, metadata
      )
      values (
        v_asset_id,
        'configuration.' || v_slug,
        'configuration',
        coalesce(v_line.normalized_name, v_line.factory_description),
        v_line.system_id,
        v_line.product_family,
        v_line.quantity,
        'low',
        true,
        'not_applicable',
        jsonb_build_object(
          'projection_version', v_projection_version,
          'zones', case
            when v_line.factory_description ilike '%COCKPIT/SWIM%' then jsonb_build_array('cockpit', 'swim platform')
            when v_line.factory_description ilike '%STB%' then jsonb_build_array('starboard')
            when v_line.factory_description ilike '%HULL%' then jsonb_build_array('hull')
            when v_line.factory_description ilike '%INTERIOR%' then jsonb_build_array('interior')
            else '[]'::jsonb
          end,
          'configuration_scope', case
            when v_line.factory_description ilike '%PAINT%' or v_line.factory_description ilike '%COLOR%' or v_line.factory_description ilike '%CLR%' then 'finish'
            when v_line.factory_description ilike '%FABRIC%' or v_line.factory_description ilike '%UPH%' then 'interior_finish'
            when v_line.factory_description ilike '%TEAK%' then 'surface'
            else 'build_configuration'
          end
        )
      )
      returning id into v_config_node_id;

      insert into public.asset_graph_edges (asset_id, from_node_id, to_node_id, relationship_type, metadata)
      values (v_asset_id, v_config_node_id, v_evidence_node_id, 'evidenced_by', jsonb_build_object('factory_line_number', v_line.line_number))
      on conflict do nothing;
      continue;
    end if;
  end loop;

  return jsonb_build_object(
    'asset_id', v_asset_id,
    'factory_build_document_id', v_doc.id,
    'projection_version', v_projection_version,
    'factory_lines_projected', v_lines_projected,
    'nodes_count', (select count(*) from public.asset_graph_nodes where asset_id = v_asset_id and metadata ->> 'projection_version' = v_projection_version),
    'edges_count', (select count(*) from public.asset_graph_edges e join public.asset_graph_nodes n on n.id = e.from_node_id where e.asset_id = v_asset_id and n.metadata ->> 'projection_version' = v_projection_version),
    'manual_queue', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'node_id', n.id,
        'node_key', n.node_key,
        'node_type', n.node_type,
        'label', n.label,
        'manufacturer', n.manufacturer,
        'model', n.model,
        'manual_status', n.manual_status,
        'instance_count', (
          select count(*)
          from public.asset_graph_edges e
          join public.asset_graph_nodes i on i.id = e.from_node_id
          where e.to_node_id = n.id
            and e.relationship_type = 'instance_of'
            and i.node_type = 'component_instance'
        )
      ) order by n.criticality, n.label), '[]'::jsonb)
      from public.asset_graph_nodes n
      where n.asset_id = v_asset_id
        and n.node_type = 'component_model'
        and n.manual_status in ('missing', 'needs_exact_model')
        and n.metadata ->> 'projection_version' = v_projection_version
    )
  );
end;
$$;

create or replace function public.get_asset_graph_projection(
  p_asset_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'asset_id', p_asset_id,
    'nodes', coalesce((
      select jsonb_agg(to_jsonb(n) order by
        case n.node_type
          when 'system' then 0
          when 'component_model' then 1
          when 'component_instance' then 2
          when 'option_accessory' then 3
          when 'configuration' then 4
          else 5
        end,
        n.label
      )
      from public.asset_graph_nodes n
      where n.asset_id = p_asset_id
    ), '[]'::jsonb),
    'edges', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.relationship_type, e.created_at)
      from public.asset_graph_edges e
      where e.asset_id = p_asset_id
    ), '[]'::jsonb)
  );
$$;

create table if not exists public.asset_graph_releases (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  release_key text not null,
  release_label text not null,
  release_status text not null default 'draft',
  projection_version text not null,
  factory_build_document_id uuid references public.factory_build_documents(id) on delete set null,
  nodes_snapshot jsonb not null default '[]'::jsonb,
  edges_snapshot jsonb not null default '[]'::jsonb,
  resources_snapshot jsonb not null default '[]'::jsonb,
  manual_queue_snapshot jsonb not null default '[]'::jsonb,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  constraint asset_graph_releases_status_check
    check (release_status in ('draft', 'published', 'superseded', 'archived'))
);

create unique index if not exists asset_graph_releases_asset_key_uidx
  on public.asset_graph_releases (asset_id, lower(release_key));

create or replace function public.create_asset_graph_release(
  p_asset_id uuid,
  p_release_key text default null,
  p_release_label text default null,
  p_release_status text default 'draft'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_release_id uuid;
  v_release_key text := lower(coalesce(nullif(trim(p_release_key), ''), 'working-' || to_char(now(), 'YYYYMMDDHH24MISS')));
  v_release_label text := coalesce(nullif(trim(p_release_label), ''), 'Working asset graph release');
  v_projection_version text := 'tiara_factory_build_v1';
  v_doc_id uuid;
  v_nodes jsonb;
  v_edges jsonb;
  v_resources jsonb;
  v_manual_queue jsonb;
begin
  select id
    into v_doc_id
  from public.factory_build_documents
  where asset_id = p_asset_id
  order by created_at desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(n) order by n.node_type, n.label), '[]'::jsonb)
    into v_nodes
  from public.asset_graph_nodes n
  where n.asset_id = p_asset_id;

  select coalesce(jsonb_agg(to_jsonb(e) order by e.relationship_type, e.created_at), '[]'::jsonb)
    into v_edges
  from public.asset_graph_edges e
  where e.asset_id = p_asset_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.applies_to_type, r.title), '[]'::jsonb)
    into v_resources
  from public.asset_resources r
  where (r.applies_to_type = 'asset' and r.applies_to_id = p_asset_id)
     or (r.metadata ->> 'asset_id') = p_asset_id::text;

  select coalesce(jsonb_agg(jsonb_build_object(
      'node_id', n.id,
      'node_key', n.node_key,
      'node_type', n.node_type,
      'label', n.label,
      'manufacturer', n.manufacturer,
      'model', n.model,
      'manual_status', n.manual_status,
      'source_release_scope', 'component_model'
    ) order by n.criticality, n.label), '[]'::jsonb)
    into v_manual_queue
  from public.asset_graph_nodes n
  where n.asset_id = p_asset_id
    and n.node_type = 'component_model'
    and n.manual_status in ('missing', 'needs_exact_model');

  insert into public.asset_graph_releases (
    asset_id,
    release_key,
    release_label,
    release_status,
    projection_version,
    factory_build_document_id,
    nodes_snapshot,
    edges_snapshot,
    resources_snapshot,
    manual_queue_snapshot,
    created_by,
    published_at,
    metadata
  )
  values (
    p_asset_id,
    v_release_key,
    v_release_label,
    coalesce(nullif(trim(p_release_status), ''), 'draft'),
    v_projection_version,
    v_doc_id,
    v_nodes,
    v_edges,
    v_resources,
    v_manual_queue,
    auth.uid(),
    case when coalesce(nullif(trim(p_release_status), ''), 'draft') = 'published' then now() else null end,
    jsonb_build_object(
      'release_contract', 'asset_graph_release_v1',
      'factory_evidence_immutable', true,
      'operational_objects_are_projection', true
    )
  )
  on conflict (asset_id, lower(release_key))
  do update
    set release_label = excluded.release_label,
        release_status = excluded.release_status,
        projection_version = excluded.projection_version,
        factory_build_document_id = excluded.factory_build_document_id,
        nodes_snapshot = excluded.nodes_snapshot,
        edges_snapshot = excluded.edges_snapshot,
        resources_snapshot = excluded.resources_snapshot,
        manual_queue_snapshot = excluded.manual_queue_snapshot,
        published_at = case when excluded.release_status = 'published' then coalesce(public.asset_graph_releases.published_at, now()) else public.asset_graph_releases.published_at end,
        metadata = public.asset_graph_releases.metadata || excluded.metadata
  returning id into v_release_id;

  return jsonb_build_object(
    'release_id', v_release_id,
    'asset_id', p_asset_id,
    'release_key', v_release_key,
    'release_status', coalesce(nullif(trim(p_release_status), ''), 'draft'),
    'nodes_count', jsonb_array_length(v_nodes),
    'edges_count', jsonb_array_length(v_edges),
    'manual_queue_count', jsonb_array_length(v_manual_queue)
  );
end;
$$;

grant select, insert, update, delete on public.asset_graph_nodes to authenticated;
grant select, insert, update, delete on public.asset_graph_edges to authenticated;
grant select, insert, update on public.asset_graph_releases to authenticated;
grant execute on function public.project_tiara_factory_build_asset_graph(uuid, text) to authenticated, service_role;
grant execute on function public.get_asset_graph_projection(uuid) to authenticated, service_role;
grant execute on function public.create_asset_graph_release(uuid, text, text, text) to authenticated, service_role;
