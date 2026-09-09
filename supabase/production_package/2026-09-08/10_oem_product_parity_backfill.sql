-- OEM Product Parity Backfill
-- Scope: production-worthy Tiara/Bennington reference/configuration data only.
-- Requires scoped staging CSV exports in /private/tmp/keepr_oem_parity.
-- Does not touch assets, systems, service history, or exact-build/KF018 fixtures.

\set ON_ERROR_STOP on

create temp table stg_system_templates (
  staging_id uuid,
  canonical_key text,
  name text,
  manufacturer text,
  supplier_slug text,
  owner_slug text,
  system_category text,
  description text,
  authority_state text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

create temp table stg_model_items (
  staging_id uuid,
  template_key text,
  parent_canonical_key text,
  system_template_canonical_key text,
  item_type text,
  canonical_key text,
  label text,
  expected_value jsonb,
  applicability jsonb,
  authority_state text,
  source_resource_staging_id uuid,
  metadata jsonb,
  sort_order integer,
  created_at timestamptz,
  updated_at timestamptz
);

create temp table stg_attachments (
  staging_id uuid,
  org_slug text,
  owner_user_id uuid,
  asset_id uuid,
  kind text,
  bucket text,
  storage_path text,
  url text,
  file_name text,
  mime_type text,
  size_bytes bigint,
  title text,
  notes text,
  created_at timestamptz,
  deleted_at timestamptz,
  source_context jsonb,
  tags text[],
  ai_summary text,
  ai_metadata jsonb,
  extracted_text text,
  text_source text,
  ocr_status text,
  doc_type text,
  extracted_at timestamptz,
  extracted_error text,
  privacy text,
  thumb_160_url text,
  thumb_320_url text,
  thumb_640_url text,
  derivatives_status text,
  derivatives_updated_at timestamptz,
  thumb_160_path text,
  thumb_320_path text,
  thumb_640_path text
);

create temp table stg_attachment_placements (
  staging_id uuid,
  staging_attachment_id uuid,
  target_type text,
  target_key text,
  role text,
  label text,
  sort_order integer,
  created_at timestamptz,
  is_showcase boolean
);

create temp table stg_asset_resources (
  staging_id uuid,
  resource_type text,
  title text,
  url text,
  attachment_url text,
  source_name text,
  source_platform text,
  source_url text,
  captured_at timestamptz,
  authority_state text,
  rights_status text,
  applies_to_type text,
  applies_to_key text,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
);

\copy stg_system_templates from '/private/tmp/keepr_oem_parity/system_templates.csv' with csv header
\copy stg_model_items from '/private/tmp/keepr_oem_parity/model_items.csv' with csv header
\copy stg_attachments from '/private/tmp/keepr_oem_parity/attachments.csv' with csv header
\copy stg_attachment_placements from '/private/tmp/keepr_oem_parity/attachment_placements.csv' with csv header
\copy stg_asset_resources from '/private/tmp/keepr_oem_parity/asset_resources.csv' with csv header

create temp table parity_manifest as
select 'staging_system_templates' as metric, count(*)::bigint as count from stg_system_templates
union all select 'staging_model_items', count(*) from stg_model_items
union all select 'staging_attachments_no_signed_urls', count(*) from stg_attachments
union all select 'staging_attachment_placements_no_signed_urls', count(*) from stg_attachment_placements
union all select 'staging_asset_resources', count(*) from stg_asset_resources
union all select 'staging_signed_url_resources_excluded', 1;

select * from parity_manifest order by metric;

do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from stg_attachment_placements
  where target_type not in ('model_template', 'org', 'system_template');
  if v_bad <> 0 then
    raise exception 'unexpected attachment placement targets: %', v_bad;
  end if;

  select count(*) into v_bad
  from stg_model_items
  where template_key not in (
    select template_key
    from public.asset_model_templates t
    join public.orgs o on o.id = t.organization_id
    where o.slug in ('tiara-yachts', 'bennington')
  );
  if v_bad <> 0 then
    raise exception 'model items reference missing/non-approved templates: %', v_bad;
  end if;

  select count(*) into v_bad
  from stg_attachments
  where coalesce(url, '') ilike '%/object/sign/%'
     or coalesce(url, '') ilike '%token=%';
  if v_bad <> 0 then
    raise exception 'signed/private URL resources were not excluded: %', v_bad;
  end if;
end $$;

begin;

-- Required schema parity: staging allows these released catalog item types.
alter table public.asset_model_template_items
  drop constraint if exists asset_model_template_items_type_check;

alter table public.asset_model_template_items
  add constraint asset_model_template_items_type_check
  check (item_type = any (array[
    'section',
    'spec',
    'standard',
    'option_group',
    'option',
    'configuration_group',
    'configuration_item',
    'choice',
    'system',
    'component',
    'equipment',
    'knowledge',
    'playbook',
    'resource',
    'interval'
  ]::text[]));

-- Repair deployed Admin RPC contract: app calls p_query, p_organization_type, p_workspace_type.
drop function if exists public.search_keepr_admin_orgs(text);

create or replace function public.search_keepr_admin_orgs(
  p_query text default null,
  p_organization_type text default null,
  p_workspace_type text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_query text := lower(trim(coalesce(p_query, '')));
  v_org_type text := lower(nullif(trim(coalesce(p_organization_type, '')), ''));
  v_workspace_type text := lower(nullif(trim(coalesce(p_workspace_type, '')), ''));
begin
  if not public.is_keepr_internal_admin(auth.uid()) then
    raise exception 'not authorized for Keepr Admin';
  end if;

  return jsonb_build_object(
    'query', coalesce(p_query, ''),
    'organization_type', v_org_type,
    'workspace_type', v_workspace_type,
    'organizations', coalesce((
      with matches as (
        select
          o.*,
          kp.id as keepr_pro_id,
          kp.slug as keepr_pro_slug,
          kp.display_name as keepr_pro_display_name,
          kp.name as keepr_pro_name,
          kp.email as keepr_pro_email,
          kp.website as keepr_pro_website,
          kp.claimed_state as keepr_pro_claimed_state,
          kp.profile_status as keepr_pro_profile_status,
          oa.id as activation_id,
          oa.status as activation_status,
          oa.workspace_type as activation_workspace_type,
          oa.activated_at,
          public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type) as resolved_workspace_type,
          coalesce(nullif(o.organization_type, ''), nullif(o.org_type, 'org'), 'org') as resolved_org_type
        from public.orgs o
        left join public.keepr_pros kp on kp.organization_id = o.id
        left join public.org_activations oa on oa.organization_id = o.id
        where coalesce(o.status, 'active') = 'active'
          and (
            v_org_type is null
            or lower(coalesce(o.organization_type, o.org_type, '')) = v_org_type
            or (v_org_type = 'oem' and lower(coalesce(o.organization_type, o.org_type, '')) = 'manufacturer')
          )
          and (
            v_workspace_type is null
            or lower(public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type)) = v_workspace_type
          )
          and (
            v_query = ''
            or lower(coalesce(o.display_name, '')) like '%' || v_query || '%'
            or lower(coalesce(o.name, '')) like '%' || v_query || '%'
            or lower(coalesce(o.slug, '')) like '%' || v_query || '%'
            or lower(coalesce(kp.display_name, '')) like '%' || v_query || '%'
            or lower(coalesce(kp.slug, '')) like '%' || v_query || '%'
            or lower(coalesce(kp.email, '')) like '%' || v_query || '%'
            or lower(coalesce(kp.website, '')) like '%' || v_query || '%'
          )
        order by coalesce(nullif(o.display_name, ''), nullif(o.name, ''), kp.display_name, kp.name)
        limit 75
      )
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'name', m.name,
        'display_name', coalesce(nullif(m.display_name, ''), nullif(m.name, ''), m.keepr_pro_display_name, m.keepr_pro_name),
        'slug', m.slug,
        'org_type', m.org_type,
        'organization_type', m.organization_type,
        'status', coalesce(m.status, 'active'),
        'workspace_type', m.resolved_workspace_type,
        'workspace_capabilities', public.keepr_effective_workspace_capabilities(
          m.resolved_workspace_type,
          coalesce(m.workspace_capabilities, '[]'::jsonb)
        ),
        'activation', case when m.activation_id is null then null else jsonb_build_object(
          'id', m.activation_id,
          'status', m.activation_status,
          'workspace_type', m.activation_workspace_type,
          'activated_at', m.activated_at
        ) end,
        'keepr_pro', case when m.keepr_pro_id is null then null else jsonb_build_object(
          'id', m.keepr_pro_id,
          'slug', m.keepr_pro_slug,
          'display_name', m.keepr_pro_display_name,
          'claimed_state', m.keepr_pro_claimed_state,
          'profile_status', m.keepr_pro_profile_status
        ) end
      ))
      from matches m
    ), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.search_keepr_admin_orgs(text, text, text) from public;
