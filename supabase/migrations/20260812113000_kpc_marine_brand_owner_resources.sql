-- Marine KPC brand directory seed.
-- Additive/idempotent staging-safe data migration:
-- - orgs remain canonical KPC identities
-- - keepr_pros remains the compatibility/profile layer
-- - kpc_external_identities stores aliases and official domains
-- - asset_resources stores manufacturer owner resources scoped to orgs
-- - org_relationships stores dealer -> represented_brand evidence

create temp table _kpc_marine_seed_orgs (
  seed_key text primary key,
  canonical_name text not null,
  display_name text not null,
  legal_name text,
  organization_type text not null,
  workspace_type text,
  kpc_category text not null default 'marine',
  kpc_capabilities jsonb not null default '[]'::jsonb,
  website text,
  official_domains jsonb not null default '[]'::jsonb,
  aliases jsonb not null default '[]'::jsonb,
  source_name text not null,
  source_url text,
  source_type text not null,
  authority_state text not null default 'public_source_reported',
  support_phone text,
  support_email text,
  contact_form_url text,
  preferred_support_channel text,
  warranty_routing_rule text,
  parts_routing_rule text,
  warranty_transfer_availability text,
  incomplete_resource_types jsonb not null default '[]'::jsonb
) on commit drop;

insert into _kpc_marine_seed_orgs (
  seed_key, canonical_name, display_name, legal_name, organization_type, workspace_type,
  kpc_capabilities, website, official_domains, aliases, source_name, source_url, source_type,
  support_phone, support_email, contact_form_url, preferred_support_channel,
  warranty_routing_rule, parts_routing_rule, warranty_transfer_availability,
  incomplete_resource_types
)
values
  (
    'dealer_wilson', 'Wilson Marine', 'Wilson Marine', 'Wilson Marine', 'dealer', 'keeprdealer',
    '["dealer","service_provider","storage","sales","delivery"]'::jsonb,
    'https://www.wilsonboats.com/',
    '["wilsonboats.com"]'::jsonb,
    '["Wilson Marine","Wilson Boats","Wilson"]'::jsonb,
    'Wilson Marine website', 'https://www.wilsonboats.com/', 'dealer_public_website',
    '(800) 875-2620', null, 'https://www.wilsonboats.com/contactus',
    'dealer_direct',
    'dealer_routes_to_manufacturer_or_service_department',
    'dealer_parts_department',
    'not_applicable_to_dealer',
    '[]'::jsonb
  ),
  (
    'dealer_skipperbuds', 'SkipperBud''s', 'SkipperBud''s', 'SkipperBud''s', 'dealer', 'keeprdealer',
    '["dealer","sales","delivery","service_provider","marina"]'::jsonb,
    'https://www.skipperbuds.com/',
    '["skipperbuds.com"]'::jsonb,
    '["SkipperBuds","Skipper Buds","SkipperBud''s","SkipperBud’s","Skipper Bud''s","SkipperBud"]'::jsonb,
    'SkipperBud''s brands page', 'https://www.skipperbuds.com/brands', 'dealer_public_website',
    null, null, 'https://www.skipperbuds.com/contact-us',
    'dealer_direct',
    'dealer_routes_to_manufacturer_or_service_department',
    'dealer_parts_department',
    'not_applicable_to_dealer',
    '[]'::jsonb
  ),
  (
    'brand_bayliner', 'Bayliner', 'Bayliner', 'Bayliner', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.bayliner.com/',
    '["bayliner.com"]'::jsonb,
    '["Bayliner Boats"]'::jsonb,
    'Bayliner official website', 'https://www.bayliner.com/', 'official_manufacturer',
    null, null, 'https://www.bayliner.com/us/en/contact-us.html',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_bennington', 'Bennington', 'Bennington', 'Bennington', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.benningtonmarine.com/',
    '["benningtonmarine.com"]'::jsonb,
    '["Bennington Marine","Bennington Pontoon Boats"]'::jsonb,
    'Bennington official website', 'https://www.benningtonmarine.com/', 'official_manufacturer',
    null, null, 'https://www.benningtonmarine.com/contact/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_crestliner', 'Crestliner', 'Crestliner', 'Crestliner', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.crestliner.com/',
    '["crestliner.com"]'::jsonb,
    '["Crestliner Boats"]'::jsonb,
    'Crestliner official website', 'https://www.crestliner.com/', 'official_manufacturer',
    null, null, 'https://www.crestliner.com/contact-us/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_crownline', 'Crownline', 'Crownline', 'Crownline', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.crownline.com/',
    '["crownline.com"]'::jsonb,
    '["Crownline Boats"]'::jsonb,
    'Crownline official website', 'https://www.crownline.com/', 'official_manufacturer',
    null, null, 'https://www.crownline.com/contact-us/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_evotti', 'Evotti', 'Evotti', 'Evotti', 'manufacturer', null,
    '["manufacturer","owner_resources"]'::jsonb,
    'https://www.evottimarine.com/',
    '["evottimarine.com"]'::jsonb,
    '["Evotti Marine"]'::jsonb,
    'Evotti official website', 'https://www.evottimarine.com/', 'official_manufacturer',
    null, null, 'https://www.evottimarine.com/contact',
    'manufacturer_contact_form',
    'route_through_manufacturer_contact',
    'route_through_manufacturer_contact',
    'unknown',
    '["owner_center","support_email","manuals_documentation","dealer_locator","parts","ownership_transfer"]'::jsonb
  ),
  (
    'brand_harris', 'Harris Boats', 'Harris', 'Harris Boats', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.harrisboats.com/',
    '["harrisboats.com"]'::jsonb,
    '["Harris","Harris Pontoons","Harris Pontoon Boats"]'::jsonb,
    'Harris official website', 'https://www.harrisboats.com/', 'official_manufacturer',
    null, null, 'https://www.harrisboats.com/contact-us/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_heyday', 'Heyday', 'Heyday', 'Heyday', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.heydaywakeboats.com/',
    '["heydaywakeboats.com"]'::jsonb,
    '["Heyday Wake Boats"]'::jsonb,
    'Heyday official website', 'https://www.heydaywakeboats.com/', 'official_manufacturer',
    null, null, 'https://www.heydaywakeboats.com/contact-us.html',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_mercury', 'Mercury Marine', 'Mercury Marine', 'Mercury Marine', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator","parts"]'::jsonb,
    'https://www.mercurymarine.com/',
    '["mercurymarine.com"]'::jsonb,
    '["Mercury","Mercury Outboards","Mercury Marine Outboards"]'::jsonb,
    'Mercury Marine official website', 'https://www.mercurymarine.com/', 'official_manufacturer',
    null, null, 'https://www.mercurymarine.com/us/en/contact-us/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_mercury_owner_service',
    'route_through_mercury_parts_and_accessories_or_authorized_dealer',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_smoker_craft', 'Smoker Craft', 'Smoker Craft', 'Smoker Craft', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.smokercraft.com/',
    '["smokercraft.com"]'::jsonb,
    '["Smokercraft","SmokerCraft"]'::jsonb,
    'Smoker Craft official website', 'https://www.smokercraft.com/', 'official_manufacturer',
    null, null, 'https://www.smokercraft.com/contact-us/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_sportsman', 'Sportsman Boats', 'Sportsman', 'Sportsman Boats', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.sportsmanboatsmfg.com/',
    '["sportsmanboatsmfg.com"]'::jsonb,
    '["Sportsman","Sportsman Boats Mfg"]'::jsonb,
    'Sportsman official website', 'https://www.sportsmanboatsmfg.com/', 'official_manufacturer',
    null, null, 'https://www.sportsmanboatsmfg.com/contact',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_starweld', 'Starweld', 'Starweld', 'Starweld', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.starweld.com/',
    '["starweld.com"]'::jsonb,
    '["Starweld Boats"]'::jsonb,
    'Starweld official website', 'https://www.starweld.com/', 'official_manufacturer',
    null, null, 'https://www.starweld.com/contact-us/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_sunchaser', 'SunChaser', 'SunChaser', 'SunChaser', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.sunchaserboats.com/',
    '["sunchaserboats.com"]'::jsonb,
    '["Sun Chaser","SunChaser Boats"]'::jsonb,
    'SunChaser official website', 'https://www.sunchaserboats.com/', 'official_manufacturer',
    null, null, 'https://www.sunchaserboats.com/contact-us/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_yamaha', 'Yamaha', 'Yamaha', 'Yamaha', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator","parts"]'::jsonb,
    'https://www.yamahaoutboards.com/',
    '["yamahaoutboards.com","yamahaboats.com"]'::jsonb,
    '["Yamaha Outboards","Yamaha Boats","Yamaha Marine"]'::jsonb,
    'Yamaha Outboards official website', 'https://www.yamahaoutboards.com/', 'official_manufacturer',
    null, null, 'https://yamahaoutboards.com/en-us/contact-us',
    'product_line_owner_resources_or_authorized_dealer',
    'route_through_product_line_owner_resources_or_authorized_dealer',
    'route_through_product_line_parts_resources_or_authorized_dealer',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_aquila', 'Aquila Power Catamarans', 'Aquila', 'Aquila Power Catamarans', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.aquilaboats.com/',
    '["aquilaboats.com"]'::jsonb,
    '["Aquila","Aquila Boats","Aquila Power Catamaran"]'::jsonb,
    'Aquila official website', 'https://www.aquilaboats.com/', 'official_manufacturer',
    null, null, 'https://www.aquilaboats.com/contact/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_aviara', 'Aviara Boats', 'Aviara', 'Aviara Boats', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.aviaraboats.com/',
    '["aviaraboats.com"]'::jsonb,
    '["Aviara"]'::jsonb,
    'Aviara official website', 'https://www.aviaraboats.com/', 'official_manufacturer',
    null, null, 'https://www.aviaraboats.com/contact',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_azimut', 'Azimut Yachts', 'Azimut', 'Azimut Yachts', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.azimutyachts.com/',
    '["azimutyachts.com"]'::jsonb,
    '["Azimut"]'::jsonb,
    'Azimut Yachts official website', 'https://www.azimutyachts.com/', 'official_manufacturer',
    null, null, 'https://www.azimutyachts.com/en/contact-us/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_cruisers_yachts', 'Cruisers Yachts', 'Cruisers Yachts', 'Cruisers Yachts', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.cruisersyachts.com/',
    '["cruisersyachts.com"]'::jsonb,
    '["Cruisers","Cruisers Yachts USA"]'::jsonb,
    'Cruisers Yachts official website', 'https://www.cruisersyachts.com/', 'official_manufacturer',
    null, null, 'https://www.cruisersyachts.com/contact/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_galeon', 'Galeon Yachts', 'Galeon Yachts', 'Galeon Yachts', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.galeonyachts.us/',
    '["galeonyachts.us"]'::jsonb,
    '["Galeon","Galeon Yachts US"]'::jsonb,
    'Galeon Yachts official website', 'https://www.galeonyachts.us/', 'official_manufacturer',
    null, null, 'https://www.galeonyachts.us/contact/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_scout', 'Scout Boats', 'Scout', 'Scout Boats', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.scoutboats.com/',
    '["scoutboats.com"]'::jsonb,
    '["Scout","Scout Boats Inc"]'::jsonb,
    'Scout Boats official website', 'https://www.scoutboats.com/', 'official_manufacturer',
    null, null, 'https://www.scoutboats.com/contact-us/',
    'authorized_dealer_or_manufacturer_contact_form',
    'route_through_authorized_dealer_or_manufacturer_owner_resources',
    'route_through_authorized_dealer_or_manufacturer_parts_resources',
    'unknown',
    '["support_email","ownership_transfer"]'::jsonb
  ),
  (
    'brand_sea_ray', 'Sea Ray', 'Sea Ray', 'Sea Ray', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.searay.com/',
    '["searay.com"]'::jsonb,
    '["SeaRay","Sea Ray Boats"]'::jsonb,
    'Sea Ray owners page', 'https://www.searay.com/us/en/owners', 'official_manufacturer',
    null, null, 'https://www.searay.com/us/en/contact-sea-ray.html',
    'owners_resources_or_authorized_dealer',
    'route_through_sea_ray_owner_resources_or_authorized_dealer',
    'route_through_authorized_dealer_or_sea_ray_resources',
    'available',
    '["support_email"]'::jsonb
  ),
  (
    'brand_tiara_yachts', 'Tiara Yachts', 'Tiara Yachts', 'Tiara Yachts', 'manufacturer', null,
    '["manufacturer","owner_resources","dealer_locator"]'::jsonb,
    'https://www.tiarayachts.com/',
    '["tiarayachts.com"]'::jsonb,
    '["Tiara","Tiara Boats"]'::jsonb,
    'Tiara Yachts official website', 'https://www.tiarayachts.com/', 'official_manufacturer',
    '(616) 392-7163', null, 'https://www.tiarayachts.com/contact-us',
    'owners_resources_or_authorized_dealer',
    'route_through_tiara_owner_resources_or_authorized_dealer',
    'route_through_authorized_dealer_or_tiara_merchandise_parts_resources',
    'available',
    '["support_email"]'::jsonb
  );

