# Web Build Baseline Diagnostic

Date: 2026-07-17

## Production Deployment

- Production deployment: `dpl_32GdhaQ2s3zfecW7VA4RkRJVxRQq`
- Production URL: `https://app.keeprhome.com`
- Production source commit: `74ca154fb010bba41b1687a7f858914d19a918ee`
- Production source branch: `hotfix/public-actions-performance`
- Current diagnostic branch: `integration/projections-handoff`
- Current diagnostic HEAD: `e9eb6c49c02567db23f819a86fd5e3587f78cdd5`

## Actual Production Build Command

Vercel build logs for `dpl_32GdhaQ2s3zfecW7VA4RkRJVxRQq` show:

1. Vercel platform command: `vercel build`
2. Vercel CLI: `56.2.0`
3. Node: `24.x`
4. Dependency step: `Installing dependencies...`
5. Project build command:

```sh
npm run build:web
```

The `build:web` script is:

```sh
npx expo export --platform web
```

The exported output directory is:

```text
dist
```

The Vercel build then compiles serverless functions and deploys `/vercel/output`.

## Local Failed Command

Initial command:

```sh
npm run build:web
```

Initial result:

```text
CommandError: No platforms are configured to use the Metro bundler in the project Expo config.
```

Before dependency installation, `/private/tmp/keepr-projections-handoff` had no `node_modules` directory and no `node_modules/.bin/expo`, so `npx expo` resolved through a network-installed CLI path rather than the package-lock-installed Expo dependency used by Vercel.

## Build Configuration

Present tracked files:

- `package.json`
- `package-lock.json`
- `app.json`
- `eas.json`
- `vercel.json`
- `.gitignore`
- `.vercelignore`

Absent tracked files:

- `app.config.js`
- `app.config.ts`
- `metro.config.js`
- `metro.config.cjs`
- `babel.config.js`
- `babel.config.cjs`

`package.json` scripts:

```json
{
  "start": "expo start",
  "android": "expo run:android",
  "ios": "expo run:ios",
  "build:web": "npx expo export --platform web",
  "web": "expo start --web"
}
```

`vercel.json` contains rewrites only. It does not define build command, install command, framework preset, or output directory.

Vercel project settings reported:

- Project: `keepr-app`
- Project ID: `prj_SEh4lqulA6e3DuEjJLRERR1fCutV`
- Framework preset: `null`
- Node version: `24.x`

## Resolved Expo Configuration

After running `npm ci`, this command succeeded:

```sh
npx expo config --json
```

Resolved config included:

```json
"sdkVersion": "54.0.0",
"platforms": ["ios", "android", "web"]
```

Installed locked Expo package:

```text
expo 54.0.25
```

## Worktree Comparison

| Item | `/private/tmp/keepr-projections-handoff` | `/private/tmp/keepr-public-actions-hotfix` | Difference |
|---|---|---|---|
| HEAD | `e9eb6c49c02567db23f819a86fd5e3587f78cdd5` | `74ca154fb010bba41b1687a7f858914d19a918ee` | report-only commit exists in integration worktree |
| `package.json` | same as hotfix | same as integration | none |
| `package-lock.json` | same as hotfix | same as integration | none |
| `app.json` | same as hotfix | same as integration | none |
| `eas.json` | same as hotfix | same as integration | none |
| `vercel.json` | same as hotfix | same as integration | none |
| `app.config.*` | absent | absent | none |
| `metro.config.*` | absent | absent | none |
| `babel.config.*` | absent | absent | none |
| `.env*` files | none present | none present | none |
| `node_modules` before install | absent | present | responsible local state difference |
| local Node | `v24.11.1` | `v24.11.1` | none |
| local npm | `11.6.2` | `11.6.2` | none |

## Environment Requirements By Name

Names referenced in source/config, values not inspected or printed:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_KEEPR_BASE_URL`
- `PUBLIC_KEEPR_BASE_URL`
- `EXPO_PUBLIC_ENRICH_URL`
- `EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY`
- `EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY`
- `EXPO_PUBLIC_POSTHOG_KEY`
- `EXPO_PUBLIC_POSTHOG_HOST`
- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The web export itself succeeded locally after dependency installation without printing or requiring secret values.

## Reproduction Results

Dependency installation:

```sh
npm ci
```

Result:

```text
added 1104 packages, and audited 1105 packages
44 vulnerabilities (1 low, 31 moderate, 11 high, 1 critical)
```

Warnings were dependency audit/deprecation warnings, not build blockers.

Canonical app build command:

```sh
npm run build:web
```

Result:

```text
Web Bundled 7948ms index.js (1943 modules)
Exported: dist
```

Full local Vercel wrapper command:

```sh
npx vercel build
```

Result:

```text
project_settings_required
No project settings found locally. Run pull to retrieve them, or re-run with --yes to pull automatically.
```

This is expected because `.vercel` project settings are ignored and absent from the isolated worktree. No Vercel deployment was run.

## Root Cause Classification

Classification:

```text
dependency_or_cli_version_difference
```

The tracked source configuration is sufficient. The failing command happened before dependencies were installed in the isolated worktree, causing `npx expo` to resolve a different/latest Expo CLI path rather than the locked local Expo package that Vercel uses after dependency installation.

Secondary local-only limitation:

```text
missing_ignored_configuration
```

The full `vercel build` wrapper cannot be run until `.vercel` project settings are pulled or otherwise supplied. This does not block the project build command itself.

## Minimal Correction Plan

No source-code change is required.

Canonical reproducible build sequence for this worktree:

```sh
npm ci
npm run build:web
```

For full Vercel wrapper parity, the next optional diagnostic step would be:

```sh
vercel pull --yes --environment preview
vercel build --yes
```

That would create/update ignored `.vercel` local project settings and may pull environment metadata, so it should be approved separately before use.

## GO / NO-GO

GO for beginning Boat Projection implementation after confirming the team accepts `npm ci && npm run build:web` as the local reproducible baseline build gate.

NO source-code correction is needed for the Expo/Metro error.
