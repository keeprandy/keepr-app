-- Activator Tiara showcase media + MY2027 39 LS sister template.
--
-- Model-level media belongs to reusable templates. Exact-hull media remains
-- asset-scoped delivery/owner/evidence media.

create or replace function public.get_catalog_templates(
  p_organization_id uuid default null
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', t.id,
      'organization_id', t.organization_id,
      'organization_name', coalesce(o.display_name, o.name),
      'manufacturer', t.manufacturer,
      'model', t.model,
      'model_year', t.model_year,
      'template_key', t.template_key,
      'version', t.version,
      'status', t.status,
      'authority_state', t.authority_state,
      'metadata', t.metadata,
      'source_resource_id', t.source_resource_id,
      'showcase_media', coalesce(media.items, '[]'::jsonb),
      'updated_at', t.updated_at
    )
    order by t.model_year desc, t.manufacturer, t.model
  ), '[]'::jsonb)
  from public.asset_model_templates t
  join public.orgs o on o.id = t.organization_id
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'role', r.metadata ->> 'role',
        'title', r.title,
        'url', r.url,
        'local_asset_key', r.metadata ->> 'local_asset_key',
        'source_name', r.source_name,
        'source_platform', r.source_platform,
        'source_url', r.source_url,
        'authority_state', r.authority_state,
        'rights_status', r.rights_status,
        'metadata', r.metadata
      )
      order by coalesce((r.metadata ->> 'sort_order')::integer, 999), r.title
    ) as items
    from public.asset_resources r
    where r.applies_to_type = 'template'
      and r.applies_to_id = t.id
      and r.resource_type = 'photo'
      and r.metadata ->> 'media_scope' = 'model_template'
  ) media on true
  where (p_organization_id is null or t.organization_id = p_organization_id)
    and public.activator_user_can_read_template(auth.uid(), t.id);
$$;

create or replace function public.get_catalog_template_detail(
  p_template_id uuid default null,
  p_template_key text default null
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
  from public.asset_model_templates t
  where (p_template_id is not null and t.id = p_template_id)
     or (p_template_id is null and p_template_key is not null and lower(t.template_key) = lower(p_template_key))
  order by t.version desc
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
      'organization_id', v_template.organization_id,
      'asset_type', v_template.asset_type,
      'category', v_template.category,
      'class', v_template.class,
      'manufacturer', v_template.manufacturer,
      'model', v_template.model,
      'model_year', v_template.model_year,
      'template_key', v_template.template_key,
      'version', v_template.version,
      'status', v_template.status,
      'authority_state', v_template.authority_state,
      'source_resource_id', v_template.source_resource_id,
      'metadata', v_template.metadata
    ),
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', i.id,
          'template_id', i.template_id,
          'parent_item_id', i.parent_item_id,
          'item_type', i.item_type,
          'canonical_key', i.canonical_key,
          'label', i.label,
          'expected_value', i.expected_value,
          'applicability', i.applicability,
          'authority_state', i.authority_state,
          'source_resource_id', i.source_resource_id,
          'metadata', i.metadata,
          'sort_order', i.sort_order
        )
        order by i.sort_order, i.label
      )
      from public.asset_model_template_items i
      where i.template_id = v_template.id
    ), '[]'::jsonb),
    'resources', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at)
      from public.asset_resources r
      where (r.applies_to_type = 'template' and r.applies_to_id = v_template.id)
         or r.id = v_template.source_resource_id
    ), '[]'::jsonb),
    'showcase_media', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', r.id,
          'role', r.metadata ->> 'role',
          'title', r.title,
          'url', r.url,
          'local_asset_key', r.metadata ->> 'local_asset_key',
          'source_name', r.source_name,
          'source_platform', r.source_platform,
          'source_url', r.source_url,
          'authority_state', r.authority_state,
          'rights_status', r.rights_status,
          'metadata', r.metadata
        )
        order by coalesce((r.metadata ->> 'sort_order')::integer, 999), r.title
      )
      from public.asset_resources r
      where r.applies_to_type = 'template'
        and r.applies_to_id = v_template.id
        and r.resource_type = 'photo'
        and r.metadata ->> 'media_scope' = 'model_template'
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_catalog_templates(uuid) to authenticated;
grant execute on function public.get_catalog_template_detail(uuid, text) to authenticated;

