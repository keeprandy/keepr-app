-- Template Asset Resources Parity
-- Scope: promote production-worthy template asset_resources used by catalog hero/media/resource RPCs.
-- Resolves templates by canonical template_key. Does not copy staging UUIDs blindly.
-- No Personal org/workspace changes. No owner asset/system/history changes.

\set ON_ERROR_STOP on

create temp table stg_template_asset_resources (
  staging_id uuid,
  org_slug text,
  template_key text,
  resource_type text,
  title text,
  url text,
  attachment_file_name text,
  attachment_storage_path text,
  source_name text,
  source_platform text,
  source_url text,
  captured_at timestamptz,
  authority_state text,
  rights_status text,
  metadata jsonb,
  created_by_email text,
  created_at timestamptz,
  updated_at timestamptz
);

\copy stg_template_asset_resources from '/private/tmp/keepr_oem_parity/template_asset_resources.csv' with csv header

select 'dry_run_template_asset_resources' as metric, count(*)::text as value
from stg_template_asset_resources;

select 'dry_run_by_org' as metric, org_slug, count(*)::text as resources, count(*) filter (where resource_type='photo')::text as photos
from stg_template_asset_resources
group by org_slug
order by org_slug;

select 'dry_run_by_template' as metric, template_key, count(*)::text as resources, count(*) filter (where resource_type='photo')::text as photos
from stg_template_asset_resources
group by template_key
order by template_key;

do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
  from stg_template_asset_resources
  where org_slug not in ('tiara-yachts', 'bennington');
  if v_bad <> 0 then
    raise exception 'unexpected org_slug in template asset_resource import: %', v_bad;
  end if;

  select count(*) into v_bad
  from stg_template_asset_resources
  where coalesce(url, '') ~* 'supabase\.co/storage/v1/object/sign|token=';
  if v_bad <> 0 then
    raise exception 'signed/private url asset_resources were not excluded: %', v_bad;
  end if;

  select count(*) into v_bad
  from stg_template_asset_resources r
  where not exists (
    select 1
    from public.asset_model_templates t
    join public.orgs o on o.id = t.organization_id
    where o.slug = r.org_slug
      and lower(t.template_key) = lower(r.template_key)
  );
  if v_bad <> 0 then
    raise exception 'template asset_resources reference missing production templates: %', v_bad;
  end if;
end $$;

begin;

create temp table template_asset_resource_map as
select
  r.*,
  t.id as production_template_id,
  p.id as production_created_by,
  a.id as production_attachment_id,
  coalesce(
    nullif(r.metadata ->> 'normalization_key', ''),
    lower(r.org_slug || ':' || r.template_key || ':' || r.resource_type || ':' || coalesce(r.title, '') || ':' || coalesce(r.url, r.attachment_storage_path, r.attachment_file_name, ''))
  ) as match_key
from stg_template_asset_resources r
join public.orgs o on o.slug = r.org_slug
join public.asset_model_templates t on t.organization_id = o.id and lower(t.template_key) = lower(r.template_key)
left join public.profiles p on lower(p.email) = lower(r.created_by_email)
left join lateral (
  select att.id
  from public.attachments att
  where att.deleted_at is null
    and (
      (r.attachment_storage_path is not null and att.storage_path = r.attachment_storage_path)
      or (r.attachment_file_name is not null and att.file_name = r.attachment_file_name and coalesce(att.title, '') = coalesce(r.title, att.title, ''))
      or (r.url is not null and att.url = r.url)
    )
  order by att.created_at desc
  limit 1
) a on true;

update public.asset_resources existing
set
  resource_type = mapped.resource_type,
  title = mapped.title,
  url = mapped.url,
  attachment_id = coalesce(mapped.production_attachment_id, existing.attachment_id),
  source_name = mapped.source_name,
  source_platform = mapped.source_platform,
  source_url = mapped.source_url,
  captured_at = mapped.captured_at,
  authority_state = mapped.authority_state,
  rights_status = mapped.rights_status,
  applies_to_type = 'template',
  applies_to_id = mapped.production_template_id,
  metadata = coalesce(existing.metadata, '{}'::jsonb)
    || coalesce(mapped.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'staging_asset_resource_id', mapped.staging_id,
      'parity_source', 'template_asset_resources_parity_20260908',
      'template_key', mapped.template_key,
      'normalization_key', mapped.match_key
    ),
  created_by = coalesce(existing.created_by, mapped.production_created_by),
  updated_at = coalesce(mapped.updated_at, now()),
  role = coalesce(existing.role, mapped.metadata ->> 'role'),
  public_url_allowed = coalesce(existing.public_url_allowed, false),
  public_link_allowed = coalesce(existing.public_link_allowed, false)
from template_asset_resource_map mapped
where (
  (existing.metadata ->> 'normalization_key') = mapped.match_key
  or (existing.metadata ->> 'staging_asset_resource_id') = mapped.staging_id::text
  or (
    existing.applies_to_type = 'template'
    and existing.applies_to_id = mapped.production_template_id
    and lower(existing.resource_type) = lower(mapped.resource_type)
    and lower(existing.title) = lower(mapped.title)
    and coalesce(existing.url, '') = coalesce(mapped.url, '')
  )
);

insert into public.asset_resources (
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
  mapped.resource_type,
  mapped.title,
  mapped.url,
  mapped.production_attachment_id,
  mapped.source_name,
  mapped.source_platform,
  mapped.source_url,
  mapped.captured_at,
  mapped.authority_state,
  mapped.rights_status,
  'template',
  mapped.production_template_id,
  coalesce(mapped.metadata, '{}'::jsonb) || jsonb_build_object(
    'staging_asset_resource_id', mapped.staging_id,
    'parity_source', 'template_asset_resources_parity_20260908',
    'template_key', mapped.template_key,
    'normalization_key', mapped.match_key
  ),
  mapped.production_created_by,
  coalesce(mapped.created_at, now()),
  coalesce(mapped.updated_at, now()),
  mapped.metadata ->> 'role',
  false,
  false
from template_asset_resource_map mapped
where not exists (
  select 1
  from public.asset_resources existing
  where (existing.metadata ->> 'normalization_key') = mapped.match_key
     or (existing.metadata ->> 'staging_asset_resource_id') = mapped.staging_id::text
     or (
       existing.applies_to_type = 'template'
       and existing.applies_to_id = mapped.production_template_id
       and lower(existing.resource_type) = lower(mapped.resource_type)
       and lower(existing.title) = lower(mapped.title)
       and coalesce(existing.url, '') = coalesce(mapped.url, '')
     )
);

notify pgrst, 'reload schema';

commit;

begin;
select set_config('request.jwt.claim.sub', (select id::text from public.profiles where lower(email)='tiara@keeprhome.com'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select 'tiara_catalog_list_media' as metric,
  sum(jsonb_array_length(coalesce(template->'showcase_media','[]'::jsonb)))::text as value
from jsonb_array_elements(public.get_catalog_templates((select id from public.orgs where slug='tiara-yachts'))) template;
select 'tiara_56_detail' as metric,
  jsonb_build_object(
    'items', jsonb_array_length(coalesce(public.get_catalog_template_detail(null,'tiara-2027-56-ls')->'items','[]'::jsonb)),
    'resources', jsonb_array_length(coalesce(public.get_catalog_template_detail(null,'tiara-2027-56-ls')->'resources','[]'::jsonb)),
    'showcase_media', jsonb_array_length(coalesce(public.get_catalog_template_detail(null,'tiara-2027-56-ls')->'showcase_media','[]'::jsonb))
  )::text as value;
rollback;