create temp table _kpc_seed_org_matches on commit drop as
select distinct on (seed_key) seed_key, organization_id
from (
  select s.seed_key, o.id as organization_id
  from _kpc_marine_seed_orgs s
  join public.orgs o
    on public.kpc_slugify(coalesce(o.slug, o.display_name, o.name)) = public.kpc_slugify(s.display_name)
    or public.kpc_slugify(coalesce(o.slug, o.display_name, o.name)) = public.kpc_slugify(s.canonical_name)
    or public.kpc_normalize_text(coalesce(o.legal_name, o.display_name, o.name)) = public.kpc_normalize_text(s.canonical_name)
  union
  select s.seed_key, kp.organization_id
  from _kpc_marine_seed_orgs s
  join public.keepr_pros kp
    on kp.organization_id is not null
   and (
      public.kpc_normalize_text(coalesce(kp.display_name, kp.name)) = public.kpc_normalize_text(s.display_name)
      or public.kpc_slugify(coalesce(kp.slug, kp.display_name, kp.name)) = public.kpc_slugify(s.display_name)
   )
  union
  select s.seed_key, kei.organization_id
  from _kpc_marine_seed_orgs s
  join lateral jsonb_array_elements_text(s.aliases || jsonb_build_array(s.display_name, s.canonical_name)) alias(value) on true
  join public.kpc_external_identities kei
    on lower(kei.source_type) = 'alias'
   and kei.external_id = public.kpc_normalize_text(alias.value)
  union
  select s.seed_key, kei.organization_id
  from _kpc_marine_seed_orgs s
  join lateral jsonb_array_elements_text(s.official_domains) domain(value) on true
  join public.kpc_external_identities kei
    on lower(kei.source_type) = 'official_domain'
   and kei.external_id = public.kpc_normalize_domain(domain.value)
) matches
where organization_id is not null
order by seed_key, organization_id::text;