create or replace function pg_temp.activator_upsert_template_item(
  p_template_id uuid,
  p_source_resource_id uuid,
  p_parent_key text,
  p_item_type text,
  p_key text,
  p_label text,
  p_expected jsonb,
  p_applicability jsonb,
  p_metadata jsonb,
  p_sort integer
)
returns uuid
language plpgsql
as $$
declare
  v_existing uuid;
  v_parent uuid;
begin
  if p_parent_key is not null then
    select id into v_parent
    from public.asset_model_template_items
    where template_id = p_template_id
      and lower(canonical_key) = lower(p_parent_key)
    limit 1;
  end if;

  select id into v_existing
  from public.asset_model_template_items
  where template_id = p_template_id
    and lower(canonical_key) = lower(p_key)
  limit 1;

  if v_existing is null then
    insert into public.asset_model_template_items (
      template_id, parent_item_id, item_type, canonical_key, label,
      expected_value, applicability, authority_state, source_resource_id,
      metadata, sort_order
    )
    values (
      p_template_id, v_parent, p_item_type, p_key, p_label,
      p_expected, p_applicability, 'oem_published', p_source_resource_id,
      p_metadata, p_sort
    )
    returning id into v_existing;
  else
    update public.asset_model_template_items
    set parent_item_id = v_parent,
        item_type = p_item_type,
        label = p_label,
        expected_value = p_expected,
        applicability = p_applicability,
        authority_state = 'oem_published',
        source_resource_id = p_source_resource_id,
        metadata = p_metadata,
        sort_order = p_sort,
        updated_at = now()
    where id = v_existing;
  end if;

  return v_existing;
end;
$$;

create or replace function pg_temp.activator_upsert_template_media(
  p_template_id uuid,
  p_role text,
  p_title text,
  p_url text,
  p_local_asset_key text,
  p_source_url text,
  p_source_document_title text,
  p_source_page integer,
  p_sort integer
)
returns uuid
language plpgsql
as $$
declare
  v_existing uuid;
begin
  select id into v_existing
  from public.asset_resources
  where applies_to_type = 'template'
    and applies_to_id = p_template_id
    and resource_type = 'photo'
    and metadata ->> 'media_scope' = 'model_template'
    and metadata ->> 'role' = p_role
  limit 1;

  if v_existing is null then
    insert into public.asset_resources (
      resource_type, title, url, source_name, source_platform, source_url,
      captured_at, authority_state, rights_status, applies_to_type, applies_to_id,
      metadata
    )
    values (
      'photo', p_title, p_url, 'Tiara Yachts', 'MY2027 buyer guide PDF',
      p_source_url, '2026-08-05T12:00:00Z', 'oem_published',
      'review_permission', 'template', p_template_id,
      jsonb_build_object(
        'media_scope', 'model_template',
        'role', p_role,
        'local_asset_key', p_local_asset_key,
        'source_document_title', p_source_document_title,
        'source_page', p_source_page,
        'sort_order', p_sort,
        'usage_note', 'Initial model-level showcase crop from OEM buyer guide. Replace or supersede when higher-resolution official showcase media is available.',
        'not_exact_hull_media', true
      )
    )
    returning id into v_existing;
  else
    update public.asset_resources
    set title = p_title,
        url = p_url,
        source_name = 'Tiara Yachts',
        source_platform = 'MY2027 buyer guide PDF',
        source_url = p_source_url,
        authority_state = 'oem_published',
        rights_status = 'review_permission',
        metadata = metadata || jsonb_build_object(
          'media_scope', 'model_template',
          'role', p_role,
          'local_asset_key', p_local_asset_key,
          'source_document_title', p_source_document_title,
          'source_page', p_source_page,
          'sort_order', p_sort,
          'usage_note', 'Initial model-level showcase crop from OEM buyer guide. Replace or supersede when higher-resolution official showcase media is available.',
          'not_exact_hull_media', true
        ),
        updated_at = now()
    where id = v_existing;
  end if;

  return v_existing;
end;
$$;

do $$
declare
  v_tiara_org_id uuid;
  v_le_template_id uuid;
  v_ls_template_id uuid;
  v_ls_resource_id uuid;
