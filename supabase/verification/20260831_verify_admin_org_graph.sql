select set_config('request.jwt.claim.sub', 'b508214b-f076-4526-b126-7fc85a2297f2', false);

create temp table if not exists verify_profiles (
  label text primary key,
  profile_id uuid not null
);

insert into public.profiles (id, email, display_name, full_name, role, plan, account_status, created_at, updated_at)
select gen_random_uuid(), seed.email, seed.display_name, seed.display_name, 'consumer', 'team', 'active', now(), now()
from (
  values
    ('crestliner@keeprhome.com', 'Crestliner Admin'),
    ('skipperbuds@keeprhome.com', 'SkipperBud''s Admin'),
    ('marinemax@keeprhome.com', 'MarineMax Admin'),
    ('safeharbor@keeprhome.com', 'Safe Harbor Admin'),
    ('blackstone@keeprhome.com', 'Blackstone Admin')
) as seed(email, display_name)
where not exists (
  select 1 from public.profiles p where lower(p.email) = lower(seed.email)
);

insert into verify_profiles (label, profile_id)
select split_part(email, '@', 1), id
from public.profiles
where lower(email) in (
  'crestliner@keeprhome.com',
  'skipperbuds@keeprhome.com',
  'marinemax@keeprhome.com',
  'safeharbor@keeprhome.com',
  'blackstone@keeprhome.com'
)
on conflict (label) do update set profile_id = excluded.profile_id;

create temp table if not exists verify_orgs (
  label text primary key,
  org_id uuid not null
);

insert into verify_orgs (label, org_id)
select 'crestliner', (public.create_keepr_organization(
  'Crestliner',
  'oem',
  (select profile_id from verify_profiles where label = 'crestliner'),
  'crestliner@keeprhome.com',
  jsonb_build_object('display_name', 'Crestliner', 'website', 'https://www.crestliner.com/'),
  null
)->>'organization_id')::uuid
on conflict (label) do update set org_id = excluded.org_id;

insert into verify_orgs (label, org_id)
select 'skipperbuds', (public.create_keepr_organization(
  'SkipperBud''s',
  'dealer',
  (select profile_id from verify_profiles where label = 'skipperbuds'),
  'skipperbuds@keeprhome.com',
  jsonb_build_object('display_name', 'SkipperBud''s'),
  null
)->>'organization_id')::uuid
on conflict (label) do update set org_id = excluded.org_id;

insert into verify_orgs (label, org_id)
select 'marinemax', (public.create_keepr_organization(
  'MarineMax',
  'parent_company',
  (select profile_id from verify_profiles where label = 'marinemax'),
  'marinemax@keeprhome.com',
  jsonb_build_object('display_name', 'MarineMax'),
  null
)->>'organization_id')::uuid
on conflict (label) do update set org_id = excluded.org_id;

insert into verify_orgs (label, org_id)
select 'safeharbor', (public.create_keepr_organization(
  'Safe Harbor',
  'parent_company',
  (select profile_id from verify_profiles where label = 'safeharbor'),
  'safeharbor@keeprhome.com',
  jsonb_build_object('display_name', 'Safe Harbor'),
  null
)->>'organization_id')::uuid
on conflict (label) do update set org_id = excluded.org_id;

insert into verify_orgs (label, org_id)
select 'blackstone', (public.create_keepr_organization(
  'Blackstone',
  'parent_company',
  (select profile_id from verify_profiles where label = 'blackstone'),
  'blackstone@keeprhome.com',
  jsonb_build_object('display_name', 'Blackstone'),
  null
)->>'organization_id')::uuid
on conflict (label) do update set org_id = excluded.org_id;

insert into verify_orgs (label, org_id)
select 'wilson', o.id
from public.orgs o
where lower(coalesce(o.display_name, o.name, o.slug)) like '%wilson%'
  and lower(coalesce(o.organization_type, o.org_type, '')) in ('dealer', 'keeprpro')
order by o.created_at asc nulls last
limit 1
on conflict (label) do update set org_id = excluded.org_id;

insert into verify_orgs (label, org_id)
select 'bennington', o.id
from public.orgs o
where lower(coalesce(o.display_name, o.name, o.slug)) like '%bennington%'
  and lower(coalesce(o.organization_type, o.org_type, '')) in ('oem', 'manufacturer')
order by o.created_at asc nulls last
limit 1
on conflict (label) do update set org_id = excluded.org_id;

select public.upsert_keepr_admin_org_relationship(
  (select org_id from verify_orgs where label = 'wilson'),
  (select org_id from verify_orgs where label = 'bennington'),
  'authorized_dealer',
  'active',
  jsonb_build_object('verification', 'codex_admin_org_graph')
);

