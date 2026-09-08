-- Production convergence delta for the 2026-09-08 combined RC.
-- DO NOT RUN until explicitly approved.
--
-- Baseline: actual production jjzjuqxysucqutgjnrkk inspected read-only on
-- 2026-09-08. Production has no 20260904+ migration ledger entries, no
-- system_templates table, and no keepr_links table yet. Therefore this file
-- must run only after 01_schema_reconciliation.sql, 02_functions_reconciliation.sql,
-- 03_compatibility_backfills.sql, and 04_curated_reference_data.sql.
--
-- This file intentionally applies only today's approved staging migrations:
-- - Supplier V1 Organization + Relationship + System Template projection.
-- - Generic asset KAC -> KeeprLINK identity sync.
-- - Exact-system promotion fix that updates an existing linked System Template.
--
-- Expected production row effects before execution:
-- - 104 active assets with kac_id will receive/upsert canonical keepr_links.
-- - Existing Tiara, Wilson, and Mercury org rows are reconciled by slug/key.
-- - Supplier orgs for Seakeeper and Cummins / Onan may be created if absent.
-- - Supplier relationships may be inserted/upserted for Tiara and Bennington.
-- - No owner assets, systems, attachments, or placements are deleted.

\echo '== before 2026-09-08 delta: protected production counts =='
select 'assets' as table_name, count(*) as rows from public.assets
union all select 'systems', count(*) from public.systems
union all select 'attachments', count(*) from public.attachments
union all select 'attachment_placements', count(*) from public.attachment_placements
order by table_name;

\echo '== before 2026-09-08 delta: active assets with kac_id =='
select count(*) as active_assets_with_kac
from public.assets
where deleted_at is null
  and nullif(btrim(coalesce(kac_id, '')), '') is not null;

\echo '== applying Supplier V1 graph projection =='
\ir ../../migrations/20260908100000_supplier_graph_projection_v1.sql

\echo '== applying asset KAC KeeprLINK identity normalization =='
\ir ../../migrations/20260908113000_asset_kac_keeprlink_identity_normalization.sql

\echo '== applying linked System Template promotion correction =='
\ir ../../migrations/20260908124500_promote_system_updates_linked_template.sql

\echo '== after 2026-09-08 delta: protected production counts =='
select 'assets' as table_name, count(*) as rows from public.assets
union all select 'systems', count(*) from public.systems
union all select 'attachments', count(*) from public.attachments
union all select 'attachment_placements', count(*) from public.attachment_placements
order by table_name;

\echo '== after 2026-09-08 delta: launch graph counts =='
select 'system_templates' as table_name, count(*) as rows from public.system_templates
union all select 'keepr_links', count(*) from public.keepr_links
union all select 'org_relationships', count(*) from public.org_relationships
union all select 'asset_model_templates', count(*) from public.asset_model_templates
union all select 'asset_model_template_items', count(*) from public.asset_model_template_items
order by table_name;

\echo '== after 2026-09-08 delta: supplier reconciliation shape =='
select
  lower(coalesce(slug, '')) as slug,
  coalesce(display_name, name) as name,
  organization_type,
  org_type,
  status
from public.orgs
where lower(coalesce(slug, '')) in (
  'tiara-yachts',
  'bennington',
  'wilsonmarine',
  'wilson-marine',
  'mercury-marine',
  'seakeeper',
  'cummins-onan'
)
order by slug, name;
