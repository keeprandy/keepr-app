# KeeprPro V1 Execution Ledger

## Gate 2

Status: ready for manual acceptance

Baseline SHA:

- `2c44572fa5884f83cc31e0d0cb7564f1be09a308`

Branch:

- `feature/keeprpro-v1-engagement-loop`

Worktree:

- `/private/tmp/keepr-keeprpro-v1`

## Connector Fields Preserved

- `asset_id`
- `asset_name`
- `system_id`
- `system_name`
- `keepr_pro_id`
- `keepr_pro_label`
- `assignment_scope`
- `source_screen`
- `extra_metadata.provider_target`
- `extra_metadata.keeprpro_connector`

## Implementation Notes

- Private system KeeprPro Request Service opens `PublicActionScreen` in internal mode.
- The private request path does not create another public link.
- Private request submission navigates to canonical `CreateReminderScreen`.
- The Action prefill stores provider attribution in `extra_metadata.provider_target`.
- Action context now renders system-first when `system_id` exists, so Whole
  House Generator is the visible subject and Brighton Home is the parent asset.
- Private request back navigation returns to the exact `HomeSystemStory` route.
- `View KeeprStory` on the generator opens the registered `SystemStoryPrint`
  destination instead of relying on the asset KeeprStory route.
- Existing completion flow creates or links `service_records`.
- Existing service record helper writes `service_records.keepr_pro_id` and `story_events.metadata.keepr_pro_id`.
- Existing duplicate guard searches for service records created from the completed reminder id.

## Reopened Gap Root Causes

- Asset-scoped Action behavior: the request bridge carried `systemId`, but the
  Action editor foregrounded the asset label first and the private request copy
  described "this asset", making the Action appear asset-scoped.
- Failed system KeeprStory destination: system screens had Service Ready and
  print infrastructure, but no working system-level "View KeeprStory" control;
  the existing asset KeeprStory pattern was not a valid system destination.

## Validation

To run:

- `node --test tests/keeprpro-v1-private-loop.test.mjs`
- `node --test tests/coordination-team-visibility.test.mjs tests/team-shared-assets.test.mjs`
- `node --test tests/service-ready-projection.test.mjs tests/service-ready-token-recovery.test.mjs`
- `node --test tests/reminder-notification-lifecycle.test.mjs`
- `node --test tests/public-actions-regression.test.mjs tests/public-media-security.test.mjs tests/public-story-media-contract.test.mjs`
- `npm run build:web`
- `git diff --check`

## Manual Acceptance Evidence

Pending local UI pass:

1. Open Brighton Home -> Whole House Generator.
2. Confirm GenPro card is visible and system-scoped.
3. Launch Request Service.
4. Confirm private request context shows Brighton Home and Whole House Generator.
5. Use View KeeprStory and confirm `/SystemStoryPrint?systemId=<generator-id>`
   opens the generator story with Brighton Home as parent context.
6. Create Action.
7. Confirm Action in Inbox with provider and system context.
8. Open the Action through the supported Inbox/deep-link path.
9. Complete with service notes/proof.
10. Confirm generator service history includes GenPro attribution.
11. Retry completion/enrichment and confirm no duplicate service record.

## Gate 3 Handoff

Public unauthenticated Service Ready Request Service still needs Edge Function
verification. The local `public-action` source is token-aware, but it requires a
signed-in user for `capture_event_inbox`, so Gate 3 must verify production
behavior or adjust owner-routed public submission safely.
