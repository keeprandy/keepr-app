-- Public story timeline proof badges must reflect each service record's actual
-- linked proof, not demo constants.
--
-- Important: this intentionally counts only proof rows that are unambiguously
-- linked by service_record_id. Asset-level/orphaned documents are not assigned
-- or counted on timeline entries here.

create or replace view public.public_asset_story_timeline as
with photo_counts as (
  select
    service_record_id,
    count(*)::integer as photo_count
  from public.service_record_photos
  where service_record_id is not null
  group by service_record_id
),
document_counts as (
  select
    service_record_id,
    count(*)::integer as document_count
  from public.service_record_documents
  where service_record_id is not null
  group by service_record_id
)
select
  sr.id,
  sr.asset_id,
  summary.kac_id,
  sr.title,
  sr.notes as description,
  sr.performed_at,
  'service'::text as kind,
  (
    sr.verification_status = 'verified'
    and (
      coalesce(document_counts.document_count, 0)
      + coalesce(photo_counts.photo_count, 0)
    ) > 0
  ) as verified,
  coalesce(document_counts.document_count, 0)::integer as document_count,
  coalesce(photo_counts.photo_count, 0)::integer as photo_count
from public.service_records sr
join public.public_asset_story_summary summary
  on summary.asset_id = sr.asset_id
left join document_counts
  on document_counts.service_record_id = sr.id
left join photo_counts
  on photo_counts.service_record_id = sr.id
where sr.record_scope = 'current'
  and sr.performed_at is not null;

grant select on table public.public_asset_story_timeline to anon;
grant select on table public.public_asset_story_timeline to authenticated;
