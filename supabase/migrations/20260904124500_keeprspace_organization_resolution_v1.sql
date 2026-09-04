-- Shared organization resolver for org-to-org relationship activation.
-- This exposes only basic active organization descriptors to authenticated
-- org users so they can resolve first and connect second.

create or replace function public.search_keeprspace_organizations(
  p_query text default null,
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
  v_workspace_type text := lower(nullif(trim(coalesce(p_workspace_type, '')), ''));
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  return jsonb_build_object(
    'query', coalesce(p_query, ''),
    'workspace_type', v_workspace_type,
    'organizations', coalesce((
      with matches as (
        select
          o.id,
          coalesce(nullif(o.display_name, ''), nullif(o.name, ''), nullif(kp.display_name, ''), kp.name, 'Organization') as display_name,
          o.name,
          o.slug,
          o.organization_type,
          o.org_type,
          public.keepr_workspace_type_for_org(o.workspace_type, o.organization_type, o.org_type) as workspace_type,
          kp.website as website,
          kp.location as location,
          coalesce(kp.profile_status, o.status, 'active') as profile_status,
          kp.claimed_state as claimed_state,
          case
            when v_query = '' then 50
            when lower(coalesce(o.slug, '')) = v_query then 0
            when lower(coalesce(o.display_name, o.name, kp.display_name, kp.name, '')) = v_query then 1
            when lower(coalesce(kp.website, '')) like '%' || v_query || '%' then 5
            when lower(coalesce(o.display_name, o.name, kp.display_name, kp.name, '')) like v_query || '%' then 10
            when lower(coalesce(o.display_name, o.name, kp.display_name, kp.name, '')) like '%' || v_query || '%' then 20
            else 90
          end as rank
        from public.orgs o
        left join public.keepr_pros kp on kp.organization_id = o.id
        where coalesce(o.status, 'active') = 'active'
          and (
            v_query = ''
            or lower(coalesce(o.display_name, o.name, kp.display_name, kp.name, '')) like '%' || v_query || '%'
            or lower(coalesce(o.slug, '')) like '%' || v_query || '%'
            or lower(coalesce(kp.website, '')) like '%' || v_query || '%'
            or lower(coalesce(kp.location, '')) like '%' || v_query || '%'
          )
      )
      select jsonb_agg(
        jsonb_strip_nulls(jsonb_build_object(
          'id', id,
          'display_name', display_name,
          'name', name,
          'slug', slug,
          'organization_type', organization_type,
          'org_type', org_type,
          'workspace_type', workspace_type,
          'website', website,
          'location', location,
          'profile_status', profile_status,
          'claimed_state', claimed_state,
          'rank', rank
        ))
        order by rank, display_name
      )
      from matches
      where (v_workspace_type is null or workspace_type = v_workspace_type)
      limit 20
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.search_keeprspace_organizations(text, text) to authenticated;
