#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const BASELINE_PATH = path.join(process.cwd(), "docs", "release-baseline.md");
const STATUS = {
  VERIFIED: "VERIFIED",
  INFERRED: "INFERRED",
  UNKNOWN: "UNKNOWN",
  FAILED: "FAILED",
  NA: "NOT APPLICABLE",
};

function section(title) {
  console.log(`\n## ${title}`);
}

function line(status, label, detail) {
  console.log(`[${status}] ${label}: ${detail}`);
}

function run(command, args, options = {}) {
  try {
    return {
      ok: true,
      value: execFileSync(command, args, {
        cwd: process.cwd(),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: options.timeout || 10000,
      }).trim(),
    };
  } catch (error) {
    const stderr = error.stderr?.toString?.().trim();
    const stdout = error.stdout?.toString?.().trim();
    return {
      ok: false,
      value: stderr || stdout || error.message,
    };
  }
}

function parseBaseline() {
  if (!existsSync(BASELINE_PATH)) return {};

  const contents = readFileSync(BASELINE_PATH, "utf8");
  const fields = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const match = rawLine.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (!key || key === "Field" || /^-+$/.test(key)) continue;
    fields[key] = value;
  }
  return fields;
}

function isConcreteSha(value) {
  return /^[0-9a-f]{7,40}$/i.test(value || "");
}

function parseMigrationRows(output) {
  return output
    .split(/\r?\n/)
    .map((rawLine) => rawLine.trim())
    .filter((rawLine) => /^\d{14}\s+\|\s+\d{14}\s+\|/.test(rawLine))
    .map((rawLine) => {
      const [local, remote] = rawLine.split("|").map((part) => part.trim());
      return { local, remote, rawLine };
    });
}

function verifyApprovedCommit(baseline) {
  section("Approved Commit");

  const requested = process.env.CODI_VERIFY_COMMIT || baseline["Approved production commit"];
  if (!requested || /^(UNKNOWN|TO BE CONFIRMED)$/i.test(requested)) {
    line(
      STATUS.UNKNOWN,
      "Commit requested for verification",
      "No concrete approved commit is recorded. Set docs/release-baseline.md or CODI_VERIFY_COMMIT."
    );
    return { status: STATUS.UNKNOWN, commit: null };
  }

  line(STATUS.VERIFIED, "Commit requested for verification", requested);

  const local = run("git", ["cat-file", "-e", `${requested}^{commit}`]);
  line(
    local.ok ? STATUS.VERIFIED : STATUS.FAILED,
    "Local availability",
    local.ok ? "commit exists in local repository" : local.value
  );

  const head = run("git", ["rev-parse", "HEAD"]);
  if (head.ok) {
    line(
      head.value.startsWith(requested) || requested.startsWith(head.value)
        ? STATUS.VERIFIED
        : STATUS.INFERRED,
      "Current HEAD relationship",
      head.value.startsWith(requested) || requested.startsWith(head.value)
        ? "current HEAD matches requested commit"
        : `current HEAD is ${head.value}; compare exact lineage before baseline`
    );
  }

  line(
    isConcreteSha(baseline["Approved production commit"]) ? STATUS.VERIFIED : STATUS.UNKNOWN,
    "Matches approved release baseline",
    isConcreteSha(baseline["Approved production commit"])
      ? "approved baseline contains a concrete commit"
      : "approved baseline is not yet confirmed"
  );

  line(
    STATUS.UNKNOWN,
    "GitHub lineage",
    "external connector inspection required: fetch commit, status checks, PR/review lineage, and deployment statuses"
  );

  return { status: local.ok ? STATUS.VERIFIED : STATUS.FAILED, commit: requested };
}

function verifyVercel(baseline, approvedCommit) {
  section("Vercel Deployment");

  const deployment = baseline["Vercel production deployment"];
  if (deployment && !/^(UNKNOWN|TO BE CONFIRMED)$/i.test(deployment)) {
    line(STATUS.INFERRED, "Latest production deployment", deployment);
  } else {
    line(
      STATUS.UNKNOWN,
      "Latest production deployment",
      "external Vercel inspection required"
    );
  }

  line(
    STATUS.UNKNOWN,
    "Deployed commit",
    "external Vercel inspection required; do not infer from local HEAD"
  );
  line(
    STATUS.UNKNOWN,
    "Deployment state",
    "external Vercel inspection required"
  );
  line(
    STATUS.UNKNOWN,
    "Matches approved commit",
    approvedCommit ? "compare Vercel githubCommitSha to approved commit" : "no approved commit available"
  );
  line(
    STATUS.UNKNOWN,
    "Deployment/runtime errors",
    "external Vercel build and runtime log inspection required"
  );

  return { status: STATUS.UNKNOWN };
}

