CREATE OR REPLACE FUNCTION public.keepr_resolve_kac_for_manifest_admin(p_kac text)
RETURNS TABLE (
  id uuid,
  kac_id text,
  master_asset_id uuid,
  status text,
  asset_mode text
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, pg_catalog
SET row_security = off
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_kac text := upper(regexp_replace(trim(coalesce(p_kac, '')), '\s+', '', 'g'));
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT p.role
    INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role NOT IN ('admin', 'superkeepr') THEN
    RETURN;
  END IF;

  IF v_kac !~ '^KPR-[A-Z0-9]+(-[A-Z0-9]+)*$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.kac_id,
    a.master_asset_id,
    a.status,
    a.asset_mode
  FROM public.assets a
  WHERE a.kac_id = v_kac
    AND a.deleted_at IS NULL
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.keepr_resolve_kac_for_manifest_admin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.keepr_resolve_kac_for_manifest_admin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.keepr_resolve_kac_for_manifest_admin(text) TO authenticated;
