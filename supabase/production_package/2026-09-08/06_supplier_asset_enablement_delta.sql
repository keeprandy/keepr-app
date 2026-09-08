-- Production convergence delta for the 2026-09-08 combined RC.
-- DO NOT RUN until explicitly approved.
--
-- Baseline: actual production jjzjuqxysucqutgjnrkk inspected read-only on
-- 2026-09-08. Production has no 20260904+ migration ledger entries, no
-- system_templates table, and no keepr_links table yet. Therefore this file
-- must run only after 01_schema_reconciliation.sql, 02_functions_reconciliation.sql,
-- 03_compatibility_backfills.sql, and 04_curated_reference_data.sql.
--
-- This file intentionally applies only today's approved staging migrations:
-- - Supplier V1 Organization + Relationship + System Template projection.
-- - Generic asset KAC -> KeeprLINK identity sync.
-- - Exact-system promotion fix that updates an existing linked System Template.
--
-- Expected production row effects before execution:
-- - 104 active assets with kac_id will receive/upsert canonical keepr_links.
-- - Existing Tiara, Wilson, and Mercury org rows are reconciled by slug/key.
-- - Supplier orgs for Seakeeper and Cummins / Onan may be created if absent.
-- - Supplier relationships may be inserted/upserted for Tiara and Bennington.
-- - No owner assets, systems, attachments, or placements are deleted.

\echo '== before 2026-09-08 delta: protected production counts =='
select 'assets' as table_name, count(*) as rows from public.assets
union all select 'systems', count(*) from public.systems
union all select 'attachments', count(*) from public.attachments
union all select 'attachment_placements', count(*) from public.attachment_placements
order by table_name;

\echo '== before 2026-09-08 delta: active assets with kac_id =='
select count(*) as active_assets_with_kac
from public.assets
where deleted_at is null
  and nullif(btrim(coalesce(kac_id, '')), '') is not null;

begin;

