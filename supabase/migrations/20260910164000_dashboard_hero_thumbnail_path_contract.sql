-- Expose stable thumbnail storage paths for dashboard hero hydration.
-- Persisted signed URLs expire; callers should sign the derivative path at read time.

drop function if exists public.get_dashboard_hero_attachments(uuid[]);

create function public.get_dashboard_hero_attachments(
  placement_ids uuid[]
)
returns table (
  placement_id uuid,
  bucket text,
  storage_path text,
  url text,
  thumb_320_url text,
  thumb_320_path text,
  deleted_at timestamp with time zone
)
language sql
stable
security definer
set search_path = public
as $$
  select
    ap.id as placement_id,
    a.bucket,
    a.storage_path,
    a.url,
    a.thumb_320_url,
    a.thumb_320_path,
    a.deleted_at
  from public.attachment_placements ap
  join public.attachments a
    on a.id = ap.attachment_id
  where ap.id = any(placement_ids)
    and a.deleted_at is null
    and public.keepr_can_access_asset(a.asset_id, auth.uid());
$$;

revoke execute on function public.get_dashboard_hero_attachments(uuid[]) from public;
revoke execute on function public.get_dashboard_hero_attachments(uuid[]) from anon;
grant execute on function public.get_dashboard_hero_attachments(uuid[]) to authenticated;
grant execute on function public.get_dashboard_hero_attachments(uuid[]) to service_role;
