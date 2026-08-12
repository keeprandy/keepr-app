-- Activator authoring loop: source segments -> reviewed operational template knowledge.

create table if not exists public.asset_resource_segments (
  id uuid primary key default gen_random_uuid(),
  resource_id uuid not null references public.asset_resources(id) on delete cascade,
  segment_key text not null,
  title text not null,
  segment_type text not null default 'operational_topic',
  source_page_start integer,
  source_page_end integer,
  source_locator text,
  excerpt text,
  mapped_canonical_keys jsonb not null default '[]'::jsonb,
  proposed_payload jsonb not null default '{}'::jsonb,
  status text not null default 'review_needed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asset_resource_segments_key_uidx unique (resource_id, segment_key),
  constraint asset_resource_segments_status_check
    check (status in ('added', 'analyzing', 'review_needed', 'activated', 'superseded'))
);

create index if not exists asset_resource_segments_resource_idx
  on public.asset_resource_segments (resource_id, status);

alter table public.asset_resource_segments enable row level security;

drop policy if exists "Readable resource segments follow resource" on public.asset_resource_segments;
create policy "Readable resource segments follow resource"
  on public.asset_resource_segments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.asset_resources r
      where r.id = resource_id
        and (
          (r.applies_to_type = 'template' and public.activator_user_can_read_template(auth.uid(), r.applies_to_id))
          or ((r.metadata -> 'template_keys') ? 'tiara-2027-39-ls')
          or ((r.metadata -> 'template_keys') ? 'tiara-2027-39-le')
        )
    )
  );

drop policy if exists "Template managers manage resource segments" on public.asset_resource_segments;
create policy "Template managers manage resource segments"
  on public.asset_resource_segments
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.asset_resources r
      join public.asset_model_templates t
        on r.applies_to_type = 'template'
       and r.applies_to_id = t.id
      where r.id = resource_id
        and public.activator_user_can_manage_template(auth.uid(), t.id)
    )
  )
  with check (
    exists (
      select 1
      from public.asset_resources r
      join public.asset_model_templates t
        on r.applies_to_type = 'template'
       and r.applies_to_id = t.id
      where r.id = resource_id
        and public.activator_user_can_manage_template(auth.uid(), t.id)
    )
  );

grant select, insert, update on public.asset_resource_segments to authenticated;

create or replace function public.get_template_source_activation_workspace(
  p_template_key text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_template public.asset_model_templates%rowtype;
begin
  select *
  into v_template
  from public.asset_model_templates
  where lower(template_key) = lower(p_template_key)
  order by version desc
  limit 1;

  if v_template.id is null then
    return null;
  end if;

  if not public.activator_user_can_read_template(auth.uid(), v_template.id) then
    return null;
  end if;

  return jsonb_build_object(
    'template', jsonb_build_object(
      'id', v_template.id,
      'template_key', v_template.template_key,
      'manufacturer', v_template.manufacturer,
      'model', v_template.model,
      'model_year', v_template.model_year,
      'version', v_template.version,
      'status', v_template.status,
      'metadata', v_template.metadata
    ),
    'sources', coalesce((
      select jsonb_agg(to_jsonb(r) order by coalesce((r.metadata ->> 'sort_order')::integer, 999), r.title)
      from public.asset_resources r
      where r.resource_type in ('manual', 'oem_catalog', 'model_page')
        and (
          (r.applies_to_type = 'template' and r.applies_to_id = v_template.id)
          or ((r.metadata -> 'template_keys') ? lower(v_template.template_key))
        )
    ), '[]'::jsonb),
    'segments', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.source_page_start, s.segment_key)
      from public.asset_resource_segments s
      join public.asset_resources r on r.id = s.resource_id
      where r.metadata ->> 'document_key' = 'tiara_39ls_owners_manual_my2026'
        and (r.metadata -> 'template_keys') ? lower(v_template.template_key)
    ), '[]'::jsonb),
    'published_items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.sort_order, i.label)
      from public.asset_model_template_items i
      where i.template_id = v_template.id
        and (
          i.canonical_key like 'system.freshwater%'
          or i.canonical_key like 'knowledge.freshwater%'
          or i.canonical_key like 'playbook.freshwater%'
        )
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_template_source_activation_workspace(text) to authenticated;