\echo '== reconciling prerequisite helper functions for 2026-09-08 delta =='
-- Prerequisite from supabase/migrations/20260904100000_model_template_attachment_manager_updates.sql.
-- The supplier/org placement policies below depend on the same attachment ownership contract:
-- authenticated users may only place attachments they own, and deleted attachments are excluded.
create or replace function public.keepr_attachment_owned_by_user(
  p_user_id uuid,
  p_attachment_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select p_user_id is not null
    and p_attachment_id is not null
    and exists (
      select 1
      from public.attachments attachment
      where attachment.id = p_attachment_id
        and attachment.owner_user_id = p_user_id
        and attachment.deleted_at is null
    );
$$;

grant execute on function public.keepr_attachment_owned_by_user(uuid, uuid) to authenticated;

-- Prerequisite from supabase/migrations/20260903172000_system_template_promote_link_ops.sql.
-- The exact-system promotion function below uses this existing canonical-key contract.
create or replace function public.system_template_canonical_key(
  p_name text,
  p_manufacturer text default null
) returns text
language sql
immutable
as $$
  select 'system_template.' ||
    trim(both '_' from regexp_replace(
      lower(coalesce(nullif(p_manufacturer, ''), 'generic')),
      '[^a-z0-9]+',
      '_',
      'g'
    )) ||
    '.' ||
    trim(both '_' from regexp_replace(
      lower(coalesce(nullif(p_name, ''), 'system')),
      '[^a-z0-9]+',
      '_',
      'g'
    ));
$$;

grant execute on function public.system_template_canonical_key(text, text) to authenticated;

\echo '== applying Supplier V1 graph projection =='
-- BEGIN INLINED FROM supabase/migrations/20260908100000_supplier_graph_projection_v1.sql
-- Supplier V1: project suppliers through the canonical Ownership Graph.
--
-- No supplier-local table is introduced. Suppliers are Organizations connected
-- to OEMs by org_relationships and to reusable systems by system_templates.

alter table public.org_relationships
  drop constraint if exists org_relationships_type_check;

alter table public.org_relationships
  add constraint org_relationships_type_check
  check (relationship_type in (
    'authorized_dealer',
    'dealer_network_member',
    'oem_partner',
    'represented_brand',
    'brand_reference',
    'service_partner',
    'sales_partner',
    'marina_partner',
    'parent_company',
    'supplier',
    'system_supplier',
    'component_supplier'
  ));

create index if not exists system_templates_owner_supplier_idx
  on public.system_templates (owner_org_id, supplier_org_id)
  where supplier_org_id is not null;

create index if not exists asset_model_template_items_template_system_template_idx
  on public.asset_model_template_items (template_id, system_template_id)
  where system_template_id is not null;

drop policy if exists "Connected org members read supplier attachment placements" on public.attachment_placements;
create policy "Connected org members read supplier attachment placements"
  on public.attachment_placements
  for select
  to authenticated
  using (
    target_type = 'org'
    and exists (
      select 1
      from public.org_relationships r
      where r.to_org_id = attachment_placements.target_id
        and r.relationship_type in ('supplier', 'system_supplier', 'component_supplier')
        and r.status in ('source_reported', 'active')
        and public.activator_user_can_act_for_org(auth.uid(), r.from_org_id)
    )
  );

drop policy if exists "Connected org members create supplier attachment placements" on public.attachment_placements;
create policy "Connected org members create supplier attachment placements"
  on public.attachment_placements
  for insert
  to authenticated
  with check (
    target_type = 'org'
    and public.keepr_attachment_owned_by_user(auth.uid(), attachment_id)
    and exists (
      select 1
      from public.org_relationships r
      where r.to_org_id = attachment_placements.target_id
        and r.relationship_type in ('supplier', 'system_supplier', 'component_supplier')
        and r.status in ('source_reported', 'active')
        and public.activator_user_can_act_for_org(auth.uid(), r.from_org_id)
    )
  );

drop policy if exists "Connected org members delete supplier attachment placements" on public.attachment_placements;
create policy "Connected org members delete supplier attachment placements"
  on public.attachment_placements
  for delete
  to authenticated
  using (
    target_type = 'org'
    and exists (
      select 1
      from public.org_relationships r
      where r.to_org_id = attachment_placements.target_id
        and r.relationship_type in ('supplier', 'system_supplier', 'component_supplier')
        and r.status in ('source_reported', 'active')
        and public.activator_user_can_act_for_org(auth.uid(), r.from_org_id)
    )
  );

do $$
declare
  v_mercury_id uuid;
  v_seakeeper_id uuid;
  v_cummins_id uuid;
  v_tiara_id uuid;
  v_bennington_id uuid;
begin
  insert into public.orgs (
    name, display_name, slug, organization_type, org_type, status,
    authority_state, source_type, source_name, source_url, source_metadata
  )
  values
    (
      'Mercury Marine', 'Mercury Marine', 'mercury-marine', 'supplier', 'supplier', 'active',
      'public_source_reported', 'keepr_curated', 'Supplier V1 fixture', 'https://www.mercurymarine.com/',
      jsonb_build_object('supplier_v1', true, 'capabilities', jsonb_build_array('propulsion'))
    ),
    (
      'Seakeeper', 'Seakeeper', 'seakeeper', 'supplier', 'supplier', 'active',
      'public_source_reported', 'keepr_curated', 'Supplier V1 fixture', 'https://seakeeper.com/',
      jsonb_build_object('supplier_v1', true, 'capabilities', jsonb_build_array('stabilization'))
    ),
    (
      'Cummins / Onan', 'Cummins / Onan', 'cummins-onan', 'supplier', 'supplier', 'active',
      'public_source_reported', 'keepr_curated', 'Supplier V1 fixture', 'https://www.cummins.com/generators/marine',
      jsonb_build_object('supplier_v1', true, 'capabilities', jsonb_build_array('marine generators', 'electrical'))
    )
  on conflict (lower(slug)) where slug is not null do update
  set display_name = excluded.display_name,
      organization_type = coalesce(public.orgs.organization_type, excluded.organization_type),
      org_type = coalesce(public.orgs.org_type, excluded.org_type),
      status = coalesce(public.orgs.status, excluded.status),
      source_url = coalesce(public.orgs.source_url, excluded.source_url),
      source_metadata = coalesce(public.orgs.source_metadata, '{}'::jsonb) || excluded.source_metadata,
      updated_at = now();

  select id into v_mercury_id from public.orgs where lower(slug) = 'mercury-marine' limit 1;
  select id into v_seakeeper_id from public.orgs where lower(slug) = 'seakeeper' limit 1;
  select id into v_cummins_id from public.orgs where lower(slug) = 'cummins-onan' limit 1;
  select id into v_tiara_id from public.orgs where lower(slug) = 'tiara-yachts' limit 1;
  select id into v_bennington_id from public.orgs where lower(slug) = 'bennington' limit 1;

  update public.system_templates
  set supplier_org_id = v_mercury_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('supplier_resolution', 'supplier_v1_manufacturer_match')
  where v_mercury_id is not null
    and supplier_org_id is null
    and lower(coalesce(manufacturer, '')) like '%mercury%';

  update public.system_templates
  set supplier_org_id = v_seakeeper_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('supplier_resolution', 'supplier_v1_manufacturer_match')
  where v_seakeeper_id is not null
    and supplier_org_id is null
    and lower(coalesce(manufacturer, '')) like '%seakeeper%';

  update public.system_templates
  set supplier_org_id = v_cummins_id,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('supplier_resolution', 'supplier_v1_manufacturer_match')
  where v_cummins_id is not null
    and supplier_org_id is null
    and (
      lower(coalesce(manufacturer, '')) like '%onan%'
      or lower(coalesce(manufacturer, '')) like '%cummins%'
    );

  if v_tiara_id is not null then
    insert into public.org_relationships (
      from_org_id, to_org_id, relationship_type, status, evidence_state,
      authority_state, source_name, source_url, metadata
    )
    select v_tiara_id, supplier_id, 'supplier', 'source_reported', 'keepr_seeded',
      'public_source_reported', 'Supplier V1 graph projection', supplier_url,
      jsonb_build_object('supplier_v1', true, 'relationship_basis', 'system_template_supplier')
    from (
      values
        (v_mercury_id, 'https://www.mercurymarine.com/'),
        (v_seakeeper_id, 'https://seakeeper.com/'),
        (v_cummins_id, 'https://www.cummins.com/generators/marine')
    ) as suppliers(supplier_id, supplier_url)
    where supplier_id is not null
    on conflict (from_org_id, to_org_id, relationship_type)
    where status in ('source_reported', 'active')
    do update
    set metadata = coalesce(public.org_relationships.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();
  end if;

  if v_bennington_id is not null and v_mercury_id is not null then
    insert into public.org_relationships (
      from_org_id, to_org_id, relationship_type, status, evidence_state,
      authority_state, source_name, source_url, metadata
    )
    values (
      v_bennington_id, v_mercury_id, 'supplier', 'source_reported', 'keepr_seeded',
      'public_source_reported', 'Supplier V1 graph projection', 'https://www.mercurymarine.com/',
      jsonb_build_object('supplier_v1', true, 'relationship_basis', 'system_template_supplier')
    )
    on conflict (from_org_id, to_org_id, relationship_type)
    where status in ('source_reported', 'active')
    do update
    set metadata = coalesce(public.org_relationships.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now();
  end if;
end;
$$;

create or replace function public.list_organization_supplier_network(
  p_organization_id uuid,
  p_query text default null,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
  v_limit integer := least(greatest(coalesce(p_limit, 50), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'sign in required';
  end if;

  if p_organization_id is null
     or not public.activator_user_can_act_for_org(auth.uid(), p_organization_id) then
    raise exception 'not allowed to browse this organization Supplier Network';
  end if;

  return jsonb_build_object(
    'organization_id', p_organization_id,
    'query', coalesce(p_query, ''),
    'suppliers', coalesce((
      with supplier_ids as (
        select
          r.to_org_id as supplier_org_id,
          r.id as relationship_id,
          r.relationship_type,
          r.status,
          r.authority_state,
          r.evidence_state,
          r.source_name,
          r.source_url
        from public.org_relationships r
        where r.from_org_id = p_organization_id
          and r.relationship_type in ('supplier', 'system_supplier', 'component_supplier')
          and r.status in ('source_reported', 'active')
        union
        select
          st.supplier_org_id,
          null::uuid,
          'system_supplier'::text,
          'source_reported'::text,
          st.authority_state,
          'keepr_seeded'::text,
          st.name,
          null::text
        from public.system_templates st
        where st.owner_org_id = p_organization_id
          and st.supplier_org_id is not null
          and st.authority_state <> 'retired'
      ),
      supplier_rows as (
        select
          s.supplier_org_id,
          (array_agg(s.relationship_id) filter (where s.relationship_id is not null))[1] as relationship_id,
          coalesce(max(s.relationship_type), 'supplier') as relationship_type,
          coalesce(max(s.status), 'source_reported') as status,
          coalesce(max(s.authority_state), 'source_reported') as authority_state,
          coalesce(max(s.evidence_state), 'source_reported') as evidence_state,
          max(s.source_name) as source_name,
          max(s.source_url) as relationship_source_url
        from supplier_ids s
        where s.supplier_org_id is not null
        group by s.supplier_org_id
      )
      select jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'organization_id', o.id,
          'name', coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.display_name, kp.name, 'Supplier'),
          'slug', o.slug,
          'logo_url', coalesce(o.photo_url, o.team_photo_url, kp.logo_url, kp.avatar_url),
          'website', coalesce(kp.website, o.source_url, sr.relationship_source_url),
          'phone', kp.phone,
          'email', kp.email,
          'classification', coalesce(o.organization_type, o.org_type, 'supplier'),
          'capabilities', coalesce(o.workspace_capabilities, o.source_metadata -> 'capabilities', '[]'::jsonb),
          'relationship_id', sr.relationship_id,
          'relationship_type', sr.relationship_type,
          'relationship_status', sr.status,
          'authority_state', sr.authority_state,
          'evidence_state', sr.evidence_state,
          'source_name', sr.source_name,
          'source_url', sr.relationship_source_url,
          'system_template_count', (
            select count(distinct st.id)
            from public.system_templates st
            where st.supplier_org_id = o.id
              and st.authority_state <> 'retired'
              and (
                st.owner_org_id = p_organization_id
                or exists (
                  select 1
                  from public.asset_model_template_items item
                  join public.asset_model_templates template on template.id = item.template_id
                  where item.system_template_id = st.id
                    and template.organization_id = p_organization_id
                    and template.status <> 'retired'
                )
              )
          ),
          'model_count', (
            select count(distinct template.id)
            from public.asset_model_templates template
            join public.asset_model_template_items item on item.template_id = template.id
            join public.system_templates st on st.id = item.system_template_id
            where template.organization_id = p_organization_id
              and template.status <> 'retired'
              and st.supplier_org_id = o.id
              and st.authority_state <> 'retired'
          ),
          'installed_system_count', (
            select count(distinct system.id)
            from public.systems system
            join public.assets asset on asset.id = system.asset_id
            join public.system_templates st on st.id = system.system_template_id
            where st.supplier_org_id = o.id
              and exists (
                select 1
                from public.asset_relationship_edges edge
                where edge.asset_id = asset.id
                  and edge.organization_id = p_organization_id
                  and edge.status in ('active', 'pending')
              )
          ),
          'kac_count', (
            select count(distinct asset.kac_id)
            from public.systems system
            join public.assets asset on asset.id = system.asset_id
            join public.system_templates st on st.id = system.system_template_id
            where st.supplier_org_id = o.id
              and asset.kac_id is not null
              and exists (
                select 1
                from public.asset_relationship_edges edge
                where edge.asset_id = asset.id
                  and edge.organization_id = p_organization_id
                  and edge.status in ('active', 'pending')
              )
          ),
          'resource_count', (
            select count(distinct ap.attachment_id)
            from public.system_templates st
            join public.attachment_placements ap
              on ap.target_type = 'system_template'
             and ap.target_id = st.id
            join public.attachments att on att.id = ap.attachment_id
            where st.supplier_org_id = o.id
              and att.deleted_at is null
              and st.authority_state <> 'retired'
          ),
          'system_templates', (
            select coalesce(jsonb_agg(
              jsonb_build_object(
                'id', st.id,
                'canonical_key', st.canonical_key,
                'name', st.name,
                'manufacturer', st.manufacturer,
                'system_category', st.system_category,
                'authority_state', st.authority_state,
                'resource_count', (
                  select count(*)
                  from public.attachment_placements ap
                  join public.attachments att on att.id = ap.attachment_id
                  where ap.target_type = 'system_template'
                    and ap.target_id = st.id
                    and att.deleted_at is null
                )
              )
              order by st.name
            ), '[]'::jsonb)
            from public.system_templates st
            where st.supplier_org_id = o.id
              and st.authority_state <> 'retired'
              and (
                st.owner_org_id = p_organization_id
                or exists (
                  select 1
                  from public.asset_model_template_items item
                  join public.asset_model_templates template on template.id = item.template_id
                  where item.system_template_id = st.id
                    and template.organization_id = p_organization_id
                    and template.status <> 'retired'
                )
              )
          ),
          'models', (
            select coalesce(jsonb_agg(distinct jsonb_build_object(
              'id', template.id,
              'template_key', template.template_key,
              'manufacturer', template.manufacturer,
              'model', template.model,
              'model_year', template.model_year
            )), '[]'::jsonb)
            from public.asset_model_templates template
            join public.asset_model_template_items item on item.template_id = template.id
            join public.system_templates st on st.id = item.system_template_id
            where template.organization_id = p_organization_id
              and template.status <> 'retired'
              and st.supplier_org_id = o.id
              and st.authority_state <> 'retired'
          )
        ))
        order by coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.display_name, kp.name, 'Supplier')
      )
      from supplier_rows sr
      join public.orgs o on o.id = sr.supplier_org_id
      left join public.keepr_pros kp on kp.organization_id = o.id
      where coalesce(o.status, 'active') = 'active'
        and (
          v_query = ''
          or lower(coalesce(o.display_name, o.name, kp.display_name, kp.name, '')) like '%' || v_query || '%'
          or lower(coalesce(o.slug, '')) like '%' || v_query || '%'
          or lower(coalesce(kp.website, o.source_url, sr.relationship_source_url, '')) like '%' || v_query || '%'
        )
      limit v_limit
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'suppliers', (
        with supplier_ids as (
          select to_org_id as id
          from public.org_relationships
          where from_org_id = p_organization_id
            and relationship_type in ('supplier', 'system_supplier', 'component_supplier')
            and status in ('source_reported', 'active')
          union
          select supplier_org_id
          from public.system_templates
          where owner_org_id = p_organization_id
            and supplier_org_id is not null
            and authority_state <> 'retired'
        )
        select count(distinct id) from supplier_ids where id is not null
      )
    )
  );
end;
$$;

grant execute on function public.list_organization_supplier_network(uuid, text, integer) to authenticated;

comment on function public.list_organization_supplier_network(uuid, text, integer) is
  'Supplier V1 graph projection: active OEM Organization -> supplier Organization relationships -> System Templates -> model applicability -> exact system/KAC counts.';

select pg_notify('pgrst', 'reload schema');
-- END INLINED FROM supabase/migrations/20260908100000_supplier_graph_projection_v1.sql

\echo '== applying asset KAC KeeprLINK identity normalization =='
-- BEGIN INLINED FROM supabase/migrations/20260908113000_asset_kac_keeprlink_identity_normalization.sql
-- Keep asset KAC identity and KeeprLINK address registry in sync.
-- This is intentionally generic: any active asset with assets.kac_id receives
-- a canonical /k/<KAC> address without replacing the asset row as truth.

create or replace function public.ensure_asset_keepr_link(p_asset_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_asset public.assets%rowtype;
  v_address text;
  v_normalized text;
  v_link_id uuid;
begin
  select *
  into v_asset
  from public.assets
  where id = p_asset_id
    and deleted_at is null;

  if v_asset.id is null or nullif(btrim(coalesce(v_asset.kac_id, '')), '') is null then
    update public.keepr_links
    set
      status = 'retired',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'retired_by', 'asset_kac_identity_normalization',
        'retired_reason', 'asset_missing_kac',
        'retired_at', now()
      ),
      updated_at = now()
    where object_type = 'asset'
      and object_id = p_asset_id
      and status = 'active'
      and is_canonical = true
    returning id into v_link_id;

    return v_link_id;
  end if;

  v_address := '/k/' || btrim(v_asset.kac_id);
  v_normalized := public.keeprlink_normalize_address(v_address);

  update public.keepr_links
  set
    address = v_address,
    normalized_address = v_normalized,
    object_type = 'asset',
    is_canonical = true,
    status = 'active',
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'source', 'asset.kac_id',
      'address_contract', 'asset_kac_keeprlink_identity_normalization_v1',
      'asset_kac_id', v_asset.kac_id,
      'asset_type', v_asset.type,
      'asset_name', v_asset.name,
      'serial_number_present', nullif(btrim(coalesce(v_asset.serial_number, '')), '') is not null
    )),
    updated_at = now()
  where object_type = 'asset'
    and object_id = v_asset.id
    and status = 'active'
    and is_canonical = true
  returning id into v_link_id;

  if v_link_id is not null then
    return v_link_id;
  end if;

  insert into public.keepr_links (
    address,
    normalized_address,
    object_type,
    object_id,
    is_canonical,
    status,
    metadata
  )
  values (
    v_address,
    v_normalized,
    'asset',
    v_asset.id,
    true,
    'active',
    jsonb_strip_nulls(jsonb_build_object(
      'source', 'asset.kac_id',
      'address_contract', 'asset_kac_keeprlink_identity_normalization_v1',
      'asset_kac_id', v_asset.kac_id,
      'asset_type', v_asset.type,
      'asset_name', v_asset.name,
      'serial_number_present', nullif(btrim(coalesce(v_asset.serial_number, '')), '') is not null
    ))
  )
  on conflict (normalized_address) where status = 'active'
  do update set
    address = excluded.address,
    object_type = excluded.object_type,
    object_id = excluded.object_id,
    is_canonical = excluded.is_canonical,
    metadata = coalesce(public.keepr_links.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now()
  where public.keepr_links.object_type = 'asset'
    and public.keepr_links.object_id = excluded.object_id
  returning id into v_link_id;

  return v_link_id;
end;
$$;

create or replace function public.sync_asset_keepr_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.ensure_asset_keepr_link(new.id);
  return new;
end;
$$;

drop trigger if exists sync_asset_keepr_link_after_write on public.assets;
create trigger sync_asset_keepr_link_after_write
after insert or update of kac_id, name, type, serial_number, deleted_at
on public.assets
for each row
execute function public.sync_asset_keepr_link();

select public.ensure_asset_keepr_link(id)
from public.assets
where deleted_at is null
  and nullif(btrim(coalesce(kac_id, '')), '') is not null;

grant execute on function public.ensure_asset_keepr_link(uuid) to authenticated, service_role;
-- END INLINED FROM supabase/migrations/20260908113000_asset_kac_keeprlink_identity_normalization.sql

\echo '== applying linked System Template promotion correction =='
-- BEGIN INLINED FROM supabase/migrations/20260908124500_promote_system_updates_linked_template.sql
-- Correct exact-system promotion so an already-linked installed system updates
-- its canonical System Template instead of creating a near-duplicate template.

create or replace function public.promote_system_to_system_template(
  p_system_id uuid,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_system public.systems%rowtype;
  v_template public.system_templates%rowtype;
  v_name text;
  v_manufacturer text;
  v_category text;
  v_description text;
  v_owner_org_id uuid;
  v_canonical_key text;
  v_promote_resources boolean := coalesce((p_payload ->> 'promote_resources')::boolean, false);
  v_link_system boolean := coalesce((p_payload ->> 'link_system')::boolean, true);
  v_resource_count integer := 0;
  v_update_metadata jsonb;
begin
  if p_system_id is null then
    raise exception 'system_id is required';
  end if;

  select *
  into v_system
  from public.systems
  where id = p_system_id
  limit 1;

  if v_system.id is null then
    raise exception 'system not found';
  end if;

  if not public.activator_user_can_manage_asset(auth.uid(), v_system.asset_id) then
    raise exception 'not allowed to manage this asset system';
  end if;

  begin
    v_owner_org_id := nullif(p_payload ->> 'owner_org_id', '')::uuid;
  exception when invalid_text_representation then
    v_owner_org_id := null;
  end;

  if v_owner_org_id is not null
     and not public.activator_user_can_act_for_org(auth.uid(), v_owner_org_id) then
    raise exception 'not allowed to create reusable system truth for this organization';
  end if;

  v_name := nullif(trim(coalesce(p_payload ->> 'name', '')), '');
  v_name := coalesce(v_name, nullif(trim(v_system.name), ''), 'System');

  v_manufacturer := nullif(trim(coalesce(p_payload ->> 'manufacturer', '')), '');
  v_manufacturer := coalesce(
    v_manufacturer,
    nullif(trim(coalesce(v_system.metadata -> 'standard' -> 'identity' ->> 'manufacturer', '')), ''),
    nullif(trim(coalesce(v_system.metadata -> 'identity' ->> 'manufacturer', '')), '')
  );

  v_category := nullif(trim(coalesce(p_payload ->> 'system_category', '')), '');
  v_category := coalesce(v_category, nullif(trim(v_system.system_type), ''));

  v_description := nullif(trim(coalesce(p_payload ->> 'description', '')), '');
  v_description := coalesce(
    v_description,
    nullif(trim(coalesce(v_system.metadata -> 'standard' -> 'story' ->> 'description', '')), ''),
    nullif(trim(coalesce(v_system.metadata ->> 'description', '')), '')
  );

  v_update_metadata := jsonb_build_object(
    'source', 'promote_system_to_system_template',
    'promoted_from_system_id', v_system.id,
    'promoted_from_asset_id', v_system.asset_id,
    'promoted_at', now(),
    'promoted_by', auth.uid(),
    'reusable_truth_only', true,
    'exact_truth_excluded', jsonb_build_array(
      'serials',
      'service_history',
      'exact_photos',
      'condition',
      'failures',
      'exact_warranty_state'
    )
  ) || coalesce(p_payload -> 'metadata', '{}'::jsonb);

  if v_system.system_template_id is not null then
    select *
    into v_template
    from public.system_templates
    where id = v_system.system_template_id
      and authority_state <> 'retired'
    limit 1;
  end if;

  if v_template.id is not null then
    update public.system_templates
    set name = v_name,
        manufacturer = coalesce(v_manufacturer, manufacturer),
        owner_org_id = coalesce(v_owner_org_id, owner_org_id),
        system_category = coalesce(v_category, system_category),
        description = coalesce(v_description, description),
        authority_state = coalesce(nullif(p_payload ->> 'authority_state', ''), authority_state),
        metadata = coalesce(metadata, '{}'::jsonb) || v_update_metadata,
        updated_at = now()
    where id = v_template.id
    returning * into v_template;
  else
    v_canonical_key := nullif(trim(coalesce(p_payload ->> 'canonical_key', '')), '');
    v_canonical_key := coalesce(v_canonical_key, public.system_template_canonical_key(v_name, v_manufacturer));

    insert into public.system_templates (
      canonical_key,
      name,
      manufacturer,
      owner_org_id,
      system_category,
      description,
      authority_state,
      metadata
    )
    values (
      v_canonical_key,
      v_name,
      v_manufacturer,
      v_owner_org_id,
      v_category,
      v_description,
      coalesce(nullif(p_payload ->> 'authority_state', ''), 'oem_verified'),
      v_update_metadata
    )
    on conflict (canonical_key) do update
    set name = excluded.name,
        manufacturer = coalesce(excluded.manufacturer, public.system_templates.manufacturer),
        owner_org_id = coalesce(excluded.owner_org_id, public.system_templates.owner_org_id),
        system_category = coalesce(excluded.system_category, public.system_templates.system_category),
        description = coalesce(excluded.description, public.system_templates.description),
        authority_state = coalesce(excluded.authority_state, public.system_templates.authority_state),
        metadata = coalesce(public.system_templates.metadata, '{}'::jsonb) || excluded.metadata,
        updated_at = now()
    returning * into v_template;
  end if;

  if v_link_system then
    update public.systems
    set system_template_id = v_template.id,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'system_template_id', v_template.id,
          'system_template_key', v_template.canonical_key,
          'system_template_name', v_template.name,
          'system_template_reference_source', 'promote_system_to_system_template',
          'system_template_linked_at', now(),
          'system_template_linked_by', auth.uid()
        ),
        updated_at = now()
    where id = v_system.id
    returning * into v_system;
  end if;

  if v_promote_resources then
    insert into public.attachment_placements (
      attachment_id,
      target_type,
      target_id,
      role,
      label,
      is_showcase,
      sort_order
    )
    select
      ap.attachment_id,
      'system_template',
      v_template.id,
      ap.role,
      coalesce(ap.label, 'System Template resource'),
      false,
      ap.sort_order
    from public.attachment_placements ap
    join public.attachments att on att.id = ap.attachment_id
    where ap.target_type = 'system'
      and ap.target_id = v_system.id
      and att.deleted_at is null
      and coalesce(att.kind, '') <> 'photo'
      and coalesce(att.mime_type, '') not ilike 'image/%'
      and not exists (
        select 1
        from public.attachment_placements existing
        where existing.attachment_id = ap.attachment_id
          and existing.target_type = 'system_template'
          and existing.target_id = v_template.id
      );

    get diagnostics v_resource_count = row_count;
  end if;

  return jsonb_build_object(
    'ok', true,
    'system', to_jsonb(v_system),
    'system_template', to_jsonb(v_template),
    'promoted_resource_count', v_resource_count,
    'exact_truth_left_on_system', true,
    'updated_existing_linked_template', v_system.system_template_id is not null
  );
end;
$$;

grant execute on function public.promote_system_to_system_template(uuid, jsonb) to authenticated;

comment on function public.promote_system_to_system_template(uuid, jsonb) is
  'Updates the linked canonical System Template for an exact installed system when present; otherwise promotes reusable exact-system knowledge into canonical System Template truth. Exact-only state remains on the system instance.';

select pg_notify('pgrst', 'reload schema');
-- END INLINED FROM supabase/migrations/20260908124500_promote_system_updates_linked_template.sql

commit;

\echo '== after 2026-09-08 delta: protected production counts =='
select 'assets' as table_name, count(*) as rows from public.assets
union all select 'systems', count(*) from public.systems
union all select 'attachments', count(*) from public.attachments
union all select 'attachment_placements', count(*) from public.attachment_placements
order by table_name;

\echo '== after 2026-09-08 delta: launch graph counts =='
select 'system_templates' as table_name, count(*) as rows from public.system_templates
union all select 'keepr_links', count(*) from public.keepr_links
union all select 'org_relationships', count(*) from public.org_relationships
union all select 'asset_model_templates', count(*) from public.asset_model_templates
union all select 'asset_model_template_items', count(*) from public.asset_model_template_items
order by table_name;

\echo '== after 2026-09-08 delta: supplier reconciliation shape =='
select
  lower(coalesce(slug, '')) as slug,
  coalesce(display_name, name) as name,
  organization_type,
  org_type,
  status
from public.orgs
where lower(coalesce(slug, '')) in (
  'tiara-yachts',
  'bennington',
  'wilsonmarine',
  'wilson-marine',
  'mercury-marine',
  'seakeeper',
  'cummins-onan'
)
order by slug, name;
