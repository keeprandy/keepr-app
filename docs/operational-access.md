# Keepr Operational Access Procedures

Keepr Production Mode uses routine read-only inspection and explicit approval for every action that can change code, infrastructure, data, analytics configuration, or production state.

Core principle:

```text
Autonomous inspection
Explicitly approved action
```

These procedures document the standard read-only checks Codi can use today and the boundaries where Andy must grant narrower access.

## GitHub Lineage Check

Purpose: determine what code exists, what code was reviewed, and whether a commit has checks or deployment statuses.

Available read-only procedure:

1. Confirm local repository, branch, HEAD, upstream, ahead/behind, tags, and dirty worktree with `npm run codi:preflight`.
2. Use local git for branches, tags, remotes, and recent commits.
3. Use the GitHub connector read-only calls for:
   - Fetch commit metadata and diff.
   - Search branches and commits.
   - Fetch commit combined status.
   - Fetch files from GitHub when needed.
   - Fetch PR comments or review threads when the PR number is known.

Current limits:

- Pull request discovery is partial unless a PR number or known branch is supplied.
- Branch protection, releases, repository settings, and deployment lineage are not fully exposed by the current tool surface.
- The GitHub connector also exposes write-capable operations. Codi must not use them without Andy's explicit approval.

Standard result labels:

- `AVAILABLE`: local branches, commits, diffs, tags, commit status for known commits.
- `PARTIAL`: pull requests, reviews, checks, deployment lineage.
- `UNAVAILABLE`: branch protection and full release history through the current connector surface.

## Supabase Truth Check

Purpose: determine whether production database state is compatible with local code and release assumptions.

Known remote projects:

```text
staging    nvtotcdsvijssokijnbn
production jjzjuqxysucqutgjnrkk
```

Keepr separates application runtime targeting from Supabase CLI targeting:

- Browser/runtime credentials live in ignored local env files and are loaded by explicit npm commands.
- CLI migration commands must pass an explicit target database URL.
- The linked Supabase CLI project is never treated as proof of what the app or a migration command targets.
- Production is never the default write target.

Local browser runtime files:

```text
.local-env/staging.env
.local-env/production.env
```

Both files are ignored by Git through `.env*.local`. Use the committed examples as templates:

```text
.env.staging.example
.env.production.example
```

Required browser runtime values:

```text
EXPO_PUBLIC_SUPABASE_URL
EXPO_PUBLIC_SUPABASE_ANON_KEY
```

These must be browser-safe anon/publishable keys. Do not use `service_role` in the web client.

Standard runtime commands:

```bash
npm run web:staging
npm run web:production
npm run supabase:runtime:staging
npm run supabase:runtime:production
```

`web:staging` defaults to port `8096` and verifies the runtime points at `nvtotcdsvijssokijnbn` before Expo starts. `web:production` defaults to port `8097` and verifies the runtime points at `jjzjuqxysucqutgjnrkk`.

Migration credentials are separate:

```text
SUPABASE_DB_URL
```

Store database URLs only in ignored local env files. Do not put DB passwords, access tokens, or service-role keys in `package.json`, docs, source files, or committed examples.

Safe migration commands:

```bash
npm run db:status:staging
npm run db:dry-run:staging
npm run db:push:staging

npm run db:status:production
npm run db:dry-run:production
CONFIRM_PRODUCTION_DB_PUSH=jjzjuqxysucqutgjnrkk npm run db:push:production
```

Production push intentionally requires `CONFIRM_PRODUCTION_DB_PUSH=jjzjuqxysucqutgjnrkk` in the shell. This is still not approval by itself; it is only a local guardrail after Andy explicitly approves a production migration.

Available read-only procedure:

1. Inspect linked project metadata from `supabase/.temp/linked-project.json` without printing secrets.
2. Run `npm run db:status:staging` or `npm run db:status:production` to compare local and remote migration history against an explicit target.
3. Inspect repository migrations and Edge Function source as local intent, not production proof.

Current limits:

