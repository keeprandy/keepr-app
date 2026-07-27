# Keepr Release Baseline

This document records the approved production baseline for Keepr Production Mode.

Do not treat a dirty local worktree as the approved baseline. Do not update this document to declare a new production baseline unless Andy has approved the actual production experience and authorized the baseline update.

| Field | Value |
| --- | --- |
| Approved production commit | 6085e4f9d6a10d4fa93f0773d161a96dbf2dfd8e |
| Source branch | develop |
| Vercel production deployment | dpl_3i2U1xmRnQxNZKh35Lw4MyQrMVUd |
| Production deployment URL | keepr-r055v9xi5-see-you-then.vercel.app |
| Supabase migration level | 20260724183500 |
| Approval date | 2026-07-27 |
| Approved by | Andy |
| Known production exceptions | The local working tree contains uncommitted changes that are not included in the approved production baseline: `App.js`, `tests/share-actions-v1.test.mjs`. Production Mode scripts and documentation are currently local uncommitted work until separately reviewed and approved. |
| Active regressions | No active regression inventory was validated as part of this baseline approval. Known issues must be tracked and verified separately before being labeled resolved. |
| Next feature branch starting point | 6085e4f9d6a10d4fa93f0773d161a96dbf2dfd8e |

## Update Rules

- Use exact commit SHAs, deployment IDs or URLs, and migration versions.
- Use `UNKNOWN` or `TO BE CONFIRMED` when a value has not been directly verified.
- Preserve known exceptions and active regressions until Andy confirms they are resolved.
- Record only approved production state, not local draft work, preview-only work, or unreviewed commits.

## Baseline Checklist

Before this file is updated, verify:

- The reviewed commit is the commit deployed to production.
- Supabase production migration state is compatible with the deployed commit.
- Vercel production deployment is ready and points to the approved commit.
- PostHog behavioral evidence is checked when the release touches analytics, attribution, activation, funnels, or identity.
- Andy has approved the actual production experience.
