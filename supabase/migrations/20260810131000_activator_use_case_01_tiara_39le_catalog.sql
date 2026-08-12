-- Activator Use Case 01: MY2027 Tiara 39 LE catalog template and demo hull.
--
-- Source-preserving catalog slice:
-- Buyer guide -> published model template -> exact demo hull -> dealer/location/owner.

alter table public.asset_model_template_items
  drop constraint if exists asset_model_template_items_type_check;

alter table public.asset_model_template_items
  add constraint asset_model_template_items_type_check
    check (item_type in (
      'section',
      'option_group',
      'option',
      'system',
      'component',
      'spec',
      'equipment',
      'resource',
      'playbook',
      'interval',
      'knowledge'
    ));

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
      'updated_at', t.updated_at
    )
    order by t.model_year desc, t.manufacturer, t.model
  ), '[]'::jsonb)
  from public.asset_model_templates t
  join public.orgs o on o.id = t.organization_id
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
      p_template_id,
      v_parent,
      p_item_type,
      p_key,
      p_label,
      p_expected,
      p_applicability,
      'oem_published',
      p_source_resource_id,
      p_metadata,
      p_sort
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

do $$
declare
  v_tiara_org_id uuid;
  v_skipperbuds_org_id uuid;
  v_lake_fenton_location_id uuid;
  v_demo_owner_id uuid;
  v_tiara_template_id uuid;
  v_resource_id uuid;
  v_asset_id uuid;
  v_binding_id uuid;
  v_oem_relationship_id uuid;
  v_dealer_relationship_id uuid;