- `supabase functions list` requires a Supabase access token.
- Remote schema dumps, live schema, tables, indexes, constraints, RLS policies, grants, RPCs, storage buckets, auth configuration, function logs, and production query results require additional read-only Supabase access.
- Migration parity is not proof of live schema, RLS, grants, storage, auth, or Edge Function deployment state.

Minimum missing access:

- Read-only Supabase project inspection for metadata, Edge Functions, function logs, storage, and auth configuration.
- Read-only database inspection for schema, tables, indexes, constraints, policies, grants, RPCs, and database functions.

Safety boundary:

- No migrations.
- No SQL writes.
- No service-role credentials in prompts, scripts, logs, docs, or commits.
- No project-ref inference from shell history, pulled Vercel env files, or Supabase CLI link state.

## Vercel Environment Targeting

Desired environment split:

```text
Vercel Preview    -> staging Supabase nvtotcdsvijssokijnbn
Vercel Production -> production Supabase jjzjuqxysucqutgjnrkk
```

Use Vercel environment variables for deployed builds. Local files are only for local development and migration tooling.

Before Monday release, verify Vercel has:

- Preview `EXPO_PUBLIC_SUPABASE_URL=https://nvtotcdsvijssokijnbn.supabase.co`
- Preview anon/publishable key for `nvtotcdsvijssokijnbn`
- Production `EXPO_PUBLIC_SUPABASE_URL=https://jjzjuqxysucqutgjnrkk.supabase.co`
- Production anon/publishable key for `jjzjuqxysucqutgjnrkk`

Do not deploy or change production env vars without explicit approval.

## Vercel Deployed-Truth Check

Purpose: determine what commit is deployed, what state the deployment is in, and whether deployment/runtime logs show errors.

Available read-only procedure:

1. Read `.vercel/project.json` for project and team identifiers.
2. Use Vercel connector read-only calls for:
   - Project identity.
   - Latest production deployment.
   - Deployment history.
   - Preview deployment commits.
   - Domains.
   - Build logs for a deployment.
   - Runtime logs when scoped tightly by deployment, time range, and severity.
   - Toolbar comments.
3. Compare the deployment `githubCommitSha` to the approved commit recorded in `docs/release-baseline.md`.

Current limits:

- Environment variable names and scope are not exposed in the current read-only tool surface.
- Production/preview configuration differences are partial unless Vercel exposes env/config inspection.
- Runtime log queries can time out when the window is too broad.
- Vercel `READY` proves deployment readiness, not successful product behavior.

Safety boundary:

- Do not deploy, promote, roll back, change domains, change environment variables, or alter Vercel configuration without Andy's explicit approval.

## PostHog Behavioral-Truth Check

Purpose: determine whether production behavior is actually occurring after code and infrastructure changes.

Available read-only procedure:

1. Use `read-data-schema` to verify event names, properties, and property values before querying.
2. Use bounded read-only SQL or typed query tools for recent event receipt and funnel/identity checks.
3. Inspect saved insights, dashboards, cohorts, and funnels only with read-only calls.
4. For analytics or attribution work, verify:
   - Expected event names.
   - Required properties.
   - Anonymous and identified identity behavior.
   - Source slugs and attribution properties.
   - Recent event samples in a tight time window.

Current limits:

- The PostHog connector exposes both read and write operations. Codi must use only read-only commands unless Andy explicitly approves a configuration change.
- Feature-specific evidence cannot be produced by local scripts; it requires the connected PostHog tool.

Safety boundary:

- Do not create, update, or delete dashboards, insights, cohorts, feature flags, alerts, actions, subscriptions, or project configuration without Andy's explicit approval.

## Closing Verification

Every Keepr change should open and close with:

```bash
npm run codi:preflight
# approved scoped work
npm run codi:verify
```

`npm run codi:verify` is a local read-only status command. It does not call connector-only systems directly. It reports local evidence, Supabase migration parity when safely available, and external checklist items that require connected read-only inspection.

The verification statuses are:

```text
VERIFIED
INFERRED
UNKNOWN
FAILED
NOT APPLICABLE
```

The release decision is evidence status only:

```text
READY TO BASELINE
NOT READY TO BASELINE
BLOCKED — EXTERNAL TRUTH REQUIRED
```

Andy retains all approval authority.
