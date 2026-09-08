-- Read-only privilege smoke for the 2026-09-08 function grant hardening patch.
-- This file performs catalog privilege checks only; it does not execute the
-- functions under test and does not mutate production data.

\echo '== connection =='
select current_database() as db, current_user as user_name;

\echo '== public-safe anon callable functions =='
with expected(fn) as (
  values
    ('public.keeprlink_slugify(text)'::regprocedure),
    ('public.keeprlink_normalize_address(text)'::regprocedure),
    ('public.keeprlink_compact_address(text)'::regprocedure),
    ('public.keeprlink_purpose(text)'::regprocedure),
    ('public.keeprlink_public_purpose(text)'::regprocedure),
    ('public.keeprlink_context_instructions(text, boolean)'::regprocedure),
    ('public.resolve_keeprlink_context(text, text, uuid, boolean)'::regprocedure),
    ('public.system_template_canonical_key(text, text)'::regprocedure)
)
select
  fn::text as function_signature,
  has_function_privilege('anon', fn, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', fn, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', fn, 'EXECUTE') as service_role_execute
from expected
order by function_signature;

\echo '== restricted functions must not be anon callable =='
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
    ('public.keepr_attachment_owned_by_user(uuid, uuid)'::regprocedure, 'AUTHENTICATED READ / POLICY HELPER'),
    ('public.ensure_asset_keepr_link(uuid)'::regprocedure, 'INTERNAL/ADMIN ONLY MUTATION'),
    ('public.promote_system_to_system_template(uuid, jsonb)'::regprocedure, 'AUTHENTICATED MUTATION'),
    ('public.sync_asset_keepr_link()'::regprocedure, 'TRIGGER ONLY'),
    ('public.apply_system_template_reference_from_metadata()'::regprocedure, 'TRIGGER ONLY')
)
select
  fn::text as function_signature,
  intended_classification,
  has_function_privilege('anon', fn, 'EXECUTE') as anon_execute,
  has_function_privilege('authenticated', fn, 'EXECUTE') as authenticated_execute,
  has_function_privilege('service_role', fn, 'EXECUTE') as service_role_execute
from restricted
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
    ('public.keepr_attachment_owned_by_user(uuid, uuid)'::regprocedure, 'AUTHENTICATED READ / POLICY HELPER'),
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
