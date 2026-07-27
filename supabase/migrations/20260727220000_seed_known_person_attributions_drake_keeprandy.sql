-- Historical attribution seed approved by Andy Drake.
-- Inserts verified person attribution for known legitimate referrals only.
-- This does not infer from views/sessions and does not touch non-member "web" attribution.

with approved_seed(user_id, source_slug, expected_email) as (
  values
    ('12075442-20aa-4459-be8c-df64c918d348'::uuid, 'drake', 'chloecoviak10@yahoo.com'),
    ('ad5f044d-dcd4-4368-bdf2-313f96d971b3'::uuid, 'drake', 'weyjinc@hotmail.com'),
    ('ec2c19ea-c1c2-4177-8c7b-58fbed6ffe08'::uuid, 'drake', 'samanthanoles99@gmail.com'),
    ('0b2f95e4-610f-42fa-9700-0ad2f3014cf3'::uuid, 'drake', 'ncuttitta@gmail.com'),
    ('54807d63-4067-44fe-9e5f-2be2a9d3cab0'::uuid, 'drake', 'nyumamphande9@gmail.com'),
    ('8f7999cd-0f6d-4821-b332-920dc99b4bd2'::uuid, 'drake', 'c.mcintyre3165@gmail.com'),
    ('072f3641-5768-490c-be4d-0ff3b08b0c17'::uuid, 'drake', 'don@chuntung.com'),
    ('db7d5112-0119-4a5e-98fb-b3c88aac9102'::uuid, 'drake', 'jacqui.ewasyshyn@gmail.com'),
    ('c0e06ae7-579e-4f9a-9bc2-2c3e974ca27b'::uuid, 'drake', 'justintime3579@gmail.com'),
    ('bf8d47cc-7dcb-4738-811c-fff25bd01717'::uuid, 'drake', 'pattycak3y@outlook.com'),
    ('d3b1dfb3-a5e0-4239-839e-5feaaa22084b'::uuid, 'drake', 'cogitoproperties@gmail.com'),
    ('a6c7a364-6347-46e0-841e-4b65656a563b'::uuid, 'drake', 'baileyhipple@gmail.com'),
    ('9d74218b-7f1c-4cf7-a1ed-1ca79a9eedf4'::uuid, 'drake', 'joelle.imbery@gmail.com'),
    ('92ffbfba-14fe-42d1-8dd7-b82e6d8f0a63'::uuid, 'drake', 'lea.marie.morris@gmail.com'),
    ('52d65dc7-da5b-4886-aead-d19cd8c8f002'::uuid, 'drake', 'stgabriel78@gmail.com'),
    ('bf64d503-583b-47c7-b71b-413f40066a75'::uuid, 'drake', 'issahjkaputira@gmail.com'),
    ('22f1f16d-edb5-4b50-a7fe-8624a367faab'::uuid, 'keeprandy', 'yogaannebeck@gmail.com'),
    ('67187ffd-36a4-4e18-9d1d-e036b4610220'::uuid, 'keeprandy', 'aussicker15@gmail.com'),
    ('d5feb1e4-011a-4893-bea4-9a6b94eb9f8c'::uuid, 'keeprandy', 'erferris@yahoo.com'),
    ('7a1a61f0-f793-4598-addc-a027bb93e54f'::uuid, 'keeprandy', 'drewpetty@ymail.com'),
    ('f741da8c-957b-4951-b58e-444240ba0022'::uuid, 'keeprandy', 'roland.tj6@sbcglobal.net'),
    ('d384fc41-419f-4836-aa36-1db675d09c97'::uuid, 'keeprandy', 'jeremyjon@msn.com'),
    ('f5249a9b-95ac-4fad-aab9-6279b9813cc1'::uuid, 'keeprandy', 'echodk01@gmail.com'),
    ('a8a42c8b-f027-4b66-8d9a-7f1c5a0ff357'::uuid, 'keeprandy', 'jodywalker30@gmail.com'),
    ('6705d511-be4b-4381-a8e2-b27e2fc6b26d'::uuid, 'keeprandy', 'kdrake57@comcast.net'),
    ('1ed8fa84-99b3-47f8-af96-cfe8ff8c4cfc'::uuid, 'keeprandy', 'kevin.h.tierney@gmail.com'),
    ('078776d8-b9a9-4b87-b1a8-dc425e54c149'::uuid, 'keeprandy', 'dfsdfwb@gmail.com'),
    ('a120bf96-27f7-4819-bb1e-6022fd14f6dc'::uuid, 'keeprandy', 'gregbeck01@gmail.com'),
    ('75b4c537-4ece-4e80-92c5-87e54953ae75'::uuid, 'keeprandy', 'drakemp21@gmail.com'),
    ('5650517e-2894-4c40-9bee-a8e3a59177f4'::uuid, 'keeprandy', 'drewdrake3@gmail.com'),
    ('671b5161-c015-4d95-99bf-f5bba65749ab'::uuid, 'keeprandy', 'kimdrake@comcast.net'),
    ('bdf68210-7b00-441b-aae9-36e461538dd8'::uuid, 'keeprandy', 'tdnbd@aol.com'),
    ('27c861e2-8feb-4f29-94b1-4ca2e8ab283f'::uuid, 'keeprandy', 'davidmorgan0219@gmail.com'),
    ('d114b5d1-5f19-4e7f-93f5-892d89fe8778'::uuid, 'keeprandy', 'falconeddie1960@gmail.com')
),
validated_seed as (
  select
    seed.user_id,
    seed.source_slug,
    p.created_at as profile_created_at,
    src.activation_source_id,
    source.owner_user_id as initiating_actor_id
  from approved_seed seed
  join public.profiles p
    on p.id = seed.user_id
   and lower(p.email) = lower(seed.expected_email)
  join public.activation_source_slugs src
    on src.normalized_slug = seed.source_slug
   and src.status = 'active'
  join public.activation_sources source
    on source.id = src.activation_source_id
   and source.source_type = 'user'
   and source.status = 'active'
  where not exists (
    select 1
    from public.attribution_records existing
    where existing.user_id = seed.user_id
  )
)
insert into public.attribution_records (
  activation_source_id,
  activation_session_id,
  user_id,
  profile_id,
  source_slug_snapshot,
  source_type_snapshot,
  attribution_model,
  initiating_actor_id,
  intended_action,
  verified_at,
  status,
  metadata,
  created_at,
  updated_at
)
select
  activation_source_id,
  null,
  user_id,
  user_id,
  source_slug,
  'user',
  'person',
  initiating_actor_id,
  'signup',
  profile_created_at,
  'verified',
  jsonb_build_object(
    'backfill_source', 'andy_approved_historical_seed',
    'approved_by', 'Andy Drake',
    'approved_at', now(),
    'migration', '20260727220000_seed_known_person_attributions_drake_keeprandy',
    'evidence', 'Andy supplied known legitimate referral list'
  ),
  profile_created_at,
  now()
