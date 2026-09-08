# Keepr Combined Production Convergence Package - 2026-09-08

Review artifact only. Do not run against production until Andy explicitly approves.

## Flattened Execution Package

This directory is self-contained for production execution review. All migration
SQL previously referenced by external `\ir` commands has been inlined into
package-owned executable files. A rescan found no remaining `\ir`, `\include`,
or `\i` commands in this directory.

Executable SQL order:

1. `00_preflight_readonly.sql`
2. `01_schema_reconciliation.sql`
3. `02_functions_reconciliation.sql`
4. `03_compatibility_backfills.sql`
5. `04_curated_reference_data.sql`
6. `06_supplier_asset_enablement_delta.sql`
7. `05_post_apply_smoke_readonly.sql`

Checksums for the final executable SQL files are recorded in
`CHECKSUMS.sha256`.

## 2026-09-08 Forward-Fix Resume Point

Current production state after the stopped apply:

- `01_schema_reconciliation.sql`: applied successfully.
- `02_functions_reconciliation.sql`: applied successfully.
- `03_compatibility_backfills.sql`: applied successfully.
- `04_curated_reference_data.sql`: failed before commit and rolled back completely.
- `06_supplier_asset_enablement_delta.sql`: not executed.
- Application code: not deployed.
- Protected owner counts remained preserved at `175` assets, `566` systems,
  `1016` attachments, and `1237` attachment placements.

Do not replay files `01`, `02`, or `03` during the forward-fix resume unless a
new preflight proves production has been manually changed and Andy explicitly
approves a broader recovery. Resume from the corrected `04`, then run `06`,
then validate with read-only `05`.

The corrected `04_curated_reference_data.sql` keeps the same curated reference
scope and fixes only:

- `asset_model_templates` upsert target now matches the actual production
  expression unique index on `lower(template_key), version`.
- Org-level resource promotion is idempotent without depending on a missing
  logical unique constraint on `asset_resources`.
- Tiara's website resource uses the existing allowed `asset_resources`
  `resource_type = 'other'` instead of invalid `oem_website`.
- `keepr_prod_audit_ro` receives only read-only SELECT visibility on the new
  release-created tables needed by `05_post_apply_smoke_readonly.sql`.

## Production Owner/Admin Apply Procedure

The temporary production apply connection must be separate from
`keepr_prod_audit_ro`. Do not use the audit role for write files.

Use the official production owner/admin database connection from Supabase
Connect for project `jjzjuqxysucqutgjnrkk`. Store it only in:

`/Users/andydrake/keepr/.local-env/production-apply.env`

with this variable name:

`SUPABASE_PROD_APPLY_DB_URL`

Do not store this connection in `.env`, `.env.local`,
`.local-env/production.env`, Vercel environment variables, source control,
logs, screenshots, or chat output.

After connecting with `SUPABASE_PROD_APPLY_DB_URL`, confirm the production
target and session identity before any write file:

```sql
select current_database(), current_user, session_user;
```

`SET ROLE postgres` is not necessary when the official owner/admin connection
reports `current_user = 'postgres'` and `session_user = 'postgres'`; in that
case, new production objects created by package DDL are owned by `postgres`.
Existing objects keep their current ownership unless a package statement
explicitly changes ownership; this package contains no ownership-changing
statements.

If either `current_user` or `session_user` is not `postgres`, stop before
executing files `01` through `06`. Do not try to compensate with `SET ROLE`
until the ownership behavior is explicitly reviewed.

After executing files `01` through `06`, disconnect the owner/admin apply
session. Run `05_post_apply_smoke_readonly.sql` only through
`keepr_prod_audit_ro`. The smoke includes an ownership check that must return
zero rows for release-created objects whose owner is not `postgres`.

After successful independent audit, delete the local
`/Users/andydrake/keepr/.local-env/production-apply.env` file.

## RC Line

