-- Activator demo identity / projection setup.
-- Demo memberships prove authorization paths without changing real-world
-- organization claim state or duplicating canonical assets/orgs.

alter table public.org_members
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists org_members_demo_metadata_idx
  on public.org_members ((metadata ->> 'demo_purpose'))
  where metadata ? 'demo_purpose';

do $$
declare
  v_demo_owner_id uuid;
  v_tiara_user_id uuid;
  v_skipperbuds_user_id uuid;
  v_wilson_user_id uuid;
  v_tiara_org_id uuid;
  v_skipperbuds_org_id uuid;
  v_wilson_org_id uuid;
  v_lake_fenton_location_id uuid;
  v_template_id uuid;
  v_template_version integer;
  v_asset_id uuid;
  v_binding_id uuid;
  v_oem_relationship_id uuid;
  v_dealer_relationship_id uuid;
begin
  select id into v_demo_owner_id
  from public.profiles
  where lower(email) = 'demo@keeprhome.com'
  limit 1;

  select id into v_tiara_user_id
  from public.profiles
  where lower(email) = 'tiara@keeprhome.com'
  limit 1;

  select id into v_skipperbuds_user_id
  from public.profiles
  where lower(email) = 'skipperbuds@keeprhome.com'
  limit 1;

  select id into v_wilson_user_id
  from public.profiles
  where lower(email) = 'wilson@keeprhome.com'
  limit 1;

  select id into v_tiara_org_id
  from public.orgs
  where lower(slug) = 'tiara-yachts'
  limit 1;

  select id into v_skipperbuds_org_id
  from public.orgs
  where lower(slug) = 'skipperbuds'
  limit 1;

  select id into v_wilson_org_id
  from public.orgs
  where lower(slug) = 'wilsonmarine'
  limit 1;

  select id into v_lake_fenton_location_id
  from public.org_locations
  where organization_id = v_skipperbuds_org_id
    and lower(external_source_id) = 'skipperbuds-lake-fenton-marina'
  limit 1;

  select id, version into v_template_id, v_template_version
  from public.asset_model_templates
  where lower(template_key) = 'tiara-2026-39-le'
    and version = 1
  limit 1;

  if v_tiara_user_id is not null and v_tiara_org_id is not null then
    insert into public.org_members (
      org_id,
      user_id,
      member_role,
      role,
      status,
      joined_at,
      metadata
    )
    values (
      v_tiara_org_id,
      v_tiara_user_id,
      'member',
      'member',
      'active',
      now(),
      jsonb_build_object(
        'demo', true,
        'demo_membership', true,
        'demo_purpose', 'activator_projection_demo',
        'projection', 'oem',
        'real_world_claim_state_override', false
      )
    )
    on conflict (org_id, user_id) do update
      set status = 'active',
          member_role = coalesce(public.org_members.member_role, excluded.member_role),
          role = coalesce(public.org_members.role, excluded.role),
          metadata = public.org_members.metadata || excluded.metadata;
  end if;

  if v_skipperbuds_user_id is not null and v_skipperbuds_org_id is not null then
    insert into public.org_members (
      org_id,
      user_id,
      member_role,
      role,
      status,
      joined_at,
      metadata
    )
    values (
      v_skipperbuds_org_id,
      v_skipperbuds_user_id,
      'member',
      'member',
      'active',
      now(),
      jsonb_build_object(
        'demo', true,
        'demo_membership', true,
        'demo_purpose', 'activator_projection_demo',
        'projection', 'dealer',
        'real_world_claim_state_override', false
      )
    )
    on conflict (org_id, user_id) do update
      set status = 'active',
          member_role = coalesce(public.org_members.member_role, excluded.member_role),
          role = coalesce(public.org_members.role, excluded.role),
          metadata = public.org_members.metadata || excluded.metadata;
  end if;

  if v_wilson_user_id is not null and v_wilson_org_id is not null then
    insert into public.org_members (
      org_id,
      user_id,
      member_role,
      role,
      status,
      joined_at,
      metadata
    )
    values (
      v_wilson_org_id,
      v_wilson_user_id,
      'member',
      'member',
      'active',
      now(),
      jsonb_build_object(
        'demo', true,
        'demo_membership', true,
        'demo_purpose', 'activator_projection_demo',
        'projection', 'service_provider',
        'real_world_claim_state_override', false
      )
    )
    on conflict (org_id, user_id) do update
      set status = 'active',
          member_role = coalesce(public.org_members.member_role, excluded.member_role),
          role = coalesce(public.org_members.role, excluded.role),
          metadata = public.org_members.metadata || excluded.metadata;
  end if;

  if v_demo_owner_id is null
     or v_tiara_org_id is null
     or v_skipperbuds_org_id is null
     or v_lake_fenton_location_id is null
     or v_template_id is null then
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
    created_at
  )
  select
    v_demo_owner_id,
    'Demo Tiara 39 LE',
    'boat',
    'active',
    'personal',
    2026,
    'Tiara Yachts',
    '39 LE',
    'KAC-TIARA-39LE-DEMO',
    now()
  where not exists (
    select 1
    from public.assets
    where kac_id = 'KAC-TIARA-39LE-DEMO'
  );

  select id into v_asset_id
  from public.assets
  where kac_id = 'KAC-TIARA-39LE-DEMO'
  limit 1;

  if v_asset_id is null then
    return;
  end if;

  update public.assets
  set owner_id = v_demo_owner_id,
      name = coalesce(nullif(name, ''), 'Demo Tiara 39 LE'),
      type = 'boat',
      status = 'active',
      asset_mode = coalesce(asset_mode, 'personal'),
      year = coalesce(year, 2026),
      make = coalesce(nullif(make, ''), 'Tiara Yachts'),
      model = coalesce(nullif(model, ''), '39 LE')
  where id = v_asset_id;

  insert into public.asset_template_bindings (
    asset_id,
    template_id,
    template_version,
    binding_status,
    binding_source,
    confidence,
    created_by,
    metadata
  )
  select
    v_asset_id,
    v_template_id,
    v_template_version,
    'verified',
    'oem',
    1.0000,
    v_demo_owner_id,
    jsonb_build_object(
      'demo', true,
      'demo_purpose', 'activator_projection_demo',
      'same_canonical_asset_proof', true
    )
  where not exists (
    select 1
    from public.asset_template_bindings
    where asset_id = v_asset_id
      and binding_status in ('suggested', 'inherited', 'verified')
  )
  returning id into v_binding_id;

  if v_binding_id is null then
    select id into v_binding_id
    from public.asset_template_bindings
    where asset_id = v_asset_id
      and binding_status in ('suggested', 'inherited', 'verified')
    order by created_at desc
    limit 1;
  end if;

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
    jsonb_build_object(
      'demo', true,
      'demo_purpose', 'activator_projection_demo',
      'projection', 'owner'
    )
  )
  on conflict (asset_id, user_id, relationship_type) where status = 'active' and user_id is not null
  do update
    set access_scope = 'owner_full',
        claim_state = 'not_applicable',
        metadata = public.asset_relationships.metadata || excluded.metadata,
        updated_at = now();

  insert into public.asset_relationships (
    asset_id,
    organization_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    initiated_by_user_id,
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
    jsonb_build_object(
      'demo', true,
      'demo_purpose', 'activator_projection_demo',
      'projection', 'oem',
      'real_world_claim_state_override', false
    )
  )
  on conflict (asset_id, organization_id, relationship_type, coalesce(org_location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active' and organization_id is not null
  do update
    set access_scope = 'oem_context',
        claim_state = 'unclaimed_org',
        metadata = public.asset_relationships.metadata || excluded.metadata,
        updated_at = now()
  returning id into v_oem_relationship_id;

  if v_oem_relationship_id is null then
    select id into v_oem_relationship_id
    from public.asset_relationships
    where asset_id = v_asset_id
      and organization_id = v_tiara_org_id
      and relationship_type = 'oem'
      and status = 'active'
    limit 1;
  end if;

  insert into public.asset_relationships (
    asset_id,
    organization_id,
    org_location_id,
    relationship_type,
    status,
    access_scope,
    claim_state,
    initiated_by_user_id,
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
    jsonb_build_object(
      'demo', true,
      'demo_purpose', 'activator_projection_demo',
      'projection', 'dealer',
      'location_role', 'delivery_location',
      'real_world_claim_state_override', false
    )
  )
  on conflict (asset_id, organization_id, relationship_type, coalesce(org_location_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where status = 'active' and organization_id is not null
  do update
    set access_scope = 'service_workspace',
        claim_state = 'unclaimed_org',
        metadata = public.asset_relationships.metadata || excluded.metadata,
        updated_at = now()
  returning id into v_dealer_relationship_id;

  if v_dealer_relationship_id is null then
    select id into v_dealer_relationship_id
    from public.asset_relationships
    where asset_id = v_asset_id
      and organization_id = v_skipperbuds_org_id
      and org_location_id = v_lake_fenton_location_id
      and relationship_type = 'delivery_dealer'
      and status = 'active'
    limit 1;
  end if;

  insert into public.asset_facts (
    asset_id,
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
    seed.fact_key,
    seed.fact_value,
    seed.authority_state,
    seed.confidence,
    seed.subject_type,
    v_demo_owner_id,
    null,
    seed.metadata
  from (
    values
      ('hin', to_jsonb('TYA39LE26D01'::text), 'dealer_confirmed', 0.9500, 'asset', jsonb_build_object('demo', true, 'demo_purpose', 'activator_projection_demo')),
      ('identity.manufacturer', to_jsonb('Tiara Yachts'::text), 'oem_as_built', 0.9800, 'asset', jsonb_build_object('demo', true, 'demo_purpose', 'activator_projection_demo')),
      ('identity.model_year', to_jsonb(2026), 'oem_as_built', 0.9800, 'asset', jsonb_build_object('demo', true, 'demo_purpose', 'activator_projection_demo')),
      ('identity.model', to_jsonb('39 LE'::text), 'oem_as_built', 0.9800, 'asset', jsonb_build_object('demo', true, 'demo_purpose', 'activator_projection_demo'))
  ) as seed(fact_key, fact_value, authority_state, confidence, subject_type, metadata)
  where not exists (
    select 1
    from public.asset_facts f
    where f.asset_id = v_asset_id
      and f.fact_key = seed.fact_key
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
    'KAC-TIARA-39LE-DEMO',
    v_tiara_org_id,
    v_demo_owner_id,
    v_template_id,
    v_binding_id,
    'oem_first',
    'activated',
    v_demo_owner_id,
    v_dealer_relationship_id,
    v_oem_relationship_id,
    'activated',
    jsonb_build_object(
      'identity', 'ready',
      'template_binding', 'verified',
      'owner_handoff', 'demo_complete',
      'relationship_projection_demo', true
    ),
    v_demo_owner_id,
    now(),
    jsonb_build_object(
      'demo', true,
      'demo_purpose', 'activator_projection_demo',
      'same_asset_statement', 'I changed who I am. I did not change boats.'
    )
  where not exists (
    select 1
    from public.asset_activation_workflows
    where asset_id = v_asset_id
      and metadata ->> 'demo_purpose' = 'activator_projection_demo'
  );
end;
$$;

comment on column public.org_members.metadata is
  'General membership metadata. Demo memberships may be marked here without changing organization claim state.';
