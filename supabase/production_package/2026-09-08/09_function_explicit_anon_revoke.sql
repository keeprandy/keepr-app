-- Explicit anon/auth cleanup after 07_function_grant_hardening.sql.
-- Privileges only. No function definitions, schema, RLS, data, or product
-- behavior changes.
--
-- 07 revoked inherited EXECUTE from PostgreSQL's PUBLIC pseudo-role. Earlier
-- convergence migrations had also granted some functions directly to anon.
-- This patch removes those explicit direct grants from restricted functions.

begin;

\echo '== removing explicit anon access from internal KeeprLINK projection helpers =='
revoke execute on function public.keeprlink_resource_projection(text, uuid[], boolean) from anon, authenticated;
revoke execute on function public.keeprlink_org_context(uuid, text, boolean) from anon, authenticated;
revoke execute on function public.keeprlink_model_context(uuid, text, boolean) from anon, authenticated;
revoke execute on function public.keeprlink_system_template_context(uuid, text, boolean) from anon, authenticated;
revoke execute on function public.keeprlink_asset_context(uuid, text, boolean) from anon, authenticated;
revoke execute on function public.keeprlink_system_instance_context(uuid, text, boolean) from anon, authenticated;

grant execute on function public.keeprlink_resource_projection(text, uuid[], boolean) to service_role;
grant execute on function public.keeprlink_org_context(uuid, text, boolean) to service_role;
grant execute on function public.keeprlink_model_context(uuid, text, boolean) to service_role;
grant execute on function public.keeprlink_system_template_context(uuid, text, boolean) to service_role;
grant execute on function public.keeprlink_asset_context(uuid, text, boolean) to service_role;
grant execute on function public.keeprlink_system_instance_context(uuid, text, boolean) to service_role;

\echo '== removing explicit anon access from authenticated-only read and policy helpers =='
revoke execute on function public.search_keeprspace_organizations(text, text) from anon;
revoke execute on function public.list_organization_supplier_network(uuid, text, integer) from anon;
revoke execute on function public.keepr_attachment_owned_by_user(uuid, uuid) from anon;

grant execute on function public.search_keeprspace_organizations(text, text) to authenticated, service_role;
grant execute on function public.list_organization_supplier_network(uuid, text, integer) to authenticated, service_role;
grant execute on function public.keepr_attachment_owned_by_user(uuid, uuid) to authenticated, service_role;

\echo '== removing explicit anon access from mutation functions =='
revoke execute on function public.ensure_asset_keepr_link(uuid) from anon, authenticated;
revoke execute on function public.promote_system_to_system_template(uuid, jsonb) from anon;

grant execute on function public.ensure_asset_keepr_link(uuid) to service_role;
grant execute on function public.promote_system_to_system_template(uuid, jsonb) to authenticated, service_role;

\echo '== removing direct client access from trigger-only functions =='
revoke execute on function public.sync_asset_keepr_link() from anon, authenticated;
revoke execute on function public.apply_system_template_reference_from_metadata() from anon, authenticated;

grant execute on function public.sync_asset_keepr_link() to service_role;
grant execute on function public.apply_system_template_reference_from_metadata() to service_role;

\echo '== preserving intentionally public KeeprLINK entrypoints =='
grant execute on function public.keeprlink_slugify(text) to anon, authenticated, service_role;
grant execute on function public.keeprlink_normalize_address(text) to anon, authenticated, service_role;
grant execute on function public.keeprlink_compact_address(text) to anon, authenticated, service_role;
grant execute on function public.keeprlink_purpose(text) to anon, authenticated, service_role;
grant execute on function public.keeprlink_public_purpose(text) to anon, authenticated, service_role;
grant execute on function public.keeprlink_context_instructions(text, boolean) to anon, authenticated, service_role;
grant execute on function public.resolve_keeprlink_context(text, text, uuid, boolean) to anon, authenticated, service_role;
grant execute on function public.system_template_canonical_key(text, text) to anon, authenticated, service_role;

select pg_notify('pgrst', 'reload schema');

commit;
