#!/usr/bin/env node

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const TARGETS = {
  staging: {
    ref: "nvtotcdsvijssokijnbn",
    url: "https://nvtotcdsvijssokijnbn.supabase.co",
    envFile: ".local-env/staging.env",
    defaultPort: "8096",
  },
  production: {
    ref: "jjzjuqxysucqutgjnrkk",
    url: "https://jjzjuqxysucqutgjnrkk.supabase.co",
    envFile: ".local-env/production.env",
    defaultPort: "8097",
  },
};

const PUBLIC_URL_KEY = "EXPO_PUBLIC_SUPABASE_URL";
const PUBLIC_ANON_KEY = "EXPO_PUBLIC_SUPABASE_ANON_KEY";
const DB_URL_KEY = "SUPABASE_DB_URL";

function usage(exitCode = 1) {
  console.log(`Usage:
  node scripts/supabase-target.mjs verify-runtime <staging|production>
  node scripts/supabase-target.mjs web <staging|production> [--port 8096]
  node scripts/supabase-target.mjs db-status <staging|production>
  node scripts/supabase-target.mjs db-dry-run <staging|production>
  node scripts/supabase-target.mjs db-push <staging|production>
  node scripts/supabase-target.mjs db-apply-file <staging|production> <path/to/file.sql>

Local env files:
  .local-env/staging.env
  .local-env/production.env

Required browser keys:
  ${PUBLIC_URL_KEY}
  ${PUBLIC_ANON_KEY}

Required migration key:
  ${DB_URL_KEY}

Production db-push additionally requires:
  CONFIRM_PRODUCTION_DB_PUSH=jjzjuqxysucqutgjnrkk`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const [command, targetName, ...rest] = argv;
  if (!command || !targetName || !TARGETS[targetName]) {
    usage();
  }
  const portIndex = rest.indexOf("--port");
  const port = portIndex >= 0 ? rest[portIndex + 1] : null;
  const sqlFile = command === "db-apply-file" ? rest.find((arg) => !arg.startsWith("--")) : null;
  return { command, targetName, target: TARGETS[targetName], port, sqlFile };
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing ${filePath}. Create it from the matching .env.*.example file.`);
  }

  const result = {};
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    let value = rawValue.trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function refFromUrl(url) {
  try {
    const host = new URL(url).hostname;
    return host.match(/^([a-z0-9-]+)\.supabase\.co$/i)?.[1] || null;
  } catch {
    return null;
  }
}

function refFromDbUrl(dbUrl) {
  try {
    const parsed = new URL(dbUrl);
    const host = parsed.hostname.toLowerCase();
    const username = decodeURIComponent(parsed.username || "").toLowerCase();
    const queryRef =
      parsed.searchParams.get("project_ref") ||
      parsed.searchParams.get("supabase_project_ref") ||
      null;

    const directHostRef = host.match(/^db\.([a-z0-9-]+)\.supabase\.co$/i)?.[1] || null;
    const poolerUserRef = username.match(/^postgres\.([a-z0-9-]+)$/i)?.[1] || null;

    return directHostRef || poolerUserRef || queryRef;
  } catch {
    return null;
  }
}

function loadTargetEnv(target) {
  const envFilePath = path.resolve(process.cwd(), target.envFile);
  return readEnvFile(envFilePath);
}

function verifyRuntime(target, targetEnv) {
  const url = (targetEnv[PUBLIC_URL_KEY] || "").trim().replace(/\/+$/, "");
  const anonKey = (targetEnv[PUBLIC_ANON_KEY] || "").trim();

  if (!url || !anonKey) {
    throw new Error(`${target.envFile} must define ${PUBLIC_URL_KEY} and ${PUBLIC_ANON_KEY}.`);
  }

  const urlRef = refFromUrl(url);
  if (urlRef !== target.ref) {
    throw new Error(`${PUBLIC_URL_KEY} points to ${urlRef || "unknown"}, expected ${target.ref}.`);
  }

  if (url !== target.url) {
    throw new Error(`${PUBLIC_URL_KEY} must be exactly ${target.url}.`);
  }

  const tokenRef = decodeJwtPayload(anonKey)?.ref || null;
  if (tokenRef && tokenRef !== target.ref) {
    throw new Error(`${PUBLIC_ANON_KEY} belongs to ${tokenRef}, expected ${target.ref}.`);
  }

  if (/service_role/i.test(anonKey) || decodeJwtPayload(anonKey)?.role === "service_role") {
    throw new Error(`${PUBLIC_ANON_KEY} must be a browser-safe anon/publishable key, not service_role.`);
  }

  console.log(`Supabase runtime target verified: ${target.ref}`);
}

function requireDbUrl(target, targetEnv) {
  const dbUrl = (targetEnv[DB_URL_KEY] || "").trim();
  if (!dbUrl) {
    throw new Error(`${target.envFile} must define ${DB_URL_KEY} for migration commands.`);
  }

  const dbRef = refFromDbUrl(dbUrl);
  if (dbRef !== target.ref) {
    throw new Error(
      `${DB_URL_KEY} resolves to ${dbRef || "unknown"}, expected ${target.ref}. Refusing migration command.`
    );
  }

  console.log(`Supabase database target verified: ${target.ref}`);
  return dbUrl;
}

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
  });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

function runDb(command, target, targetEnv) {
  const dbUrl = requireDbUrl(target, targetEnv);
  if (command === "db-push" && target === TARGETS.production) {
    if (process.env.CONFIRM_PRODUCTION_DB_PUSH !== target.ref) {
      throw new Error(
        `Refusing production db push. Re-run with CONFIRM_PRODUCTION_DB_PUSH=${target.ref} only after approval.`
      );
    }
  }

  const args =
    command === "db-status"
      ? ["migration", "list", "--db-url", dbUrl]
      : ["db", "push", "--db-url", dbUrl, ...(command === "db-dry-run" ? ["--dry-run"] : [])];

  console.log(`Supabase ${command} target: ${target.ref}`);
  run("supabase", args);
}

function runDbApplyFile(targetName, target, targetEnv, sqlFile) {
  const dbUrl = requireDbUrl(target, targetEnv);
  if (!sqlFile) {
    throw new Error("db-apply-file requires a SQL file path.");
  }

  if (targetName === "production" && process.env.CONFIRM_PRODUCTION_DB_PUSH !== target.ref) {
    throw new Error(
      `Refusing production SQL apply. Re-run with CONFIRM_PRODUCTION_DB_PUSH=${target.ref} only after approval.`
    );
  }

  const resolvedSqlFile = path.resolve(process.cwd(), sqlFile);
  if (!fs.existsSync(resolvedSqlFile)) {
    throw new Error(`SQL file not found: ${resolvedSqlFile}`);
  }

  console.log(`Supabase db-apply-file target: ${target.ref}`);
  console.log(`SQL file: ${path.relative(process.cwd(), resolvedSqlFile)}`);
  run("psql", [dbUrl, "-v", "ON_ERROR_STOP=1", "-f", resolvedSqlFile]);
}

try {
  const { command, targetName, target, port, sqlFile } = parseArgs(process.argv.slice(2));
  const targetEnv = loadTargetEnv(target);

  if (command === "verify-runtime") {
    verifyRuntime(target, targetEnv);
    process.exit(0);
  }

  if (command === "web") {
    verifyRuntime(target, targetEnv);
    const selectedPort = port || target.defaultPort;
    const env = {
      ...process.env,
      ...targetEnv,
      EXPO_PUBLIC_SUPABASE_EXPECTED_REF: target.ref,
    };
    console.log(`Starting ${targetName} web runtime on port ${selectedPort} (${target.ref})`);
    run("npx", ["expo", "start", "--web", "--port", selectedPort], env);
  }

  if (["db-status", "db-dry-run", "db-push"].includes(command)) {
    runDb(command, target, targetEnv);
  }

  if (command === "db-apply-file") {
    runDbApplyFile(targetName, target, targetEnv, sqlFile);
  }

  usage();
} catch (error) {
  console.error(error?.message || error);
  process.exit(1);
}