function verifySupabase(baseline) {
  section("Supabase Compatibility");

  const expectedMigration = baseline["Supabase migration level"];
  if (!expectedMigration || /^(UNKNOWN|TO BE CONFIRMED)$/i.test(expectedMigration)) {
    line(
      STATUS.UNKNOWN,
      "Expected migration level",
      "not recorded in docs/release-baseline.md"
    );
  } else {
    line(STATUS.VERIFIED, "Expected migration level", expectedMigration);
  }

  const migrations = run("supabase", ["migration", "list"], { timeout: 20000 });
  if (!migrations.ok) {
    line(
      STATUS.UNKNOWN,
      "Remote migration parity",
      `UNKNOWN — external inspection required (${migrations.value})`
    );
    line(
      STATUS.UNKNOWN,
      "Required migrations present",
      "could not inspect remote migration history"
    );
    line(
      STATUS.UNKNOWN,
      "Live schema/RLS/function state",
      "requires read-only Supabase project/database inspection"
    );
    return { status: STATUS.UNKNOWN };
  }

  const rows = parseMigrationRows(migrations.value);
  if (!rows.length) {
    line(STATUS.UNKNOWN, "Remote migration parity", "no migration rows returned");
    return { status: STATUS.UNKNOWN };
  }

  const mismatches = rows.filter((row) => row.local !== row.remote);
  line(
    mismatches.length ? STATUS.FAILED : STATUS.VERIFIED,
    "Remote migration parity",
    mismatches.length ? `${mismatches.length} mismatch row(s)` : "local and remote migration versions match"
  );

  if (expectedMigration && !/^(UNKNOWN|TO BE CONFIRMED)$/i.test(expectedMigration)) {
    const present = rows.some((row) => row.local === expectedMigration && row.remote === expectedMigration);
    line(
      present ? STATUS.VERIFIED : STATUS.FAILED,
      "Required migrations present",
      present ? `${expectedMigration} is present locally and remotely` : `${expectedMigration} was not found as a matching local/remote row`
    );
  } else {
    line(STATUS.UNKNOWN, "Required migrations present", "expected migration is not recorded");
  }

  line(
    STATUS.UNKNOWN,
    "Live schema/RLS/function state",
    "migration parity does not prove live schema, RLS, grants, storage, auth, or Edge Function state"
  );

  return { status: mismatches.length ? STATUS.FAILED : STATUS.VERIFIED };
}

function verifyPostHog() {
  section("PostHog Behavioral Evidence");

  line(
    STATUS.UNKNOWN,
    "Expected event names",
    "external PostHog schema inspection required for the specific feature"
  );
  line(
    STATUS.UNKNOWN,
    "Required properties",
    "external PostHog property inspection required for the specific feature"
  );
  line(
    STATUS.UNKNOWN,
    "Recent receipt",
    "external PostHog event query required; local command must not pretend to query connector-only data"
  );
  line(
    STATUS.UNKNOWN,
    "Identity behavior",
    "external PostHog person/event inspection required"
  );
  line(
    STATUS.UNKNOWN,
    "Attribution behavior",
    "external PostHog event/property inspection required"
  );
  line(
    STATUS.UNKNOWN,
    "Missing evidence",
    "run the documented PostHog behavioral-truth check for the feature"
  );

  return { status: STATUS.UNKNOWN };
}

function releaseDecision(results) {
  section("Release Decision");

  if (results.some((result) => result.status === STATUS.FAILED)) {
    console.log("NOT READY TO BASELINE");
    return;
  }

  if (!results[0].commit) {
    console.log("NOT READY TO BASELINE");
    return;
  }

  if (results.some((result) => result.status === STATUS.UNKNOWN)) {
    console.log("BLOCKED — EXTERNAL TRUTH REQUIRED");
    return;
  }

  console.log("READY TO BASELINE");
}

function main() {
  console.log("Keepr Codi Verification");
  console.log("Read-only evidence status only. This is not authorization to deploy or baseline.");
  console.log("No commit, push, deploy, migration, infrastructure configuration change, or production change performed.");

  const baseline = parseBaseline();
  const approved = verifyApprovedCommit(baseline);
  const vercel = verifyVercel(baseline, approved.commit);
  const supabase = verifySupabase(baseline);
  const posthog = verifyPostHog();

  releaseDecision([approved, vercel, supabase, posthog]);
}

main();
