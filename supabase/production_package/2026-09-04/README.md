# Keepr Production Convergence Package - 2026-09-04

This package is a review artifact only. Do not run it against production until Andy explicitly approves the manifest.

Production baseline inspected:

- Supabase project: `jjzjuqxysucqutgjnrkk`
- Audit role: `keepr_prod_audit_ro`
- Migration ledger count: `60`
- Latest production migration: `20260814124500_fix_playbook_activation_unscheduled_actions`
- Protected production rows observed: `175` assets, `566` systems, `1015` attachments, `1235` attachment placements

## Files

1. `00_preflight_readonly.sql`
   Read-only production state check. No writes.

2. `01_schema_reconciliation.sql`
   Creates release-critical missing schema only: brand graph, system templates, KeeprLINK table, exact-build draft table contract, missing foreign-key columns, org/model/system-template placement policy support, and public-safe resource descriptor columns.

3. `02_functions_reconciliation.sql`
   Installs/replaces release function contracts required by the application and KeeprLINK API. This changes functions only; no table rows.

4. `03_compatibility_backfills.sql`
   Additive/idempotent compatibility updates. It normalizes existing Tiara/Wilson org shape where safe and backfills `systems.system_template_id` only from already-present model-item metadata.

5. `04_curated_reference_data.sql`
   Promotes curated launch reference data by stable keys, not staging UUID cloning. Excludes KF018 and exact build drafts.

6. `05_post_apply_smoke_readonly.sql`
   Read-only aggregate smoke checks for after an approved rollout.

## Intended Order

1. Run `00_preflight_readonly.sql`.
2. Review output and confirm baseline still matches.
3. Apply `01_schema_reconciliation.sql`.
4. Apply `02_functions_reconciliation.sql`.
5. Apply `03_compatibility_backfills.sql`.
6. Apply `04_curated_reference_data.sql`.
7. Deploy the release application code.
8. Run `05_post_apply_smoke_readonly.sql`.
9. Run browser/API smoke tests.

## Expected Row Changes

Schema files:

- Preserve all existing owner rows.
- Add missing tables/columns/policies/functions only.
- Add empty exact-build draft table contract but no KF018/demo rows.
- No deletes, truncates, or broad rewrites.

Compatibility backfill:

- Tiara: at most one existing production org row normalized to OEM workspace shape.
- Wilson: at most one existing production org row receives missing dealer/workspace defaults.
- Systems: only rows with `metadata.exact_build_template_item_id` and a matching template item with `system_template_id` receive `systems.system_template_id`. Production currently has no template items, so expected initial affected rows are `0`.

Curated reference data:

- Tiara brand and brand relationship: upsert.
- Bennington org and brand: upsert/create.
- Tiara templates: 12 upserts.
- Bennington templates: 2 upserts.
- Curated System Library: 5 base system-template upserts in this package.
- Org-level launch resources: 2 additive resource descriptors.
- KeeprLINKs: organization links plus 14 model links.
- Bennington to Wilson relationship: one additive relationship if Wilson resolves.

## Explicit Holds

- KF018 exact build is not included.
- Exact build drafts are not included.
- Demo KACs/test fixtures are not included.
- Staging UUIDs are not treated as production identity except where production already has the same canonical org.

## Risks / Forward Fix

- The production migration ledger is historically divergent: production contains some Activator/KeeprSpace effects without ledger rows. Do not use chronological replay as the production plan.
- `org_members` and `story_events` were grant-limited during audit. Owner preservation for membership/story history still needs either read-only grants or explicit waiver before GO.
- `resolve_keeprlink_context` is folded into `02_functions_reconciliation.sql` through the existing canonical resolver migration include, then the later attachment-backed resource projection override is applied.
- Public/LLM context must be checked for signed storage URLs and private metadata leakage after code deployment.

## Rollback / Forward Fix

Preferred approach is forward fix:

- Disable new code paths through Vercel rollback if application behavior fails.
- Retire incorrect `keepr_links` rows by setting `status = 'retired'`.
- Supersede incorrect brand/org relationships by setting `status = 'superseded'`.
- Do not drop newly added columns/tables under incident pressure; leave unused schema in place and patch behavior.

## GO / NO-GO

Current status: NO-GO.

Reasons:

- Package requires review.
- Worktree is not release-clean.
- Release commit/tag has not been created.
- Owner membership/story-history audit is still grant-limited.
- Browser/API smoke tests have not run against a production-compatible database plus final code.
