-- Activator Use Case 01: Tiara 39 LE/39 LS operational manuals.
-- These rows model manuals as shared/versioned template resources that flow
-- into exact hull activations. They do not duplicate asset/hull documents.

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
      select jsonb_agg(to_jsonb(r) order by coalesce((r.metadata ->> 'sort_order')::integer, 999), r.created_at, r.title)
      from public.asset_resources r
      where (r.applies_to_type = 'template' and r.applies_to_id = v_template.id)
         or r.id = v_template.source_resource_id
         or ((r.metadata -> 'template_keys') ? lower(v_template.template_key))
         or (
           r.applies_to_type = 'template_item'
           and exists (
             select 1
             from public.asset_model_template_items mapped_item
             where mapped_item.id = r.applies_to_id
               and mapped_item.template_id = v_template.id
           )
         )
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

grant execute on function public.get_catalog_template_detail(uuid, text) to authenticated;

do $$
declare
  v_tiara_org_id uuid;
  v_ls_template_id uuid;
  v_owner_manual_id uuid;
  v_mercury_manual_id uuid;
  v_template_keys jsonb := '["tiara-2027-39-le", "tiara-2027-39-ls"]'::jsonb;
  v_owner_keys jsonb := '[
    "equipment.full_beam_hardtop",
    "equipment.hardtop_skylight",
    "equipment.hull_side_terrace",
    "equipment.makefast_sunshade",
    "equipment.tilting_helm_console",
    "equipment.queen_berth",
    "system.cabin_ac",
    "system.electronics_package",
    "system.garmin_integrated_electronics",
    "system.generator",
    "system.trim_tabs",
    "equipment.starlink_prewire",
    "option.electronics.garmin_fantom_54",
    "option.electronics.starlink",
    "option.electronics.flir_m232",
    "option.mechanical.seakeeper_sk45",
    "option.mechanical.zipwake_pro_trim_tabs"
  ]'::jsonb;
  v_mercury_keys jsonb := '[
    "option.propulsion.twin_mercury_600_v12"
  ]'::jsonb;
