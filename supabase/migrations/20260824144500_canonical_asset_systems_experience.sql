-- Canonical asset systems experience V1.
--
-- The immutable source remains factory_build_line_items. This layer exposes the
-- operational graph as the shared Systems experience for OEM, dealer/service,
-- and owner projections without creating role-specific data models.

create table if not exists public.asset_graph_instance_state (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references public.assets(id) on delete cascade,
  graph_node_id uuid not null references public.asset_graph_nodes(id) on delete cascade,
  serial_number text,
  position text,
  install_date date,
  warranty_state text not null default 'unknown',
  warranty_expires_at date,
  maintenance_schedule_state text not null default 'pending',
  service_history jsonb not null default '[]'::jsonb,
  open_actions jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_graph_instance_state_unique_node unique (graph_node_id),
  constraint asset_graph_instance_state_warranty_check
    check (warranty_state in ('unknown', 'active', 'expired', 'needs_registration', 'transferred', 'not_applicable')),
  constraint asset_graph_instance_state_maintenance_check
    check (maintenance_schedule_state in ('pending', 'active', 'needs_interval', 'not_applicable'))
);

create index if not exists asset_graph_instance_state_asset_idx
  on public.asset_graph_instance_state (asset_id);

create or replace function public.ensure_asset_graph_instance_state(
  p_asset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inserted integer := 0;
begin
  insert into public.asset_graph_instance_state (
    asset_id,
    graph_node_id,
    serial_number,
    position,
    warranty_state,
    maintenance_schedule_state,
    service_history,
    open_actions,
    metadata
  )
  select
    n.asset_id,
    n.id,
    nullif(n.metadata ->> 'serial_number', 'missing'),
    nullif(n.metadata ->> 'position', ''),
    coalesce(nullif(n.metadata ->> 'warranty', ''), 'unknown'),
    coalesce(nullif(n.metadata ->> 'maintenance_schedule', ''), 'pending'),
    coalesce(n.metadata -> 'service_history', '[]'::jsonb),
    coalesce(n.metadata -> 'actions', '[]'::jsonb),
    jsonb_build_object(
      'source', 'asset_graph_projection',
      'projection_node_key', n.node_key,
      'factory_confirmed', n.factory_confirmed
    )
  from public.asset_graph_nodes n
  where n.asset_id = p_asset_id
    and n.node_type = 'component_instance'
  on conflict (graph_node_id)
  do update
    set position = coalesce(public.asset_graph_instance_state.position, excluded.position),
        warranty_state = coalesce(public.asset_graph_instance_state.warranty_state, excluded.warranty_state),
        maintenance_schedule_state = coalesce(public.asset_graph_instance_state.maintenance_schedule_state, excluded.maintenance_schedule_state),
        updated_at = now();

  get diagnostics v_inserted = row_count;

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'instance_state_rows_touched', v_inserted
  );
end;
$$;

create or replace function public.get_asset_graph_node_evidence(
  p_node_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'graph_node_id', evidence.id,
    'factory_line_item_id', li.id,
    'line_number', li.line_number,
    'source_type', li.source_type,
    'source_role', li.source_role,
    'source_document', li.source_document,
    'order_number', li.order_number,
    'order_date', li.order_date,
    'hull_number', li.hull_number,
    'hin', li.hin,
    'factory_item_code', li.factory_item_code,
    'factory_description', li.factory_description,
    'quantity', li.quantity,
    'factory_section', li.factory_section,
    'raw_source_text', li.raw_source_text,
    'mapping_status', li.mapping_status,
    'mapping_confidence', li.mapping_confidence,
    'relationship_type', li.relationship_type
  ) order by li.line_number), '[]'::jsonb)
  from public.asset_graph_edges edge
  join public.asset_graph_nodes evidence
    on evidence.id = edge.to_node_id
   and evidence.node_type = 'build_evidence'
  left join public.factory_build_line_items li
    on li.id = evidence.factory_line_item_id
  where edge.from_node_id = p_node_id
    and edge.relationship_type = 'evidenced_by';