insert into public.orgs (
  name,
  display_name,
  legal_name,
  slug,
  org_type,
  organization_type,
  workspace_type,
  status,
  authority_state,
  source_type,
  source_name,
  source_url,
  source_metadata,
  kpc_category,
  kpc_capabilities,
  updated_at
)
select
  s.canonical_name,
  s.display_name,
  s.legal_name,
  public.kpc_slugify(s.display_name),
  s.organization_type,
  s.organization_type,
  s.workspace_type,
  'active',
  s.authority_state,
  s.source_type,
  s.source_name,
  s.source_url,
  jsonb_strip_nulls(jsonb_build_object(
    'seed', 'kpc_marine_brand_owner_resources',
    'seed_version', '20260812113000',
    'official_website', s.website,
    'preferred_support_channel', s.preferred_support_channel,
    'warranty_routing_rule', s.warranty_routing_rule,
    'parts_routing_rule', s.parts_routing_rule,
    'warranty_transfer_availability', s.warranty_transfer_availability,
    'incomplete_resource_types', s.incomplete_resource_types
  )),
  s.kpc_category,
  s.kpc_capabilities,
  now()
from _kpc_marine_seed_orgs s
left join _kpc_seed_org_matches m on m.seed_key = s.seed_key
where m.organization_id is null;

