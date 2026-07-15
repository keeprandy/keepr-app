# Build 3B Preview Deployment Result

Date: 2026-07-15T19:47:45Z

## Source

- Branch: `release/build-3b-preview`
- Implementation commit: `9789be80da541b10fe6c3b17d5905a0f5314d6f3`
- Previous rollback point: `dd0be0e` (`release/build-3a-preview` result-report head before Build 3B)
- Vercel team: `see-you-then`
- Vercel project: `keepr-app`
- Deployment target: Preview only

## Exact Files Changed

- `App.js`
- `lib/kaiIntelligenceUpdate.js`
- `components/kai/KeeprIntelligenceUpdatePanel.js`
- `screens/KeeprIntelligenceUpdateScreen.js`
- `screens/BoatStoryScreen.js`
- `screens/VehicleStoryScreen.js`
- `screens/HomeStoryScreen.js`
- `screens/OtherAssetStoryScreen.js`
- `tests/kai-intelligence-update-ui.test.mjs`

## Test Totals

Focused Build 3B command:

```bash
node --test tests/kai-intelligence-update-ui.test.mjs
```

Result:

- Tests: 22
- Passing: 22
- Failing: 0
- Cancelled: 0
- Skipped: 0
- Todo: 0

Full wildcard suite command:

```bash
node --test tests/*.test.mjs
```

Result:

- Tests: 239
- Passing: 239
- Failing: 0
- Cancelled: 0
- Skipped: 0
- Todo: 0

## Web Build

Command:

```bash
npm run build:web
```

Result:

- Web export succeeded.
- Bundle completed with 1946 modules.
- Output exported to `dist`.

## Vercel Preview Deployment

- Deployment ID: `dpl_E3G9DRYxbEANkUPihAU9tNfNZjPH`
- Preview URL: `https://keepr-7zj7trk5f-see-you-then.vercel.app`
- Inspector URL: `https://vercel.com/see-you-then/keepr-app/dpl_E3G9DRYxbEANkUPihAU9tNfNZjPH`
- Branch alias: `https://keepr-app-git-release-build-3b-preview-see-you-then.vercel.app`
- Earlier manual Preview for the implementation commit: `dpl_GzdEQzWKQ4ULD5atqFdq63bBfsdx`
- Deployment state: `READY`
- Target: `preview`
- Production deployment: No

Build-log review:

- Vercel build succeeded.
- Build output compiled the web app and existing API functions.
- Warning observed: Node.js functions compiled from ESM to CommonJS. This is pre-existing deployment behavior for the current API files and did not block the Preview build.

## Smoke Checks

Deployment inspection:

- `vercel inspect` returned status `Ready`.
- Builds listed:
  - `api/og/k/[kac]`
  - `api/public-media/[mediaId]`

Public unauthenticated curl:

- Direct public curl to the Preview URL redirects to Vercel login because Preview deployment protection is enabled.
- This is expected for the current hosted Preview access posture.

Authenticated Vercel CLI route checks against final Preview:

- `/` returned `200 text/html`.
- `/k/KPR-6QEH-927H` returned `200 text/html`.
- `/k/KPR-6GV2-MJ6W` returned `200 text/html`.
- Returned HTML contained the Expo root/app shell.
- Formula route contained public story metadata for `KeeprAfloat!`.
- Porsche route returned public story HTML shell/metadata.

Static code-path checks:

- `KeeprIntelligenceUpdate` route is present in the generated bundle.
- `Intelligence` quick-action code is present in the generated bundle.
- Local persistent tests confirm the quick action is present in Boat, Vehicle, Home, and Other Asset story code paths.
- Local persistent tests confirm the old `KeeprIntelligence` builder route remains present and untouched.

## Security And Scope Confirmation

- No Vercel Production deployment occurred.
- No Supabase function deployment occurred.
- No schema, migration, RLS, grant, storage, or production-data change occurred.
- No Actions, reminders, plan activation, model provider, or write-back path was added.
- The owner-facing view model suppresses bucket names, storage paths, object keys, signed URLs, storage URLs, row IDs, internal table names, raw diagnostics, SQL, stack traces, contact fields, tokens, secrets, and unrestricted provenance.
- Generated bundle contains the literal string `service_role` only as a denylist/sanitization marker, not as a service-role secret value.
- Existing app code contains auth/session handling strings for sign-in and password reset flows; no secret values were printed or committed.

## Remaining Real-Owner Validation

Run hosted browser validation with existing owner sessions only:

Formula:

- Account: `demo@keeprhome.com`
- KAC: `KPR-6QEH-927H`
- Expected: owner can open the asset story, see `Intelligence`, open `Keepr Intelligence Update`, and receive an owner-safe update with configured/provisional Formula context.

Porsche:

- Account: `adrake@keeprhome.com`
- KAC: `KPR-6GV2-MJ6W`
- Expected: owner can open the asset story, see `Intelligence`, open `Keepr Intelligence Update`, and receive an owner-safe update with grounded documented context and no invented work.

Unauthenticated/non-owner behavior:

- Do not fabricate browser sessions.
- Existing endpoint concealment remains covered by Build 3A hosted validation and Build 3B local view-model tests.

## Recommendation

GO for hosted owner review in Vercel Preview.

NO-GO for production promotion until Andy/KAI complete real-owner browser validation for Formula and Porsche.

NO-GO for Build 3L, capability-chip navigation, Actions, reminders, plan activation, or broader UI redesign until this hosted owner review is accepted.
