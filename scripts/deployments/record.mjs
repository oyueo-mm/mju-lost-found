#!/usr/bin/env node
// 배포 이력 recorder, run on the developer's machine next to the Vercel CLI.
// Reads deployments through `vercel api` -- the CLI's own login, which never
// leaves this machine and is never printed -- and upserts them into
// DeploymentRecord (one row per deployment id, see prisma/schema.prisma):
// Vercel's created / ready times, state, Git commit, and, with --all, which
// deployment serves Production and which one the fixed Preview URL shows.
//
//   node scripts/deployments/record.mjs <deployment url or id> [...]
//   node scripts/deployments/record.mjs --all      every deployment Vercel still lists
//   options: --db preview (default) | production | both, the last two with
//            --confirm-production
//            --dry-run (print what would be written, write nothing)
//
// The Preview database is the default. The Production database is only
// written with --confirm-production, and only once its migration
// (20261107000000_deployment_record) has been applied there. Each
// environment's deployments record themselves only in their own database,
// so after the release use --db both: then Production's 개발 통계 also
// sees the Preview deployments. Deployments Vercel has already deleted are
// not recreated.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { fromVercel, PREVIEW_ALIAS, PROJECT_ID } from "../../src/lib/devstats/vercelDeployment.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(join(ROOT, "package.json"));

const DBS = {
  // the database user names say which Supabase project a URL belongs to
  preview: { file: ".env.preview.local", project: "swqvli" },
  production: { file: ".env", project: "tmifqt" },
};

export function parseArgs(argv) {
  const opts = { db: "preview", dbs: /** @type {string[]} */ ([]), all: false, dryRun: false, confirmProduction: false, targets: /** @type {string[]} */ ([]) };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--all") opts.all = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--confirm-production") opts.confirmProduction = true;
    else if (a === "--db") opts.db = argv[++i];
    else if (a.startsWith("--")) throw new Error(`unknown option ${a}`);
    else opts.targets.push(a.replace(/^https?:\/\//, "").replace(/\/.*$/, ""));
  }
  if (!(opts.db in DBS) && opts.db !== "both") throw new Error("--db must be preview, production or both");
  if (opts.db !== "preview" && !opts.confirmProduction) throw new Error("writing the Production database needs --confirm-production as well");
  opts.dbs = opts.db === "both" ? ["preview", "production"] : [opts.db];
  if (!opts.all && opts.targets.length === 0) throw new Error("give deployment urls / ids, or --all");
  return opts;
}

function vercelApi(path) {
  // quoted for the shell (the path holds ? and &)
  const r = spawnSync(`npx vercel api "${path}"`, { cwd: ROOT, shell: true, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`vercel api ${path.split("?")[0]} failed (exit ${r.status})`);
  return JSON.parse(r.stdout);
}

function envValue(file, key) {
  const text = readFileSync(join(ROOT, file), "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && m[1] === key) return m[2].replace(/^["']|["']$/g, "");
  }
  return null;
}

export const UPSERT_SQL = `
  INSERT INTO "DeploymentRecord" AS d
    ("id", "target", "url", "git_sha", "git_message", "git_dirty", "state", "created_at", "ready_at", "current_at", "sources", "updated_at")
  VALUES ($1, $2, $3, $4, $5, $6, $7, ($8::timestamptz AT TIME ZONE 'UTC'), ($9::timestamptz AT TIME ZONE 'UTC'),
          ($10::timestamptz AT TIME ZONE 'UTC'), ARRAY['cli']::text[], (now() AT TIME ZONE 'UTC'))
  ON CONFLICT ("id") DO UPDATE SET
    "target" = EXCLUDED."target",
    "url" = COALESCE(EXCLUDED."url", d."url"),
    "git_sha" = COALESCE(EXCLUDED."git_sha", d."git_sha"),
    "git_message" = COALESCE(EXCLUDED."git_message", d."git_message"),
    "git_dirty" = COALESCE(EXCLUDED."git_dirty", d."git_dirty"),
    "state" = COALESCE(EXCLUDED."state", d."state"),
    "created_at" = COALESCE(EXCLUDED."created_at", d."created_at"),
    "ready_at" = COALESCE(EXCLUDED."ready_at", d."ready_at"),
    "current_at" = GREATEST(d."current_at", EXCLUDED."current_at"),
    "sources" = ARRAY(SELECT DISTINCT unnest(d."sources" || EXCLUDED."sources") ORDER BY 1),
    "updated_at" = EXCLUDED."updated_at"`;

/** @param {Record<string, any>} row @param {string | null} [currentAt] */
export const paramsOf = (row, currentAt = null) => [
  row.id,
  row.target,
  row.url,
  row.gitSha,
  row.gitMessage,
  row.gitDirty,
  row.state,
  row.createdAt,
  row.readyAt,
  currentAt,
];

function collect(opts) {
  const rows = [];
  if (opts.all) {
    let until = null;
    for (let page = 0; page < 10; page++) {
      const body = vercelApi(`/v6/deployments?projectId=${PROJECT_ID}&limit=100${until ? `&until=${until}` : ""}`);
      for (const d of body.deployments ?? []) {
        const row = fromVercel(d);
        if (row) rows.push(row);
      }
      until = body.pagination?.next ?? null;
      if (!until) break;
    }
  }
  for (const t of opts.targets) {
    const row = fromVercel(vercelApi(`/v13/deployments/${encodeURIComponent(t)}`));
    if (!row) throw new Error(`not a deployment: ${t}`);
    if (!rows.some((r) => r.id === row.id)) rows.push(row);
  }
  // which deployments are live right now (only the ids are read: the
  // project answer also holds settings and secrets)
  const project = vercelApi(`/v9/projects/${PROJECT_ID}`);
  const productionId = project?.targets?.production?.id ?? null;
  const previewAliasId = vercelApi(`/v4/aliases/${PREVIEW_ALIAS}?projectId=${PROJECT_ID}`)?.deploymentId ?? null;
  return { rows, productionId, previewAliasId };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { rows, productionId, previewAliasId } = collect(opts);
  const now = new Date().toISOString();
  const current = (id) => (id === productionId || id === previewAliasId ? now : null);
  for (const r of rows) {
    const tag = r.id === productionId ? " [현재 Production]" : r.id === previewAliasId ? " [현재 Preview 고정 URL]" : "";
    console.log(`${r.id} ${r.target.padEnd(10)} ${r.state ?? "-"} ${r.gitSha?.slice(0, 7) ?? "(커밋 없음)"} ${r.createdAt ?? "-"}${tag}`);
  }
  if (opts.dryRun) return console.log(`dry run: ${rows.length} deployments, nothing written`);

  // every database is checked before any is written
  const targets = opts.dbs.map((name) => {
    const db = DBS[name];
    const url = envValue(db.file, "DIRECT_URL");
    if (!url) throw new Error(`DIRECT_URL missing in ${db.file}`);
    if (!new URL(url).username.includes(db.project)) throw new Error(`${db.file} does not point at the ${name} database`);
    return { name, url };
  });
  const { Client } = require("pg");
  for (const { name, url } of targets) {
    const client = new Client({ connectionString: url });
    await client.connect();
    try {
      await client.query("BEGIN");
      for (const r of rows) await client.query(UPSERT_SQL, paramsOf(r, current(r.id)));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`${name} database: ${error.message}`);
    } finally {
      await client.end();
    }
    console.log(`recorded ${rows.length} deployments in the ${name} database`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(`record failed: ${error.message}`);
    process.exit(1);
  });
}
