# Keepr Fork Reconciliation

Date: 2026-07-17

## 1. Executive Summary

The current Production runtime is not `main` and is not the primary local checkout. Production is deployed from the public actions/performance hotfix line at commit `74ca154fb010bba41b1687a7f858914d19a918ee`.

The safest integration path is to begin from the exact Production commit, preserve the public Story, Actions, secure media, Hub, and OG behavior as canonical, then manually port selected Regal / BoatTrader and future projection concepts. The Keepr Intelligence branch should not be merged wholesale.

## 2. Production Baseline

- Production commit: `74ca154fb010bba41b1687a7f858914d19a918ee`
- Production deployment: `dpl_32GdhaQ2s3zfecW7VA4RkRJVxRQq`
- Production URL: `https://app.keeprhome.com`
- Vercel project: `keepr-app`
- Vercel project ID: `prj_SEh4lqulA6e3DuEjJLRERR1fCutV`
- Vercel team: `see-you-then`
- Production source ref: `hotfix/public-actions-performance`
- Production commit message: `fix(public): unblock hero and optimize media catalog`

## 3. Main Divergence

- Local `main`: `f3bd5cfe0ee0adb525dc561f9966a4216bb755c1`
- Remote `origin/main`: `f3bd5cfe0ee0adb525dc561f9966a4216bb755c1`
- Production commit: `74ca154fb010bba41b1687a7f858914d19a918ee`

Conclusion: `main` is not the deployed Production source of truth.

## 4. Local Branch and Dirty-State Inventory

Primary checkout:

- Path: `/Users/andydrake/keepr`
- Branch: `feature/hub-internal-navigation`
- HEAD: `9450f5e650e557900f27fab933f14dccdf0a7e93`
- State: ahead of `origin/feature/hub-internal-navigation` by 18 commits

Dirty tracked files:

- `App.js`
- `app.json`
- `ios/Keepr/Info.plist`
- `ios/Keepr/Supporting/Expo.plist`
- `ios/ShareExtension/ShareExtension-Info.plist`
- `package.json`
- `screens/PublicConfigScreen.js`

Untracked files:

- `data/regal_3300_keepr_import.json`
- `docs/build-results/Build_2A_KAC_Context_Envelope_Result.md`
- `docs/build-results/Build_2D_KAI_Experience_Preview_Result.md`
- `docs/build-results/Build_2F_Node_Relationship_Knowledge_Compatibility_Review.md`
- `docs/build-results/Build_2F_Service_Authorization_Work_Order_Evaluation_Result.md`
- `docs/demo-output/Porsche_KAI_Intelligence_Preview.html`
- `docs/demo-output/Porsche_KAI_Intelligence_Preview.json`
- `docs/demo-output/Porsche_KAI_Intelligence_Preview.md`
- `docs/demo-output/Regal_KAI_Intelligence_Preview.html`
- `docs/demo-output/Regal_KAI_Intelligence_Preview.json`
- `docs/demo-output/Regal_KAI_Intelligence_Preview.md`
- `docs/product/Keepr_KAC_Association_Intelligence_Layer_PRD_v1.0.docx`
- `lib/enrichmentImporter.js`
- `screens/RegalEnrichmentRunnerScreen.js`
- `supabase/functions/_shared/kaiServiceAuthorization.ts`
- `supabase/functions/_shared/kaiServiceAuthorizationTypes.ts`
- `tests/kai-service-authorization.test.mjs`

Stashes: none.

## 5. Worktree Inventory

- `/Users/andydrake/keepr`: `feature/hub-internal-navigation` at `9450f5e650e557900f27fab933f14dccdf0a7e93`
- `/private/tmp/keepr-build-3a-preview-d0e56b5`: `release/build-3b-preview` at `a3efb63a4d258f848aa03d3c8009fa9c6c50ec80`
- `/private/tmp/keepr-build2x-preview-baseline`: `release/build-2x-preview-baseline` at `c9bf041e858ec81fc81d0c0a58cc42a47b4395fc`
- `/private/tmp/keepr-public-actions-hotfix`: `hotfix/public-actions-performance` at `74ca154fb010bba41b1687a7f858914d19a918ee`
- `/private/tmp/keepr-public-showcase-hotfix`: `hotfix/public-showcase-media-proxy` at `c450812a6052cd852c48fe8de04685d21cb228a6`
- `/private/tmp/keepr-projections-handoff`: `integration/projections-handoff`, created from `74ca154fb010bba41b1687a7f858914d19a918ee`

## 6. Regal / BoatTrader Foundation

Relevant preserved local files:

- `data/regal_3300_keepr_import.json`
- `lib/enrichmentImporter.js`
- `screens/RegalEnrichmentRunnerScreen.js`
- `docs/demo-output/**`

Findings:

- The Regal packet is structured listing/import data for a Regal 3300 from BoatTrader.
- The importer contains useful normalization, system creation, attachment/media, source-link, and event concepts.
- The importer is write-capable and includes hard-coded target KAC / asset ID values.
- The runner is an internal manual tool, not a production-safe user workflow.

Recommended treatment: manually port concepts, not files wholesale. Split reusable schema and normalization from owner/demo-specific write behavior.

## 7. Keepr Intelligence Branch

Intelligence branch:

- Branch: `release/build-3b-preview`
- HEAD: `a3efb63a4d258f848aa03d3c8009fa9c6c50ec80`

Capabilities present:

- KAC Manifest shared foundations
- Manifest collectors
- Context Envelope
- KAI Asset Brief
- bounded interpretation
- orchestration validation
- stewardship authority reconciliation
- authenticated KAC intelligence orchestration endpoint
- owner-facing Intelligence Update UI
- Build 3A / 3B reports and tests

