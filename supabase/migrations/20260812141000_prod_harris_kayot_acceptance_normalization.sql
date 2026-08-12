-- Narrow production data normalization for Andy's existing Harris acceptance
-- asset. This migration intentionally preserves all legacy service records,
-- attachments, reminders, asset_stewardships, and asset_provider_stewardships.
--
-- Acceptance asset:
--   9733c254-579b-47ab-8b51-593b1d44f8fa
-- Existing Wilson KPC:
--   org_id       6ad2fe13-c1b5-40c7-bb2f-6d1c454e0a8d
--   keepr_pro_id b570b6b3-6c44-4925-a44e-d39bb22f2816

do $$
declare
  v_asset_id uuid := '9733c254-579b-47ab-8b51-593b1d44f8fa';
  v_owner_id uuid := 'b508214b-f076-4526-b126-7fc85a2297f2';
  v_wilson_org_id uuid := '6ad2fe13-c1b5-40c7-bb2f-6d1c454e0a8d';
  v_wilson_kp_id uuid := 'b570b6b3-6c44-4925-a44e-d39bb22f2816';
  v_harris_org_id uuid;
  v_harris_kp_id uuid;
  v_mercury_org_id uuid;
  v_mercury_kp_id uuid;
  v_resource_id uuid;
begin
  if not exists (
    select 1
    from public.assets
    where id = v_asset_id
      and owner_id = v_owner_id
      and name = '2009 Harris Kayot'
      and make = 'Harris'
      and model = 'Kayot V220i'
  ) then
    raise exception 'Acceptance asset does not match expected production Harris Kayot row';
  end if;

  if not exists (
    select 1
    from public.orgs
    where id = v_wilson_org_id
      and lower(coalesce(display_name, name)) = 'wilson marine'
  ) then
    raise exception 'Expected existing Wilson Marine organization is missing';
  end if;

  if not exists (
    select 1
    from public.keepr_pros
    where id = v_wilson_kp_id
      and organization_id = v_wilson_org_id
  ) then
    raise exception 'Expected existing Wilson Marine KeeprPro is missing or not linked';
  end if;

  update public.orgs
  set
    legal_name = coalesce(legal_name, name),
    kpc_category = coalesce(kpc_category, 'marine'),
    kpc_capabilities = case
      when jsonb_array_length(coalesce(kpc_capabilities, '[]'::jsonb)) = 0
        then '["dealer","service_provider","storage","delivery"]'::jsonb
      else kpc_capabilities
    end,
    authority_state = coalesce(nullif(authority_state, ''), 'org_confirmed'),
    source_metadata = coalesce(source_metadata, '{}'::jsonb)
      || '{"acceptance_reused_existing_wilson_org":true}'::jsonb,
    updated_at = now()
  where id = v_wilson_org_id;

  update public.keepr_pros
  set
    categories = case
      when jsonb_array_length(coalesce(categories, '[]'::jsonb)) = 0
        then '["marine"]'::jsonb
      else categories
    end,
    source_metadata = coalesce(source_metadata, '{}'::jsonb)
      || '{"acceptance_reused_existing_wilson_keepr_pro":true}'::jsonb,
    updated_at = now()
  where id = v_wilson_kp_id;

  select id
  into v_harris_org_id
  from public.orgs
  where public.kpc_slugify(coalesce(slug, display_name, name)) in ('harris', 'harris-boats')
     or public.kpc_normalize_text(coalesce(display_name, name)) in ('harris', 'harris boats')
  order by created_at asc nulls last
  limit 1;

  if v_harris_org_id is null then
    insert into public.orgs (
      name,
      display_name,
      legal_name,
      slug,
      org_type,
      organization_type,
      workspace_type,
      status,
      authority_state,
      source_type,
      source_name,
      source_url,
      source_metadata,
      kpc_category,
      kpc_capabilities,
      updated_at
    )
    values (
      'Harris Boats',
      'Harris Boats',
      'Harris Boats',
      'harris-boats',
      'manufacturer',
      'manufacturer',
      'keeproem',
      'active',
      'public_source_reported',
      'acceptance_normalization',
      'Existing production Harris Kayot acceptance asset',
      null,
      jsonb_build_object(
        'source_asset_id', v_asset_id,
        'source_asset_name', '2009 Harris Kayot',
        'normalization_scope', 'production_acceptance'
      ),
      'marine',
      '["oem_builder","owner_resources","dealer_locator"]'::jsonb,
      now()
    )
    returning id into v_harris_org_id;
  end if;

  select id
  into v_harris_kp_id
  from public.keepr_pros
  where organization_id = v_harris_org_id
  order by created_at asc nulls last
  limit 1;

  if v_harris_kp_id is null then
    insert into public.keepr_pros (
      user_id,
      organization_id,
      name,
      display_name,
      category,
      website,
      since_label,
      last_service,
      is_favorite,
      assets,
      service_history,
      source,
      claimed_state,
      profile_status,
      publish_status,
      categories,
      source_metadata
    )
    values (
      null,
      v_harris_org_id,
      'Harris Boats',
      'Harris Boats',
      'marine',
      'https://www.harrisboats.com/',
      'Canonical manufacturer',
      null,
      false,
      '[]'::jsonb,
      '[]'::jsonb,
      'acceptance_normalization',
      'unclaimed',
      'draft',
      'draft',
      '["marine","manufacturer"]'::jsonb,
      jsonb_build_object(
        'created_from', 'prod_harris_kayot_acceptance_normalization',
        'source_asset_id', v_asset_id
      )
    )
    returning id into v_harris_kp_id;
  end if;

  select id
  into v_mercury_org_id
  from public.orgs
  where public.kpc_slugify(coalesce(slug, display_name, name)) in ('mercury', 'mercury-marine')
     or public.kpc_normalize_text(coalesce(display_name, name)) in ('mercury', 'mercury marine')
  order by created_at asc nulls last
  limit 1;

  if v_mercury_org_id is null then
    insert into public.orgs (
      name,
      display_name,
      legal_name,
      slug,
      org_type,
      organization_type,
      workspace_type,
      status,
      authority_state,
      source_type,
      source_name,
      source_metadata,
      kpc_category,
      kpc_capabilities,
      updated_at
    )
    values (
      'Mercury Marine',
      'Mercury Marine',
      'Mercury Marine',
      'mercury-marine',
      'manufacturer',
      'manufacturer',
      'keeproem',
      'active',
      'public_source_reported',
      'acceptance_normalization',
      'Existing production Harris Kayot engine context',
      jsonb_build_object(
        'source_asset_id', v_asset_id,
        'evidence', 'Existing attachment title: 5.0 Mercury Mercruiser, MPI V8',
        'normalization_scope', 'production_acceptance'
      ),
      'marine',
      '["oem_builder","parts","owner_resources","dealer_locator"]'::jsonb,
      now()
    )
    returning id into v_mercury_org_id;
  end if;

  select id
  into v_mercury_kp_id
  from public.keepr_pros
  where organization_id = v_mercury_org_id
  order by created_at asc nulls last
  limit 1;

  if v_mercury_kp_id is null then
    insert into public.keepr_pros (
      user_id,
      organization_id,
      name,
      display_name,
      category,
      website,
      since_label,
      last_service,
      is_favorite,
      assets,
      service_history,
      source,
      claimed_state,
      profile_status,
      publish_status,
      categories,
      source_metadata
    )
    values (
      null,
      v_mercury_org_id,
      'Mercury Marine',
      'Mercury Marine',
      'marine',
      'https://www.mercurymarine.com/',
      'Canonical engine manufacturer',
      null,
      false,
      '[]'::jsonb,
      '[]'::jsonb,
      'acceptance_normalization',
      'unclaimed',
      'draft',
      'draft',
      '["marine","manufacturer"]'::jsonb,
      jsonb_build_object(
        'created_from', 'prod_harris_kayot_acceptance_normalization',
        'source_asset_id', v_asset_id
      )
    )
    returning id into v_mercury_kp_id;
  end if;

  insert into public.kpc_external_identities (
    organization_id,
    keepr_pro_id,
    source_type,
    external_id,
    source_url,
    raw_types,
    source_metadata,
    authority_state
  )
  values
    (v_harris_org_id, v_harris_kp_id, 'alias', 'harris', null, '["alias"]'::jsonb, '{"source":"acceptance_normalization"}'::jsonb, 'public_source_reported'),
    (v_harris_org_id, v_harris_kp_id, 'alias', 'harris boats', null, '["alias"]'::jsonb, '{"source":"acceptance_normalization"}'::jsonb, 'public_source_reported'),
    (v_harris_org_id, v_harris_kp_id, 'official_domain', 'harrisboats.com', 'https://www.harrisboats.com/', '["domain"]'::jsonb, '{"source":"acceptance_normalization"}'::jsonb, 'public_source_reported'),
    (v_mercury_org_id, v_mercury_kp_id, 'alias', 'mercury', null, '["alias"]'::jsonb, '{"source":"acceptance_normalization"}'::jsonb, 'public_source_reported'),
    (v_mercury_org_id, v_mercury_kp_id, 'alias', 'mercury marine', null, '["alias"]'::jsonb, '{"source":"acceptance_normalization"}'::jsonb, 'public_source_reported'),
    (v_mercury_org_id, v_mercury_kp_id, 'alias', 'mercruiser', null, '["alias"]'::jsonb, '{"source":"acceptance_normalization"}'::jsonb, 'public_source_reported'),
    (v_mercury_org_id, v_mercury_kp_id, 'official_domain', 'mercurymarine.com', 'https://www.mercurymarine.com/', '["domain"]'::jsonb, '{"source":"acceptance_normalization"}'::jsonb, 'public_source_reported'),
    (v_wilson_org_id, v_wilson_kp_id, 'alias', 'wilson marine', 'https://www.wilsonboats.com', '["alias"]'::jsonb, '{"source":"acceptance_normalization","reused_existing":true}'::jsonb, 'org_confirmed'),
    (v_wilson_org_id, v_wilson_kp_id, 'official_domain', 'wilsonboats.com', 'https://www.wilsonboats.com', '["domain"]'::jsonb, '{"source":"acceptance_normalization","reused_existing":true}'::jsonb, 'org_confirmed')
  on conflict (lower(source_type), external_id) do update
    set organization_id = excluded.organization_id,
        keepr_pro_id = coalesce(excluded.keepr_pro_id, public.kpc_external_identities.keepr_pro_id),
        source_url = coalesce(public.kpc_external_identities.source_url, excluded.source_url),
        source_metadata = public.kpc_external_identities.source_metadata || excluded.source_metadata,
        last_seen_at = now(),
        updated_at = now();

  select id
  into v_resource_id
  from public.asset_resources
  where metadata ->> 'normalization_key' = 'harris-kayot-acceptance-asset'
  limit 1;

  if v_resource_id is null then
    insert into public.asset_resources (
      resource_type,
      title,
      authority_state,
      rights_status,
      applies_to_type,
      applies_to_id,
      source_name,
      metadata,
      created_by
    )
    values (
      'source_snapshot',
      'Existing production Harris Kayot acceptance asset',
      'owner_confirmed',
      'private',
      'asset',
      v_asset_id,
      'Production asset row',
      jsonb_build_object(
        'normalization_key', 'harris-kayot-acceptance-asset',
        'asset_id', v_asset_id,
        'owner_id', v_owner_id,
        'make', 'Harris',
        'model', 'Kayot V220i',
        'year', 2009
      ),
      v_owner_id
    )
    returning id into v_resource_id;
  end if;

  insert into public.org_relationships (
    from_org_id,
    to_org_id,
    relationship_type,
    status,
    source_resource_id,
    evidence_state,
    authority_state,
    source_name,
    metadata,
    created_by
  )
  select
    v_wilson_org_id,
    v_harris_org_id,
    'represented_brand',
    'source_reported',
    v_resource_id,
    'public_source_reported',
    'public_source_reported',
    'Existing Harris Kayot acceptance normalization',
    jsonb_build_object(
      'normalization_key', 'wilson-represents-harris-acceptance',
      'source_asset_id', v_asset_id,
      'note', 'Acceptance relationship only; not a broad marine brand seed.'
    ),
    v_owner_id
  where not exists (
    select 1
    from public.org_relationships
    where from_org_id = v_wilson_org_id
      and to_org_id = v_harris_org_id
      and relationship_type = 'represented_brand'
      and status in ('source_reported', 'active')
  );

  insert into public.asset_relationships (
    asset_id,
    user_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    source_resource_id,
    initiated_by_user_id,
    metadata
  )
  select
    v_asset_id,
    v_owner_id,
    'owner',
    'active',
    'owner_full',
    'accepted',
    v_resource_id,
    v_owner_id,
    jsonb_build_object('normalization_key', 'harris-kayot-owner-andy')
  where not exists (
    select 1
    from public.asset_relationships
    where asset_id = v_asset_id
      and user_id = v_owner_id
      and relationship_type = 'owner'
      and status = 'active'
  );

  insert into public.asset_relationships (
    asset_id,
    organization_id,
    keepr_pro_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    source_resource_id,
    initiated_by_user_id,
    metadata
  )
  select
    v_asset_id,
    v_harris_org_id,
    v_harris_kp_id,
    'oem',
    'active',
    'oem_context',
    'claimed_org',
    v_resource_id,
    v_owner_id,
    jsonb_build_object(
      'normalization_key', 'harris-kayot-manufacturer-harris',
      'relationship_purpose', 'manufacturer',
      'evidence', 'asset.make/model'
    )
  where not exists (
    select 1
    from public.asset_relationships
    where asset_id = v_asset_id
      and organization_id = v_harris_org_id
      and relationship_type = 'oem'
      and status = 'active'
  );

  insert into public.asset_relationships (
    asset_id,
    organization_id,
    keepr_pro_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    source_resource_id,
    initiated_by_user_id,
    metadata
  )
  select
    v_asset_id,
    v_wilson_org_id,
    v_wilson_kp_id,
    'service_provider',
    'active',
    'service_workspace',
    'claimed_org',
    v_resource_id,
    v_owner_id,
    jsonb_build_object(
      'normalization_key', 'harris-kayot-provider-wilson',
      'relationship_purpose', 'dealer_provider',
      'legacy_asset_provider_stewardship_preserved', true
    )
  where not exists (
    select 1
    from public.asset_relationships
    where asset_id = v_asset_id
      and organization_id = v_wilson_org_id
      and relationship_type = 'service_provider'
      and status = 'active'
  );

  insert into public.asset_relationships (
    asset_id,
    organization_id,
    keepr_pro_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    source_resource_id,
    initiated_by_user_id,
    metadata
  )
  select
    v_asset_id,
    v_mercury_org_id,
    v_mercury_kp_id,
    'oem',
    'active',
    'oem_context',
    'unclaimed_org',
    v_resource_id,
    v_owner_id,
    jsonb_build_object(
      'normalization_key', 'harris-kayot-engine-mercury',
      'relationship_purpose', 'engine_manufacturer_context',
      'component_scope', 'engine',
      'evidence', 'Existing attachment title: 5.0 Mercury Mercruiser, MPI V8'
    )
  where not exists (
    select 1
    from public.asset_relationships
    where asset_id = v_asset_id
      and organization_id = v_mercury_org_id
      and relationship_type = 'oem'
      and status = 'active'
      and metadata ->> 'component_scope' = 'engine'
  );
end;
$$;
