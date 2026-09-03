-- Backfill legacy template asset_resources into attachment-backed model resources.
-- Product rule: Resources are knowledge attachments placed on a model template.

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
  title,
  notes,
  created_at,
  source_context,
  tags,
  ai_metadata,
  org_id,
  privacy
)
select
  r.id,
  r.created_by,
  null,
  case when coalesce(r.url, r.source_url) is not null then 'link' else 'file' end,
  'asset-files',
  null,
  coalesce(r.url, r.source_url),
  null,
  null,
  r.title,
  nullif(r.source_name, ''),
  coalesce(r.created_at, now()),
  jsonb_strip_nulls(
    jsonb_build_object(
      'provenance', 'model_template',
      'provenance_label', coalesce(r.source_name, r.title),
      'provenance_detail', 'Legacy template resource backfilled into attachment-backed model resources.',
      'contribution_context', 'legacy_asset_resource_backfill',
      'contributed_by_org_role', 'oem',
      'contributed_by_org_id', t.organization_id,
      'contributed_by_org_label', t.manufacturer,
      'provided_by_label', coalesce(r.source_name, t.manufacturer),
      'authored_by_label', coalesce(r.source_name, t.manufacturer),
      'organization_id', t.organization_id,
      'source_resource_id', r.id,
      'source_name', r.source_name,
      'source_url', coalesce(r.source_url, r.url),
      'template_id', t.id,
      'template_key', t.template_key,
      'applies_to_type', 'model_template',
      'applies_to_id', t.id,
      'not_exact_hull_evidence', true,
      'legacy_asset_resource_id', r.id
    )
  ),
  array['model-resource', 'legacy-backfill'],
  jsonb_strip_nulls(
    jsonb_build_object(
      'role',
        case
          when r.resource_type = 'manual' then 'Manual'
          when r.resource_type = 'model_page' then 'Spec Sheet'
          when r.resource_type = 'oem_catalog' then 'Spec Sheet'
          when r.resource_type = 'build_sheet' then 'Spec Sheet'
          when r.resource_type = 'service_document' then 'Manual'
          else 'Other'
        end,
      'authority', 'official',
      'privacy', 'moves_with_asset',
      'ai_scope', 'asset',
      'ai_context',
        case
          when r.resource_type in ('manual', 'model_page', 'oem_catalog', 'build_sheet', 'service_document') then 'primary'
          else 'supporting'
        end,
      'applies_to', 'model_template',
      'legacy_asset_resource_id', r.id
    )
  ),
  t.organization_id,
  'moves_with_asset'
from public.asset_resources r
join public.asset_model_templates t
  on r.applies_to_type = 'template'
 and r.applies_to_id = t.id
where r.resource_type not in ('photo')
  and not exists (
    select 1
    from public.attachments existing
    where existing.id = r.id
  );

insert into public.attachment_placements (
  attachment_id,
  target_type,
  target_id,
  role,
  label,
  sort_order,
  is_showcase,
  created_at
)
select
  r.id,
  'model_template',
  r.applies_to_id,
  case
    when r.resource_type = 'manual' then 'Manual'
    when r.resource_type = 'model_page' then 'Spec Sheet'
    when r.resource_type = 'oem_catalog' then 'Spec Sheet'
    when r.resource_type = 'build_sheet' then 'Spec Sheet'
    when r.resource_type = 'service_document' then 'Manual'
    else 'Other'
  end,
  r.title,
  coalesce((r.metadata ->> 'sort_order')::integer, 900),
  false,
  coalesce(r.created_at, now())
from public.asset_resources r
where r.applies_to_type = 'template'
  and r.resource_type not in ('photo')
  and exists (
    select 1
    from public.attachments a
    where a.id = r.id
      and a.deleted_at is null
  )
  and not exists (
    select 1
    from public.attachment_placements existing
    where existing.attachment_id = r.id
      and existing.target_type = 'model_template'
      and existing.target_id = r.applies_to_id
  );

