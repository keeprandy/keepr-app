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

Available read-only procedure:

1. Inspect linked project metadata from `supabase/.temp/linked-project.json` without printing secrets.
2. Run `supabase migration list` to compare local and remote migration history.
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