begin
  select id into v_tiara_org_id from public.orgs where lower(slug) = 'tiara-yachts' limit 1;
  select id into v_skipperbuds_org_id from public.orgs where lower(slug) = 'skipperbuds' limit 1;
  select id into v_demo_owner_id from public.profiles where lower(email) = 'demo@keeprhome.com' limit 1;
  select id into v_lake_fenton_location_id
  from public.org_locations
  where organization_id = v_skipperbuds_org_id
    and lower(external_source_id) = 'skipperbuds-lake-fenton-marina'
  limit 1;

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
    'Tiara Yachts 39 LE Buyer''s Guide MY2027',
    '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LE_Buyers_Guide_MY2027.pdf',
    'Tiara Yachts',
    'OEM buyer guide',
    '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LE_Buyers_Guide_MY2027.pdf',
    '2026-08-05T11:52:12Z',
    'oem_published',
    'private',
    'template',
    null,
    jsonb_build_object(
      'model_year', 2027,
      'model', '39 LE',
      'document_role', 'authoritative_model_template_source',
      'effective_date_label', 'Effective August 5, 2026'
    )
  )
  on conflict do nothing;

  select id into v_resource_id
  from public.asset_resources
  where title = 'Tiara Yachts 39 LE Buyer''s Guide MY2027'
    and source_name = 'Tiara Yachts'
  order by created_at
  limit 1;

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
    '39 LE',
    2027,
    2027,
    2027,
    'tiara-2027-39-le',
    1,
    'published',
    'oem_published',
    v_resource_id,
    jsonb_build_object(
      'use_case', 'activator_use_case_01',
      'source_structure', 'buyer_guide',
      'display_name', '2027 Tiara 39 LE',
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
        metadata = excluded.metadata,
        updated_at = now()
  returning id into v_tiara_template_id;

  update public.asset_resources
  set applies_to_id = v_tiara_template_id,
      updated_at = now()
  where id = v_resource_id;

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.specifications', 'Specifications', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'SPECIFICATIONS', 'display_group', 'overview'), 10);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.loa', 'L.O.A.', jsonb_build_object('value', '39''6"', 'metric', '12.04 m'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 11);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.beam', 'Beam', jsonb_build_object('value', '12''6"', 'metric', '3.81 m'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 12);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.draft.motors_up', 'Hull Draft with Motors Up', jsonb_build_object('value', '2''6"', 'metric', '0.76 m'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 13);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.draft.motors_down', 'Hull Draft with Motors Down', jsonb_build_object('value', '3''6"', 'metric', '1.07 m'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 14);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.dry_weight', 'Approx. Dry Weight', jsonb_build_object('value', '22,850 lbs', 'metric', '10,365 kg'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 15);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.max_horsepower', 'Maximum Horsepower', jsonb_build_object('value', '1,200 HP'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 16);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.fuel_capacity', 'Fuel Capacity', jsonb_build_object('value', '500 Gallons', 'metric', '1,893 L'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 17);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.diesel_capacity', 'Diesel Fuel Capacity', jsonb_build_object('value', '30 Gallons', 'metric', '114 L'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 18);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.water_capacity', 'Water Capacity', jsonb_build_object('value', '50 Gallons', 'metric', '189 L'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 19);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.holding_capacity', 'Holding Tank Capacity', jsonb_build_object('value', '30 Gallons', 'metric', '114 L'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 20);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.specifications', 'spec', 'spec.deadrise', 'Deadrise at Transom', jsonb_build_object('value', '21 degrees'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'SPECIFICATIONS'), 21);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.hull_and_deck', 'Hull and Deck', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'HULL AND DECK', 'display_group', 'exterior'), 100);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.hull_and_deck', 'equipment', 'equipment.transferable_warranty', 'Transferable limited warranty', jsonb_build_object('summary', 'Five years on hull and deck; two years on accessories'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HULL AND DECK'), 101);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.hull_and_deck', 'equipment', 'equipment.infused_hull', 'Infused hull with painted outer layer', jsonb_build_object('summary', 'Structural foam cored hull sides and bottom, engineered fabrics and premium resin'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HULL AND DECK'), 102);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.hull_and_deck', 'equipment', 'equipment.infused_deck', 'Infused deck with gelcoat outer layer', jsonb_build_object('summary', 'Foam cored walking surfaces, engineered fabrics and premium resin'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HULL AND DECK'), 103);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.hull_and_deck', 'equipment', 'equipment.structural_grid', 'Infused fiberglass structural grid system', jsonb_build_object('summary', 'Molded finish and integrated bilge water management'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HULL AND DECK'), 104);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.hull_and_deck', 'equipment', 'equipment.pop_up_cleats', 'Eight 10 inch pop-up cleats', jsonb_build_object('summary', 'Two bow, two stern, four midship'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HULL AND DECK'), 105);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.hardtop', 'Hardtop', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'HARDTOP', 'display_group', 'exterior'), 200);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.hardtop', 'equipment', 'equipment.full_beam_hardtop', 'Molded fiberglass full beam hardtop', jsonb_build_object('summary', 'Integrated visors'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HARDTOP'), 201);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.hardtop', 'equipment', 'equipment.webasto_sunroof', 'Webasto power sunroof', '{}'::jsonb, jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HARDTOP'), 202);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.hardtop', 'equipment', 'equipment.navigation_mast', 'Folding navigation light mast', jsonb_build_object('summary', 'Flag attachment points'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HARDTOP'), 203);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.foredeck', 'Foredeck', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'FOREDECK', 'display_group', 'exterior'), 300);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.foredeck', 'equipment', 'equipment.bomar_hatch', 'Bomar opening forward deck hatch', jsonb_build_object('summary', 'Integrated Skyscreen privacy shade and screen'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'FOREDECK'), 301);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.foredeck', 'equipment', 'equipment.chaise_sunpad', 'Recessed chaise lounge sunpad', jsonb_build_object('summary', 'Integrated handholds, USB-C chargers, drink holders and weather cover'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'FOREDECK'), 302);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.foredeck', 'system', 'system.anchor', 'Integrated thru-stem anchor system', jsonb_build_object('components', jsonb_build_array('316L SS anchor roller', 'horizontal windlass', '34 lb plow anchor', 'chain and rode')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'FOREDECK'), 303);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.transom', 'Transom', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'TRANSOM', 'display_group', 'exterior'), 400);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.transom', 'equipment', 'equipment.underwater_lights', '12V LED multicolor underwater lights', '{}'::jsonb, jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'TRANSOM'), 401);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.transom', 'equipment', 'equipment.swim_platform', 'Integrated swim platform', jsonb_build_object('summary', 'Extensions outboard of engines'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'TRANSOM'), 402);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.transom', 'equipment', 'equipment.transom_shower', 'Recessed transom shower', jsonb_build_object('summary', 'Pullout sprayer and hot/cold mixing valve'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'TRANSOM'), 403);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.aft_cockpit', 'Aft Cockpit', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'AFT COCKPIT', 'display_group', 'exterior'), 500);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.aft_cockpit', 'equipment', 'equipment.electric_grill', 'Electric grill', '{}'::jsonb, jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'AFT COCKPIT'), 501);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.aft_cockpit', 'equipment', 'equipment.makefast_sunshade', 'Makefast marine powered sunshade', '{}'::jsonb, jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'AFT COCKPIT'), 502);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.aft_cockpit', 'equipment', 'equipment.hull_side_terrace', 'Port hull side terrace', jsonb_build_object('finish', 'synthetic teak decking'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'AFT COCKPIT'), 503);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.upper_cockpit_helm', 'Upper Cockpit and Helm Area', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'UPPER COCKPIT AND HELM AREA', 'display_group', 'helm'), 600);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.upper_cockpit_helm', 'system', 'system.helm_console', 'Molded fiberglass aft tilting helm console', jsonb_build_object('includes', jsonb_build_array('Empirbus digital switching', 'instrumentation visor', 'electronics mounting surface', 'USB charging', '13.5 inch tilting steering wheel')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'UPPER COCKPIT AND HELM AREA'), 601);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.upper_cockpit_helm', 'equipment', 'equipment.teak_steering_wheel', 'Teak steering wheel', '{}'::jsonb, jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'UPPER COCKPIT AND HELM AREA'), 602);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.upper_cockpit_helm', 'equipment', 'equipment.wet_bar', 'Wet bar', jsonb_build_object('includes', jsonb_build_array('solid surface countertops', 'sink with hot/cold faucet', 'storage', '120V GFI outlet', 'waste receptacle', 'drawer storage')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'UPPER COCKPIT AND HELM AREA'), 603);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.interior_group', 'Interior Group', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'INTERIOR GROUP', 'display_group', 'interior'), 700);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.interior_group', 'equipment', 'equipment.architectural_teak_interior', 'Architectural teak interior', '{}'::jsonb, jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INTERIOR GROUP'), 701);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.interior_group', 'equipment', 'equipment.galley', 'Galley', jsonb_build_object('includes', jsonb_build_array('sink with hot/cold water', 'two drawer refrigerator', 'microwave', 'induction cooktop', 'pantry storage')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INTERIOR GROUP'), 702);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.interior_group', 'system', 'system.cabin_ac', 'Dometic Voyager 14,000 BTU cabin air conditioning', jsonb_build_object('mode', 'reverse cycle heat'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INTERIOR GROUP'), 703);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.staterooms', 'Staterooms', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'STATEROOMS', 'display_group', 'interior'), 800);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.staterooms', 'equipment', 'equipment.owners_stateroom', 'Owner''s stateroom forward', jsonb_build_object('berth', 'queen size pedestal berth', 'mattress', '7 inch innerspring'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'STATEROOMS'), 801);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.staterooms', 'equipment', 'equipment.mid_cabin', 'Mid-cabin', jsonb_build_object('berth', 'full size 7 inch innerspring mattress'), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'STATEROOMS'), 802);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.head', 'Head', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'HEAD', 'display_group', 'interior'), 900);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.head', 'system', 'system.head', 'Private head', jsonb_build_object('includes', jsonb_build_array('locking door', 'separate fiberglass stall shower', 'VacuFlush toilet', 'vanity with ceramic sink', 'exhaust fan', '12V lighting', '120V outlet')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'HEAD'), 901);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.instrumentation_safety_equipment', 'Instrumentation, Safety and Equipment', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT', 'display_group', 'systems'), 1000);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.electrical', 'Tiara custom 12V DC and 120V AC electrical system', jsonb_build_object('includes', jsonb_build_array('master distribution panel', '50 amp dockside power cord', 'Cablemaster recoiler', 'battery bank', 'bonding system', 'ELCI RCBO')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1001);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.generator', 'Onan 7.5kW diesel generator', jsonb_build_object('sound_shield', true), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1002);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.garmin_integrated_electronics', 'Tiara integrated electronics package', jsonb_build_object('includes', jsonb_build_array('one Garmin 9617 GPSMAP display', 'Mercury display', '1kW transducer', 'Garmin VHF radio', 'Auto Pilot', 'Garmin HD rear view camera')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1003);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.stereo', 'Tiara premium stereo system', jsonb_build_object('includes', jsonb_build_array('Fusion Apollo head unit', 'three Fusion remote pads', 'JL Audio amplification', 'twelve JL speakers', 'two 8 inch subwoofers')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1004);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.fuel', 'Rotomolded HDPE gasoline fuel tanks', jsonb_build_object('includes', jsonb_build_array('in-line fuel filters', 'fuel shut-off valves', 'digital level indicator')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1005);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.fresh_water', 'Fresh water system', jsonb_build_object('includes', jsonb_build_array('tanks', '5 GPM pump', 'six gallon water heater', 'digital level indicator')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1006);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.sanitation', 'Holding tank system', jsonb_build_object('includes', jsonb_build_array('deck discharge', 'vent filter', 'digital level indicator')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1007);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.bilge', 'Three automatic/manual electric bilge pumps', jsonb_build_object('locations', jsonb_build_array('forward', 'midship', 'aft')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1008);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.safety', 'Safety equipment', jsonb_build_object('includes', jsonb_build_array('Fireboy clean agent system', 'three handheld fire extinguishers', 'smoke and CO detectors', 'electronic flare', 'navigation lighting', 'life vests domestic boats only')), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1009);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.trim_tabs', 'Zip-Wake trim tab system', '{}'::jsonb, jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1010);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.instrumentation_safety_equipment', 'system', 'system.bow_thruster', '12V bow thruster system', jsonb_build_object('separate_battery_system', true), jsonb_build_object('standard_state', 'standard'), jsonb_build_object('brochure_heading', 'INSTRUMENTATION, SAFETY AND EQUIPMENT'), 1011);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.propulsion_options', 'Propulsion', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'PROPULSION', 'display_group', 'options'), 2000);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.propulsion_options', 'option_group', 'option_group.propulsion', 'Propulsion', jsonb_build_object('rule', 'choose_one'), jsonb_build_object('selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'PROPULSION'), 2001);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.propulsion', 'option', 'option.propulsion.twin_mercury_600_v12', 'Twin Mercury 600 V12 Verado Outboard Engines', jsonb_build_object('package_includes', jsonb_build_array('Cold Fusion White engines with Graphite Grey accents', 'Digital Throttle and Shift', 'Joystick Piloting with Integrated Auto Pilot', 'SmartCraft 7-inch LCD touchscreen', 'Active Trim', 'Reverso automatic flushing system')), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'PROPULSION'), 2002);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.aft_cockpit_modules_options', 'Aft Cockpit Modules', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'AFT COCKPIT MODULES', 'display_group', 'options'), 2100);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.aft_cockpit_modules_options', 'option_group', 'option_group.aft_cockpit_module', 'Aft Cockpit Module', jsonb_build_object('rule', 'choose_one'), jsonb_build_object('selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'AFT COCKPIT MODULES'), 2101);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.aft_cockpit_module', 'option', 'option.aft_module.buffet_lounge', 'Buffet Lounge Module', jsonb_build_object('includes', jsonb_build_array('lounge seating', 'drink holders', 'integrated storage compartment', 'buffet style trunk')), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'AFT COCKPIT MODULES'), 2102);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.aft_cockpit_module', 'option', 'option.aft_module.adventure', 'Adventure Module', jsonb_build_object('includes', jsonb_build_array('work surface with sink', 'cutting board', 'top load storage', 'electric grill', '3.8 cu ft freezer tank', '42 gallon livewell', 'rod holders', 'fresh water washdown', 'storage boxes', 'accent lighting', 'fold-down seat', 'pop-up lights')), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'AFT COCKPIT MODULES'), 2103);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.mechanical_options', 'Mechanical Group', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'MECHANICAL GROUP', 'display_group', 'options'), 2200);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.mechanical_options', 'option_group', 'option_group.mechanical', 'Mechanical options', jsonb_build_object('rule', 'choose_many'), jsonb_build_object('selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2201);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.mechanical', 'option', 'option.mechanical.mercury_bow_thruster', 'Mercury Integrated Bow Thruster System', jsonb_build_object('source_price_usd', 15100), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2202);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.mechanical', 'option', 'option.mechanical.seakeeper_sk45', 'Seakeeper SK4.5 Gyro', jsonb_build_object('source_price_usd', 85000), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2203);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.mechanical', 'option', 'option.mechanical.head_macerator', 'Head Macerator System', jsonb_build_object('source_price_usd', 1735), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2204);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.mechanical', 'option', 'option.mechanical.inverter', 'Inverter', jsonb_build_object('source_price_usd', 4680), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2205);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.mechanical', 'option', 'option.mechanical.raw_water_washdown_aft', 'Raw Water Washdown - Aft Cockpit', jsonb_build_object('source_price_usd', 1340), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2206);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.mechanical', 'option', 'option.mechanical.raw_water_washdown_forward', 'Raw Water Washdown - Forward', jsonb_build_object('source_price_usd', 1340), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2207);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.mechanical', 'option', 'option.mechanical.oil_changer_generator', 'Oil Changer for Generator', jsonb_build_object('source_price_usd', 2160), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2208);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.mechanical', 'option', 'option.mechanical.all_chain_windlass', 'All Chain Windlass with Remote at Helm', jsonb_build_object('source_price_usd', 2260), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2209);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.mechanical', 'option', 'option.mechanical.electrosea_strainer', 'ElectroSea Strainer', jsonb_build_object('source_price_usd', 11900), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2210);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.mechanical', 'option', 'option.mechanical.zipwake_pro_trim_tabs', 'Zipwake Pro Trim Tabs', jsonb_build_object('source_price_usd', 1800, 'replaces_standard', 'Zip-Wake trim tab system'), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many', 'configuration_semantic', 'replaces_standard'), jsonb_build_object('brochure_heading', 'MECHANICAL GROUP'), 2211);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.electronics_options', 'Electronics Group', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'ELECTRONICS GROUP', 'display_group', 'options'), 2300);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.electronics_options', 'option_group', 'option_group.electronics', 'Electronics options', jsonb_build_object('rule', 'choose_many'), jsonb_build_object('selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'ELECTRONICS GROUP'), 2301);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.electronics', 'option', 'option.electronics.additional_garmin_9617', 'Additional Garmin 9617 GPSMAP Display', jsonb_build_object('source_price_usd', 11200), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'ELECTRONICS GROUP'), 2302);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.electronics', 'option', 'option.electronics.garmin_fantom_54', 'Garmin Fantom 54 Radar with 4 ft Open Array', jsonb_build_object('source_price_usd', 12900), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'ELECTRONICS GROUP'), 2303);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.electronics', 'option', 'option.electronics.flir_m232', 'FLIR M232 Camera', jsonb_build_object('source_price_usd', 7230), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'ELECTRONICS GROUP'), 2304);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.electronics', 'option', 'option.electronics.acr_spotlight', 'ACR LED Remote Spotlight', jsonb_build_object('source_price_usd', 3600, 'mounting', 'bow'), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'ELECTRONICS GROUP'), 2305);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.electronics', 'option', 'option.electronics.ais', 'AIS System', jsonb_build_object('source_price_usd', 2070), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'ELECTRONICS GROUP'), 2306);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.electronics', 'option', 'option.electronics.siriusxm', 'SiriusXM Radio and Weather Ready', jsonb_build_object('source_price_usd', 2690, 'subscription_included', false), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'ELECTRONICS GROUP'), 2307);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.electronics', 'option', 'option.electronics.starlink', 'Starlink Satellite Internet', jsonb_build_object('source_price_usd', 1000, 'subscription_included', false), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'ELECTRONICS GROUP'), 2308);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.electronics', 'option', 'option.electronics.fold_down_antennas', 'Electric Fold-Down Antennas and Navigation Light Mast', jsonb_build_object('source_price_usd', 8890), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'ELECTRONICS GROUP'), 2309);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.interior_options', 'Interior Group Options', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'INTERIOR GROUP', 'display_group', 'options'), 2400);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.interior_options', 'option', 'option.interior.galley_freezer', 'Freezer Unit in Galley', jsonb_build_object('source_price_usd', 875, 'replaces_standard', 'one standard refrigerator'), jsonb_build_object('standard_state', 'optional', 'configuration_semantic', 'replaces_standard'), jsonb_build_object('brochure_heading', 'INTERIOR GROUP'), 2401);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.exterior_options', 'Exterior Group Options', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'EXTERIOR GROUP', 'display_group', 'options'), 2500);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.exterior_options', 'option_group', 'option_group.wetbar', 'Aft Facing Cockpit Wetbar Options', jsonb_build_object('rule', 'choose_one'), jsonb_build_object('selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'EXTERIOR GROUP'), 2501);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.wetbar', 'option', 'option.wetbar.storage', 'Wetbar Storage', jsonb_build_object('source_price_usd', 0), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'EXTERIOR GROUP'), 2502);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.wetbar', 'option', 'option.wetbar.refrigerator', 'Wetbar Refrigerator', jsonb_build_object('source_price_usd', 1055), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'EXTERIOR GROUP'), 2503);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'option_group.wetbar', 'option', 'option.wetbar.icemaker', 'Wetbar Icemaker', jsonb_build_object('source_price_usd', 1120), jsonb_build_object('standard_state', 'optional', 'selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'EXTERIOR GROUP'), 2504);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.exterior_options', 'option', 'option.exterior.cockpit_tv', 'Cockpit TV', jsonb_build_object('source_price_usd', 6480), jsonb_build_object('standard_state', 'optional'), jsonb_build_object('brochure_heading', 'EXTERIOR GROUP'), 2505);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.exterior_options', 'option', 'option.exterior.cockpit_ac', 'Dometic Voyager 18,000 BTU Cockpit Air Conditioning System', jsonb_build_object('source_price_usd', 11500, 'mode', 'reverse cycle heat'), jsonb_build_object('standard_state', 'optional'), jsonb_build_object('brochure_heading', 'EXTERIOR GROUP'), 2506);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.exterior_options', 'option', 'option.exterior.outriggers', 'TACO Marine Grand Slam Outriggers with 20 ft Carbon Fiber Poles', jsonb_build_object('source_price_usd', 14900), jsonb_build_object('standard_state', 'optional'), jsonb_build_object('brochure_heading', 'EXTERIOR GROUP'), 2507);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.upholstery_packages', 'Upholstery Packages', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'UPHOLSTERY PACKAGES', 'display_group', 'options'), 2600);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.upholstery_packages', 'option_group', 'option_group.exterior_ultraleather', 'Exterior Ultraleather Package', jsonb_build_object('rule', 'choose_one', 'values', jsonb_build_array('Lighthouse White', 'Sea Cliff Grey', 'Adobe Sand')), jsonb_build_object('selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'UPHOLSTERY PACKAGES'), 2601);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.upholstery_packages', 'option_group', 'option_group.interior_fabric', 'Interior Fabric Package', jsonb_build_object('rule', 'choose_one', 'values', jsonb_build_array('Coastal', 'Driftwood', 'Shoreline')), jsonb_build_object('selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'UPHOLSTERY PACKAGES'), 2602);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.solid_surface_selections', 'Solid Surface Selections', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'SOLID SURFACE SELECTIONS', 'display_group', 'options'), 2700);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.solid_surface_selections', 'option_group', 'option_group.solid_surface', 'Countertops in Head, Exterior, Head, and Galley', jsonb_build_object('rule', 'choose_one', 'values', jsonb_build_array('Aurora Frost', 'Aurora Bisque', 'Aurora Andria')), jsonb_build_object('selection_rule', 'choose_one'), jsonb_build_object('brochure_heading', 'SOLID SURFACE SELECTIONS'), 2701);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.paint_selections', 'Paint Selections', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'PAINT SELECTIONS', 'display_group', 'options'), 2800);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.paint_selections', 'option_group', 'option_group.paint', 'Axalta Paint Selections', jsonb_build_object('rule', 'choose_many', 'includes', jsonb_build_array('hull paint', 'bootline paint', 'engine cowling paint', 'one quart hull paint')), jsonb_build_object('selection_rule', 'choose_many'), jsonb_build_object('brochure_heading', 'PAINT SELECTIONS'), 2801);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.international_options', 'International Options', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('brochure_heading', 'INTERNATIONAL OPTIONS', 'display_group', 'options'), 2900);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.international_options', 'option', 'option.international.conversion_package', 'International Conversion Package', jsonb_build_object('note', 'Not available on domestic boats. Pricing through international dealers.'), jsonb_build_object('standard_state', 'optional'), jsonb_build_object('brochure_heading', 'INTERNATIONAL OPTIONS'), 2901);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.care', 'Care', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('display_group', 'care'), 3000);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.care', 'playbook', 'playbook.delivery_walkthrough', 'Delivery walkthrough', jsonb_build_object('summary', 'Owner handoff, safety equipment, systems orientation, manuals and support relationships'), jsonb_build_object('standard_state', 'model_expected'), jsonb_build_object('source', 'Keepr curated from buyer guide structure'), 3001);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.care', 'playbook', 'playbook.generator_care', 'Generator care', jsonb_build_object('system_key', 'system.generator'), jsonb_build_object('standard_state', 'model_expected'), jsonb_build_object('source', 'Keepr curated from standard generator presence'), 3002);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.care', 'playbook', 'playbook.electronics_onboarding', 'Electronics onboarding', jsonb_build_object('system_key', 'system.garmin_integrated_electronics'), jsonb_build_object('standard_state', 'model_expected'), jsonb_build_object('source', 'Keepr curated from standard electronics package'), 3003);

  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, null, 'section', 'brochure.resources', 'Resources', '{}'::jsonb, '{}'::jsonb, jsonb_build_object('display_group', 'resources'), 4000);
  perform pg_temp.activator_upsert_template_item(v_tiara_template_id, v_resource_id, 'brochure.resources', 'resource', 'resource.buyers_guide_my2027', 'MY2027 39 LE Buyer''s Guide', jsonb_build_object('resource_id', v_resource_id), jsonb_build_object('standard_state', 'source'), jsonb_build_object('brochure_heading', '2027 STANDARDS & OPTIONS'), 4001);

  if v_demo_owner_id is null then
    return;
  end if;

  insert into public.assets (
    owner_id,
    name,
    type,
    status,
    asset_mode,
    year,
    make,
    model,
    kac_id,
    created_at,
    extra_metadata
  )
  select
    v_demo_owner_id,
    'Demo MY2027 Tiara 39 LE',
    'boat',
    'active',
    'personal',
    2027,
    'Tiara Yachts',
    '39 LE',
    'KAC-TIARA-39LE-MY2027-DEMO',
    now(),
    jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01', 'template_key', 'tiara-2027-39-le')
  where not exists (
    select 1 from public.assets where kac_id = 'KAC-TIARA-39LE-MY2027-DEMO'
  );

  select id into v_asset_id
  from public.assets
  where kac_id = 'KAC-TIARA-39LE-MY2027-DEMO'
  limit 1;

  if v_asset_id is null then
    return;
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
    v_tiara_template_id,
    1,
    'verified',
    'oem',
    1.0000,
    v_resource_id,
    v_demo_owner_id,
    jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01', 'configured_hull_demo', true)
  )
  on conflict (asset_id)
  where binding_status in ('suggested', 'inherited', 'verified')
  do update
    set template_id = excluded.template_id,
        template_version = excluded.template_version,
        binding_status = excluded.binding_status,
        binding_source = excluded.binding_source,
        confidence = excluded.confidence,
        source_resource_id = excluded.source_resource_id,
        metadata = public.asset_template_bindings.metadata || excluded.metadata
  returning id into v_binding_id;

  insert into public.asset_relationships (
    asset_id,
    user_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    initiated_by_user_id,
    metadata
  )
  values (
    v_asset_id,
    v_demo_owner_id,
    'owner',
    'active',
    'owner_full',
    'not_applicable',
    v_demo_owner_id,
    jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01')
  )
  on conflict (asset_id, user_id, relationship_type)
  where status = 'active' and user_id is not null
  do update
    set access_scope = 'owner_full',
        claim_state = 'not_applicable',
        metadata = public.asset_relationships.metadata || excluded.metadata,
        updated_at = now();

  if v_tiara_org_id is not null then
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
      v_demo_owner_id,
      v_tiara_org_id,
      v_resource_id,
      jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01', 'projection_statement', 'The boat we built')
    )
    on conflict (asset_id, organization_id, relationship_type, coalesce(org_location_id, '00000000-0000-0000-0000-000000000000'::uuid))
    where status = 'active' and organization_id is not null
    do update
      set access_scope = 'oem_context',
          source_resource_id = excluded.source_resource_id,
          metadata = public.asset_relationships.metadata || excluded.metadata,
          updated_at = now()
    returning id into v_oem_relationship_id;
  end if;

  if v_skipperbuds_org_id is not null then
    insert into public.asset_relationships (
      asset_id,
      organization_id,
      org_location_id,
      relationship_type,
      status,
      access_scope,
      claim_state,
      initiated_by_user_id,
      initiated_by_org_id,
      metadata
    )
    values (
      v_asset_id,
      v_skipperbuds_org_id,
      v_lake_fenton_location_id,
      'delivery_dealer',
      'active',
      'service_workspace',
      'unclaimed_org',
      v_demo_owner_id,
      v_skipperbuds_org_id,
      jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01', 'projection_statement', 'The boat we delivered/support')
    )
    on conflict (asset_id, organization_id, relationship_type, coalesce(org_location_id, '00000000-0000-0000-0000-000000000000'::uuid))
    where status = 'active' and organization_id is not null
    do update
      set access_scope = 'service_workspace',
          metadata = public.asset_relationships.metadata || excluded.metadata,
          updated_at = now()
    returning id into v_dealer_relationship_id;
  end if;

  insert into public.asset_facts (
    asset_id,
    template_item_id,
    fact_key,
    fact_value,
    authority_state,
    confidence,
    subject_type,
    asserted_by_user_id,
    source_resource_id,
    metadata
  )
  select
    v_asset_id,
    item.id,
    seed.fact_key,
    seed.fact_value,
    seed.authority_state,
    seed.confidence,
    seed.subject_type,
    v_demo_owner_id,
    v_resource_id,
    seed.metadata
  from (
    values
      ('hin', null::text, to_jsonb('TYA39LE27D01'::text), 'dealer_confirmed', 0.9500, 'asset', jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01')),
      ('option.selected', 'option.propulsion.twin_mercury_600_v12', to_jsonb(true), 'dealer_confirmed', 0.9500, 'equipment', jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01', 'installed_state', 'selected_demo')),
      ('option.selected', 'option.aft_module.adventure', to_jsonb(true), 'dealer_confirmed', 0.9500, 'equipment', jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01', 'installed_state', 'selected_demo')),
      ('option.selected', 'option.mechanical.seakeeper_sk45', to_jsonb(true), 'dealer_confirmed', 0.9500, 'equipment', jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01', 'installed_state', 'selected_demo')),
      ('option.selected', 'option.electronics.garmin_fantom_54', to_jsonb(true), 'dealer_confirmed', 0.9500, 'equipment', jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01', 'installed_state', 'selected_demo')),
      ('option.selected', 'option.electronics.starlink', to_jsonb(true), 'dealer_confirmed', 0.9500, 'equipment', jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01', 'installed_state', 'selected_demo'))
  ) as seed(fact_key, item_key, fact_value, authority_state, confidence, subject_type, metadata)
  left join public.asset_model_template_items item
    on item.template_id = v_tiara_template_id
   and lower(item.canonical_key) = lower(seed.item_key)
  where not exists (
    select 1
    from public.asset_facts f
    where f.asset_id = v_asset_id
      and f.fact_key = seed.fact_key
      and coalesce(f.template_item_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(item.id, '00000000-0000-0000-0000-000000000000'::uuid)
      and f.active = true
      and f.authority_state not in ('superseded', 'disputed')
  );

  insert into public.asset_activation_workflows (
    asset_id,
    kac_id,
    initiating_org_id,
    acting_member_id,
    template_id,
    template_binding_id,
    activation_type,
    vessel_state,
    owner_user_id,
    dealer_relationship_id,
    oem_relationship_id,
    status,
    readiness_summary,
    created_by,
    activated_at,
    metadata
  )
  select
    v_asset_id,
    'KAC-TIARA-39LE-MY2027-DEMO',
    v_tiara_org_id,
    v_demo_owner_id,
    v_tiara_template_id,
    v_binding_id,
    'oem_first',
    'activated',
    v_demo_owner_id,
    v_dealer_relationship_id,
    v_oem_relationship_id,
    'activated',
    jsonb_build_object('catalog', 'published', 'hull_configuration', 'demo_selected', 'dealer_handoff', 'ready', 'owner_handoff', 'ready'),
    v_demo_owner_id,
    now(),
    jsonb_build_object('demo', true, 'demo_purpose', 'activator_use_case_01', 'same_asset_statement', 'This is no longer a brochure. This is this boat.')
  where not exists (
    select 1 from public.asset_activation_workflows
    where asset_id = v_asset_id
      and metadata ->> 'demo_purpose' = 'activator_use_case_01'
  );
end $$;
