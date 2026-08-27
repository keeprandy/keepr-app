BEGIN;

DO $$
DECLARE
  v_asset uuid := 'a5b0d793-0aa2-4c3b-842e-5d2375aba8ed';
  v_projection text := 'kf018_canonical_system_projection_v1';
BEGIN
  UPDATE public.systems s
  SET
    system_group_id = g.id,
    metadata = coalesce(s.metadata, '{}'::jsonb) || jsonb_build_object(
      'projection_role', 'system_group_rollup',
      'system_group_rollup', true,
      'system_group_id', g.id::text,
      'projection_version', v_projection
    ),
    updated_at = now()
  FROM public.system_groups g
  WHERE s.asset_id = v_asset
    AND g.asset_id = v_asset
    AND s.source_type = 'tiara_factory_build'
    AND s.metadata->>'projection_role' IS DISTINCT FROM 'canonical_system'
    AND lower(btrim(g.name)) = lower(btrim(coalesce(s.metadata->>'system_category', s.system_type, s.name)));
END $$;

COMMIT;