begin
  select id into v_tiara_org_id from public.orgs where lower(slug) = 'tiara-yachts' limit 1;
  select id into v_le_template_id from public.asset_model_templates where lower(template_key) = 'tiara-2027-39-le' and version = 1 limit 1;

  if v_tiara_org_id is null then
    return;
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
    applies_to_id,
    metadata
  )
  values (
    'oem_catalog',
    'Tiara Yachts 39 LS Buyer''s Guide MY2027',
    null,
    'Tiara Yachts',
    'OEM buyer guide',
    '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LS_Buyers_Guide_MY2027.pdf',
    '2026-08-05T11:46:17-04:00',
    'oem_published',
    'private',
    'template',
    null,
    jsonb_build_object(
      'document_kind', 'buyer_guide',
      'model_year', 2027,
      'model', '39 LS',
      'source_context', 'MY2027 standards and options buyer guide',
      'source_file', 'Tiara_Yachts__39_LS_Buyers_Guide_MY2027.pdf'
    )
  )
  returning id into v_ls_resource_id;

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
    metadata
  )
  values (
    v_tiara_org_id,
    'boat',
    'marine',
    'luxury_day_yacht',
    'Tiara Yachts',
    '39 LS',
    2027,
    2027,
    2027,
    'tiara-2027-39-ls',
    1,
    'published',
    'oem_published',
    v_ls_resource_id,
    jsonb_build_object(
      'use_case', 'activator_use_case_01_sister_model',
      'source_structure', 'buyer_guide',
      'display_name', '2027 Tiara 39 LS',
      'sister_model_to', 'tiara-2027-39-le',
      'hero_image_role', 'brochure_model_imagery',
      'product_semantics_preserved', true
    )
  )
  on conflict (lower(template_key), version) do update
    set organization_id = excluded.organization_id,
        asset_type = excluded.asset_type,
        category = excluded.category,
        class = excluded.class,
        manufacturer = excluded.manufacturer,
        model = excluded.model,
        model_year = excluded.model_year,
        model_year_start = excluded.model_year_start,
        model_year_end = excluded.model_year_end,
        status = excluded.status,
        authority_state = excluded.authority_state,
        source_resource_id = excluded.source_resource_id,
        metadata = public.asset_model_templates.metadata || excluded.metadata,
        updated_at = now()
  returning id into v_ls_template_id;

  update public.asset_resources
  set applies_to_id = v_ls_template_id,
      updated_at = now()
  where id = v_ls_resource_id;

  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, null, 'section', 'brochure.specifications', 'Specifications', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'SPECIFICATIONS', 'display_group', 'overview'), 10);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.loa', 'L.O.A.', jsonb_build_object('value', '39''6"', 'metric', '12.04 m'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 11);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.beam', 'Beam', jsonb_build_object('value', '12''6"', 'metric', '3.81 m'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 12);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.draft.motors_up', 'Hull Draft with Motors Up', jsonb_build_object('value', '2''4"', 'metric', '0.71 m'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 13);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.draft.motors_down', 'Hull Draft with Motors Down', jsonb_build_object('value', '3''5"', 'metric', '1.04 m'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 14);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.dry_weight', 'Approx. Dry Weight', jsonb_build_object('value', '21,339 lbs', 'metric', '9,679 kg'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 15);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.max_horsepower', 'Maximum Horsepower', jsonb_build_object('value', '1,200 HP'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 16);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.fuel_capacity', 'Fuel Capacity', jsonb_build_object('value', '500 Gallons', 'metric', '1,893 L'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 17);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.diesel_capacity', 'Diesel Fuel Capacity', jsonb_build_object('value', '30 Gallons', 'metric', '114 L'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 18);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.water_capacity', 'Water Capacity', jsonb_build_object('value', '50 Gallons', 'metric', '189 L'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 19);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.holding_capacity', 'Holding Tank Capacity', jsonb_build_object('value', '30 Gallons', 'metric', '114 L'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 20);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.specifications', 'spec', 'spec.deadrise', 'Deadrise at Transom', jsonb_build_object('value', '21 degrees'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 21);

  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, null, 'section', 'brochure.hardtop', 'Hardtop', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'HARDTOP', 'display_group', 'exterior'), 200);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.hardtop', 'equipment', 'equipment.full_beam_hardtop', 'Molded fiberglass full beam hardtop', jsonb_build_object('summary', 'Integrated visor and fiberglass aft supports'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HARDTOP'), 201);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.hardtop', 'equipment', 'equipment.hardtop_skylight', 'Hardtop skylight and center hatch', jsonb_build_object('summary', 'Fixed tempered glass port and starboard with flush mount hatch on center'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HARDTOP'), 202);

  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, null, 'section', 'brochure.aft_cockpit', 'Aft Cockpit', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'AFT COCKPIT', 'display_group', 'exterior'), 500);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.aft_cockpit', 'equipment', 'equipment.hull_side_terrace', 'Port hull side terrace', jsonb_build_object('summary', 'Synthetic teak decking'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'AFT COCKPIT'), 501);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.aft_cockpit', 'equipment', 'equipment.makefast_sunshade', 'Makefast Marine powered sunshade', '{}'::jsonb, jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'AFT COCKPIT'), 502);

  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, null, 'section', 'brochure.mid_cockpit', 'Mid Cockpit', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'MID COCKPIT', 'display_group', 'helm'), 600);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.mid_cockpit', 'equipment', 'equipment.tilting_helm_console', 'Molded fiberglass aft tilting helm console', jsonb_build_object('summary', 'Garmin Empirbus digital switching instrumentation visor and electronics mounting surface'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'MID COCKPIT'), 601);

  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, null, 'section', 'brochure.interior', 'Interior', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'INTERIOR', 'display_group', 'interior'), 800);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.interior', 'equipment', 'equipment.queen_berth', 'Queen berth', jsonb_build_object('summary', '7 inch innerspring mattress with bamboo fabric and cotton sheet package'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INTERIOR'), 801);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.interior', 'system', 'system.cabin_ac', 'Dometic 10,000 BTU Voyager air conditioning', jsonb_build_object('summary', 'Cabin and head reverse cycle heat'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INTERIOR'), 802);

  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, null, 'section', 'brochure.instrumentation_safety_equipment', 'Instrumentation, Safety and Equipment', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT', 'display_group', 'systems'), 1000);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.electronics_package', 'Tiara Yachts integrated electronics package', jsonb_build_object('components', jsonb_build_array('One Garmin 9219 GPSMAP 9000 Series Display', '1kW transducer', 'Garmin VHF radio', 'Auto pilot')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1001);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.generator', 'Onan 7.5kW diesel generator with sound shield', '{}'::jsonb, jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1002);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.trim_tabs', 'ZipWake dynamic trim control system', jsonb_build_object('summary', 'Auto pitch, auto roll and coordinated turn features'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1003);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.instrumentation_safety_equipment', 'equipment', 'equipment.starlink_prewire', 'Pre-wiring for Starlink satellite internet', '{}'::jsonb, jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1004);

  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, null, 'section', 'brochure.propulsion', 'Propulsion', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'PROPULSION', 'display_group', 'options'), 1100);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.propulsion', 'option', 'option.propulsion.twin_mercury_600_v12', 'Twin Mercury 600 V12 Verado Outboard Engines', jsonb_build_object('summary', 'Mercury engine package with DTS, joystick piloting, VesselView display, Active Trim and Reverso automatic flushing system'), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'PROPULSION'), 1101);

  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, null, 'section', 'brochure.aft_cockpit_modules', 'Aft Cockpit Modules', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'AFT COCKPIT MODULES', 'display_group', 'options'), 1200);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.aft_cockpit_modules', 'option_group', 'option_group.aft_cockpit_module', 'Aft Cockpit Module', '{}'::jsonb, jsonb_build_object('selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'AFT COCKPIT MODULES'), 1201);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'option_group.aft_cockpit_module', 'option', 'option.aft_module.buffet_lounge', 'Buffet Lounge Module', jsonb_build_object('summary', 'Rotating lounge, trunk storage, electric grill, 120V outlet and weather cover'), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'AFT COCKPIT MODULES'), 1202);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'option_group.aft_cockpit_module', 'option', 'option.aft_module.adventure', 'Adventure Module', jsonb_build_object('summary', 'Work surface with sink, electric grill, freezer, 42 gallon livewell, rod holders and fold-down seat'), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'AFT COCKPIT MODULES'), 1203);

  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, null, 'section', 'brochure.mechanical_group', 'Mechanical Group', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'MECHANICAL GROUP', 'display_group', 'options'), 1300);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.mechanical_group', 'option', 'option.mechanical.seakeeper_sk45', 'Seakeeper SK4.5 Gyro', '{}'::jsonb, jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP', 'source_price', '85,000'), 1301);

  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, null, 'section', 'brochure.resources', 'Resources', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'RESOURCES', 'display_group', 'resources'), 9000);
  perform pg_temp.activator_upsert_template_item(v_ls_template_id, v_ls_resource_id, 'brochure.resources', 'resource', 'resource.buyer_guide', 'Tiara Yachts 39 LS Buyer''s Guide MY2027', jsonb_build_object('resource_id', v_ls_resource_id), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'RESOURCES'), 9001);

  if v_le_template_id is not null then
    update public.asset_model_templates
    set metadata = metadata || jsonb_build_object(
          'showcase_media_scope', 'model_template',
          'showcase_media_source', 'MY2027 buyer guide PDF',
          'exact_hull_media_policy', 'Exact-hull photos must be stored as asset-scoped resources; template media is inherited only until the hull has its own media.'
        ),
        updated_at = now()
    where id = v_le_template_id;

    perform pg_temp.activator_upsert_template_media(v_le_template_id, 'hero', '39 LE hero', 'app://assets/boats/tiara/tiara_39le_hero.jpg', 'tiara_39le_hero', '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LE_Buyers_Guide_MY2027.pdf', 'Tiara Yachts 39 LE Buyer''s Guide MY2027', 1, 10);
    perform pg_temp.activator_upsert_template_media(v_le_template_id, 'helm', '39 LE helm', 'app://assets/boats/tiara/tiara_39le_helm.jpg', 'tiara_39le_helm', '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LE_Buyers_Guide_MY2027.pdf', 'Tiara Yachts 39 LE Buyer''s Guide MY2027', 3, 20);
    perform pg_temp.activator_upsert_template_media(v_le_template_id, 'cabin_stateroom', '39 LE cabin stateroom', 'app://assets/boats/tiara/tiara_39le_cabin_stateroom.jpg', 'tiara_39le_cabin_stateroom', '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LE_Buyers_Guide_MY2027.pdf', 'Tiara Yachts 39 LE Buyer''s Guide MY2027', 3, 30);
    perform pg_temp.activator_upsert_template_media(v_le_template_id, 'overhead', '39 LE overhead view', 'app://assets/boats/tiara/tiara_39le_overhead.jpg', 'tiara_39le_overhead', '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LE_Buyers_Guide_MY2027.pdf', 'Tiara Yachts 39 LE Buyer''s Guide MY2027', 3, 40);
    perform pg_temp.activator_upsert_template_media(v_le_template_id, 'aft_module', '39 LE aft module', 'app://assets/boats/tiara/tiara_39le_aft_module.jpg', 'tiara_39le_aft_module', '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LE_Buyers_Guide_MY2027.pdf', 'Tiara Yachts 39 LE Buyer''s Guide MY2027', 3, 50);
  end if;

  update public.asset_model_templates
  set metadata = metadata || jsonb_build_object(
        'showcase_media_scope', 'model_template',
        'showcase_media_source', 'MY2027 buyer guide PDF',
        'exact_hull_media_policy', 'Exact-hull photos must be stored as asset-scoped resources; template media is inherited only until the hull has its own media.'
      ),
      updated_at = now()
  where id = v_ls_template_id;

  perform pg_temp.activator_upsert_template_media(v_ls_template_id, 'hero', '39 LS hero', 'app://assets/boats/tiara/tiara_39ls_hero.jpg', 'tiara_39ls_hero', '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LS_Buyers_Guide_MY2027.pdf', 'Tiara Yachts 39 LS Buyer''s Guide MY2027', 1, 10);
  perform pg_temp.activator_upsert_template_media(v_ls_template_id, 'aft_cockpit', '39 LS aft cockpit', 'app://assets/boats/tiara/tiara_39ls_aft_cockpit.jpg', 'tiara_39ls_aft_cockpit', '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LS_Buyers_Guide_MY2027.pdf', 'Tiara Yachts 39 LS Buyer''s Guide MY2027', 3, 20);
  perform pg_temp.activator_upsert_template_media(v_ls_template_id, 'cockpit_lounge', '39 LS cockpit lounge', 'app://assets/boats/tiara/tiara_39ls_cockpit_lounge.jpg', 'tiara_39ls_cockpit_lounge', '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LS_Buyers_Guide_MY2027.pdf', 'Tiara Yachts 39 LS Buyer''s Guide MY2027', 3, 30);
  perform pg_temp.activator_upsert_template_media(v_ls_template_id, 'cabin_stateroom', '39 LS cabin stateroom', 'app://assets/boats/tiara/tiara_39ls_cabin_stateroom.jpg', 'tiara_39ls_cabin_stateroom', '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LS_Buyers_Guide_MY2027.pdf', 'Tiara Yachts 39 LS Buyer''s Guide MY2027', 3, 40);
end $$;
