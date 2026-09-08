-- Read-only privilege smoke for the 2026-09-08 function grant hardening patch.
-- Catalog privilege checks only; does not execute the functions under test and
-- does not mutate production data.

\echo '== connection =='
select current_database() as db, current_user as user_name;

\echo '== complete intended function caller matrix =='
with intended(fn, classification, expect_anon, expect_authenticated, expect_service_role) as (
  values
    ('public.keeprlink_slugify(text)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.keeprlink_normalize_address(text)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.keeprlink_compact_address(text)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.keeprlink_purpose(text)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.keeprlink_public_purpose(text)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.keeprlink_context_instructions(text, boolean)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.resolve_keeprlink_context(text, text, uuid, boolean)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.system_template_canonical_key(text, text)'::regprocedure, 'PUBLIC/ANON SAFE PURE HELPER', true, true, true),

    ('public.keeprlink_resource_projection(text, uuid[], boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.keeprlink_org_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.keeprlink_model_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.keeprlink_system_template_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.keeprlink_asset_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.keeprlink_system_instance_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),

    ('public.search_keeprspace_organizations(text, text)'::regprocedure, 'AUTHENTICATED READ', false, true, true),
    ('public.list_organization_supplier_network(uuid, text, integer)'::regprocedure, 'AUTHENTICATED READ', false, true, true),
    ('public.keepr_attachment_owned_by_user(uuid, uuid)'::regprocedure, 'AUTHENTICATED POLICY HELPER', false, true, true),
    ('public.promote_system_to_system_template(uuid, jsonb)'::regprocedure, 'AUTHENTICATED MUTATION', false, true, true),

    ('public.ensure_asset_keepr_link(uuid)'::regprocedure, 'INTERNAL/ADMIN ONLY MUTATION', false, false, true),
    ('public.sync_asset_keepr_link()'::regprocedure, 'TRIGGER ONLY', false, false, true),
    ('public.apply_system_template_reference_from_metadata()'::regprocedure, 'TRIGGER ONLY', false, false, true)
),
actual as (
  select
    fn,
    classification,
    expect_anon,
    expect_authenticated,
    expect_service_role,
    has_function_privilege('anon', fn, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', fn, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', fn, 'EXECUTE') as service_role_execute
  from intended
)
select
  fn::text as function_signature,
  classification,
  expect_anon,
  anon_execute,
  expect_authenticated,
  authenticated_execute,
  expect_service_role,
  service_role_execute
from actual
order by function_signature;

\echo '== privilege matrix violations: must be zero rows =='
with intended(fn, classification, expect_anon, expect_authenticated, expect_service_role) as (
  values
    ('public.keeprlink_slugify(text)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.keeprlink_normalize_address(text)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.keeprlink_compact_address(text)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.keeprlink_purpose(text)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.keeprlink_public_purpose(text)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.keeprlink_context_instructions(text, boolean)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.resolve_keeprlink_context(text, text, uuid, boolean)'::regprocedure, 'PUBLIC/ANON SAFE', true, true, true),
    ('public.system_template_canonical_key(text, text)'::regprocedure, 'PUBLIC/ANON SAFE PURE HELPER', true, true, true),
    ('public.keeprlink_resource_projection(text, uuid[], boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.keeprlink_org_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.keeprlink_model_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.keeprlink_system_template_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.keeprlink_asset_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.keeprlink_system_instance_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY', false, false, true),
    ('public.search_keeprspace_organizations(text, text)'::regprocedure, 'AUTHENTICATED READ', false, true, true),
    ('public.list_organization_supplier_network(uuid, text, integer)'::regprocedure, 'AUTHENTICATED READ', false, true, true),
    ('public.keepr_attachment_owned_by_user(uuid, uuid)'::regprocedure, 'AUTHENTICATED POLICY HELPER', false, true, true),
    ('public.promote_system_to_system_template(uuid, jsonb)'::regprocedure, 'AUTHENTICATED MUTATION', false, true, true),
    ('public.ensure_asset_keepr_link(uuid)'::regprocedure, 'INTERNAL/ADMIN ONLY MUTATION', false, false, true),
    ('public.sync_asset_keepr_link()'::regprocedure, 'TRIGGER ONLY', false, false, true),
    ('public.apply_system_template_reference_from_metadata()'::regprocedure, 'TRIGGER ONLY', false, false, true)
),
actual as (
  select
    fn,
    classification,
    expect_anon,
    expect_authenticated,
    expect_service_role,
    has_function_privilege('anon', fn, 'EXECUTE') as anon_execute,
    has_function_privilege('authenticated', fn, 'EXECUTE') as authenticated_execute,
    has_function_privilege('service_role', fn, 'EXECUTE') as service_role_execute
  from intended
)
select
  fn::text as function_signature,
  classification,
  expect_anon,
  anon_execute,
  expect_authenticated,
  authenticated_execute,
  expect_service_role,
  service_role_execute
from actual
where anon_execute is distinct from expect_anon
   or authenticated_execute is distinct from expect_authenticated
   or service_role_execute is distinct from expect_service_role
order by function_signature;

\echo '== restricted anon violations: must be zero rows =='
with restricted(fn, intended_classification) as (
  values
    ('public.keeprlink_resource_projection(text, uuid[], boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY'),
    ('public.keeprlink_org_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY'),
    ('public.keeprlink_model_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY'),
    ('public.keeprlink_system_template_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY'),
    ('public.keeprlink_asset_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY'),
    ('public.keeprlink_system_instance_context(uuid, text, boolean)'::regprocedure, 'INTERNAL/ADMIN ONLY'),
    ('public.search_keeprspace_organizations(text, text)'::regprocedure, 'AUTHENTICATED READ'),
    ('public.list_organization_supplier_network(uuid, text, integer)'::regprocedure, 'AUTHENTICATED READ'),
    ('public.keepr_attachment_owned_by_user(uuid, uuid)'::regprocedure, 'AUTHENTICATED POLICY HELPER'),
    ('public.ensure_asset_keepr_link(uuid)'::regprocedure, 'INTERNAL/ADMIN ONLY MUTATION'),
    ('public.promote_system_to_system_template(uuid, jsonb)'::regprocedure, 'AUTHENTICATED MUTATION'),
    ('public.sync_asset_keepr_link()'::regprocedure, 'TRIGGER ONLY'),
    ('public.apply_system_template_reference_from_metadata()'::regprocedure, 'TRIGGER ONLY')
)
select fn::text as unexpected_anon_execute, intended_classification
from restricted
where has_function_privilege('anon', fn, 'EXECUTE')
order by unexpected_anon_execute;

\echo '== required authenticated flow grants =='
with required(fn, flow) as (
  values
    ('public.resolve_keeprlink_context(text, text, uuid, boolean)'::regprocedure, 'KeeprLINK /api/k context'),
    ('public.search_keeprspace_organizations(text, text)'::regprocedure, 'Organization lookup'),
    ('public.list_organization_supplier_network(uuid, text, integer)'::regprocedure, 'Supplier route'),
    ('public.promote_system_to_system_template(uuid, jsonb)'::regprocedure, 'System Library promotion'),
    ('public.keepr_attachment_owned_by_user(uuid, uuid)'::regprocedure, 'Attachment placement policies')
)
select
  fn::text as function_signature,
  flow,
  has_function_privilege('authenticated', fn, 'EXECUTE') as authenticated_execute
from required
order by function_signature;

\echo '== trigger-only direct client exposure: must be zero rows =='
with trigger_only(fn) as (
  values
    ('public.sync_asset_keepr_link()'::regprocedure),
    ('public.apply_system_template_reference_from_metadata()'::regprocedure)
)
select
  fn::text as exposed_trigger_function,
  has_function_privilege('anon', fn, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', fn, 'EXECUTE') as authenticated_execute
from trigger_only
where has_function_privilege('anon', fn, 'EXECUTE')
   or has_function_privilege('authenticated', fn, 'EXECUTE')
order by exposed_trigger_function;