create temp table _kpc_seed_resolved_orgs on commit drop as
select
  s.*,
  coalesce(m.organization_id, o.id) as organization_id
from _kpc_marine_seed_orgs s
left join _kpc_seed_org_matches m on m.seed_key = s.seed_key
left join public.orgs o
  on m.organization_id is null
 and public.kpc_slugify(o.slug) = public.kpc_slugify(s.display_name);

update public.orgs o
set
  name = coalesce(nullif(o.name, ''), r.canonical_name),
  display_name = coalesce(nullif(o.display_name, ''), r.display_name),
  legal_name = coalesce(nullif(o.legal_name, ''), r.legal_name, r.canonical_name),
  slug = coalesce(nullif(o.slug, ''), public.kpc_slugify(r.display_name)),
  org_type = coalesce(nullif(o.org_type, ''), r.organization_type),
  organization_type = coalesce(nullif(o.organization_type, ''), r.organization_type),
  workspace_type = coalesce(nullif(o.workspace_type, ''), r.workspace_type),
  status = coalesce(nullif(o.status, ''), 'active'),
  authority_state = case
    when o.authority_state in ('org_managed', 'org_confirmed', 'counterparty_confirmed', 'evidence_verified') then o.authority_state
    else r.authority_state
  end,
  source_type = coalesce(nullif(o.source_type, ''), r.source_type),
  source_name = coalesce(nullif(o.source_name, ''), r.source_name),
  source_url = coalesce(nullif(o.source_url, ''), r.source_url),
  source_metadata = coalesce(o.source_metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'kpc_marine_brand_seed', jsonb_build_object(
        'seed_version', '20260812113000',
        'official_website', r.website,
        'preferred_support_channel', r.preferred_support_channel,
        'warranty_routing_rule', r.warranty_routing_rule,
        'parts_routing_rule', r.parts_routing_rule,
        'warranty_transfer_availability', r.warranty_transfer_availability,
        'incomplete_resource_types', r.incomplete_resource_types
      )
    )),
  kpc_category = coalesce(nullif(o.kpc_category, ''), r.kpc_category),
  kpc_capabilities = (
    select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
    from (
      select value
      from jsonb_array_elements_text(coalesce(o.kpc_capabilities, '[]'::jsonb))
      union
      select value
      from jsonb_array_elements_text(r.kpc_capabilities)
    ) caps
  ),
  updated_at = now()
from _kpc_seed_resolved_orgs r
where o.id = r.organization_id;

insert into public.keepr_pros (
  user_id,
  organization_id,
  name,
  display_name,
  category,
  website,
  phone,
  email,
  source,
  claimed_state,
  profile_status,
  categories,
  source_metadata
)
select
  null,
  r.organization_id,
  r.canonical_name,
  r.display_name,
  'marine',
  r.website,
  r.support_phone,
  r.support_email,
  'kpc_marine_brand_seed',
  'unclaimed',
  'seeded',
  jsonb_build_array('marine', r.organization_type),
  jsonb_strip_nulls(jsonb_build_object(
    'seed', 'kpc_marine_brand_owner_resources',
    'seed_version', '20260812113000',
    'official_website', r.website,
    'source_type', r.source_type,
    'source_name', r.source_name,
    'source_url', r.source_url
  ))
from _kpc_seed_resolved_orgs r
where not exists (
  select 1
  from public.keepr_pros kp
  where kp.organization_id = r.organization_id
);

update public.keepr_pros kp
set
  display_name = coalesce(nullif(kp.display_name, ''), r.display_name),
  name = coalesce(nullif(kp.name, ''), r.canonical_name),
  category = coalesce(nullif(kp.category, ''), 'marine'),
  website = coalesce(nullif(kp.website, ''), r.website),
  phone = coalesce(nullif(kp.phone, ''), r.support_phone),
  email = coalesce(nullif(kp.email, ''), r.support_email),
  categories = case
    when kp.categories is null then jsonb_build_array('marine', r.organization_type)
    else kp.categories
  end,
  source_metadata = coalesce(kp.source_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'kpc_marine_brand_seed', jsonb_build_object(
        'seed_version', '20260812113000',
        'official_website', r.website,
        'source_type', r.source_type,
        'source_name', r.source_name,
        'source_url', r.source_url
      )
    ),
  updated_at = now()
from _kpc_seed_resolved_orgs r
where kp.organization_id = r.organization_id;

create temp table _kpc_seed_profiles on commit drop as
select distinct on (r.seed_key)
  r.seed_key,
  r.organization_id,
  kp.id as keepr_pro_id
from _kpc_seed_resolved_orgs r
left join public.keepr_pros kp on kp.organization_id = r.organization_id
order by r.seed_key, kp.created_at asc nulls last;

