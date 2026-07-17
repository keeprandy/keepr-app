# Projections Handoff Integration Plan

Date: 2026-07-17

Branch: `integration/projections-handoff`

Base commit: `74ca154fb010bba41b1687a7f858914d19a918ee`

## Purpose

Define the first canonical integration lanes for Projections, dealer inventory, buyer handoff, and ecosystem workflows without merging local dirty work or the Keepr Intelligence branch wholesale.

## Lane A — Production Canonical

Preserve unchanged unless explicitly required:

- `screens/PublicKeeprStoryScreen.js`
- `screens/PublicActionScreen.js`
- `supabase/functions/public-story-media/index.ts`
- `api/public-media/[mediaId].js`
- `api/og/k/[kac].js`
- public contract and regression tests:
  - `tests/public-actions-regression.test.mjs`
  - `tests/public-media-security.test.mjs`
  - `tests/public-story-media-contract.test.mjs`

Rules:

- Do not regress current public Story loading.
- Do not expose signed URLs, storage paths, bucket names, object keys, JWTs, service-role values, or raw diagnostics.
- Do not change the typed public media contract without explicit review.
- Preserve current Actions behavior.

## Lane B — Regal Ingestion Foundation

Inspect and manually port concepts from preserved recovery files:

- `/private/tmp/keepr-reconciliation-recovery-20260717/data/regal_3300_keepr_import.json`
- `/private/tmp/keepr-reconciliation-recovery-20260717/lib/enrichmentImporter.js`
- `/private/tmp/keepr-reconciliation-recovery-20260717/screens/RegalEnrichmentRunnerScreen.js`
- `/private/tmp/keepr-reconciliation-recovery-20260717/docs/demo-output/**`

Separate:

- reusable import schema
- listing source attribution
- asset normalization logic
- system/component normalization logic
- media manifest logic
- attachment and Showcase planning
- timeline/event creation
- owner-specific demo data
- unsafe direct writes
- internal runner UI

Do not copy blindly:

- hard-coded asset IDs
- hard-coded KAC values
- owner-specific assumptions
- direct write paths
- local file-picker UI

## Lane C — Projections / Handoff

New work to design and implement after the baseline gate:

- Projection request/response contract
- asset-dependent templates
- Boat For Sale Projection
- dynamic QR resolution
- dealer-owned inventory lifecycle
- pending buyer handoff
- buyer acceptance
- ownership transfer
- dealer retained as KeeprPro
- Boat to Trailer relationship
- marina/storage context

Initial constraints:

- no schema changes without separate review
- no production data writes without explicit approval
- no automatic transfer execution
- no Actions/reminders activation
- no public exposure until Preview validated

## Lane D — Intelligence Foundation

Leave Build 3A / 3B isolated.

Possible future manual-port candidates:

- KAC-prefill helper contracts
- deterministic asset context types
- source-aware fact structures
- transfer classification types
- Builder Intelligence-adjacent facts

Do not port in first integration step:

- model orchestration
- owner-facing KAI Intelligence Update UI
- KAC intelligence endpoint exposure
- recommendation generation
- action execution

## Baseline Gate

Current baseline results from `/private/tmp/keepr-projections-handoff`:

- `node --test tests/public-actions-regression.test.mjs`: 13 passing, 0 failing
- `node --test tests/public-media-security.test.mjs`: 11 passing, 0 failing
- `node --test tests/public-story-media-contract.test.mjs`: 7 passing, 0 failing
- `node --test tests/*.test.mjs`: 31 passing, 0 failing
- `npm run build:web`: failed with `CommandError: No platforms are configured to use the Metro bundler in the project Expo config.`

No projection implementation should begin until the build command issue is resolved or an approved production-equivalent build path is confirmed.

## First Proposed Implementation Step

After build-path approval:

1. Add a read-only projection contract.
2. Add deterministic fixtures based on sanitized Regal / BoatTrader structure.
3. Add tests for projection classification and no-write behavior.
4. Only then introduce an admin-only or internal ingestion planning surface.
