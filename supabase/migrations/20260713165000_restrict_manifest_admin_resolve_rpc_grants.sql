REVOKE ALL ON FUNCTION public.keepr_resolve_kac_for_manifest_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.keepr_resolve_kac_for_manifest_admin(text) FROM anon;
REVOKE ALL ON FUNCTION public.keepr_resolve_kac_for_manifest_admin(text) FROM service_role;
GRANT EXECUTE ON FUNCTION public.keepr_resolve_kac_for_manifest_admin(text) TO authenticated;