from validated_seed
on conflict (user_id) do nothing;

with approved_seed(user_id, source_slug, expected_email) as (
  values
    ('12075442-20aa-4459-be8c-df64c918d348'::uuid, 'drake', 'chloecoviak10@yahoo.com'),
    ('ad5f044d-dcd4-4368-bdf2-313f96d971b3'::uuid, 'drake', 'weyjinc@hotmail.com'),
    ('ec2c19ea-c1c2-4177-8c7b-58fbed6ffe08'::uuid, 'drake', 'samanthanoles99@gmail.com'),
    ('0b2f95e4-610f-42fa-9700-0ad2f3014cf3'::uuid, 'drake', 'ncuttitta@gmail.com'),
    ('54807d63-4067-44fe-9e5f-2be2a9d3cab0'::uuid, 'drake', 'nyumamphande9@gmail.com'),
    ('8f7999cd-0f6d-4821-b332-920dc99b4bd2'::uuid, 'drake', 'c.mcintyre3165@gmail.com'),
    ('072f3641-5768-490c-be4d-0ff3b08b0c17'::uuid, 'drake', 'don@chuntung.com'),
    ('db7d5112-0119-4a5e-98fb-b3c88aac9102'::uuid, 'drake', 'jacqui.ewasyshyn@gmail.com'),
    ('c0e06ae7-579e-4f9a-9bc2-2c3e974ca27b'::uuid, 'drake', 'justintime3579@gmail.com'),
    ('bf8d47cc-7dcb-4738-811c-fff25bd01717'::uuid, 'drake', 'pattycak3y@outlook.com'),
    ('d3b1dfb3-a5e0-4239-839e-5feaaa22084b'::uuid, 'drake', 'cogitoproperties@gmail.com'),
    ('a6c7a364-6347-46e0-841e-4b65656a563b'::uuid, 'drake', 'baileyhipple@gmail.com'),
    ('9d74218b-7f1c-4cf7-a1ed-1ca79a9eedf4'::uuid, 'drake', 'joelle.imbery@gmail.com'),
    ('92ffbfba-14fe-42d1-8dd7-b82e6d8f0a63'::uuid, 'drake', 'lea.marie.morris@gmail.com'),
    ('52d65dc7-da5b-4886-aead-d19cd8c8f002'::uuid, 'drake', 'stgabriel78@gmail.com'),
    ('bf64d503-583b-47c7-b71b-413f40066a75'::uuid, 'drake', 'issahjkaputira@gmail.com'),
    ('22f1f16d-edb5-4b50-a7fe-8624a367faab'::uuid, 'keeprandy', 'yogaannebeck@gmail.com'),
    ('67187ffd-36a4-4e18-9d1d-e036b4610220'::uuid, 'keeprandy', 'aussicker15@gmail.com'),
    ('d5feb1e4-011a-4893-bea4-9a6b94eb9f8c'::uuid, 'keeprandy', 'erferris@yahoo.com'),
    ('7a1a61f0-f793-4598-addc-a027bb93e54f'::uuid, 'keeprandy', 'drewpetty@ymail.com'),
    ('f741da8c-957b-4951-b58e-444240ba0022'::uuid, 'keeprandy', 'roland.tj6@sbcglobal.net'),
    ('d384fc41-419f-4836-aa36-1db675d09c97'::uuid, 'keeprandy', 'jeremyjon@msn.com'),
    ('f5249a9b-95ac-4fad-aab9-6279b9813cc1'::uuid, 'keeprandy', 'echodk01@gmail.com'),
    ('a8a42c8b-f027-4b66-8d9a-7f1c5a0ff357'::uuid, 'keeprandy', 'jodywalker30@gmail.com'),
    ('6705d511-be4b-4381-a8e2-b27e2fc6b26d'::uuid, 'keeprandy', 'kdrake57@comcast.net'),
    ('1ed8fa84-99b3-47f8-af96-cfe8ff8c4cfc'::uuid, 'keeprandy', 'kevin.h.tierney@gmail.com'),
    ('078776d8-b9a9-4b87-b1a8-dc425e54c149'::uuid, 'keeprandy', 'dfsdfwb@gmail.com'),
    ('a120bf96-27f7-4819-bb1e-6022fd14f6dc'::uuid, 'keeprandy', 'gregbeck01@gmail.com'),
    ('75b4c537-4ece-4e80-92c5-87e54953ae75'::uuid, 'keeprandy', 'drakemp21@gmail.com'),
    ('5650517e-2894-4c40-9bee-a8e3a59177f4'::uuid, 'keeprandy', 'drewdrake3@gmail.com'),
    ('671b5161-c015-4d95-99bf-f5bba65749ab'::uuid, 'keeprandy', 'kimdrake@comcast.net'),
    ('bdf68210-7b00-441b-aae9-36e461538dd8'::uuid, 'keeprandy', 'tdnbd@aol.com'),
    ('27c861e2-8feb-4f29-94b1-4ca2e8ab283f'::uuid, 'keeprandy', 'davidmorgan0219@gmail.com'),
    ('d114b5d1-5f19-4e7f-93f5-892d89fe8778'::uuid, 'keeprandy', 'falconeddie1960@gmail.com')
)
update public.profiles p
set acquisition_source_slug = seed.source_slug
from approved_seed seed
where p.id = seed.user_id
  and lower(p.email) = lower(seed.expected_email)
  and p.acquisition_source_slug is null;
