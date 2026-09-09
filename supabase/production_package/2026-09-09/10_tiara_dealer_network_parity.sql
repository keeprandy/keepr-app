begin;

do $$
declare
  v_tiara_id uuid;
  v_existing_relationships integer;
begin
  select id into v_tiara_id
  from public.orgs
  where lower(slug) = 'tiara-yachts'
  limit 1;

  if v_tiara_id is null then
    raise exception 'Tiara organization slug tiara-yachts not found in production';
  end if;

  select count(*) into v_existing_relationships
  from public.org_relationships
  where from_org_id = v_tiara_id
    and relationship_type = 'authorized_dealer'
    and status in ('source_reported', 'active');

  raise notice 'preflight tiara_authorized_dealer_relationships=%', v_existing_relationships;
end $$;

with dealer_seed(name, display_name, slug) as (
  values
    ('Apex Marine', 'Apex Marine', 'apex-marine'),
    ('Boat Management', 'Boat Management', 'boat-management'),
    ('Bosun''s Marine', 'Bosun''s Marine', 'bosuns-marine'),
    ('Coastal Carolina Yacht Sales', 'Coastal Carolina Yacht Sales', 'coastal-carolina-yacht-sales'),
    ('Comstock Yacht Sales & Marina', 'Comstock Yacht Sales & Marina', 'comstock-yacht-sales-marina'),
    ('Erickson Marine', 'Erickson Marine', 'erickson-marine'),
    ('Hampton Watercraft & Marine', 'Hampton Watercraft & Marine', 'hampton-watercraft-marine'),
    ('Hucks Marine & Resort', 'Hucks Marine & Resort', 'hucks-marine-resort'),
    ('Kelly''s Port', 'Kelly''s Port', 'kellys-port'),
    ('Legendary Marine - Destin', 'Legendary Marine - Destin', 'legendary-marine-destin'),
    ('North Point Yacht Sales', 'North Point Yacht Sales', 'north-point-yacht-sales'),
    ('Ocean Blue Yacht Sales', 'Ocean Blue Yacht Sales', 'ocean-blue-yacht-sales'),
    ('Silver Seas Yachts', 'Silver Seas Yachts', 'silver-seas-yachts'),
    ('SkipperBud''s', 'SkipperBud''s', 'skipperbuds'),
    ('Walker''s Marine', 'Walker''s Marine', 'walkers-marine'),
    ('Walstrom Marine', 'Walstrom Marine', 'walstrom-marine')
),
inserted_orgs as (
  insert into public.orgs (
    name,
    display_name,
    slug,
    org_type,
    organization_type,
    status,
    authority_state,
    source_type,
    source_name,
    source_metadata
  )
  select s.name,
         s.display_name,
         s.slug,
         'dealer',
         'dealer',
         'active',
         'org_managed',
         'tiara_dealer_network_parity',
         'approved staging Tiara dealer network',
         jsonb_build_object(
           'promoted_from', 'staging',
           'parity_scope', 'tiara_dealer_network',
           'promoted_at', now()
         )
  from dealer_seed s
  where not exists (
    select 1
    from public.orgs o
    where lower(o.slug) = lower(s.slug)
  )
  returning id
)
select count(*) as inserted_dealer_orgs
from inserted_orgs;

with dealer_seed(name, display_name, slug, csi_recognition) as (
  values
    ('Apex Marine', 'Apex Marine', 'apex-marine', 'Sales'),
    ('Boat Management', 'Boat Management', 'boat-management', 'Sales'),
    ('Bosun''s Marine', 'Bosun''s Marine', 'bosuns-marine', 'Sales'),
    ('Coastal Carolina Yacht Sales', 'Coastal Carolina Yacht Sales', 'coastal-carolina-yacht-sales', 'Sales & Service'),
    ('Comstock Yacht Sales & Marina', 'Comstock Yacht Sales & Marina', 'comstock-yacht-sales-marina', 'Sales & Service'),
    ('Erickson Marine', 'Erickson Marine', 'erickson-marine', 'Sales & Service'),
    ('Hampton Watercraft & Marine', 'Hampton Watercraft & Marine', 'hampton-watercraft-marine', 'Sales & Service'),
    ('Hucks Marine & Resort', 'Hucks Marine & Resort', 'hucks-marine-resort', 'Sales'),
    ('Kelly''s Port', 'Kelly''s Port', 'kellys-port', 'Sales'),
    ('Legendary Marine - Destin', 'Legendary Marine - Destin', 'legendary-marine-destin', 'Sales'),
    ('North Point Yacht Sales', 'North Point Yacht Sales', 'north-point-yacht-sales', 'Sales & Service'),
    ('Ocean Blue Yacht Sales', 'Ocean Blue Yacht Sales', 'ocean-blue-yacht-sales', 'Sales'),
    ('Silver Seas Yachts', 'Silver Seas Yachts', 'silver-seas-yachts', 'Service'),
    ('SkipperBud''s', 'SkipperBud''s', 'skipperbuds', 'Sales'),
    ('Walker''s Marine', 'Walker''s Marine', 'walkers-marine', 'Sales & Service'),
    ('Walstrom Marine', 'Walstrom Marine', 'walstrom-marine', 'Sales')
),
tiara as (
  select id
  from public.orgs
  where lower(slug) = 'tiara-yachts'
  limit 1
),
resolved as (
  select t.id as tiara_id, o.id as dealer_id, s.*
  from dealer_seed s
  cross join tiara t
  join public.orgs o on lower(o.slug) = lower(s.slug)
),
inserted_relationships as (
  insert into public.org_relationships (
    from_org_id,
    to_org_id,
    relationship_type,
    status,
    evidence_state,
    authority_state,
    metadata
  )
  select r.tiara_id,
         r.dealer_id,
         'authorized_dealer',
         'source_reported',
         'oem_published',
         'source_reported',
         jsonb_build_object(
           'source_context', '2023 Marine Industry CSI Awards',
           'csi_recognition', r.csi_recognition,
           'relationship_note', 'Authorized Tiara dealer relationship is represented separately from CSI capability/recognition.',
           'temporal_scope_note', 'Does not by itself prove current authorization for every 2026 location, product, or territory.',
           'source_published_date', '2024-07-22',
           'promoted_from', 'staging',
           'parity_scope', 'tiara_dealer_network'
         )
  from resolved r
  where not exists (
    select 1
    from public.org_relationships existing
    where existing.from_org_id = r.tiara_id
      and existing.to_org_id = r.dealer_id
      and existing.relationship_type = 'authorized_dealer'
      and existing.status in ('source_reported', 'active')
  )
  returning id
)
select count(*) as inserted_tiara_authorized_dealer_relationships
from inserted_relationships;

do $$
declare
  v_tiara_id uuid;
  v_relationships integer;
begin
  select id into v_tiara_id
  from public.orgs
  where lower(slug) = 'tiara-yachts'
  limit 1;

  select count(*) into v_relationships
  from public.org_relationships
  where from_org_id = v_tiara_id
    and relationship_type = 'authorized_dealer'
    and status in ('source_reported', 'active');

  if v_relationships < 16 then
    raise exception 'Expected at least 16 Tiara authorized dealer relationships, found %', v_relationships;
  end if;

  raise notice 'post_apply tiara_authorized_dealer_relationships=%', v_relationships;
end $$;

commit;