- Base frozen RC: `c6bcf3be823c8cfeaa90c60ed9511897d93f11bd`
- Combined RC branch: `codex/production-rc-supplier-asset-enablement-20260908`
- Combined RC head before final preview smoke: see final release report.
- Added today, and only today: Supplier V1 organization graph, System Library supplier/resource/application controls, asset KAC identity sync, Asset Enablement V1, linked System Template promotion fix.
- Release-blocker fix included on this RC line: legacy `/api/k/:kac/source` public manifest strips signed/private Supabase storage URLs and reports `source_urls_include_private` truthfully.

## Actual Production Baseline Found

- Supabase project: `jjzjuqxysucqutgjnrkk`
- Access mode used for audit: read-only production audit connection
- Production migration ledger entries at or after `20260904100000`: `0`
- Existing protected production rows:
  - `assets`: `175`
  - `systems`: `566`
  - `attachments`: `1016`
  - `attachment_placements`: `1237`
  - `asset_model_templates`: `0`
  - `asset_model_template_items`: `0`
- Active production assets with `kac_id`: `104`
- Existing production orgs relevant to this package:
  - Tiara Yachts: present, slug `tiara-yachts`, currently generic organization shape
  - Wilson Marine: present, slug `wilsonmarine`, currently KeeprPro shape
  - Mercury Marine: present, slug `mercury-marine`, currently manufacturer shape
  - Bennington: absent by audited slug/name query
  - Seakeeper: absent by audited slug/name query
  - Cummins / Onan: absent by audited slug/name query
- Missing production platform objects:
  - `system_templates`
  - `keepr_links`
  - `organization_brand_relationships`
  - `exact_build_drafts`
  - `exact_build_draft_items`
- Existing production platform objects:
  - `asset_model_templates`
  - `asset_model_template_items`
  - `asset_resources`
  - `org_relationships`
  - `brands` absent

## Migration Disposition

Friday convergence package:

- `20260904100000_model_template_attachment_manager_updates`: APPLY through package.
- `20260904110500_keeprlink_context_resolver_v1`: APPLY through package.
- `20260904113500_tiara_keeprlink_taxonomy_v1`: APPLY through package data.
- `20260904122500_org_workspace_precedes_personal_on_entry`: APPLY through package.
- `20260904124500_keeprspace_organization_resolution_v1`: APPLY through package.
- `20260904131500_keeprlink_attachment_backed_model_resources`: APPLY through package.
- `20260904133500_org_attachment_placements`: APPLY through package.
- `20260904134500_org_resource_attachment_policies`: APPLY through package.
- `20260904135500_org_resource_attachment_lifecycle_policies`: APPLY through package.
- `20260904141000_keeprlink_authorized_editable_projection`: APPLY through package.
- `20260904141500_keeprlink_grounding_instructions`: APPLY through package.
- `20260904142000_asset_resource_descriptor_delete_policy`: APPLY through package.

Today combined-RC delta:

- `20260908100000_supplier_graph_projection_v1`: APPLY after Friday package. It depends on `org_relationships` and `system_templates`.
- `20260908113000_asset_kac_keeprlink_identity_normalization`: APPLY after `keepr_links` and normalization functions exist. It backfills/upserts canonical KeeprLINK rows for the 104 active production assets with `kac_id`.
- `20260908124500_promote_system_updates_linked_template`: APPLY after `system_templates` and `systems.system_template_id` exist. Function replacement only.

No migration is `ALREADY PRESENT` in production by ledger or object inspection for the new 20260904+ platform surface. Do not replay the local migration ledger mechanically; use this package order.

## Data Disposition

- Tiara canonical organization/profile: PROMOTE/RECONCILE existing production row by canonical slug/key.
- Tiara brand and relationships: PROMOTE.
- 12 Tiara model templates: PROMOTE as deterministic reference data.
- Approved Tiara model/org Resources: PROMOTE as resource descriptors/placements only where public-safe and approved.
- Approved Tiara System Templates: PROMOTE.
- Tiara KeeprLINK taxonomy: PROMOTE.
- Bennington canonical organization/profile: PROMOTE.
- Bennington brand: PROMOTE.
- 2 Bennington templates/resources: PROMOTE.
- Wilson Marine canonical organization: RECONCILE existing production row; do not duplicate.
- Approved Bennington to Wilson relationship: PROMOTE if both orgs resolve.
- Curated System Library: PROMOTE.
- Mercury Marine: RECONCILE existing production row; do not duplicate.
- Seakeeper and Cummins / Onan supplier orgs: PROMOTE if absent.
- KF018: HOLD. Do not promote exact KF018 asset/build data unless separately approved.
- Exact build drafts/demo KACs/test fixtures: HOLD/DROP. Do not copy staging tables wholesale.

