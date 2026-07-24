-- Canonical asset visibility for authenticated app reads.
-- Authorization is anchored on exact asset_id ownership/stewardship. Org
-- membership alone never expands to every asset owned by another member.

create or replace function public.get_authorized_assets(
  p_asset_type text default null,
  p_include_deleted boolean default false
)
returns table (
  asset jsonb,
  access_indicator text,
  access_org_id uuid,
  access_org_name text
)
language sql
stable
security definer
set search_path = public
as $$
  with authorized as (
    select
      a.id as asset_id,
      1 as priority,
      'owner'::text as access_indicator,
      null::uuid as access_org_id,
      null::text as access_org_name
    from public.assets a
    where auth.uid() is not null
      and a.owner_id = auth.uid()
      and (p_asset_type is null or a.type = p_asset_type)
      and (p_include_deleted or a.deleted_at is null)

    union all

    select
      a.id as asset_id,
      2 as priority,
      'direct_steward'::text as access_indicator,
      null::uuid as access_org_id,
      null::text as access_org_name
    from public.assets a
    join public.asset_stewardships s
      on s.asset_id = a.id
    where auth.uid() is not null
      and s.user_id = auth.uid()
      and s.active = true
      and (s.starts_at is null or s.starts_at <= now())
      and (s.ends_at is null or s.ends_at > now())
      and (p_asset_type is null or a.type = p_asset_type)
      and (p_include_deleted or a.deleted_at is null)

    union all

    select
      a.id as asset_id,
      3 as priority,
      'org_steward'::text as access_indicator,
      s.org_id as access_org_id,
      coalesce(nullif(o.display_name, ''), nullif(o.name, ''), 'Team') as access_org_name
    from public.assets a
    join public.asset_stewardships s
      on s.asset_id = a.id
    join public.org_members m
      on m.org_id = s.org_id
      and m.user_id = auth.uid()
    left join public.orgs o
      on o.id = s.org_id
    where auth.uid() is not null
      and s.org_id is not null
      and s.active = true
      and (s.starts_at is null or s.starts_at <= now())
      and (s.ends_at is null or s.ends_at > now())
      and (p_asset_type is null or a.type = p_asset_type)
      and (p_include_deleted or a.deleted_at is null)
  ),
  ranked as (
    select
      authorized.*,
      row_number() over (
        partition by authorized.asset_id
        order by authorized.priority, authorized.access_org_name nulls last
      ) as rn
    from authorized
  )
  select
    to_jsonb(a) as asset,
    ranked.access_indicator,
    ranked.access_org_id,
    ranked.access_org_name
  from ranked
  join public.assets a
    on a.id = ranked.asset_id
  where ranked.rn = 1
  order by a.sort_rank asc nulls last, a.created_at asc;
$$;

grant execute on function public.get_authorized_assets(text, boolean) to authenticated;