select public.upsert_keepr_admin_org_relationship(
  (select org_id from verify_orgs where label = 'wilson'),
  (select org_id from verify_orgs where label = 'crestliner'),
  'authorized_dealer',
  'active',
  jsonb_build_object('verification', 'codex_admin_org_graph')
);

select public.upsert_keepr_admin_org_relationship(
  (select org_id from verify_orgs where label = 'skipperbuds'),
  (select org_id from verify_orgs where label = 'marinemax'),
  'parent_company',
  'active',
  jsonb_build_object('verification', 'codex_admin_org_graph')
);

select public.upsert_keepr_admin_org_relationship(
  (select org_id from verify_orgs where label = 'marinemax'),
  (select org_id from verify_orgs where label = 'safeharbor'),
  'parent_company',
  'active',
  jsonb_build_object('verification', 'codex_admin_org_graph')
);

select public.upsert_keepr_admin_org_relationship(
  (select org_id from verify_orgs where label = 'safeharbor'),
  (select org_id from verify_orgs where label = 'blackstone'),
  'parent_company',
  'active',
  jsonb_build_object('verification', 'codex_admin_org_graph')
);

with recursive parent_chain as (
  select
    child.id as child_org_id,
    child.display_name as child_name,
    parent.id as parent_org_id,
    parent.display_name as parent_name,
    1 as depth,
    array[child.id, parent.id] as visited
  from public.org_relationships r
  join public.orgs child on child.id = r.from_org_id
  join public.orgs parent on parent.id = r.to_org_id
  where r.from_org_id = (select org_id from verify_orgs where label = 'skipperbuds')
    and r.relationship_type = 'parent_company'
    and r.status in ('source_reported', 'active')

  union all

  select
    pc.parent_org_id,
    pc.parent_name,
    parent.id,
    parent.display_name,
    pc.depth + 1,
    pc.visited || parent.id
  from parent_chain pc
  join public.org_relationships r on r.from_org_id = pc.parent_org_id
  join public.orgs parent on parent.id = r.to_org_id
  where r.relationship_type = 'parent_company'
    and r.status in ('source_reported', 'active')
    and not parent.id = any(pc.visited)
)
select jsonb_pretty(jsonb_build_object(
  'crestliner', (
    select jsonb_build_object(
      'id', o.id,
      'display_name', o.display_name,
      'organization_type', o.organization_type,
      'org_type', o.org_type,
      'workspace_type', o.workspace_type
    )
    from public.orgs o
    where o.id = (select org_id from verify_orgs where label = 'crestliner')
  ),
  'wilson_dealer_relationships', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'from', dealer.display_name,
      'to', oem.display_name,
      'relationship_type', r.relationship_type,
      'status', r.status
    ) order by oem.display_name), '[]'::jsonb)
    from public.org_relationships r
    join public.orgs dealer on dealer.id = r.from_org_id
    join public.orgs oem on oem.id = r.to_org_id
    where r.from_org_id = (select org_id from verify_orgs where label = 'wilson')
      and r.to_org_id in (
        (select org_id from verify_orgs where label = 'bennington'),
        (select org_id from verify_orgs where label = 'crestliner')
      )
      and r.relationship_type = 'authorized_dealer'
      and r.status in ('source_reported', 'active')
  ),
  'bennington_inverse_dealers', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'dealer', dealer.display_name,
      'oem', oem.display_name,
      'relationship_type', r.relationship_type,
      'status', r.status
    ) order by dealer.display_name), '[]'::jsonb)
    from public.org_relationships r
    join public.orgs dealer on dealer.id = r.from_org_id
    join public.orgs oem on oem.id = r.to_org_id
    where r.to_org_id = (select org_id from verify_orgs where label = 'bennington')
      and r.relationship_type = 'authorized_dealer'
      and r.status in ('source_reported', 'active')
  ),
  'parent_chain', (
    select coalesce(jsonb_agg(jsonb_build_object(
      'depth', depth,
      'child', child_name,
      'parent', parent_name
    ) order by depth), '[]'::jsonb)
    from parent_chain
  ),
  'filter_counts', jsonb_build_object(
    'oem', jsonb_array_length(public.search_keepr_admin_orgs('', 'oem', null)->'organizations'),
    'dealer', jsonb_array_length(public.search_keepr_admin_orgs('', 'dealer', null)->'organizations'),
    'parent_company', jsonb_array_length(public.search_keepr_admin_orgs('', 'parent_company', null)->'organizations')
  ),
  'represented_brand_count', (
    select count(*) from public.org_relationships where relationship_type = 'represented_brand'
  ),
  'relationship_audit_events', (
    select count(*)
    from public.keepr_admin_audit_events e
    where e.action = 'organization.relationship.upserted'
      and e.metadata ->> 'verification' is null
      and e.created_at > now() - interval '30 minutes'
  )
)) as verification_graph;
