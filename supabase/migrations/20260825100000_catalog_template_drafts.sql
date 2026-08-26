-- Catalog template draft primitive.
-- Sources and proposed facts can be reviewed before any canonical template rows
-- are created. Publishing only uses accepted facts.

create table if not exists public.catalog_template_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.orgs(id) on delete restrict,
  draft_key text not null,
  template_key text not null,
  status text not null default 'review',
  source_payload jsonb not null default '{}'::jsonb,
  proposed_payload jsonb not null default '{}'::jsonb,
  review_payload jsonb not null default '{}'::jsonb,
  published_template_id uuid references public.asset_model_templates(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint catalog_template_drafts_status_check
    check (status in ('review', 'published', 'rejected', 'superseded'))
);

create unique index if not exists catalog_template_drafts_org_key_uidx
  on public.catalog_template_drafts (organization_id, lower(draft_key));

alter table public.asset_model_template_items
  drop constraint if exists asset_model_template_items_type_check;

alter table public.asset_model_template_items
  add constraint asset_model_template_items_type_check
    check (item_type in (
      'section',
      'option_group',
      'option',
      'configuration_group',
      'configuration_item',
      'choice',
      'system',
      'component',
      'spec',
      'equipment',
      'resource',
      'playbook',
      'interval',
      'knowledge'
    ));

alter table public.catalog_template_drafts enable row level security;

drop policy if exists "Org members read catalog template drafts" on public.catalog_template_drafts;
create policy "Org members read catalog template drafts"
  on public.catalog_template_drafts
  for select
  using (
    exists (
      select 1
      from public.org_members om
      where om.org_id = catalog_template_drafts.organization_id
        and om.user_id = auth.uid()
    )
  );

drop policy if exists "Org members manage catalog template drafts" on public.catalog_template_drafts;
create policy "Org members manage catalog template drafts"
  on public.catalog_template_drafts
  for all
  using (
    exists (
      select 1
      from public.org_members om
      where om.org_id = catalog_template_drafts.organization_id
        and om.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.org_members om
      where om.org_id = catalog_template_drafts.organization_id
        and om.user_id = auth.uid()
    )
  );