$$;

create or replace function public.get_asset_graph_node_resources(
  p_node_id uuid,
  p_node_key text
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(r) order by r.resource_type, r.title), '[]'::jsonb)
  from public.asset_resources r
  where (
      r.applies_to_id = p_node_id
      and r.applies_to_type in ('component', 'system')
    )
    or r.metadata ->> 'target_node_key' = p_node_key
    or r.metadata ->> 'component_model_key' = p_node_key
    or r.metadata ->> 'normalization_key' = p_node_key
    or r.metadata ->> 'canonical_model_key' = p_node_key;
$$;

create or replace function public.get_asset_systems_experience(
  p_asset_id uuid,
  p_role text default 'owner'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_role text := lower(coalesce(nullif(p_role, ''), 'owner'));
  v_template_id uuid;
  v_template_key text;
  v_systems jsonb := '[]'::jsonb;
  v_configurations jsonb := '[]'::jsonb;
  v_asset_resources jsonb := '[]'::jsonb;
  v_template_resources jsonb := '[]'::jsonb;
  v_manual_queue jsonb := '[]'::jsonb;
begin
  if v_role not in ('oem', 'dealer', 'service', 'owner') then
    v_role := 'owner';
  end if;

  select *
    into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null
  limit 1;

  if v_asset.id is null then
    return null;
  end if;

  select b.template_id, t.template_key
    into v_template_id, v_template_key
  from public.asset_template_bindings b
  join public.asset_model_templates t
    on t.id = b.template_id
  where b.asset_id = p_asset_id
    and b.binding_status in ('suggested', 'inherited', 'verified')
  order by case b.binding_status when 'verified' then 0 when 'inherited' then 1 else 2 end, b.created_at desc
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.resource_type, r.title), '[]'::jsonb)
    into v_asset_resources
  from public.asset_resources r
  where r.applies_to_type = 'asset'
    and r.applies_to_id = p_asset_id;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.resource_type, r.title), '[]'::jsonb)
    into v_template_resources
  from public.asset_resources r
  where v_template_id is not null
    and r.applies_to_type = 'template'
    and r.applies_to_id = v_template_id;

  with system_nodes as (
    select n.*
    from public.asset_graph_nodes n
    where n.asset_id = p_asset_id
      and n.node_type = 'system'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', s.system_id,
    'system_id', s.system_id,
    'graph_node_id', s.id,
    'node_key', s.node_key,
    'name', s.label,
    'system_type', 'operational_graph',
    'lifecycle_status', 'active',
    'criticality', s.criticality,
    'factory_confirmed', s.factory_confirmed,
    'manual_status', s.manual_status,
    'presentation_role', v_role,
    'capabilities', case
      when v_role = 'oem' then jsonb_build_array('factory_evidence', 'build_codes', 'installed_equipment', 'manual_readiness', 'warranty_context', 'fleet_visibility')
      when v_role in ('dealer', 'service') then jsonb_build_array('installed_equipment', 'manuals', 'serial_numbers', 'maintenance_intervals', 'service_history', 'warranty', 'actions')
      else jsonb_build_array('plain_language_systems', 'installed_equipment', 'manuals', 'warranty', 'maintenance', 'service_history', 'actions', 'story')
    end,
    'components', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', model.id,
        'graph_node_id', model.id,
        'node_key', model.node_key,
        'node_type', model.node_type,
        'label', model.label,
        'manufacturer', model.manufacturer,
        'model', model.model,
        'product_family', model.product_family,
        'quantity', model.quantity,
        'factory_confirmed', model.factory_confirmed,
        'manual_status', model.manual_status,
        'manual_scope', coalesce(model.metadata ->> 'manual_scope', 'component_model'),
        'resource_requirements', coalesce(model.metadata -> 'manuals', '{}'::jsonb),
        'resources', public.get_asset_graph_node_resources(model.id, model.node_key),
        'evidence', public.get_asset_graph_node_evidence(model.id),
        'instances', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', inst.id,
            'graph_node_id', inst.id,
            'node_key', inst.node_key,
            'label', inst.label,
            'manufacturer', inst.manufacturer,
            'model', inst.model,
            'factory_confirmed', inst.factory_confirmed,
            'manual_status', inst.manual_status,
            'resources', public.get_asset_graph_node_resources(inst.id, inst.node_key),
            'state', jsonb_build_object(
              'serial_number', coalesce(state.serial_number, nullif(inst.metadata ->> 'serial_number', 'missing'), 'missing'),
              'position', coalesce(state.position, inst.metadata ->> 'position'),
              'install_date', state.install_date,
              'warranty_state', coalesce(state.warranty_state, nullif(inst.metadata ->> 'warranty', ''), 'unknown'),
              'warranty_expires_at', state.warranty_expires_at,
              'maintenance_schedule_state', coalesce(state.maintenance_schedule_state, nullif(inst.metadata ->> 'maintenance_schedule', ''), 'pending'),
              'service_history', coalesce(state.service_history, inst.metadata -> 'service_history', '[]'::jsonb),
              'open_actions', coalesce(state.open_actions, inst.metadata -> 'actions', '[]'::jsonb)
            ),
            'evidence', public.get_asset_graph_node_evidence(inst.id)
          ) order by inst.label)
          from public.asset_graph_edges inst_edge
          join public.asset_graph_nodes inst
            on inst.id = inst_edge.from_node_id
           and inst.node_type = 'component_instance'
          left join public.asset_graph_instance_state state
            on state.graph_node_id = inst.id
          where inst_edge.to_node_id = model.id
            and inst_edge.relationship_type = 'instance_of'
        ), '[]'::jsonb)
      ) order by model.label)
      from public.asset_graph_edges model_edge
      join public.asset_graph_nodes model
        on model.id = model_edge.to_node_id
       and model.node_type = 'component_model'
      where model_edge.from_node_id = s.id
        and model_edge.relationship_type = 'contains'
    ), '[]'::jsonb),
    'standalone_instances', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', inst.id,
        'graph_node_id', inst.id,
        'node_key', inst.node_key,
        'label', inst.label,
        'manufacturer', inst.manufacturer,
        'model', inst.model,
        'factory_confirmed', inst.factory_confirmed,
        'manual_status', inst.manual_status,
        'state', jsonb_build_object(
          'serial_number', coalesce(state.serial_number, nullif(inst.metadata ->> 'serial_number', 'missing'), 'missing'),
          'position', coalesce(state.position, inst.metadata ->> 'position'),
          'warranty_state', coalesce(state.warranty_state, nullif(inst.metadata ->> 'warranty', ''), 'unknown'),
          'maintenance_schedule_state', coalesce(state.maintenance_schedule_state, nullif(inst.metadata ->> 'maintenance_schedule', ''), 'pending')
        ),
        'evidence', public.get_asset_graph_node_evidence(inst.id)
      ) order by inst.label)
      from public.asset_graph_edges inst_edge
      join public.asset_graph_nodes inst
        on inst.id = inst_edge.to_node_id
       and inst.node_type = 'component_instance'
      left join public.asset_graph_instance_state state
        on state.graph_node_id = inst.id
      where inst_edge.from_node_id = s.id
        and inst_edge.relationship_type = 'contains'
        and not exists (
          select 1
          from public.asset_graph_edges model_edge
          where model_edge.from_node_id = inst.id
            and model_edge.relationship_type = 'instance_of'
        )
    ), '[]'::jsonb),
    'options', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', opt.id,
        'graph_node_id', opt.id,
        'node_key', opt.node_key,
        'label', opt.label,
        'quantity', opt.quantity,
        'zones', coalesce(opt.metadata -> 'zones', '[]'::jsonb),
        'factory_confirmed', opt.factory_confirmed,
        'resources', public.get_asset_graph_node_resources(opt.id, opt.node_key),
        'evidence', public.get_asset_graph_node_evidence(opt.id)
      ) order by opt.label)
      from public.asset_graph_edges opt_edge
      join public.asset_graph_nodes opt
        on opt.id = opt_edge.to_node_id
       and opt.node_type = 'option_accessory'
      where opt_edge.from_node_id = s.id
        and opt_edge.relationship_type in ('attached_to', 'contains')
    ), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(distinct resource_item.resource)
      from (
        select jsonb_array_elements(public.get_asset_graph_node_resources(s.id, s.node_key)) as resource
        union all
        select jsonb_array_elements(public.get_asset_graph_node_resources(child.id, child.node_key)) as resource
        from public.asset_graph_edges child_edge
        join public.asset_graph_nodes child
          on child.id = child_edge.to_node_id
        where child_edge.from_node_id = s.id
          and child_edge.relationship_type in ('contains', 'attached_to')
      ) resource_item
    ), '[]'::jsonb),
    'evidence', public.get_asset_graph_node_evidence(s.id)
  ) order by
    case s.criticality when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end,
    s.label), '[]'::jsonb)
    into v_systems
  from system_nodes s;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', n.id,
    'graph_node_id', n.id,
    'node_key', n.node_key,
    'label', n.label,
    'configuration_scope', n.metadata ->> 'configuration_scope',
    'zones', coalesce(n.metadata -> 'zones', '[]'::jsonb),
    'factory_confirmed', n.factory_confirmed,
    'evidence', public.get_asset_graph_node_evidence(n.id)
  ) order by n.label), '[]'::jsonb)
    into v_configurations
  from public.asset_graph_nodes n
  where n.asset_id = p_asset_id
    and n.node_type = 'configuration';

  select coalesce(jsonb_agg(jsonb_build_object(
    'node_id', n.id,
    'node_key', n.node_key,
    'node_type', n.node_type,
    'label', n.label,
    'manufacturer', n.manufacturer,
    'model', n.model,
    'manual_status', n.manual_status,
    'resource_requirements', coalesce(n.metadata -> 'manuals', '{}'::jsonb),
    'attachment_target', case
      when n.node_type = 'component_model' then 'component_model'
      when n.node_type = 'component_instance' then 'component_instance'
      else n.node_type
    end
  ) order by n.label), '[]'::jsonb)
    into v_manual_queue
  from public.asset_graph_nodes n
  where n.asset_id = p_asset_id
    and n.node_type in ('component_model', 'system')
    and n.manual_status in ('missing', 'needs_exact_model');

  return jsonb_build_object(
    'asset_id', p_asset_id,
    'kac_id', v_asset.kac_id,
    'template_key', v_template_key,
    'projection_contract', 'canonical_asset_systems_experience_v1',
    'role', v_role,
    'source_graph', jsonb_build_object(
      'node_table', 'asset_graph_nodes',
      'edge_table', 'asset_graph_edges',
      'factory_evidence_table', 'factory_build_line_items',
      'factory_evidence_immutable', true,
      'operational_objects_are_projection', true
    ),
    'systems', v_systems,
    'configurations', v_configurations,
    'asset_resources', v_asset_resources,
    'template_resources', v_template_resources,
    'manual_queue', v_manual_queue,
    'resource_inheritance', jsonb_build_object(
      'template_to_asset', 'template_resources surface on the asset and its Story',
      'component_model_to_instances', 'component model resources are inherited by installed instances',
      'asset_specific', 'work order, warranty, service evidence, serials, and history stay on the asset or component instance',
      'system_surface', 'systems surface inherited child resources without becoming the canonical attachment target'
    )
  );
end;
$$;

grant select, insert, update on public.asset_graph_instance_state to authenticated;
grant execute on function public.ensure_asset_graph_instance_state(uuid) to authenticated, service_role;
grant execute on function public.get_asset_graph_node_evidence(uuid) to authenticated, service_role;
grant execute on function public.get_asset_graph_node_resources(uuid, text) to authenticated, service_role;
grant execute on function public.get_asset_systems_experience(uuid, text) to authenticated, service_role;
