-- Production function grant hardening for the 2026-09-08 convergence package.
-- Privileges only. No schema shape, data, policy, or product behavior changes.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. This patch
-- removes that inherited surface and grants only the intended direct callers.

begin;

\echo '== hardening public-safe KeeprLINK resolver entrypoints =='
revoke all on function public.keeprlink_slugify(text) from PUBLIC;
revoke all on function public.keeprlink_normalize_address(text) from PUBLIC;
revoke all on function public.keeprlink_compact_address(text) from PUBLIC;
revoke all on function public.keeprlink_purpose(text) from PUBLIC;
revoke all on function public.keeprlink_public_purpose(text) from PUBLIC;
revoke all on function public.keeprlink_context_instructions(text, boolean) from PUBLIC;
revoke all on function public.resolve_keeprlink_context(text, text, uuid, boolean) from PUBLIC;
revoke all on function public.system_template_canonical_key(text, text) from PUBLIC;

grant execute on function public.keeprlink_slugify(text) to anon, authenticated, service_role;
grant execute on function public.keeprlink_normalize_address(text) to anon, authenticated, service_role;
grant execute on function public.keeprlink_compact_address(text) to anon, authenticated, service_role;
grant execute on function public.keeprlink_purpose(text) to anon, authenticated, service_role;
grant execute on function public.keeprlink_public_purpose(text) to anon, authenticated, service_role;
grant execute on function public.keeprlink_context_instructions(text, boolean) to anon, authenticated, service_role;
grant execute on function public.resolve_keeprlink_context(text, text, uuid, boolean) to anon, authenticated, service_role;
grant execute on function public.system_template_canonical_key(text, text) to anon, authenticated, service_role;

\echo '== hardening internal KeeprLINK projection helpers =='
revoke all on function public.keeprlink_resource_projection(text, uuid[], boolean) from PUBLIC;
revoke all on function public.keeprlink_org_context(uuid, text, boolean) from PUBLIC;
revoke all on function public.keeprlink_model_context(uuid, text, boolean) from PUBLIC;
revoke all on function public.keeprlink_system_template_context(uuid, text, boolean) from PUBLIC;
revoke all on function public.keeprlink_asset_context(uuid, text, boolean) from PUBLIC;
revoke all on function public.keeprlink_system_instance_context(uuid, text, boolean) from PUBLIC;

grant execute on function public.keeprlink_resource_projection(text, uuid[], boolean) to service_role;
grant execute on function public.keeprlink_org_context(uuid, text, boolean) to service_role;
grant execute on function public.keeprlink_model_context(uuid, text, boolean) to service_role;
grant execute on function public.keeprlink_system_template_context(uuid, text, boolean) to service_role;
grant execute on function public.keeprlink_asset_context(uuid, text, boolean) to service_role;
grant execute on function public.keeprlink_system_instance_context(uuid, text, boolean) to service_role;

\echo '== hardening authenticated organization lookup/read RPCs =='
revoke all on function public.search_keeprspace_organizations(text, text) from PUBLIC;
revoke all on function public.list_organization_supplier_network(uuid, text, integer) from PUBLIC;

grant execute on function public.search_keeprspace_organizations(text, text) to authenticated, service_role;
grant execute on function public.list_organization_supplier_network(uuid, text, integer) to authenticated, service_role;

\echo '== hardening attachment policy helper =='
revoke all on function public.keepr_attachment_owned_by_user(uuid, uuid) from PUBLIC;
grant execute on function public.keepr_attachment_owned_by_user(uuid, uuid) to authenticated, service_role;

\echo '== hardening mutation and trigger functions =='
revoke all on function public.ensure_asset_keepr_link(uuid) from PUBLIC;
revoke all on function public.promote_system_to_system_template(uuid, jsonb) from PUBLIC;
revoke all on function public.sync_asset_keepr_link() from PUBLIC;
revoke all on function public.apply_system_template_reference_from_metadata() from PUBLIC;

grant execute on function public.ensure_asset_keepr_link(uuid) to service_role;
grant execute on function public.promote_system_to_system_template(uuid, jsonb) to authenticated, service_role;

comment on function public.resolve_keeprlink_context(text, text, uuid, boolean) is
  'Public-safe KeeprLINK resolver entrypoint. Direct anon execution is intentionally allowed for /api/k/.../context projections; non-public data remains governed by purpose and authorization policy.';

comment on function public.keeprlink_resource_projection(text, uuid[], boolean) is
  'Internal KeeprLINK projection helper. Direct client RPC access is intentionally revoked; public context should enter through resolve_keeprlink_context.';

comment on function public.ensure_asset_keepr_link(uuid) is
  'Internal asset KeeprLINK synchronization helper. Direct client RPC access is restricted; normal execution occurs through the asset trigger or trusted service operations.';

comment on function public.sync_asset_keepr_link() is
  'Trigger function for asset KeeprLINK synchronization. No direct client RPC grant is required.';

comment on function public.apply_system_template_reference_from_metadata() is
  'Trigger function for applying System Template references from system metadata. No direct client RPC grant is required.';

select pg_notify('pgrst', 'reload schema');

commit;