create or replace function public.publish_catalog_template_draft(
  p_organization_id uuid,
  p_template_key text,
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_draft jsonb := coalesce(p_payload -> 'draft', '{}'::jsonb);
  v_facts jsonb := coalesce(p_payload -> 'approved_facts', '[]'::jsonb);
  v_systems jsonb := coalesce(p_payload -> 'approved_systems', '[]'::jsonb);
  v_configuration_groups jsonb := coalesce(p_payload -> 'approved_configuration_groups', '[]'::jsonb);
  v_fact jsonb;
  v_system jsonb;
  v_configuration_group jsonb;
  v_configuration_item jsonb;
  v_template_id uuid;
  v_source_id uuid;
  v_section_id uuid;
  v_system_section_id uuid;
  v_configuration_section_id uuid;
  v_configuration_group_id uuid;
  v_group_key text;
  v_item_key text;
  v_model_year integer;
  v_manufacturer text;
  v_model text;
begin
  if p_organization_id is null then
    raise exception 'organization_id is required';
  end if;

  if nullif(trim(p_template_key), '') is null then
    raise exception 'template_key is required';
  end if;

  select nullif(fact ->> 'proposed_value', '')
    into v_manufacturer
  from jsonb_array_elements(v_facts) as fact
  where fact ->> 'destination' = 'asset_model_templates.manufacturer'
  limit 1;

  select nullif(fact ->> 'proposed_value', '')
    into v_model
  from jsonb_array_elements(v_facts) as fact
  where fact ->> 'destination' = 'asset_model_templates.model'
  limit 1;

  select nullif(fact ->> 'proposed_value', '')::integer
    into v_model_year
  from jsonb_array_elements(v_facts) as fact
  where fact ->> 'destination' = 'asset_model_templates.model_year'
  limit 1;

  v_manufacturer := coalesce(v_manufacturer, nullif(v_draft #>> '{template,manufacturer}', ''));
  v_model := coalesce(v_model, nullif(v_draft #>> '{template,model}', ''));
  v_model_year := coalesce(v_model_year, nullif(v_draft #>> '{template,model_year}', '')::integer);

  if v_manufacturer is null or v_model is null or v_model_year is null then
    raise exception 'manufacturer, model, and model_year must be accepted or supplied before publishing a template draft';
  end if;

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
    metadata,
    created_by
  )
  values (
    coalesce(nullif(coalesce((v_draft -> 'sources' -> 0) ->> 'source_type', ''), ''), 'model_page'),
    coalesce(nullif(coalesce((v_draft -> 'sources' -> 0) ->> 'title', ''), ''), 'Catalog source'),
    nullif((v_draft -> 'sources' -> 0) ->> 'url', ''),
    coalesce(nullif(coalesce((v_draft -> 'sources' -> 0) ->> 'title', ''), ''), 'Catalog source'),
    'web',
    nullif((v_draft -> 'sources' -> 0) ->> 'url', ''),
    now(),
    coalesce(nullif(coalesce((v_draft -> 'sources' -> 0) ->> 'authority_state', ''), ''), 'source_reported'),
    coalesce(nullif(coalesce((v_draft -> 'sources' -> 0) ->> 'rights_status', ''), ''), 'review_permission'),
    'template',
    jsonb_build_object(
      'draft_key', v_draft ->> 'draft_key',
      'source_id', (v_draft -> 'sources' -> 0) ->> 'id',
      'source_type', (v_draft -> 'sources' -> 0) ->> 'source_type',
      'all_sources', coalesce(v_draft -> 'sources', '[]'::jsonb),
      'provenance_contract', jsonb_build_object(
        'field_level_source_ids', true,
        'oem_vocabulary_preserved', true,
        'unmapped_configuration_items_allowed', true
      )
    ),
    auth.uid()
  )
  returning id into v_source_id;

  insert into public.asset_model_templates (
    organization_id,
    asset_type,
    category,
    class,
    manufacturer,
    model,
    model_year,
    model_year_start,
    model_year_end,
    template_key,
    version,
    status,
    authority_state,
    source_resource_id,
    metadata,
    created_by
  )
  values (
    p_organization_id,
    'boat',
    'marine',
    'luxury_sport',
    v_manufacturer,
    v_model,
    v_model_year,
    v_model_year,
    v_model_year,
    p_template_key,
    1,
    'published',
    'oem_published',
    v_source_id,
    jsonb_build_object(
      'source', 'catalog_template_draft_publish',
      'draft_key', v_draft ->> 'draft_key',
      'story_summary', (
        select fact -> 'proposed_value'
        from jsonb_array_elements(v_facts) as fact
        where fact ->> 'destination' = 'asset_model_templates.metadata.story_summary'
        limit 1
      ),
      'review_summary', p_payload -> 'review_summary'
    ),
    auth.uid()
  )
  on conflict (lower(template_key), version)
  do update set
    manufacturer = excluded.manufacturer,
    model = excluded.model,
    model_year = excluded.model_year,
    status = 'published',
    authority_state = 'oem_published',
    source_resource_id = coalesce(excluded.source_resource_id, public.asset_model_templates.source_resource_id),
    metadata = public.asset_model_templates.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_template_id;

  update public.asset_resources
  set applies_to_id = v_template_id,
      updated_at = now()
  where id = v_source_id;

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
    'section',
    'section.specifications',
    'Specifications',
    '{}'::jsonb,
    jsonb_build_object('standard_state', 'model_expected'),
    'oem_published',
    v_source_id,
    jsonb_build_object('source', 'catalog_template_draft_publish'),
    10
  )
  on conflict (template_id, lower(canonical_key))
  do update set updated_at = now()
  returning id into v_section_id;

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
    'section',
    'section.systems',
    'Systems',
    '{}'::jsonb,
    jsonb_build_object('standard_state', 'model_expected'),
    'oem_published',
    v_source_id,
    jsonb_build_object('source', 'catalog_template_draft_publish'),
    50
  )
  on conflict (template_id, lower(canonical_key))
  do update set updated_at = now()
  returning id into v_system_section_id;

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
    'section',
    'section.configuration',
    'Configuration',
    '{}'::jsonb,
    jsonb_build_object('standard_state', 'model_expected'),
    'oem_published',
    v_source_id,
    jsonb_build_object(
      'source', 'catalog_template_draft_publish',
      'purpose', 'source_backed_oem_configuration'
    ),
    30
  )
  on conflict (template_id, lower(canonical_key))
  do update set updated_at = now()
  returning id into v_configuration_section_id;

  for v_fact in
    select fact
    from jsonb_array_elements(v_facts) as fact
    where fact ->> 'destination' like 'asset_model_template_items.spec.%'
  loop
    insert into public.asset_model_template_items (
      template_id,
      parent_item_id,
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
      v_section_id,
      'spec',
      replace(v_fact ->> 'destination', 'asset_model_template_items.', ''),
      coalesce(nullif(v_fact ->> 'label', ''), replace(v_fact ->> 'destination', 'asset_model_template_items.spec.', '')),
      v_fact -> 'proposed_value',
      jsonb_build_object('standard_state', 'model_expected'),
      'oem_published',
      v_source_id,
      jsonb_build_object(
        'source', 'catalog_template_draft_publish',
        'draft_fact_id', v_fact ->> 'id',
        'confidence', v_fact -> 'confidence',
        'evidence', v_fact ->> 'evidence'
      ),
      20
    )
    on conflict (template_id, lower(canonical_key))
    do update set
      label = excluded.label,
      expected_value = excluded.expected_value,
      metadata = public.asset_model_template_items.metadata || excluded.metadata,
      updated_at = now();
  end loop;

  for v_system in select system from jsonb_array_elements(v_systems) as system
  loop
    insert into public.asset_model_template_items (
      template_id,
      parent_item_id,
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
      v_system_section_id,
      'system',
      'system.' || lower(regexp_replace(coalesce(v_system ->> 'name', 'system'), '[^a-zA-Z0-9]+', '_', 'g')),
      coalesce(v_system ->> 'name', 'System'),
      jsonb_build_object('component_models', coalesce(v_system -> 'component_models', '[]'::jsonb)),
      jsonb_build_object('standard_state', 'model_expected'),
      'oem_published',
      v_source_id,
      jsonb_build_object(
        'source', 'catalog_template_draft_publish',
        'draft_system_id', v_system ->> 'id',
        'confidence', v_system -> 'confidence'
      ),
      50
    )
    on conflict (template_id, lower(canonical_key))
    do update set
      label = excluded.label,
      expected_value = excluded.expected_value,
      metadata = public.asset_model_template_items.metadata || excluded.metadata,
      updated_at = now();
  end loop;

  for v_configuration_group in
    select value
    from jsonb_array_elements(v_configuration_groups) as group_value(value)
  loop
    v_group_key := 'configuration_group.' || lower(regexp_replace(coalesce(v_configuration_group ->> 'oem_group_name', v_configuration_group ->> 'label', 'group'), '[^a-zA-Z0-9]+', '_', 'g'));

    insert into public.asset_model_template_items (
      template_id,
      parent_item_id,
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
      v_configuration_section_id,
      'configuration_group',
      v_group_key,
      coalesce(v_configuration_group ->> 'label', v_configuration_group ->> 'oem_group_name', 'Configuration Group'),
      jsonb_build_object(
        'oem_group_name', coalesce(v_configuration_group ->> 'oem_group_name', v_configuration_group ->> 'label'),
        'item_count', jsonb_array_length(coalesce(v_configuration_group -> 'items', '[]'::jsonb))
      ),
      jsonb_build_object('standard_state', 'model_expected'),
      'oem_published',
      v_source_id,
      jsonb_build_object(
        'source', 'catalog_template_draft_publish',
        'draft_group_id', v_configuration_group ->> 'id',
        'source_ids', coalesce(v_configuration_group -> 'source_ids', '[]'::jsonb),
        'confidence', v_configuration_group -> 'confidence',
        'oem_group_name', coalesce(v_configuration_group ->> 'oem_group_name', v_configuration_group ->> 'label'),
        'oem_vocabulary_preserved', true
      ),
      30
    )
    on conflict (template_id, lower(canonical_key))
    do update set
      label = excluded.label,
      expected_value = excluded.expected_value,
      metadata = public.asset_model_template_items.metadata || excluded.metadata,
      updated_at = now()
    returning id into v_configuration_group_id;

    for v_configuration_item in
      select value
      from jsonb_array_elements(coalesce(v_configuration_group -> 'items', '[]'::jsonb)) as item_value(value)
    loop
      v_item_key := v_group_key || '.' || lower(regexp_replace(coalesce(v_configuration_item ->> 'oem_item_code', v_configuration_item ->> 'oem_item_name', v_configuration_item ->> 'label', v_configuration_item ->> 'id', 'item'), '[^a-zA-Z0-9]+', '_', 'g'));

      insert into public.asset_model_template_items (
        template_id,
        parent_item_id,
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
        v_configuration_group_id,
        'configuration_item',
        v_item_key,
        coalesce(v_configuration_item ->> 'label', v_configuration_item ->> 'oem_item_name', 'Configuration Item'),
        jsonb_build_object(
          'value', coalesce(v_configuration_item -> 'value', 'null'::jsonb),
          'quantity', coalesce(v_configuration_item -> 'quantity', '1'::jsonb),
          'price', coalesce(v_configuration_item -> 'price', 'null'::jsonb),
          'selection_state', coalesce(v_configuration_item ->> 'selection_state', 'model_expected')
        ),
        jsonb_build_object(
          'standard_state', coalesce(v_configuration_item ->> 'selection_state', 'model_expected'),
          'mapping_status', coalesce(v_configuration_item ->> 'mapping_status', 'unmapped')
        ),
        'oem_published',
        v_source_id,
        jsonb_build_object(
          'source', 'catalog_template_draft_publish',
          'draft_item_id', v_configuration_item ->> 'id',
          'source_ids', coalesce(v_configuration_item -> 'source_ids', '[]'::jsonb),
          'confidence', v_configuration_item -> 'confidence',
          'oem_group_name', coalesce(v_configuration_group ->> 'oem_group_name', v_configuration_group ->> 'label'),
          'oem_item_name', coalesce(v_configuration_item ->> 'oem_item_name', v_configuration_item ->> 'label'),
          'oem_item_code', v_configuration_item ->> 'oem_item_code',
          'mapping_status', coalesce(v_configuration_item ->> 'mapping_status', 'unmapped'),
          'knowledge_node', coalesce(v_configuration_item -> 'knowledge_node', 'null'::jsonb),
          'can_remain_unmapped', true,
          'oem_vocabulary_preserved', true
        ),
        31
      )
      on conflict (template_id, lower(canonical_key))
      do update set
        label = excluded.label,
        expected_value = excluded.expected_value,
        applicability = excluded.applicability,
        metadata = public.asset_model_template_items.metadata || excluded.metadata,
        updated_at = now();
    end loop;
  end loop;

  insert into public.catalog_template_drafts (
    organization_id,
    draft_key,
    template_key,
    status,
    source_payload,
    proposed_payload,
    review_payload,
    published_template_id,
    created_by
  )
  values (
    p_organization_id,
    coalesce(v_draft ->> 'draft_key', p_template_key),
    p_template_key,
    'published',
    coalesce(v_draft -> 'sources', '[]'::jsonb),
    p_payload,
    jsonb_build_object(
      'approved_facts', v_facts,
      'approved_systems', v_systems,
      'approved_configuration_groups', v_configuration_groups
    ),
    v_template_id,
    auth.uid()
  )
  on conflict (organization_id, lower(draft_key))
  do update set
    status = 'published',
    proposed_payload = excluded.proposed_payload,
    review_payload = excluded.review_payload,
    published_template_id = excluded.published_template_id,
    updated_at = now();

  return jsonb_build_object(
    'ok', true,
    'template_id', v_template_id,
    'template_key', p_template_key,
    'published_facts', jsonb_array_length(v_facts),
    'published_systems', jsonb_array_length(v_systems),
    'published_configuration_groups', jsonb_array_length(v_configuration_groups),
    'published_configuration_items', (
      select coalesce(sum(jsonb_array_length(coalesce(value -> 'items', '[]'::jsonb))), 0)
      from jsonb_array_elements(v_configuration_groups) as group_value(value)
    )
  );
end;
$$;

grant execute on function public.publish_catalog_template_draft(uuid, text, jsonb) to authenticated;