revoke execute on function public.search_keepr_admin_orgs(text, text, text) from anon;
grant execute on function public.search_keepr_admin_orgs(text, text, text) to authenticated, service_role;

-- Align released org profile/capability/access fixtures without touching real owner assets.
update public.profiles
set
  plan = 'team',
  display_name = coalesce(nullif(display_name, ''), 'Tiara Demo'),
  full_name = coalesce(nullif(full_name, ''), 'Tiara Demo'),
  updated_at = now()
where lower(email) = 'tiara@keeprhome.com';

update public.orgs o
set
  owner_user_id = p.id,
  organization_type = 'oem',
  org_type = 'manufacturer',
  workspace_type = 'keeproem',
  authority_state = 'org_managed',
  workspace_capabilities = '["manufacturer", "model_catalog", "dealer_network", "activation", "as_built_context", "asset_continuity"]'::jsonb,
  updated_at = now()
from public.profiles p
where o.slug = 'tiara-yachts'
  and lower(p.email) = 'tiara@keeprhome.com';

insert into public.org_members (org_id, user_id, member_role, role, status, joined_at, metadata)
select o.id, p.id, 'manager', 'manager', 'active', now(),
       jsonb_build_object('source', 'oem_product_parity_backfill_20260908', 'workspace_role', 'oem_operator')