create temp table _kpc_seed_external_identities (
  seed_key text not null,
  source_type text not null,
  external_id text not null,
  source_url text,
  raw_types jsonb not null default '[]'::jsonb,
  source_metadata jsonb not null default '{}'::jsonb,
  authority_state text not null default 'public_source_reported'
) on commit drop;

insert into _kpc_seed_external_identities (seed_key, source_type, external_id, source_url, raw_types, source_metadata)
select r.seed_key, 'alias', public.kpc_normalize_text(alias.value), r.source_url, jsonb_build_array('alias'), jsonb_build_object('source_name', r.source_name)
from _kpc_seed_resolved_orgs r
join lateral jsonb_array_elements_text(r.aliases || jsonb_build_array(r.display_name, r.canonical_name)) alias(value) on true
where public.kpc_normalize_text(alias.value) is not null;

insert into _kpc_seed_external_identities (seed_key, source_type, external_id, source_url, raw_types, source_metadata)
select r.seed_key, 'official_domain', public.kpc_normalize_domain(domain.value), r.website, jsonb_build_array('domain'), jsonb_build_object('source_name', r.source_name)
from _kpc_seed_resolved_orgs r
join lateral jsonb_array_elements_text(r.official_domains) domain(value) on true
where public.kpc_normalize_domain(domain.value) is not null;

insert into _kpc_seed_external_identities (seed_key, source_type, external_id, source_url, raw_types, source_metadata)
select r.seed_key, 'official_website', r.website, r.website, jsonb_build_array('website'), jsonb_build_object('source_name', r.source_name)
from _kpc_seed_resolved_orgs r
where nullif(r.website, '') is not null;

create temp table _kpc_seed_external_identity_rows on commit drop as
select distinct on (source_type_key, external_id)
  seed_key,
  source_type,
  external_id,
  source_url,
  raw_types,
  source_metadata,
  authority_state
from (
  select
    e.*,
    lower(e.source_type) as source_type_key,
    case
      when e.source_type = 'official_domain' then 1
      when e.source_type = 'official_website' then 2
      else 3
    end as identity_priority
  from _kpc_seed_external_identities e
) dedupe
order by source_type_key, external_id, identity_priority, seed_key;

update public.kpc_external_identities kei
set
  organization_id = p.organization_id,
  keepr_pro_id = coalesce(kei.keepr_pro_id, p.keepr_pro_id),
  source_url = coalesce(nullif(kei.source_url, ''), e.source_url),
  raw_types = (
    select coalesce(jsonb_agg(distinct value order by value), '[]'::jsonb)
    from (
      select value from jsonb_array_elements_text(coalesce(kei.raw_types, '[]'::jsonb))
      union
      select value from jsonb_array_elements_text(e.raw_types)
    ) raw
  ),
  source_metadata = coalesce(kei.source_metadata, '{}'::jsonb) || e.source_metadata || jsonb_build_object('seed_version', '20260812113000'),
  authority_state = case
    when kei.authority_state in ('org_confirmed', 'counterparty_confirmed', 'evidence_verified') then kei.authority_state
    else e.authority_state
  end,
  verified_at = coalesce(kei.verified_at, now()),
  last_seen_at = now(),
  updated_at = now()
from _kpc_seed_external_identity_rows e
join _kpc_seed_profiles p on p.seed_key = e.seed_key
where lower(kei.source_type) = lower(e.source_type)
  and kei.external_id = e.external_id;

insert into public.kpc_external_identities (
  organization_id,
  keepr_pro_id,
  source_type,
  external_id,
  source_url,
  raw_types,
  source_metadata,
  authority_state,
  verified_at
)
select
  p.organization_id,
  p.keepr_pro_id,
  e.source_type,
  e.external_id,
  e.source_url,
  e.raw_types,
  e.source_metadata || jsonb_build_object('seed_version', '20260812113000'),
  e.authority_state,
  now()
from _kpc_seed_external_identity_rows e
join _kpc_seed_profiles p on p.seed_key = e.seed_key
where not exists (
  select 1
  from public.kpc_external_identities kei
  where lower(kei.source_type) = lower(e.source_type)
    and kei.external_id = e.external_id
);

create temp table _kpc_marine_owner_resources (
  seed_key text not null,
  owner_resource_type text not null,
  resource_type text not null default 'other',
  title_label text not null,
  url text not null,
  routing_rule text,
  sort_order integer not null default 100
) on commit drop;

insert into _kpc_marine_owner_resources (seed_key, owner_resource_type, resource_type, title_label, url, routing_rule, sort_order)
select seed_key, 'official_website', 'model_page', 'Official Website', website, 'manufacturer_official_site', 10
from _kpc_seed_resolved_orgs
where nullif(website, '') is not null;

