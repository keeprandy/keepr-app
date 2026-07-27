#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const EXPECTED_REPO = "/Users/andydrake/keepr";
const EXPECTED_PORT = "8081";

function section(title) {
  console.log(`\n## ${title}`);
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

function printField(label, value) {
  console.log(`${label}: ${value || "UNKNOWN"}`);
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};

  const values = {};
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function inferEnvironmentLabel(env) {
  const baseUrl = env.EXPO_PUBLIC_KEEPR_BASE_URL || "";
  const supabaseUrl = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "";

  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(baseUrl + supabaseUrl)) {
    return "local";
  }

  if (/vercel\.app|keepr/i.test(baseUrl)) {
    return "production-or-preview configured";
  }

  if (baseUrl || supabaseUrl) {
    return "configured, exact target not printed";
  }

  return "UNKNOWN";
}

function readReleaseBaseline() {
  const filePath = path.join(process.cwd(), "docs", "release-baseline.md");
  if (!existsSync(filePath)) {
    return {
      file: "docs/release-baseline.md",
      fields: {},
      warning: "UNKNOWN — release baseline document not found",
    };
  }

  const contents = readFileSync(filePath, "utf8");
  const fields = {};
  for (const line of contents.split(/\r?\n/)) {
    const match = line.match(/^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|$/);
    if (!match) continue;
    const key = match[1].trim();
    const value = match[2].trim();
    if (!key || key === "Field" || /^-+$/.test(key)) continue;
    fields[key] = value;
  }

  return {
    file: "docs/release-baseline.md",
    fields,
  };
}

function printGitState() {
  section("Git");

  const repoRoot = run("git", ["rev-parse", "--show-toplevel"]);
  printField("Repository path", repoRoot.ok ? repoRoot.value : "UNKNOWN");
  if (repoRoot.ok && repoRoot.value !== EXPECTED_REPO) {
    printField("WARNING", `expected canonical repository ${EXPECTED_REPO}`);
  }

  const branch = run("git", ["branch", "--show-current"]);
  printField("Current branch", branch.ok ? branch.value : "UNKNOWN");

  const head = run("git", ["rev-parse", "HEAD"]);
  printField("Current HEAD", head.ok ? head.value : "UNKNOWN");

  const status = run("git", ["status", "--short"]);
  if (status.ok) {
    printField("Worktree", status.value ? "DIRTY" : "clean");
    printField("Modified/untracked files", status.value || "none");
  } else {
    printField("Worktree", "UNKNOWN");
    printField("WARNING", status.value);
  }

  const upstream = run("git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  printField("Upstream branch", upstream.ok ? upstream.value : "UNKNOWN");

  if (upstream.ok) {
    const divergence = run("git", ["rev-list", "--left-right", "--count", "@{u}...HEAD"]);
    if (divergence.ok) {
      const [behind, ahead] = divergence.value.split(/\s+/);
      printField("Ahead/behind", `ahead ${ahead || "UNKNOWN"}, behind ${behind || "UNKNOWN"}`);
    } else {
      printField("Ahead/behind", "UNKNOWN");
      printField("WARNING", divergence.value);
    }
  } else {
    printField("Ahead/behind", "UNKNOWN");
    printField("WARNING", upstream.value);
  }

  const recent = run("git", ["log", "--oneline", "--decorate", "--max-count=5"]);
  printField("Recent commits", recent.ok ? `\n${recent.value}` : "UNKNOWN");
}

function printBaseline() {
  section("Approved Production Baseline");
  const baseline = readReleaseBaseline();
  printField("Source document", baseline.file);

  if (baseline.warning) {
    printField("Approved production commit", "UNKNOWN — external inspection required");
    printField("WARNING", baseline.warning);
    return;
  }

  printField("Approved production commit", baseline.fields["Approved production commit"]);
  printField("Source branch", baseline.fields["Source branch"]);
  printField("Vercel production deployment", baseline.fields["Vercel production deployment"]);
  printField("Supabase migration level", baseline.fields["Supabase migration level"]);
  printField("Approval date", baseline.fields["Approval date"]);
  printField("Approved by", baseline.fields["Approved by"]);
}

function printExternalState() {
  section("External Truth");
  printField(
    "Latest known Vercel production commit",
    "UNKNOWN — external inspection required"
  );

  const supabaseAvailable = run("supabase", ["--version"]);
  if (!supabaseAvailable.ok) {
    printField("Supabase migration parity", "UNKNOWN — external inspection required");
    printField("WARNING", "Supabase CLI is unavailable");
    return;
  }

  const migrations = run("supabase", ["migration", "list"], { timeout: 20000 });
  if (!migrations.ok) {
    printField("Supabase migration parity", "UNKNOWN — external inspection required");
    printField("WARNING", migrations.value);
    return;
  }

  const rows = migrations.value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^\d{14}\s+\|\s+\d{14}\s+\|/.test(line));

  const mismatches = rows.filter((line) => {
    const [local, remote] = line.split("|").map((part) => part.trim());
    return local !== remote;
  });

  if (!rows.length) {
    printField("Supabase migration parity", "UNKNOWN — external inspection required");
    printField("WARNING", "No migration rows were returned");
    return;
  }

  printField(
    "Supabase migration parity",
    mismatches.length ? `MISMATCH (${mismatches.length} rows)` : "MATCH"
  );
  printField("Latest local/remote migration row", rows[rows.length - 1]);
}

function printEnvironment() {
  section("Environment");

  const envFiles = [".env", ".env.local"].filter((file) => existsSync(path.join(process.cwd(), file)));
  const mergedEnv = Object.assign(
    {},
    ...envFiles.map((file) => parseEnvFile(path.join(process.cwd(), file)))
  );

  printField("Environment files present", envFiles.join(", ") || "none");
  printField("Active environment label", inferEnvironmentLabel(mergedEnv));
  printField("Secret values", "not printed");
  printField("Expected local review port", EXPECTED_PORT);
}

function main() {
  console.log("Keepr Codi Preflight");
  console.log("Read-only inspection only. No commit, push, deploy, migration, or production change performed.");

  printGitState();
  printBaseline();
  printExternalState();
  printEnvironment();

  section("Warnings");
  console.log("- Vercel production commit is UNKNOWN unless inspected with an approved external connector.");
  console.log("- Supabase migration parity does not prove live schema, RLS, storage, auth, or Edge Function truth.");
  console.log("- Dirty worktree files must be preserved unless Andy explicitly approves handling them.");
}

main();