Recommended treatment:

- Do not merge the branch.
- Later, manually port selected shared contracts/helpers if they support deterministic projection context.
- Keep model orchestration, endpoint exposure, and owner-facing KAI UI isolated until separately approved.

## 8. Three-Way Merge Bases

- Production vs local: `4239717d7cdf0445a63b429ab7a5bc4a19f5d140`
- Production vs Intelligence: `4239717d7cdf0445a63b429ab7a5bc4a19f5d140`
- Local vs Intelligence: `9450f5e650e557900f27fab933f14dccdf0a7e93`

## 9. High-Risk Overlaps

High-risk files that must preserve Production behavior:

- `screens/PublicKeeprStoryScreen.js`
- `screens/PublicActionScreen.js`
- `supabase/functions/public-story-media/index.ts`
- `api/public-media/[mediaId].js`
- `api/og/k/[kac].js`
- public media/action tests

High-risk future-intelligence overlaps:

- `App.js`
- `package.json`
- `supabase/config.toml`
- `supabase/functions/_shared/**`
- `supabase/functions/kac-intelligence-orchestration/index.ts`
- `screens/*StoryScreen.js`

## 10. Capability Map

| Capability | Current Source of Truth | Maturity | Required Today | Integration Method |
|---|---|---|---|---|
| Production public Story / Showcase / Actions / secure media | Production commit `74ca154` | production | yes | preserve as-is |
| Regal demo creation | local untracked importer + packet | experimental | yes, as foundation | manually port |
| external listing ingestion | local Regal / BoatTrader packet and importer | partial | yes, bounded | manually port |
| asset normalization | local importer concepts | partial | yes | manually port |
| generic asset template creation | not confirmed | unknown | not yet | design |
| dealer-owned inventory | not fully implemented | partial/unknown | yes | new work |
| pending handoff | not fully implemented | unknown | yes | new work |
| buyer acceptance | not fully implemented | unknown | yes | new work |
| ownership transfer | Intelligence has related concepts, not full workflow | foundation | later | manually port selected concepts |
| dealer retained as KeeprPro | not confirmed | unknown | later | design |
| asset relationships | not confirmed | unknown | later | design |
| Boat to Trailer relationship | not confirmed | unknown | later | design |
| Projection model | not implemented | absent | yes | new work |
| dynamic QR | not confirmed | unknown | yes | new work |
| Builder Intelligence | Intelligence branch foundation only | future | later | defer |
| KAC Intelligence | `release/build-3b-preview` | preview/foundation | not first step | defer selected helpers |
| Appsmith operational support | external operations environment | external | unknown | inspect separately |

## 11. Canonical Production Files

Treat these as canonical unless an explicit future change is approved:

- `screens/PublicKeeprStoryScreen.js`
- `screens/PublicActionScreen.js`
- `screens/KeeprHubScreen.js`
- `api/public-media/[mediaId].js`
- `api/og/k/[kac].js`
- `supabase/functions/public-story-media/index.ts`
- `tests/public-actions-regression.test.mjs`
- `tests/public-media-security.test.mjs`
- `tests/public-story-media-contract.test.mjs`

## 12. Manual-Port Candidates

- `data/regal_3300_keepr_import.json`
- `lib/enrichmentImporter.js`
- `screens/RegalEnrichmentRunnerScreen.js`
- `docs/demo-output/**`
- selected KAC/KAI shared type contracts from `release/build-3b-preview`
- selected deterministic context/provenance helpers from `release/build-3b-preview`

## 13. Deferred Intelligence Work

Keep isolated:

- Build 3A endpoint
- Build 3B owner-facing UI
- model/provider orchestration
- recommendations/actions execution
- KAI modal/report surfaces
- broad Story screen changes from the intelligence branch

## 14. Appsmith Note

Appsmith is an external operations environment. Absence from this Git repository does not imply absence of the Appsmith console or its operational workflows.

## 15. Recommended Integration Plan

Create and work from:

- Branch: `integration/projections-handoff`
- Worktree: `/private/tmp/keepr-projections-handoff`
- Base: `74ca154fb010bba41b1687a7f858914d19a918ee`

Integration principle:

Do not merge branches. Integrate approved capabilities into the Production baseline.

Initial lanes:

- Lane A: preserve Production public behavior.
- Lane B: manually port Regal / BoatTrader ingestion foundation.
- Lane C: build Projection / handoff contracts.
- Lane D: defer Intelligence, then selectively port only helper foundations when needed.

## 16. Recovery Snapshot Path

Recovery directory:

`/private/tmp/keepr-reconciliation-recovery-20260717`

Key files:

- `local-tracked-changes.patch`
- `local-staged-changes.patch`
- `git-status-short.txt`
- `git-status-branch.txt`
- `git-branch-vv.txt`
- `git-worktree-list.txt`
- `git-log-1.txt`
- `RECOVERY_INVENTORY.md`

## 17. Risks

- Merging Intelligence wholesale can regress Production public Story / media behavior.
- Local Regal importer contains valuable work but also unsafe direct write behavior and hard-coded live identifiers.
- Build 3A / 3B UI and endpoint code may overlap with Production Story screens.
- The clean Production baseline test suite passes, but `npm run build:web` currently fails in the isolated worktree with Expo's Metro platform configuration error.
- Appsmith and operational console behavior were not proven by Git inspection.

## 18. GO Decision

GO for creating `integration/projections-handoff` from Production commit `74ca154fb010bba41b1687a7f858914d19a918ee`.

NO-GO for beginning Boat Projection implementation until the clean Production baseline build command issue is resolved or the approved production-equivalent build command is confirmed for this baseline.