insert into _kpc_marine_owner_resources (seed_key, owner_resource_type, title_label, url, routing_rule, sort_order)
values
  ('brand_bayliner', 'owner_center', 'Owner Center', 'https://www.bayliner.com/us/en/owners.html', 'owner_resources', 20),
  ('brand_bayliner', 'support', 'Support / Contact', 'https://www.bayliner.com/us/en/contact-us.html', 'manufacturer_contact_form', 30),
  ('brand_bayliner', 'dealer_locator', 'Dealer Locator', 'https://www.bayliner.com/us/en/dealer-locator.html', 'authorized_dealer_locator', 60),
  ('brand_bennington', 'owner_center', 'Owner Center', 'https://www.benningtonmarine.com/owners/', 'owner_resources', 20),
  ('brand_bennington', 'support', 'Support / Contact', 'https://www.benningtonmarine.com/contact/', 'manufacturer_contact_form', 30),
  ('brand_bennington', 'dealer_locator', 'Dealer Locator', 'https://www.benningtonmarine.com/find-a-dealer/', 'authorized_dealer_locator', 60),
  ('brand_crestliner', 'support', 'Support / Contact', 'https://www.crestliner.com/contact-us/', 'manufacturer_contact_form', 30),
  ('brand_crestliner', 'dealer_locator', 'Dealer Locator', 'https://www.crestliner.com/find-a-dealer/', 'authorized_dealer_locator', 60),
  ('brand_crownline', 'support', 'Support / Contact', 'https://www.crownline.com/contact-us/', 'manufacturer_contact_form', 30),
  ('brand_crownline', 'dealer_locator', 'Dealer Locator', 'https://www.crownline.com/dealer-locator/', 'authorized_dealer_locator', 60),
  ('brand_evotti', 'support', 'Support / Contact', 'https://www.evottimarine.com/contact', 'manufacturer_contact_form', 30),
  ('brand_harris', 'owner_center', 'Owner Center', 'https://www.harrisboats.com/owners/', 'owner_resources', 20),
  ('brand_harris', 'support', 'Support / Contact', 'https://www.harrisboats.com/contact-us/', 'manufacturer_contact_form', 30),
  ('brand_harris', 'dealer_locator', 'Dealer Locator', 'https://www.harrisboats.com/dealer-locator/', 'authorized_dealer_locator', 60),
  ('brand_heyday', 'support', 'Support / Contact', 'https://www.heydaywakeboats.com/contact-us.html', 'manufacturer_contact_form', 30),
  ('brand_heyday', 'dealer_locator', 'Dealer Locator', 'https://www.heydaywakeboats.com/find-a-dealer.html', 'authorized_dealer_locator', 60),
  ('brand_mercury', 'owner_center', 'Owner Service', 'https://www.mercurymarine.com/us/en/owner-service/', 'owner_service', 20),
  ('brand_mercury', 'manuals_documentation', 'Manuals and Maintenance', 'https://www.mercurymarine.com/us/en/owner-service/manuals-and-maintenance/', 'manuals_documentation', 40),
  ('brand_mercury', 'dealer_locator', 'Dealer Locator', 'https://www.mercurymarine.com/us/en/find-a-dealer/', 'authorized_dealer_locator', 60),
  ('brand_mercury', 'parts', 'Parts and Accessories', 'https://www.mercurymarine.com/us/en/parts-and-accessories/', 'parts_and_accessories', 70),
  ('brand_smoker_craft', 'support', 'Support / Contact', 'https://www.smokercraft.com/contact-us/', 'manufacturer_contact_form', 30),
  ('brand_smoker_craft', 'dealer_locator', 'Dealer Locator', 'https://www.smokercraft.com/find-a-dealer/', 'authorized_dealer_locator', 60),
  ('brand_sportsman', 'support', 'Support / Contact', 'https://www.sportsmanboatsmfg.com/contact', 'manufacturer_contact_form', 30),
  ('brand_sportsman', 'dealer_locator', 'Dealer Locator', 'https://www.sportsmanboatsmfg.com/dealers', 'authorized_dealer_locator', 60),
  ('brand_starweld', 'support', 'Support / Contact', 'https://www.starweld.com/contact-us/', 'manufacturer_contact_form', 30),
  ('brand_starweld', 'dealer_locator', 'Dealer Locator', 'https://www.starweld.com/find-a-dealer/', 'authorized_dealer_locator', 60),
  ('brand_sunchaser', 'support', 'Support / Contact', 'https://www.sunchaserboats.com/contact-us/', 'manufacturer_contact_form', 30),
  ('brand_sunchaser', 'dealer_locator', 'Dealer Locator', 'https://www.sunchaserboats.com/find-a-dealer/', 'authorized_dealer_locator', 60),
  ('brand_yamaha', 'owner_center', 'Owner Resources', 'https://yamahaoutboards.com/en-us/owner-resources', 'product_line_owner_resources', 20),
  ('brand_yamaha', 'support', 'Support / Contact', 'https://yamahaoutboards.com/en-us/contact-us', 'manufacturer_contact_form', 30),
  ('brand_yamaha', 'dealer_locator', 'Dealer Locator', 'https://yamahaoutboards.com/en-us/find-a-dealer', 'authorized_dealer_locator', 60),
  ('brand_yamaha', 'parts', 'Yamaha Parts and Accessories', 'https://yamahaoutboards.com/en-us/parts-accessories', 'parts_and_accessories', 70),
  ('brand_aquila', 'support', 'Support / Contact', 'https://www.aquilaboats.com/contact/', 'manufacturer_contact_form', 30),
  ('brand_aquila', 'dealer_locator', 'Dealer Locator', 'https://www.aquilaboats.com/dealers/', 'authorized_dealer_locator', 60),
  ('brand_aviara', 'support', 'Support / Contact', 'https://www.aviaraboats.com/contact', 'manufacturer_contact_form', 30),
  ('brand_aviara', 'dealer_locator', 'Dealer Locator', 'https://www.aviaraboats.com/dealers', 'authorized_dealer_locator', 60),
  ('brand_azimut', 'support', 'Support / Contact', 'https://www.azimutyachts.com/en/contact-us/', 'manufacturer_contact_form', 30),
  ('brand_azimut', 'dealer_locator', 'Dealer Locator', 'https://www.azimutyachts.com/en/dealer-locator/', 'authorized_dealer_locator', 60),
  ('brand_cruisers_yachts', 'support', 'Support / Contact', 'https://www.cruisersyachts.com/contact/', 'manufacturer_contact_form', 30),
  ('brand_cruisers_yachts', 'dealer_locator', 'Dealer Locator', 'https://www.cruisersyachts.com/find-a-dealer/', 'authorized_dealer_locator', 60),
  ('brand_galeon', 'support', 'Support / Contact', 'https://www.galeonyachts.us/contact/', 'manufacturer_contact_form', 30),
  ('brand_galeon', 'dealer_locator', 'Dealer Locator', 'https://www.galeonyachts.us/dealers/', 'authorized_dealer_locator', 60),
  ('brand_scout', 'support', 'Support / Contact', 'https://www.scoutboats.com/contact-us/', 'manufacturer_contact_form', 30),
  ('brand_scout', 'dealer_locator', 'Dealer Locator', 'https://www.scoutboats.com/dealer-locator/', 'authorized_dealer_locator', 60),
  ('brand_sea_ray', 'owner_center', 'Owner Center', 'https://www.searay.com/us/en/owners', 'owner_resources', 20),
  ('brand_sea_ray', 'warranty', 'Warranty', 'https://www.searay.com/us/en/owners/warranty.html', 'warranty_resources', 50),
  ('brand_sea_ray', 'ownership_transfer', 'Transfer Ownership', 'https://www.searay.com/us/en/owners/transfer-ownership.html', 'ownership_transfer', 80),
  ('brand_sea_ray', 'manuals_documentation', 'Documents and Manuals', 'https://www.searay.com/us/en/owners/documents-and-manuals.html', 'manuals_documentation', 40),
  ('brand_sea_ray', 'dealer_locator', 'Dealer Locator', 'https://www.searay.com/us/en/find-a-dealer.html', 'authorized_dealer_locator', 60),
  ('brand_tiara_yachts', 'owner_center', 'Owner Resources', 'https://www.tiarayachts.com/owners-resources', 'owner_resources', 20),
  ('brand_tiara_yachts', 'support', 'Contact Tiara', 'https://www.tiarayachts.com/contact-us', 'manufacturer_contact_form', 30),
  ('brand_tiara_yachts', 'dealer_locator', 'Find Your Dealer', 'https://www.tiarayachts.com/dealers', 'authorized_dealer_locator', 60),
  ('brand_tiara_yachts', 'ownership_transfer', 'Transfer of Ownership and Warranty', 'https://www.tiarayachts.com/transfer-of-ownership-warranty', 'ownership_transfer', 80),
  ('brand_tiara_yachts', 'parts', 'Tiara Merchandise and Owner Shop', 'https://shoptiarayachts.com/', 'owner_shop', 70);