from public.orgs o
join public.profiles p on lower(p.email) = 'tiara@keeprhome.com'
where o.slug = 'tiara-yachts'
on conflict (org_id, user_id) do update
set member_role = 'manager',
    role = 'manager',
    status = 'active',
    joined_at = coalesce(public.org_members.joined_at, excluded.joined_at),
    metadata = coalesce(public.org_members.metadata, '{}'::jsonb) || excluded.metadata;

update public.orgs
set
  organization_type = 'oem',
  org_type = 'manufacturer',
  workspace_type = 'keeproem',
  authority_state = 'org_managed',
  workspace_capabilities = '["manufacturer", "model_catalog", "dealer_network", "activation", "as_built_context", "asset_continuity"]'::jsonb,
  updated_at = now()
where slug = 'bennington';

update public.orgs
set
  organization_type = 'dealer',
  org_type = 'dealer',
  workspace_type = 'keeprpro',
  authority_state = 'org_managed',
  workspace_capabilities = '["service_provider", "service_workspace", "service_records", "provider_messaging"]'::jsonb,
  updated_at = now()
where slug = 'wilsonmarine';

insert into public.keepr_internal_admins (user_id, authority, status, granted_by, granted_at, metadata)
select p.id, 'keepr_admin', 'active', p.id, now(),
       jsonb_build_object('source', 'oem_product_parity_backfill_20260908')
