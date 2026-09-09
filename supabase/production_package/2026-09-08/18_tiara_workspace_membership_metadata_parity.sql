begin;

update public.orgs
set
  org_type = 'keeproem',
  organization_type = 'oem',
  workspace_type = 'keeproem',
  status = 'active',
  updated_at = now()
where id = '5b04d645-fb63-44d0-be1c-52a0b5d40c3a'::uuid
  and slug = 'tiara-yachts'
  and name = 'Tiara Yachts';

update public.org_members
set
  member_role = 'manager',
  role = 'manager',
  status = 'active',
  joined_at = coalesce(joined_at, now()),
  metadata = coalesce(metadata, '{}'::jsonb)
    || jsonb_build_object(
      'projection', 'oem',
      'workspace_role', 'oem_operator',
      'activation_purpose', 'activation_operator',
      'demo_membership', true,
      'demo_purpose', 'activator_projection_demo',
      'real_world_claim_state_override', false,
      'normalized_by', 'production_parity_20260909'
    )
where org_id = '5b04d645-fb63-44d0-be1c-52a0b5d40c3a'::uuid
  and user_id = '7d8548fa-ac68-4f41-bb33-6af1bdca7f2e'::uuid;

notify pgrst, 'reload schema';

commit;