create or replace function public.publish_template_freshwater_activation(
  p_template_key text,
  p_guidance jsonb default null,
  p_playbooks jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_template public.asset_model_templates%rowtype;
  v_owner_manual_id uuid;
  v_section_id uuid;
  v_system_id uuid;
  v_segment_ids jsonb;
  v_default_guidance jsonb := coalesce(p_guidance, '[
    {
      "canonical_key": "knowledge.freshwater.operation",
      "label": "Freshwater operation",
      "body": "Fill the freshwater tank through the port gunwale WATER fill until water runs from the hull-side vent. Open faucets, switch on Fresh Water Pump from the Garmin EmpirBus Systems screen, purge air until a steady stream flows, then close faucets one by one. Turn the pump off when the boat is unattended.",
      "topic_type": "operation",
      "page_start": 59,
      "page_end": 60
    },
    {
      "canonical_key": "knowledge.freshwater.water_heater",
      "label": "Water heater operation",
      "body": "The water heater is in the mechanical space. Purge all air from the heater and lines before turning on the WATER HEATER breaker on the atrium AC distribution panel. Do not energize the heater until filled and primed.",
      "topic_type": "operation",
      "page_start": 60,
      "page_end": 60
    },
    {
      "canonical_key": "knowledge.freshwater.commissioning",
      "label": "Freshwater commissioning",
      "body": "Before first use and annually at the beginning of each season, disinfect the freshwater system. Drain antifreeze, fill through the WATER fill, run the Fresh Water Pump from the Garmin EmpirBus display, circulate sanitizing solution through hot and cold taps, drain, rinse, and final-fill until flow is smooth.",
      "topic_type": "commissioning",
      "page_start": 60,
      "page_end": 62
    },
    {
      "canonical_key": "knowledge.freshwater.maintenance",
      "label": "Freshwater maintenance",
      "body": "Maintain the freshwater system by cleaning faucet filter screens, keeping the tank fresh with potable water conditioner, and turning Fresh Water Pump off when leaving the boat unattended. The system must be winterized before storage.",
      "topic_type": "maintenance",
      "page_start": 67,
      "page_end": 68
    }
  ]'::jsonb);
  v_default_playbooks jsonb := coalesce(p_playbooks, '[
    {
      "canonical_key": "playbook.freshwater_commissioning",
      "label": "Commission Freshwater System",
      "body": "Drain storage antifreeze, fill and flush the tank, sanitize with the recommended bleach solution, circulate through each hot and cold tap, drain, rinse twice, then final-fill and purge air until flow is smooth.",
      "page_start": 60,
      "page_end": 62
    },
    {
      "canonical_key": "playbook.freshwater_winterization",
      "label": "Winterize Freshwater System",
      "body": "Prepare the freshwater system for storage before winter lay-up. Follow Tiara seasonal maintenance guidance and ensure the water heater and freshwater pump are protected before storage.",
      "page_start": 59,
      "page_end": 68
    }
  ]'::jsonb);
  v_item jsonb;
begin
  select *
  into v_template
  from public.asset_model_templates
  where lower(template_key) = lower(p_template_key)
  order by version desc
  limit 1;

  if v_template.id is null then
    raise exception 'Template not found: %', p_template_key;
  end if;

  if not public.activator_user_can_manage_template(auth.uid(), v_template.id) then
    raise exception 'Not authorized to manage template %', p_template_key;
  end if;

  select id
  into v_owner_manual_id
  from public.asset_resources
  where metadata ->> 'document_key' = 'tiara_39ls_owners_manual_my2026'
  order by created_at
  limit 1;

  if v_owner_manual_id is null then
    raise exception 'Tiara owner manual resource is missing';
  end if;

  select coalesce(jsonb_agg(id), '[]'::jsonb)
  into v_segment_ids
  from public.asset_resource_segments
  where resource_id = v_owner_manual_id
    and segment_key like 'freshwater.%';

  insert into public.asset_model_template_items (
    template_id, item_type, canonical_key, label, expected_value, applicability,
    authority_state, source_resource_id, metadata, sort_order
  )
  values (
    v_template.id,
    'section',
    'brochure.plumbing_systems',
    'Plumbing Systems',
    '{}'::jsonb,
    '{}'::jsonb,
    'oem_published',
    v_owner_manual_id,
    jsonb_build_object('source_domain', 'Tiara Owner Manual Section 5', 'activation_status', 'published'),
    1450
  )
  on conflict (template_id, lower(canonical_key))
  do update set
    label = excluded.label,
    source_resource_id = excluded.source_resource_id,
    metadata = public.asset_model_template_items.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_section_id;

  insert into public.asset_model_template_items (
    template_id, parent_item_id, item_type, canonical_key, label, expected_value,
    applicability, authority_state, source_resource_id, metadata, sort_order
  )
  values (
    v_template.id,
    v_section_id,
    'system',
    'system.freshwater',
    'Freshwater System',
    jsonb_build_object(
      'summary', 'Potable water tank, distribution lines, freshwater pump, faucets, shower, and water heater context from the Tiara owner manual.'
    ),
    jsonb_build_object('standard_state', 'standard'),
    'oem_published',
    v_owner_manual_id,
    jsonb_build_object(
      'source_segment_ids', v_segment_ids,
      'manual_domain', 'Plumbing Systems 5.1-5.2',
      'activation_status', 'published'
    ),
    1451
  )
  on conflict (template_id, lower(canonical_key))
  do update set
    parent_item_id = excluded.parent_item_id,
    label = excluded.label,
    expected_value = excluded.expected_value,
    applicability = excluded.applicability,
    source_resource_id = excluded.source_resource_id,
    metadata = public.asset_model_template_items.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_system_id;

  for v_item in select * from jsonb_array_elements(v_default_guidance)
  loop
    insert into public.asset_model_template_items (
      template_id, parent_item_id, item_type, canonical_key, label, expected_value,
      applicability, authority_state, source_resource_id, metadata, sort_order
    )
    values (
      v_template.id,
      v_system_id,
      'knowledge',
      v_item ->> 'canonical_key',
      v_item ->> 'label',
      jsonb_build_object('guidance', v_item ->> 'body'),
      jsonb_build_object('standard_state', 'standard'),
      'oem_published',
      v_owner_manual_id,
      jsonb_build_object(
        'topic_type', v_item ->> 'topic_type',
        'source_page_start', (v_item ->> 'page_start')::integer,
        'source_page_end', (v_item ->> 'page_end')::integer,
        'source_segment_ids', v_segment_ids,
        'activation_status', 'published'
      ),
      case v_item ->> 'canonical_key'
        when 'knowledge.freshwater.operation' then 1452
        when 'knowledge.freshwater.water_heater' then 1453
        when 'knowledge.freshwater.commissioning' then 1454
        else 1455
      end
    )
    on conflict (template_id, lower(canonical_key))
    do update set
      parent_item_id = excluded.parent_item_id,
      label = excluded.label,
      expected_value = excluded.expected_value,
      source_resource_id = excluded.source_resource_id,
      metadata = public.asset_model_template_items.metadata || excluded.metadata,
      updated_at = now();
  end loop;

  for v_item in select * from jsonb_array_elements(v_default_playbooks)
  loop
    insert into public.asset_model_template_items (
      template_id, parent_item_id, item_type, canonical_key, label, expected_value,
      applicability, authority_state, source_resource_id, metadata, sort_order
    )
    values (
      v_template.id,
      v_system_id,
      'playbook',
      v_item ->> 'canonical_key',
      v_item ->> 'label',
      jsonb_build_object('playbook', v_item ->> 'body'),
      jsonb_build_object('standard_state', 'standard'),
      'oem_published',
      v_owner_manual_id,
      jsonb_build_object(
        'source_page_start', (v_item ->> 'page_start')::integer,
        'source_page_end', (v_item ->> 'page_end')::integer,
        'source_segment_ids', v_segment_ids,
        'activation_status', 'published'
      ),
      case v_item ->> 'canonical_key'
        when 'playbook.freshwater_commissioning' then 1456
        else 1457
      end
    )
    on conflict (template_id, lower(canonical_key))
    do update set
      parent_item_id = excluded.parent_item_id,
      label = excluded.label,
      expected_value = excluded.expected_value,
      source_resource_id = excluded.source_resource_id,
      metadata = public.asset_model_template_items.metadata || excluded.metadata,
      updated_at = now();
  end loop;

  update public.asset_resource_segments
  set status = 'activated', updated_at = now()
  where resource_id = v_owner_manual_id
    and segment_key like 'freshwater.%';

  return public.get_template_source_activation_workspace(p_template_key);
end;
$$;

grant execute on function public.publish_template_freshwater_activation(text, jsonb, jsonb) to authenticated;

do $$
declare
  v_owner_manual_id uuid;
begin
  select id
  into v_owner_manual_id
  from public.asset_resources
  where metadata ->> 'document_key' = 'tiara_39ls_owners_manual_my2026'
  order by created_at
  limit 1;

  if v_owner_manual_id is null then
    raise notice 'Skipping Freshwater source segments because Tiara owner manual resource is missing.';
    return;
  end if;

  insert into public.asset_resource_segments (
    resource_id, segment_key, title, segment_type, source_page_start, source_page_end,
    source_locator, excerpt, mapped_canonical_keys, proposed_payload, status, metadata
  )
  values
    (
      v_owner_manual_id,
      'freshwater.operation',
      'Freshwater System Operation',
      'operational_topic',
      59,
      60,
      'Owner Manual Section 5.1',
      'The freshwater system consists of a potable water tank, distribution lines, and a distribution pump. Fill through the WATER deck fill on the port gunwale, switch on Fresh Water Pump from the Garmin EmpirBus Systems screen, purge air through open faucets, and turn the pump off when unattended.',
      '["system.freshwater"]'::jsonb,
      jsonb_build_object('proposes', 'owner_guidance', 'topic_type', 'operation'),
      'review_needed',
      jsonb_build_object('manual_domain', 'Plumbing Systems')
    ),
    (
      v_owner_manual_id,
      'freshwater.water_heater',
      'Water Heater Operation',
      'operational_topic',
      60,
      60,
      'Owner Manual Section 5.1 Water Heater',
      'The water heater is located in the mechanical space. The WATER HEATER breaker on the atrium AC distribution panel must be on for use. Make sure all air is purged from the water heater and lines before activating the breaker.',
      '["system.freshwater", "component.freshwater.water_heater"]'::jsonb,
      jsonb_build_object('proposes', 'owner_guidance', 'topic_type', 'operation'),
      'review_needed',
      jsonb_build_object('manual_domain', 'Plumbing Systems')
    ),
    (
      v_owner_manual_id,
      'freshwater.commissioning',
      'Freshwater System Commissioning',
      'procedure',
      60,
      62,
      'Owner Manual Section 5.2',
      'The freshwater system must be disinfected before first use and annually at the beginning of each season. Drain antifreeze, fill the tank, circulate sanitizing solution through all taps, allow it to stand, drain, rinse, final-fill, and purge air until flow is smooth.',
      '["system.freshwater", "playbook.freshwater_commissioning"]'::jsonb,
      jsonb_build_object('proposes', 'playbook_candidate', 'topic_type', 'commissioning'),
      'review_needed',
      jsonb_build_object('manual_domain', 'Plumbing Systems')
    ),
    (
      v_owner_manual_id,
      'freshwater.maintenance',
      'Freshwater Maintenance and Seasonal Care',
      'maintenance',
      67,
      68,
      'Owner Manual Section 5.6',
      'Routine freshwater maintenance includes cleaning faucet filter screens, adding potable water conditioner as needed, and making sure the Fresh Water Pump button is off when leaving the boat unattended. The system must be winterized before storage.',
      '["system.freshwater", "playbook.freshwater_winterization"]'::jsonb,
      jsonb_build_object('proposes', 'maintenance_guidance', 'topic_type', 'maintenance'),
      'review_needed',
      jsonb_build_object('manual_domain', 'Plumbing Systems')
    )
  on conflict (resource_id, segment_key)
  do update set
    title = excluded.title,
    segment_type = excluded.segment_type,
    source_page_start = excluded.source_page_start,
    source_page_end = excluded.source_page_end,
    source_locator = excluded.source_locator,
    excerpt = excluded.excerpt,
    mapped_canonical_keys = excluded.mapped_canonical_keys,
    proposed_payload = excluded.proposed_payload,
    metadata = public.asset_resource_segments.metadata || excluded.metadata,
    updated_at = now();
end;
$$;
