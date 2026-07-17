# Event Projection Build Result

Date: 2026-07-17

Implementation commit: `958d833`

## Files Changed

- `lib/projectionRegistry.js`
- `screens/PublicConfigScreen.js`
- `screens/PublicKeeprStoryScreen.js`
- `screens/PublicActionScreen.js`
- `supabase/functions/public-action/index.ts`
- `tests/event-projection.test.mjs`

## Persisted Configuration Shape

Public configuration now supports a backward-compatible `projection` object:

```json
{
  "projection": {
    "purpose": "share | event | custom",
    "cardOrder": ["event_showcase", "vehicle_highlights", "message_owner"],
    "event": {
      "eventName": "",
      "eventDate": "",
      "eventLocation": "",
      "hubName": "",
      "hubId": null,
      "classOrCategory": "",
      "displayHeadline": "",
      "description": "",
      "featuredImage": "",
      "showOwnerName": false,
      "includeEventShowcase": true,
      "includeStoryHighlights": true,
      "includeVehicleHighlights": true,
      "includeProofOfCare": true,
      "allowAskOwner": true,
      "activeFrom": "",
      "activeUntil": "",
      "selectedStoryHighlights": "",
      "selectedVehicleHighlights": "",
      "selectedSystemHighlights": "",
      "selectedProofOfCare": ""
    }
  }
}
```

Existing stored `actions.mode` values remain supported through legacy mapping. Event purpose forces public financial display off and limits operational actions to Ask Owner / Request Info.

## Registry Design

Operational and exposed:

- `share`
- `event`
- `custom`

Modeled but hidden:

- `for_sale`
- `if_found`

Hidden unless later made operational:

- `for_rent`

Each template defines supported asset types, editable fields, card definitions, default card order, supported actions, CTA labels, privacy/content defaults, and capability maturity.

## Cards Implemented

Event Projection adds reusable Public Story card slots below the hero without replacing the existing Story canvas:

- Event Showcase Card
- Vehicle Highlights Card
- Message Owner Card

Empty-card suppression is explicit. Public Story still preserves hero, identity, Timeline, Showcase, Actions, Hubs, secure media, and QR behavior.

## Messaging Integration

The Message Owner card and Event CTA reuse the existing `PublicActionScreen` and secure public thread flow. Route and payload context now carry:

- `projectionType`
- `hubId`
- `hubName`
- `eventName`
- `eventDate`

The `public-action` Edge Function stores safe projection/Hub context on canonical Ask Owner threads and notification payloads. No second messaging form or thread model was added.

## Backward Compatibility

- Legacy `inquiry`, `current_story`, and `system_story` modes map to `share`.
- Existing Public Story tabs and public media behavior remain intact.
- `custom` remains operational for supported card/action configurations.
- `for_rent` remains hidden in the visible configuration controls.

## Tests

Commands run:

```bash
npm ci
node --test tests/event-projection.test.mjs
node --test tests/*.test.mjs
npm run build:web
```

Results:

- Event Projection focused tests: 10 passing, 0 failing
- Full persistent suite: 55 passing, 0 failing
- Web build: succeeded, exported to `dist`

Existing warnings:

- Package deprecation warnings during `npm ci`
- Expo baseline-browser-mapping age warning during web build

## Security Behavior

- No schema, RLS, grant, storage, or production-data changes.
- No Supabase migration or Edge Function deployment was performed.
- No Production or Vercel deployment was performed.
- No signed URL, storage path, bucket, object key, token, or service-role behavior was introduced.
- Event financial controls are hidden and saved as disabled.
- Thread access remains server-enforced; route context alone grants no access.

## Known Limitations

- Event fields are owner-entered configuration, not inferred event intelligence.
- Featured image accepts an existing opaque public media id or existing safe proxy URL; no uploader was added.
- Active-from / active-until are persisted configuration fields, but automatic reversion is not implemented in this build.
- Synthetic fixture validation is source-contract based. Real Porsche configuration is intentionally deferred until after review.

## Migration / Function Dependencies From Previous Commits

This build depends on the already-prepared public sender continuity foundation:

- `public_asset_thread_tokens` migration
- `public-action`
- `public-thread`
- `asset-thread-notify`

Those dependencies were not deployed or modified in this build beyond the local `public-action` context propagation required for Event messages.

## Deployment Order

After approval:

1. Deploy required Supabase migration(s) from the previous public sender continuity commit, if not already deployed.
2. Deploy `public-action`, `public-thread`, and `asset-thread-notify`.
3. Deploy Vercel Preview from `integration/projections-handoff`.
4. Validate synthetic Event Projection configuration and Ask Owner continuity.
5. Only after synthetic validation, configure a real Porsche Event Projection.

## Rollback Plan

- Revert implementation commit `958d833` to remove Event Projection UI/registry/context changes.
- Redeploy the prior Vercel deployment if a frontend regression appears.
- If Edge Functions were deployed after approval, redeploy the previously verified function versions.
- No data rollback is required for this local build because no production data/schema/storage changes were made.

## GO / NO-GO

Local implementation gate: GO.

Deployment gate: HOLD pending Andy/KAI review and explicit approval for Supabase and Vercel Preview deployment.
