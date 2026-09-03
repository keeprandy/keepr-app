-- Productize Tiara 56LS/KF018 into the generic model-template -> exact-build
-- -> KAC path. This is staging/demo data normalization, not runtime branching.

do $$
declare
  v_tiara_org_id uuid;
  v_template_id uuid;
  v_asset_id uuid;
  v_source_resource_id uuid;
  v_draft_id uuid;
  v_actor_id uuid;
  v_system record;
begin
  select id
  into v_tiara_org_id
  from public.orgs
  where id = '5c864cc2-87a5-4d29-b539-ebf4464a1a90'::uuid
     or lower(coalesce(slug, '')) in ('tiara', 'tiara-yachts')
     or lower(coalesce(name, display_name, '')) like '%tiara%'
  order by case when id = '5c864cc2-87a5-4d29-b539-ebf4464a1a90'::uuid then 0 else 1 end
  limit 1;

  if v_tiara_org_id is null then
    raise notice 'Skipping Tiara 56LS/KF018 generic normalization: Tiara org not found.';
    return;
  end if;

  select id
  into v_actor_id
  from public.profiles
  where lower(coalesce(email, '')) in ('tiara@keeprhome.com', 'adrake@keeprhome.com')
  order by case when lower(coalesce(email, '')) = 'tiara@keeprhome.com' then 0 else 1 end
  limit 1;

  select id
  into v_template_id
  from public.asset_model_templates
  where lower(template_key) = 'tiara-2027-56-ls'
  order by version desc
  limit 1;

  if v_template_id is null then
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
      metadata,
      created_by
    )
    values (
      v_tiara_org_id,
      'boat',
      'marine',
      'luxury_sport_yacht',
      'Tiara Yachts',
      '56 LS',
      2027,
      2027,
      2027,
      'tiara-2027-56-ls',
      1,
      'published',
      'oem_published',
      jsonb_build_object(
        'source', 'generic_kf018_normalization',
        'source_kac_id', 'KAC-TIARA-56LS-KF018',
        'source_role', 'reusable_model_dna',
        'presentation', jsonb_build_object(
          'headline', 'MY2027 Tiara Yachts 56 LS',
          'subtitle', 'Reusable model DNA normalized from KF018 source-backed factory build state.'
        )
      ),
      v_actor_id
    )
    returning id into v_template_id;
  else
    update public.asset_model_templates
    set
      status = case when status = 'draft' then 'published' else status end,
      authority_state = case when authority_state = 'imported' then 'oem_published' else authority_state end,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'source', coalesce(metadata ->> 'source', 'generic_kf018_normalization'),
        'source_kac_id', 'KAC-TIARA-56LS-KF018',
        'source_role', 'reusable_model_dna',
        'generic_exact_build_path', true
      ),
      updated_at = now()
    where id = v_template_id;
  end if;

  for v_system in
    select *
    from (
      values
        ('system.generator.onan_13_5kw', 'Onan 13.5kW Generator', 'Electrical', 'Onan', '13.5kW Generator', 'standard', 10),
        ('system.stabilization.seakeeper_sk10_5', 'Seakeeper SK10.5', 'Stabilization', 'Seakeeper', 'SK10.5', 'standard', 20),
        ('system.hvac.dometic', 'Dometic HVAC', 'HVAC', 'Dometic', 'HVAC', 'standard', 30),
        ('system.sanitation.vacuflush', 'VacuFlush / Sanitation', 'Waste / Sanitation', 'VacuFlush', 'Sanitation system', 'standard', 40),
        ('system.electronics.garmin', 'Garmin electronics', 'Helm & Electronics', 'Garmin', 'Electronics package', 'standard', 50),
        ('system.sanitation.head_macerator', 'Head Macerator System', 'Waste / Sanitation', 'Head', 'Macerator System', 'standard', 60)
    ) as s(canonical_key, label, system_category, manufacturer, model, standard_state, sort_order)
  loop
    insert into public.asset_model_template_items (
      template_id,
      item_type,
      canonical_key,
      label,
      expected_value,
      applicability,
      authority_state,
      metadata,
      sort_order
    )
    values (
      v_template_id,
      'system',
      v_system.canonical_key,
      v_system.label,
      jsonb_build_object(
        'system_category', v_system.system_category,
        'manufacturer', v_system.manufacturer,
        'model', v_system.model,
        'quantity', 1
      ),
      jsonb_build_object(
        'scope', 'model_template',
        'standard_state', v_system.standard_state,
        'active', true
      ),
      'oem_published',
      jsonb_build_object(
        'source', 'generic_kf018_normalization',
        'source_role', 'reusable_model_dna',
        'projection', jsonb_build_object(
          'kind', 'system',
          'mapping_status', 'mapped',
          'name', v_system.label,
          'group', v_system.system_category,
          'quantity', 1
        )
      ),
      v_system.sort_order
    )
    on conflict (template_id, lower(canonical_key)) do update
    set
      item_type = excluded.item_type,
      label = excluded.label,
      expected_value = coalesce(public.asset_model_template_items.expected_value, '{}'::jsonb) || excluded.expected_value,
      applicability = coalesce(public.asset_model_template_items.applicability, '{}'::jsonb) || excluded.applicability,
      authority_state = excluded.authority_state,
      metadata = coalesce(public.asset_model_template_items.metadata, '{}'::jsonb) || excluded.metadata,
      sort_order = excluded.sort_order,
      updated_at = now();
  end loop;

  update public.asset_model_template_items i
  set
    metadata = coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
      'source_role', coalesce(i.metadata ->> 'source_role', 'reusable_model_dna'),
      'projection', coalesce(i.metadata -> 'projection', '{}'::jsonb) || jsonb_build_object(
        'kind', 'system',
        'mapping_status', coalesce(i.metadata #>> '{projection,mapping_status}', 'mapped'),
        'name', coalesce(i.metadata #>> '{projection,name}', i.label),
        'group', coalesce(i.expected_value ->> 'system_category', i.metadata #>> '{projection,group}', 'Other Systems'),
        'quantity', coalesce(i.expected_value ->> 'quantity', i.metadata #>> '{projection,quantity}', '1')
      )
    ),
    applicability = coalesce(i.applicability, '{}'::jsonb) || jsonb_build_object('active', true),
    updated_at = now()
  where i.template_id = v_template_id
    and i.item_type in ('system', 'component', 'equipment');

  select a.id
  into v_asset_id
  from public.assets a
  where a.deleted_at is null
    and (
      a.id = 'a5b0d793-0aa2-4c3b-842e-5d2375aba8ed'::uuid
      or upper(coalesce(a.kac_id, '')) = 'KAC-TIARA-56LS-KF018'
      or upper(coalesce(a.serial_number, '')) = 'SSUKF018H627'
    )
  order by case when a.id = 'a5b0d793-0aa2-4c3b-842e-5d2375aba8ed'::uuid then 0 else 1 end
  limit 1;

  if v_asset_id is null then
    raise notice 'Skipping KF018 exact-build binding: exact KAC asset not found.';
    return;
  end if;

  select id
  into v_source_resource_id
  from public.asset_resources
  where (
      (applies_to_type = 'org' and applies_to_id = v_tiara_org_id)
      or (applies_to_type = 'template' and applies_to_id = v_template_id)
      or (applies_to_type = 'asset' and applies_to_id = v_asset_id)
      or lower(coalesce(metadata ->> 'organization_id', '')) = lower(v_tiara_org_id::text)
    )
    and (
      lower(coalesce(title, '')) like '%kf018%'
      or lower(coalesce(source_name, '')) like '%kf018%'
      or lower(coalesce(metadata ->> 'source_kac_id', '')) = lower('KAC-TIARA-56LS-KF018')
    )
  order by updated_at desc nulls last, created_at desc
  limit 1;

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
    1,
    'verified',
    'oem',
    0.95,
    v_source_resource_id,
    v_actor_id,
    jsonb_build_object(
      'source', 'generic_kf018_normalization',
      'source_role', 'exact_kf018_truth',
      'template_key', 'tiara-2027-56-ls',
      'kac_id', 'KAC-TIARA-56LS-KF018'
    )
  )
  on conflict do nothing;

  insert into public.exact_build_drafts (
    organization_id,
    template_id,
    asset_id,
    draft_key,
    display_name,
    status,
    source_type,
    source_resource_id,
    work_order_number,
    hin,
    build_year,
    dealer_name,
    customer_name,
    identity,
    finish_selections,
    metadata,
    created_by,
    published_at
  )
  values (
    v_tiara_org_id,
    v_template_id,
    v_asset_id,
    'kf018',
    'KF018 · Tiara Yachts 56 LS',
    'factory_frozen',
    'factory_work_order',
    v_source_resource_id,
    '68398',
    'SSUKF018H627',
    2027,
    'Ocean Blue Yachts',
    null,
    jsonb_build_object(
      'boatName', 'KF018 · Tiara Yachts 56 LS',
      'hin', 'SSUKF018H627',
      'buildCode', 'KF018',
      'model', '56 LS',
      'make', 'Tiara Yachts'
    ),
    '[]'::jsonb,
    jsonb_build_object(
      'source', 'generic_kf018_normalization',
      'source_role', 'exact_kf018_truth',
      'legacy_materializer', 'materialize_tiara_factory_build_asset',
      'published_asset_id', v_asset_id,
      'published_kac', 'KAC-TIARA-56LS-KF018',
      'catalog_template_id', v_template_id,
      'catalog_template_key', 'tiara-2027-56-ls'
    ),
    v_actor_id,
    now()
  )
  on conflict (organization_id, lower(draft_key)) do update
  set
    template_id = excluded.template_id,
    asset_id = excluded.asset_id,
    display_name = excluded.display_name,
    status = excluded.status,
    source_type = excluded.source_type,
    source_resource_id = coalesce(excluded.source_resource_id, public.exact_build_drafts.source_resource_id),
    work_order_number = excluded.work_order_number,
    hin = excluded.hin,
    build_year = excluded.build_year,
    dealer_name = coalesce(public.exact_build_drafts.dealer_name, excluded.dealer_name),
    identity = coalesce(public.exact_build_drafts.identity, '{}'::jsonb) || excluded.identity,
    metadata = coalesce(public.exact_build_drafts.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now(),
    published_at = coalesce(public.exact_build_drafts.published_at, excluded.published_at)
  returning id into v_draft_id;

  if v_draft_id is null then
    select id
    into v_draft_id
    from public.exact_build_drafts
    where organization_id = v_tiara_org_id
      and lower(draft_key) = 'kf018'
    limit 1;
  end if;

  insert into public.exact_build_draft_items (
    draft_id,
    template_item_id,
    item_key,
    state,
    quantity,
    value,
    provenance,
    notes,
    metadata
  )
  select
    v_draft_id,
    i.id,
    i.canonical_key,
    'selected',
    coalesce(nullif(i.expected_value ->> 'quantity', '')::numeric, 1),
    jsonb_strip_nulls(jsonb_build_object(
      'label', i.label,
      'group', coalesce(i.expected_value ->> 'system_category', i.metadata #>> '{projection,group}', 'Other Systems'),
      'template_item_id', i.id
    )),
    jsonb_build_object(
      'source', 'generic_kf018_exact_build_draft',
      'source_role', 'exact_kf018_truth',
      'source_asset_id', v_asset_id,
      'source_kac_id', 'KAC-TIARA-56LS-KF018',
      'source_resource_id', v_source_resource_id
    ),
    null,
    coalesce(i.metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'generic_kf018_exact_build_draft',
      'source_role', 'exact_kf018_truth',
      'projection', coalesce(i.metadata -> 'projection', '{}'::jsonb) || jsonb_build_object(
        'kind', 'system',
        'mapping_status', coalesce(i.metadata #>> '{projection,mapping_status}', 'mapped'),
        'name', coalesce(i.metadata #>> '{projection,name}', i.label),
        'group', coalesce(i.expected_value ->> 'system_category', i.metadata #>> '{projection,group}', 'Other Systems')
      )
    )
  from public.asset_model_template_items i
  where i.template_id = v_template_id
    and i.item_type in ('system', 'component', 'equipment')
    and coalesce(i.applicability ->> 'active', 'true') <> 'false'
  on conflict (draft_id, lower(item_key)) do update
  set
    template_item_id = coalesce(excluded.template_item_id, public.exact_build_draft_items.template_item_id),
    state = excluded.state,
    quantity = excluded.quantity,
    value = coalesce(public.exact_build_draft_items.value, '{}'::jsonb) || excluded.value,
    provenance = coalesce(public.exact_build_draft_items.provenance, '{}'::jsonb) || excluded.provenance,
    metadata = coalesce(public.exact_build_draft_items.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

  update public.assets
  set
    serial_number = coalesce(nullif(serial_number, ''), 'SSUKF018H627'),
    extra_metadata = coalesce(extra_metadata, '{}'::jsonb) || jsonb_build_object(
      'catalog_template_id', v_template_id,
      'catalog_template_key', 'tiara-2027-56-ls',
      'exact_build_draft_key', 'kf018',
      'exact_build_draft_source', 'generic',
      'generic_exact_build_path', true
    )
  where id = v_asset_id;
end;
$$;