## Package Files

1. `00_preflight_readonly.sql`
   Read-only baseline check before any production change.

2. `01_schema_reconciliation.sql`
   Creates missing platform schema, columns, indexes, policies, and grants required by the Friday RC.

3. `02_functions_reconciliation.sql`
   Installs/replaces Friday RC function contracts and shared KeeprLINK resolver plumbing.

4. `03_compatibility_backfills.sql`
   Idempotent compatibility updates for existing production rows. Preserves owner data.

5. `04_curated_reference_data.sql`
   Deterministic launch reference data. No staging-table clone.

6. `05_post_apply_smoke_readonly.sql`
   Read-only smoke checks after approved package application.

7. `06_supplier_asset_enablement_delta.sql`
   Applies only today’s approved Supplier/Asset Enablement DB deltas after the Friday package.

## Intended Production Order After Approval

1. Run `00_preflight_readonly.sql` through `keepr_prod_audit_ro`.
2. Confirm protected counts still match or explain deltas.
3. Verify `CHECKSUMS.sha256`.
4. Connect with `SUPABASE_PROD_APPLY_DB_URL` from the temporary local
   `production-apply.env`.
5. Confirm production identity and that `current_user` and `session_user` are
   both `postgres`; stop if not.
6. Current forward-fix resume only: apply corrected
   `04_curated_reference_data.sql`.
7. Apply `06_supplier_asset_enablement_delta.sql`.
8. Disconnect the owner/admin apply session.
9. Reconnect with `keepr_prod_audit_ro`.
10. Run `05_post_apply_smoke_readonly.sql`.
11. Confirm release-created object ownership check returns zero rows.
12. Delete `.local-env/production-apply.env` after successful audit.
13. Deploy the combined RC application code only after DB GO and explicit
    approval.
14. Run browser/API smoke.

## Expected Production Row Changes

Schema/function files:

- Add missing tables/columns/indexes/functions/policies.
- No deletes, truncates, or broad owner row rewrites.

Compatibility backfills:

- Normalize Tiara/Wilson org shape where needed.
- Production currently has `0` model templates/items, so model-item-to-system-template backfill initially affects `0` systems.

Curated reference data:

- Adds/upserts Tiara, Bennington, Wilson relationship, brands, model templates, System Library rows, approved resources, and KeeprLINKs by stable canonical keys.
- Does not promote KF018 unless separately approved.

Today delta:

- Upserts canonical KeeprLINK rows for `104` active production assets with `kac_id`.
- Adds/reconciles Supplier V1 graph rows for Mercury, Seakeeper, Cummins / Onan, Tiara, and Bennington where applicable.
- Installs linked-template promotion behavior so exact systems update their existing `system_template_id` target.

## Owner Data Preservation

The package is expected to preserve:

- all `175` production assets
- all `566` production systems
- all `1016` production attachments
- all `1237` production attachment placements

The package adds columns, tables, policies, functions, links, and curated reference rows. It does not delete owner assets, owner systems, owner attachments, Story/history, Keepr Pros, or existing relationships. The asset KAC normalization creates/upserts `keepr_links` for assets that already have `kac_id`; it does not create or change the asset KAC itself.

## Rollback / Forward Fix

Preferred response is forward fix:

- Roll back Vercel deployment if application behavior fails.
- Retire incorrect `keepr_links` rows with `status = 'retired'`.
- Retire incorrect `system_templates` rows with `authority_state = 'retired'`.
- Supersede incorrect relationships rather than deleting canonical graph history.
- Do not drop newly added production columns/tables under incident pressure.

## Current GO / NO-GO

Current status before staging preview smoke: NO-GO.

Reasons:

- Updated combined package requires review.
- Final combined RC preview and locked smoke are not complete yet.
- Production SQL has not been approved and must not be run yet.