update public.asset_resources ar
set
  title = r.display_name || ' ' || res.title_label,
  url = res.url,
  source_name = r.source_name,
  source_platform = 'official_manufacturer',
  source_url = coalesce(res.url, r.source_url),
  captured_at = coalesce(ar.captured_at, now()),
  authority_state = 'oem_published',
  rights_status = 'public_ok',
  metadata = coalesce(ar.metadata, '{}'::jsonb)
    || jsonb_strip_nulls(jsonb_build_object(
      'owner_resource_type', res.owner_resource_type,
      'routing_rule', res.routing_rule,
      'preferred_support_channel', r.preferred_support_channel,
      'warranty_routing_rule', r.warranty_routing_rule,
      'parts_routing_rule', r.parts_routing_rule,
      'warranty_transfer_availability', r.warranty_transfer_availability,
      'support_phone', r.support_phone,
      'support_email', r.support_email,
      'contact_form_url', r.contact_form_url,
      'official_source', true,
      'verified_at', now(),
      'seed_version', '20260812113000',
      'sort_order', res.sort_order
    )),
  updated_at = now()
from _kpc_marine_owner_resources res
join _kpc_seed_resolved_orgs r on r.seed_key = res.seed_key
where ar.applies_to_type = 'org'
  and ar.applies_to_id = r.organization_id
  and ar.source_platform = 'official_manufacturer'
  and ar.metadata ->> 'owner_resource_type' = res.owner_resource_type;

insert into public.asset_resources (
  resource_type,
  title,
  url,
  source_name,
  source_platform,
  source_url,
  captured_at,
  authority_state,
  rights_status,
  applies_to_type,
  applies_to_id,
  metadata
)
select
  res.resource_type,
  r.display_name || ' ' || res.title_label,
  res.url,
  r.source_name,
  'official_manufacturer',
  coalesce(res.url, r.source_url),
  now(),
  'oem_published',
  'public_ok',
  'org',
  r.organization_id,
  jsonb_strip_nulls(jsonb_build_object(
    'owner_resource_type', res.owner_resource_type,
    'routing_rule', res.routing_rule,
    'preferred_support_channel', r.preferred_support_channel,
    'warranty_routing_rule', r.warranty_routing_rule,
    'parts_routing_rule', r.parts_routing_rule,
    'warranty_transfer_availability', r.warranty_transfer_availability,
    'support_phone', r.support_phone,
    'support_email', r.support_email,
    'contact_form_url', r.contact_form_url,
    'official_source', true,
    'verified_at', now(),
    'seed_version', '20260812113000',
    'sort_order', res.sort_order
  ))