from public.profiles p
where lower(p.email) = 'adrake@keeprhome.com'
on conflict (user_id) do update
set authority = 'keepr_admin',
    status = 'active',
    revoked_at = null,
    metadata = coalesce(public.keepr_internal_admins.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

-- Production-worthy reusable systems.
insert into public.system_templates (
  canonical_key,
  name,
  manufacturer,
  supplier_org_id,
  owner_org_id,
  system_category,
  description,
  authority_state,
  metadata,
  created_at,
  updated_at
)
select
  st.canonical_key,
  st.name,
  st.manufacturer,
  supplier.id,
  owner.id,
  st.system_category,
  st.description,
  st.authority_state,
  coalesce(st.metadata, '{}'::jsonb) || jsonb_build_object('source', 'oem_product_parity_backfill_20260908'),
  coalesce(st.created_at, now()),
  now()
from stg_system_templates st
left join public.orgs supplier on supplier.slug = st.supplier_slug
left join public.orgs owner on owner.slug = st.owner_slug
on conflict (canonical_key) do update
set name = excluded.name,
    manufacturer = excluded.manufacturer,
    supplier_org_id = coalesce(excluded.supplier_org_id, public.system_templates.supplier_org_id),
    owner_org_id = coalesce(excluded.owner_org_id, public.system_templates.owner_org_id),
    system_category = excluded.system_category,
    description = excluded.description,
    authority_state = excluded.authority_state,
    metadata = coalesce(public.system_templates.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now();

create temp table attachment_map as
select
  a.staging_id,
  coalesce(existing.id, gen_random_uuid()) as production_id
from stg_attachments a
left join public.attachments existing
  on existing.deleted_at is null
 and existing.kind = a.kind
 and coalesce(existing.url, '') = coalesce(a.url, '')
 and coalesce(existing.storage_path, '') = coalesce(a.storage_path, '')
 and coalesce(existing.title, '') = coalesce(a.title, '')
 and coalesce(existing.file_name, '') = coalesce(a.file_name, '');

insert into public.attachments (
  id,
  owner_user_id,
  asset_id,
  kind,
  bucket,
  storage_path,
  url,
  file_name,
  mime_type,
  size_bytes,
  title,
  notes,
  created_at,
  deleted_at,
  source_context,
  tags,
  ai_summary,
  ai_metadata,
  extracted_text,
  text_source,
  ocr_status,
  doc_type,
  extracted_at,
  extracted_error,
  org_id,
  privacy,
  thumb_160_url,
  thumb_320_url,
  thumb_640_url,
  derivatives_status,
  derivatives_updated_at,
  thumb_160_path,
  thumb_320_path,
  thumb_640_path
)
select
  m.production_id,
  null,
  null,
  a.kind,
  coalesce(a.bucket, 'asset-files'),
  a.storage_path,
  a.url,
  a.file_name,
  a.mime_type,
  a.size_bytes,
  a.title,
  a.notes,
  coalesce(a.created_at, now()),
  null,
  coalesce(a.source_context, '{}'::jsonb) || jsonb_build_object('source', 'oem_product_parity_backfill_20260908'),
  coalesce(a.tags, '{}'::text[]),
  a.ai_summary,
  coalesce(a.ai_metadata, '{}'::jsonb),
  a.extracted_text,
  coalesce(a.text_source, 'none'),
  coalesce(a.ocr_status, 'not_needed'),
  coalesce(a.doc_type, 'unknown'),
  a.extracted_at,
  a.extracted_error,
  orgs.id,
  coalesce(a.privacy, 'moves_with_asset'),
  a.thumb_160_url,
  a.thumb_320_url,
  a.thumb_640_url,
  coalesce(a.derivatives_status, 'pending'),
  a.derivatives_updated_at,
  a.thumb_160_path,
  a.thumb_320_path,
  a.thumb_640_path
from stg_attachments a
join attachment_map m on m.staging_id = a.staging_id
left join public.orgs orgs on orgs.slug = a.org_slug
on conflict (id) do update
set kind = excluded.kind,
    bucket = excluded.bucket,
    storage_path = excluded.storage_path,
    url = excluded.url,
    file_name = excluded.file_name,
    mime_type = excluded.mime_type,
    size_bytes = excluded.size_bytes,
    title = excluded.title,
    notes = excluded.notes,
    source_context = coalesce(public.attachments.source_context, '{}'::jsonb) || excluded.source_context,
    tags = excluded.tags,
    ai_summary = excluded.ai_summary,
    ai_metadata = coalesce(public.attachments.ai_metadata, '{}'::jsonb) || excluded.ai_metadata,
    extracted_text = excluded.extracted_text,
    text_source = excluded.text_source,
    ocr_status = excluded.ocr_status,
    doc_type = excluded.doc_type,
    extracted_at = excluded.extracted_at,
    extracted_error = excluded.extracted_error,
    org_id = coalesce(excluded.org_id, public.attachments.org_id),
    privacy = excluded.privacy,
    thumb_160_url = excluded.thumb_160_url,
    thumb_320_url = excluded.thumb_320_url,
    thumb_640_url = excluded.thumb_640_url,
    derivatives_status = excluded.derivatives_status,
    derivatives_updated_at = excluded.derivatives_updated_at,
    thumb_160_path = excluded.thumb_160_path,
    thumb_320_path = excluded.thumb_320_path,
    thumb_640_path = excluded.thumb_640_path;

create temp table asset_resource_map as
with keyed as (
  select
    ar.*,
    lower(ar.resource_type || ':' || coalesce(ar.title, '') || ':' || coalesce(ar.url, ar.source_url, '')) as resource_key
  from stg_asset_resources ar
)
select
  k.staging_id,
  coalesce(existing.id, gen_random_uuid()) as production_id,
  k.resource_key
from keyed k
left join public.asset_resources existing
  on lower(existing.resource_type || ':' || coalesce(existing.title, '') || ':' || coalesce(existing.url, existing.source_url, '')) = k.resource_key;

insert into public.asset_resources (
  id,
  resource_type,
  title,
  url,
  attachment_id,
  source_name,
  source_platform,
  source_url,
  captured_at,
  authority_state,
  rights_status,
  applies_to_type,
  applies_to_id,
  metadata,
  created_by,
  created_at,
  updated_at,
  role,
  public_url_allowed,
  public_link_allowed
)
select
  m.production_id,
  ar.resource_type,
  ar.title,
  ar.url,
  null,
  ar.source_name,
  ar.source_platform,
  ar.source_url,
  ar.captured_at,
  ar.authority_state,
  ar.rights_status,
  ar.applies_to_type,
  case
    when ar.applies_to_type = 'model_template' then (select id from public.asset_model_templates where template_key = ar.applies_to_key limit 1)
    when ar.applies_to_type = 'org' then (select id from public.orgs where slug = ar.applies_to_key limit 1)
    when ar.applies_to_type = 'system_template' then (select id from public.system_templates where canonical_key = ar.applies_to_key limit 1)
    else null
  end,
  coalesce(ar.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source', 'oem_product_parity_backfill_20260908',
      'production_resource_key', m.resource_key
    ),
  null,
  coalesce(ar.created_at, now()),
  now(),
  ar.resource_type,
  ar.rights_status in ('public_ok', 'review_permission'),
  ar.rights_status in ('public_ok', 'review_permission')
from stg_asset_resources ar
join asset_resource_map m on m.staging_id = ar.staging_id
on conflict (id) do update
set resource_type = excluded.resource_type,
    title = excluded.title,
    url = excluded.url,
    source_name = excluded.source_name,
    source_platform = excluded.source_platform,
    source_url = excluded.source_url,
    captured_at = excluded.captured_at,
    authority_state = excluded.authority_state,
    rights_status = excluded.rights_status,
    applies_to_type = excluded.applies_to_type,
    applies_to_id = coalesce(excluded.applies_to_id, public.asset_resources.applies_to_id),
    metadata = coalesce(public.asset_resources.metadata, '{}'::jsonb) || excluded.metadata,
    updated_at = now(),
    role = excluded.role,
    public_url_allowed = excluded.public_url_allowed,
    public_link_allowed = excluded.public_link_allowed;

create temp table model_item_map as
select
  item.staging_id,
  prod.id as production_id,
  tmpl.id as production_template_id
from stg_model_items item
join public.asset_model_templates tmpl on tmpl.template_key = item.template_key
left join public.asset_model_template_items prod
  on prod.template_id = tmpl.id
 and lower(prod.canonical_key) = lower(item.canonical_key);

insert into public.asset_model_template_items (
  id,
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
  sort_order,
  created_at,
  updated_at,
  system_template_id
)
select
  coalesce(m.production_id, gen_random_uuid()),
  m.production_template_id,
  null,
  item.item_type,
  item.canonical_key,
  item.label,
  coalesce(item.expected_value, '{}'::jsonb),
  coalesce(item.applicability, '{}'::jsonb),
  item.authority_state,
  ar.production_id,
  coalesce(item.metadata, '{}'::jsonb)
    || jsonb_build_object('source', 'oem_product_parity_backfill_20260908'),
  coalesce(item.sort_order, 0),
  coalesce(item.created_at, now()),
  now(),
  st.id
from stg_model_items item
join model_item_map m on m.staging_id = item.staging_id
left join public.system_templates st on st.canonical_key = item.system_template_canonical_key
left join asset_resource_map ar on ar.staging_id = item.source_resource_staging_id
on conflict (template_id, (lower(canonical_key))) do update
set parent_item_id = null,
    item_type = excluded.item_type,
    label = excluded.label,
    expected_value = excluded.expected_value,
    applicability = excluded.applicability,
    authority_state = excluded.authority_state,
    source_resource_id = coalesce(excluded.source_resource_id, public.asset_model_template_items.source_resource_id),
    metadata = coalesce(public.asset_model_template_items.metadata, '{}'::jsonb) || excluded.metadata,
    sort_order = excluded.sort_order,
    updated_at = now(),
    system_template_id = coalesce(excluded.system_template_id, public.asset_model_template_items.system_template_id);

-- Resolve parent refs after all items exist.
update public.asset_model_template_items child
set parent_item_id = parent.id,
    updated_at = now()
from stg_model_items si
join public.asset_model_templates tmpl on tmpl.template_key = si.template_key
join public.asset_model_template_items parent
  on parent.template_id = tmpl.id
 and lower(parent.canonical_key) = lower(si.parent_canonical_key)
where child.template_id = tmpl.id
  and lower(child.canonical_key) = lower(si.canonical_key)
  and si.parent_canonical_key is not null;

insert into public.attachment_placements (
  attachment_id,
  target_type,
  target_id,
  role,
  label,
  sort_order,
  created_at,
  is_showcase
)
select
  am.production_id,
  ap.target_type,
  case
    when ap.target_type = 'org' then (select id from public.orgs where slug = ap.target_key limit 1)
    when ap.target_type = 'model_template' then (select id from public.asset_model_templates where template_key = ap.target_key limit 1)
    when ap.target_type = 'system_template' then (select id from public.system_templates where canonical_key = ap.target_key limit 1)
  end as target_id,
  ap.role,
  ap.label,
  ap.sort_order,
  coalesce(ap.created_at, now()),
  coalesce(ap.is_showcase, false)
from stg_attachment_placements ap
join attachment_map am on am.staging_id = ap.staging_attachment_id
where case
    when ap.target_type = 'org' then (select id from public.orgs where slug = ap.target_key limit 1)
    when ap.target_type = 'model_template' then (select id from public.asset_model_templates where template_key = ap.target_key limit 1)
    when ap.target_type = 'system_template' then (select id from public.system_templates where canonical_key = ap.target_key limit 1)
  end is not null
on conflict (attachment_id, target_type, target_id) do update
set role = excluded.role,
    label = excluded.label,
    sort_order = excluded.sort_order,
    is_showcase = excluded.is_showcase;

notify pgrst, 'reload schema';

commit;

select 'post_tiara_items' as metric, count(*)::bigint as count
from public.asset_model_template_items item
join public.asset_model_templates t on t.id = item.template_id
join public.orgs o on o.id = t.organization_id
where o.slug = 'tiara-yachts'
union all
select 'post_bennington_items', count(*)
from public.asset_model_template_items item
join public.asset_model_templates t on t.id = item.template_id
join public.orgs o on o.id = t.organization_id
where o.slug = 'bennington'
union all
select 'post_model_template_placements', count(*)
from public.attachment_placements where target_type = 'model_template'
union all
select 'post_org_placements', count(*)
from public.attachment_placements where target_type = 'org'
union all
select 'post_system_template_placements', count(*)
from public.attachment_placements where target_type = 'system_template'
union all
select 'post_system_templates_total', count(*)
from public.system_templates
union all
select 'post_admin_rpc_signatures', count(*)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname='search_keepr_admin_orgs'
  and p.oid::regprocedure::text = 'search_keepr_admin_orgs(text,text,text)';