begin
  select id into v_tiara_org_id
  from public.orgs
  where slug = 'tiara-yachts'
  limit 1;

  select id into v_ls_template_id
  from public.asset_model_templates
  where lower(template_key) = 'tiara-2027-39-ls'
  order by version desc
  limit 1;

  if v_tiara_org_id is null or v_ls_template_id is null then
    raise notice 'Skipping Tiara manual resources because Tiara org or 39 LS template is missing.';
    return;
  end if;

  select id into v_owner_manual_id
  from public.asset_resources
  where metadata ->> 'document_key' = 'tiara_39ls_owners_manual_my2026'
  order by created_at
  limit 1;

  if v_owner_manual_id is null then
    insert into public.asset_resources (
      resource_type, title, url, source_name, source_platform, source_url,
      captured_at, authority_state, rights_status, applies_to_type, applies_to_id, metadata
    )
    values (
      'manual',
      'Tiara Yachts 39 LS Owner''s Manual MY2026',
      null,
      'Tiara Yachts',
      'OEM owner manual PDF',
      '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LS_Owners_Manual_MY2026.pdf',
      '2026-05-11T07:38:32-04:00',
      'oem_published',
      'private',
      'template',
      v_ls_template_id,
      jsonb_build_object(
        'document_key', 'tiara_39ls_owners_manual_my2026',
        'document_family', 'tiara_39ls_owners_manual',
        'resource_version', 1,
        'version_label', 'MY2026',
        'document_kind', 'owners_manual',
        'template_keys', v_template_keys,
        'mapped_canonical_keys', v_owner_keys,
        'source_file', 'Tiara_Yachts__39_LS_Owners_Manual_MY2026.pdf',
        'sha256', '1d61178b5803936ee75ad5cbe53f67d8db33d14b2aa0a8ef59eb0ec49fbac9dc',
        'page_count', 204,
        'file_size_bytes', 32875991,
        'created_in_pdf_at', '2026-05-07T15:02:28-04:00',
        'modified_in_pdf_at', '2026-05-11T07:38:32-04:00',
        'usage_scope', 'model_template_operational_manual',
        'flowdown_role', 'owner_operational_manual',
        'sort_order', 410
      )
    )
    returning id into v_owner_manual_id;
  else
    update public.asset_resources
    set
      title = 'Tiara Yachts 39 LS Owner''s Manual MY2026',
      resource_type = 'manual',
      source_name = 'Tiara Yachts',
      source_platform = 'OEM owner manual PDF',
      source_url = '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LS_Owners_Manual_MY2026.pdf',
      captured_at = '2026-05-11T07:38:32-04:00',
      authority_state = 'oem_published',
      rights_status = 'private',
      applies_to_type = 'template',
      applies_to_id = v_ls_template_id,
      metadata = metadata || jsonb_build_object(
        'template_keys', v_template_keys,
        'mapped_canonical_keys', v_owner_keys,
        'resource_version', 1,
        'version_label', 'MY2026',
        'sha256', '1d61178b5803936ee75ad5cbe53f67d8db33d14b2aa0a8ef59eb0ec49fbac9dc',
        'page_count', 204,
        'file_size_bytes', 32875991,
        'flowdown_role', 'owner_operational_manual',
        'sort_order', 410
      ),
      updated_at = now()
    where id = v_owner_manual_id;
  end if;

  select id into v_mercury_manual_id
  from public.asset_resources
  where metadata ->> 'document_key' = 'tiara_39ls_twin_mercury_600_my2026'
  order by created_at
  limit 1;

  if v_mercury_manual_id is null then
    insert into public.asset_resources (
      resource_type, title, url, source_name, source_platform, source_url,
      captured_at, authority_state, rights_status, applies_to_type, applies_to_id, metadata
    )
    values (
      'manual',
      'Tiara 39 LS Twin Mercury 600 Propulsion Manual',
      null,
      'Tiara Yachts',
      'OEM propulsion manual PDF',
      '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LS_Twin_Mercury_600.pdf',
      '2025-08-07T12:30:02-04:00',
      'oem_published',
      'private',
      'template',
      v_ls_template_id,
      jsonb_build_object(
        'document_key', 'tiara_39ls_twin_mercury_600_my2026',
        'document_family', 'tiara_39ls_propulsion_manual',
        'resource_version', 1,
        'version_label', 'Twin Mercury 600',
        'document_kind', 'propulsion_manual',
        'template_keys', v_template_keys,
        'mapped_canonical_keys', v_mercury_keys,
        'source_file', 'Tiara_Yachts__39_LS_Twin_Mercury_600.pdf',
        'sha256', '142adc09afaa365c8a74cb4ceed7c781f6b638dcabca1b7f95fbe98bdb0b9a76',
        'page_count', 1,
        'file_size_bytes', 104685,
        'created_in_pdf_at', '2025-08-07T12:30:02-04:00',
        'modified_in_pdf_at', '2025-08-07T12:30:02-04:00',
        'usage_scope', 'model_template_operational_manual',
        'flowdown_role', 'selected_propulsion_manual',
        'sort_order', 420
      )
    )
    returning id into v_mercury_manual_id;
  else
    update public.asset_resources
    set
      title = 'Tiara 39 LS Twin Mercury 600 Propulsion Manual',
      resource_type = 'manual',
      source_name = 'Tiara Yachts',
      source_platform = 'OEM propulsion manual PDF',
      source_url = '/Users/andydrake/Documents/keepr/demo documents/Tiara Yachts/Tiara_Yachts__39_LS_Twin_Mercury_600.pdf',
      captured_at = '2025-08-07T12:30:02-04:00',
      authority_state = 'oem_published',
      rights_status = 'private',
      applies_to_type = 'template',
      applies_to_id = v_ls_template_id,
      metadata = metadata || jsonb_build_object(
        'template_keys', v_template_keys,
        'mapped_canonical_keys', v_mercury_keys,
        'resource_version', 1,
        'version_label', 'Twin Mercury 600',
        'sha256', '142adc09afaa365c8a74cb4ceed7c781f6b638dcabca1b7f95fbe98bdb0b9a76',
        'page_count', 1,
        'file_size_bytes', 104685,
        'flowdown_role', 'selected_propulsion_manual',
        'sort_order', 420
      ),
      updated_at = now()
    where id = v_mercury_manual_id;
  end if;

  update public.asset_model_template_items item
  set
    metadata = item.metadata || jsonb_build_object(
      'related_manual_resource_keys',
      coalesce(item.metadata -> 'related_manual_resource_keys', '[]'::jsonb) || '["tiara_39ls_owners_manual_my2026"]'::jsonb
    ),
    updated_at = now()
  from public.asset_model_templates template
  where item.template_id = template.id
    and lower(template.template_key) in ('tiara-2027-39-le', 'tiara-2027-39-ls')
    and v_owner_keys ? item.canonical_key;

  update public.asset_model_template_items item
  set
    metadata = item.metadata || jsonb_build_object(
      'related_manual_resource_keys',
      coalesce(item.metadata -> 'related_manual_resource_keys', '[]'::jsonb) || '["tiara_39ls_twin_mercury_600_my2026"]'::jsonb
    ),
    updated_at = now()
  from public.asset_model_templates template
  where item.template_id = template.id
    and lower(template.template_key) in ('tiara-2027-39-le', 'tiara-2027-39-ls')
    and v_mercury_keys ? item.canonical_key;
end;
$$;