from _kpc_marine_owner_resources res
join _kpc_seed_resolved_orgs r on r.seed_key = res.seed_key
where not exists (
  select 1
  from public.asset_resources ar
  where ar.applies_to_type = 'org'
    and ar.applies_to_id = r.organization_id
    and ar.source_platform = 'official_manufacturer'
    and ar.metadata ->> 'owner_resource_type' = res.owner_resource_type
);

create temp table _kpc_dealer_brand_relationships (
  dealer_seed_key text not null,
  brand_seed_key text not null,
  source_name text not null,
  source_url text not null
) on commit drop;

insert into _kpc_dealer_brand_relationships (dealer_seed_key, brand_seed_key, source_name, source_url)
values
  ('dealer_wilson', 'brand_bayliner', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_bennington', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_crestliner', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_crownline', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_evotti', 'Wilson Marine inventory manufacturer facet', 'https://www.wilsonboats.com/search/inventory/usage/Used'),
  ('dealer_wilson', 'brand_harris', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_heyday', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_mercury', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_smoker_craft', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_sportsman', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_starweld', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_sunchaser', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_wilson', 'brand_yamaha', 'Wilson Marine Brands We Carry', 'https://www.wilsonboats.com/new-models'),
  ('dealer_skipperbuds', 'brand_aquila', 'SkipperBud''s brands page', 'https://www.skipperbuds.com/brands'),
  ('dealer_skipperbuds', 'brand_aviara', 'SkipperBud''s brands page', 'https://www.skipperbuds.com/brands'),
  ('dealer_skipperbuds', 'brand_azimut', 'SkipperBud''s brands page', 'https://www.skipperbuds.com/brands'),
  ('dealer_skipperbuds', 'brand_cruisers_yachts', 'SkipperBud''s brands page', 'https://www.skipperbuds.com/brands'),
  ('dealer_skipperbuds', 'brand_galeon', 'SkipperBud''s brands page', 'https://www.skipperbuds.com/brands'),
  ('dealer_skipperbuds', 'brand_scout', 'SkipperBud''s brands page', 'https://www.skipperbuds.com/brands'),
  ('dealer_skipperbuds', 'brand_sea_ray', 'SkipperBud''s brands page', 'https://www.skipperbuds.com/brands'),
  ('dealer_skipperbuds', 'brand_tiara_yachts', 'SkipperBud''s brands page', 'https://www.skipperbuds.com/brands');

update public.org_relationships rel
set
  status = case when rel.status in ('active', 'source_reported') then rel.status else 'source_reported' end,
  evidence_state = case
    when rel.evidence_state in ('org_confirmed', 'counterparty_confirmed', 'evidence_verified', 'oem_published') then rel.evidence_state
    else 'public_source_reported'
  end,
  authority_state = case
    when rel.authority_state in ('org_confirmed', 'counterparty_confirmed', 'evidence_verified') then rel.authority_state
    else 'public_source_reported'
  end,
  source_name = coalesce(nullif(rel.source_name, ''), dbr.source_name),
  source_url = coalesce(nullif(rel.source_url, ''), dbr.source_url),
  metadata = coalesce(rel.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'source_type', 'dealer_public_website',
      'relationship_evidence', 'public_source_reported',
      'seed_version', '20260812113000'
    ),
  updated_at = now()
from _kpc_dealer_brand_relationships dbr
join _kpc_seed_resolved_orgs dealer on dealer.seed_key = dbr.dealer_seed_key
join _kpc_seed_resolved_orgs brand on brand.seed_key = dbr.brand_seed_key
where rel.from_org_id = dealer.organization_id
  and rel.to_org_id = brand.organization_id
  and rel.relationship_type = 'represented_brand'
  and rel.status in ('source_reported', 'active', 'inactive', 'disputed');

insert into public.org_relationships (
  from_org_id,
  to_org_id,
  relationship_type,
  status,
  evidence_state,
  authority_state,
  source_name,
  source_url,
  metadata
)
select
  dealer.organization_id,
  brand.organization_id,
  'represented_brand',
  'source_reported',
  'public_source_reported',
  'public_source_reported',
  dbr.source_name,
  dbr.source_url,
  jsonb_build_object(
    'source_type', 'dealer_public_website',
    'relationship_evidence', 'public_source_reported',
    'seed_version', '20260812113000'
  )
from _kpc_dealer_brand_relationships dbr
join _kpc_seed_resolved_orgs dealer on dealer.seed_key = dbr.dealer_seed_key
join _kpc_seed_resolved_orgs brand on brand.seed_key = dbr.brand_seed_key
where not exists (
  select 1
  from public.org_relationships rel
  where rel.from_org_id = dealer.organization_id
    and rel.to_org_id = brand.organization_id
    and rel.relationship_type = 'represented_brand'
    and rel.status in ('source_reported', 'active')
);
